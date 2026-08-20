// ── İçerik / günlük / yasal / onay DTO'ları ──────────────────────────────────
import type { ConsentKind, ContentStatus, IysStatus, LegalKind } from '../enums';
import type { Id, IsoDateTime } from './common';

/**
 * SiteContent — anahtarlı içerik bloğu (`promoBar`, `home.hero`, `home.featured`, `sepet.texts`, …).
 * `schema`: admin'in generic formu üretmesi için alan tanımı; `value`: blok değeri (serbest JSON).
 */
export interface SiteContent {
  key: string;
  label: string;
  schema: SiteContentSchema;
  value: unknown;
  updatedBy: Id | null;
  updatedAt: IsoDateTime;
}

/** Generic form için hafif şema (JSON Schema değil; admin formu bunu okur). */
export interface SiteContentSchema {
  fields: SiteContentField[];
}
export type SiteContentFieldType = 'text' | 'textarea' | 'html' | 'number' | 'boolean' | 'image' | 'list' | 'featured';
export interface SiteContentField {
  key: string;
  label: string;
  type: SiteContentFieldType;
  /** `list` tipinde öğe alanları. */
  item?: SiteContentField[];
  help?: string;
  required?: boolean;
}

/** `home.featured` öğesi — ürün ve tier kartları karışık sırada [B7]. */
export interface HomeFeaturedItem {
  type: 'product' | 'tier';
  /** Product.slug ya da BoxTier.slug. */
  ref: string;
  order: number;
}

