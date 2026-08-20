/**
 * Siparişler (ekran 17) — saf yardımcılar (test edilir): durum geçişleri (shared Order makinesi), rozet stilleri,
 * iade edilebilir tutar, adres metni, tarih yardımcıları, özet (Özet kartı), form doğrulamaları (fatura/iade/neden).
 *
 * Sözleşme (F7 OrdersModule): `GET /admin/orders?status&kind&from&to&deliveryOn&q&page&limit` → `{items,total,page,limit}`;
 * `GET /admin/orders/:id` → Order (+payments); `PATCH /admin/orders/:id/status {status,reason?}` (409 ORDER_TRANSITION_INVALID,
 * 400 ORDER_REASON_REQUIRED); `POST /admin/orders/:id/notes {adminNote}`; `PATCH …/billing`; `PATCH …/invoice`;
 * `GET /admin/orders/export.csv` (aynı filtre). İade: `POST /admin/payments/:id/refund {amount,reason?}`.
 */
import {
  ORDER_KIND_LABELS,
  ORDER_PAID_STATES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  orderMachine,
  type AddressSnapshot,
  type BillingParty,
  type OrderEvent,
  type OrderKind,
  type OrderStatus,
  type OrderSummary,
  type Payment,
  type PaymentStatus,
} from '@bagdam/shared';
import type { AdminOrderListQuery, OrderBillingPatch } from '../../lib/apiTypes';
import { parseDecimalInput } from '../../lib/utils';

/* ── Etiket / stil ──────────────────────────────────────────────────────── */

