/**
 * Müşteriler (ekran 16) — sunucu yanıtı → panel şekli normalize + profil formu saf yardımcıları (test edilir).
 *
 * Sözleşme (A): `GET /admin/customers?q&role&page&limit` → `{items,total,page,limit}`; `GET /admin/customers/:id` →
 * profil + adres + onaylar + audit özeti (+ F8 siparişler boş); `PATCH /admin/customers/:id {isActive,name,phone}`;
 * `POST /admin/customers/:id/anonymize`. Mapper alanı `{user:{…}}` altında ya da düz verebilir; adres `address` ya da
 * `addresses[0]`; audit `audit | auditLogs | auditSummary` (dizi ya da `{items}`) — hepsi kabul edilir ki ekran çalışsın.
 */
import type {
  AdminCustomerAddress,
  AdminCustomerAuditEntry,
  AdminCustomerConsent,
  AdminCustomerDetail,
  AdminCustomerListItem,
  AdminCustomerPatch,
} from '../../lib/apiTypes';

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** `{user:{…}}` sarmalı varsa kullanıcı nesnesini açar. */
function userOf(raw: Raw): Raw {
  return isObj(raw.user) ? raw.user : raw;
}

/* ── Liste satırı ────────────────────────────────────────────────────────── */

export function normalizeCustomerListItem(raw: unknown): AdminCustomerListItem | null {
  if (!isObj(raw)) return null;
  const u = userOf(raw);
  if (typeof u.id !== 'string' || typeof u.email !== 'string') return null;
  return {
    id: u.id,
    email: u.email,
    name: str(u.name),
    phone: str(u.phone),
    role: typeof u.role === 'string' ? u.role : 'CUSTOMER',
    isActive: bool(u.isActive, true),
    emailVerifiedAt: str(u.emailVerifiedAt),
    lastLoginAt: str(u.lastLoginAt),
    anonymizedAt: str(u.anonymizedAt),
    createdAt: str(u.createdAt) ?? '',
    orderCount: typeof u.orderCount === 'number' ? u.orderCount : undefined,
    lastOrderAt: u.lastOrderAt === undefined ? undefined : str(u.lastOrderAt),
    subscriptionStatus: u.subscriptionStatus === undefined ? undefined : str(u.subscriptionStatus),
  };
}

/* ── Adres ───────────────────────────────────────────────────────────────── */

export function normalizeCustomerAddress(raw: unknown): AdminCustomerAddress | null {
  const a = Array.isArray(raw) ? raw[0] : raw;
  if (!isObj(a)) return null;
  const zone = isObj(a.zone) ? a.zone : null;
  return {
    id: str(a.id) ?? '',
    fullName: str(a.fullName) ?? '',
    phone: str(a.phone) ?? '',
    line: str(a.line) ?? '',
    zoneId: str(a.zoneId) ?? str(zone?.id) ?? '',
    zoneName: str(a.zoneName) ?? str(zone?.name) ?? null,
    zoneSlug: str(a.zoneSlug) ?? str(zone?.slug) ?? null,
    zip: str(a.zip),
    isDefault: bool(a.isDefault, true),
    updatedAt: str(a.updatedAt),
  };
}

/* ── Onaylar ─────────────────────────────────────────────────────────────── */

export function normalizeCustomerConsent(raw: unknown): AdminCustomerConsent | null {
  if (!isObj(raw) || typeof raw.kind !== 'string') return null;
  const doc = isObj(raw.document) ? raw.document : null;
  return {
    id: str(raw.id) ?? `${raw.kind}-${str(raw.createdAt) ?? ''}`,
    kind: raw.kind,
    granted: bool(raw.granted, true),
    documentId: str(raw.documentId) ?? str(doc?.id),
    documentSlug: str(raw.documentSlug) ?? str(doc?.slug),
    documentTitle: str(raw.documentTitle) ?? str(doc?.title),
    documentVersion:
      typeof raw.documentVersion === 'number' ? raw.documentVersion : typeof doc?.version === 'number' ? (doc.version as number) : null,
    source: str(raw.source),
    iysStatus: str(raw.iysStatus),
    revokedAt: str(raw.revokedAt),
    createdAt: str(raw.createdAt) ?? '',
  };
}

/* ── Audit özeti ─────────────────────────────────────────────────────────── */

