import { ConflictException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type PaymentsReconcileResult } from '@bagdam/shared';
import type { PaymentRecord } from '../payments/payments.repository';
import {
  PaymentsService,
  type PaymentOutcomeListener,
  type PaymentOutcomeResult,
  type PaymentSettleFailure,
  type PaymentSettleSuccess,
} from '../payments/payments.service';
import { PaymentProviderFactory } from '../payments/providers/payment-provider.factory';
import { PaymentSettlementService } from '../payments/settlement/payment-settlement.service';
import type { OrderRecord } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import type { Tx } from '../orders/orders.types';
import { CyclesService } from '../subscriptions/services/cycles.service';
import { SubscriptionsService } from '../subscriptions/services/subscriptions.service';
import { CheckoutRepository } from './checkout.repository';

/** `payments:reconcile` zaman eşikleri. */
export const RECONCILE_STALE_PAYMENT_MINUTES = 30;
export const RECONCILE_EXPIRE_HOURS = 24;
/** Checkout'ta "devam eden ödeme" penceresi: açık ödeme bu kadar yeniyse yeni abonelik checkout'u 409 CHECKOUT_IN_PROGRESS. */
export const CHECKOUT_IN_PROGRESS_MINUTES = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface ReconcileOptions {
  staleMinutes?: number;
  expireHours?: number;
  take?: number;
}

/**
 * CheckoutCompletionService — CHECKOUT ödemesi SONUCU orkestrasyonu (F8; state-machines §1.2 PENDING_PAYMENT→PAID/PAYMENT_FAILED/CANCELLED, §2 PENDING→ACTIVE).
 * Motor ödemeleri (kind LINK/CYCLE_CHARGE/DELTA/RETRY) PaymentsModule'ün varsayılan dinleyicisine (PaymentSettlementService — A) devredilir.
 *  - `PaymentOutcomeListener` olarak `PaymentsService.registerOutcomeListener(this)` (onModuleInit): sağlayıcı callback'i (PayTR — A) ya da
 *    `payments:reconcile` `PaymentsService.settleByConversationId/settlePayment` çağırınca buraya düşer:
 *      onSucceeded: Order PAYMENT_FAILED→PENDING_PAYMENT→PAID (kupon usedCount++ + `order.paid` e-postası OrdersService.transition'da) →
 *                   saklı kart (utoken/ctoken) → PaymentMethod upsert → abonelik PENDING→ACTIVE (cycle#1, ilk-kutu sayacı, ensure). Idempotent.
 *      onFailed:    Order PENDING_PAYMENT→PAYMENT_FAILED (abonelik PENDING kalır; müşteri yeniden deneyebilir).
 *  - `abandonOrder`: ödemesiz siparişi kapatır — Payment EXPIRED, abonelik PENDING→CANCELLED (cycle#1 CANCELLED + DD iade, Order CANCELLED —
 *    CyclesService.cancelSubscription) ya da tekil sipariş CANCELLED (DD iade). Checkout'ta eski taslak temizliği + reconcile bunu kullanır.
 *  - `reconcile(now)`: PENDING > 30 dk CHECKOUT ödemeleri → sağlayıcı `retrieve` (manuel sağlayıcıda uzak durum yok → atlanır) →
 *    SUCCEEDED/FAILED yerleşir; hâlâ bekliyorsa 24 s sonra EXPIRED + abandon; ödemesiz eski siparişler (> 24 s) iptal.
 * Prisma yalnız repository'lerde; zaman `now` parametreyle (ADR-0004).
 */
@Injectable()
export class CheckoutCompletionService implements PaymentOutcomeListener, OnModuleInit {
  private readonly logger = new Logger(CheckoutCompletionService.name);

  constructor(
    private readonly repo: CheckoutRepository,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
    private readonly orders: OrdersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly cycles: CyclesService,
    /** Motor ödemeleri (LINK / CYCLE_CHARGE / DELTA / RETRY) için varsayılan yerleşim (A): cycle CHARGED + Order PAID — bu sınıf yalnız CHECKOUT'u işler. */
    private readonly settlement: PaymentSettlementService,
  ) {}

  onModuleInit(): void {
    this.payments.registerOutcomeListener(this);
  }

  // ── PaymentOutcomeListener ────────────────────────────────────────────────────────────────────────────────────────

