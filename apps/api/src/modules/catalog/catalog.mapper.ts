import {
  COMMERCE_SETTINGS_DEFAULTS,
  deliveryDayToSlug,
  utcToIsoDate,
  type BootstrapCommerce,
  type BootstrapProduct,
  type BootstrapTab,
  type BoxTemplate,
  type BoxTemplateItem,
  type BoxTier,
  type CommerceSettings,
  type DeliveryDate,
  type DeliveryDayOption,
  type ExtraOption,
  type FreqOption,
  type Money,
  type Producer,
  type Product,
  type ProductImage,
  type ProductLot,
  type SubTier,
} from '@bagdam/shared';
import { toSiteMediaPath } from '../media/media.mapper';
import { COMMERCE_SETTING_PREFIX, FREQ_OPTION_NOTE } from './catalog.constants';
import type {
  DeliveryDateRecord,
  ProducerRecord,
  ProductRecord,
  SettingRecord,
  TemplateRecord,
  TierRecord,
  ZoneRecord,
} from './catalog.repository';

/**
 * CatalogMapper — DB kaydı → DTO (ADR-0002). Saf fonksiyonlar; DB/framework yok.
 * Bootstrap eşlemesi products.js ile BİREBİR [B6][B21]: alan adları/sırası korunur, opsiyonel alanlar
 * (boxAmount/images/season/tab) değer yoksa HİÇ yazılmaz — snapshot testi alan-alan karşılaştırır.
 */

/** products.js `tab` değerleri — Category.legacyTab bunların dışındaysa alan yazılmaz (urunler.html panelleri sabit). */
const BOOTSTRAP_TABS: readonly BootstrapTab[] = ['pantry', 'dairy', 'firin'];

/** Prisma Decimal → number (Decimal(12,2) kuruş hassasiyetinde tam temsil edilir). */
export function toMoney(value: { toNumber(): number }): Money {
  return value.toNumber();
}

function toBootstrapTab(legacyTab: string | null): BootstrapTab | undefined {
  return (BOOTSTRAP_TABS as readonly string[]).includes(legacyTab ?? '') ? (legacyTab as BootstrapTab) : undefined;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** FE meta "Üretici · Köy · İlçe[ — not]" ve location "Köy · İlçe" — Producer + Product.metaNote'tan. */
export function producerMeta(
  producer: { name: string; village: string | null; district: string } | null,
  metaNote: string | null,
): { meta: string; location: string } {
  const base = producer ? [producer.name, producer.village, producer.district].filter(nonEmpty).join(' · ') : '';
  const note = nonEmpty(metaNote) ? metaNote : null;
  const meta = note ? (base ? `${base} — ${note}` : note) : base;
  const location = producer ? [producer.village, producer.district].filter(nonEmpty).join(' · ') : '';
  return { meta, location };
}

/** Görsel yolları (kapak önce — repository sıralaması isCover desc, sortOrder asc); site-göreli (`assets/...` | `uploads/...`). */
function imagePaths(p: ProductRecord): string[] {
  return p.images.map((img) => siteMediaPath(img.media.path));
}

/** MediaFile.path → site-göreli kaynak (media.mapper tek kural); boş/null → ''. */
function siteMediaPath(path: string | null | undefined): string {
  return toSiteMediaPath(path) ?? '';
}

/**
 * products.js PRODUCTS[] öğesi. Alan SIRASI products.js ile aynı tutulur:
 * id, name, category, meta, location, batch, price, unit, [boxAmount], img, [images], desc, why, pref, fresh, [season], [tab].
 * - images yalnız 1'den fazla görsel varsa (ilki = img); tab yalnız fresh değilse ve legacyTab tanımlıysa.
 * - batch/why güncel partiden (lots[0]); parti yoksa boş string (tip string; UI "parti" satırını boş basar).
 */
export function toBootstrapProduct(p: ProductRecord): BootstrapProduct {
  const lot = p.lots[0] ?? null;
  const paths = imagePaths(p);
  const { meta, location } = producerMeta(p.producer, p.metaNote);
  const tab = p.isFresh ? undefined : toBootstrapTab(p.category.legacyTab);
  const pref =
    nonEmpty(p.prefLabel) && p.prefOptions.length > 0
      ? { label: p.prefLabel, options: [...p.prefOptions], def: p.prefDefault ?? 0 }
      : null;
  return {
    id: p.slug,
    name: p.name,
    category: p.group ?? '',
    meta,
    location,
    batch: lot?.lotCode ?? '',
    price: toMoney(p.price),
    unit: p.unit,
    ...(nonEmpty(p.boxAmount) ? { boxAmount: p.boxAmount } : {}),
    img: paths[0] ?? '',
    ...(paths.length > 1 ? { images: paths } : {}),
    desc: p.description,
    why: lot?.tastingNote ?? '',
    pref,
    fresh: p.isFresh,
    ...(nonEmpty(p.season) ? { season: p.season } : {}),
    ...(tab ? { tab } : {}),
  };
}

/** products.js SUB_TIERS[] öğesi: id=slug, count=itemCount, img=imageMedia.path. */
export function toSubTier(t: TierRecord): SubTier {
  return {
    id: t.slug,
    label: t.label,
    count: t.itemCount,
    price: toMoney(t.price),
    note: t.note ?? '',
    img: siteMediaPath(t.imageMedia?.path),
  };
}

/** products.js FREQ_OPTIONS — Setting commerce.frequencies → {id,label,note:"seçtiğin gün",allDays:false} [B21]. */
export function toFreqOptions(settings: CommerceSettings): FreqOption[] {
  return settings.frequencies.map((f) => ({ id: f.id, label: f.label, note: FREQ_OPTION_NOTE, allDays: false }));
}

/** products.js DELIVERY_DAYS — Setting commerce.deliveryDays → {id,label} (dow istemciye gitmez). */
export function toDeliveryDayOptions(settings: CommerceSettings): DeliveryDayOption[] {
  return settings.deliveryDays.map((d) => ({ id: d.id, label: d.label }));
}

/** Bootstrap deliveryDates öğesi [B9][B49]: locked = kesim geçti (cutoffAt <= now) ya da status != OPEN; full = reserved >= capacity. */
export function toDeliveryDate(row: DeliveryDateRecord, now: Date): DeliveryDate {
  return {
    day: deliveryDayToSlug(row.day),
    date: utcToIsoDate(row.date),
    cutoffAtIso: row.cutoffAt.toISOString(),
    locked: row.cutoffAt.getTime() <= now.getTime() || row.status !== 'OPEN',
    full: row.reserved >= row.capacity,
  };
}

/** Yayınlanmış şablonun ürün slug'ları — yalnız bootstrap'ta görünen ürünler (aksi hâlde cart.js PRODUCTS.find → undefined). */
export function templateProductSlugs(t: TemplateRecord, visibleSlugs: ReadonlySet<string>): string[] {
  return t.items.map((i) => i.product.slug).filter((slug) => visibleSlugs.has(slug));
}

function sameKind(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) return Array.isArray(value);
  return typeof value === typeof fallback && !Array.isArray(value);
}

