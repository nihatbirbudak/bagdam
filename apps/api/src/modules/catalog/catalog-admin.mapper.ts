import {
  utcToIsoDate,
  type AdminBoxPoolProduct,
  type AdminBoxTemplate,
  type AdminBoxTemplateItem,
  type AdminBoxTier,
  type AdminCategory,
  type AdminProducer,
  type AdminProductDetail,
  type AdminProductImage,
  type AdminProductListItem,
  type AdminProductLot,
  type ExtraOption,
} from '@bagdam/shared';
import { toPublicUrl } from '../media/media.mapper';
import type {
  AdminCategoryRecord,
  AdminImageRecord,
  AdminLotRecord,
  AdminPoolRecord,
  AdminProducerRecord,
  AdminProductListRecord,
  AdminProductRecord,
  AdminTemplateRecord,
  AdminTierRecord,
} from './catalog-admin.repository';
import { toMoney } from './catalog.mapper';

/**
 * CatalogAdminMapper — admin DB kaydı → @bagdam/shared admin DTO'ları (ADR-0002). Saf fonksiyonlar.
 * Görsel URL'leri TEK yerden (media.mapper#toPublicUrl): `assets/...` → `/assets/...`, diğer → `/uploads/...`.
 * Public bootstrap/katalog mapper'ı (catalog.mapper.ts) değişmez — parite korunur.
 */

/** Product.extraOptions JSON → ExtraOption[] (bozuk → null; public mapper ile aynı kural). */
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

export function toAdminProductImage(img: AdminImageRecord): AdminProductImage {
  return {
    id: img.id,
    mediaId: img.mediaId,
    url: toPublicUrl(img.media.path) ?? '',
    thumbUrl: toPublicUrl(img.media.thumbPath),
    alt: img.alt,
    isCover: img.isCover,
    sortOrder: img.sortOrder,
  };
}

export function toAdminProductLot(lot: AdminLotRecord): AdminProductLot {
  return {
    id: lot.id,
    lotCode: lot.lotCode,
    harvestDate: lot.harvestDate ? utcToIsoDate(lot.harvestDate) : null,
    bestBefore: lot.bestBefore ? utcToIsoDate(lot.bestBefore) : null,
    tastingNote: lot.tastingNote,
    isCurrent: lot.isCurrent,
    producerId: lot.producerId,
    producerName: lot.producer?.name ?? null,
    createdAt: lot.createdAt.toISOString(),
  };
}

/** `GET /admin/products/:id` — tüm alanlar + kategori/üretici özeti + görseller + partiler + güncel parti. */
export function toAdminProductDetail(p: AdminProductRecord): AdminProductDetail {
  const lots = p.lots.map(toAdminProductLot);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categoryId: p.categoryId,
    category: { id: p.category.id, slug: p.category.slug, label: p.category.label },
    group: p.group,
    producerId: p.producerId,
    producer: p.producer ? { id: p.producer.id, name: p.producer.name } : null,
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
    images: p.images.map(toAdminProductImage),
    lots,
    currentLot: lots.find((l) => l.isCurrent) ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
  };
}

/** `GET /admin/products` satırı — kapak görseli: isCover olan, yoksa sıradaki ilk görsel. */
export function toAdminProductListItem(p: AdminProductListRecord): AdminProductListItem {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categorySlug: p.category.slug,
    categoryLabel: p.category.label,
    producerName: p.producer?.name ?? null,
    price: toMoney(p.price),
    unit: p.unit,
    status: p.status,
    stockStatus: p.stockStatus,
    isFresh: p.isFresh,
    pairWithBox: p.pairWithBox,
    sortOrder: p.sortOrder,
    coverImageUrl: toPublicUrl(p.images[0]?.media.path),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toAdminCategory(c: AdminCategoryRecord): AdminCategory {
  return {
    id: c.id,
    slug: c.slug,
    legacyTab: c.legacyTab,
    label: c.label,
    panelNote: c.panelNote,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    productCount: c._count.products,
  };
}

export function toAdminProducer(p: AdminProducerRecord): AdminProducer {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    village: p.village,
    district: p.district,
    story: p.story,
    photoMediaId: p.photoMediaId,
    photoUrl: toPublicUrl(p.photoMedia?.path),
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    productCount: p._count.products,
  };
}

export function toAdminTier(t: AdminTierRecord): AdminBoxTier {
  return {
    id: t.id,
    slug: t.slug,
    label: t.label,
    itemCount: t.itemCount,
    price: toMoney(t.price),
    note: t.note,
    imageMediaId: t.imageMediaId,
    imageUrl: toPublicUrl(t.imageMedia?.path),
    isRecommended: t.isRecommended,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

function toAdminTemplateItem(i: AdminTemplateRecord['items'][number]): AdminBoxTemplateItem {
  return {
    id: i.id,
    productId: i.productId,
    productSlug: i.product.slug,
    productName: i.product.name,
    qtyLabel: i.qtyLabel,
    isSwappable: i.isSwappable,
    sortOrder: i.sortOrder,
  };
}

/** `GET /admin/box-templates` satırı; `warning` yalnız PUBLISHED şablonun öğeleri değiştiğinde eklenir. */
export function toAdminTemplate(t: AdminTemplateRecord, warning?: string): AdminBoxTemplate {
  return {
    id: t.id,
    tierId: t.tierId,
    tierSlug: t.tier.slug,
    tierLabel: t.tier.label,
    weekStart: utcToIsoDate(t.weekStart),
    status: t.status,
    curatorName: t.curatorName,
    itemCount: t.items.length,
    items: t.items.map(toAdminTemplateItem),
    ...(warning ? { warning } : {}),
  };
}

export function toAdminPoolProduct(p: AdminPoolRecord): AdminBoxPoolProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    unit: p.unit,
    boxAmount: p.boxAmount,
    status: p.status,
    stockStatus: p.stockStatus,
    sortOrder: p.sortOrder,
  };
}
