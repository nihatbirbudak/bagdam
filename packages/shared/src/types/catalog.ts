// ── Katalog DTO'ları + bootstrap (products.js) şekli ─────────────────────────
import type { ContentStatus, DeliveryDaySlug, ProductStatus, StockStatus } from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDate, IsoDateTime } from './common';
import type { DeliveryDate } from './delivery';
import type { CommerceSettings } from './settings';
import type { BootstrapSub } from './subscription';
import type { BootstrapMe } from './user';

// ── Admin / API DTO'ları ──────────────────────────────────────────────────────

/** Category — UI sekmeleri; ikon statik `assets/icons/<slug>.png` [B17]. */
export interface Category {
  id: Id;
  /** boxes | dairy | firin | cellar (UI data-tab). */
  slug: string;
  /** Bootstrap `product.tab`: cellar→"pantry", dairy, firin; boxes→null [B6]. */
  legacyTab: string | null;
  label: string;
  /** urunler.html panel notu — TEK SAHİP [B11]. */
  panelNote: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export interface CategoryInput {
  slug: string;
  legacyTab?: string | null;
  label: string;
  panelNote?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Producer — FE meta "Üretici · Köy · Urla[ — not]". */
export interface Producer {
  id: Id;
  name: string;
  slug: string;
  village: string | null;
  district: string;
  /** şema-var/UI-yok (üretici sayfası P2). */
  story: string | null;
  photoMediaId: Id | null;
  photoUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount?: number;
}

export interface ProducerInput {
  name: string;
  slug: string;
  village?: string | null;
  district?: string;
  story?: string | null;
  photoMediaId?: Id | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ProductImage {
  id: Id;
  productId: Id;
  mediaId: Id;
  /** MediaFile yolu (`/uploads/...` ya da import edilen orijinal `assets/images/...`). */
  url: string;
  thumbUrl: string | null;
  alt: string | null;
  isCover: boolean;
  sortOrder: number;
}

/** ProductLot — FE `batch` (lotCode) + `why` (tastingNote); her ürünün ≥1 lot'u var, `isCurrent` olan bootstrap'a gider. */
export interface ProductLot {
  id: Id;
  productId: Id;
  producerId: Id | null;
  producerName?: string | null;
  lotCode: string;
  harvestDate: IsoDate | null;
  bestBefore: IsoDate | null;
  /** FE `why` — TEK SAHİP [B11]. */
  tastingNote: string | null;
  isCurrent: boolean;
  createdAt: IsoDateTime;
}

export interface ProductLotInput {
  lotCode: string;
  producerId?: Id | null;
  harvestDate?: IsoDate | null;
  bestBefore?: IsoDate | null;
  tastingNote?: string | null;
  isCurrent?: boolean;
}

/** Ekstra miktar seçeneği — cart.js `subExtraOptions` `{factor,label}`; null → Setting `commerce.extraAmountOptions`. */
export interface ExtraOption {
  /** Ürün birim fiyatının çarpanı (250 g için 0.25). */
  factor: number;
  /** Gösterim ("500 g", "2 demet"). */
  label: string;
}

export interface Product {
  id: Id;
  /** FE `id` → `urun.html?id=`, `data-add-to-cart`. */
  slug: string;
  name: string;
  categoryId: Id;
  category?: Pick<Category, 'id' | 'slug' | 'legacyTab' | 'label'>;
  /** FE `category`: meyve | sebze | bakliyat | süt ürünleri | fırın. */
  group: string | null;
  producerId: Id | null;
  producer?: Pick<Producer, 'id' | 'name' | 'slug' | 'village' | 'district'> | null;
  /** "Erken Hasat" — meta sonundaki not. */
  metaNote: string | null;
  price: Money;
  vatRate: number;
  unit: string;
  /** FE "kutuda: …". */
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
  /** kutu.html pairIds. */
  pairWithBox: boolean;
  pairOrder: number;
  sortOrder: number;
  images: ProductImage[];
  currentLot: ProductLot | null;
  lots?: ProductLot[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Admin `POST/PUT /admin/products` gövdesi (görseller ve partiler ayrı uçlardan). */
export interface ProductInput {
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

/** Liste satırı (`GET /admin/products`). */
export interface ProductListItem {
  id: Id;
  slug: string;
  name: string;
  categoryLabel: string;
  producerName: string | null;
  price: Money;
  unit: string;
  status: ProductStatus;
  stockStatus: StockStatus;
  isFresh: boolean;
  pairWithBox: boolean;
  coverUrl: string | null;
  currentLotCode: string | null;
  sortOrder: number;
  updatedAt: IsoDateTime;
}

/** BoxTier — FE SUB_TIERS. */
export interface BoxTier {
  id: Id;
  /** small | sezon. */
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

export interface BoxTierInput {
  slug: string;
  label: string;
  itemCount: number;
  price: Money;
  note?: string | null;
  imageMediaId?: Id | null;
  isRecommended?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface BoxTemplateItem {
  id: Id;
  templateId: Id;
  productId: Id;
  product?: Pick<Product, 'id' | 'slug' | 'name' | 'unit' | 'boxAmount' | 'isFresh' | 'stockStatus'>;
  qtyLabel: string;
  isSwappable: boolean;
  sortOrder: number;
}

/** BoxTemplate — "bu haftanın kutusu"; cycle içeriğinin TEK kaynağı [B4]. */
export interface BoxTemplate {
  id: Id;
  tierId: Id;
  tierSlug?: string;
  tierLabel?: string;
  /** Haftanın pazartesisi (`@db.Date`). */
  weekStart: IsoDate;
  /** şema-var/UI: yalnız packing fişi. */
  curatorName: string | null;
  status: ContentStatus;
  items: BoxTemplateItem[];
}

export interface BoxTemplateInput {
  tierId: Id;
  weekStart: IsoDate;
  curatorName?: string | null;
  items: Array<{ productId: Id; qtyLabel: string; isSwappable?: boolean; sortOrder?: number }>;
}

// ── Bootstrap (products.js şekline BİREBİR) ──────────────────────────────────

/** products.js `pref: { label, options, def }` — `def` seçili seçeneğin indeksi. */
export interface BootstrapPref {
  label: string;
  options: string[];
  def: number;
}

/** products.js `tab` değerleri: Category.legacyTab (cellar→pantry); fresh ürünlerde alan YOK. */
export type BootstrapTab = 'pantry' | 'dairy' | 'firin';

/**
 * products.js `PRODUCTS[]` öğesi — alan adları BİREBİR korunur (cart.js/inline IIFE'ler parse anında okur).
 * Kaynak eşlemesi: id=Product.slug · category=Product.group · meta="Üretici · Köy · İlçe[ — metaNote]" ·
 * location="Köy · İlçe" · batch=currentLot.lotCode · why=currentLot.tastingNote · img=kapak görseli ·
 * images=tüm görseller (1'den fazlaysa) · fresh=isFresh · tab=category.legacyTab (fresh'te yok) ·
 * opsiyonel alanlar (boxAmount/images/season/tab) null ise HİÇ yazılmaz (undefined) — snapshot testi alan-alan.
 * SOLD_OUT / OUT_OF_SEASON / HIDDEN / DRAFT ürünler bootstrap'ta yer almaz [B22].
 */
export interface BootstrapProduct {
  id: string;
  name: string;
  category: string;
  meta: string;
  location: string;
  batch: string;
  price: Money;
  unit: string;
  boxAmount?: string;
  img: string;
  images?: string[];
  desc: string;
  why: string;
  pref: BootstrapPref | null;
  fresh: boolean;
  season?: string;
  tab?: BootstrapTab;
}

/** products.js `SUB_TIERS[]` öğesi. */
export interface SubTier {
  id: string;
  label: string;
  count: number;
  price: Money;
  note: string;
  img: string;
}

/** products.js `FREQ_OPTIONS[]` öğesi — Setting `commerce.frequencies`'ten `{id,label,note:"seçtiğin gün",allDays:false}` [B21]. */
export interface FreqOption {
  id: string;
  label: string;
  note: string;
  allDays: boolean;
}

/** products.js `DELIVERY_DAYS[]` öğesi. */
export interface DeliveryDayOption {
  id: DeliveryDaySlug;
  label: string;
}

/** `__BAGDAM__.templates` — tier slug → ürün slug listesi (cart.js `subSetTier` F3 yaması). */
export type BootstrapTemplates = Record<string, string[]>;

/**
 * `window.__BAGDAM__` — `{{> bootstrap}}` partial'ı ile senkron gömülen yük (ADR-0003, BACKEND-PLANI §1.2).
 * Anonim kısım 60 s cache; `me`/`sub`/`deliveryDates` çerezli istekte doldurulur ve yanıt `private, no-store` olur.
 */
export interface BootstrapPayload {
  products: BootstrapProduct[];
  tiers: SubTier[];
  freqOptions: FreqOption[];
  deliveryDays: DeliveryDayOption[];
  /** Varsayılan bölgenin kargo ücreti (products.js DELIVERY_FEE) — gerçek hesap PricingService'te (zone'dan). */
  deliveryFee: Money;
  /** Oturum yoksa null. */
  me: BootstrapMe | null;
  /** Satın alınmış abonelik DTO'su; yoksa null (cart.js localStorage taslağına düşer). */
  sub: BootstrapSub | null;
  /** Kullanıcının (ya da varsayılan) bölgesi için önümüzdeki haftaların teslimat tarihleri. */
  deliveryDates: DeliveryDate[];
  /** Bu haftanın yayınlanmış BoxTemplate'leri: `{small:[…], sezon:[…]}`. */
  templates: BootstrapTemplates;
  /** Fresh (kutu havuzu) ürün slug'ları — cart.js `freshProducts()` F3 yaması. */
  pool: string[];
  /** kutu.html eşlik eden ürünler (Product.pairWithBox, pairOrder sırasıyla). */
  pairIds: string[];
  /** BoxTier.isRecommended olan tier slug'ı; yoksa null. */
  recommendedTier: string | null;
  /** Setting `commerce.*` içinden istemcinin ihtiyaç duyduğu, gizli olmayan alt küme. */
  commerce: CommerceSettings;
}

// ── F3 ekleri (CatalogService.getBootstrap) — yalnız EKLEME; yukarıdaki sözleşme değişmez ────────

/**
 * Bootstrap `commerce` bloğunun somut şekli: Setting `commerce.*` (CommerceSettings; gizli alan yok) +
 * varsayılan teslimat bölgesinden kargo ücreti / ücretsiz kargo eşiği. Değerlerin TEK SAHİBİ DeliveryZone'dur [B11];
 * burada yalnız istemciye kopyalanır (sepet.html "1000 TL üzeri kargo ücretsiz" / 49 TL metinleri F9'da buradan okunur).
 * `BootstrapPayload.commerce: CommerceSettings` alanına atanabilir (üst küme); JSON'da iki ek alan görünür.
 */
export interface BootstrapCommerce extends CommerceSettings {
  /** Varsayılan bölgenin ücretsiz kargo eşiği (DeliveryZone.freeThreshold); null = eşik yok. */
  freeThreshold: Money | null;
  /** Varsayılan bölgenin kargo ücreti (= BootstrapPayload.deliveryFee). */
  deliveryFee: Money;
}