/** Post — gunluk.html kartları. */
export interface Post {
  id: Id;
  slug: string;
  /** Kart türü/rozet (ör. "not", "hikaye"). */
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt: string | null;
  bodyHtml: string;
  coverMediaId: Id | null;
  coverUrl: string | null;
  relatedSlugs: string[];
  status: ContentStatus;
  publishedAt: IsoDateTime | null;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PostInput {
  slug: string;
  kind: string;
  readMinutes?: number;
  titleHtml: string;
  excerpt?: string | null;
  bodyHtml: string;
  coverMediaId?: Id | null;
  relatedSlugs?: string[];
  status?: ContentStatus;
  publishedAt?: IsoDateTime | null;
  sortOrder?: number;
}

/** LegalDocument — satır başına sürüm; `isCurrent` olan yayındaki sürüm. */
export interface LegalDocument {
  id: Id;
  kind: LegalKind;
  slug: string;
  title: string;
  version: number;
  leadHtml: string | null;
  bodyHtml: string;
  /** Gövdenin SHA-256'sı — onay kaydı hangi metne verildi. */
  contentHash: string;
  effectiveFrom: IsoDateTime;
  isCurrent: boolean;
  /** Checkout'ta açık onay kutusu gerektirir (ADR-0003 istisna 3). */
  requiresAck: boolean;
  /** politikalar.html nav'ında görünür (8 politika); diğerleri hash/link ile [B16]. */
  showInNav: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
}

/** `GET /legal` özet satırı (gövdesiz). */
export type LegalDocumentSummary = Omit<LegalDocument, 'leadHtml' | 'bodyHtml'>;

/** Admin `POST /admin/legal` — yeni sürüm oluşturur (eski sürüm düzenlenmez). */
export interface LegalDocumentInput {
  kind: LegalKind;
  slug: string;
  title: string;
  leadHtml?: string | null;
  bodyHtml: string;
  effectiveFrom: IsoDateTime;
  requiresAck?: boolean;
  showInNav?: boolean;
  sortOrder?: number;
  /** true → bu sürüm `isCurrent`, öncekiler false. */
  publish?: boolean;
}

/** Consent — KVKK/pazarlama/çerez/sözleşme onay kaydı. */
export interface Consent {
  id: Id;
  userId: Id | null;
  guestKey: string | null;
  orderId: Id | null;
  kind: ConsentKind;
  documentId: Id | null;
  documentVersion?: number | null;
  granted: boolean;
  /** HS_WEB | HS_CHECKOUT | HS_SIGNUP | ADMIN … */
  source: string;
  iysStatus: IysStatus;
  iysSyncedAt: IsoDateTime | null;
  revokedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** `POST /consents` — çerez banner'ı / pazarlama izni (giriş yoksa guestKey çerezle). */
export interface ConsentCreateRequest {
  kind: ConsentKind;
  granted: boolean;
  documentId?: Id | null;
  source?: string;
}

// ── F5 ContentModule sözleşmesi (A): SiteContent şeması · yasal nav · admin DTO'ları · onay girişi ─────────────
// Yalnız EKLEME — yukarıdaki F2 tipleri değişmez. API (modules/content) ve admin (ekran 9–12) aynı şekilleri kullanır.

/**
 * SiteContent alan tipi (admin generic formu bunu okur; `site-content.registry.ts` kaynak):
 * text · textarea (düz metin — WebController escapeHtml) · richtext (HTML, olduğu gibi basılır) · image (site-göreli yol
 * ya da /uploads/…) · url · number · boolean · select (`options`) · list (`itemFields` ile nesne listesi; yoksa düz metin listesi).
 */
export type ContentFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'list';

export interface ContentSelectOption {
  value: string;
  label: string;
}

export interface ContentField {
  name: string;
  label: string;
  type: ContentFieldType;
  required?: boolean;
  /** `select` seçenekleri. */
  options?: ContentSelectOption[];
  /** `list` öğesinin alt alanları (iç içe liste serbest); yoksa öğe düz metindir. */
  itemFields?: ContentField[];
  help?: string;
  /** `list`: en az/en çok öğe sayısı · `number`: değer aralığı. */
  min?: number;
  max?: number;
}

/** SiteContent.schema — `PUT /admin/site-content/:key` gövdesi bu şemaya göre doğrulanır (bilinmeyen alan 400). */
export interface ContentSchema {
  fields: ContentField[];
}

/** `GET /admin/site-content` satırı — registry şeması + DB değeri (satır yoksa value null, updatedAt null). */
export interface AdminSiteContentItem {
  key: string;
  label: string;
  /** Hangi sayfanın bloğu (admin menü gruplaması): index · urunler · kutu · nasil-seciyoruz · toptan · gunluk · global. */
  page: string;
  schema: ContentSchema;
  value: unknown;
  updatedBy: Id | null;
  updatedAt: IsoDateTime | null;
}

/** `PUT /admin/site-content/:key` gövdesi. */
export interface AdminSiteContentUpdate {
  value: Record<string, unknown>;
}

/** politikalar.hbs nav satırı (`ContentService.getLegalNav`): isCurrent && showInNav, sortOrder sırasıyla. */
export interface LegalNavItem {
  slug: string;
  title: string;
  kind: LegalKind;
  version: number;
  sortOrder: number;
  requiresAck: boolean;
}

/** `GET /admin/legal` — slug başına sürüm listesi. */
export interface AdminLegalVersion {
  id: Id;
  version: number;
  title: string;
  isCurrent: boolean;
  effectiveFrom: IsoDateTime;
  requiresAck: boolean;
  showInNav: boolean;
  sortOrder: number;
  contentHash: string;
  createdAt: IsoDateTime;
}

export interface AdminLegalGroup {
  slug: string;
  kind: LegalKind;
  /** Yayındaki sürümün başlığı; yayın yoksa en son sürümün. */
  title: string;
  currentVersion: number | null;
  showInNav: boolean;
  sortOrder: number;
  requiresAck: boolean;
  /** Sürüm numarasına göre azalan. */
  versions: AdminLegalVersion[];
}

/** `POST /admin/legal/:slug/versions` — yeni taslak sürüm (version = max+1, isCurrent=false). `kind` yalnız yeni slug'da zorunlu. */
export interface AdminLegalVersionInput {
  title: string;
  leadHtml?: string | null;
  bodyHtml: string;
  kind?: LegalKind;
  requiresAck?: boolean;
  showInNav?: boolean;
  sortOrder?: number;
}

/** `PUT /admin/legal/:id` — yalnız taslak (isCurrent=false) sürümde; yayındakinde 409. */
export interface AdminLegalUpdateInput {
  title?: string;
  leadHtml?: string | null;
  bodyHtml?: string;
}

/** `POST /admin/legal/:id/publish` — aynı slug'taki diğer sürümler isCurrent=false olur. */
export interface AdminLegalPublishInput {
  effectiveFrom?: IsoDateTime;
}

/** `PATCH /admin/legal/:id/nav` — slug'ın TÜM sürümlerine uygulanır (nav/sıra/onay slug düzeyinde özelliktir). */
export interface AdminLegalNavPatch {
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
}

/** `GET /posts?limit&page` — yalnız PUBLISHED, publishedAt azalan. */
export interface PublicPostList {
  items: PublicPost[];
  total: number;
}

/**
 * Public Post: `coverUrl` site-göreli (`assets/…` / `uploads/…`, şablon paritesi); `publishedDateLabel` gg.AA.yyyy (Europe/Istanbul);
 * `coverAlt` kapak görselinin alt metni (MediaFile.alt — gunluk.html img alt'ı).
 */
export interface PublicPost extends Post {
  publishedDateLabel: string | null;
  coverAlt: string | null;
}

/** `POST /admin/posts` gövdesi (`PUT` kısmi). `publishedAt` verilmezse yayınlama anında dolar. */
export interface AdminPostInput {
  slug: string;
  kind: string;
  readMinutes?: number;
  titleHtml: string;
  excerpt?: string | null;
  bodyHtml: string;
  coverMediaId?: Id | null;
  relatedSlugs?: string[];
  status?: ContentStatus;
  publishedAt?: IsoDateTime | null;
  sortOrder?: number;
}

/** `GET /admin/posts?page&limit&status` sayfalı zarf. */
export interface AdminPostList {
  items: Post[];
  total: number;
  page: number;
  limit: number;
}

/**
 * `POST /consents` gövdesi (F5 çerez/pazarlama/KVKK; F6/F8 register/checkout da bunu kullanır).
 * `documentSlug` (+ `documentVersion`, yoksa yayındaki sürüm) → Consent.documentId; ip/ua sunucuda; userId oturumdan.
 */
export interface ConsentCreateInput {
  kind: ConsentKind;
  documentSlug?: string;
  documentVersion?: number;
  /** Varsayılan true. */
  granted?: boolean;
  /** Anonim ziyaretçi anahtarı (çerez); ≤ 64 karakter. */
  guestKey?: string;
  /** HS_WEB (varsayılan) | HS_CHECKOUT | HS_SIGNUP | … (≤ 20 karakter, A-Z0-9_). */
  source?: string;
}

export interface ConsentCreated {
  id: Id;
}
