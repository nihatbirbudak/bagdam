import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  canCycleTransition,
  CYCLE_FULFILLABLE_STATES,
  isoDateToUtc,
  ORDER_PAID_STATES,
  type CycleStatus,
  type IsoDate,
  type OpsBulkStatus,
  type OpsBulkStatusItemResult,
  type OpsBulkStatusResult,
  type OpsDaySummary,
  type OrderStatus,
} from '@bagdam/shared';
import type { OrderStatus as PrismaOrderStatus } from '@prisma/client';
import { OrdersService } from '../../orders/orders.service';
import { ACTOR } from '../subscriptions.constants';
import { conflict, SUB_ERRORS } from '../subscriptions.errors';
import { buildDaySummary } from '../subscriptions.mapper';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { CyclesService } from './cycles.service';

/** `POST /admin/ops/bulk-status` girdisi (DTO doğrulanmış hâli). */
export interface BulkStatusInput {
  cycleIds?: string[];
  orderIds?: string[];
  status: OpsBulkStatus;
  note?: string;
  skipInvalid?: boolean;
}

/** Tek istekte ilerletilebilecek en çok satır (ops ekranı bir günün tamamını seçebilir). */
export const OPS_BULK_MAX_ITEMS = 500;

/** Cycle makinesinde karşılığı olan ops hedefleri — DELIVERY_FAILED yalnız Order'da vardır (state-machines §1/§3). */
const CYCLE_BULK_STATUSES: readonly OpsBulkStatus[] = ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Hep-ya-hiç ön kontrol hatası (409). */
export const OPS_BULK_ERROR = 'OPS_BULK_TRANSITION_INVALID';

/** Teslimata giren cycle durumları (pick/packing ile aynı küme) — ops ekranının varsayılan süzgeci. */
export const OPS_FULFILLABLE_STATES = CYCLE_FULFILLABLE_STATES;

/**
 * OpsService (F9 — ekran 20 "Teslimat Günü", ekran 21 "Özet"): `/api/v1/admin/ops/*` iş kuralları.
 *  - `daySummary(date, zone)`: günün cycle durum dağılımı, teslimata giren kutular (tier kırılımı + satır sayıları),
 *    ciro, bölge bazlı kapasite/kesim durumu ve abonelik dışı (tekil ürün) sipariş sayısı — pick/packing üst şeridi.
 *  - `bulkStatus(...)`: seçili cycle'ları (CyclesService.adminSetStatus; Order'ı da birlikte ilerletir) ve/veya
 *    abonelik dışı siparişleri (OrdersService.applyBulkTransition) aynı duruma ilerletir. VARSAYILAN HEP-YA-HİÇ:
 *    tek bir geçiş bile geçersizse hiçbiri uygulanmaz → 409 `OPS_BULK_TRANSITION_INVALID`; `skipInvalid:true`
 *    verilirse geçersizler atlanır ve satır satır raporlanır.
 * Prisma yalnız repository'de; zaman `now` parametresiyle (ADR-0004).
 */
