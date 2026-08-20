// ── Order durum makinesi ─────────────────────────────────────────────────────
// Kaynak: BACKEND-PLANI §2 OrderStatus, §3 checkout/orders uçları, ADR-0006/0010; docs/state-machines.md §1.
// Order ödendikten sonra içerik olarak DEĞİŞMEZ; yalnız status/paidAt/cancelledAt/invoice alanları ilerler.
import type { OrderStatus } from '../enums';
import { defineMachine, type TransitionEvents, type TransitionTable } from './machine';

/** Order geçişlerini tetikleyen olaylar (Payment callback/webhook, müşteri/ops eylemi, job). */
export type OrderEvent =
  | 'PAYMENT_SUCCEEDED' // Payment SUCCEEDED (callback/webhook/MIT)
  | 'PAYMENT_FAILED' // Payment FAILED / EXPIRED
  | 'PAYMENT_RETRY' // yeni ödeme denemesi (link yeniden gönderildi / saklı kart retry)
  | 'CANCEL' // müşteri (kesimden önce) / ops / sistem (ödeme süresi doldu, dunning tükendi)
  | 'REFUND' // Refund tamamlandı (Payment REFUNDED)
  | 'OPS_PREPARING' // teslimat günü pick/packing başladı
  | 'OPS_OUT_FOR_DELIVERY' // kurye çıktı
  | 'OPS_DELIVERED' // teslim edildi
  | 'OPS_DELIVERY_FAILED' // adreste bulunamadı vb.
  | 'OPS_RESCHEDULED'; // yeniden dağıtıma çıktı

export const ORDER_TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED', 'REFUNDED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERED: ['REFUNDED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'CANCELLED', 'REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
} as const satisfies TransitionTable<OrderStatus>;

export const ORDER_TRANSITION_EVENTS = {
  'PENDING_PAYMENT->PAID': ['PAYMENT_SUCCEEDED'],
  'PENDING_PAYMENT->PAYMENT_FAILED': ['PAYMENT_FAILED'],
  'PENDING_PAYMENT->CANCELLED': ['CANCEL'],
  'PAID->PREPARING': ['OPS_PREPARING'],
  'PAID->CANCELLED': ['CANCEL'], // iade ayrıca Payment/Refund'da izlenir; iade tamamsa doğrudan REFUNDED tercih edilir
  'PAID->REFUNDED': ['REFUND'],
  'PREPARING->OUT_FOR_DELIVERY': ['OPS_OUT_FOR_DELIVERY'],
  'PREPARING->CANCELLED': ['CANCEL'],
  'OUT_FOR_DELIVERY->DELIVERED': ['OPS_DELIVERED'],
  'OUT_FOR_DELIVERY->DELIVERY_FAILED': ['OPS_DELIVERY_FAILED'],
  'DELIVERED->REFUNDED': ['REFUND'], // ayıplı ürün / cayma — 15 gün içinde iade
  'DELIVERY_FAILED->OUT_FOR_DELIVERY': ['OPS_RESCHEDULED'],
  'DELIVERY_FAILED->CANCELLED': ['CANCEL'],
  'DELIVERY_FAILED->REFUNDED': ['REFUND'],
  'PAYMENT_FAILED->PENDING_PAYMENT': ['PAYMENT_RETRY'],
  'PAYMENT_FAILED->CANCELLED': ['CANCEL'],
} as const satisfies TransitionEvents<OrderStatus, OrderEvent>;

export const orderMachine = defineMachine<OrderStatus, OrderEvent>({
  name: 'Order',
  initial: 'PENDING_PAYMENT',
  transitions: ORDER_TRANSITIONS,
  events: ORDER_TRANSITION_EVENTS,
});

export const canOrderTransition = (from: OrderStatus, to: OrderStatus): boolean => orderMachine.canTransition(from, to);
export const assertOrderTransition = (from: OrderStatus, to: OrderStatus): void => orderMachine.assertTransition(from, to);
export const ORDER_TERMINAL_STATES: readonly OrderStatus[] = orderMachine.terminalStates;

/** Müşteri tarafından iptal edilebilir mi (ayrıca kesim kontrolü serviste: DeliveryDate.cutoffAt > now). */
export function isOrderCustomerCancellable(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAID' || status === 'PAYMENT_FAILED';
}

/** Ödemesi alınmış (teslimata konu) sipariş durumları. */
export const ORDER_PAID_STATES: readonly OrderStatus[] = ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'];

/** Ops teslimat akışı sırası (ekran 21 toplu durum güncellemesi). */
export const ORDER_OPS_FLOW: readonly OrderStatus[] = ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
