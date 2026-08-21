/**
 * Ekran 18 (Ödeme Problemleri) saf yardımcıları — test edilir.
 *
 * Kaynak: `GET /admin/payment-issues?kind&q&page&limit` → `PaymentIssueList`
 * (PAYMENT_FAILED siparişler + UNPAID / AWAITING_PAYMENT abonelik cycle'ları tek listede; `kind` ayırır).
 * Eylemler ayrı uçlarda: `POST /admin/cycles/:id/charge` ("yeniden çek"),
 * `POST /admin/cycles/:id/send-payment-link` ("ödeme linki gönder"),
 * `POST /admin/orders/:id/notes {adminNote}` ve `PATCH /admin/subscriptions/:id {note}` (müşteri kaydına not).
 *
 * Dunning (ADR-0020): denemeler kesimden +2 s ve +12 s; son sınır teslimat günü 08:00 Europe/Istanbul.
 * Sınırı aşan denemeler atlanır → cycle UNPAID + SKIPPED(UNPAID); 2 ardışık UNPAID → abonelik PAST_DUE.
 */
import type { PaymentIssueItem, PaymentIssueList } from '../../lib/apiTypes';

/* ── Yanıt normalizasyonu ─────────────────────────────────────────────── */

const EMPTY_COUNTS = { failedOrders: 0, unpaidCycles: 0, awaitingPaymentCycles: 0, total: 0 };

function countsFrom(items: readonly PaymentIssueItem[]): PaymentIssueList['counts'] {
  let failedOrders = 0;
  let unpaidCycles = 0;
  let awaitingPaymentCycles = 0;
  for (const i of items) {
    if (i.kind === 'ORDER') failedOrders += 1;
    else if (i.status === 'UNPAID') unpaidCycles += 1;
    else if (i.status === 'AWAITING_PAYMENT') awaitingPaymentCycles += 1;
  }
  return { failedOrders, unpaidCycles, awaitingPaymentCycles, total: items.length };
}

/** `{items,total,page,limit,counts}` zarfı ya da düz dizi → panelin beklediği şekil. */
export function normalizePaymentIssues(res: unknown): PaymentIssueList {
  const items = Array.isArray(res)
    ? (res as PaymentIssueItem[])
    : res && typeof res === 'object' && Array.isArray((res as { items?: unknown }).items)
      ? ((res as { items: PaymentIssueItem[] }).items)
      : [];
  const env = (res && typeof res === 'object' && !Array.isArray(res) ? res : {}) as Partial<PaymentIssueList>;
  return {
    items,
    total: typeof env.total === 'number' ? env.total : items.length,
    page: typeof env.page === 'number' ? env.page : 1,
    limit: typeof env.limit === 'number' ? env.limit : items.length,
    counts: env.counts ?? (items.length ? countsFrom(items) : EMPTY_COUNTS),
  };
}

/* ── Kaynak (sipariş / kutu) ──────────────────────────────────────────── */

export const ISSUE_KIND_LABELS: Record<string, string> = { ORDER: 'Sipariş', CYCLE: 'Kutu' };

export const ISSUE_KIND_STYLE: Record<string, string> = {
  ORDER: 'bg-brand-100 text-brand-600 ring-brand-300',
  CYCLE: 'bg-olive-soft text-olive-deep ring-olive/30',
};

export function issueKindLabel(kind: string): string {
  return ISSUE_KIND_LABELS[kind] ?? kind;
}

/* ── Önem derecesi ────────────────────────────────────────────────────── */

export type IssueSeverity = 'critical' | 'warning' | 'info';

export const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  critical: 'bg-accent-soft text-accent-dark ring-accent/30',
  warning: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  info: 'bg-brand-100 text-brand-600 ring-brand-300',
};

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: 'Acil',
  warning: 'Takip',
  info: 'Bilgi',
};

/**
 * Aciliyet: abonelik PAST_DUE, teslimatı gelmiş/geçmiş satır ya da ödemesi başarısız sipariş → acil;
 * UNPAID → takip; ödeme linki bekleyen → bilgi. `today` Europe/Istanbul takvim günü (`YYYY-MM-DD`).
 */
