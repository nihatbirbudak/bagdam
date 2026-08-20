/**
 * API sözleşmesi zarfları (panelin kendi ihtiyaç duyduğu şekiller). Alan/enum tipleri
 * `@bagdam/shared`'dan; admin DTO şekilleri `lib/adminTypes.ts`'te.
 */
import type { UserRole } from '@bagdam/shared';

/** Global hata zarfı (AllExceptionsFilter): `{ statusCode, message, error, requestId, timestamp, path }`. */
export interface ApiErrorEnvelope {
  statusCode: number;
  /** class-validator hatalarında dizi gelebilir. */
  message: string | string[];
  error?: string;
  requestId?: string;
  path?: string;
  timestamp?: string;
}

export type { UserRole };

/** `POST /auth/login` → `{ user }` ve `GET /auth/me` gövdesi (ADR-0009). */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole | string;
  emailVerifiedAt?: string | null;
  createdAt?: string;
}

/** `POST /auth/login` yanıtı (cookie set edilir; gövdede kullanıcı döner). */
export interface LoginResponse {
  user?: AuthUser;
}

/** `GET /health` (HealthController). */
export interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
  version?: string;
  db?: string;
  [key: string]: unknown;
}

/** Ortak sayfalama zarfı — admin liste uçları `{ items, total, page, limit }` döner. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * F5 sözleşmesi — içerik (SiteContent / Post / LegalDocument), toptan, ayarlar, teslimat.
 * Kaynak: görev sözleşmesi (A/B/C/D birebir). `@bagdam/shared` F5 tipleri geldiğinde (A/B ekliyor)
 * buradaki şekiller yalnız yeniden dışa aktarıma indirgenir; panel bu dosyadan import eder.
 * Yazım/alan adı farkı olursa sunucu (A registry / B registry) kaynaktır — bkz. open_issues.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── SiteContent (ekran 9–10) ─────────────────────────────────────────────── */

/**
 * İçerik şeması alan türleri. A registry: text | textarea | richtext | image | url | number | boolean | select | list.
 * Shared (`SiteContentFieldType`) ayrıca `html` (= richtext) ve `featured` (home.featured seçici) tanımlar; ikisi de kabul edilir.
 */
export type ContentFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'html'
  | 'image'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'list'
  | 'featured';

/** Select seçeneği: düz string ya da `{value,label}`. */
export type ContentFieldOption = string | { value: string; label: string };

/**
 * Ham şema alanı — A registry `name` + `itemFields`, shared/seed `key` + `item` yazar; SchemaForm ikisini de okur
 * (`normalizeSchema`). Panelde yalnız normalize edilmiş biçim (`ContentFieldNormalized`) kullanılır.
 */
export interface ContentFieldRaw {
  name?: string;
  key?: string;
  label?: string;
  type?: ContentFieldType | string;
  required?: boolean;
  options?: ContentFieldOption[];
  itemFields?: ContentFieldRaw[];
  item?: ContentFieldRaw[];
  help?: string;
  /** Metin alanı üst sınırı (varsa). */
  maxLength?: number;
}

/** `SiteContent.schema` — `{fields:[...]}`. */
export interface ContentSchema {
  fields: ContentFieldRaw[];
}