  async onSucceeded(payment: PaymentRecord, ctx: PaymentSettleSuccess): Promise<PaymentOutcomeResult | null> {
    if (payment.kind !== 'CHECKOUT') return this.settlement.onSucceeded(payment, ctx); // motor ödemeleri (link/MIT) → PaymentSettlementService
    const now = ctx.paidAt ?? new Date();
    const actor = ctx.actor ?? 'PSP';
    const order = await this.orders.findRecord(payment.orderId);
    if (!order) {
      this.logger.error(`onSucceeded: sipariş yok (payment ${payment.id}, order ${payment.orderId})`);
      return null;
    }
    const result = await this.repo.transaction(async (tx) => {
      let current = order;
      if (current.status === 'PAYMENT_FAILED') {
        current = await this.orders.transition(current.id, 'PENDING_PAYMENT', { actor, now, releaseDeliveryDate: false }, tx);
      }
      if (current.status === 'PENDING_PAYMENT') {
        current = await this.orders.transition(current.id, 'PAID', { actor, now, releaseDeliveryDate: false }, tx);
      } else if (current.status !== 'PAID') {
        // CANCELLED/REFUNDED vb. terminal: para alındı ama sipariş kapanmış → ops iade eder (log; yeniden teslimlerde tekrar etmesin)
        this.logger.error(`onSucceeded: sipariş #${current.orderNo} ${current.status} durumunda — ödeme ${payment.conversationId} alındı, el ile inceleme/iade gerekir`);
        return { orderId: current.id, orderNo: current.orderNo, orderStatus: current.status, subscriptionId: current.subscriptionId };
      }
      let paymentMethodId: string | null = payment.paymentMethodId;
      if (ctx.storedCard && current.userId) {
        try {
          const pm = await this.payments.upsertStoredCard(current.userId, payment.provider, ctx.storedCard, tx);
          paymentMethodId = pm.id;
        } catch (err) {
          this.logger.error(`onSucceeded: saklı kart yazılamadı (#${current.orderNo}): ${(err as Error).message}`);
        }
      }
      if (current.subscriptionId) {
        try {
          await this.subscriptions.activate(current.subscriptionId, { paymentMethodId, now }, tx);
        } catch (err) {
          // Abonelik PENDING değilse (ör. iptal edilmiş taslak) 409: sipariş PAID kaldı, ops bakar — yeniden teslimde tekrar etmesin
          if (err instanceof ConflictException) this.logger.error(`onSucceeded: abonelik aktifleştirilemedi (#${current.orderNo}): ${err.message}`);
          else throw err;
        }
      }
      return { orderId: current.id, orderNo: current.orderNo, orderStatus: 'PAID', subscriptionId: current.subscriptionId };
    });
    this.logger.log(`Ödeme yerleşti: #${result.orderNo} → ${result.orderStatus} (${payment.conversationId}, ${actor})`);
    return result;
  }

  async onFailed(payment: PaymentRecord, ctx: PaymentSettleFailure): Promise<PaymentOutcomeResult | null> {
    if (payment.kind !== 'CHECKOUT') return this.settlement.onFailed(payment, ctx);
    const now = new Date();
    const actor = ctx.actor ?? 'PSP';
    const order = await this.orders.findRecord(payment.orderId);
    if (!order) return null;
    if (order.status !== 'PENDING_PAYMENT') {
      return { orderId: order.id, orderNo: order.orderNo, orderStatus: order.status, subscriptionId: order.subscriptionId };
    }
    const updated = await this.orders.transition(order.id, 'PAYMENT_FAILED', { actor, now, releaseDeliveryDate: false });
    this.logger.warn(`Ödeme başarısız: #${updated.orderNo} → PAYMENT_FAILED (${payment.conversationId}: ${ctx.failureCode})`);
    return { orderId: updated.id, orderNo: updated.orderNo, orderStatus: updated.status, subscriptionId: updated.subscriptionId };
  }

  // ── Vazgeçilmiş / süresi dolmuş checkout ──────────────────────────────────────────────────────────────────────────

