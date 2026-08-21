/**
 * Ekran 19 (Abonelikler) + ekran 20 (Teslimat Günü) ortak saf yardımcıları — test edilir.
 *
 * Kaynaklar: `@bagdam/shared` durum makineleri (subscriptionMachine / cycleMachine) tek doğruluk kaynağıdır;
 * panel yalnız izinli hedefleri düğme olarak gösterir. Sunucu ayrıca guard uygular (409).
 *
 * Sözleşme (F7): `GET /admin/subscriptions?status&q&page&limit` · `GET /admin/subscriptions/:id`
 * (+cycles +cancellations +events) · `PATCH /admin/subscriptions/:id` · `GET /admin/cycles?date&status&zone` ·
 * `PATCH /admin/cycles/:id/status {status,note?}` · `POST /admin/cycles/:id/charge` ·
 * `POST /admin/cycles/:id/send-payment-link` · `POST /admin/cycles/:id/compensate {productId,qty?,label?,note}`.
 */
import {
  CANCEL_OUTCOME_LABELS,
  CANCEL_REASON_LABELS,
  CHARGE_STRATEGY_LABELS,
  CYCLE_ITEM_SOURCE_LABELS,
  CYCLE_STATUS_LABELS,
  DELIVERY_DAY_LABELS,
  SKIP_SOURCE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUB_EVENT_TYPE_LABELS,
  cycleMachine,
  subscriptionMachine,
  type CancelOutcome,
  type CancelReason,
  type ChargeStrategy,
  type CycleItemSource,
  type CycleStatus,
  type DeliveryDay,
  type SkipSource,
  type SubEventType,
  type SubscriptionStatus,
} from '@bagdam/shared';
import type { AdminSubscriptionsQuery, SubscriptionCycle } from '../../lib/apiTypes';

/* ── Etiketler ─────────────────────────────────────────────────────────── */

export function subscriptionStatusLabel(status: string): string {
  return (SUBSCRIPTION_STATUS_LABELS as Record<string, string>)[status as SubscriptionStatus] ?? status;
}
export function cycleStatusLabel(status: string): string {
  return (CYCLE_STATUS_LABELS as Record<string, string>)[status as CycleStatus] ?? status;
}
export function cycleItemSourceLabel(source: string): string {
  return (CYCLE_ITEM_SOURCE_LABELS as Record<string, string>)[source as CycleItemSource] ?? source;
}
export function skipSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return (SKIP_SOURCE_LABELS as Record<string, string>)[source as SkipSource] ?? source;
}
export function subEventLabel(type: string): string {
  return (SUB_EVENT_TYPE_LABELS as Record<string, string>)[type as SubEventType] ?? type;
}
export function cancelOutcomeLabel(outcome: string): string {
  return (CANCEL_OUTCOME_LABELS as Record<string, string>)[outcome as CancelOutcome] ?? outcome;
}
export function cancelReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return (CANCEL_REASON_LABELS as Record<string, string>)[reason as CancelReason] ?? reason;
}
export function chargeStrategyLabel(strategy: string | null | undefined): string {
  if (!strategy) return '—';
  return (CHARGE_STRATEGY_LABELS as Record<string, string>)[strategy as ChargeStrategy] ?? strategy;
}
export function deliveryDayLabel(day: string): string {
  return (DELIVERY_DAY_LABELS as Record<string, string>)[day as DeliveryDay] ?? day;
}

/** "Haftada bir" / "2 haftada bir" — tek seferlik kutuda sıklık gösterilmez. */
export function frequencyLabel(weeks: number, isOneTime = false): string {
  if (isOneTime) return 'Tek seferlik';
  if (weeks === 1) return 'Haftada bir';
  return `${weeks} haftada bir`;
}

/* ── Rozet stilleri (Bağdam paleti) ───────────────────────────────────── */

