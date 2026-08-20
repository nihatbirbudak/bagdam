/**
 * Kuponlar (ekran 23, F8) — form taslağı ↔ API gövdesi, doğrulama, görüntü yardımcıları (saf; test edilir).
 *
 * Sözleşme (B): `GET /admin/coupons?q&active&page` → `{items,total,page,limit}` (CouponListItem); `GET /admin/coupons/:id`
 * (+ redemptions); `POST /admin/coupons` / `PUT /admin/coupons/:id` (CouponInput); `DELETE /admin/coupons/:id` (soft);
 * `PATCH /admin/coupons/:id/active {isActive}`. Kupon kodu büyük/küçük harf duyarsız benzersiz (citext).
 */
import { COUPON_KIND_LABELS, COUPON_SCOPE_LABELS, type Coupon, type CouponInput, type CouponKind, type CouponListItem, type CouponScope } from '@bagdam/shared';
import { formatTry, parseDecimalInput } from '../../lib/utils';

export interface CouponDraft {
  code: string;
  kind: CouponKind;
  /** Metin (tr-TR virgül ondalık): PERCENT 0–100 · AMOUNT TL. */
  value: string;
  minSubtotal: string;
  appliesTo: CouponScope;
  /** `datetime-local` değeri (yerel saat) ya da ''. */
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
  note: string;
}

export const EMPTY_COUPON_DRAFT: CouponDraft = {
  code: '',
  kind: 'PERCENT',
  value: '',
  minSubtotal: '',
  appliesTo: 'ALL',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  perUserLimit: '',
  isActive: true,
  note: '',
};

/** Kupon kodu: 3–32 karakter, harf/rakam/-/_; sunucuda büyük harfe çevrilmiş gibi saklanır (citext) — panel de büyütür. */
export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/* ── ISO ↔ datetime-local ──────────────────────────────────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO an → `datetime-local` (tarayıcının yerel saati; panel operatörü Türkiye'de). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` → ISO an (yerel saat olarak yorumlanır); boş → null; geçersiz → undefined. */
export function localInputToIso(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/* ── Taslak ↔ gövde ────────────────────────────────────────────────────── */

function numText(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',');
}

export function couponToDraft(c: Coupon | CouponListItem): CouponDraft {
  const full = c as Partial<Coupon>;
  return {
    code: c.code,
    kind: c.kind,
    value: numText(c.value),
    minSubtotal: numText(full.minSubtotal ?? null),
    appliesTo: c.appliesTo,
    startsAt: isoToLocalInput(c.startsAt),
    endsAt: isoToLocalInput(c.endsAt),
    usageLimit: numText(c.usageLimit),
    perUserLimit: numText(full.perUserLimit ?? null),
    isActive: c.isActive,
    note: full.note ?? '',
  };
}

