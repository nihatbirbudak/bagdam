import {
  utcToIsoDate,
  type AddressSnapshot,
  type BillingParty,
  type DeliveryDay,
  type Money,
  type Order,
  type OrderKind,
  type OrderLine,
  type OrderLineKind,
  type OrderStatus,
  type OrderStatusResponse,
  type OrderSummary,
  type Payment,
  type PaymentKind,
  type PaymentProvider,
  type PaymentStatus,
  type Refund,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import { CSV_BOM, CSV_EOL, CSV_SEPARATOR, ORDER_CSV_COLUMNS, type OrderCsvColumn } from './orders.constants';
import type { OrderLineRecord, OrderPaymentRecord, OrderRecord, OrderSummaryRecord } from './orders.repository';

/** Prisma Decimal(12,2) → number (TL, kuruş). */
export function toMoney(value: Prisma.Decimal): Money {
  return Number(value.toString());
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toOrderLineDto(row: OrderLineRecord): OrderLine {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind as OrderLineKind,
    productId: row.productId,
    tierSlug: row.tierSlug,
    name: row.name,
    unit: row.unit,
    qty: Number(row.qty.toString()),
    unitPrice: toMoney(row.unitPrice),
    lineTotal: toMoney(row.lineTotal),
    vatRate: row.vatRate,
    pref: row.pref,
    lotCode: row.lotCode,
    metadata: (row.metadata as OrderLine['metadata']) ?? null,
  };
}

/** Payment → shared DTO (linkToken ASLA çıkmaz; rawResponse yok). */
/** Refund satırı → shared DTO (admin sipariş detayı: ödeme altındaki iadeler; F8). */
export function toRefundDto(row: OrderPaymentRecord['refunds'][number]): Refund {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amount: toMoney(row.amount),
    reason: row.reason,
    providerRefundId: row.providerRefundId,
    status: row.status as PaymentStatus,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPaymentDto(row: OrderPaymentRecord): Payment {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider as PaymentProvider,
    kind: row.kind as PaymentKind,
    conversationId: row.conversationId,
    providerPaymentId: row.providerPaymentId,
    paymentMethodId: row.paymentMethodId,
    amount: toMoney(row.amount),
    status: row.status as PaymentStatus,
    is3ds: row.is3ds,
    isMerchantInitiated: row.isMerchantInitiated,
    linkExpiresAt: iso(row.linkExpiresAt),
    attemptNo: row.attemptNo,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    paidAt: iso(row.paidAt),
    createdAt: row.createdAt.toISOString(),
    refunds: (row.refunds ?? []).map(toRefundDto),
  };
}

export interface OrderDtoOptions {
  /** Admin detayı: ödemeler de döner; müşteri detayında yok. */
  includePayments?: boolean;
}

/** Order (+lines[+payments]) → shared `Order` DTO. ipAddress/userAgent/deletedAt çıkmaz. */
export function toOrderDto(row: OrderRecord, opts: OrderDtoOptions = {}): Order {
  const dto: Order = {
    id: row.id,
    orderNo: row.orderNo,
    kind: row.kind as OrderKind,
    status: row.status as OrderStatus,
    userId: row.userId,
    subscriptionId: row.subscriptionId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    zoneId: row.zoneId,
    deliveryDateId: row.deliveryDateId,
    deliveryDay: row.deliveryDay as DeliveryDay,
    deliveryOn: utcToIsoDate(row.deliveryOn),
    addressSnapshot: row.addressSnapshot as unknown as AddressSnapshot,
    billingParty: row.billingParty as BillingParty,
    billingName: row.billingName,
    billingTaxNo: row.billingTaxNo,
    billingTaxOffice: row.billingTaxOffice,
    subtotal: toMoney(row.subtotal),
    discountTotal: toMoney(row.discountTotal),
    shippingFee: toMoney(row.shippingFee),
    vatTotal: toMoney(row.vatTotal),
    grandTotal: toMoney(row.grandTotal),
    couponCode: row.couponCode,
    paidAt: iso(row.paidAt),
    invoiceNo: row.invoiceNo,
    invoicePdfPath: row.invoicePdfPath,
    note: row.note,
    adminNote: row.adminNote,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    lines: row.lines.map(toOrderLineDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (opts.includePayments) dto.payments = row.payments.map(toPaymentDto);
  return dto;
}

/** Liste satırı (`GET /me/orders`, `GET /admin/orders`). */
export function toOrderSummary(row: OrderSummaryRecord): OrderSummary {
  return {
    id: row.id,
    orderNo: row.orderNo,
    kind: row.kind as OrderKind,
    status: row.status as OrderStatus,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    deliveryDay: row.deliveryDay as DeliveryDay,
    deliveryOn: utcToIsoDate(row.deliveryOn),
    grandTotal: toMoney(row.grandTotal),
    lineCount: row._count.lines,
    paidAt: iso(row.paidAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** `GET /orders/:orderNo/status` — sepet.html `?siparis=` sonucu (F8 polling); paymentStatus = en son ödeme kaydı; abonelik durumu varsa. */
export function toOrderStatusResponse(row: OrderRecord): OrderStatusResponse {
  const latest = row.payments[0];
  return {
    orderNo: row.orderNo,
    status: row.status as OrderStatus,
    paymentStatus: latest ? (latest.status as PaymentStatus) : null,
    paidAt: iso(row.paidAt),
    subscriptionId: row.subscriptionId,
    subscriptionStatus: row.subscription?.status ?? null,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 hücre kaçışı: virgül/tırnak/satır sonu içeren değerler tırnaklanır, tırnak ikilenir. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money2 = (d: Prisma.Decimal): string => toMoney(d).toFixed(2);

export function toCsvRecord(row: OrderSummaryRecord): Record<OrderCsvColumn, unknown> {
  return {
    orderNo: row.orderNo,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    kind: row.kind,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    zone: row.zone?.name ?? '',
    deliveryDay: row.deliveryDay,
    deliveryOn: utcToIsoDate(row.deliveryOn),
    subtotal: money2(row.subtotal),
    discountTotal: money2(row.discountTotal),
    shippingFee: money2(row.shippingFee),
    vatTotal: money2(row.vatTotal),
    grandTotal: money2(row.grandTotal),
    paidAt: iso(row.paidAt) ?? '',
    invoiceNo: row.invoiceNo ?? '',
    couponCode: row.couponCode ?? '',
    lineCount: row._count.lines,
  };
}

/** Başlık satırı + kayıtlar; UTF-8 BOM + CRLF (Excel). */
export function toOrdersCsv(rows: OrderSummaryRecord[]): string {
  const header = ORDER_CSV_COLUMNS.join(CSV_SEPARATOR);
  const body = rows.map((row) => {
    const rec = toCsvRecord(row);
    return ORDER_CSV_COLUMNS.map((c) => csvCell(rec[c])).join(CSV_SEPARATOR);
  });
  return `${CSV_BOM}${[header, ...body].join(CSV_EOL)}${CSV_EOL}`;
}