export function issueSeverity(item: Pick<PaymentIssueItem, 'kind' | 'status' | 'deliveryOn' | 'subscriptionStatus'>, today: string): IssueSeverity {
  if (item.subscriptionStatus === 'PAST_DUE') return 'critical';
  if (item.deliveryOn && item.deliveryOn <= today) return 'critical';
  if (item.kind === 'ORDER') return 'critical';
  if (item.status === 'UNPAID') return 'warning';
  return 'info';
}

/** Acil satırlar önce; sonra teslimat tarihine göre (yakın olan üstte). */
export function sortIssues(items: readonly PaymentIssueItem[], today: string): PaymentIssueItem[] {
  const rank: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...items].sort((a, b) => {
    const bySeverity = rank[issueSeverity(a, today)] - rank[issueSeverity(b, today)];
    if (bySeverity !== 0) return bySeverity;
    return (a.deliveryOn ?? '9999-12-31').localeCompare(b.deliveryOn ?? '9999-12-31');
  });
}

/* ── Zaman metinleri ──────────────────────────────────────────────────── */

/** "2 sa 10 dk sonra" / "15 dk önce" / "—". */
export function relativeToNow(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = t - now.getTime();
  const past = diff <= 0;
  const minutes = Math.floor(Math.abs(diff) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const text = days > 0 ? `${days} gün ${hours} sa` : hours > 0 ? `${hours} sa ${mins} dk` : `${mins} dk`;
  return past ? `${text} önce` : `${text} sonra`;
}

/** Dunning satırı: linkte son geçerlilik, kartta sıradaki deneme. */
export function dunningText(item: Pick<PaymentIssueItem, 'status' | 'nextRetryAtIso' | 'paymentDueAtIso'>, now: Date = new Date()): string {
  if (item.status === 'AWAITING_PAYMENT') return `link: ${relativeToNow(item.paymentDueAtIso, now)}`;
  return `sonraki deneme: ${relativeToNow(item.nextRetryAtIso, now)}`;
}

/* ── Aksiyon uygunluğu ────────────────────────────────────────────────── */

/** "Yeniden çek": yalnız cycle satırı, tahsilat bekleyen durum ve saklı kart varken. */
export function canRetryCharge(item: Pick<PaymentIssueItem, 'kind' | 'status' | 'hasCard'>): boolean {
  if (item.kind !== 'CYCLE') return false;
  if (!item.hasCard) return false;
  return item.status === 'UNPAID' || item.status === 'LOCKED' || item.status === 'AWAITING_PAYMENT';
}

/** "Ödeme linki gönder": cycle satırı ve tahsilat bekleyen durum (kart gerekmez). */
export function canIssueLink(item: Pick<PaymentIssueItem, 'kind' | 'status'>): boolean {
  if (item.kind !== 'CYCLE') return false;
  return item.status === 'UNPAID' || item.status === 'LOCKED' || item.status === 'AWAITING_PAYMENT';
}

/* ── Not formu ────────────────────────────────────────────────────────── */

export const ISSUE_NOTE_MAX = 500;

export function validateIssueNote(note: string): string | null {
  const n = note.trim();
  if (!n) return 'Not boş olamaz';
  if (n.length < 2) return 'En az 2 karakter';
  if (n.length > ISSUE_NOTE_MAX) return `En fazla ${ISSUE_NOTE_MAX} karakter`;
  return null;
}

/* ── Özet ─────────────────────────────────────────────────────────────── */

export interface IssuesDigest {
  total: number;
  failedOrders: number;
  unpaidCycles: number;
  awaitingPaymentCycles: number;
  critical: number;
}

export function summarizeIssues(list: PaymentIssueList, today: string): IssuesDigest {
  return {
    total: list.counts.total,
    failedOrders: list.counts.failedOrders,
    unpaidCycles: list.counts.unpaidCycles,
    awaitingPaymentCycles: list.counts.awaitingPaymentCycles,
    critical: list.items.filter((i) => issueSeverity(i, today) === 'critical').length,
  };
}
