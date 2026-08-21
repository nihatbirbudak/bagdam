import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  assertOrderTransition,
  canOrderTransition,
  DEFAULT_TZ,
  DEFAULT_VAT_RATE,
  InvalidTransitionError,
  isOrderCustomerCancellable,
  isoDateToUtc,
  OrderKind,
  OrderLineKind,
  OrderStatus,
  roundExtraPrice,
  roundMoney,
  sumMoney,
  utcToIsoDate,
  vatFromGrossRaw,
  type AddressSnapshot,
  type AdminOrderList,
  type CycleChargeQuote,
  type MeOrderListResponse,
  type Money,
  type Order,
  type OrderLineBoxMetadata,
  type OrderLineSnapshotInput,
  type OrderStatusResponse,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { CouponsService } from '../coupons/coupons.service';
import { webUrl } from '../mail/mail.constants';
import { NOTIFIER, type Notifier, type NotifierOrder } from '../mail/notifier.interface';
import type { OrderBillingPatchDto } from './dto/order-billing.dto';
import type { OrderInvoicePatchDto } from './dto/order-invoice.dto';
import type { AdminOrdersQueryDto } from './dto/orders-query.dto';
import {
  ADMIN_NOTE_MAX_LENGTH,
  ADMIN_NOTE_STAMP_FORMAT,
  ME_ORDERS_LIMIT,
  ORDER_CANCEL_REASON_MAX,
  ORDER_CUSTOMER_CANCEL_DEFAULT_REASON,
  ORDERS_CSV_MAX_ROWS,
  ORDERS_DEFAULT_LIMIT,
  ORDERS_DEFAULT_PAGE,
} from './orders.constants';
import { ORDERS_DEPS, type OrdersDeps } from './orders.deps';
import { toMoney, toOrderDto, toOrderStatusResponse, toOrderSummary, toOrdersCsv } from './orders.mapper';
import { OrdersRepository, type CycleForOrderRecord, type OrderLineRecord, type OrderRecord } from './orders.repository';
import type {
  CreateForCycleOptions,
  CreateOrderFromQuoteInput,
  CycleRef,
  OrderListFilter,
  OrderTransitionContext,
  Tx,
} from './orders.types';

/** `createFromQuote` / `createForCycle` sonucu — Prisma kayıtları (çağıran orderNo/id kullanır; DTO için `toOrderDto`). */
export interface CreateOrderResult {
  order: OrderRecord;
  lines: OrderLineRecord[];
}

/** F9 ops toplu durum: tek bir siparişin ön kontrol / uygulama sonucu. */
export interface BulkTransitionCheck {
  id: string;
  from: OrderStatus | null;
  orderNo: number | null;
  ok: boolean;
  error?: string;
  message?: string;
}

/** Nest hata gövdesinden `{error, message}` çıkarır (AllExceptionsFilter zarfıyla aynı alanlar). */
function errorEnvelope(err: unknown): { error: string; message: string } {
  const res = err instanceof ConflictException || err instanceof NotFoundException || err instanceof BadRequestException ? err.getResponse() : null;
  if (res && typeof res === 'object') {
    const body = res as { error?: string; message?: string };
    return { error: body.error ?? 'ORDER_TRANSITION_FAILED', message: body.message ?? (err as Error).message };
  }
  return { error: 'ORDER_TRANSITION_FAILED', message: err instanceof Error ? err.message : String(err) };
}

/** Admin durum güncellemesi sonucu (controller audit için eski/yeni durum). */
export interface OrderStatusUpdateResult {
  order: Order;
  from: OrderStatus;
  to: OrderStatus;
}

const dec2 = (n: number): Prisma.Decimal => new Prisma.Decimal(roundMoney(n).toFixed(2));
const dec3 = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(3));
const num = (d: Prisma.Decimal | null | undefined): number => (d ? Number(d.toString()) : 0);
const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** DeliveryDate rezervi hangi geçişlerde iade edilir (state-machines §1.2: CANCELLED'a her giriş; REFUNDED yalnız PAID'den). */
function shouldReleaseDeliveryDate(from: OrderStatus, to: OrderStatus): boolean {
  if (to === OrderStatus.CANCELLED) return true;
  if (to === OrderStatus.REFUNDED && from === OrderStatus.PAID) return true;
  return false;
}

/** Checkout siparişi mi (CHECKOUT türünde ödemesi var) — sipariş onayı e-postası yalnız bunlara (cycle#n Order'ları motorun olayları). */
export function isCheckoutOrder(order: Pick<OrderRecord, 'payments'>): boolean {
  return order.payments.some((p) => p.kind === 'CHECKOUT');
}