export function normalizeCustomerAudit(raw: unknown): AdminCustomerAuditEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : isObj(raw) && Array.isArray(raw.items)
      ? raw.items
      : isObj(raw) && Array.isArray(raw.recent)
        ? raw.recent
        : [];
  const out: AdminCustomerAuditEntry[] = [];
  for (const e of list) {
    if (!isObj(e) || typeof e.action !== 'string') continue;
    out.push({
      id: str(e.id) ?? `${e.action}-${str(e.createdAt) ?? out.length}`,
      action: e.action,
      module: str(e.module) ?? '',
      summary: str(e.summary),
      actorEmail: str(e.actorEmail),
      createdAt: str(e.createdAt) ?? '',
    });
  }
  return out;
}

/* ── Detay ───────────────────────────────────────────────────────────────── */

export function normalizeCustomerDetail(raw: unknown): AdminCustomerDetail | null {
  const base = normalizeCustomerListItem(raw);
  if (!base || !isObj(raw)) return null;
  const u = userOf(raw);
  const addressRaw = raw.address ?? u.address ?? raw.addresses ?? u.addresses ?? null;
  const consentsRaw = raw.consents ?? u.consents;
  const auditRaw = raw.audit ?? raw.auditLogs ?? raw.auditSummary ?? u.audit;
  const ordersRaw = raw.orders ?? u.orders;
  const orders = Array.isArray(ordersRaw)
    ? { items: ordersRaw, total: ordersRaw.length }
    : isObj(ordersRaw)
      ? { items: Array.isArray(ordersRaw.items) ? ordersRaw.items : [], total: typeof ordersRaw.total === 'number' ? ordersRaw.total : 0 }
      : { items: [], total: 0 };
  return {
    ...base,
    marketingOptIn: typeof u.marketingOptIn === 'boolean' ? u.marketingOptIn : undefined,
    updatedAt: str(u.updatedAt),
    address: normalizeCustomerAddress(addressRaw),
    consents: Array.isArray(consentsRaw) ? consentsRaw.map(normalizeCustomerConsent).filter((c): c is AdminCustomerConsent => !!c) : [],
    audit: normalizeCustomerAudit(auditRaw),
    orders,
  };
}

/* ── Görüntü yardımcıları ───────────────────────────────────────────────── */

/** Anonimleştirilmiş müşteri: `anonymizedAt` dolu ya da e-posta `@anon.local` (KVKK). */
export function isCustomerAnonymized(c: Pick<AdminCustomerListItem, 'anonymizedAt' | 'email'>): boolean {
  return !!c.anonymizedAt || /@anon\.local$/i.test(c.email);
}

export function customerDisplayName(c: Pick<AdminCustomerListItem, 'name' | 'email'>): string {
  const n = c.name?.trim();
  return n ? n : c.email;
}

/* ── Profil formu (PATCH) ───────────────────────────────────────────────── */

export interface CustomerProfileDraft {
  name: string;
  phone: string;
  isActive: boolean;
}

export function customerToDraft(c: Pick<AdminCustomerListItem, 'name' | 'phone' | 'isActive'>): CustomerProfileDraft {
  return { name: c.name ?? '', phone: c.phone ?? '', isActive: c.isActive };
}

/** Telefon: rakam, boşluk, +, -, parantez; 10–15 rakam. Boş → izinli (silme). */
const PHONE_RE = /^[+\d][\d\s().-]{6,29}$/;

export function validateCustomerDraft(d: CustomerProfileDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.name.trim().length > 120) e.name = 'En fazla 120 karakter';
  const phone = d.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (!PHONE_RE.test(phone) || digits.length < 10 || digits.length > 15) e.phone = 'Geçerli bir telefon girin (ör. 0532 000 00 00)';
  }
  return e;
}

/** Yalnız değişen alanlar; boş metin → null (alanı siler). */
export function toCustomerPatch(initial: CustomerProfileDraft, draft: CustomerProfileDraft): AdminCustomerPatch {
  const patch: AdminCustomerPatch = {};
  const name = draft.name.trim();
  const phone = draft.phone.trim();
  if (name !== initial.name.trim()) patch.name = name || null;
  if (phone !== initial.phone.trim()) patch.phone = phone || null;
  if (draft.isActive !== initial.isActive) patch.isActive = draft.isActive;
  return patch;
}

export function isCustomerDraftDirty(initial: CustomerProfileDraft, draft: CustomerProfileDraft): boolean {
  return Object.keys(toCustomerPatch(initial, draft)).length > 0;
}