/** `GET /admin/site-content` öğesi ve `GET /admin/site-content/:key` gövdesi (shared `AdminSiteContentItem`). */
export interface AdminSiteContent {
  key: string;
  label: string;
  /** Registry sayfa grubu: global · index · urunler · kutu · nasil-seciyoruz · toptan · gunluk. */
  page?: string;
  schema: ContentSchema | null;
  value: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** `PUT /admin/site-content/:key` gövdesi. */
export interface AdminSiteContentUpdate {
  value: unknown;
}

/** `home.featured` öğesi — ürün ve tier kartları karışık sırada [B7] (shared `HomeFeaturedItem` ile aynı). */
export interface FeaturedItem {
  type: 'product' | 'tier';
  /** Product.slug ya da BoxTier.slug. */
  ref: string;
  order: number;
}

/* ── Günlük (Post, ekran 11) ──────────────────────────────────────────────── */

/** `GET /admin/posts` satırı / `GET /admin/posts/:id`. */
export interface AdminPost {
  id: string;
  slug: string;
  /** Kart rozeti (ör. "not", "hikâye", "tarif"). */
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt: string | null;
  bodyHtml: string;
  coverMediaId: string | null;
  /** Kapak görselinin genel URL'si (mapper; yoksa null). */
  coverUrl?: string | null;
  relatedSlugs: string[];
  status: ContentStatusValue;
  publishedAt: string | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export type ContentStatusValue = 'DRAFT' | 'PUBLISHED';

/** `POST /admin/posts` gövdesi; `PUT /admin/posts/:id` aynı alanların kısmi hâli. */
export interface AdminPostInput {
  slug: string;
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt: string | null;
  bodyHtml: string;
  coverMediaId: string | null;
  relatedSlugs: string[];
  status: ContentStatusValue;
}

export interface AdminPostListQuery {
  page?: number;
  limit?: number;
  status?: ContentStatusValue | '';
}

/* ── Yasal metinler (LegalDocument, ekran 12) ─────────────────────────────── */

export type LegalKindValue =
  | 'PRIVACY'
  | 'TERMS'
  | 'DISTANCE_SALES'
  | 'DELIVERY'
  | 'RETURNS'
  | 'KVKK'
  | 'COOKIE'
  | 'COOKIE_SETTINGS'
  | 'PREINFO'
  | 'SUBSCRIPTION_CONTRACT'
  | 'MARKETING_CONSENT';

/** `GET /admin/legal` → slug başına özet; `versions` sürüm satırları. */
export interface AdminLegalVersionRow {
  id: string;
  version: number;
  title: string;
  isCurrent: boolean;
  effectiveFrom: string;
  requiresAck: boolean;
  showInNav: boolean;
  sortOrder: number;
  contentHash?: string;
  createdAt: string;
}

/** shared `AdminLegalGroup`: nav/sıra/onay slug düzeyinde (yayındaki, yoksa en son sürümden). */
export interface AdminLegalSlug {
  slug: string;
  kind: LegalKindValue | string;
  title: string;
  currentVersion: number | null;
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
  versions: AdminLegalVersionRow[];
}

/** `GET /admin/legal/:id` — tam belge (gövde dahil). */
export interface AdminLegalDocument extends AdminLegalVersionRow {
  kind: LegalKindValue | string;
  slug: string;
  leadHtml: string | null;
  bodyHtml: string;
  contentHash: string;
}

/** `POST /admin/legal/:slug/versions` gövdesi — yeni taslak sürüm (isCurrent=false); `kind` yalnız yeni slug'da. */
export interface AdminLegalVersionInput {
  title: string;
  leadHtml?: string | null;
  bodyHtml: string;
  kind?: LegalKindValue;
  requiresAck?: boolean;
  showInNav?: boolean;
  sortOrder?: number;
}

/** `PUT /admin/legal/:id` — yalnız taslakta (isCurrent=false); yayındakinde 409. */
export interface AdminLegalVersionUpdate {
  title?: string;
  leadHtml?: string | null;
  bodyHtml?: string;
}

/** `PATCH /admin/legal/:id/nav`. */
export interface AdminLegalNavPatch {
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
}

/** `POST /admin/legal/:id/publish`. */
export interface AdminLegalPublishInput {
  effectiveFrom?: string;
}

/* ── Toptan talepleri (WholesaleLead, ekran 13) ───────────────────────────── */

export type LeadStatusValue = 'NEW' | 'CONTACTED' | 'CLOSED';

export interface AdminWholesaleLead {
  id: string;
  email: string;
  businessName: string | null;
  phone: string | null;
  note: string | null;
  status: LeadStatusValue;
  ip?: string | null;
  createdAt: string;
}

export interface AdminWholesaleLeadPatch {
  status?: LeadStatusValue;
  note?: string | null;
}

export interface AdminWholesaleLeadQuery {
  status?: LeadStatusValue | '';
  page?: number;
  limit?: number;
}

/* ── Ayarlar (Setting, ekran 14a/15) ──────────────────────────────────────── */

export type SettingFieldType = 'text' | 'number' | 'boolean' | 'select' | 'secret' | 'json' | 'textarea';

/** Setting alan meta + değeri — `GET /admin/settings` içindeki `fields[]` öğesi (shared `AdminSettingField`). */
export interface AdminSettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  options?: ContentFieldOption[];
  help?: string;
  default?: unknown;
  /** Zorunlu alan (PUT'ta boş verilemez). */
  required?: boolean;
  /** number: izinli aralık; `integer` tam sayı ister. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** Secret alanda maskeli (`'••••••'`); diğerlerinde gerçek değer. */
  value?: unknown;
  isSecret?: boolean;
  /** Secret alan: sunucuda değer var mı (maskeli gösterim için). */
  hasValue?: boolean;
  masked?: boolean;
  /** DB satırı varsa güncelleme anı; yoksa null (varsayılan gösteriliyor). */
  updatedAt?: string | null;
}

/** `GET /admin/settings` öğesi / `GET /admin/settings/:group` gövdesi. */
export interface AdminSettingGroup {
  group: string;
  label: string;
  description?: string;
  fields: AdminSettingField[];
}

/** `PUT /admin/settings/:group` gövdesi — alan → değer (secret: boş/maske → değiştirme). */
export type AdminSettingGroupUpdate = Record<string, unknown>;

/* ── Teslimat bölgeleri / tarihleri (ekran 14a) ───────────────────────────── */

export type DeliveryDayValue = 'SALI' | 'PERSEMBE' | 'CUMARTESI';
export type DeliveryDateStatusValue = 'OPEN' | 'LOCKED' | 'CLOSED';

/** `GET /admin/delivery/zones` satırı (Decimal alanlar string ya da number gelebilir). */
export interface AdminDeliveryZone {
  id: string;
  name: string;
  slug: string;
  fee: number | string;
  freeThreshold: number | string | null;
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}

/** `POST /admin/delivery/zones` gövdesi; `PUT` aynı. */
export interface AdminDeliveryZoneInput {
  name: string;
  slug: string;
  fee: number;
  freeThreshold: number | null;
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}

/** `GET /admin/delivery/dates?zone&from&to` satırı. */
export interface AdminDeliveryDate {
  id: string;
  zoneId: string;
  zoneName?: string;
  zoneSlug?: string;
  day: DeliveryDayValue;
  date: string;
  cutoffAt: string;
  capacity: number;
  reserved: number;
  status: DeliveryDateStatusValue;
}

export interface AdminDeliveryDatePatch {
  capacity?: number;
  status?: DeliveryDateStatusValue;
}