function intOrNull(s: string): number | null | undefined {
  const t = s.trim();
  if (!t) return null;
  const n = parseDecimalInput(t);
  if (n === null || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

export function validateCouponDraft(d: CouponDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const code = normalizeCouponCode(d.code);
  if (!code) e.code = 'Kod gerekli';
  else if (!COUPON_CODE_RE.test(code)) e.code = '3–32 karakter; harf, rakam, - ve _';
  const value = parseDecimalInput(d.value);
  if (value === null) e.value = 'Geçerli bir değer girin';
  else if (value <= 0) e.value = 'Sıfırdan büyük olmalı';
  else if (d.kind === 'PERCENT' && value > 100) e.value = 'Yüzde en çok 100';
  if (d.minSubtotal.trim()) {
    const m = parseDecimalInput(d.minSubtotal);
    if (m === null || m < 0) e.minSubtotal = 'Geçerli bir tutar girin';
  }
  const starts = localInputToIso(d.startsAt);
  const ends = localInputToIso(d.endsAt);
  if (starts === undefined) e.startsAt = 'Geçerli bir tarih girin';
  if (ends === undefined) e.endsAt = 'Geçerli bir tarih girin';
  if (starts && ends && ends <= starts) e.endsAt = 'Bitiş başlangıçtan sonra olmalı';
  if (intOrNull(d.usageLimit) === undefined) e.usageLimit = 'Pozitif tam sayı';
  if (intOrNull(d.perUserLimit) === undefined) e.perUserLimit = 'Pozitif tam sayı';
  if (d.note.trim().length > 500) e.note = 'En fazla 500 karakter';
  return e;
}

/** Doğrulanmış taslak → `CouponInput` (POST/PUT). Boş sayı alanları null. */
export function toCouponBody(d: CouponDraft): CouponInput {
  const minSubtotal = d.minSubtotal.trim() ? parseDecimalInput(d.minSubtotal) : null;
  return {
    code: normalizeCouponCode(d.code),
    kind: d.kind,
    value: parseDecimalInput(d.value) ?? 0,
    minSubtotal,
    appliesTo: d.appliesTo,
    startsAt: localInputToIso(d.startsAt) ?? null,
    endsAt: localInputToIso(d.endsAt) ?? null,
    usageLimit: intOrNull(d.usageLimit) ?? null,
    perUserLimit: intOrNull(d.perUserLimit) ?? null,
    isActive: d.isActive,
    note: d.note.trim() || null,
  };
}

export function isCouponDraftDirty(a: CouponDraft, b: CouponDraft): boolean {
  return (Object.keys(a) as (keyof CouponDraft)[]).some((k) => {
    const x = a[k];
    const y = b[k];
    return typeof x === 'string' && typeof y === 'string' ? x.trim() !== y.trim() : x !== y;
  });
}

/* ── Görüntü ───────────────────────────────────────────────────────────── */

export function couponKindLabel(kind: string): string {
  return (COUPON_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}
export function couponScopeLabel(scope: string): string {
  return (COUPON_SCOPE_LABELS as Record<string, string>)[scope] ?? scope;
}

/** İndirim özeti: `%10` ya da `₺50,00`. */
export function couponDiscountLabel(c: Pick<CouponListItem, 'kind' | 'value'>): string {
  if (c.kind === 'PERCENT') return `%${Number(c.value).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
  return formatTry(c.value);
}

/** Kullanım: `3 / 100` ya da `3 / ∞`. */
export function couponUsageLabel(c: Pick<CouponListItem, 'usedCount' | 'usageLimit'>): string {
  return `${c.usedCount} / ${c.usageLimit === null || c.usageLimit === undefined ? '∞' : c.usageLimit}`;
}

export type CouponState = 'ACTIVE' | 'PASSIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED';

/** Türetilmiş durum: pasif › bitti › tükendi › başlamadı › aktif (panel rozeti; sunucu kuralı PricingService'te). */
export function couponState(c: Pick<CouponListItem, 'isActive' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usedCount'>, now: Date = new Date()): CouponState {
  if (!c.isActive) return 'PASSIVE';
  const t = now.getTime();
  if (c.endsAt && new Date(c.endsAt).getTime() <= t) return 'EXPIRED';
  if (c.usageLimit !== null && c.usageLimit !== undefined && c.usedCount >= c.usageLimit) return 'EXHAUSTED';
  if (c.startsAt && new Date(c.startsAt).getTime() > t) return 'SCHEDULED';
  return 'ACTIVE';
}

export const COUPON_STATE_LABELS: Record<CouponState, string> = {
  ACTIVE: 'Aktif',
  PASSIVE: 'Pasif',
  SCHEDULED: 'Başlamadı',
  EXPIRED: 'Süresi doldu',
  EXHAUSTED: 'Tükendi',
};

export const COUPON_STATE_STYLE: Record<CouponState, string> = {
  ACTIVE: 'bg-olive-soft text-olive-deep ring-olive/30',
  PASSIVE: 'bg-brand-100 text-brand-500 ring-brand-300',
  SCHEDULED: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  EXPIRED: 'bg-brand-100 text-brand-600 ring-brand-300',
  EXHAUSTED: 'bg-accent-soft text-accent-dark ring-accent/30',
};