export const SUBSCRIPTION_STATUS_STYLE: Record<SubscriptionStatus, string> = {
  PENDING: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  ACTIVE: 'bg-olive-soft text-olive-deep ring-olive/30',
  PAST_DUE: 'bg-accent-soft text-accent-dark ring-accent/30',
  PAUSED: 'bg-brand-100 text-brand-500 ring-brand-300',
  CANCEL_REQUESTED: 'bg-fig-soft text-fig-deep ring-fig/30',
  CANCELLED: 'bg-brand-100 text-brand-500 ring-brand-300',
  COMPLETED: 'bg-brand-100 text-brand-600 ring-brand-300',
};

export const CYCLE_STATUS_STYLE: Record<CycleStatus, string> = {
  SCHEDULED: 'bg-brand-100 text-brand-600 ring-brand-300',
  LOCKED: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  AWAITING_PAYMENT: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  SKIPPED: 'bg-brand-100 text-brand-500 ring-brand-300',
  CHARGED: 'bg-olive-soft text-olive-deep ring-olive/30',
  UNPAID: 'bg-accent-soft text-accent-dark ring-accent/30',
  PREPARING: 'bg-fig-soft text-fig-deep ring-fig/30',
  OUT_FOR_DELIVERY: 'bg-fig-soft text-fig-deep ring-fig/30',
  DELIVERED: 'bg-olive-soft text-olive-deep ring-olive/30',
  CANCELLED: 'bg-brand-100 text-brand-500 ring-brand-300',
};

export const CYCLE_ITEM_SOURCE_STYLE: Record<CycleItemSource, string> = {
  TEMPLATE: 'bg-brand-100 text-brand-600 ring-brand-300',
  SWAP: 'bg-fig-soft text-fig-deep ring-fig/30',
  EXTRA: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  CART_MERGE: 'bg-olive-soft text-olive-deep ring-olive/30',
};

/* ── Durum geçişleri ──────────────────────────────────────────────────── */

export interface StatusOption<T extends string> {
  to: T;
  label: string;
  /** Panelde birincil (ops akışı) mı, ikincil (istisnai) mi. */
  primary: boolean;
  danger: boolean;
}

/**
 * Admin'in cycle'a doğrudan veremeyeceği durumlar: LOCKED / UNPAID / AWAITING_PAYMENT
 * (CyclesService.adminSetStatus 409 `CHARGE_NOT_APPLICABLE` — bunlar için charge / send-payment-link uçları).
 */
export const CYCLE_ADMIN_FORBIDDEN_TARGETS: readonly CycleStatus[] = ['LOCKED', 'UNPAID', 'AWAITING_PAYMENT'];

/** Ops akışı hedefleri (birincil düğmeler). */
const CYCLE_OPS_TARGETS: ReadonlySet<CycleStatus> = new Set(['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']);

/** `PATCH /admin/cycles/:id/status` için izinli hedefler (makine ∖ yasaklı). */
export function cycleStatusOptions(from: string): Array<StatusOption<CycleStatus>> {
  if (!(from in CYCLE_STATUS_LABELS)) return [];
  return cycleMachine
    .nextStates(from as CycleStatus)
    .filter((to) => !CYCLE_ADMIN_FORBIDDEN_TARGETS.includes(to))
    .map((to) => ({ to, label: cycleStatusLabel(to), primary: CYCLE_OPS_TARGETS.has(to), danger: to === 'CANCELLED' }));
}

/**
 * Panelde gösterilmeyen abonelik hedefleri: `PAUSED` (P2 — şema-var/UI-yok) ve `PAST_DUE`
 * (motorun dunning sonucu koyduğu durum; elle verilmez — 2 ardışık UNPAID cycle ile oluşur).
 */
export const SUBSCRIPTION_ADMIN_HIDDEN_TARGETS: readonly SubscriptionStatus[] = ['PAUSED', 'PAST_DUE'];

