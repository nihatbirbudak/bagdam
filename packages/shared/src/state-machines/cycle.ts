// ── SubscriptionCycle durum makinesi ─────────────────────────────────────────
// Kaynak: BACKEND-PLANI §2 CycleStatus/SkipSource, §3 jobs, ADR-0006/0007/0008; docs/state-machines.md §3, §7–§10.
// Olaylar: SubEventType alt kümesi + ops durum güncellemeleri (OPS_*; SubscriptionEvent yazılmaz, cycle satırı kayıttır).
import type { CycleStatus, SubEventType } from '../enums';
import { defineMachine, type TransitionEvents, type TransitionTable } from './machine';

export type CycleEvent =
  | Extract<SubEventType, 'LOCKED' | 'SKIP' | 'UNSKIP' | 'CANCELLED' | 'CHARGED' | 'AWAITING_PAYMENT' | 'PAYMENT_FAILED' | 'RETRY' | 'UNPAID'>
  | 'OPS_PREPARING'
  | 'OPS_OUT_FOR_DELIVERY'
  | 'OPS_DELIVERED';

export const CYCLE_TRANSITIONS = {
  SCHEDULED: ['LOCKED', 'SKIPPED', 'CANCELLED'],
  LOCKED: ['CHARGED', 'AWAITING_PAYMENT', 'UNPAID', 'CANCELLED'],
  AWAITING_PAYMENT: ['CHARGED', 'UNPAID', 'CANCELLED'],
  SKIPPED: ['SCHEDULED'], // yalnız skipSource=USER ve cutoffAt > now (un-skip, hak iade) — servis guard'ı; SKIPPED(OPS/UNPAID) fiilen terminal
  CHARGED: ['PREPARING'],
  UNPAID: ['CHARGED', 'SKIPPED', 'CANCELLED'], // CHARGED: retry başarılı; SKIPPED: retry tükendi (skipSource=UNPAID); CANCELLED: abonelik iptali — DOĞRULANMADI
  PREPARING: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
} as const satisfies TransitionTable<CycleStatus>;

export const CYCLE_TRANSITION_EVENTS = {
  'SCHEDULED->LOCKED': ['LOCKED'], // cycles:lock-and-charge: cutoffAt <= now
  'SCHEDULED->SKIPPED': ['SKIP'], // üye (USER) / ops (OPS) atladı
  'SCHEDULED->CANCELLED': ['CANCELLED'], // abonelik iptali / tek seferlik iptal (kesimden önce)
  'LOCKED->CHARGED': ['CHARGED'], // MIT başarılı ya da tahsil edilecek tutar 0 (cycle#1 DELTA yok)
  'LOCKED->AWAITING_PAYMENT': ['AWAITING_PAYMENT'], // PAYMENT_LINK stratejisi: link gönderildi
  'LOCKED->UNPAID': ['PAYMENT_FAILED'], // MIT başarısız → dunning başlar
  'LOCKED->CANCELLED': ['CANCELLED'], // ops/admin (istisnai) — DOĞRULANMADI
  'AWAITING_PAYMENT->CHARGED': ['CHARGED'], // link ile 3DS ödeme tamam
  'AWAITING_PAYMENT->UNPAID': ['PAYMENT_FAILED'], // cycles:expire-payment-links: paymentDueAt geçti
  'AWAITING_PAYMENT->CANCELLED': ['CANCELLED'],
  'SKIPPED->SCHEDULED': ['UNSKIP'], // DELETE …/skip (hak iade)
  'CHARGED->PREPARING': ['OPS_PREPARING'],
  'UNPAID->CHARGED': ['RETRY', 'CHARGED'], // payments:retry / admin charge / kart güncellendi → başarılı
  'UNPAID->SKIPPED': ['UNPAID'], // retry tükendi → skipSource=UNPAID, failedCycles++
  'UNPAID->CANCELLED': ['CANCELLED'],
  'PREPARING->OUT_FOR_DELIVERY': ['OPS_OUT_FOR_DELIVERY'],
  'OUT_FOR_DELIVERY->DELIVERED': ['OPS_DELIVERED'], // isOneTime → Subscription COMPLETED
} as const satisfies TransitionEvents<CycleStatus, CycleEvent>;

export const cycleMachine = defineMachine<CycleStatus, CycleEvent>({
  name: 'SubscriptionCycle',
  initial: 'SCHEDULED',
  transitions: CYCLE_TRANSITIONS,
  events: CYCLE_TRANSITION_EVENTS,
});

export const canCycleTransition = (from: CycleStatus, to: CycleStatus): boolean => cycleMachine.canTransition(from, to);
export const assertCycleTransition = (from: CycleStatus, to: CycleStatus): void => cycleMachine.assertTransition(from, to);
export const CYCLE_TERMINAL_STATES: readonly CycleStatus[] = cycleMachine.terminalStates;

/** Müşterinin içerik düzenleyebildiği (swap/pref/extras/merge-cart) durum — ayrıca cutoffAt > now şartı serviste. */
export function isCycleEditable(status: CycleStatus): boolean {
  return status === 'SCHEDULED';
}

/** Kilitlenmiş ve teslimata gidecek ("kilitli cycle teslim edilir", ADR-0007) durumlar. */
export const CYCLE_IN_FLIGHT_STATES: readonly CycleStatus[] = ['LOCKED', 'AWAITING_PAYMENT', 'CHARGED', 'UNPAID', 'PREPARING', 'OUT_FOR_DELIVERY'];

/** Pick/packing listesine giren (ödemesi alınmış) durumlar. */
export const CYCLE_FULFILLABLE_STATES: readonly CycleStatus[] = ['CHARGED', 'PREPARING', 'OUT_FOR_DELIVERY'];

/** Ops teslimat akışı sırası (ekran 21). */
export const CYCLE_OPS_FLOW: readonly CycleStatus[] = ['CHARGED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Henüz tahsil edilmemiş/işlenmemiş açık cycle durumları (`Subscription.nextDeliveryOn` hesabında). */
export const CYCLE_OPEN_STATES: readonly CycleStatus[] = ['SCHEDULED', 'SKIPPED', 'LOCKED', 'AWAITING_PAYMENT', 'UNPAID'];
