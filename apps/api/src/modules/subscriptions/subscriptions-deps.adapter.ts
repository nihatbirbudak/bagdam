import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isoDateToUtc, type CycleChargeQuote, type OrderActor } from '@bagdam/shared';
import type { OrderStatus } from '@prisma/client';
import { DeliveryDatesService } from '../delivery/delivery-dates.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord as OrdersOrderRecord } from '../orders/orders.repository';
import { MerchantInitiatedCharge, PaymentLinkCharge } from '../payments/charge/charge-strategy';
import { cycleConversationId, linkConversationId } from '../payments/payments.constants';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import type {
  ChargeOutcome,
  ChargePort,
  CycleOrderContext,
  CyclePricingInput,
  CyclePricingPort,
  DeliveryDatesPort,
  OrderRef,
  OrderTransitionOpts,
  OrdersPort,
  PaymentLinkIssueInput,
  PaymentLinkIssued,
  StoredCardChargeInput,
  SubscriptionsDeps,
  Tx,
} from './subscriptions.deps';
import { isExtraItem, money } from './subscriptions.mapper';

const ORDER_ACTORS: readonly OrderActor[] = ['USER', 'SYSTEM', 'ADMIN', 'OPS', 'PSP'];
/** conversationId çakışmasında denenecek en çok deneme numarası artışı (sonsuz döngü koruması). */
const MAX_ATTEMPT_PROBES = 50;

function toOrderActor(actor: string): OrderActor {
  return (ORDER_ACTORS as readonly string[]).includes(actor) ? (actor as OrderActor) : 'SYSTEM';
}

function toOrderRef(order: OrdersOrderRecord): OrderRef {
  return { id: order.id, orderNo: order.orderNo, status: order.status, grandTotal: money(order.grandTotal) };
}

/**
 * SubscriptionsDepsAdapter — abonelik motorunun dış bağımlılık kapılarını (`SubscriptionsDeps`) gerçek F7 servislerine bağlar
 * (E entegrasyonu; ADR-0002 modül sınırları korunur, Prisma yalnız ilgili modülün repository'sinde):
 *  - pricing.cycleCharge         → `PricingService.cycleCharge` (açık biçim: abonelik/cycle kaydından kurulur; ek DB okuması yok)
 *  - deliveryDates.*             → `DeliveryDatesService.reserve/release/findOrCreateFor/nextFor/isLocked`
 *                                  (reserve 0 satır → 409 `DAY_FULL` | `DAY_CLOSED`; motor `isDayFullError` ile yalnız doluyu yutar)
 *  - orders.createForCycle/…     → `OrdersService.createForCycle/createDeltaForCycle` (cycle.orderId/deltaOrderId'yi motor bağlar → link:false)
 *    orders.transition           → `OrdersService.transition` (DeliveryDate iadesi KAPALI: rezervin sahibi motor — çift iade olmasın;
 *                                  aynı duruma geçiş no-op — idempotent)
 *  - charge.chargeStoredCard     → `MerchantInitiatedCharge.charge` (Payment `cyc_<cycleId>_<attemptNo>`; aynı numara SUCCEEDED ise
 *                                  mevcut sonuç döner — çift tahsilat yok; FAILED/EXPIRED ise ilk boş numara kullanılır — admin/link
 *                                  denemeleriyle çakışma olmaz)
 *    charge.issuePaymentLink     → `PaymentLinkCharge.issue` (`lnk_<cycleId>_<attemptNo>`, linkToken 32 hex, süre Setting paymentLinkHours)
 *    charge.expirePaymentLink    → `PaymentsService.markExpired` (yalnız açık PENDING|REQUIRES_3DS)
 * Tahsilat sonuçlarının cycle/Order/abonelik geçişleri ve SubscriptionEvent'ler motorun işidir (CyclesService); burada yalnız çağrı.
 */
@Injectable()
export class SubscriptionsDepsAdapter implements SubscriptionsDeps {
  private readonly logger = new Logger(SubscriptionsDepsAdapter.name);

