import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDateIn,
  computeCutoffAt,
  CYCLE_FULFILLABLE_STATES,
  CYCLE_IN_FLIGHT_STATES,
  cycleMachine,
  DEFAULT_TZ,
  isoDateToUtc,
  roundMoney,
  SUBSCRIPTION_ENGINE_ACTIVE_STATES,
  subscriptionMachine,
  utcToIsoDate,
  type AdminCycleListItem,
  type CommerceSettings,
  type CycleChargeQuote,
  type CycleStatus,
  type DeliveryDay,
  type IsoDate,
  type Money,
  type PackingListEntry,
  type PickListRow,
  type SubscriptionCycle,
  type SubscriptionStatus,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import { SubscriptionNotifier } from '../subscription-notifier';
import {
  ACTOR,
  CANCEL_REFUND_DAYS,
  CUTOFF_REMINDER_HOURS_BEFORE,
  CUTOFF_REMINDER_WINDOW_MS,
  DAY_MS,
  deliveryDateInWeek,
  dunningDeadlineFor,
  endOfDeliveryDay,
  ENSURE_MAX_CYCLES_PER_RUN,
  ENSURE_PAGE_SIZE,
  HOUR_MS,
  LOCK_BATCH_SIZE,
  LOCK_MAX_ROUNDS,
  weekStartOf,
} from '../subscriptions.constants';
import { SUBSCRIPTIONS_DEPS, type OrderRef, type SubscriptionsDeps, type Tx } from '../subscriptions.deps';
import { assertOr409, conflict, isDayFullError, SUB_ERRORS } from '../subscriptions.errors';
import {
  buildPackingList,
  buildPickList,
  isExtraItem,
  money,
  toAdminCycleListItem,
  toCycleDto,
  toDecimal,
  toQtyDecimal,
} from '../subscriptions.mapper';
import {
  SubscriptionsRepository,
  type CycleRecord,
  type CycleWithSubRecord,
  type ProductRecord,
  type SubscriptionRecord,
  type TemplateRecord,
} from '../subscriptions.repository';

// ── Job sonuç tipleri ─────────────────────────────────────────────────────────

export interface EnsureResult {
  itemsProcessed: number;
  subscriptions: number;
  created: number;
  skippedNoTemplate: number;
  skippedClosed: number;
  skippedFull: number;
  errors: number;
}

export interface LockAndChargeResult {
  itemsProcessed: number;
  locked: number;
  charged: number;
  chargedZero: number;
  delta: number;
  awaiting: number;
  unpaid: number;
  skippedUnpaid: number;
  cancelled: number;
  errors: number;
}

export interface RetryResult {
  itemsProcessed: number;
  charged: number;
  failed: number;
  linksIssued: number;
  skippedUnpaid: number;
  errors: number;
}

export interface ExpireLinksResult {
  itemsProcessed: number;
  expired: number;
  paymentsExpired: number;
  errors: number;
}

export interface RemindResult {
  itemsProcessed: number;
  errors: number;
  /** F10: hatırlatma e-postası gönderilen (ya da zaten gönderilmiş sayılan) cycle sayısı. */
  sent: number;
}

export interface CancelSubscriptionOpts {
  actor: string;
  reason?: string;
  requestedAt: Date;
}

export interface CancelSubscriptionResult {
  effectiveAt: Date;
  refundAmount: Money;
  refundDueAt: Date | null;
  cancelledCycles: number;
}

interface LockedCycle {
  cycleId: string;
  isDelta: boolean;
  due: Money;
}

type PhaseAOutcome = { kind: 'skipped' } | { kind: 'cancelled' } | { kind: 'charged0' } | ({ kind: 'locked' } & LockedCycle);

/**
 * CyclesService — abonelik motorunun cycle tarafı (docs/state-machines.md §7–§9, §11 yan etkileri):
 *  - `ensure(now)`            saatlik: frekans/gün → ufuk içi teslimat günleri → yayınlanmış şablon → DD rezerv → cycle + item
 *  - `lockAndCharge(now)`     5 dk: kesimi geçmiş SCHEDULED → snapshot/LOCKED → Order (cycle#1: DELTA) → strateji (MIT / LINK)
 *  - `retryPayments(now)`     15 dk: dunning (retryHours, teslimat günü 08:00 sınırı) → CHARGED | SKIPPED(UNPAID) → PAST_DUE
 *  - `expirePaymentLinks(now)` 10 dk: AWAITING_PAYMENT süresi dolan → UNPAID (+ dunning)
 *  - `remindCutoffs(now)`     saatlik: kesimden ~24 s önce bildirim (stub)
 *  - admin/ops: durum ilerletme, elle tahsilat, ödeme linki, telafi; ops pick/packing listeleri
 *  - `cancelSubscription`     iptal yan etkileri (§11): SCHEDULED → CANCELLED + DD iade, cycle#1 peşin iade, abonelik CANCELLED
 * İşlem sınırı: satır kilitleri (FOR UPDATE SKIP LOCKED) kısa işlemlerde; sağlayıcı çağrısı (chargeStoredCard) işlem DIŞINDA,
 * sonuç ayrı işlemde uygulanır (`Payment.conversationId` idempotent). `now` her zaman parametre (ADR-0004).
 */