export function orderStatusLabel(status: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status;
}
export function orderKindLabel(kind: string): string {
  return (ORDER_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}
export function paymentStatusLabel(status: string): string {
  return (PAYMENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** Rozet renkleri (Bağdam paleti) — durum anlamına göre: yeşil teslim/ödendi, sarı bekleyen, kırmızı sorun, gri terminal. */
export const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  PAID: 'bg-olive-soft text-olive-deep ring-olive/30',
  PREPARING: 'bg-fig-soft text-fig-deep ring-fig/30',
  OUT_FOR_DELIVERY: 'bg-fig-soft text-fig-deep ring-fig/30',
  DELIVERED: 'bg-olive-soft text-olive-deep ring-olive/30',
  DELIVERY_FAILED: 'bg-accent-soft text-accent-dark ring-accent/30',
  CANCELLED: 'bg-brand-100 text-brand-500 ring-brand-300',
  REFUNDED: 'bg-brand-100 text-brand-600 ring-brand-300',
  PAYMENT_FAILED: 'bg-accent-soft text-accent-dark ring-accent/30',
};

export const ORDER_KIND_STYLE: Record<OrderKind, string> = {
  SINGLE: 'bg-brand-100 text-brand-600 ring-brand-300',
  BOX_ONE_TIME: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  SUBSCRIPTION: 'bg-olive-soft text-olive-deep ring-olive/30',
};

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  PENDING: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  REQUIRES_3DS: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  SUCCEEDED: 'bg-olive-soft text-olive-deep ring-olive/30',
  FAILED: 'bg-accent-soft text-accent-dark ring-accent/30',
  REFUNDED: 'bg-brand-100 text-brand-600 ring-brand-300',
  PARTIAL_REFUNDED: 'bg-fig-soft text-fig-deep ring-fig/30',
  EXPIRED: 'bg-brand-100 text-brand-500 ring-brand-300',
};

/* ── Durum geçişleri (shared makine tek kaynak) ────────────────────────── */

/** Geçişin türü: ops akışı · iptal · iade · ödeme (normalde PSP/job tetikler; panelden istisnai). */
export type OrderTransitionKind = 'ops' | 'cancel' | 'refund' | 'payment';

const OPS_EVENTS: ReadonlySet<OrderEvent> = new Set(['OPS_PREPARING', 'OPS_OUT_FOR_DELIVERY', 'OPS_DELIVERED', 'OPS_DELIVERY_FAILED', 'OPS_RESCHEDULED']);

export interface OrderTransitionOption {
  to: OrderStatus;
  label: string;
  kind: OrderTransitionKind;
  /** CANCELLED / REFUNDED için neden zorunlu (API 400 ORDER_REASON_REQUIRED). */
  requiresReason: boolean;
  /** Panelde birincil düğme (ops akışı + iptal); ödeme/iade geçişleri ikincil ("istisnai"). */
  primary: boolean;
}

export function transitionKind(from: OrderStatus, to: OrderStatus): OrderTransitionKind {
  const events = orderMachine.eventsFor(from, to);
  if (events.some((e) => OPS_EVENTS.has(e))) return 'ops';
  if (events.includes('CANCEL')) return 'cancel';
  if (events.includes('REFUND')) return 'refund';
  return 'payment';
}

export function requiresReason(to: OrderStatus): boolean {
  return to === 'CANCELLED' || to === 'REFUNDED';
}

/** Mevcut durumdan izinli hedefler (shared `orderMachine.nextStates`) — panel düğmeleri yalnız bunları gösterir. */
export function orderTransitionOptions(from: OrderStatus): OrderTransitionOption[] {
  return orderMachine.nextStates(from).map((to) => {
    const kind = transitionKind(from, to);
    return {
      to,
      label: orderStatusLabel(to),
      kind,
      requiresReason: requiresReason(to),
      primary: kind === 'ops' || kind === 'cancel',
    };
  });
}

export function isOrderTerminal(status: OrderStatus): boolean {
  return orderMachine.isTerminal(status);
}

/* ── Ödeme / iade ──────────────────────────────────────────────────────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Başarılı iadelerin toplamı (Refund.status SUCCEEDED). */
export function refundedTotal(p: Pick<Payment, 'refunds'>): number {
  return round2((p.refunds ?? []).filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
}

/** Kalan iade edilebilir tutar: yalnız SUCCEEDED / PARTIAL_REFUNDED ödemelerde, tutar − başarılı iadeler. */
export function refundableAmount(p: Pick<Payment, 'status' | 'amount' | 'refunds'>): number {
  if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIAL_REFUNDED') return 0;
  return Math.max(0, round2((Number(p.amount) || 0) - refundedTotal(p)));
}

export function isPaymentRefundable(p: Pick<Payment, 'status' | 'amount' | 'refunds'>): boolean {
  return refundableAmount(p) > 0;
}

/** İade formu: tutar 0 < x ≤ kalan; neden ≤ 200. Hatalar alan anahtarıyla. */
export function validateRefundDraft(draft: { amount: string; reason: string }, max: number): Record<string, string> {
  const errors: Record<string, string> = {};
  const n = parseDecimalInput(draft.amount);
  if (n === null) errors.amount = 'Geçerli bir tutar girin';
  else if (n <= 0) errors.amount = 'Tutar sıfırdan büyük olmalı';
  else if (n > max + 1e-9) errors.amount = `En çok ${max.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ iade edilebilir`;
  if (draft.reason.trim().length > 200) errors.reason = 'En fazla 200 karakter';
  return errors;
}

/* ── Neden (iptal/iade) ────────────────────────────────────────────────── */

export const ORDER_REASON_MAX = 200;

export function validateReason(reason: string, required: boolean): string | null {
  const r = reason.trim();
  if (required && !r) return 'İptal/iade için neden gerekli';
  if (r.length > ORDER_REASON_MAX) return `En fazla ${ORDER_REASON_MAX} karakter`;
  return null;
}

/* ── Fatura (kurumsal alanlar) ─────────────────────────────────────────── */

export interface BillingDraft {
  billingParty: BillingParty;
  billingName: string;
  billingTaxNo: string;
  billingTaxOffice: string;
}

export function billingToDraft(o: { billingParty: BillingParty; billingName: string | null; billingTaxNo: string | null; billingTaxOffice: string | null }): BillingDraft {
  return {
    billingParty: o.billingParty,
    billingName: o.billingName ?? '',
    billingTaxNo: o.billingTaxNo ?? '',
    billingTaxOffice: o.billingTaxOffice ?? '',
  };
}

/** CORPORATE → unvan + vergi/TC no (10 VKN / 11 TCKN) zorunlu (API 400 BILLING_CORPORATE_FIELDS_REQUIRED). */
export function validateBillingDraft(d: BillingDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const taxNo = d.billingTaxNo.trim();
  if (d.billingParty === 'CORPORATE') {
    if (!d.billingName.trim()) errors.billingName = 'Kurumsal fatura için unvan gerekli';
    if (!taxNo) errors.billingTaxNo = 'Vergi / TC kimlik no gerekli';
  }
  if (taxNo && !/^\d{10,11}$/.test(taxNo)) errors.billingTaxNo = 'Vergi/TC kimlik no 10 ya da 11 rakam olmalı';
  if (d.billingName.trim().length > 200) errors.billingName = 'En fazla 200 karakter';
  if (d.billingTaxOffice.trim().length > 100) errors.billingTaxOffice = 'En fazla 100 karakter';
  return errors;
}

/** PATCH gövdesi: boş metin → null (alan temizlenir). */
export function toBillingPatch(d: BillingDraft): OrderBillingPatch {
  return {
    billingParty: d.billingParty,
    billingName: d.billingName.trim() || null,
    billingTaxNo: d.billingTaxNo.trim() || null,
    billingTaxOffice: d.billingTaxOffice.trim() || null,
  };
}

export function isBillingDirty(a: BillingDraft, b: BillingDraft): boolean {
  return a.billingParty !== b.billingParty || a.billingName.trim() !== b.billingName.trim() || a.billingTaxNo.trim() !== b.billingTaxNo.trim() || a.billingTaxOffice.trim() !== b.billingTaxOffice.trim();
}

/* ── Notlar ────────────────────────────────────────────────────────────── */

export interface AdminNoteLine {
  stamp: string | null;
  text: string;
}

/** `[YYYY-MM-DD HH:mm] metin` satırlarını ayrıştırır (eski serbest metin → stamp null). */
export function parseAdminNotes(adminNote: string | null | undefined): AdminNoteLine[] {
  if (!adminNote || !adminNote.trim()) return [];
  return adminNote
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s*(.*)$/.exec(line);
      return m ? { stamp: m[1], text: m[2] } : { stamp: null, text: line };
    });
}