  readonly pricing: CyclePricingPort;
  readonly deliveryDates: DeliveryDatesPort;
  readonly orders: OrdersPort;
  readonly charge: ChargePort;

  constructor(
    private readonly pricingService: PricingService,
    private readonly deliveryDatesService: DeliveryDatesService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly mit: MerchantInitiatedCharge,
    private readonly link: PaymentLinkCharge,
    private readonly settings: SettingsService,
  ) {
    this.pricing = { cycleCharge: (input) => this.cycleCharge(input) };
    this.deliveryDates = {
      reserve: async (id, tx) => {
        await this.deliveryDatesService.reserve(id, tx);
      },
      release: (id, tx) => this.deliveryDatesService.release(id, tx),
      findOrCreateFor: (zoneId, date, tx) => this.deliveryDatesService.findOrCreateFor(zoneId, date, tx),
      nextFor: (zoneId, day, after, tx) => this.deliveryDatesService.nextFor(zoneId, day, isoDateToUtc(after), tx),
      isLocked: (dd, now) => this.deliveryDatesService.isLocked(dd, now),
    };
    this.orders = {
      createForCycle: (ctx, tx) => this.createForCycle(ctx, tx, false),
      createDeltaForCycle: (ctx, tx) => this.createForCycle(ctx, tx, true),
      transition: (orderId, to, opts, tx) => this.transitionOrder(orderId, to, opts, tx),
    };
    this.charge = {
      chargeStoredCard: (input, tx) => this.chargeStoredCard(input, tx),
      issuePaymentLink: (input, tx) => this.issuePaymentLink(input, tx),
      expirePaymentLink: (paymentId, now, tx) => this.expirePaymentLink(paymentId, now, tx),
    };
  }

  // ── Pricing ────────────────────────────────────────────────────────────────