/** `PATCH /admin/subscriptions/:id {status}` için panelde sunulan hedefler. */
export function subscriptionStatusOptions(from: string): Array<StatusOption<SubscriptionStatus>> {
  if (!(from in SUBSCRIPTION_STATUS_LABELS)) return [];
  return subscriptionMachine
    .nextStates(from as SubscriptionStatus)
    .filter((to) => !SUBSCRIPTION_ADMIN_HIDDEN_TARGETS.includes(to))
    .map((to) => ({ to, label: subscriptionStatusLabel(to), primary: to === 'ACTIVE', danger: to === 'CANCELLED' }));
}

/** İptal (CANCELLED) admin tarafında neden ister — `note` alanına yazılır (reasonText). */
export function subscriptionStatusRequiresNote(to: string): boolean {
  return to === 'CANCELLED';
}

/* ── Tahsilat aksiyonları (ekran 18/19) ───────────────────────────────── */

/** `POST /admin/cycles/:id/charge` yalnız LOCKED / AWAITING_PAYMENT / UNPAID cycle'da anlamlı. */
export function canChargeCycle(status: string): boolean {
  return status === 'LOCKED' || status === 'AWAITING_PAYMENT' || status === 'UNPAID';
}

/** `POST /admin/cycles/:id/send-payment-link` aynı üç durumda anlamlı (CyclesService guard'ı ile birebir). */
export function canSendPaymentLink(status: string): boolean {
  return canChargeCycle(status);
}

/** Telafi yalnız kesimi geçmemiş SCHEDULED bir cycle varken uygulanabilir (aksi 409 NO_SCHEDULED_CYCLE). */
export function canCompensate(cycles: ReadonlyArray<Pick<SubscriptionCycle, 'status' | 'cutoffAt'>>, now: Date = new Date()): boolean {
  return cycles.some((c) => c.status === 'SCHEDULED' && !!c.cutoffAt && new Date(c.cutoffAt).getTime() > now.getTime());
}

/* ── Cycle özetleri ───────────────────────────────────────────────────── */