/* ── Adres / müşteri metinleri ─────────────────────────────────────────── */

export function addressText(a: AddressSnapshot | null | undefined): string {
  if (!a) return '—';
  const parts = [a.line, a.zoneName, a.zip].filter((p) => typeof p === 'string' && p.trim().length > 0);
  return parts.length ? parts.join(' · ') : '—';
}

/* ── Tarih yardımcıları (Europe/Istanbul takvim günü) ─────────────────── */

const TZ = 'Europe/Istanbul';

/** `YYYY-MM-DD` — Europe/Istanbul'daki bugünün takvim günü (ADR-0004; UTC kayması yok). */
export function todayIsoDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Takvim gününe gün ekler (`YYYY-MM-DD` → `YYYY-MM-DD`, TZ'siz aritmetik). */
export function addIsoDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/* ── Liste sorgusu ─────────────────────────────────────────────────────── */

export interface OrdersFilterState {
  status: OrderStatus | '';
  kind: OrderKind | '';
  from: string;
  to: string;
  deliveryOn: string;
  q: string;
}

export const EMPTY_ORDERS_FILTER: OrdersFilterState = { status: '', kind: '', from: '', to: '', deliveryOn: '', q: '' };

/** URL parametreleri → filtre (bilinmeyen durum/tür atılır). */
export function filterFromParams(params: URLSearchParams): OrdersFilterState {
  const status = params.get('status') ?? '';
  const kind = params.get('kind') ?? '';
  return {
    status: (status in ORDER_STATUS_LABELS ? status : '') as OrderStatus | '',
    kind: (kind in ORDER_KIND_LABELS ? kind : '') as OrderKind | '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    deliveryOn: params.get('deliveryOn') ?? '',
    q: params.get('q') ?? '',
  };
}

/** Filtre + sayfalama → API sorgusu (boşlar atılır; `buildQuery` zaten undefined/''yi yazmaz). */
export function toOrdersQuery(f: OrdersFilterState, page?: number, limit?: number): AdminOrderListQuery {
  return {
    status: f.status || undefined,
    kind: f.kind || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    deliveryOn: f.deliveryOn || undefined,
    q: f.q.trim() || undefined,
    page,
    limit,
  };
}

export function hasActiveFilter(f: OrdersFilterState): boolean {
  return !!(f.status || f.kind || f.from || f.to || f.deliveryOn || f.q.trim());
}

/** CSV dosya adı (indirme): `siparisler-<bugün>[-<durum>].csv`. */
export function csvFileName(f: OrdersFilterState, now: Date = new Date()): string {
  const parts = ['siparisler', todayIsoDate(now)];
  if (f.status) parts.push(f.status.toLowerCase());
  if (f.from || f.to) parts.push(`${f.from || 'baslangic'}_${f.to || 'bugun'}`);
  return `${parts.join('-')}.csv`;
}

/* ── Özet (Özet kartı: bugünkü sipariş / ciro) ─────────────────────────── */

export interface OrdersDigest {
  count: number;
  paidCount: number;
  /** Ödenmiş (teslimata konu) siparişlerin genel toplamı. */
  revenue: number;
  /** Ödeme bekleyen / başarısız. */
  pendingCount: number;
  failedCount: number;
}

const PAID_SET: ReadonlySet<string> = new Set(ORDER_PAID_STATES);

export function summarizeOrders(items: ReadonlyArray<Pick<OrderSummary, 'status' | 'grandTotal' | 'paidAt'>>): OrdersDigest {
  let paidCount = 0;
  let revenue = 0;
  let pendingCount = 0;
  let failedCount = 0;
  for (const o of items) {
    if (PAID_SET.has(o.status) || (o.paidAt && o.status !== 'REFUNDED' && o.status !== 'CANCELLED')) {
      paidCount += 1;
      revenue += Number(o.grandTotal) || 0;
    }
    if (o.status === 'PENDING_PAYMENT') pendingCount += 1;
    if (o.status === 'PAYMENT_FAILED') failedCount += 1;
  }
  return { count: items.length, paidCount, revenue: round2(revenue), pendingCount, failedCount };
}
