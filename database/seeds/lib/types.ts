// database/seeds/lib/types.ts — database/data/*.json dosyalarının tipleri
// convert-products-js.ts üretir, seed.ts okur. products.js alan adları BİREBİR korunur
// (F3 bootstrap snapshot testi bu ham alanlarla karşılaştırır); seed'e özgü türetilmiş
// alanlar ayrıca eklenir.

/** products.js `pref: { label, options, def }`. */
export interface RawPref {
  label: string;
  options: string[];
  def: number;
}

/** products.js `PRODUCTS[]` öğesi — ham alanlar (undefined olanlar JSON'a yazılmaz). */
export interface RawProduct {
  id: string;
  name: string;
  category: string;
  meta: string;
  location: string;
  batch: string;
  price: number;
  unit: string;
  boxAmount?: string;
  img: string;
  images?: string[];
  desc: string;
  why: string;
  pref: RawPref | null;
  fresh: boolean;
  season?: string;
  tab?: 'pantry' | 'dairy' | 'firin';
}

/** catalog.json ürün öğesi: ham alanlar + seed türetmeleri. */
export interface CatalogProduct extends RawProduct {
  /** = products.js id (Product.slug). */
  slug: string;
  /** Category.slug: fresh → boxes; tab pantry → cellar; dairy/firin → aynı. */
  categorySlug: string;
  /** = products.js category (Product.group). */
  group: string;
  /** producers.json slug'ı (meta ilk parçasından). */
  producerSlug: string;
  /** meta ikinci parçası (Köy). */
  village: string | null;
  /** meta üçüncü parçası (İlçe); products.js'te hepsi "Urla". */
  district: string;
  /** meta " — " sonrası ("Erken Hasat"); yoksa null. */
  metaNote: string | null;
  /** kutu.html pairIds içinde mi. */
  pairWithBox: boolean;
  /** pairIds sırası (0 tabanlı); değilse 0. */
  pairOrder: number;
  /** products.js dizisindeki sıra (0 tabanlı). */
  sortOrder: number;
}

/** urunler.html sekmeleri (data-tab) + panel notları. */
export interface CatalogCategory {
  slug: string;
  label: string;
  /** assets/icons/<slug>.png (statik, [B17]) */
  icon: string;
  /** urunler.html `.prod-panel-note` metni; boxes panelinde yok → null. */
  panelNote: string | null;
  /** bootstrap product.tab: cellar→"pantry", dairy, firin, boxes→null [B6]. */
  legacyTab: 'pantry' | 'dairy' | 'firin' | null;
  sortOrder: number;
}

/** products.js `SUB_TIERS[]` öğesi. */
export interface RawTier {
  id: string;
  label: string;
  count: number;
  price: number;
  note: string;
  img: string;
}

export interface RawFreqOption {
  id: string;
  label: string;
  note: string;
  allDays: boolean;
}

export interface RawDeliveryDay {
  id: string;
  label: string;
}

export interface CatalogJson {
  $comment: string;
  source: Record<string, string>;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  tiers: RawTier[];
  freqOptions: RawFreqOption[];
  deliveryDays: RawDeliveryDay[];
  deliveryFee: number;
  /** kutu.html pairIds — kutuya eşlik eden ürünler, sırayla. */
  pairIds: string[];
}

/** producers.json öğesi — meta "Üretici · Köy · İlçe" ayrıştırmasından, ilk görünüş sırasıyla. */
export interface ProducerJson {
  slug: string;
  name: string;
  village: string | null;
  district: string;
  sortOrder: number;
  /** Bu üreticiye bağlı ürün slug'ları (bilgi amaçlı; seed Product.producerId'yi catalog.json'dan kurar). */
  productSlugs: string[];
}

// ── F5 içerik seed'i (database/seeds/content/*.json) ─────────────────────────

/** legal.json `documents[]` öğesi — gövde ayrı dosyada (bodyFile, CONTENT_DIR'e göreli). */
export interface LegalSeedDoc {
  slug: string;
  /** Prisma LegalKind adı (PRIVACY, TERMS, … MARKETING_CONSENT). */
  kind: string;
  title: string;
  leadHtml?: string | null;
  bodyFile: string;
  /** ISO an (ör. 2026-08-18T00:00:00+03:00). */
  effectiveFrom: string;
  isCurrent?: boolean;
  showInNav?: boolean;
  requiresAck?: boolean;
  sortOrder?: number;
  /** Kaynak sayfadaki "SON GÜNCELLEME" etiketi (bilgi amaçlı). */
  sourceUpdatedLabel?: string;
}

/** posts.json `posts[]` öğesi — gövde ayrı dosyada (bodyFile). */
export interface PostSeedDoc {
  slug: string;
  /** Görünen tür etiketi ("Söyleşi", "Mevsim"); gunluk meta'da büyük harfle basılır. */
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt?: string | null;
  bodyFile: string;
  /** MediaFile.path (assets/images/…); seed alt'ı coverAlt'a eşitler. */
  coverPath?: string | null;
  coverAlt?: string | null;
  relatedSlugs?: string[];
  status?: 'DRAFT' | 'PUBLISHED';
  /** ISO an; PUBLISHED için zorunlu. */
  publishedAt: string;
  sortOrder?: number;
}

/** readContentFiles() çıktısı. */
export interface ContentSeedFiles {
  /** key → değer (şema/etiket registry'den). */
  siteContent: Record<string, import('@prisma/client').Prisma.InputJsonObject>;
  legal: LegalSeedDoc[];
  posts: PostSeedDoc[];
}
