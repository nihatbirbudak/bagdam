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
