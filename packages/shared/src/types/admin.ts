// ── Admin panel DTO'ları (F4 — katalog CRUD + medya) ─────────────────────────
// BACKEND-PLANI §3 catalog/media admin satırları + §4 ekran 2–8. API (catalog-admin / media) ve
// apps/admin aynı şekilleri kullanır; public DTO'lar (types/catalog.ts) değişmez, bunlar yalnız EKLEMEdir.
import type { ContentStatus, ProductStatus, StockStatus } from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDate, IsoDateTime } from './common';
import type { ExtraOption } from './catalog';

/** Admin liste uçlarının sayfalı zarfı (`GET /admin/products`, `GET /admin/media`). */
export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Ürün ──────────────────────────────────────────────────────────────────────

/** `GET /admin/products` satırı. */
export interface AdminProductListItem {
  id: Id;
  slug: string;
  name: string;
  categorySlug: string;
  categoryLabel: string;
  producerName: string | null;
  price: Money;
  unit: string;
  status: ProductStatus;
  stockStatus: StockStatus;
  isFresh: boolean;
  pairWithBox: boolean;
  sortOrder: number;
  /** Kapak görselinin genel URL'si (`/uploads/...` ya da `/assets/images/...`); yoksa null. */
  coverImageUrl: string | null;
  updatedAt: IsoDateTime;
}

/** `GET /admin/products?…` sorgusu. */
export interface AdminProductListQuery {
  page?: number;
  limit?: number;
  q?: string;
  categoryId?: Id;
  status?: ProductStatus;
  stockStatus?: StockStatus;
  isFresh?: boolean;
}

/** Ürün detayındaki görsel satırı (ProductImage ↔ MediaFile). */
export interface AdminProductImage {
  id: Id;
  mediaId: Id;
  /** Genel URL (`/uploads/<klasör>/<dosya>.webp` ya da `/assets/images/...`). */
  url: string;
  thumbUrl: string | null;
  alt: string | null;
  isCover: boolean;
  sortOrder: number;
}

/** Ürün detayındaki parti satırı. */
export interface AdminProductLot {
  id: Id;
  lotCode: string;
  harvestDate: IsoDate | null;
  bestBefore: IsoDate | null;
  tastingNote: string | null;
  isCurrent: boolean;
  producerId: Id | null;
  producerName: string | null;
  createdAt: IsoDateTime;
}

