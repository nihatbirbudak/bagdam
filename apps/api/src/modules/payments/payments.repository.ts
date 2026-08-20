import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Payment,
  type PaymentMethod,
  type PaymentProvider as PaymentProviderEnum,
  type PaymentStatus,
  type Refund,
  type WebhookEvent,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** İşlem istemcisi — `$transaction` içinden `tx` ya da PrismaService (yapısal olarak uyumlu). */
export type DbClient = Prisma.TransactionClient;

export type PaymentRecord = Payment;
export type PaymentMethodRecord = PaymentMethod;
export type RefundRecord = Refund;
export type WebhookEventRecord = WebhookEvent;

export const PAYMENT_WITH_ORDER_INCLUDE = {
  order: { select: { id: true, orderNo: true, status: true, kind: true, subscriptionId: true, userId: true } },
} satisfies Prisma.PaymentInclude;
export type PaymentWithOrderRecord = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_WITH_ORDER_INCLUDE }>;

export type PaymentCreateData = Prisma.PaymentUncheckedCreateInput;
export type PaymentUpdateData = Prisma.PaymentUncheckedUpdateInput;
export type RefundCreateData = Prisma.RefundUncheckedCreateInput;
export type RefundUpdateData = Prisma.RefundUncheckedUpdateInput;
export type WebhookEventCreateData = Prisma.WebhookEventUncheckedCreateInput;
export type WebhookEventUpdateData = Prisma.WebhookEventUncheckedUpdateInput;

/**
 * PaymentsRepository — Payment / Refund / WebhookEvent / PaymentMethod; Prisma YALNIZ burada (ADR-0002).
 * Zaman: ham SQL yok; tüm anlar çağıranın verdiği Date (ADR-0004). Durum geçişleri servis katmanında (state machine).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Payment ───────────────────────────────────────────────────────────────────────────────────────────────────────

  createPayment(data: PaymentCreateData, tx?: DbClient): Promise<PaymentRecord> {
    return (tx ?? this.prisma).payment.create({ data });
  }

  findPaymentById(id: string, tx?: DbClient): Promise<PaymentRecord | null> {
    return (tx ?? this.prisma).payment.findUnique({ where: { id } });
  }

  findPaymentWithOrderById(id: string, tx?: DbClient): Promise<PaymentWithOrderRecord | null> {
    return (tx ?? this.prisma).payment.findUnique({ where: { id }, include: PAYMENT_WITH_ORDER_INCLUDE });
  }

  findPaymentByConversationId(conversationId: string, tx?: DbClient): Promise<PaymentRecord | null> {
    return (tx ?? this.prisma).payment.findUnique({ where: { conversationId } });
  }

  findPaymentByLinkToken(linkToken: string, tx?: DbClient): Promise<PaymentWithOrderRecord | null> {
    return (tx ?? this.prisma).payment.findUnique({ where: { linkToken }, include: PAYMENT_WITH_ORDER_INCLUDE });
  }

  findPaymentsByOrder(orderId: string, tx?: DbClient): Promise<PaymentRecord[]> {
    return (tx ?? this.prisma).payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  countPaymentsForOrder(orderId: string, tx?: DbClient): Promise<number> {
    return (tx ?? this.prisma).payment.count({ where: { orderId } });
  }

  updatePayment(id: string, data: PaymentUpdateData, tx?: DbClient): Promise<PaymentRecord> {
    return (tx ?? this.prisma).payment.update({ where: { id }, data });
  }

  /** Süresi dolmuş, hâlâ açık (PENDING | REQUIRES_3DS) ödeme linkleri. */
  findExpiredOpenLinks(now: Date, statuses: readonly PaymentStatus[], tx?: DbClient): Promise<PaymentRecord[]> {
    return (tx ?? this.prisma).payment.findMany({
      where: { kind: 'LINK', status: { in: [...statuses] }, linkExpiresAt: { lte: now } },
      orderBy: { linkExpiresAt: 'asc' },
    });
  }

  // ── PaymentMethod ─────────────────────────────────────────────────────────────────────────────────────────────────

  findPaymentMethodById(id: string, tx?: DbClient): Promise<PaymentMethodRecord | null> {
    return (tx ?? this.prisma).paymentMethod.findUnique({ where: { id } });
  }

  // ── Refund ────────────────────────────────────────────────────────────────────────────────────────────────────────

  createRefund(data: RefundCreateData, tx?: DbClient): Promise<RefundRecord> {
    return (tx ?? this.prisma).refund.create({ data });
  }

  updateRefund(id: string, data: RefundUpdateData, tx?: DbClient): Promise<RefundRecord> {
    return (tx ?? this.prisma).refund.update({ where: { id }, data });
  }

  findRefundsByPayment(paymentId: string, tx?: DbClient): Promise<RefundRecord[]> {
    return (tx ?? this.prisma).refund.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
  }

  /** Başarılı iadelerin toplamı (Decimal → number çağıranda). */
  async sumSucceededRefunds(paymentId: string, tx?: DbClient): Promise<Prisma.Decimal> {
    const agg = await (tx ?? this.prisma).refund.aggregate({ where: { paymentId, status: 'SUCCEEDED' }, _sum: { amount: true } });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  // ── WebhookEvent ──────────────────────────────────────────────────────────────────────────────────────────────────

  createWebhookEvent(data: WebhookEventCreateData, tx?: DbClient): Promise<WebhookEventRecord> {
    return (tx ?? this.prisma).webhookEvent.create({ data });
  }

  findWebhookEvent(provider: PaymentProviderEnum, eventType: string, providerRef: string, tx?: DbClient): Promise<WebhookEventRecord | null> {
    return (tx ?? this.prisma).webhookEvent.findUnique({
      where: { provider_eventType_providerRef: { provider, eventType, providerRef } },
    });
  }

  findWebhookEventById(id: string, tx?: DbClient): Promise<WebhookEventRecord | null> {
    return (tx ?? this.prisma).webhookEvent.findUnique({ where: { id } });
  }

  updateWebhookEvent(id: string, data: WebhookEventUpdateData, tx?: DbClient): Promise<WebhookEventRecord> {
    return (tx ?? this.prisma).webhookEvent.update({ where: { id }, data });
  }
}