@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly cycles: CyclesService,
    private readonly orders: OrdersService,
  ) {}

  async daySummary(date: IsoDate, zoneSlug: string | undefined, now: Date = new Date()): Promise<OpsDaySummary> {
    const zone = await this.resolveZone(zoneSlug);
    const day = isoDateToUtc(date);
    const [cycles, deliveryDates, standaloneOrders] = await Promise.all([
      this.repo.findCyclesForDate({ date: day, zoneId: zone?.id }),
      this.repo.findDeliveryDatesForDate(day, zone?.id),
      this.repo.findStandaloneOrdersForDate(day, zone?.id, ORDER_PAID_STATES as readonly PrismaOrderStatus[]),
    ]);
    return buildDaySummary({ date, zoneSlug: zone?.slug ?? null, now, cycles, deliveryDates, standaloneOrders });
  }

  /**
   * Toplu durum ilerletme. Sıra: (1) girdi doğrulama, (2) ön kontrol (cycle + sipariş), (3) hep-ya-hiç kapısı,
   * (4) uygulama. Cycle geçişi kendi siparişini de ilerletir; aynı siparişi ayrıca `orderIds` ile göndermek
   * gerekmez (gönderilirse ön kontrolde "zaten bu durumda" diye elenir).
   */
  async bulkStatus(input: BulkStatusInput, opts: { actor: string; actorId?: string | null }, now: Date = new Date()): Promise<OpsBulkStatusResult> {
    const cycleIds = dedupe(input.cycleIds);
    const orderIds = dedupe(input.orderIds);
    const requested = cycleIds.length + orderIds.length;
    if (requested === 0) throw new BadRequestException({ message: 'En az bir cycle ya da sipariş seçilmeli', error: 'OPS_BULK_EMPTY' });
    if (requested > OPS_BULK_MAX_ITEMS) {
      throw new BadRequestException({ message: 'Tek seferde en çok ' + OPS_BULK_MAX_ITEMS + ' satır ilerletilebilir', error: 'OPS_BULK_TOO_MANY' });
    }
    const status = input.status;
    if (cycleIds.length > 0 && !CYCLE_BULK_STATUSES.includes(status)) {
      throw conflict(SUB_ERRORS.CYCLE_TRANSITION_INVALID, 'Cycle "' + status + '" durumuna alınamaz (bu durum yalnız siparişlerde vardır)');
    }

    // ── (2) ön kontrol
    const checks: OpsBulkStatusItemResult[] = [];
    for (const id of cycleIds) checks.push(await this.checkCycle(id, status as CycleStatus));
    for (const check of await this.orders.checkBulkTransition(orderIds, status as OrderStatus)) {
      checks.push({
        kind: 'order',
        id: check.id,
        ok: check.ok,
        from: check.from,
        to: status,
        orderNo: check.orderNo,
        ...(check.ok ? {} : { error: check.error, message: check.message }),
      });
    }

    // ── (3) hep-ya-hiç
    const invalid = checks.filter((c) => !c.ok);
    if (invalid.length > 0 && !input.skipInvalid) {
      throw new ConflictException({
        message: invalid.length + ' satırın durumu bu geçişe uygun değil (hiçbiri uygulanmadı)',
        error: OPS_BULK_ERROR,
        items: invalid,
      });
    }

    // ── (4) uygulama
    const items: OpsBulkStatusItemResult[] = [...invalid];
    const okCycles = checks.filter((c) => c.ok && c.kind === 'cycle');
    const okOrderIds = checks.filter((c) => c.ok && c.kind === 'order').map((c) => c.id);

    for (const check of okCycles) {
      try {
        const cycle = await this.cycles.adminSetStatus(check.id, status as CycleStatus, { note: input.note, actor: opts.actor }, now);
        items.push({ kind: 'cycle', id: check.id, ok: true, from: check.from, to: status, orderNo: check.orderNo ?? null });
        this.logger.log('Ops toplu durum: cycle#' + cycle.cycleNo + ' ' + check.from + ' → ' + status + ' (' + opts.actor + ')');
      } catch (err) {
        items.push({ kind: 'cycle', id: check.id, ok: false, from: check.from, to: status, ...envelope(err) });
      }
    }
    const orderActor = opts.actor === ACTOR.OPS ? 'OPS' : 'ADMIN';
    for (const res of await this.orders.applyBulkTransition(okOrderIds, status as OrderStatus, { actor: orderActor, actorId: opts.actorId ?? null, reason: input.note ?? null, now })) {
      items.push({ kind: 'order', id: res.id, ok: res.ok, from: res.from, to: status, orderNo: res.orderNo, ...(res.ok ? {} : { error: res.error, message: res.message }) });
    }

    const updated = items.filter((i) => i.ok).length;
    return { status, requested, updated, failed: items.length - updated - invalid.length, skipped: invalid.length, items };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private async checkCycle(id: string, to: CycleStatus): Promise<OpsBulkStatusItemResult> {
    const cycle = await this.repo.findCycleById(id);
    if (!cycle) return { kind: 'cycle', id, ok: false, from: null, to, error: 'CYCLE_NOT_FOUND', message: 'Cycle bulunamadı' };
    const from = cycle.status as CycleStatus;
    if (from === to) return { kind: 'cycle', id, ok: false, from, to, error: 'CYCLE_ALREADY_IN_STATUS', message: 'Cycle zaten ' + to };
    if (!canCycleTransition(from, to)) {
      return { kind: 'cycle', id, ok: false, from, to, error: SUB_ERRORS.CYCLE_TRANSITION_INVALID, message: 'Cycle ' + from + ' → ' + to + ' geçişi geçersiz' };
    }
    return { kind: 'cycle', id, ok: true, from, to, orderNo: cycle.order?.orderNo ?? null };
  }

  private async resolveZone(slug?: string): Promise<{ id: string; slug: string } | null> {
    if (!slug) return null;
    const zone = await this.repo.findZoneBySlug(slug);
    if (!zone) throw new NotFoundException('Bölge bulunamadı: ' + slug);
    return { id: zone.id, slug: zone.slug };
  }
}

function dedupe(ids?: string[]): string[] {
  return ids ? [...new Set(ids)] : [];
}

/** Nest hata gövdesinden `{error, message}` (AllExceptionsFilter zarfıyla aynı alanlar). */
function envelope(err: unknown): { error: string; message: string } {
  if (err instanceof ConflictException || err instanceof NotFoundException || err instanceof BadRequestException) {
    const body = err.getResponse();
    if (body && typeof body === 'object') {
      const e = body as { error?: string; message?: string };
      return { error: e.error ?? 'OPS_BULK_ITEM_FAILED', message: e.message ?? err.message };
    }
  }
  return { error: 'OPS_BULK_ITEM_FAILED', message: err instanceof Error ? err.message : String(err) };
}
