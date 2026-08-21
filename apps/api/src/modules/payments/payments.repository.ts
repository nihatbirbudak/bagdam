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

/** PaymentMethod + sahibi (F8: PayTR kayıtlı kart tahsilatında e-posta/ad zorunlu). */
export const PAYMENT_METHOD_WITH_USER_INCLUDE = {
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.PaymentMethodInclude;
export type PaymentMethodWithUserRecord = Prisma.PaymentMethodGetPayload<{ include: typeof PAYMENT_METHOD_WITH_USER_INCLUDE }>;

/** F9 ekran 18: sipariş kaynaklı tahsilat sorunu satırı (PAYMENT_FAILED). */
export const PAYMENT_ISSUE_ORDER_INCLUDE = {
  payments: { orderBy: { createdAt: 'desc' }, take: 5 },
  user: { select: { id: true, email: true, paymentMethods: { where: { isActive: true, deletedAt: null }, select: { id: true }, take: 1 } } },
  subscription: { select: { id: true, status: true, failedCycles: true } },
} satisfies Prisma.OrderInclude;
export type PaymentIssueOrderRecord = Prisma.OrderGetPayload<{ include: typeof PAYMENT_ISSUE_ORDER_INCLUDE }>;

/** F9 ekran 18: cycle kaynaklı tahsilat sorunu satırı (UNPAID / AWAITING_PAYMENT). */
export const PAYMENT_ISSUE_CYCLE_INCLUDE = {
  deliveryDate: { select: { date: true, cutoffAt: true } },
  order: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 5 } } },
  deltaOrder: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 5 } } },
  subscription: {
    select: {
      id: true,
      status: true,
      failedCycles: true,
      paymentMethodId: true,
      user: { select: { id: true, email: true, name: true, phone: true } },
    },
  },
} satisfies Prisma.SubscriptionCycleInclude;
export type PaymentIssueCycleRecord = Prisma.SubscriptionCycleGetPayload<{ include: typeof PAYMENT_ISSUE_CYCLE_INCLUDE }>;

export type PaymentCreateData = Prisma.PaymentUncheckedCreateInput;
export type PaymentUpdateData = Prisma.PaymentUncheckedUpdateInput;
export type PaymentMethodCreateData = Prisma.PaymentMethodUncheckedCreateInput;
export type PaymentMethodUpdateData = Prisma.PaymentMethodUncheckedUpdateInput;
export type RefundCreateData = Prisma.RefundUncheckedCreateInput;
export type RefundUpdateData = Prisma.RefundUncheckedUpdateInput;
export type WebhookEventCreateData = Prisma.WebhookEventUncheckedCreateInput;
export type WebhookEventUpdateData = Prisma.WebhookEventUncheckedUpdateInput;

