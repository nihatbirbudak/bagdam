import type { OrderKind, OrderStatus, PaymentStatus } from '@bagdam/shared';
import { cn } from '../../lib/utils';
import { ORDER_KIND_STYLE, ORDER_STATUS_STYLE, PAYMENT_STATUS_STYLE, orderKindLabel, orderStatusLabel, paymentStatusLabel } from './orders';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';
const fallback = 'bg-brand-100 text-brand-600 ring-brand-300';

/** Sipariş durumu rozeti (shared ORDER_STATUS_LABELS). */
export function OrderStatusBadge({ status, className }: { status: OrderStatus | string; className?: string }) {
  return <span className={cn(base, ORDER_STATUS_STYLE[status as OrderStatus] ?? fallback, className)}>{orderStatusLabel(status)}</span>;
}

/** Sipariş türü rozeti (tekil / tek seferlik kutu / abonelik). */
export function OrderKindBadge({ kind, className }: { kind: OrderKind | string; className?: string }) {
  return <span className={cn(base, ORDER_KIND_STYLE[kind as OrderKind] ?? fallback, className)}>{orderKindLabel(kind)}</span>;
}

/** Ödeme durumu rozeti (Payment / Refund). */
export function PaymentStatusBadge({ status, className }: { status: PaymentStatus | string; className?: string }) {
  return <span className={cn(base, PAYMENT_STATUS_STYLE[status as PaymentStatus] ?? fallback, className)}>{paymentStatusLabel(status)}</span>;
}