export function cycleAmount(c: Pick<SubscriptionCycle, 'total' | 'prepaidAmount'>): number {
  const total = Number(c.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const prepaid = Number(c.prepaidAmount ?? 0);
  return Number.isFinite(prepaid) ? prepaid : 0;
}

export interface CyclesDigest {
  total: number;
  delivered: number;
  skipped: number;
  unpaid: number;
  scheduled: number;
  charged: number;
  /** Tahsil edilen (CHARGED ve sonrası) cycle'ların toplamı. */
  revenue: number;
}

const REVENUE_STATES: ReadonlySet<string> = new Set(['CHARGED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']);

export function summarizeCycles(cycles: ReadonlyArray<Pick<SubscriptionCycle, 'status' | 'total' | 'prepaidAmount'>>): CyclesDigest {
  const d: CyclesDigest = { total: cycles.length, delivered: 0, skipped: 0, unpaid: 0, scheduled: 0, charged: 0, revenue: 0 };
  for (const c of cycles) {
    if (c.status === 'DELIVERED') d.delivered += 1;
    else if (c.status === 'SKIPPED') d.skipped += 1;
    else if (c.status === 'UNPAID') d.unpaid += 1;
    else if (c.status === 'SCHEDULED') d.scheduled += 1;
    if (c.status === 'CHARGED') d.charged += 1;
    if (REVENUE_STATES.has(c.status)) d.revenue += cycleAmount(c);
  }
  d.revenue = Math.round(d.revenue * 100) / 100;
  return d;
}

/** Cycle listesini yeni → eski sıralar (cycleNo azalan). */
export function sortCyclesDesc<T extends { cycleNo: number }>(cycles: readonly T[]): T[] {
  return [...cycles].sort((a, b) => b.cycleNo - a.cycleNo);
}

/** Olay günlüğü: yeni → eski (createdAt azalan; eşitlikte id ile kararlı). */
export function sortEventsDesc<T extends { createdAt: string; id: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Olay `data` alanını tek satır özete indirger (JSON gösterimi yerine okunur metin). */
export function eventDataSummary(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object') {
      parts.push(`${k}: …`);
      continue;
    }
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(' · ');
}

/* ── Liste filtresi (URL) ─────────────────────────────────────────────── */

export interface SubscriptionsFilterState {
  status: SubscriptionStatus | '';
  q: string;
  /** Yalnız tek seferlik kutular / yalnız abonelikler (istemci tarafı süzgeci; uçta parametre yok). */
  kind: '' | 'subscription' | 'onetime';
  /** Yalnız tahsilat sorunu olanlar (failedCycles > 0 ya da PAST_DUE) — istemci süzgeci. */
  dunning: boolean;
}

export const EMPTY_SUBSCRIPTIONS_FILTER: SubscriptionsFilterState = { status: '', q: '', kind: '', dunning: false };

export function filterFromParams(params: URLSearchParams): SubscriptionsFilterState {
  const status = params.get('status') ?? '';
  const kind = params.get('kind') ?? '';
  return {
    status: (status in SUBSCRIPTION_STATUS_LABELS ? status : '') as SubscriptionStatus | '',
    q: params.get('q') ?? '',
    kind: kind === 'subscription' || kind === 'onetime' ? kind : '',
    dunning: params.get('dunning') === '1',
  };
}

/** Yalnız sunucunun tanıdığı parametreler gönderilir (kind/dunning istemci süzgeci). */
export function toSubscriptionsQuery(f: SubscriptionsFilterState, page?: number, limit?: number): AdminSubscriptionsQuery {
  return { status: f.status || undefined, q: f.q.trim() || undefined, page, limit };
}

export function hasActiveFilter(f: SubscriptionsFilterState): boolean {
  return !!(f.status || f.q.trim() || f.kind || f.dunning);
}

/** İstemci tarafı süzgeç (tür + tahsilat sorunu) — sunucu sayfalaması korunur. */
export function applyClientFilter<T extends { isOneTime: boolean; failedCycles?: number; status: string }>(
  rows: readonly T[],
  f: SubscriptionsFilterState,
): T[] {
  return rows.filter((r) => {
    if (f.kind === 'onetime' && !r.isOneTime) return false;
    if (f.kind === 'subscription' && r.isOneTime) return false;
    if (f.dunning && !((r.failedCycles ?? 0) > 0 || r.status === 'PAST_DUE')) return false;
    return true;
  });
}

/* ── Telafi formu (ekran 19/20) ───────────────────────────────────────── */

export interface CompensateDraft {
  productId: string;
  qty: string;
  label: string;
  note: string;
}

export const EMPTY_COMPENSATE_DRAFT: CompensateDraft = { productId: '', qty: '1', label: '', note: '' };

/** `CycleCompensateDto` ile birebir: productId zorunlu, qty 0<x≤100, label ≤80, note 2–500. */
export function validateCompensateDraft(d: CompensateDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.productId.trim()) errors.productId = 'Ürün seçin';
  const qty = Number(d.qty.trim().replace(',', '.'));
  if (!d.qty.trim() || !Number.isFinite(qty)) errors.qty = 'Geçerli bir miktar girin';
  else if (qty <= 0) errors.qty = 'Miktar sıfırdan büyük olmalı';
  else if (qty > 100) errors.qty = 'Miktar en çok 100 olabilir';
  if (d.label.trim().length > 80) errors.label = 'En fazla 80 karakter';
  const note = d.note.trim();
  if (note.length < 2) errors.note = 'Telafi nedeni gerekli (en az 2 karakter)';
  else if (note.length > 500) errors.note = 'En fazla 500 karakter';
  return errors;
}

export function toCompensateBody(d: CompensateDraft): { productId: string; qty: number; label?: string; note: string } {
  return {
    productId: d.productId.trim(),
    qty: Number(d.qty.trim().replace(',', '.')),
    ...(d.label.trim() ? { label: d.label.trim() } : {}),
    note: d.note.trim(),
  };
}