/**
 * PaymentsRepository — Payment / Refund / WebhookEvent / PaymentMethod; Prisma YALNIZ burada (ADR-0002).
 * Zaman: ham SQL'de now() yok; tüm anlar çağıranın verdiği Date (ADR-0004). Durum geçişleri servis katmanında (state machine).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Verilen `tx` varsa onun içinde, yoksa yeni interaktif işlemde çalıştırır (F8 callback yerleşimi). */
  transaction<T>(fn: (tx: DbClient) => Promise<T>, tx?: DbClient): Promise<T> {
    return tx ? fn(tx) : this.prisma.$transaction((db) => fn(db));
  }

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

  /**
   * PayTR `merchant_oid` / `callback_id` → Payment (F8). Sıra: tam conversationId → providerPaymentId → providerToken →
   * conversationId'nin alfanümerik indirgenmişi (`cyc_<id>_2` → `cyc<id>2`; `regexp_replace`, ham SQL — now() yok).
   * Birden fazla aday (teorik çakışma) → null (çağıran loglar; yanlış ödeme kapatılmaz).
   */
  async findPaymentByMerchantOid(merchantOid: string, tx?: DbClient): Promise<PaymentRecord | null> {
    const db = tx ?? this.prisma;
    const exact = await db.payment.findUnique({ where: { conversationId: merchantOid } });
    if (exact) return exact;
    const byRef = await db.payment.findMany({
      where: { OR: [{ providerPaymentId: merchantOid }, { providerToken: merchantOid }] },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    if (byRef.length === 1) return byRef[0];
    if (byRef.length > 1) return null;
    const rows = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "payments" WHERE regexp_replace("conversationId", '[^A-Za-z0-9]', '', 'g') = ${merchantOid} ORDER BY "createdAt" DESC LIMIT 2`,
    );
    if (rows.length !== 1) return null;
    return db.payment.findUnique({ where: { id: rows[0].id } });
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

  findPaymentMethodWithUser(id: string, tx?: DbClient): Promise<PaymentMethodWithUserRecord | null> {
    return (tx ?? this.prisma).paymentMethod.findUnique({ where: { id }, include: PAYMENT_METHOD_WITH_USER_INCLUDE });
  }

  /** Aynı kullanıcı + sağlayıcı + kart token'ı (PayTR ctoken) — silinmemiş satır (callback'te ikinci kez gelen kart yeniden yazılmaz). */
  findPaymentMethodByToken(userId: string, provider: PaymentProviderEnum, providerCardToken: string, tx?: DbClient): Promise<PaymentMethodRecord | null> {
    return (tx ?? this.prisma).paymentMethod.findFirst({
      where: { userId, provider, providerCardToken, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createPaymentMethod(data: PaymentMethodCreateData, tx?: DbClient): Promise<PaymentMethodRecord> {
    return (tx ?? this.prisma).paymentMethod.create({ data });
  }

  updatePaymentMethod(id: string, data: PaymentMethodUpdateData, tx?: DbClient): Promise<PaymentMethodRecord> {
    return (tx ?? this.prisma).paymentMethod.update({ where: { id }, data });
  }

  /** Kullanıcının diğer kartlarını varsayılan olmaktan çıkarır (yeni kart varsayılan). */
  async clearDefaultPaymentMethods(userId: string, exceptId: string, tx?: DbClient): Promise<number> {
    const r = await (tx ?? this.prisma).paymentMethod.updateMany({ where: { userId, isDefault: true, NOT: { id: exceptId } }, data: { isDefault: false } });
    return r.count;
  }

  // ── F8 (B) — checkout / reconcile / me-cards ─────────────────────────────────────────────────────────────────────

  /** conversationId → Payment + sipariş özeti (CheckoutCompletionService). */
  findPaymentWithOrderByConversationId(conversationId: string, tx?: DbClient): Promise<PaymentWithOrderRecord | null> {
    return (tx ?? this.prisma).payment.findUnique({ where: { conversationId }, include: PAYMENT_WITH_ORDER_INCLUDE });
  }

  /**
   * `payments:reconcile`: verilen türlerde, hâlâ açık (PENDING | REQUIRES_3DS) ve `createdAt <= olderThan` ödemeler
   * (sipariş özeti ile) — eski → yeni, en çok `take`.
   */
  findStaleOpenPayments(
    kinds: readonly ('CHECKOUT' | 'CYCLE_CHARGE' | 'DELTA' | 'RETRY' | 'LINK')[],
    statuses: readonly PaymentStatus[],
    olderThan: Date,
    take: number,
    tx?: DbClient,
  ): Promise<PaymentWithOrderRecord[]> {
    return (tx ?? this.prisma).payment.findMany({
      where: { kind: { in: [...kinds] }, status: { in: [...statuses] }, createdAt: { lte: olderThan } },
      orderBy: { createdAt: 'asc' },
      take,
      include: PAYMENT_WITH_ORDER_INCLUDE,
    });
  }

  /** Kullanıcının aktif (silinmemiş) saklı kartları — varsayılan önce, sonra yeni → eski (`GET /me/cards`). */
  findActivePaymentMethodsForUser(userId: string, tx?: DbClient): Promise<PaymentMethodRecord[]> {
    return (tx ?? this.prisma).paymentMethod.findMany({
      where: { userId, isActive: true, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Kullanıcının aktif saklı kartı (sahiplik denetimiyle). */
  findActivePaymentMethodForUser(id: string, userId: string, tx?: DbClient): Promise<PaymentMethodRecord | null> {
    return (tx ?? this.prisma).paymentMethod.findFirst({ where: { id, userId, isActive: true, deletedAt: null } });
  }

  /** `DELETE /me/cards/:id` → isActive=false (+ deletedAt); satır kalır (Payment/Subscription FK'leri). */
  deactivatePaymentMethod(id: string, now: Date, tx?: DbClient): Promise<PaymentMethodRecord> {
    return (tx ?? this.prisma).paymentMethod.update({ where: { id }, data: { isActive: false, isDefault: false, deletedAt: now } });
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

  // ── F9: Ödeme problemleri (ekran 18) — birleşik liste kaynakları ──────────────────────────────────────────────────

  /** PAYMENT_FAILED siparişler (silinmemiş) + son ödeme denemeleri + müşteri/abonelik bağı. */
  findFailedOrders(where: Prisma.OrderWhereInput, skip: number, take: number, tx?: DbClient): Promise<PaymentIssueOrderRecord[]> {
    return (tx ?? this.prisma).order.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      include: PAYMENT_ISSUE_ORDER_INCLUDE,
    });
  }

  countFailedOrders(where: Prisma.OrderWhereInput, tx?: DbClient): Promise<number> {
    return (tx ?? this.prisma).order.count({ where });
  }

  /** UNPAID / AWAITING_PAYMENT cycle'lar + abonelik/müşteri/sipariş/ödeme bağları (dunning sayaçlarıyla). */
  findProblemCycles(where: Prisma.SubscriptionCycleWhereInput, skip: number, take: number, tx?: DbClient): Promise<PaymentIssueCycleRecord[]> {
    return (tx ?? this.prisma).subscriptionCycle.findMany({
      where,
      orderBy: [{ deliveryDate: { date: 'asc' } }, { id: 'asc' }],
      skip,
      take,
      include: PAYMENT_ISSUE_CYCLE_INCLUDE,
    });
  }

  countProblemCycles(where: Prisma.SubscriptionCycleWhereInput, tx?: DbClient): Promise<number> {
    return (tx ?? this.prisma).subscriptionCycle.count({ where });
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
