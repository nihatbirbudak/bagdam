import type { CycleChargeQuote, DeliveryDay, IsoDate, Money } from '@bagdam/shared';
import type { OrderStatus, Prisma } from '@prisma/client';
import type { CycleRecord, DeliveryDateRecord, PaymentMethodRecord, SubscriptionRecord } from './subscriptions.repository';

/**
 * SubscriptionsDeps — abonelik motorunun dış bağımlılık kapıları (B1 pricing/payments/delivery, B2 orders).
 * Varsayılan uygulama `SubscriptionsDepsAdapter` (subscriptions-deps.adapter.ts) gerçek servislere bağlanır; testler/özel
 * kurulumlar `SubscriptionsModule.withDeps(...)` ile başka bir sağlayıcı verebilir:
 *   pricing.cycleCharge        → PricingService.cycleCharge
 *   deliveryDates.*            → DeliveryDatesService.reserve/release/findOrCreateFor/nextFor/isLocked
 *   orders.createForCycle/…    → OrdersService.createForCycle / createDeltaForCycle / transition
 *   charge.*                   → ChargeStrategy (MerchantInitiatedCharge.charge / PaymentLinkCharge.issue) + PaymentsService
 * Tüm çağrılar isteğe bağlı Prisma işlemi (`tx`) alır; motor işlem sınırlarını kendisi çizer (state-machines §7–§9).
 */
export const SUBSCRIPTIONS_DEPS = Symbol('SUBSCRIPTIONS_DEPS');

export type Tx = Prisma.TransactionClient;

// ── Fiyatlama (B1 PricingService.cycleCharge) ─────────────────────────────────

export interface CyclePricingInput {
  /** tier.price (kilit anı fiyatı), zone (kargo kuralı), isOneTime, discountBoxesLeft, nextBoxDiscountPct. */
  subscription: SubscriptionRecord;
  /** EXTRA/CART_MERGE öğeleri (unitPrice snapshot'ı varsa o, yoksa ürün fiyatı) + prepaidAmount. */
  cycle: CycleRecord;
  now: Date;
}

export interface CyclePricingPort {
  cycleCharge(input: CyclePricingInput, tx?: Tx): Promise<CycleChargeQuote>;
}

// ── Teslimat tarihleri (B1 DeliveryDatesService) ─────────────────────────────

export interface DeliveryDatesPort {
  /** Atomik rezerv; dolu/kapalı → 409 `{error:'DAY_FULL'}` (ConflictException). */
  reserve(deliveryDateId: string, tx?: Tx): Promise<void>;
  release(deliveryDateId: string, tx?: Tx): Promise<void>;
  /** (zone, takvim günü) satırı; yoksa bölge kapasitesi + Setting kesim kuralıyla oluşturur. */
  findOrCreateFor(zoneId: string, date: IsoDate, tx?: Tx): Promise<DeliveryDateRecord>;
  nextFor(zoneId: string, day: DeliveryDay, after: IsoDate, tx?: Tx): Promise<DeliveryDateRecord | null>;
  isLocked(deliveryDate: Pick<DeliveryDateRecord, 'cutoffAt' | 'status'>, now: Date): boolean;
}

// ── Siparişler (B2 OrdersService) ────────────────────────────────────────────

export interface CycleOrderContext {
  subscription: SubscriptionRecord;
  /** Snapshot yazılmış (boxPrice/extrasTotal/discount/shippingFee/total) cycle. */
  cycle: CycleRecord;
  quote: CycleChargeQuote;
  now: Date;
}

export interface OrderRef {
  id: string;
  orderNo: number;
  status: OrderStatus;
  grandTotal: Money;
}

export interface OrderTransitionOpts {
  actor: string;
  reason?: string;
  now: Date;
}

export interface OrdersPort {
  /** cycle#n: BOX (+ metadata.items) + EXTRA satırları; grandTotal = quote.due. */
  createForCycle(ctx: CycleOrderContext, tx: Tx): Promise<OrderRef>;
  /** cycle#1 DELTA: yalnız EXTRA satırları; grandTotal = quote.due (ADR-0006). */
  createDeltaForCycle(ctx: CycleOrderContext, tx: Tx): Promise<OrderRef>;
  /** shared order makinesiyle; PAID → paidAt. DeliveryDate rezervini cycle yönetir (çift iade olmasın). */
  transition(orderId: string, to: OrderStatus, opts: OrderTransitionOpts, tx?: Tx): Promise<void>;
}

// ── Tahsilat (B1 ChargeStrategy / PaymentsService) ───────────────────────────

export type ChargeKind = 'CYCLE_CHARGE' | 'DELTA' | 'RETRY';

export interface StoredCardChargeInput {
  cycle: CycleRecord;
  order: OrderRef;
  paymentMethod: PaymentMethodRecord;
  amount: Money;
  kind: ChargeKind;
  /** 1 = kesimdeki ilk deneme; dunning/admin denemeleri artar (conversationId `cyc_<cycleId>_<attemptNo>`). */
  attemptNo: number;
  now: Date;
}

export interface ChargeOutcome {
  paymentId: string;
  status: 'SUCCEEDED' | 'FAILED';
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface PaymentLinkIssueInput {
  cycle: CycleRecord;
  order: OrderRef;
  amount: Money;
  attemptNo: number;
  now: Date;
}

export interface PaymentLinkIssued {
  paymentId: string;
  linkToken: string;
  linkExpiresAt: Date;
}

export interface ChargePort {
  /** MIT (saklı kart, NON3D): Payment kaydı + sonuç. Aynı attemptNo ikinci kez çağrılırsa mevcut sonuç döner (idempotent). */
  chargeStoredCard(input: StoredCardChargeInput, tx?: Tx): Promise<ChargeOutcome>;
  /** PAYMENT_LINK: Payment(kind LINK, linkToken 32 hex, linkExpiresAt = now + Setting commerce.paymentLinkHours). */
  issuePaymentLink(input: PaymentLinkIssueInput, tx?: Tx): Promise<PaymentLinkIssued>;
  /** Açık link ödemesini EXPIRED yapar (zaten kapalıysa dokunmaz). */
  expirePaymentLink(paymentId: string, now: Date, tx?: Tx): Promise<void>;
}

export interface SubscriptionsDeps {
  pricing: CyclePricingPort;
  deliveryDates: DeliveryDatesPort;
  orders: OrdersPort;
  charge: ChargePort;
}
