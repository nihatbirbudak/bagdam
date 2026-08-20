// ── SubscriptionCancellation (iptal akışı) durum makinesi ────────────────────
// Kaynak: BACKEND-PLANI §2 CancelOutcome, §3 cancel uçları, ADR-0007; docs/state-machines.md §5, §11.
// Her iptal akışı bir satırdır (1:N); outcome terminaldir — yeni akış = yeni satır.
import type { CancelOutcome, SubEventType } from '../enums';
import { defineMachine, type TransitionEvents, type TransitionTable } from './machine';

export type CancellationEvent = Extract<SubEventType, 'RETENTION_USED' | 'CANCELLED'> | 'ABANDON';

export const CANCELLATION_TRANSITIONS = {
  PENDING: ['RETENTION_ACCEPTED', 'CANCELLED', 'ABANDONED'],
  RETENTION_ACCEPTED: [],
  CANCELLED: [],
  ABANDONED: [],
} as const satisfies TransitionTable<CancelOutcome>;

export const CANCELLATION_TRANSITION_EVENTS = {
  'PENDING->RETENTION_ACCEPTED': ['RETENTION_USED'], // POST …/retention/accept → Subscription ACTIVE, nextBoxDiscountPct=50
  'PENDING->CANCELLED': ['CANCELLED'], // POST …/cancel/confirm → Subscription CANCELLED, effectiveAt ≤ +7 g, refundDueAt ≤ +15 g
  'PENDING->ABANDONED': ['ABANDON'], // POST …/cancel/abandon ya da zaman aşımı → Subscription ACTIVE (SubEventType karşılığı yok — DOĞRULANMADI)
} as const satisfies TransitionEvents<CancelOutcome, CancellationEvent>;

export const cancellationMachine = defineMachine<CancelOutcome, CancellationEvent>({
  name: 'SubscriptionCancellation',
  initial: 'PENDING',
  transitions: CANCELLATION_TRANSITIONS,
  events: CANCELLATION_TRANSITION_EVENTS,
});

export const canCancellationTransition = (from: CancelOutcome, to: CancelOutcome): boolean => cancellationMachine.canTransition(from, to);
export const assertCancellationTransition = (from: CancelOutcome, to: CancelOutcome): void => cancellationMachine.assertTransition(from, to);
export const CANCELLATION_TERMINAL_STATES: readonly CancelOutcome[] = cancellationMachine.terminalStates;

/** Yasal üst sınırlar (Abonelik Sözleşmeleri Yönetmeliği md.24-25; ADR-0007). */
export const CANCELLATION_MAX_EFFECTIVE_DAYS = 7;
export const CANCELLATION_MAX_REFUND_DAYS = 15;
