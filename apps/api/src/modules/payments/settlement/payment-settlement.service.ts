import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { CycleStatus, OrderActor, OrderStatus } from '@bagdam/shared';
import type { OrderRecord } from '../../orders/orders.repository';
import { OrdersService } from '../../orders/orders.service';
import { CyclesService } from '../../subscriptions/services/cycles.service';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service';
import { LINK_CONVERSATION_RE } from '../payments.constants';
import { PaymentsRepository, type DbClient, type PaymentRecord } from '../payments.repository';
import {
  PaymentsService,
  type PaymentOutcomeListener,
  type PaymentOutcomeResult,
  type PaymentSettleFailure,
  type PaymentSettleSuccess,
} from '../payments.service';

/** `onSucceeded` ayrıntılı sonucu (test/log). */
export interface SettlementDetail extends PaymentOutcomeResult {
  paymentMethodId: string | null;
  subscriptionActivated: boolean;
  cycleCharged: boolean;
  /** Sipariş PAID yapılamadıysa neden (ör. sipariş bu arada CANCELLED — iade gerekir). */
  orderIssue: string | null;
}

/** Link ödemesiyle kapanabilen cycle durumları (CyclesService.completeLinkPayment: AWAITING_PAYMENT | UNPAID | LOCKED → CHARGED). */
const LINK_SETTLEABLE_CYCLE_STATES: readonly CycleStatus[] = ['AWAITING_PAYMENT', 'UNPAID', 'LOCKED'];

/**
 * PaymentSettlementService — VARSAYILAN `PaymentOutcomeListener` (PaymentsService.settlePayment → dinleyici; state-machines §4.2 yan etkileri).
 * CheckoutModule (B: CheckoutCompletionService — Order + abonelik + kupon + e-posta) kendini kaydettiğinde onun yerine geçer
 * (`registerOutcomeListener` son kayıt kazanır); bu sınıf yalnız kayıtlı dinleyici YOKSA (`onModuleInit`) devreye girer —
 * PayTR callback'i (PaytrCallbackService) ve reconcile sayesinde sipariş/abonelik hiç sahipsiz kalmaz:
 *  onSucceeded: sağlayıcı kart sakladıysa PaymentMethod upsert (PaymentsService.upsertStoredCard) →
 *    kind CHECKOUT/CYCLE_CHARGE/DELTA/RETRY: Order PAID (PAYMENT_FAILED ise önce PENDING_PAYMENT; OrdersService.transition PAID
 *    kupon kullanımı + Notifier `order.paid` e-postasını kendisi üretir); CHECKOUT + Order.subscriptionId →
 *    Subscription PENDING → ACTIVE (SubscriptionsService.activate: cycle#1 sayaçları + ensure) ·
 *    kind LINK: cycle CHARGED + Order PAID CyclesService.completeLinkPayment (`lnk_<cycleId>_<n>`; state-machines §8).
 *  onFailed: CHECKOUT → Order PAYMENT_FAILED. LINK/MIT ödemelerinde sipariş/cycle geçişi motorundur (dunning/expire).
 * SubscriptionsService/CyclesService `ModuleRef` ile tembel çözülür (SubscriptionsModule → PaymentsModule döngüsü; ADR-0002 sınırları
 * korunur: bu servis abonelik tablolarına yazmaz, yalnız motorun kendi uçlarını çağırır). `completeLinkCycle` / `activateSubscription`
 * / `payOrder` B'nin dinleyicisinden de çağrılabilir (public).
 */
