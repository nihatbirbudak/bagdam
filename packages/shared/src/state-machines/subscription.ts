// ── Subscription durum makinesi ──────────────────────────────────────────────
// Kaynak: BACKEND-PLANI §2 SubscriptionStatus/SubEventType, ADR-0006/0007/0008; docs/state-machines.md §2.
// Olay adları SubEventType ile BİREBİR (SubscriptionEvent.type olarak yazılır; DTO `SubscriptionEvent` ile karışmasın diye tip adı *TransitionEvent).
import type { SubEventType, SubscriptionStatus } from '../enums';
import { defineMachine, type TransitionEvents, type TransitionTable } from './machine';

/** Subscription geçişlerini tetikleyen SubEventType alt kümesi. */
export type SubscriptionTransitionEvent = Extract<
  SubEventType,
  'ACTIVATED' | 'CANCELLED' | 'UNPAID' | 'CHARGED' | 'CANCEL_REQUESTED' | 'RETENTION_USED' | 'RESUMED' | 'COMPLETED' | 'PAUSED'
>;

export const SUBSCRIPTION_TRANSITIONS = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAST_DUE', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'PAUSED'], // PAUSED: P2 (şema-var/UI-yok)
  PAST_DUE: ['ACTIVE', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'], // P2 — DOĞRULANMADI (pause UI yok; admin elle)
  CANCEL_REQUESTED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
} as const satisfies TransitionTable<SubscriptionStatus>;

export const SUBSCRIPTION_TRANSITION_EVENTS = {
  'PENDING->ACTIVE': ['ACTIVATED'], // checkout ödemesi PAID (cycle#1 peşin)
  'PENDING->CANCELLED': ['CANCELLED'], // checkout ödemesi başarısız/süresi doldu ya da müşteri vazgeçti
  'ACTIVE->PAST_DUE': ['UNPAID'], // 2 ardışık UNPAID cycle (dunning.pastDueAfterUnpaid)
  'ACTIVE->CANCEL_REQUESTED': ['CANCEL_REQUESTED'], // POST /me/subscription/cancel
  'ACTIVE->CANCELLED': ['CANCELLED'], // admin doğrudan iptal (akış dışı)
  'ACTIVE->COMPLETED': ['COMPLETED'], // isOneTime: cycle#1 DELIVERED
  'ACTIVE->PAUSED': ['PAUSED'], // P2
  'PAST_DUE->ACTIVE': ['CHARGED'], // herhangi bir başarılı tahsilat (retry / kesim) → failedCycles=0
  'PAST_DUE->CANCELLED': ['CANCELLED'], // admin / müşteri iptali
  'PAUSED->ACTIVE': ['RESUMED'], // P2
  'PAUSED->CANCELLED': ['CANCELLED'], // P2
  'CANCEL_REQUESTED->ACTIVE': ['RETENTION_USED', 'RESUMED'], // teklif kabul | vazgeçti (abandon). RESUMED için DOĞRULANMADI: SubEventType'a CANCEL_ABANDONED eklenebilir
  'CANCEL_REQUESTED->CANCELLED': ['CANCELLED'], // POST …/cancel/confirm
} as const satisfies TransitionEvents<SubscriptionStatus, SubscriptionTransitionEvent>;

export const subscriptionMachine = defineMachine<SubscriptionStatus, SubscriptionTransitionEvent>({
  name: 'Subscription',
  initial: 'PENDING',
  transitions: SUBSCRIPTION_TRANSITIONS,
  events: SUBSCRIPTION_TRANSITION_EVENTS,
});

export const canSubscriptionTransition = (from: SubscriptionStatus, to: SubscriptionStatus): boolean =>
  subscriptionMachine.canTransition(from, to);
export const assertSubscriptionTransition = (from: SubscriptionStatus, to: SubscriptionStatus): void =>
  subscriptionMachine.assertTransition(from, to);
export const SUBSCRIPTION_TERMINAL_STATES: readonly SubscriptionStatus[] = subscriptionMachine.terminalStates;

/** `cycles:ensure` ve `cycles:lock-and-charge` bu durumlardaki abonelikleri işler (PENDING/PAUSED/terminal hariç). */
export const SUBSCRIPTION_ENGINE_ACTIVE_STATES: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'CANCEL_REQUESTED'];

/** "Aynı anda tek aktif abonelik" kuralında sayılan durumlar (ADR-0008; tek seferlik dahil). */
export const SUBSCRIPTION_OCCUPYING_STATES: readonly SubscriptionStatus[] = ['PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCEL_REQUESTED'];

/** uyelik.html'de "aboneliklerim" kartını gösteren durumlar (ADR-0003 istisna 7 metinleri dahil). */
export function isSubscriptionVisibleToCustomer(status: SubscriptionStatus): boolean {
  return status !== 'PENDING' && status !== 'CANCELLED' && status !== 'COMPLETED';
}