/**
 * Setting `commerce.*` satırları → CommerceSettings. Varsayılan (COMMERCE_SETTINGS_DEFAULTS) üzerine DB değeri;
 * türü varsayılanla uyuşmayan (bozuk) değer yok sayılır. Bilinmeyen anahtarlar istemciye gitmez.
 */
export function mergeCommerceSettings(rows: readonly SettingRecord[]): CommerceSettings {
  const fromDb = new Map<string, unknown>();
  for (const row of rows) {
    if (row.key.startsWith(COMMERCE_SETTING_PREFIX)) fromDb.set(row.key.slice(COMMERCE_SETTING_PREFIX.length), row.value);
  }
  const merged: Record<string, unknown> = { ...COMMERCE_SETTINGS_DEFAULTS };
  for (const [key, fallback] of Object.entries(COMMERCE_SETTINGS_DEFAULTS)) {
    const value = fromDb.get(key);
    if (value !== undefined && value !== null && sameKind(value, fallback)) merged[key] = value;
  }
  return merged as unknown as CommerceSettings;
}

/** Bootstrap `commerce`: CommerceSettings + varsayılan bölgeden kargo/eşik (sahibi DeliveryZone [B11]). */
export function toBootstrapCommerce(settings: CommerceSettings, zone: ZoneRecord | null): BootstrapCommerce {
  return {
    ...settings,
    freeThreshold: zone?.freeThreshold ? toMoney(zone.freeThreshold) : null,
    deliveryFee: zone ? toMoney(zone.fee) : 0,
  };
}

// ── Public API DTO'ları (GET /products, /tiers, /tiers/:slug/template, /producers) ─────────────────

/** Product.extraOptions JSON → ExtraOption[] (bozuk/eksik → null = Setting extraAmountOptions kullanılır). */
function toExtraOptions(json: unknown): ExtraOption[] | null {
  if (!Array.isArray(json)) return null;
  const out: ExtraOption[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') return null;
    const { factor, label } = item as { factor?: unknown; label?: unknown };
    if (typeof factor !== 'number' || !Number.isFinite(factor) || typeof label !== 'string') return null;
    out.push({ factor, label });
  }
  return out;
}