@Injectable()
export class CyclesService {
  private readonly logger = new Logger(CyclesService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly settings: SettingsService,
    private readonly notifier: SubscriptionNotifier,
    @Inject(SUBSCRIPTIONS_DEPS) private readonly deps: SubscriptionsDeps,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // cycles:ensure
  // ═══════════════════════════════════════════════════════════════════════════

  async ensure(now: Date, opts: { subscriptionId?: string } = {}): Promise<EnsureResult> {
    const result: EnsureResult = { itemsProcessed: 0, subscriptions: 0, created: 0, skippedNoTemplate: 0, skippedClosed: 0, skippedFull: 0, errors: 0 };
    const commerce = await this.settings.getCommerce();
    let afterId: string | undefined;
    for (;;) {
      const page = await this.repo.listEngineSubscriptions(SUBSCRIPTION_ENGINE_ACTIVE_STATES, { afterId, take: ENSURE_PAGE_SIZE, subscriptionId: opts.subscriptionId });
      if (page.length === 0) break;
      for (const sub of page) {
        result.subscriptions++;
        try {
          const r = await this.repo.transaction((tx) => this.ensureSubscriptionInTx(sub.id, now, commerce, tx));
          result.created += r.created;
          result.skippedNoTemplate += r.skippedNoTemplate;
          result.skippedClosed += r.skippedClosed;
          result.skippedFull += r.skippedFull;
          result.itemsProcessed += r.created;
        } catch (err) {
          result.errors++;
          this.logger.error(`cycles:ensure abonelik ${sub.id}: ${(err as Error).message}`);
        }
      }
      afterId = page[page.length - 1]!.id;
      if (page.length < ENSURE_PAGE_SIZE || opts.subscriptionId) break;
    }
    return result;
  }

  /**
   * Tek aboneliğin cycle'larını tamamlar (çağıranın işlemi içinde; satır kilidi alınır). state-machines §7 adımları:
   * hedef hafta = son cycle'ın haftası + frekans; kesimi geçmişse frekans kadar ileri; ufuk dışına çıkınca dur;
   * DD yoksa oluştur; kapalıysa dur; şablon yoksa uyarı + dur; dolu ise uyarı + dur; cycle + TEMPLATE öğeleri.
   */
  async ensureSubscriptionInTx(
    subscriptionId: string,
    now: Date,
    commerce: CommerceSettings,
    tx: Tx,
  ): Promise<Pick<EnsureResult, 'created' | 'skippedNoTemplate' | 'skippedClosed' | 'skippedFull'>> {
    const out = { created: 0, skippedNoTemplate: 0, skippedClosed: 0, skippedFull: 0 };
    await this.repo.lockSubscription(subscriptionId, tx);
    const sub = await this.repo.findSubscriptionById(subscriptionId, tx);
    if (!sub || sub.isOneTime || !(SUBSCRIPTION_ENGINE_ACTIVE_STATES as readonly string[]).includes(sub.status)) return out;
    let last = await this.repo.findLastCycle(sub.id, tx);
    if (!last) {
      this.logger.warn(`cycles:ensure ${sub.id}: cycle#1 yok — checkout oluşturmalı; atlandı`);
      return out;
    }
    const horizonEnd = addCalendarDays(calendarDateIn(now, DEFAULT_TZ), commerce.deliveryDatesHorizonWeeks * 7);
    const day = sub.deliveryDay as DeliveryDay;
    for (let i = 0; i < ENSURE_MAX_CYCLES_PER_RUN; i++) {
      let weekStart = addCalendarDays(weekStartOf(utcToIsoDate(last.deliveryDate.date)), sub.frequencyWeeks * 7);
      let target = deliveryDateInWeek(weekStart, day);
      // Koruma: gecikmiş üretim — kesimi geçmiş hedefleri frekans kadar ileri al
      let guard = 0;
      while (computeCutoffAt(target, commerce.cutoff).getTime() <= now.getTime() && guard < 260) {
        weekStart = addCalendarDays(weekStart, sub.frequencyWeeks * 7);
        target = deliveryDateInWeek(weekStart, day);
        guard++;
      }
      if (target > horizonEnd) break;
      const dd = await this.deps.deliveryDates.findOrCreateFor(sub.zoneId, target, tx);
      if (dd.status !== 'OPEN') {
        out.skippedClosed++;
        break;
      }
      const tpl = await this.repo.findPublishedTemplate(sub.tierId, isoDateToUtc(weekStart), tx);
      if (!tpl) {
        out.skippedNoTemplate++;
        await this.repo.upsertSystemWarning(
          {
            module: 'subscriptions',
            action: 'cycles:ensure',
            message: `Haftanın kutusu eksik: ${sub.tier.slug} / ${weekStart} — yayınlanmış şablon yok, cycle üretilmedi`,
            fingerprint: `ensure:no-template:${sub.tierId}:${weekStart}`,
            metadata: { tierId: sub.tierId, tierSlug: sub.tier.slug, weekStart },
            now,
          },
          tx,
        );
        break;
      }
      try {
        await this.deps.deliveryDates.reserve(dd.id, tx);
      } catch (err) {
        if (!isDayFullError(err)) throw err;
        out.skippedFull++;
        await this.repo.upsertSystemWarning(
          {
            module: 'subscriptions',
            action: 'cycles:ensure',
            message: `Teslimat günü dolu: ${sub.zone.slug} ${target} — abonelik ${sub.id} için cycle üretilmedi`,
            fingerprint: `ensure:day-full:${dd.id}`,
            metadata: { deliveryDateId: dd.id, zoneId: sub.zoneId, date: target },
            now,
          },
          tx,
        );
        break;
      }
      let created: CycleRecord;
      try {
        created = await this.repo.createCycle(
          { subscriptionId: sub.id, cycleNo: last.cycleNo + 1, deliveryDateId: dd.id, status: 'SCHEDULED', prepaidAmount: toDecimal(0) },
          tx,
        );
      } catch (err) {
        // unique (subscriptionId, cycleNo): yarışta ikinci ekleme → rezervi geri ver, yok say
        await this.deps.deliveryDates.release(dd.id, tx);
        if ((err as { code?: string }).code === 'P2002') break;
        throw err;
      }
      await this.repo.createCycleItems(this.templateItems(created.id, tpl, (sub.itemPrefs as Record<string, string> | null) ?? {}), tx);
      last = (await this.repo.findLastCycle(sub.id, tx)) ?? created;
      out.created++;
    }
    await this.refreshNextDelivery(sub.id, tx);
    return out;
  }

  /** Şablon öğeleri → CycleItem (TEMPLATE; pref = itemPrefs[slug] ?? prefOptions[prefDefault]; lot = güncel lot). */
  templateItems(cycleId: string, tpl: TemplateRecord, itemPrefs: Record<string, string>): Prisma.CycleItemUncheckedCreateInput[] {
    return tpl.items
      .filter((ti) => ti.product.deletedAt === null)
      .map((ti, idx) => this.boxItemInput(cycleId, ti.product, 'TEMPLATE', idx, itemPrefs, ti.qtyLabel));
  }

  boxItemInput(
    cycleId: string,
    product: ProductRecord,
    source: 'TEMPLATE' | 'SWAP',
    sortOrder: number,
    itemPrefs: Record<string, string>,
    label?: string | null,
    swapOfProductId?: string | null,
  ): Prisma.CycleItemUncheckedCreateInput {
    return {
      cycleId,
      source,
      productId: product.id,
      lotId: product.lots[0]?.id ?? null,
      lotCode: product.lots[0]?.lotCode ?? null,
      swapOfProductId: swapOfProductId ?? null,
      pref: this.defaultPref(product, itemPrefs),
      qty: toQtyDecimal(1),
      unit: product.unit,
      label: label ?? product.boxAmount ?? null,
      sortOrder,
    };
  }

  defaultPref(product: ProductRecord, itemPrefs: Record<string, string>): string | null {
    const fromPrefs = itemPrefs[product.slug];
    if (fromPrefs && product.prefOptions.includes(fromPrefs)) return fromPrefs;
    if (product.prefDefault !== null && product.prefOptions[product.prefDefault] !== undefined) return product.prefOptions[product.prefDefault]!;
    return null;
  }

  /** Subscription.nextDeliveryOn/nextCutoffAt = teslim edilmemiş, atlanmamış en erken cycle. */
  async refreshNextDelivery(subscriptionId: string, tx?: Tx): Promise<void> {
    const cycles = await this.repo.findCyclesOfSubscription(subscriptionId, tx);
    const next = cycles.find((c) => c.status === 'SCHEDULED' || (CYCLE_IN_FLIGHT_STATES as readonly string[]).includes(c.status)) ?? null;
    await this.repo.updateSubscription(
      subscriptionId,
      { nextDeliveryOn: next ? next.deliveryDate.date : null, nextCutoffAt: next ? next.deliveryDate.cutoffAt : null },
      tx,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // cycles:lock-and-charge
  // ═══════════════════════════════════════════════════════════════════════════

  async lockAndCharge(now: Date): Promise<LockAndChargeResult> {
    const result: LockAndChargeResult = { itemsProcessed: 0, locked: 0, charged: 0, chargedZero: 0, delta: 0, awaiting: 0, unpaid: 0, skippedUnpaid: 0, cancelled: 0, errors: 0 };
    for (let round = 0; round < LOCK_MAX_ROUNDS; round++) {
      const ids = await this.repo.selectDueCycleIds(now, LOCK_BATCH_SIZE);
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        try {
          const outcome = await this.repo.transaction((tx) => this.lockPhaseA(id, now, tx));
          if (outcome.kind === 'skipped') continue;
          progressed++;
          result.itemsProcessed++;
          if (outcome.kind === 'cancelled') {
            result.cancelled++;
            continue;
          }
          if (outcome.kind === 'charged0') {
            result.locked++;
            result.chargedZero++;
            result.charged++;
            continue;
          }
          result.locked++;
          if (outcome.isDelta) result.delta++;
          const charge = await this.chargeLocked(outcome, now, ACTOR.SYSTEM);
          if (charge === 'charged') result.charged++;
          else if (charge === 'awaiting') result.awaiting++;
          else if (charge === 'unpaid') result.unpaid++;
          else if (charge === 'skipped-unpaid') result.skippedUnpaid++;
        } catch (err) {
          result.errors++;
          this.logger.error(`cycles:lock-and-charge cycle ${id}: ${(err as Error).message}`, (err as Error).stack);
        }
      }
      if (progressed === 0 || ids.length < LOCK_BATCH_SIZE) break;
    }
    // Çökme sonrası LOCKED kalmış (tahsilata geçememiş) cycle'lar: 15 dk'dan eski
    const stranded = await this.repo.selectStrandedLockedCycleIds(new Date(now.getTime() - 15 * 60 * 1000), LOCK_BATCH_SIZE);
    for (const id of stranded) {
      try {
        const cycle = await this.repo.findCycleById(id);
        if (!cycle || cycle.status !== 'LOCKED') continue;
        const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
        const orderRef = isDelta ? cycle.deltaOrder : cycle.order;
        if (!orderRef) continue;
        const payments = await this.repo.findPaymentsOfOrder(orderRef.id);
        if (payments.length > 0) continue; // tahsilat denenmiş; admin/retry akışı
        result.itemsProcessed++;
        const charge = await this.chargeLocked({ cycleId: id, isDelta, due: money(orderRef.grandTotal) }, now, ACTOR.SYSTEM);
        if (charge === 'charged') result.charged++;
        else if (charge === 'awaiting') result.awaiting++;
        else if (charge === 'unpaid') result.unpaid++;
        else if (charge === 'skipped-unpaid') result.skippedUnpaid++;
      } catch (err) {
        result.errors++;
        this.logger.error(`cycles:lock-and-charge (stranded) cycle ${id}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  /** Aşama A (tek işlem): kilit → abonelik durumu → snapshot → LOCKED → due ≤ 0 ise CHARGED; değilse Order (cycle#1: DELTA). */
  private async lockPhaseA(cycleId: string, now: Date, tx: Tx): Promise<PhaseAOutcome> {
    if (!(await this.repo.lockCycle(cycleId, 'SCHEDULED', tx))) return { kind: 'skipped' };
    const cycle = await this.repo.findCycleById(cycleId, tx);
    if (!cycle || cycle.status !== 'SCHEDULED') return { kind: 'skipped' };
    await this.repo.lockSubscription(cycle.subscriptionId, tx);
    const sub = cycle.subscription;

    if (!(SUBSCRIPTION_ENGINE_ACTIVE_STATES as readonly string[]).includes(sub.status)) {
      assertOr409(cycleMachine, 'SCHEDULED', 'CANCELLED');
      await this.repo.updateCycle(cycle.id, { status: 'CANCELLED' }, tx);
      await this.deps.deliveryDates.release(cycle.deliveryDateId, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'CANCELLED', actor: ACTOR.SYSTEM, data: { reason: 'subscription_inactive', subscriptionStatus: sub.status }, at: now }, tx);
      await this.refreshNextDelivery(sub.id, tx);
      return { kind: 'cancelled' };
    }

    const quote = await this.deps.pricing.cycleCharge({ subscription: sub, cycle, now }, tx);
    // Öğe snapshot'ı: unitPrice (ekstralar kendi snapshot'ını korur; kutu öğeleri bilgi amaçlı ürün fiyatı) + lotCode
    for (const item of cycle.items) {
      const unitPrice = item.unitPrice !== null ? money(item.unitPrice) : money(item.product.price);
      const lotCode = item.lotCode ?? item.lot?.lotCode ?? item.product.lots[0]?.lotCode ?? null;
      await this.repo.updateCycleItem(item.id, { unitPrice: toDecimal(unitPrice), lotCode }, tx);
    }
    assertOr409(cycleMachine, 'SCHEDULED', 'LOCKED');
    const locked = await this.repo.updateCycle(
      cycle.id,
      {
        status: 'LOCKED',
        lockedAt: now,
        boxPrice: toDecimal(quote.boxPrice),
        extrasTotal: toDecimal(quote.extrasTotal),
        discount: toDecimal(quote.discount),
        shippingFee: toDecimal(quote.shippingFee),
        total: toDecimal(quote.total),
      },
      tx,
    );
    await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'LOCKED', actor: ACTOR.SYSTEM, data: this.quoteData(quote), at: now }, tx);

    if (quote.due <= 0) {
      await this.markCharged(cycle.id, { isDelta: cycle.cycleNo === 1, amount: 0, paymentId: null, attemptNo: 0, actor: ACTOR.SYSTEM, event: 'CHARGED' }, now, tx);
      return { kind: 'charged0' };
    }

    const ctx = { subscription: sub, cycle: locked, quote, now };
    if (cycle.cycleNo === 1 && cycle.orderId) {
      const delta = await this.deps.orders.createDeltaForCycle(ctx, tx);
      await this.repo.updateCycle(cycle.id, { deltaOrderId: delta.id }, tx);
      return { kind: 'locked', cycleId: cycle.id, isDelta: true, due: quote.due };
    }
    const order = await this.deps.orders.createForCycle(ctx, tx);
    await this.repo.updateCycle(cycle.id, { orderId: order.id }, tx);
    return { kind: 'locked', cycleId: cycle.id, isDelta: false, due: quote.due };
  }

  private quoteData(q: CycleChargeQuote): Record<string, unknown> {
    return { boxPrice: q.boxPrice, extrasTotal: q.extrasTotal, discount: q.discount, discountKind: q.discountKind, shippingFee: q.shippingFee, total: q.total, due: q.due };
  }

  /** Aşama B/C: strateji → tahsilat (işlem dışı) → sonuç (işlemde). */
  private async chargeLocked(locked: LockedCycle, now: Date, actor: string): Promise<'charged' | 'awaiting' | 'unpaid' | 'skipped-unpaid' | 'noop'> {
    const cycle = await this.repo.findCycleById(locked.cycleId);
    if (!cycle || cycle.status !== 'LOCKED') return 'noop';
    const sub = cycle.subscription;
    const orderRef = this.orderRefOf(cycle, locked.isDelta);
    if (!orderRef) return 'noop';
    let strategy = sub.chargeStrategy;
    const pm = sub.paymentMethod && sub.paymentMethod.isActive && sub.paymentMethod.deletedAt === null ? sub.paymentMethod : null;
    if (strategy === 'MERCHANT_INITIATED' && !pm) {
      // state-machines §14 #10: saklı kart yoksa PAYMENT_LINK'e düş + not
      strategy = 'PAYMENT_LINK';
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'ADMIN_NOTE', actor: ACTOR.SYSTEM, data: { note: 'Saklı kart yok — PAYMENT_LINK stratejisine düşüldü' }, at: now });
    }
    if (strategy === 'MERCHANT_INITIATED' && pm) {
      const outcome = await this.deps.charge.chargeStoredCard({ cycle, order: orderRef, paymentMethod: pm, amount: locked.due, kind: locked.isDelta ? 'DELTA' : 'CYCLE_CHARGE', attemptNo: 1, now });
      if (outcome.status === 'SUCCEEDED') {
        await this.repo.transaction((tx) => this.markCharged(cycle.id, { isDelta: locked.isDelta, amount: locked.due, paymentId: outcome.paymentId, attemptNo: 1, actor, event: locked.isDelta ? 'DELTA_CHARGED' : 'CHARGED' }, now, tx));
        return 'charged';
      }
      const r = await this.repo.transaction((tx) => this.markFailed(cycle.id, { isDelta: locked.isDelta, paymentId: outcome.paymentId, failure: outcome.failureMessage ?? outcome.failureCode ?? null, actor }, now, tx));
      return r;
    }
    const issued = await this.deps.charge.issuePaymentLink({ cycle, order: orderRef, amount: locked.due, attemptNo: 1, now });
    await this.repo.transaction(async (tx) => {
      assertOr409(cycleMachine, 'LOCKED', 'AWAITING_PAYMENT');
      await this.repo.updateCycle(cycle.id, { status: 'AWAITING_PAYMENT', paymentDueAt: issued.linkExpiresAt }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'AWAITING_PAYMENT', actor, data: { paymentId: issued.paymentId, linkExpiresAt: issued.linkExpiresAt.toISOString(), amount: locked.due, delta: locked.isDelta }, at: now }, tx);
    });
    this.notifier.emit('cycle.awaiting-payment', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { amount: locked.due, linkToken: issued.linkToken, linkExpiresAt: issued.linkExpiresAt.toISOString() } }, now);
    return 'awaiting';
  }

  private orderRefOf(cycle: CycleRecord, isDelta: boolean): OrderRef | null {
    const o = isDelta ? cycle.deltaOrder : cycle.order;
    return o ? { id: o.id, orderNo: o.orderNo, status: o.status, grandTotal: money(o.grandTotal) } : null;
  }

  /**
   * Başarılı tahsilat (ya da tutar 0 / elle ödendi): cycle → CHARGED, Order → PAID, failedCycles=0, indirim sayaçları
   * (cycle#n; cycle#1'de checkout/activate düştü), PAST_DUE → ACTIVE; SE CHARGED|DELTA_CHARGED|RETRY.
   */
  private async markCharged(
    cycleId: string,
    opts: { isDelta: boolean; amount: Money; paymentId: string | null; attemptNo: number; actor: string; event: 'CHARGED' | 'DELTA_CHARGED' },
    now: Date,
    tx: Tx,
  ): Promise<void> {
    const cycle = await this.repo.findCycleById(cycleId, tx);
    if (!cycle) return;
    const sub = cycle.subscription;
    assertOr409(cycleMachine, cycle.status as CycleStatus, 'CHARGED');
    await this.repo.updateCycle(cycle.id, { status: 'CHARGED', nextRetryAt: null, paymentDueAt: null }, tx);
    const orderRef = this.orderRefOf(cycle, opts.isDelta);
    if (orderRef && opts.amount > 0) await this.payOrder(orderRef, opts.actor, now, tx);
    const subData: Prisma.SubscriptionUncheckedUpdateInput = { failedCycles: 0 };
    if (!opts.isDelta && cycle.cycleNo > 1 && cycle.discount !== null && money(cycle.discount) > 0) {
      if (sub.discountBoxesLeft > 0) subData.discountBoxesLeft = sub.discountBoxesLeft - 1;
      else if (sub.nextBoxDiscountPct !== null) subData.nextBoxDiscountPct = null;
    }
    if (sub.status === 'PAST_DUE') {
      assertOr409(subscriptionMachine, 'PAST_DUE', 'ACTIVE');
      subData.status = 'ACTIVE';
    }
    await this.repo.updateSubscription(sub.id, subData, tx);
    await this.repo.addEvent(
      { subscriptionId: sub.id, cycleId: cycle.id, type: opts.event, actor: opts.actor, data: { amount: opts.amount, paymentId: opts.paymentId, attemptNo: opts.attemptNo, pastDueRecovered: sub.status === 'PAST_DUE' }, at: now },
      tx,
    );
    await this.refreshNextDelivery(sub.id, tx);
    if (opts.amount > 0) this.notifier.emit('cycle.charged', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { amount: opts.amount, delta: opts.isDelta } }, now);
  }

  /** Order → PAID (PAYMENT_FAILED ise önce PENDING_PAYMENT: yeni ödeme denemesi). */
  private async payOrder(order: OrderRef, actor: string, now: Date, tx: Tx): Promise<void> {
    const current = (await this.repo.findOrderById(order.id, tx))?.status ?? order.status;
    if (current === 'PAID') return;
    if (current === 'PAYMENT_FAILED') await this.deps.orders.transition(order.id, 'PENDING_PAYMENT', { actor, now }, tx);
    await this.deps.orders.transition(order.id, 'PAID', { actor, now }, tx);
  }

  /**
   * Başarısız tahsilat: cycle#1 DELTA → kural #18 (ekstralar düşer, cycle CHARGED, delta Order CANCELLED);
   * cycle#n → Order PAYMENT_FAILED, cycle UNPAID (SE PAYMENT_FAILED) ve dunning takvimi (ya da hemen SKIPPED(UNPAID)).
   */
  private async markFailed(
    cycleId: string,
    opts: { isDelta: boolean; paymentId: string | null; failure: string | null; actor: string; expired?: boolean },
    now: Date,
    tx: Tx,
  ): Promise<'unpaid' | 'skipped-unpaid' | 'charged' | 'noop'> {
    const cycle = await this.repo.findCycleById(cycleId, tx);
    if (!cycle) return 'noop';
    const sub = cycle.subscription;
    if (opts.isDelta) {
      const delta = cycle.deltaOrder;
      if (delta) {
        const st = (await this.repo.findOrderById(delta.id, tx))?.status ?? delta.status;
        if (st === 'PENDING_PAYMENT') await this.deps.orders.transition(delta.id, 'PAYMENT_FAILED', { actor: opts.actor, now }, tx);
        await this.deps.orders.transition(delta.id, 'CANCELLED', { actor: opts.actor, reason: 'DELTA tahsil edilemedi (kural #18)', now }, tx);
      }
      const extras = cycle.items.filter(isExtraItem);
      await this.repo.deleteCycleItems({ cycleId: cycle.id, source: { in: ['EXTRA', 'CART_MERGE'] } }, tx);
      const extrasTotal = cycle.extrasTotal ? money(cycle.extrasTotal) : 0;
      const total = cycle.total ? roundMoney(money(cycle.total) - extrasTotal) : null;
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'PAYMENT_FAILED', actor: opts.actor, data: { delta: true, paymentId: opts.paymentId, failure: opts.failure, expired: opts.expired ?? false }, at: now }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'EXTRA_REMOVED', actor: ACTOR.SYSTEM, data: { reason: 'delta_unpaid', items: extras.map((e) => ({ slug: e.product.slug, qty: Number(e.qty.toString()), source: e.source })) }, at: now }, tx);
      assertOr409(cycleMachine, cycle.status as CycleStatus, 'CHARGED');
      await this.repo.updateCycle(cycle.id, { status: 'CHARGED', extrasTotal: toDecimal(0), total: total !== null ? toDecimal(total) : null, nextRetryAt: null, paymentDueAt: null }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'CHARGED', actor: ACTOR.SYSTEM, data: { amount: 0, deltaFailed: true }, at: now }, tx);
      await this.refreshNextDelivery(sub.id, tx);
      this.notifier.emit('cycle.payment-failed', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { delta: true, extrasRemoved: true } }, now);
      return 'charged';
    }
    const orderRef = this.orderRefOf(cycle, false);
    if (orderRef) {
      const st = (await this.repo.findOrderById(orderRef.id, tx))?.status ?? orderRef.status;
      if (st === 'PENDING_PAYMENT') await this.deps.orders.transition(orderRef.id, 'PAYMENT_FAILED', { actor: opts.actor, now }, tx);
    }
    if (cycle.status !== 'UNPAID') {
      assertOr409(cycleMachine, cycle.status as CycleStatus, 'UNPAID');
      await this.repo.updateCycle(cycle.id, { status: 'UNPAID', paymentDueAt: null }, tx);
    }
    await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'PAYMENT_FAILED', actor: opts.actor, data: { paymentId: opts.paymentId, failure: opts.failure, expired: opts.expired ?? false, retryCount: cycle.retryCount }, at: now }, tx);
    this.notifier.emit('cycle.payment-failed', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { failure: opts.failure, expired: opts.expired ?? false } }, now);
    return this.scheduleRetryOrSkip(cycle.id, now, tx);
  }

  /**
   * Dunning takvimi (§9 + §14 #1 KARAR): sıradaki deneme = lockedAt + retryHours[retryCount]; teslimat günü 08:00'i
   * aşıyorsa ya da deneme kalmadıysa → SKIPPED(UNPAID): Order CANCELLED, DD iade, failedCycles++ → eşikte PAST_DUE.
   */
  private async scheduleRetryOrSkip(cycleId: string, now: Date, tx: Tx): Promise<'unpaid' | 'skipped-unpaid'> {
    const cycle = await this.repo.findCycleById(cycleId, tx);
    if (!cycle || cycle.status !== 'UNPAID') return 'unpaid';
    const commerce = await this.settings.getCommerce();
    const retryHours = commerce.dunning.retryHours;
    const lockedAt = cycle.lockedAt ?? now;
    const deadline = dunningDeadlineFor(utcToIsoDate(cycle.deliveryDate.date));
    const idx = cycle.retryCount;
    if (idx < retryHours.length) {
      const candidate = new Date(lockedAt.getTime() + (retryHours[idx] ?? 0) * HOUR_MS);
      if (candidate.getTime() <= deadline.getTime()) {
        const nextRetryAt = candidate.getTime() < now.getTime() ? now : candidate;
        await this.repo.updateCycle(cycle.id, { nextRetryAt }, tx);
        return 'unpaid';
      }
    }
    await this.markUnpaidSkipped(cycle, now, tx, idx >= retryHours.length ? 'retries_exhausted' : 'retry_after_deadline');
    return 'skipped-unpaid';
  }

  private async markUnpaidSkipped(cycle: CycleWithSubRecord, now: Date, tx: Tx, reason: string): Promise<void> {
    const sub = cycle.subscription;
    assertOr409(cycleMachine, cycle.status as CycleStatus, 'SKIPPED');
    await this.repo.updateCycle(cycle.id, { status: 'SKIPPED', skipSource: 'UNPAID', skippedAt: now, nextRetryAt: null, paymentDueAt: null }, tx);
    const orderRef = this.orderRefOf(cycle, false);
    if (orderRef) {
      for (const p of await this.repo.findOpenLinkPayments(orderRef.id, tx)) await this.deps.charge.expirePaymentLink(p.id, now, tx);
      const st = (await this.repo.findOrderById(orderRef.id, tx))?.status ?? orderRef.status;
      if (st === 'PENDING_PAYMENT') await this.deps.orders.transition(orderRef.id, 'PAYMENT_FAILED', { actor: ACTOR.SYSTEM, now }, tx);
      if (st !== 'CANCELLED') await this.deps.orders.transition(orderRef.id, 'CANCELLED', { actor: ACTOR.SYSTEM, reason: 'Tahsil edilemedi — kutu atlandı', now }, tx);
    }
    await this.deps.deliveryDates.release(cycle.deliveryDateId, tx);
    const failedCycles = sub.failedCycles + 1;
    const commerce = await this.settings.getCommerce();
    const subData: Prisma.SubscriptionUncheckedUpdateInput = { failedCycles };
    let pastDue = false;
    if (failedCycles >= commerce.dunning.pastDueAfterUnpaid && sub.status === 'ACTIVE') {
      assertOr409(subscriptionMachine, 'ACTIVE', 'PAST_DUE');
      subData.status = 'PAST_DUE';
      pastDue = true;
    }
    await this.repo.updateSubscription(sub.id, subData, tx);
    await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'UNPAID', actor: ACTOR.SYSTEM, data: { reason, failedCycles, pastDue, retryCount: cycle.retryCount }, at: now }, tx);
    await this.refreshNextDelivery(sub.id, tx);
    // F10 bildirimi: abonelik askıya alındıysa müşteriye 'kart güncelle' e-postası (mail.subscription-past-due).
    if (pastDue) this.notifier.emit('subscription.past-due', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { failedCycles, reason } }, now);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // payments:retry (dunning)
  // ═══════════════════════════════════════════════════════════════════════════

  async retryPayments(now: Date): Promise<RetryResult> {
    const result: RetryResult = { itemsProcessed: 0, charged: 0, failed: 0, linksIssued: 0, skippedUnpaid: 0, errors: 0 };
    for (let round = 0; round < LOCK_MAX_ROUNDS; round++) {
      const ids = await this.repo.selectRetryCycleIds(now, LOCK_BATCH_SIZE);
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        try {
          const r = await this.retryCycle(id, now, ACTOR.SYSTEM);
          if (r === 'noop') continue;
          progressed++;
          result.itemsProcessed++;
          if (r === 'charged') result.charged++;
          else if (r === 'link') result.linksIssued++;
          else if (r === 'skipped-unpaid') result.skippedUnpaid++;
          else result.failed++;
        } catch (err) {
          result.errors++;
          this.logger.error(`payments:retry cycle ${id}: ${(err as Error).message}`);
        }
      }
      if (progressed === 0 || ids.length < LOCK_BATCH_SIZE) break;
    }
    return result;
  }

  /** Tek cycle için yeniden deneme (job ve admin `charge` aynı yolu kullanır). */
  private async retryCycle(cycleId: string, now: Date, actor: string, opts: { force?: boolean } = {}): Promise<'charged' | 'unpaid' | 'link' | 'skipped-unpaid' | 'noop'> {
    // Aşama A: kilit + RETRY olayı + deneme sayısı
    const prep = await this.repo.transaction(async (tx) => {
      if (!(await this.repo.lockCycle(cycleId, 'UNPAID', tx))) return null;
      const cycle = await this.repo.findCycleById(cycleId, tx);
      if (!cycle || cycle.status !== 'UNPAID') return null;
      if (!opts.force && (cycle.nextRetryAt === null || cycle.nextRetryAt.getTime() > now.getTime())) return null;
      const attemptNo = cycle.retryCount + 2;
      await this.repo.updateCycle(cycle.id, { retryCount: cycle.retryCount + 1, nextRetryAt: null }, tx);
      await this.repo.addEvent({ subscriptionId: cycle.subscriptionId, cycleId: cycle.id, type: 'RETRY', actor, data: { attemptNo, strategy: cycle.subscription.chargeStrategy }, at: now }, tx);
      return { cycle, attemptNo };
    });
    if (!prep) return 'noop';
    const { cycle, attemptNo } = prep;
    const sub = cycle.subscription;
    const orderRef = this.orderRefOf(cycle, false);
    if (!orderRef) return 'noop';
    const pm = sub.paymentMethod && sub.paymentMethod.isActive && sub.paymentMethod.deletedAt === null ? sub.paymentMethod : null;
    const amount = money(orderRef.grandTotal);
    if (sub.chargeStrategy === 'MERCHANT_INITIATED' && pm) {
      const outcome = await this.deps.charge.chargeStoredCard({ cycle, order: orderRef, paymentMethod: pm, amount, kind: 'RETRY', attemptNo, now });
      if (outcome.status === 'SUCCEEDED') {
        await this.repo.transaction((tx) => this.markCharged(cycle.id, { isDelta: false, amount, paymentId: outcome.paymentId, attemptNo, actor, event: 'CHARGED' }, now, tx));
        return 'charged';
      }
      const r = await this.repo.transaction(async (tx) => {
        await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'PAYMENT_FAILED', actor, data: { paymentId: outcome.paymentId, failure: outcome.failureMessage ?? outcome.failureCode ?? null, attemptNo }, at: now }, tx);
        return this.scheduleRetryOrSkip(cycle.id, now, tx);
      });
      return r;
    }
    // PAYMENT_LINK (ya da kart yok): §14 #1 — teslimat günü 08:00 sınırı geçtiyse yeni link yok → SKIPPED(UNPAID)
    // (Order CANCELLED, DD iade, failedCycles++ → eşikte PAST_DUE); aksi hâlde eski açık linkleri kapat, yeni link;
    // cycle UNPAID kalır, sıradaki an = min(link süresi, takvim, 08:00 sınırı)
    const linkDeadline = dunningDeadlineFor(utcToIsoDate(cycle.deliveryDate.date));
    if (now.getTime() >= linkDeadline.getTime()) {
      await this.repo.transaction(async (tx) => {
        const fresh = await this.repo.findCycleById(cycle.id, tx);
        if (fresh && fresh.status === 'UNPAID') await this.markUnpaidSkipped(fresh, now, tx, 'retry_after_deadline');
      });
      return 'skipped-unpaid';
    }
    const issued = await this.repo.transaction(async (tx) => {
      for (const p of await this.repo.findOpenLinkPayments(orderRef.id, tx)) await this.deps.charge.expirePaymentLink(p.id, now, tx);
      const link = await this.deps.charge.issuePaymentLink({ cycle, order: orderRef, amount, attemptNo, now });
      const commerce = await this.settings.getCommerce();
      const deadline = linkDeadline;
      const nextIdx = cycle.retryCount + 1;
      const candidate = nextIdx < commerce.dunning.retryHours.length ? new Date((cycle.lockedAt ?? now).getTime() + (commerce.dunning.retryHours[nextIdx] ?? 0) * HOUR_MS) : null;
      const bounds = [link.linkExpiresAt.getTime(), deadline.getTime(), ...(candidate ? [candidate.getTime()] : [])];
      const nextRetryAt = new Date(Math.max(now.getTime() + 60_000, Math.min(...bounds)));
      await this.repo.updateCycle(cycle.id, { paymentDueAt: link.linkExpiresAt, nextRetryAt }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'AWAITING_PAYMENT', actor, data: { paymentId: link.paymentId, linkExpiresAt: link.linkExpiresAt.toISOString(), amount, retry: true }, at: now }, tx);
      return link;
    });
    this.notifier.emit('cycle.awaiting-payment', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { amount, linkToken: issued.linkToken, linkExpiresAt: issued.linkExpiresAt.toISOString(), retry: true } }, now);
    return 'link';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // cycles:expire-payment-links
  // ═══════════════════════════════════════════════════════════════════════════

  async expirePaymentLinks(now: Date): Promise<ExpireLinksResult> {
    const result: ExpireLinksResult = { itemsProcessed: 0, expired: 0, paymentsExpired: 0, errors: 0 };
    for (let round = 0; round < LOCK_MAX_ROUNDS; round++) {
      const ids = await this.repo.selectExpiredLinkCycleIds(now, LOCK_BATCH_SIZE);
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        try {
          const done = await this.repo.transaction(async (tx) => {
            if (!(await this.repo.lockCycle(id, 'AWAITING_PAYMENT', tx))) return false;
            const cycle = await this.repo.findCycleById(id, tx);
            if (!cycle || cycle.status !== 'AWAITING_PAYMENT') return false;
            const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
            const orderRef = this.orderRefOf(cycle, isDelta);
            let lastPaymentId: string | null = null;
            if (orderRef) {
              for (const p of await this.repo.findOpenLinkPayments(orderRef.id, tx)) {
                await this.deps.charge.expirePaymentLink(p.id, now, tx);
                lastPaymentId = p.id;
              }
            }
            await this.markFailed(cycle.id, { isDelta, paymentId: lastPaymentId, failure: 'Ödeme linki süresi doldu', actor: ACTOR.SYSTEM, expired: true }, now, tx);
            return true;
          });
          if (!done) continue;
          progressed++;
          result.itemsProcessed++;
          result.expired++;
        } catch (err) {
          result.errors++;
          this.logger.error(`cycles:expire-payment-links cycle ${id}: ${(err as Error).message}`);
        }
      }
      if (progressed === 0 || ids.length < LOCK_BATCH_SIZE) break;
    }
    // UNPAID cycle'lara yeniden gönderilmiş ve süresi dolmuş linkler (ödeme düzeyinde)
    result.paymentsExpired = await this.repo.expireStaleLinkPayments(now);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // reminders:cutoff (stub bildirim)
  // ═══════════════════════════════════════════════════════════════════════════

  async remindCutoffs(now: Date): Promise<RemindResult> {
    const to = new Date(now.getTime() + CUTOFF_REMINDER_HOURS_BEFORE * HOUR_MS);
    const from = new Date(to.getTime() - CUTOFF_REMINDER_WINDOW_MS);
    const cycles = await this.repo.findReminderCycles(from, to);
    let errors = 0;
    let sent = 0;
    for (const cycle of cycles) {
      try {
        const sub = cycle.subscription;
        if (!(SUBSCRIPTION_ENGINE_ACTIVE_STATES as readonly string[]).includes(sub.status)) continue;
        // F10: gerçek gönderim (mail.cutoff-reminder) — transaction dışında, cycle başına BİR kez (MailLog tekilliği).
        await this.notifier.emitAndDeliver('subscription.cutoff-reminder', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { cutoffAt: cycle.deliveryDate.cutoffAt.toISOString(), deliveryOn: utcToIsoDate(cycle.deliveryDate.date) } }, now);
        sent++;
      } catch {
        errors++;
      }
    }
    return { itemsProcessed: cycles.length, errors, sent };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // F8 kancası: ödeme linki / callback ile ödendi
  // ═══════════════════════════════════════════════════════════════════════════

  /** AWAITING_PAYMENT | UNPAID | LOCKED → CHARGED (Payment SUCCEEDED'ı F8 PaymentsService işaretler; burada cycle/Order/abonelik). */
  async completeLinkPayment(cycleId: string, opts: { paymentId: string | null; actor?: string }, now: Date): Promise<SubscriptionCycle> {
    const cycle = await this.requireCycle(cycleId);
    const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
    const orderRef = this.orderRefOf(cycle, isDelta);
    await this.repo.transaction((tx) =>
      this.markCharged(cycle.id, { isDelta, amount: orderRef ? money(orderRef.grandTotal) : 0, paymentId: opts.paymentId, attemptNo: cycle.retryCount + 1, actor: opts.actor ?? ACTOR.PSP, event: isDelta ? 'DELTA_CHARGED' : 'CHARGED' }, now, tx),
    );
    return toCycleDto((await this.requireCycle(cycleId)) as CycleRecord);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin / ops
  // ═══════════════════════════════════════════════════════════════════════════

  async listForDate(date: IsoDate, filter: { status?: CycleStatus[]; zoneSlug?: string }): Promise<AdminCycleListItem[]> {
    const zoneId = await this.resolveZoneId(filter.zoneSlug);
    const rows = await this.repo.findCyclesForDate({ date: isoDateToUtc(date), status: filter.status, zoneId });
    return rows.map(toAdminCycleListItem);
  }

  async pickList(date: IsoDate, zoneSlug?: string): Promise<PickListRow[]> {
    const zoneId = await this.resolveZoneId(zoneSlug);
    const rows = await this.repo.findCyclesForDate({ date: isoDateToUtc(date), status: [...CYCLE_FULFILLABLE_STATES], zoneId });
    return buildPickList(rows);
  }

  async packingList(date: IsoDate, zoneSlug?: string): Promise<PackingListEntry[]> {
    const zoneId = await this.resolveZoneId(zoneSlug);
    const rows = await this.repo.findCyclesForDate({ date: isoDateToUtc(date), status: [...CYCLE_FULFILLABLE_STATES], zoneId });
    const weekStart = isoDateToUtc(weekStartOf(date));
    const curatorByTier = new Map<string, string | null>();
    for (const row of rows) {
      if (!curatorByTier.has(row.subscription.tierId)) curatorByTier.set(row.subscription.tierId, await this.repo.findTemplateCurator(row.subscription.tierId, weekStart));
    }
    return buildPackingList(rows, curatorByTier);
  }

  private async resolveZoneId(zoneSlug?: string): Promise<string | undefined> {
    if (!zoneSlug) return undefined;
    const zone = await this.repo.findZoneBySlug(zoneSlug);
    if (!zone) throw new NotFoundException(`Bölge bulunamadı: ${zoneSlug}`);
    return zone.id;
  }

  /**
   * Ops durum ilerletme (`PATCH /admin/cycles/:id/status`): makine geçişi + Order'ı birlikte ilerletir;
   * DELIVERED → isOneTime COMPLETED; CANCELLED → DD iade + Order iptali; SKIPPED (OPS) / SCHEDULED (un-skip);
   * CHARGED → elle "ödendi" (nakit/havale) işareti.
   */
  async adminSetStatus(cycleId: string, to: CycleStatus, opts: { note?: string; actor: string }, now: Date): Promise<SubscriptionCycle> {
    const cycle = await this.requireCycle(cycleId);
    const sub = cycle.subscription;
    const from = cycle.status as CycleStatus;
    assertOr409(cycleMachine, from, to);
    if (to === 'LOCKED' || to === 'UNPAID' || to === 'AWAITING_PAYMENT') {
      throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, 'Bu durum admin tarafından doğrudan verilemez (charge / send-payment-link uçlarını kullanın)');
    }
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const orderRef = this.orderRefOf(cycle, false);
      const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
      switch (to) {
        case 'CHARGED': {
          await this.markCharged(cycle.id, { isDelta, amount: orderRef ? money(isDelta ? cycle.deltaOrder!.grandTotal : orderRef.grandTotal) : 0, paymentId: null, attemptNo: cycle.retryCount + 1, actor: opts.actor, event: isDelta ? 'DELTA_CHARGED' : 'CHARGED' }, now, tx);
          break;
        }
        case 'PREPARING':
        case 'OUT_FOR_DELIVERY':
        case 'DELIVERED': {
          await this.repo.updateCycle(cycle.id, { status: to }, tx);
          if (orderRef) {
            const st = (await this.repo.findOrderById(orderRef.id, tx))?.status;
            const target = to;
            if (st && st !== target && st !== 'CANCELLED' && st !== 'REFUNDED') {
              try {
                await this.deps.orders.transition(orderRef.id, target, { actor: opts.actor, now }, tx);
              } catch (err) {
                this.logger.warn(`Order ${orderRef.id} ${st} → ${target} ilerletilemedi: ${(err as Error).message}`);
              }
            }
          }
          if (to === 'DELIVERED' && sub.isOneTime && sub.status === 'ACTIVE') {
            assertOr409(subscriptionMachine, 'ACTIVE', 'COMPLETED');
            await this.repo.updateSubscription(sub.id, { status: 'COMPLETED', completedAt: now, nextDeliveryOn: null, nextCutoffAt: null }, tx);
            await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'COMPLETED', actor: opts.actor, data: null, at: now }, tx);
          }
          break;
        }
        case 'CANCELLED': {
          await this.repo.updateCycle(cycle.id, { status: 'CANCELLED', nextRetryAt: null, paymentDueAt: null }, tx);
          if (from !== 'SKIPPED') await this.deps.deliveryDates.release(cycle.deliveryDateId, tx);
          for (const ref of [cycle.order, cycle.deltaOrder]) {
            if (!ref) continue;
            for (const p of await this.repo.findOpenLinkPayments(ref.id, tx)) await this.deps.charge.expirePaymentLink(p.id, now, tx);
            const st = (await this.repo.findOrderById(ref.id, tx))?.status;
            if (st && st !== 'CANCELLED' && st !== 'REFUNDED' && st !== 'DELIVERED') {
              try {
                await this.deps.orders.transition(ref.id, 'CANCELLED', { actor: opts.actor, reason: opts.note ?? 'Ops iptali', now }, tx);
              } catch (err) {
                this.logger.warn(`Order ${ref.id} iptal edilemedi: ${(err as Error).message}`);
              }
            }
          }
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'CANCELLED', actor: opts.actor, data: { note: opts.note ?? null, from }, at: now }, tx);
          break;
        }
        case 'SKIPPED': {
          await this.repo.updateCycle(cycle.id, { status: 'SKIPPED', skipSource: 'OPS', skippedAt: now }, tx);
          await this.deps.deliveryDates.release(cycle.deliveryDateId, tx);
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'SKIP', actor: opts.actor, data: { source: 'OPS', note: opts.note ?? null }, at: now }, tx);
          break;
        }
        case 'SCHEDULED': {
          await this.deps.deliveryDates.reserve(cycle.deliveryDateId, tx);
          await this.repo.updateCycle(cycle.id, { status: 'SCHEDULED', skipSource: null, skippedAt: null }, tx);
          if (cycle.skipSource === 'USER' && sub.skipsUsed > 0) await this.repo.updateSubscription(sub.id, { skipsUsed: sub.skipsUsed - 1 }, tx);
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'UNSKIP', actor: opts.actor, data: { note: opts.note ?? null, previousSource: cycle.skipSource }, at: now }, tx);
          break;
        }
        default:
          throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, `Durum ${to} bu uçtan verilemez`);
      }
      if (opts.note && to !== 'CANCELLED' && to !== 'SKIPPED' && to !== 'SCHEDULED') {
        await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'ADMIN_NOTE', actor: opts.actor, data: { note: opts.note, status: to }, at: now }, tx);
      }
      await this.refreshNextDelivery(sub.id, tx);
    });
    return toCycleDto((await this.requireCycle(cycleId)) as CycleRecord);
  }

  /** `POST /admin/cycles/:id/charge` — saklı karttan anında tahsilat (UNPAID / LOCKED / AWAITING_PAYMENT). */
  async adminCharge(cycleId: string, actor: string, now: Date): Promise<SubscriptionCycle> {
    const cycle = await this.requireCycle(cycleId);
    const sub = cycle.subscription;
    const pm = sub.paymentMethod && sub.paymentMethod.isActive && sub.paymentMethod.deletedAt === null ? sub.paymentMethod : null;
    if (!pm) throw conflict(SUB_ERRORS.NO_PAYMENT_METHOD, 'Abonelikte saklı kart yok');
    const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
    const orderRef = this.orderRefOf(cycle, isDelta);
    if (!orderRef) throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, 'Cycle için sipariş yok');
    switch (cycle.status) {
      case 'UNPAID': {
        await this.repo.transaction((tx) => this.repo.updateCycle(cycle.id, { nextRetryAt: now }, tx));
        await this.retryCycle(cycle.id, now, actor, { force: true });
        break;
      }
      case 'LOCKED':
      case 'AWAITING_PAYMENT': {
        const payments = await this.repo.findPaymentsOfOrder(orderRef.id);
        const attemptNo = payments.length + 1;
        const amount = money(orderRef.grandTotal);
        const outcome = await this.deps.charge.chargeStoredCard({ cycle, order: orderRef, paymentMethod: pm, amount, kind: isDelta ? 'DELTA' : cycle.status === 'LOCKED' ? 'CYCLE_CHARGE' : 'RETRY', attemptNo, now });
        if (outcome.status === 'SUCCEEDED') {
          await this.repo.transaction(async (tx) => {
            for (const p of await this.repo.findOpenLinkPayments(orderRef.id, tx)) await this.deps.charge.expirePaymentLink(p.id, now, tx);
            await this.markCharged(cycle.id, { isDelta, amount, paymentId: outcome.paymentId, attemptNo, actor, event: isDelta ? 'DELTA_CHARGED' : 'CHARGED' }, now, tx);
          });
        } else if (cycle.status === 'LOCKED') {
          await this.repo.transaction((tx) => this.markFailed(cycle.id, { isDelta, paymentId: outcome.paymentId, failure: outcome.failureMessage ?? null, actor }, now, tx));
        } else {
          await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'RETRY', actor, data: { attemptNo, paymentId: outcome.paymentId, failed: true }, at: now });
        }
        break;
      }
      default:
        throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, `Cycle durumu tahsilata uygun değil: ${cycle.status}`);
    }
    return toCycleDto((await this.requireCycle(cycleId)) as CycleRecord);
  }

  /** `POST /admin/cycles/:id/send-payment-link` — LOCKED → AWAITING_PAYMENT; AWAITING_PAYMENT/UNPAID → yeni link. */
  async adminSendPaymentLink(cycleId: string, actor: string, now: Date): Promise<{ cycle: SubscriptionCycle; linkToken: string; linkExpiresAt: string }> {
    const cycle = await this.requireCycle(cycleId);
    const sub = cycle.subscription;
    if (cycle.status !== 'LOCKED' && cycle.status !== 'AWAITING_PAYMENT' && cycle.status !== 'UNPAID') {
      throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, `Cycle durumu ödeme linkine uygun değil: ${cycle.status}`);
    }
    const isDelta = cycle.cycleNo === 1 && cycle.deltaOrderId !== null;
    const orderRef = this.orderRefOf(cycle, isDelta);
    if (!orderRef) throw conflict(SUB_ERRORS.CHARGE_NOT_APPLICABLE, 'Cycle için sipariş yok');
    const amount = money(orderRef.grandTotal);
    const issued = await this.repo.transaction(async (tx) => {
      for (const p of await this.repo.findOpenLinkPayments(orderRef.id, tx)) await this.deps.charge.expirePaymentLink(p.id, now, tx);
      const payments = await this.repo.findPaymentsOfOrder(orderRef.id, tx);
      const link = await this.deps.charge.issuePaymentLink({ cycle, order: orderRef, amount, attemptNo: payments.length + 1, now });
      if (cycle.status === 'LOCKED') {
        assertOr409(cycleMachine, 'LOCKED', 'AWAITING_PAYMENT');
        await this.repo.updateCycle(cycle.id, { status: 'AWAITING_PAYMENT', paymentDueAt: link.linkExpiresAt }, tx);
      } else if (cycle.status === 'AWAITING_PAYMENT') {
        await this.repo.updateCycle(cycle.id, { paymentDueAt: link.linkExpiresAt }, tx);
      } else {
        const deadline = dunningDeadlineFor(utcToIsoDate(cycle.deliveryDate.date));
        const nextRetryAt = new Date(Math.max(now.getTime() + 60_000, Math.min(link.linkExpiresAt.getTime(), deadline.getTime())));
        await this.repo.updateCycle(cycle.id, { paymentDueAt: link.linkExpiresAt, nextRetryAt }, tx);
      }
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'AWAITING_PAYMENT', actor, data: { paymentId: link.paymentId, linkExpiresAt: link.linkExpiresAt.toISOString(), amount, manual: true }, at: now }, tx);
      return link;
    });
    this.notifier.emit('cycle.awaiting-payment', { subscriptionId: sub.id, userId: sub.userId, cycleId: cycle.id, data: { amount, linkToken: issued.linkToken, linkExpiresAt: issued.linkExpiresAt.toISOString(), manual: true } }, now);
    return { cycle: toCycleDto((await this.requireCycle(cycleId)) as CycleRecord), linkToken: issued.linkToken, linkExpiresAt: issued.linkExpiresAt.toISOString() };
  }

  /** `POST /admin/cycles/:id/compensate` — telafi: hedef SCHEDULED cycle'a (kendisi ya da sıradaki) 0 TL EXTRA + ADMIN_NOTE [B19]. */
  async compensate(cycleId: string, input: { productId: string; qty?: number; label?: string; note: string }, actor: string, now: Date): Promise<SubscriptionCycle> {
    const source = await this.requireCycle(cycleId);
    const sub = source.subscription;
    const product = await this.repo.findProductById(input.productId);
    if (!product || product.deletedAt !== null) throw new NotFoundException('Ürün bulunamadı');
    const cycles = await this.repo.findCyclesOfSubscription(sub.id);
    const target =
      source.status === 'SCHEDULED' && source.deliveryDate.cutoffAt.getTime() > now.getTime()
        ? source
        : (cycles.find((c) => c.status === 'SCHEDULED' && c.deliveryDate.cutoffAt.getTime() > now.getTime()) ?? null);
    if (!target) throw conflict(SUB_ERRORS.NO_SCHEDULED_CYCLE, 'Telafi için kesimi geçmemiş SCHEDULED cycle yok');
    const qty = input.qty ?? 1;
    await this.repo.transaction(async (tx) => {
      await this.repo.createCycleItems(
        [
          {
            cycleId: target.id,
            source: 'EXTRA',
            productId: product.id,
            lotId: product.lots[0]?.id ?? null,
            lotCode: product.lots[0]?.lotCode ?? null,
            pref: null,
            qty: toQtyDecimal(qty),
            unit: product.unit,
            label: input.label ?? `${qty} ${product.unit} (telafi)`,
            unitPrice: toDecimal(0),
            sortOrder: target.items.length,
          },
        ],
        tx,
      );
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: target.id, type: 'ADMIN_NOTE', actor, data: { compensation: true, compensateFor: source.id, productId: product.id, productSlug: product.slug, qty, note: input.note }, at: now }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: target.id, type: 'EXTRA_ADDED', actor, data: { compensation: true, slug: product.slug, qty, unitPrice: 0 }, at: now }, tx);
    });
    return toCycleDto((await this.requireCycle(target.id)) as CycleRecord);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Abonelik düzeyinde yan etkiler (SubscriptionsService / CancellationService çağırır)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * İptal yan etkileri (§11): SCHEDULED (+ gelecek SKIPPED) cycle'lar CANCELLED (DD iade); cycle#1 henüz kesilmemişse
   * Order PAID→REFUNDED ve iade tutarı/tarihi; kilitli cycle'lar devam eder; abonelik → CANCELLED.
   */
  async cancelSubscription(subscriptionId: string, opts: CancelSubscriptionOpts, now: Date, tx: Tx): Promise<CancelSubscriptionResult> {
    await this.repo.lockSubscription(subscriptionId, tx);
    const sub = await this.repo.findSubscriptionById(subscriptionId, tx);
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    assertOr409(subscriptionMachine, sub.status as SubscriptionStatus, 'CANCELLED');
    const cycles = await this.repo.findCyclesOfSubscription(sub.id, tx);
    let refundAmount = 0;
    let refundDueAt: Date | null = null;
    let cancelledCycles = 0;
    for (const cycle of cycles) {
      const future = cycle.deliveryDate.cutoffAt.getTime() > now.getTime();
      if (cycle.status === 'SCHEDULED') {
        assertOr409(cycleMachine, 'SCHEDULED', 'CANCELLED');
        await this.repo.updateCycle(cycle.id, { status: 'CANCELLED' }, tx);
        await this.deps.deliveryDates.release(cycle.deliveryDateId, tx);
        if (cycle.cycleNo === 1 && cycle.order && money(cycle.prepaidAmount) > 0) {
          const st = (await this.repo.findOrderById(cycle.order.id, tx))?.status;
          if (st === 'PAID') {
            await this.deps.orders.transition(cycle.order.id, 'REFUNDED', { actor: opts.actor, reason: 'Abonelik iptali — peşin kutu iadesi', now }, tx);
            refundAmount = money(cycle.prepaidAmount);
            refundDueAt = new Date(now.getTime() + CANCEL_REFUND_DAYS * DAY_MS);
          } else if (st === 'PENDING_PAYMENT' || st === 'PAYMENT_FAILED') {
            await this.deps.orders.transition(cycle.order.id, 'CANCELLED', { actor: opts.actor, reason: 'Abonelik iptali', now }, tx);
          }
        }
        await this.repo.addEvent({ subscriptionId: sub.id, cycleId: cycle.id, type: 'CANCELLED', actor: opts.actor, data: { reason: 'subscription_cancelled' }, at: now }, tx);
        cancelledCycles++;
      } else if (cycle.status === 'SKIPPED' && future && cycle.skipSource !== 'UNPAID') {
        // Atlanmış gelecek hafta: DD zaten iade edilmişti; yalnız kapat (makinede SKIPPED→CANCELLED yok → doğrudan kayıt)
        await this.repo.updateCycle(cycle.id, { status: 'CANCELLED' }, tx);
        cancelledCycles++;
      }
    }
    const inFlight = cycles.filter((c) => (CYCLE_IN_FLIGHT_STATES as readonly string[]).includes(c.status));
    const latest = inFlight.reduce<Date | null>((acc, c) => {
      const end = endOfDeliveryDay(utcToIsoDate(c.deliveryDate.date));
      return acc === null || end.getTime() > acc.getTime() ? end : acc;
    }, null);
    const maxEffective = new Date(opts.requestedAt.getTime() + 7 * DAY_MS);
    let effectiveAt = latest && latest.getTime() > now.getTime() ? latest : now;
    if (effectiveAt.getTime() > maxEffective.getTime()) effectiveAt = maxEffective;
    await this.repo.updateSubscription(sub.id, { status: 'CANCELLED', cancelledAt: now, nextDeliveryOn: null, nextCutoffAt: null }, tx);
    await this.repo.addEvent(
      { subscriptionId: sub.id, cycleId: null, type: 'CANCELLED', actor: opts.actor, data: { reason: opts.reason ?? null, effectiveAt: effectiveAt.toISOString(), refundAmount, refundDueAt: refundDueAt?.toISOString() ?? null, cancelledCycles }, at: now },
      tx,
    );
    // F10: iptal teyidi e-postası (mail.subscription-cancelled) — iade tutarı/tarihi de yükte.
    this.notifier.emit('subscription.cancelled', { subscriptionId: sub.id, userId: sub.userId, data: { effectiveAt: effectiveAt.toISOString(), refundAmount, refundDueAt: refundDueAt?.toISOString() ?? null } }, now);
    return { effectiveAt, refundAmount, refundDueAt, cancelledCycles };
  }

  /**
   * freq/gün/bölge değişikliği: cycleNo>1 SCHEDULED cycle'lar silinir (DD iade), cycle#1 SCHEDULED ise aynı haftada
   * yeni güne taşınır (rezerv/iade), ardından ensure yeniden üretir (ADR-0008 kural #14).
   */
  async regenerateScheduledCycles(subscriptionId: string, now: Date, tx: Tx): Promise<{ deleted: number; created: number }> {
    const sub = await this.repo.findSubscriptionById(subscriptionId, tx);
    if (!sub) throw new NotFoundException('Abonelik bulunamadı');
    const commerce = await this.settings.getCommerce();
    const cycles = await this.repo.findCyclesOfSubscription(sub.id, tx);
    const toDelete = cycles.filter((c) => c.status === 'SCHEDULED' && c.cycleNo > 1);
    for (const c of toDelete) await this.deps.deliveryDates.release(c.deliveryDateId, tx);
    const deleted = await this.repo.deleteCycles(toDelete.map((c) => c.id), tx);
    const first = cycles.find((c) => c.cycleNo === 1);
    if (first && first.status === 'SCHEDULED' && first.deliveryDate.day !== sub.deliveryDay) {
      const target = deliveryDateInWeek(weekStartOf(utcToIsoDate(first.deliveryDate.date)), sub.deliveryDay as DeliveryDay);
      if (computeCutoffAt(target, commerce.cutoff).getTime() > now.getTime()) {
        const dd = await this.deps.deliveryDates.findOrCreateFor(sub.zoneId, target, tx);
        if (dd.status === 'OPEN') {
          try {
            await this.deps.deliveryDates.reserve(dd.id, tx);
            await this.deps.deliveryDates.release(first.deliveryDateId, tx);
            await this.repo.updateCycle(first.id, { deliveryDateId: dd.id }, tx);
          } catch (err) {
            if (!isDayFullError(err)) throw err;
          }
        }
      }
    }
    if (sub.isOneTime) return { deleted, created: 0 };
    const r = await this.ensureSubscriptionInTx(sub.id, now, commerce, tx);
    return { deleted, created: r.created };
  }

  /** SCHEDULED iken canlı toplam (BootstrapSub.currentCycle.total) — hata durumunda null. */
  async liveTotal(sub: SubscriptionRecord, cycle: CycleRecord, now: Date): Promise<Money | null> {
    try {
      return (await this.deps.pricing.cycleCharge({ subscription: sub, cycle, now })).total;
    } catch (err) {
      this.logger.warn(`Canlı quote hesaplanamadı (cycle ${cycle.id}): ${(err as Error).message}`);
      return null;
    }
  }

  async requireCycle(cycleId: string): Promise<CycleWithSubRecord> {
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new NotFoundException('Cycle bulunamadı');
    return cycle;
  }
}