@Injectable()
export class PaymentSettlementService implements PaymentOutcomeListener, OnModuleInit {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly repo: PaymentsRepository,
    private readonly orders: OrdersService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    if (!this.payments.hasOutcomeListener()) {
      this.payments.registerOutcomeListener(this);
      this.logger.log('Varsayılan ödeme sonucu dinleyicisi kaydedildi (CheckoutCompletionService kayıt olunca devralır)');
    }
  }

  // ── PaymentOutcomeListener ────────────────────────────────────────────────────────────────────────────────────────

  async onSucceeded(payment: PaymentRecord, ctx: PaymentSettleSuccess): Promise<SettlementDetail | null> {
    const now = ctx.paidAt ?? new Date();
    const actor: OrderActor = ctx.actor ?? 'PSP';
    const core = await this.repo.transaction(async (tx) => {
      let order = await this.orders.findRecord(payment.orderId, tx);
      let paymentMethodId: string | null = payment.paymentMethodId;
      if (ctx.storedCard && order?.userId) {
        const card = await this.payments.upsertStoredCard(order.userId, payment.provider, ctx.storedCard, tx);
        paymentMethodId = card.id;
        if (paymentMethodId !== payment.paymentMethodId) await this.repo.updatePayment(payment.id, { paymentMethodId }, tx);
      }
      let orderIssue: string | null = null;
      let subscriptionActivated = false;
      if (order && payment.kind !== 'LINK') {
        const paid = await this.payOrder(order, actor, now, tx);
        order = paid.order;
        orderIssue = paid.issue;
        if (!orderIssue && payment.kind === 'CHECKOUT' && order.subscriptionId) {
          subscriptionActivated = await this.activateSubscription(order.subscriptionId, paymentMethodId, now, tx);
        }
      }
      return { order, paymentMethodId, subscriptionActivated, orderIssue };
    });

    let cycleCharged = false;
    if (payment.kind === 'LINK') cycleCharged = await this.completeLinkCycle(payment, actor, now);
    const order = payment.kind === 'LINK' ? await this.orders.findRecord(payment.orderId) : core.order;

    this.logger.log(
      `Ödeme yerleşti (varsayılan dinleyici): payment ${payment.id} (${payment.kind}) → sipariş #${order?.orderNo ?? '?'} ${order?.status ?? '-'}` +
        `${core.subscriptionActivated ? ' · abonelik ACTIVE' : ''}${cycleCharged ? ' · cycle CHARGED' : ''}${core.paymentMethodId ? ' · kart kaydı' : ''}` +
        `${core.orderIssue ? ` · SORUN: ${core.orderIssue}` : ''}`,
    );
    if (!order) return null;
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      orderStatus: order.status,
      subscriptionId: order.subscriptionId,
      paymentMethodId: core.paymentMethodId,
      subscriptionActivated: core.subscriptionActivated,
      cycleCharged,
      orderIssue: core.orderIssue,
    };
  }

  async onFailed(payment: PaymentRecord, ctx: PaymentSettleFailure): Promise<SettlementDetail | null> {
    const now = new Date();
    const actor: OrderActor = ctx.actor ?? 'PSP';
    const order = await this.repo.transaction(async (tx) => {
      const current = await this.orders.findRecord(payment.orderId, tx);
      if (!current) return null;
      if (payment.kind !== 'CHECKOUT') return current; // LINK/MIT: cycle motoru (dunning / expire) karar verir
      if (current.status === 'PENDING_PAYMENT') {
        return this.orders.transition(current.id, 'PAYMENT_FAILED', { actor, reason: ctx.failureMessage ?? ctx.failureCode, now, releaseDeliveryDate: false }, tx);
      }
      return current;
    });
    this.logger.warn(`Ödeme başarısız yerleşti (varsayılan dinleyici): payment ${payment.id} (${ctx.failureCode}) → sipariş #${order?.orderNo ?? '?'} ${order?.status ?? '-'}`);
    if (!order) return null;
    return { orderId: order.id, orderNo: order.orderNo, orderStatus: order.status, subscriptionId: order.subscriptionId, paymentMethodId: payment.paymentMethodId, subscriptionActivated: false, cycleCharged: false, orderIssue: null };
  }

  // ── Yeniden kullanılabilir adımlar ────────────────────────────────────────────────────────────────────────────────

  /**
   * Order → PAID (PENDING_PAYMENT; PAYMENT_FAILED ise önce PENDING_PAYMENT — CyclesService.payOrder ile aynı). PAID ise no-op.
   * OrdersService.transition(PAID) kupon kullanımı ve `order.paid` e-postasını kendisi tetikler.
   */
  async payOrder(order: OrderRecord, actor: OrderActor, now: Date, tx: DbClient): Promise<{ order: OrderRecord; issue: string | null }> {
    const status = order.status as OrderStatus;
    if (status === 'PAID') return { order, issue: null };
    if (status === 'PAYMENT_FAILED') {
      await this.orders.transition(order.id, 'PENDING_PAYMENT', { actor, now, releaseDeliveryDate: false }, tx);
    } else if (status !== 'PENDING_PAYMENT') {
      // Ödeme başarılı ama sipariş bu arada iptal/teslimat akışında — para alındı; admin iade eder (SİSTEM-DURUMU notu)
      this.logger.error(`Sipariş #${order.orderNo} ${status} iken ödeme başarılı geldi — PAID yapılmadı, iade gerekebilir`);
      return { order, issue: `Sipariş ${status} iken ödeme alındı` };
    }
    const paid = await this.orders.transition(order.id, 'PAID', { actor, now, releaseDeliveryDate: false }, tx);
    return { order: paid, issue: null };
  }

  /** Abonelik checkout'u: PENDING → ACTIVE (zaten ACTIVE ise idempotent; diğer durumlar 409 → loglanır, ödeme yerleşimi bozulmaz). */
  async activateSubscription(subscriptionId: string, paymentMethodId: string | null, now: Date, tx?: DbClient): Promise<boolean> {
    const subscriptions = this.moduleRef.get(SubscriptionsService, { strict: false });
    try {
      await subscriptions.activate(subscriptionId, { paymentMethodId, now }, tx);
      return true;
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.error(`Abonelik ${subscriptionId} aktifleştirilemedi (${(err.getResponse() as { error?: string }).error ?? err.message}) — ödeme yerleşti, abonelik durumu elle kontrol edilmeli`);
        return false;
      }
      throw err;
    }
  }

  /**
   * LINK ödemesi: `lnk_<cycleId>_<n>` → CyclesService.completeLinkPayment (cycle CHARGED + Order PAID; kendi işlemi). İdempotent:
   * cycle zaten CHARGED/teslimat akışındaysa dokunmaz (false). PaytrCallbackService başarılı LINK bildiriminden sonra da çağırır —
   * hangi PaymentOutcomeListener kayıtlı olursa olsun (B CheckoutCompletionService yalnız Order/abonelik) cycle sahipsiz kalmaz.
   */
  async completeLinkCycle(payment: PaymentRecord, actor: OrderActor, now: Date): Promise<boolean> {
    const m = LINK_CONVERSATION_RE.exec(payment.conversationId);
    if (!m) {
      this.logger.warn(`LINK ödemesi cycle'a eşlenemedi (conversationId ${payment.conversationId}) — yalnız Payment SUCCEEDED`);
      return false;
    }
    const cycles = this.moduleRef.get(CyclesService, { strict: false });
    try {
      const cycle = await cycles.requireCycle(m[1]);
      if (!LINK_SETTLEABLE_CYCLE_STATES.includes(cycle.status)) {
        this.logger.log(`completeLinkCycle: cycle ${m[1]} ${cycle.status} — değişiklik yok (idempotent)`);
        return false;
      }
      await cycles.completeLinkPayment(m[1], { paymentId: payment.id, actor }, now);
      return true;
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.warn(`completeLinkPayment(${m[1]}) 409: ${(err.getResponse() as { error?: string }).error ?? err.message} — cycle zaten kapanmış olabilir`);
        return false;
      }
      if (err instanceof NotFoundException) {
        this.logger.error(`completeLinkCycle: cycle ${m[1]} bulunamadı (payment ${payment.id}) — elle inceleme`);
        return false;
      }
      throw err;
    }
  }
}