  private cycleCharge(input: CyclePricingInput): Promise<CycleChargeQuote> {
    const { subscription: sub, cycle } = input;
    // Kilit anı: ekstralar kendi snapshot'ını (unitPrice) korur, yoksa ürünün güncel fiyatı; kutu = tier'ın güncel fiyatı
    const extras = cycle.items
      .filter(isExtraItem)
      .map((i) => ({ unitPrice: i.unitPrice !== null ? money(i.unitPrice) : money(i.product.price), factor: Number(i.qty.toString()) }));
    // F8 KARAR (SİSTEM-DURUMU F7 notu): cycle#1 (checkout Order'ı bağlı) → kargo checkout Order.shippingFee'de tahsil edildi,
    // prepaidAmount kargo HARİÇ (kutu + ekstralar − indirim) → kesimde DELTA'da kargo yok (tek seferlik kutu dahil).
    const checkoutPaidCycle = cycle.cycleNo === 1 && cycle.orderId !== null;
    return this.pricingService.cycleCharge({
      boxPrice: money(sub.tier.price),
      extras,
      isOneTime: sub.isOneTime,
      zone: checkoutPaidCycle
        ? { fee: 0, freeThreshold: null }
        : { fee: money(sub.zone.fee), freeThreshold: sub.zone.freeThreshold !== null ? money(sub.zone.freeThreshold) : null },
      firstBoxesLeft: sub.discountBoxesLeft,
      retentionPct: sub.nextBoxDiscountPct,
      prepaidAmount: money(cycle.prepaidAmount),
    });
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  private async createForCycle(ctx: CycleOrderContext, tx: Tx, isDelta: boolean): Promise<OrderRef> {
    const commerce = await this.settings.getCommerce();
    const opts = { link: false, vatRate: commerce.vatRate, now: ctx.now };
    const { order } = isDelta
      ? await this.ordersService.createDeltaForCycle({ id: ctx.cycle.id }, ctx.quote, tx, opts)
      : await this.ordersService.createForCycle({ id: ctx.cycle.id }, ctx.quote, tx, opts);
    return toOrderRef(order);
  }

  private async transitionOrder(orderId: string, to: OrderStatus, opts: OrderTransitionOpts, tx?: Tx): Promise<void> {
    const current = await this.ordersService.findRecord(orderId, tx);
    if (!current) throw new NotFoundException({ message: `Sipariş bulunamadı: ${orderId}`, error: 'ORDER_NOT_FOUND' });
    if (current.status === to) return; // idempotent (ör. çökme sonrası yeniden uygulama)
    const actor = toOrderActor(opts.actor);
    await this.ordersService.transition(
      orderId,
      to,
      {
        actor,
        reason: opts.reason ?? (to === 'CANCELLED' || to === 'REFUNDED' ? `${actor}: ${to}` : null),
        now: opts.now,
        // Abonelik siparişlerinde DeliveryDate rezervinin sahibi cycle motoru (state-machines §11) — iade orada yapılır
        releaseDeliveryDate: false,
      },
      tx,
    );
  }

  // ── Charge ─────────────────────────────────────────────────────────────────

  private async chargeStoredCard(input: StoredCardChargeInput, tx?: Tx): Promise<ChargeOutcome> {
    let attemptNo = input.attemptNo;
    for (let probe = 0; probe < MAX_ATTEMPT_PROBES; probe++) {
      const existing = await this.paymentsService.findByConversationId(cycleConversationId(input.cycle.id, attemptNo), tx);
      if (!existing) break;
      if (existing.status === 'SUCCEEDED') {
        this.logger.warn(`chargeStoredCard: ${existing.conversationId} zaten tahsil edilmiş — mevcut sonuç döndü (çift tahsilat yok)`);
        return { paymentId: existing.id, status: 'SUCCEEDED', failureCode: null, failureMessage: null };
      }
      if (existing.status === 'PENDING' || existing.status === 'REQUIRES_3DS') {
        return { paymentId: existing.id, status: 'FAILED', failureCode: 'PAYMENT_PENDING', failureMessage: 'Önceki tahsilat denemesi henüz sonuçlanmadı' };
      }
      attemptNo++; // FAILED/EXPIRED → bir sonraki boş deneme numarası
    }
    const res = await this.mit.charge(
      { id: input.cycle.id, cycleNo: input.cycle.cycleNo, subscriptionId: input.cycle.subscriptionId },
      { id: input.order.id, orderNo: input.order.orderNo, grandTotal: input.amount },
      input.paymentMethod,
      { kind: input.kind, amount: input.amount, attemptNo, now: input.now, tx },
    );
    return { paymentId: res.paymentId, status: res.status, failureCode: res.failureCode, failureMessage: res.failureMessage };
  }

  private async issuePaymentLink(input: PaymentLinkIssueInput, tx?: Tx): Promise<PaymentLinkIssued> {
    let attemptNo = input.attemptNo;
    for (let probe = 0; probe < MAX_ATTEMPT_PROBES; probe++) {
      const existing = await this.paymentsService.findByConversationId(linkConversationId(input.cycle.id, attemptNo), tx);
      if (!existing) break;
      attemptNo++;
    }
    const res = await this.link.issue(
      { id: input.cycle.id, cycleNo: input.cycle.cycleNo, subscriptionId: input.cycle.subscriptionId },
      { id: input.order.id, orderNo: input.order.orderNo, grandTotal: input.amount },
      { amount: input.amount, attemptNo, now: input.now, tx },
    );
    return { paymentId: res.paymentId, linkToken: res.linkToken, linkExpiresAt: new Date(res.linkExpiresAt) };
  }

  private async expirePaymentLink(paymentId: string, _now: Date, tx?: Tx): Promise<void> {
    let payment;
    try {
      payment = await this.paymentsService.requirePayment(paymentId, tx);
    } catch (err) {
      if (err instanceof NotFoundException) return;
      throw err;
    }
    if (payment.status !== 'PENDING' && payment.status !== 'REQUIRES_3DS') return;
    await this.paymentsService.markExpired(paymentId, tx);
  }
}
