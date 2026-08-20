import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { canOrderTransition, OrderStatus, type AdminRefundResult, type Money } from '@bagdam/shared';
import { OrdersService } from '../orders/orders.service';
import { toPaymentDto, toRefundDto } from './payments.mapper';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

/** Tam iadede Order → REFUNDED geçişi için varsayılan neden (admin neden vermediyse). */
export const REFUND_ORDER_DEFAULT_REASON = 'Tam iade (admin)';

export interface AdminRefundInput {
  amount: Money;
  reason?: string | null;
  actorId?: string | null;
}

/**
 * PaymentsAdminService — `POST /admin/payments/:id/refund` (F8; BACKEND-PLANI §3 payments admin satırı; state-machines §4.2 SUCCEEDED→REFUNDED,
 * §1.2 PAID|DELIVERED|DELIVERY_FAILED → REFUNDED):
 *  1. PaymentsService.refund → sağlayıcı iadesi + Refund satırı + Payment PARTIAL_REFUNDED/REFUNDED (sağlayıcı reddederse ok:false).
 *  2. Payment tam iade olduysa (REFUNDED) ve Order bu geçişe izin veriyorsa (PAID / DELIVERED / DELIVERY_FAILED) Order → REFUNDED
 *     (OrdersService.transition, aktör ADMIN; kupon kullanımı serbest kalır, tekil siparişte DD rezerv iadesi orada). İzin yoksa
 *     (PREPARING / OUT_FOR_DELIVERY / abonelik cycle'ı vb.) sipariş durumu panelden ayrıca değiştirilir — yanıt `orderStatus` ile bildirir.
 * Prisma yalnız repository'de; sır yok.
 */
@Injectable()
export class PaymentsAdminService {
  private readonly logger = new Logger(PaymentsAdminService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly repo: PaymentsRepository,
    private readonly orders: OrdersService,
  ) {}

  async refund(paymentId: string, input: AdminRefundInput): Promise<AdminRefundResult> {
    const existing = await this.repo.findPaymentWithOrderById(paymentId);
    if (!existing) throw new NotFoundException({ message: 'Ödeme bulunamadı', error: 'PAYMENT_NOT_FOUND' });
    const res = await this.payments.refund(paymentId, input.amount, { reason: input.reason ?? null, requestedBy: input.actorId ?? null });
    let orderStatus: string | null = existing.order?.status ?? null;
    let orderTransitioned = false;
    if (res.ok && res.payment.status === 'REFUNDED' && existing.order) {
      const from = existing.order.status as OrderStatus;
      if (canOrderTransition(from, OrderStatus.REFUNDED)) {
        try {
          const order = await this.orders.transition(existing.order.id, OrderStatus.REFUNDED, {
            actor: 'ADMIN',
            actorId: input.actorId ?? null,
            reason: input.reason?.trim() || REFUND_ORDER_DEFAULT_REASON,
          });
          orderStatus = order.status;
          orderTransitioned = true;
        } catch (err) {
          // İade yapıldı; sipariş geçişi başarısızsa (yarış/başka durum) panelden elle — para hareketi geri alınmaz
          this.logger.error(`refund: sipariş #${existing.order.orderNo} REFUNDED geçişi yapılamadı: ${(err as Error).message}`);
        }
      } else {
        this.logger.warn(`refund: ödeme ${paymentId} tam iade edildi ama sipariş #${existing.order.orderNo} ${from} durumunda — REFUNDED geçişi panelden`);
      }
    }
    return {
      ok: res.ok,
      refund: toRefundDto(res.refund),
      payment: toPaymentDto(res.payment),
      refundedTotal: res.refundedTotal,
      orderId: existing.orderId,
      orderNo: existing.order?.orderNo ?? null,
      orderStatus,
      orderTransitioned,
    };
  }
}
