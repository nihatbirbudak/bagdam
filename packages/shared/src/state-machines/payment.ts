// ── Payment durum makinesi ───────────────────────────────────────────────────
// Kaynak: BACKEND-PLANI §2 PaymentStatus/PaymentKind, ADR-0006/0010; docs/state-machines.md §4.
import type { PaymentStatus } from '../enums';
import { defineMachine, type TransitionEvents, type TransitionTable } from './machine';

export type PaymentEvent =
  | 'THREEDS_INITIATED' // Checkout Form / ödeme linki açıldı, 3DS bekleniyor
  | 'PROVIDER_SUCCESS' // callback/webhook/MIT yanıtı başarılı
  | 'PROVIDER_FAILURE' // callback/webhook/MIT yanıtı başarısız
  | 'EXPIRED' // ödeme linki / CF oturumu süresi doldu (cycles:expire-payment-links, checkout zaman aşımı)
  | 'REFUND_FULL' // Refund toplamı = amount
  | 'REFUND_PARTIAL'; // Refund toplamı < amount

export const PAYMENT_TRANSITIONS = {
  PENDING: ['REQUIRES_3DS', 'SUCCEEDED', 'FAILED', 'EXPIRED'],
  REQUIRES_3DS: ['SUCCEEDED', 'FAILED', 'EXPIRED'],
  SUCCEEDED: ['REFUNDED', 'PARTIAL_REFUNDED'],
  FAILED: [],
  REFUNDED: [],
  PARTIAL_REFUNDED: ['REFUNDED'], // ek kısmi iadeler durumu değiştirmez (Refund satırı eklenir); toplam = amount olunca REFUNDED — DOĞRULANMADI
  EXPIRED: [],
} as const satisfies TransitionTable<PaymentStatus>;

export const PAYMENT_TRANSITION_EVENTS = {
  'PENDING->REQUIRES_3DS': ['THREEDS_INITIATED'],
  'PENDING->SUCCEEDED': ['PROVIDER_SUCCESS'], // MIT (NON3D) / ManualProvider
  'PENDING->FAILED': ['PROVIDER_FAILURE'],
  'PENDING->EXPIRED': ['EXPIRED'],
  'REQUIRES_3DS->SUCCEEDED': ['PROVIDER_SUCCESS'],
  'REQUIRES_3DS->FAILED': ['PROVIDER_FAILURE'],
  'REQUIRES_3DS->EXPIRED': ['EXPIRED'],
  'SUCCEEDED->REFUNDED': ['REFUND_FULL'],
  'SUCCEEDED->PARTIAL_REFUNDED': ['REFUND_PARTIAL'],
  'PARTIAL_REFUNDED->REFUNDED': ['REFUND_FULL'],
} as const satisfies TransitionEvents<PaymentStatus, PaymentEvent>;

export const paymentMachine = defineMachine<PaymentStatus, PaymentEvent>({
  name: 'Payment',
  initial: 'PENDING',
  transitions: PAYMENT_TRANSITIONS,
  events: PAYMENT_TRANSITION_EVENTS,
});

export const canPaymentTransition = (from: PaymentStatus, to: PaymentStatus): boolean => paymentMachine.canTransition(from, to);
export const assertPaymentTransition = (from: PaymentStatus, to: PaymentStatus): void => paymentMachine.assertTransition(from, to);
export const PAYMENT_TERMINAL_STATES: readonly PaymentStatus[] = paymentMachine.terminalStates;

/** Hâlâ sonuç beklenen ödemeler (webhook/callback işlenebilir). */
export const PAYMENT_OPEN_STATES: readonly PaymentStatus[] = ['PENDING', 'REQUIRES_3DS'];

/** Tahsil edilmiş sayılan (iade edilebilir) durumlar. */
export const PAYMENT_COLLECTED_STATES: readonly PaymentStatus[] = ['SUCCEEDED', 'PARTIAL_REFUNDED'];