/**
 * OrdersService — Order çekirdeği (F7/B2; BACKEND-PLANI §3 checkout/orders satırı, docs/state-machines.md §1, ADR-0006/0008):
 *  - `createFromQuote` (checkout: DeliveryDate rezerv + Order PENDING_PAYMENT + satır snapshot'ı — fiyat yeniden HESAPLANMAZ,
 *    PricingService sonucu olduğu gibi dondurulur), `createForCycle` (kesimde cycle#n Order'ı; BOX + EXTRA satırları),
 *    `createDeltaForCycle` (cycle#1 peşin sonrası ekstralar: ayrı küçük DELTA Order),
 *  - `transition` (shared Order durum makinesi; geçersiz → 409 ORDER_TRANSITION_INVALID; yan etki: CANCELLED/REFUNDED → DD iade,
 *    PAID → paidAt; abonelik siparişinde ADMIN/OPS müdahalesi SubscriptionEvent ADMIN_NOTE), `cancel`, müşteri iptali (kesimden önce),
 *    F8: PAID → kupon kullanımı (usedCount++) + Notifier `order.paid` (yalnız checkout siparişleri; sipariş özeti + yasal belge kopyaları);
 *    CANCELLED/REFUNDED → kupon kullanımı serbest (satır silinir, ödenmişse usedCount--).
 *  - admin liste/detay/CSV/not/fatura/billing, müşteri liste/detay/durum.
 * Prisma yalnız repository'de; DeliveryDate rezerv/iade `ORDERS_DEPS` (B1 DeliveryDatesService ile aynı imza). Zaman `now` parametreyle.
 * Cycle/Subscription durumları bu serviste DEĞİŞMEZ (C'nin alanı); yalnız cycle.orderId/deltaOrderId bağlanır.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly repo: OrdersRepository,
    @Inject(ORDERS_DEPS) private readonly deps: OrdersDeps,
    private readonly coupons: CouponsService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  // ── Oluşturma ────────────────────────────────────────────────────────────────

  /**
   * Checkout Order'ı: doğrula → DeliveryDate (OPEN, kesim geçmemiş, bölge eşleşir) → atomik rezerv (409 DAY_FULL) →
   * Order PENDING_PAYMENT + satırlar (tek işlem; `tx` verilirse çağıranın işlemine katılır — F8 `$transaction`).
   */
  createFromQuote(input: CreateOrderFromQuoteInput, tx?: Tx): Promise<CreateOrderResult> {
    return this.repo.runInTransaction(async (db) => {
      const now = input.now ?? new Date();
      if (!input.lines || input.lines.length === 0) {
        throw new BadRequestException({ message: 'Sipariş satırı yok', error: 'ORDER_EMPTY' });
      }
      if (!input.customer.phone?.trim()) {
        throw new BadRequestException({ message: 'Telefon zorunlu', error: 'CUSTOMER_PHONE_REQUIRED' });
      }
      const dd = await this.repo.findDeliveryDate(input.deliveryDateId, db);
      if (!dd) throw new NotFoundException({ message: 'Teslimat tarihi bulunamadı', error: 'DELIVERY_DATE_NOT_FOUND' });
      if (dd.status !== 'OPEN' || dd.cutoffAt.getTime() <= now.getTime()) {
        throw new ConflictException({ message: 'Bu teslimat günü için sipariş kesimi geçti ya da gün kapalı', error: 'DAY_LOCKED' });
      }
      if (input.address.zoneId !== dd.zoneId) {
        throw new BadRequestException({ message: 'Adres bölgesi ile teslimat günü bölgesi uyuşmuyor', error: 'ZONE_MISMATCH' });
      }
      await this.deps.reserve(dd.id, db);

      const kind = input.kind ?? input.quote.orderKind;
      const order = await this.repo.createOrder(
        {
          kind,
          status: OrderStatus.PENDING_PAYMENT,
          userId: input.userId,
          subscriptionId: input.subscriptionId ?? null,
          customerName: clip(input.customer.name.trim(), 120),
          customerEmail: clip(input.customer.email.trim(), 160),
          customerPhone: clip(input.customer.phone.trim(), 30),
          zoneId: dd.zoneId,
          deliveryDateId: dd.id,
          deliveryDay: dd.day,
          deliveryOn: dd.date,
          addressSnapshot: input.address as unknown as Prisma.InputJsonValue,
          subtotal: dec2(input.quote.subtotal),
          discountTotal: dec2(input.quote.discountTotal),
          shippingFee: dec2(input.quote.shippingFee),
          vatTotal: dec2(input.quote.vatTotal),
          grandTotal: dec2(input.quote.grandTotal),
          couponCode: input.couponCode ? clip(input.couponCode, 40) : null,
          note: input.note ?? null,
          ipAddress: input.ipAddress ? clip(input.ipAddress, 64) : null,
          userAgent: input.userAgent ? clip(input.userAgent, 255) : null,
        },
        input.lines.map(toLineCreate),
        db,
      );
      this.logger.log(`Sipariş oluşturuldu #${order.orderNo} (${kind}, ${order.grandTotal.toString()} TL, dd:${dd.id})`);
      return { order, lines: order.lines };
    }, tx);
  }

  /**
   * Kesimde cycle#n Order'ı (state-machines §8 adım 5): kind SUBSCRIPTION (isOneTime → BOX_ONE_TIME); BOX satırı
   * (tier fiyatı = quote.boxPrice, metadata.items = TEMPLATE/SWAP içeriği) + EXTRA satırları (EXTRA/CART_MERGE; unitPrice snapshot);
   * discountTotal/shippingFee quote'tan, grandTotal = quote.due (cycle#n'de prepaid 0 → = total); deliveryDate = cycle.deliveryDate
   * (rezerv ensure'da yapıldı — burada YOK); müşteri/adres snapshot'ı abonelikten. cycle.orderId bağlanır (opts.link).
   * cycle.orderId doluysa 409 CYCLE_ORDER_EXISTS (cycle#1 için `createDeltaForCycle`).
   */
  createForCycle(cycleRef: CycleRef, quote: CycleChargeQuote, tx?: Tx, opts: CreateForCycleOptions = {}): Promise<CreateOrderResult> {
    return this.repo.runInTransaction(async (db) => {
      const cycle = await this.requireCycle(cycleRef, db);
      if (cycle.orderId) throw new ConflictException({ message: 'Bu cycle için Order zaten var', error: 'CYCLE_ORDER_EXISTS' });
      const sub = cycle.subscription;
      const vatRate = opts.vatRate ?? DEFAULT_VAT_RATE;
      const boxLine = buildBoxLine(cycle, quote.boxPrice, vatRate);
      const extraLines = buildExtraLines(cycle.items);
      const lines = [boxLine, ...extraLines];
      const extrasSum = sumMoney(extraLines.map((l) => l.lineTotal));
      if (extrasSum !== roundMoney(quote.extrasTotal)) {
        this.logger.warn(`createForCycle: ekstra toplamı quote ile uyuşmuyor (cycle:${cycle.id} satır:${extrasSum} quote:${quote.extrasTotal})`);
      }
      const subtotal = roundMoney(quote.boxPrice + quote.extrasTotal);
      const vatTotal = computeVatTotal(lines, quote.discount);
      const { customer, address } = snapshotFromSubscription(cycle);
      const order = await this.repo.createOrder(
        {
          kind: sub.isOneTime ? OrderKind.BOX_ONE_TIME : OrderKind.SUBSCRIPTION,
          status: OrderStatus.PENDING_PAYMENT,
          userId: sub.userId,
          subscriptionId: sub.id,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          zoneId: cycle.deliveryDate.zoneId,
          deliveryDateId: cycle.deliveryDateId,
          deliveryDay: cycle.deliveryDate.day,
          deliveryOn: cycle.deliveryDate.date,
          addressSnapshot: address as unknown as Prisma.InputJsonValue,
          subtotal: dec2(subtotal),
          discountTotal: dec2(quote.discount),
          shippingFee: dec2(quote.shippingFee),
          vatTotal: dec2(vatTotal),
          grandTotal: dec2(quote.due),
          ipAddress: opts.ipAddress ?? null,
        },
        lines.map(toLineCreate),
        db,
      );
      if (opts.link !== false) await this.repo.linkCycleOrder(cycle.id, { orderId: order.id }, db);
      this.logger.log(`Cycle Order oluşturuldu #${order.orderNo} (cycle:${cycle.id} #${cycle.cycleNo}, due ${quote.due} TL)`);
      return { order, lines: order.lines };
    }, tx);
  }

  /**
   * DELTA Order (ADR-0006; state-machines §8 adım 5 cycle#1): peşin ödenmiş checkout Order'ı DEĞİŞMEZ; kesim sonrası eklenen
   * EXTRA/CART_MERGE öğeleri (checkout Order'daki EXTRA satırlarıyla productId+qty eşleşenler düşülür) ayrı küçük Order'a yazılır:
   * kind abonelikten, indirim/kargo 0, grandTotal = quote.due (> 0 değilse 400 DELTA_NOTHING_DUE). cycle.deltaOrderId bağlanır.
   */
  createDeltaForCycle(cycleRef: CycleRef, quote: CycleChargeQuote, tx?: Tx, opts: CreateForCycleOptions = {}): Promise<CreateOrderResult> {
    return this.repo.runInTransaction(async (db) => {
      const cycle = await this.requireCycle(cycleRef, db);
      if (!cycle.orderId || !cycle.order) {
        throw new ConflictException({ message: 'DELTA yalnız peşin ödenmiş (orderId dolu) cycle için üretilir', error: 'CYCLE_ORDER_MISSING' });
      }
      if (cycle.deltaOrderId) throw new ConflictException({ message: 'Bu cycle için DELTA Order zaten var', error: 'CYCLE_DELTA_EXISTS' });
      if (!(quote.due > 0)) throw new BadRequestException({ message: 'Tahsil edilecek fark yok', error: 'DELTA_NOTHING_DUE' });
      const sub = cycle.subscription;
      const allExtras = buildExtraLines(cycle.items);
      let lines = excludePrepaidExtras(allExtras, cycle.order.lines);
      if (lines.length === 0) {
        this.logger.warn(`createDeltaForCycle: peşin satırlardan ayrışan ekstra yok, tüm ekstralar yazılıyor (cycle:${cycle.id})`);
        lines = allExtras;
      }
      const subtotal = sumMoney(lines.map((l) => l.lineTotal));
      if (subtotal !== roundMoney(quote.due)) {
        this.logger.warn(`createDeltaForCycle: satır toplamı (${subtotal}) quote.due (${quote.due}) ile uyuşmuyor (cycle:${cycle.id})`);
      }
      const { customer, address } = snapshotFromSubscription(cycle);
      // Satır toplamı due'yu aşıyorsa (peşin ödenmiş ekstra satırlardan ayrışamadı) fark indirim satırına iner →
      // subtotal − discount = grandTotal korunur (KDV de kalan tutar üzerinden)
      const prepaidPortion = roundMoney(Math.max(0, subtotal - quote.due));
      const order = await this.repo.createOrder(
        {
          kind: sub.isOneTime ? OrderKind.BOX_ONE_TIME : OrderKind.SUBSCRIPTION,
          status: OrderStatus.PENDING_PAYMENT,
          userId: sub.userId,
          subscriptionId: sub.id,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          zoneId: cycle.deliveryDate.zoneId,
          deliveryDateId: cycle.deliveryDateId,
          deliveryDay: cycle.deliveryDate.day,
          deliveryOn: cycle.deliveryDate.date,
          addressSnapshot: address as unknown as Prisma.InputJsonValue,
          subtotal: dec2(subtotal),
          discountTotal: dec2(prepaidPortion),
          shippingFee: dec2(0),
          vatTotal: dec2(computeVatTotalAfterDiscount(lines, prepaidPortion)),
          grandTotal: dec2(quote.due),
          note: `DELTA — cycle #${cycle.cycleNo} (sipariş #${cycle.order.orderNo})`,
          ipAddress: opts.ipAddress ?? null,
        },
        lines.map(toLineCreate),
        db,
      );
      if (opts.link !== false) await this.repo.linkCycleOrder(cycle.id, { deltaOrderId: order.id }, db);
      this.logger.log(`DELTA Order oluşturuldu #${order.orderNo} (cycle:${cycle.id} #${cycle.cycleNo}, ${quote.due} TL)`);
      return { order, lines: order.lines };
    }, tx);
  }

  // ── Durum geçişleri ──────────────────────────────────────────────────────────

  /**
   * Durum geçişi — shared `assertOrderTransition` (geçersiz → 409 ORDER_TRANSITION_INVALID); iyimser kilit (arada değişmişse
   * 409 ORDER_STATE_CHANGED). Yan etkiler: PAID → paidAt + kupon usedCount++ (F8) + Notifier `order.paid` (checkout siparişi; işlem sonrası,
   * asla fırlatmaz); CANCELLED/REFUNDED → cancelledAt/cancelReason + DeliveryDate iade (CANCELLED'a her giriş, REFUNDED yalnız PAID'den —
   * yalnız tekil/checkout siparişlerinde; abonelik siparişinde rezervin sahibi cycle motorudur, `ctx.releaseDeliveryDate` ile ezilebilir)
   * + kupon kullanımı serbest (F8); abonelik siparişinde ADMIN/OPS geçişi → SubscriptionEvent ADMIN_NOTE (SYSTEM/USER/PSP geçişlerini
   * C/F8 kendi olaylarıyla yazar — çift kayıt olmasın).
   */
  async transition(orderId: string, to: OrderStatus, ctx: OrderTransitionContext, tx?: Tx): Promise<OrderRecord> {
    const result = await this.repo.runInTransaction(async (db) => {
      const order = await this.repo.findById(orderId, db);
      if (!order) throw new NotFoundException({ message: 'Sipariş bulunamadı', error: 'ORDER_NOT_FOUND' });
      const from = order.status as OrderStatus;
      try {
        assertOrderTransition(from, to);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          throw new ConflictException({ message: `Sipariş ${from} → ${to} geçişi geçersiz`, error: 'ORDER_TRANSITION_INVALID' });
        }
        throw err;
      }
      const reason = ctx.reason?.trim() ?? '';
      if ((to === OrderStatus.CANCELLED || to === OrderStatus.REFUNDED) && !reason) {
        throw new BadRequestException({ message: 'İptal/iade için neden gerekli', error: 'ORDER_REASON_REQUIRED' });
      }
      const now = ctx.now ?? new Date();
      const data: Prisma.OrderUpdateManyMutationInput = { status: to };
      if (to === OrderStatus.PAID && !order.paidAt) data.paidAt = now;
      if (to === OrderStatus.CANCELLED || to === OrderStatus.REFUNDED) {
        data.cancelledAt = now;
        data.cancelReason = clip(reason, ORDER_CANCEL_REASON_MAX);
      }
      const affected = await this.repo.updateStatusIf(orderId, from, data, db);
      if (affected === 0) {
        throw new ConflictException({ message: 'Sipariş durumu bu arada değişti, yenileyip tekrar deneyin', error: 'ORDER_STATE_CHANGED' });
      }
      // DD iadesi: tekil siparişte varsayılan açık; abonelik siparişinde rezervin sahibi cycle motoru (çift iade olmasın)
      const releaseWanted = ctx.releaseDeliveryDate ?? order.subscriptionId === null;
      if (order.deliveryDateId && releaseWanted && shouldReleaseDeliveryDate(from, to)) {
        await this.deps.release(order.deliveryDateId, db);
      }
      // F8 kupon: PAID → usedCount++ (aynı işlem); CANCELLED/REFUNDED → kullanım satırı silinir, ödenmişse usedCount--
      if (order.couponCode) {
        if (to === OrderStatus.PAID) await this.coupons.confirmRedemption(order.id, db);
        else if (to === OrderStatus.CANCELLED || to === OrderStatus.REFUNDED) {
          await this.coupons.releaseRedemption(order.id, { wasPaid: order.paidAt !== null }, db);
        }
      }
      if (order.subscriptionId && (ctx.actor === 'ADMIN' || ctx.actor === 'OPS')) {
        await this.repo.createSubscriptionEvent(
          {
            subscriptionId: order.subscriptionId,
            cycleId: null,
            type: 'ADMIN_NOTE',
            actor: ctx.actor,
            data: { kind: 'ORDER_STATUS', orderId: order.id, orderNo: order.orderNo, from, to, reason: reason || null, actorId: ctx.actorId ?? null },
          },
          db,
        );
      }
      this.logger.log(`Sipariş #${order.orderNo}: ${from} → ${to} (${ctx.actor}${reason ? `, ${reason}` : ''})`);
      const updated = await this.repo.findById(orderId, db);
      return updated ?? order;
    }, tx);
    // F8: sipariş onayı e-postası (checkout siparişi; Notifier asla fırlatmaz; işlem dışı — dış `tx` verildiyse çağıranın commit'inden hemen önce olabilir)
    if (to === OrderStatus.PAID && ctx.notify !== false && isCheckoutOrder(result)) {
      void this.notifyPaid(result).catch((err: unknown) => this.logger.error(`order.paid bildirimi başarısız (#${result.orderNo}): ${(err as Error).message}`));
    }
    return result;
  }

  /** İptal (ops/sistem/müşteri): `transition(CANCELLED)` + neden; yan etkiler orada. */
  cancel(orderId: string, reason: string, actor: OrderTransitionContext['actor'], actorId?: string | null, tx?: Tx): Promise<OrderRecord> {
    return this.transition(orderId, OrderStatus.CANCELLED, { actor, actorId: actorId ?? null, reason }, tx);
  }

  /**
   * Müşteri iptali (`POST /orders/:orderNo/cancel`): sahiplik (404) · durum PENDING_PAYMENT | PAID | PAYMENT_FAILED (409
   * ORDER_NOT_CANCELLABLE) · kesimden önce (409 ORDER_CUTOFF_PASSED) · abonelik siparişi değil (409 ORDER_SUBSCRIPTION_MANAGED —
   * /me/subscription/cancel). PAID iptalinde iade PaymentsService (F8) tarafında izlenir.
   */
  async cancelByCustomer(userId: string, orderNo: number, reason?: string | null, now: Date = new Date()): Promise<Order> {
    const order = await this.repo.findForUser(userId, orderNo);
    if (!order) throw new NotFoundException({ message: 'Sipariş bulunamadı', error: 'ORDER_NOT_FOUND' });
    if (order.subscriptionId) {
      throw new ConflictException({ message: 'Abonelik siparişi abonelik üzerinden iptal edilir', error: 'ORDER_SUBSCRIPTION_MANAGED' });
    }
    if (!isOrderCustomerCancellable(order.status as OrderStatus)) {
      throw new ConflictException({ message: 'Bu sipariş artık iptal edilemez', error: 'ORDER_NOT_CANCELLABLE' });
    }
    if (order.deliveryDate && order.deliveryDate.cutoffAt.getTime() <= now.getTime()) {
      throw new ConflictException({ message: 'Sipariş kesimi geçti; iptal için bize ulaşın', error: 'ORDER_CUTOFF_PASSED' });
    }
    const updated = await this.transition(order.id, OrderStatus.CANCELLED, {
      actor: 'USER',
      actorId: userId,
      reason: reason?.trim() || ORDER_CUSTOMER_CANCEL_DEFAULT_REASON,
      now,
    });
    return toOrderDto(updated);
  }

  // ── F8: sipariş onayı e-postası ──────────────────────────────────────────────

  /** Notifier `order.paid` — sipariş özeti + onaylanan yasal belgelerin kopya bağlantıları (politikalar.html#slug). */
  async notifyPaid(order: OrderRecord): Promise<void> {
    await this.notifier.notify('order.paid', { order: buildNotifierOrder(order) });
  }

  // ── Müşteri okuma ────────────────────────────────────────────────────────────

  /** `GET /me/orders` — yeni → eski, en çok ME_ORDERS_LIMIT (zarf `{items,total}`; F6 iskeletiyle aynı). */
  async listForUser(userId: string): Promise<MeOrderListResponse> {
    const { rows, total } = await this.repo.list({ userId }, 0, ME_ORDERS_LIMIT);
    return { items: rows.map(toOrderSummary), total };
  }

  /** `GET /me/orders/:orderNo` — sahip değilse 404 (ödemeler müşteriye dönmez). */
  async getForUser(userId: string, orderNo: number): Promise<Order> {
    const row = await this.repo.findForUser(userId, orderNo);
    if (!row) throw new NotFoundException({ message: 'Sipariş bulunamadı', error: 'ORDER_NOT_FOUND' });
    return toOrderDto(row);
  }

  /** `GET /orders/:orderNo/status` — sepet.html `?siparis=` (F8: 2 s polling; paidAt + subscriptionStatus). */
  async getStatusForUser(userId: string, orderNo: number): Promise<OrderStatusResponse> {
    const row = await this.repo.findForUser(userId, orderNo);
    if (!row) throw new NotFoundException({ message: 'Sipariş bulunamadı', error: 'ORDER_NOT_FOUND' });
    return toOrderStatusResponse(row);
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  async listAdmin(query: AdminOrdersQueryDto): Promise<AdminOrderList> {
    const page = query.page ?? ORDERS_DEFAULT_PAGE;
    const limit = query.limit ?? ORDERS_DEFAULT_LIMIT;
    const { rows, total } = await this.repo.list(resolveFilter(query), (page - 1) * limit, limit);
    return { items: rows.map(toOrderSummary), total, page, limit };
  }

  async getAdmin(id: string): Promise<Order> {
    return toOrderDto(await this.requireOrder(id), { includePayments: true });
  }

  async exportCsv(query: AdminOrdersQueryDto): Promise<string> {
    const rows = await this.repo.listForExport(resolveFilter(query), ORDERS_CSV_MAX_ROWS);
    return toOrdersCsv(rows);
  }

  /** Admin durum değişikliği — actor ADMIN (STAFF de panelden ADMIN aktörüyle geçer; audit actor ayrı). */
  async updateStatusAdmin(id: string, to: OrderStatus, reason: string | undefined, actorId: string | undefined): Promise<OrderStatusUpdateResult> {
    const before = await this.requireOrder(id);
    const row = await this.transition(id, to, { actor: 'ADMIN', actorId: actorId ?? null, reason: reason ?? null });
    return { order: toOrderDto(row, { includePayments: true }), from: before.status as OrderStatus, to };
  }

  // ── F9 ops toplu durum (ekran 20 "Teslimat Günü") ────────────────────────────

  /**
   * Toplu geçiş ÖN KONTROLÜ — hiçbir şey yazmaz. Ops ekranı seçili satırların hepsini birden ilerletmeden önce
   * (hep-ya-hiç) bunu kullanır: sipariş yoksa `ORDER_NOT_FOUND`, geçiş makineye uymuyorsa `ORDER_TRANSITION_INVALID`.
   */
  async checkBulkTransition(ids: readonly string[], to: OrderStatus): Promise<BulkTransitionCheck[]> {
    const out: BulkTransitionCheck[] = [];
    for (const id of ids) {
      const order = await this.repo.findById(id);
      if (!order) {
        out.push({ id, from: null, orderNo: null, ok: false, error: 'ORDER_NOT_FOUND', message: 'Sipariş bulunamadı' });
        continue;
      }
      const from = order.status as OrderStatus;
      if (from === to) {
        out.push({ id, from, orderNo: order.orderNo, ok: false, error: 'ORDER_ALREADY_IN_STATUS', message: `Sipariş zaten ${to}` });
        continue;
      }
      out.push(
        canOrderTransition(from, to)
          ? { id, from, orderNo: order.orderNo, ok: true }
          : { id, from, orderNo: order.orderNo, ok: false, error: 'ORDER_TRANSITION_INVALID', message: `Sipariş ${from} → ${to} geçişi geçersiz` },
      );
    }
    return out;
  }

  /**
   * Toplu geçiş UYGULAMA — sırayla `transition` çağırır (her biri kendi işleminde; yan etkiler orada).
   * Ön kontrolden geçmiş id'ler beklenir; yine de tek tek hata yakalanır ve satır bazında raporlanır
   * (yarış durumunda 409 ORDER_STATE_CHANGED tüm partiyi düşürmesin).
   */
  async applyBulkTransition(
    ids: readonly string[],
    to: OrderStatus,
    opts: { actor: OrderTransitionContext['actor']; actorId?: string | null; reason?: string | null; now?: Date },
  ): Promise<BulkTransitionCheck[]> {
    const out: BulkTransitionCheck[] = [];
    for (const id of ids) {
      try {
        const before = await this.repo.findById(id);
        const order = await this.transition(id, to, { actor: opts.actor, actorId: opts.actorId ?? null, reason: opts.reason ?? null, now: opts.now });
        out.push({ id, from: (before?.status as OrderStatus | undefined) ?? null, orderNo: order.orderNo, ok: true });
      } catch (err) {
        out.push({ id, from: null, orderNo: null, ok: false, ...errorEnvelope(err) });
      }
    }
    return out;
  }

  /** Not ekleme — `[YYYY-MM-DD HH:mm] metin` satırı eklenir (Europe/Istanbul); toplam üst sınır aşılırsa 400. */
  async appendAdminNote(id: string, text: string, now: Date = new Date()): Promise<Order> {
    const order = await this.requireOrder(id);
    const stamp = formatInTimeZone(now, DEFAULT_TZ, ADMIN_NOTE_STAMP_FORMAT);
    const line = `[${stamp}] ${text.trim()}`;
    const merged = order.adminNote?.trim() ? `${order.adminNote.trim()}\n${line}` : line;
    if (merged.length > ADMIN_NOTE_MAX_LENGTH) {
      throw new BadRequestException({ message: 'Not alanı dolu (sınır aşıldı)', error: 'ADMIN_NOTE_TOO_LONG' });
    }
    return toOrderDto(await this.repo.update(id, { adminNote: merged }), { includePayments: true });
  }

  /** Kurumsal fatura alanları — CORPORATE: ad + vergi/TC no zorunlu. */
  async patchBilling(id: string, dto: OrderBillingPatchDto): Promise<Order> {
    await this.requireOrder(id);
    const corporate = dto.billingParty === 'CORPORATE';
    if (corporate && (!dto.billingName || !dto.billingTaxNo)) {
      throw new BadRequestException({ message: 'Kurumsal fatura için unvan ve vergi/TC no gerekli', error: 'BILLING_CORPORATE_FIELDS_REQUIRED' });
    }
    const data: Prisma.OrderUpdateInput = { billingParty: dto.billingParty };
    if (dto.billingName !== undefined) data.billingName = dto.billingName;
    if (dto.billingTaxNo !== undefined) data.billingTaxNo = dto.billingTaxNo;
    if (dto.billingTaxOffice !== undefined) data.billingTaxOffice = dto.billingTaxOffice;
    return toOrderDto(await this.repo.update(id, data), { includePayments: true });
  }

  /** Manuel GİB e-Arşiv fatura no / PDF yolu. */
  async patchInvoice(id: string, dto: OrderInvoicePatchDto): Promise<Order> {
    await this.requireOrder(id);
    const data: Prisma.OrderUpdateInput = { invoiceNo: dto.invoiceNo };
    if (dto.invoicePdfPath !== undefined) data.invoicePdfPath = dto.invoicePdfPath;
    return toOrderDto(await this.repo.update(id, data), { includePayments: true });
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  /** Ham kayıt (C/F8 iç kullanım: orderNo, cycle bağı vb.). */
  async findRecord(id: string, tx?: Tx): Promise<OrderRecord | null> {
    return this.repo.findById(id, tx);
  }

  async findRecordByOrderNo(orderNo: number, tx?: Tx): Promise<OrderRecord | null> {
    return this.repo.findByOrderNo(orderNo, tx);
  }

  /** F8 checkout: kullanıcının ödemesi tamamlanmamış checkout siparişleri (yeni → eski). */
  findOpenCheckoutOrdersForUser(userId: string, tx?: Tx): Promise<OrderRecord[]> {
    return this.repo.findOpenCheckoutOrdersForUser(userId, tx);
  }

  /** F8 `payments:reconcile`: ödemesiz kalmış eski checkout siparişleri. */
  findStaleUnpaidOrders(olderThan: Date, take = 200, tx?: Tx): Promise<OrderRecord[]> {
    return this.repo.findStaleUnpaidOrders(olderThan, take, tx);
  }

  private async requireOrder(id: string): Promise<OrderRecord> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException({ message: 'Sipariş bulunamadı', error: 'ORDER_NOT_FOUND' });
    return row;
  }

  private async requireCycle(ref: CycleRef, tx: Tx): Promise<CycleForOrderRecord> {
    const id = typeof ref === 'string' ? ref : ref.id;
    const cycle = await this.repo.findCycleForOrder(id, tx);
    if (!cycle) throw new NotFoundException({ message: 'Cycle bulunamadı', error: 'CYCLE_NOT_FOUND' });
    return cycle;
  }
}