/** `GET /admin/products/:id` — tüm Product alanları + ilişkiler. */
export interface AdminProductDetail {
  id: Id;
  slug: string;
  name: string;
  categoryId: Id;
  category: { id: Id; slug: string; label: string };
  group: string | null;
  producerId: Id | null;
  producer: { id: Id; name: string } | null;
  metaNote: string | null;
  price: Money;
  vatRate: number;
  unit: string;
  boxAmount: string | null;
  extraOptions: ExtraOption[] | null;
  description: string;
  storageText: string | null;
  allergenText: string | null;
  freshnessNote: string | null;
  prefLabel: string | null;
  prefOptions: string[];
  prefDefault: number | null;
  isFresh: boolean;
  season: string | null;
  status: ProductStatus;
  stockStatus: StockStatus;
  pairWithBox: boolean;
  pairOrder: number;
  sortOrder: number;
  images: AdminProductImage[];
  lots: AdminProductLot[];
  currentLot: AdminProductLot | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** `POST /admin/products` gövdesi; `PUT /admin/products/:id` aynı alanların kısmi hâli. */
export interface AdminProductInput {
  slug: string;
  name: string;
  categoryId: Id;
  group?: string | null;
  producerId?: Id | null;
  metaNote?: string | null;
  price: Money;
  vatRate?: number;
  unit: string;
  boxAmount?: string | null;
  extraOptions?: ExtraOption[] | null;
  description: string;
  storageText?: string | null;
  allergenText?: string | null;
  freshnessNote?: string | null;
  prefLabel?: string | null;
  prefOptions?: string[];
  prefDefault?: number | null;
  isFresh?: boolean;
  season?: string | null;
  status?: ProductStatus;
  stockStatus?: StockStatus;
  pairWithBox?: boolean;
  pairOrder?: number;
  sortOrder?: number;
}
export type AdminProductUpdate = Partial<AdminProductInput>;

/** `PATCH /admin/products/:id/status` · `/stock` · `/pair`. */
export interface AdminProductStatusPatch {
  status: ProductStatus;
}
export interface AdminProductStockPatch {
  stockStatus: StockStatus;
}
export interface AdminProductPairPatch {
  pairWithBox: boolean;
  pairOrder?: number;
}

/** `POST …/reorder {ids}` — verilen sıra sortOrder 0..n-1 olur. */
export interface AdminReorderInput {
  ids: Id[];
}

/** `POST /admin/products/:id/lots` gövdesi. */
export interface AdminProductLotInput {
  lotCode: string;
  harvestDate?: IsoDate | null;
  bestBefore?: IsoDate | null;
  tastingNote?: string | null;
  producerId?: Id | null;
  /** Varsayılan true: yeni parti güncel olur, diğerleri isCurrent=false. */
  setCurrent?: boolean;
}

/** `PATCH /admin/products/:id/lots/:lotId` gövdesi — isCurrent=true diğerlerini false yapar. */
export interface AdminProductLotPatch {
  lotCode?: string;
  harvestDate?: IsoDate | null;
  bestBefore?: IsoDate | null;
  tastingNote?: string | null;
  producerId?: Id | null;
  isCurrent?: boolean;
}

/** `POST /admin/products/:id/images` gövdesi. */
export interface AdminProductImageInput {
  mediaId: Id;
  alt?: string | null;
  isCover?: boolean;
}

/** `PATCH /admin/products/:id/images/:imageId` gövdesi. */
export interface AdminProductImagePatch {
  alt?: string | null;
  isCover?: boolean;
  sortOrder?: number;
}

// ── Kategori / üretici / tier ─────────────────────────────────────────────────

/** `GET /admin/categories` satırı. */
export interface AdminCategory {
  id: Id;
  slug: string;
  legacyTab: string | null;
  label: string;
  panelNote: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

/** `PUT /admin/categories/:id` gövdesi (yeni kategori MVP'de yok — ikon statik). */
export interface AdminCategoryUpdate {
  label: string;
  panelNote?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  legacyTab?: string | null;
}

/** `GET /admin/producers` satırı / `GET /admin/producers/:id`. */
export interface AdminProducer {
  id: Id;
  name: string;
  slug: string;
  village: string | null;
  district: string;
  story: string | null;
  photoMediaId: Id | null;
  photoUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
}

/** `POST /admin/producers` gövdesi; `PUT` kısmi. */
export interface AdminProducerInput {
  name: string;
  slug?: string;
  village?: string | null;
  district?: string;
  story?: string | null;
  photoMediaId?: Id | null;
  isActive?: boolean;
  sortOrder?: number;
}
export type AdminProducerUpdate = Partial<AdminProducerInput>;

/** `GET /admin/tiers` satırı. */
export interface AdminBoxTier {
  id: Id;
  slug: string;
  label: string;
  itemCount: number;
  price: Money;
  note: string | null;
  imageMediaId: Id | null;
  imageUrl: string | null;
  isRecommended: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** `PUT /admin/tiers/:id` gövdesi — isRecommended=true diğerlerini false yapar. */
export interface AdminBoxTierUpdate {
  label?: string;
  itemCount?: number;
  price?: Money;
  note?: string | null;
  imageMediaId?: Id | null;
  isRecommended?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

// ── Haftanın kutusu (BoxTemplate) ─────────────────────────────────────────────

export interface AdminBoxTemplateItem {
  id: Id;
  productId: Id;
  productSlug: string;
  productName: string;
  qtyLabel: string;
  isSwappable: boolean;
  sortOrder: number;
}

/** `GET /admin/box-templates` satırı; POST/PUT/publish/clone yanıtı. */
export interface AdminBoxTemplate {
  id: Id;
  tierId: Id;
  tierSlug: string;
  tierLabel: string;
  /** Haftanın Pazartesi'si (YYYY-MM-DD). */
  weekStart: IsoDate;
  status: ContentStatus;
  curatorName: string | null;
  itemCount: number;
  items: AdminBoxTemplateItem[];
  /** PUBLISHED şablonun öğeleri değiştirildiğinde döner (uyarı metni); aksi hâlde yok. */
  warning?: string;
}

export interface AdminBoxTemplateItemInput {
  productId: Id;
  qtyLabel: string;
  isSwappable?: boolean;
}

/** `POST /admin/box-templates` gövdesi (weekStart haftanın herhangi bir günü olabilir → Pazartesi'ye yuvarlanır). */
export interface AdminBoxTemplateInput {
  tierId: Id;
  weekStart: IsoDate;
  curatorName?: string | null;
  items: AdminBoxTemplateItemInput[];
}

/** `PUT /admin/box-templates/:id` gövdesi. */
export interface AdminBoxTemplateUpdate {
  curatorName?: string | null;
  items?: AdminBoxTemplateItemInput[];
}

/** `GET /admin/box-templates?tierId&from&to` sorgusu (from/to YYYY-MM-DD, weekStart aralığı). */
export interface AdminBoxTemplateQuery {
  tierId?: Id;
  from?: IsoDate;
  to?: IsoDate;
}

/** Haftanın kutusu havuzundaki ürün (fresh, silinmemiş). */
export interface AdminBoxPoolProduct {
  id: Id;
  slug: string;
  name: string;
  unit: string;
  boxAmount: string | null;
  status: ProductStatus;
  stockStatus: StockStatus;
  sortOrder: number;
}

/** `GET /admin/box-week?week=` — tier başına o haftanın şablonu (yoksa null) + havuz. */
export interface AdminBoxWeek {
  /** İstenen haftanın Pazartesi'si. */
  weekStart: IsoDate;
  tiers: Array<{
    tier: { id: Id; slug: string; label: string; itemCount: number; isActive: boolean };
    template: AdminBoxTemplate | null;
  }>;
  pool: AdminBoxPoolProduct[];
}

// ── Medya ─────────────────────────────────────────────────────────────────────

/** `POST /admin/media` yanıtı ve `GET /admin/media` satırı. */
export interface AdminMediaFile {
  id: Id;
  /** Genel URL: path `assets/` ile başlıyorsa `/assets/...`, yoksa `/uploads/<path>`. */
  url: string;
  thumbUrl: string | null;
  path: string;
  thumbPath: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  folder: string;
  createdAt: IsoDateTime;
}

/** `GET /admin/media?page&limit&folder&q` yanıtı. */
export interface AdminMediaList extends AdminPage<AdminMediaFile> {
  folders: string[];
}

/** `PATCH /admin/media/:id` gövdesi. */
export interface AdminMediaPatch {
  alt?: string | null;
  folder?: string;
}