function toProductImageDto(img: ProductRecord['images'][number]): ProductImage {
  return {
    id: img.id,
    productId: img.productId,
    mediaId: img.mediaId,
    url: siteMediaPath(img.media.path),
    thumbUrl: toSiteMediaPath(img.media.thumbPath),
    alt: img.alt,
    isCover: img.isCover,
    sortOrder: img.sortOrder,
  };
}

function toProductLotDto(lot: ProductRecord['lots'][number]): ProductLot {
  return {
    id: lot.id,
    productId: lot.productId,
    producerId: lot.producerId,
    producerName: lot.producer?.name ?? null,
    lotCode: lot.lotCode,
    harvestDate: lot.harvestDate ? utcToIsoDate(lot.harvestDate) : null,
    bestBefore: lot.bestBefore ? utcToIsoDate(lot.bestBefore) : null,
    tastingNote: lot.tastingNote,
    isCurrent: lot.isCurrent,
    createdAt: lot.createdAt.toISOString(),
  };
}

/** shared `Product` DTO (public liste/detay; admin formu F4'te aynı DTO'yu kullanır). */
export function toProductDto(p: ProductRecord): Product {
  const lot = p.lots[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categoryId: p.categoryId,
    category: { id: p.category.id, slug: p.category.slug, legacyTab: p.category.legacyTab, label: p.category.label },
    group: p.group,
    producerId: p.producerId,
    producer: p.producer
      ? { id: p.producer.id, name: p.producer.name, slug: p.producer.slug, village: p.producer.village, district: p.producer.district }
      : null,
    metaNote: p.metaNote,
    price: toMoney(p.price),
    vatRate: p.vatRate,
    unit: p.unit,
    boxAmount: p.boxAmount,
    extraOptions: toExtraOptions(p.extraOptions),
    description: p.description,
    storageText: p.storageText,
    allergenText: p.allergenText,
    freshnessNote: p.freshnessNote,
    prefLabel: p.prefLabel,
    prefOptions: [...p.prefOptions],
    prefDefault: p.prefDefault,
    isFresh: p.isFresh,
    season: p.season,
    status: p.status,
    stockStatus: p.stockStatus,
    pairWithBox: p.pairWithBox,
    pairOrder: p.pairOrder,
    sortOrder: p.sortOrder,
    images: p.images.map(toProductImageDto),
    currentLot: lot ? toProductLotDto(lot) : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** shared `BoxTier` DTO. */
export function toBoxTierDto(t: TierRecord): BoxTier {
  return {
    id: t.id,
    slug: t.slug,
    label: t.label,
    itemCount: t.itemCount,
    price: toMoney(t.price),
    note: t.note,
    imageMediaId: t.imageMediaId,
    imageUrl: toSiteMediaPath(t.imageMedia?.path),
    isRecommended: t.isRecommended,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

function toBoxTemplateItemDto(i: TemplateRecord['items'][number]): BoxTemplateItem {
  return {
    id: i.id,
    templateId: i.templateId,
    productId: i.productId,
    product: {
      id: i.product.id,
      slug: i.product.slug,
      name: i.product.name,
      unit: i.product.unit,
      boxAmount: i.product.boxAmount,
      isFresh: i.product.isFresh,
      stockStatus: i.product.stockStatus,
    },
    qtyLabel: i.qtyLabel,
    isSwappable: i.isSwappable,
    sortOrder: i.sortOrder,
  };
}

/** shared `BoxTemplate` DTO — tüm öğeler döner (stok/durum alanıyla; görünürlük kararı istemcinin). */
export function toBoxTemplateDto(t: TemplateRecord): BoxTemplate {
  return {
    id: t.id,
    tierId: t.tierId,
    tierSlug: t.tier.slug,
    tierLabel: t.tier.label,
    weekStart: utcToIsoDate(t.weekStart),
    curatorName: t.curatorName,
    status: t.status,
    items: t.items.map(toBoxTemplateItemDto),
  };
}

/** shared `Producer` DTO (+ yayındaki ürün sayısı). */
export function toProducerDto(p: ProducerRecord): Producer {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    village: p.village,
    district: p.district,
    story: p.story,
    photoMediaId: p.photoMediaId,
    photoUrl: toSiteMediaPath(p.photoMedia?.path),
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    productCount: p._count.products,
  };
}