// ── Saf yardımcılar (test edilebilir; DB yok) ──────────────────────────────────

/** Snapshot satırı → Prisma createMany girdisi. */
export function toLineCreate(l: OrderLineSnapshotInput): Prisma.OrderLineCreateManyOrderInput {
  return {
    kind: l.kind,
    productId: l.productId ?? null,
    tierSlug: l.tierSlug ?? null,
    name: clip(l.name, 160),
    unit: l.unit ? clip(l.unit, 40) : null,
    qty: dec3(l.qty),
    unitPrice: dec2(l.unitPrice),
    lineTotal: dec2(l.lineTotal),
    vatRate: l.vatRate,
    pref: l.pref ? clip(l.pref, 60) : null,
    lotCode: l.lotCode ? clip(l.lotCode, 40) : null,
    metadata: l.metadata ? (l.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

/** Satır KDV'si indirim sonrası (indirim yalnız BOX satırına iner) — shared applyVat kuralı; Σ ham → kuruş. */
export function computeVatTotal(lines: readonly OrderLineSnapshotInput[], boxDiscount: Money): Money {
  let raw = 0;
  let discountLeft = roundMoney(boxDiscount);
  for (const l of lines) {
    let base = l.lineTotal;
    if (l.kind === OrderLineKind.BOX && discountLeft > 0) {
      const d = Math.min(discountLeft, base);
      base = roundMoney(base - d);
      discountLeft = roundMoney(discountLeft - d);
    }
    raw += vatFromGrossRaw(base, l.vatRate);
  }
  return roundMoney(raw);
}

/** DELTA siparişi: indirim (peşin ödenmiş kısım) satırlara sırayla düşülür, KDV kalan tutar üzerinden (BOX satırı yok). */
export function computeVatTotalAfterDiscount(lines: readonly OrderLineSnapshotInput[], discount: Money): Money {
  let raw = 0;
  let left = roundMoney(discount);
  for (const l of lines) {
    const d = Math.min(left, l.lineTotal);
    left = roundMoney(left - d);
    raw += vatFromGrossRaw(Math.max(0, roundMoney(l.lineTotal - d)), l.vatRate);
  }
  return roundMoney(raw);
}

type CycleItem = CycleForOrderRecord['items'][number];

const isBoxContent = (i: CycleItem): boolean => i.source === 'TEMPLATE' || i.source === 'SWAP';
const isExtra = (i: CycleItem): boolean => i.source === 'EXTRA' || i.source === 'CART_MERGE';

/** BOX satırı: tier fiyatı snapshot'ı + kutu içeriği (metadata.items). */
export function buildBoxLine(cycle: CycleForOrderRecord, boxPrice: Money, vatRate: number): OrderLineSnapshotInput {
  const tier = cycle.subscription.tier;
  const items: OrderLineBoxMetadata['items'] = cycle.items.filter(isBoxContent).map((i) => ({
    productId: i.productId,
    slug: i.product.slug,
    name: i.product.name,
    pref: i.pref,
    boxAmount: i.product.boxAmount ?? i.label ?? null,
    lotCode: i.lotCode ?? i.lot?.lotCode ?? null,
  }));
  return {
    kind: OrderLineKind.BOX,
    tierSlug: tier.slug,
    name: tier.label,
    unit: 'kutu',
    qty: 1,
    unitPrice: roundMoney(boxPrice),
    lineTotal: roundMoney(boxPrice),
    vatRate,
    metadata: { items } satisfies OrderLineBoxMetadata,
  };
}

/** EXTRA satırları: unitPrice = kilit snapshot'ı (yoksa ürün fiyatı; telafi 0), qty = çarpan, lineTotal tam TL (cart.js subExtraPrice). */
export function buildExtraLines(items: readonly CycleItem[]): OrderLineSnapshotInput[] {
  return items.filter(isExtra).map((i) => {
    const unitPrice = i.unitPrice !== null ? num(i.unitPrice) : num(i.product.price);
    const qty = num(i.qty);
    return {
      kind: OrderLineKind.EXTRA,
      productId: i.productId,
      name: i.label && i.label !== i.product.name ? `${i.product.name} · ${i.label}` : i.product.name,
      unit: i.unit ?? i.product.unit,
      qty,
      unitPrice,
      lineTotal: roundExtraPrice(unitPrice, qty),
      vatRate: i.product.vatRate,
      pref: i.pref,
      lotCode: i.lotCode ?? i.lot?.lotCode ?? null,
    };
  });
}

/** DELTA: checkout Order'ında peşin ödenmiş EXTRA satırlarıyla (productId + qty) bire bir eşleşenleri düş. */
export function excludePrepaidExtras(extras: OrderLineSnapshotInput[], prepaidLines: readonly OrderLineRecord[]): OrderLineSnapshotInput[] {
  const pool = prepaidLines
    .filter((l) => l.kind === 'EXTRA')
    .map((l) => ({ productId: l.productId, qty: num(l.qty), used: false }));
  return extras.filter((e) => {
    const hit = pool.find((p) => !p.used && p.productId === e.productId && p.qty === e.qty);
    if (hit) {
      hit.used = true;
      return false;
    }
    return true;
  });
}

/** Abonelikten müşteri + adres snapshot'ı (adres silinmişse kullanıcı alanları; telefon yoksa boş — cron yolu kesilmez, uyarı loglanır). */
export function snapshotFromSubscription(cycle: CycleForOrderRecord): { customer: { name: string; email: string; phone: string }; address: AddressSnapshot } {
  const sub = cycle.subscription;
  const addr = sub.address;
  const name = clip((addr?.fullName ?? sub.user.name ?? sub.user.email).trim(), 120);
  const phone = clip((addr?.phone ?? sub.user.phone ?? '').trim(), 30);
  const address: AddressSnapshot = addr
    ? { fullName: addr.fullName, phone: addr.phone, line: addr.line, zoneId: addr.zoneId, zoneName: addr.zone.name, zip: addr.zip }
    : { fullName: name, phone, line: '', zoneId: sub.zoneId, zoneName: sub.zone.name, zip: null };
  return { customer: { name, email: clip(sub.user.email, 160), phone }, address };
}

/** Order kaydı → Notifier `order.paid` yükü (sipariş özeti + onaylanan yasal belgelerin politikalar.html#slug bağlantıları). */
export function buildNotifierOrder(order: OrderRecord): NotifierOrder {
  const base = webUrl();
  const snapshot = (order.addressSnapshot ?? {}) as Partial<AddressSnapshot>;
  const seen = new Set<string>();
  const legalDocuments = order.consents
    .filter((c) => c.granted && c.document !== null)
    .map((c) => c.document!)
    .filter((d) => {
      const key = `${d.slug}:${d.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((d) => ({ slug: d.slug, version: d.version, title: d.title, url: `${base}/politikalar.html#${d.slug}` }));
  return {
    id: order.id,
    orderNo: order.orderNo,
    kind: order.kind,
    status: order.status,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryOn: utcToIsoDate(order.deliveryOn),
    deliveryDay: order.deliveryDay,
    addressLine: snapshot.line ?? '',
    zoneName: snapshot.zoneName ?? order.zone?.name ?? '',
    lines: order.lines.map((l) => ({ kind: l.kind, name: l.name, qty: num(l.qty), unit: l.unit, pref: l.pref, lineTotal: toMoney(l.lineTotal) })),
    subtotal: toMoney(order.subtotal),
    discountTotal: toMoney(order.discountTotal),
    shippingFee: toMoney(order.shippingFee),
    vatTotal: toMoney(order.vatTotal),
    grandTotal: toMoney(order.grandTotal),
    couponCode: order.couponCode,
    isSubscription: order.kind === OrderKind.SUBSCRIPTION,
    isOneTimeBox: order.kind === OrderKind.BOX_ONE_TIME,
    paidAt: order.paidAt ?? new Date(),
    legalDocuments,
    orderUrl: `${base}/uyelik.html`,
  };
}

/** Admin sorgu → filtre: from/to Europe/Istanbul takvim günü (dahil) → UTC instant; deliveryOn → UTC gece yarısı. */
export function resolveFilter(query: AdminOrdersQueryDto): OrderListFilter {
  const filter: OrderListFilter = { status: query.status, kind: query.kind, q: query.q || undefined };
  if (query.from) filter.createdFrom = fromZonedTime(`${assertIsoDate('from', query.from)}T00:00:00`, DEFAULT_TZ);
  if (query.to) {
    const next = utcToIsoDate(new Date(isoDateToUtc(assertIsoDate('to', query.to)).getTime() + 86_400_000));
    filter.createdToExclusive = fromZonedTime(`${next}T00:00:00`, DEFAULT_TZ);
  }
  if (filter.createdFrom && filter.createdToExclusive && filter.createdToExclusive.getTime() <= filter.createdFrom.getTime()) {
    throw new BadRequestException('to, from tarihinden önce olamaz');
  }
  if (query.deliveryOn) filter.deliveryOn = isoDateToUtc(assertIsoDate('deliveryOn', query.deliveryOn));
  return filter;
}

function assertIsoDate(field: string, value: string): string {
  try {
    isoDateToUtc(value);
    return value;
  } catch {
    throw new BadRequestException(`${field} takvimde olmayan bir gün: ${value}`);
  }
}
