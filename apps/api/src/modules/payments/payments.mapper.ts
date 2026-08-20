import type { Money, Payment as PaymentDto, PaymentLinkInfo, Refund as RefundDto, WebhookEvent as WebhookEventDto } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import type { PaymentRecord, PaymentWithOrderRecord, RefundRecord, WebhookEventRecord } from './payments.repository';

/** Prisma Decimal(12,2) → number (TL, kuruş); null → 0. */
export function decimalToMoney(value: Prisma.Decimal | number | null | undefined): Money {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
}

/** number (TL) → Prisma Decimal(12,2). */
export function moneyToDecimal(value: Money): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/** Sağlayıcı ham yanıtı → JSON kolonu (tarih/undefined/döngü temizlenir; yazılamazsa undefined). */
export function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

/** Payment satırı → shared DTO (linkToken istemciye GİTMEZ; müşteriye yalnız URL verilir). */
export function toPaymentDto(row: PaymentRecord | PaymentWithOrderRecord): PaymentDto {
  const orderNo = 'order' in row && row.order ? row.order.orderNo : undefined;
  return {
    id: row.id,
    orderId: row.orderId,
    ...(orderNo !== undefined ? { orderNo } : {}),
    provider: row.provider,
    kind: row.kind,
    conversationId: row.conversationId,
    providerPaymentId: row.providerPaymentId,
    paymentMethodId: row.paymentMethodId,
    amount: decimalToMoney(row.amount),
    status: row.status,
    is3ds: row.is3ds,
    isMerchantInitiated: row.isMerchantInitiated,
    linkExpiresAt: row.linkExpiresAt ? row.linkExpiresAt.toISOString() : null,
    attemptNo: row.attemptNo,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRefundDto(row: RefundRecord): RefundDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amount: decimalToMoney(row.amount),
    reason: row.reason,
    providerRefundId: row.providerRefundId,
    status: row.status,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWebhookEventDto(row: WebhookEventRecord): WebhookEventDto {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.eventType,
    providerRef: row.providerRef,
    signatureValid: row.signatureValid,
    status: row.status,
    error: row.error,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}

/** Public `GET /pay/:linkToken` JSON'u (F7); expired = süre geçti ya da Payment EXPIRED. */
export function toPaymentLinkInfo(row: PaymentWithOrderRecord, now: Date): PaymentLinkInfo {
  const expiresAt = row.linkExpiresAt;
  const expired = row.status === 'EXPIRED' || (expiresAt !== null && expiresAt.getTime() <= now.getTime());
  return {
    status: row.status,
    amount: decimalToMoney(row.amount),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired,
    orderNo: row.order.orderNo,
  };
}