  /**
   * Ödemesiz siparişi kapatır (tek işlem): açık ödemeler EXPIRED; abonelik PENDING ise CyclesService.cancelSubscription
   * (cycle#1 CANCELLED + DD iade + Order CANCELLED + SubscriptionEvent); değilse Order CANCELLED (tekil: DD iade). Zaten kapalıysa dokunmaz.
   */
  async abandonOrder(order: OrderRecord, reason: string, now: Date, tx?: Tx): Promise<'cancelled' | 'noop'> {
    const run = async (db: Tx): Promise<'cancelled' | 'noop'> => {
      for (const p of order.payments) {
        if (p.status === 'PENDING' || p.status === 'REQUIRES_3DS') await this.payments.markExpired(p.id, db);
      }
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PAYMENT_FAILED') return 'noop';
      if (order.subscriptionId && order.subscription?.status === 'PENDING') {
        await this.cycles.cancelSubscription(order.subscriptionId, { actor: 'SYSTEM', reason, requestedAt: now }, now, db);
        const after = await this.orders.findRecord(order.id, db);
        if (after && (after.status === 'PENDING_PAYMENT' || after.status === 'PAYMENT_FAILED')) {
          await this.orders.transition(order.id, 'CANCELLED', { actor: 'SYSTEM', reason, now, releaseDeliveryDate: false }, db);
        }
        return 'cancelled';
      }
      await this.orders.transition(order.id, 'CANCELLED', { actor: 'SYSTEM', reason, now, releaseDeliveryDate: order.subscriptionId === null }, db);
      return 'cancelled';
    };
    return tx ? run(tx) : this.repo.transaction(run);
  }

  // ── payments:reconcile ────────────────────────────────────────────────────────────────────────────────────────────

  async reconcile(now: Date, opts: ReconcileOptions = {}): Promise<PaymentsReconcileResult> {
    const staleMinutes = opts.staleMinutes ?? RECONCILE_STALE_PAYMENT_MINUTES;
    const expireHours = opts.expireHours ?? RECONCILE_EXPIRE_HOURS;
    const take = opts.take ?? 200;
    const result: PaymentsReconcileResult = { checked: 0, succeeded: 0, failed: 0, expired: 0, stillPending: 0, staleOrdersCancelled: 0, errors: 0 };
    const expireBefore = new Date(now.getTime() - expireHours * HOUR_MS);
    const handledOrders = new Set<string>();

    const stale = await this.payments.findStaleOpenCheckoutPayments(new Date(now.getTime() - staleMinutes * MINUTE_MS), take);
    for (const p of stale) {
      result.checked++;
      try {
        const provider = this.providers.getByEnum(p.provider);
        // Manuel sağlayıcıda uzak durum yok (retrieve sandbox stub) → yalnız süre kontrolü
        if (provider.name !== 'manual' && p.providerToken) {
          const remote = await provider.retrieve(p.providerToken);
          if (remote.status === 'SUCCEEDED') {
            await this.payments.settlePayment(p, { status: 'SUCCEEDED', providerPaymentId: remote.providerPaymentId, rawResponse: remote.raw, storedCard: remote.storedCard, actor: 'SYSTEM', paidAt: now });
            result.succeeded++;
            handledOrders.add(p.orderId);
            continue;
          }
          if (remote.status === 'FAILED') {
            await this.payments.settlePayment(p, { status: 'FAILED', failureCode: remote.failureCode ?? 'PROVIDER_DECLINED', failureMessage: remote.failureMessage, rawResponse: remote.raw, actor: 'SYSTEM' });
            result.failed++;
            handledOrders.add(p.orderId);
            continue;
          }
        }
        if (p.createdAt.getTime() <= expireBefore.getTime()) {
          const order = await this.orders.findRecord(p.orderId);
          if (order) await this.abandonOrder(order, 'Ödeme süresi doldu (checkout tamamlanmadı)', now);
          else await this.payments.markExpired(p.id);
          result.expired++;
          handledOrders.add(p.orderId);
        } else {
          result.stillPending++;
        }
      } catch (err) {
        result.errors++;
        this.logger.error(`reconcile: ödeme ${p.conversationId} işlenemedi: ${(err as Error).message}`);
      }
    }

    const staleOrders = await this.orders.findStaleUnpaidOrders(expireBefore, take);
    for (const order of staleOrders) {
      if (handledOrders.has(order.id)) continue;
      try {
        const r = await this.abandonOrder(order, 'Ödeme tamamlanmadı (checkout zaman aşımı)', now);
        if (r === 'cancelled') result.staleOrdersCancelled++;
      } catch (err) {
        result.errors++;
        this.logger.error(`reconcile: sipariş #${order.orderNo} iptal edilemedi: ${(err as Error).message}`);
      }
    }
    if (result.checked > 0 || result.staleOrdersCancelled > 0) this.logger.log(`reconcile: ${JSON.stringify(result)}`);
    return result;
  }
}
