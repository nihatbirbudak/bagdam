import { Injectable } from '@nestjs/common';
import {
  ContentStatus,
  type DeliveryDate as DeliveryDateRow,
  type DeliveryZone,
  Prisma,
  ProductStatus,
  type Setting,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * CatalogRepository — katalog okumaları; Prisma YALNIZ burada (ADR-0002).
 * Sorgular salt okunur ve sıralıdır (sortOrder → products.js sırası); filtreler burada, şekillendirme mapper'da.
 * Zaman: ham SQL yok; `now` çağırandan Date olarak gelir (ADR-0004).
 */

/** Müşteri bootstrap'ında görünen stok durumları [B22] (shared BOOTSTRAP_VISIBLE_STOCK_STATUSES ile aynı). */
const VISIBLE_STOCK: readonly StockStatus[] = [StockStatus.IN_STOCK, StockStatus.LOW];

/** Ürün + kategori + üretici + görseller (kapak önce) + güncel parti (en yeni isCurrent). */
export const PRODUCT_INCLUDE = {
  category: true,
  producer: true,
  images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }], include: { media: true } },
  lots: {
    where: { isCurrent: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { producer: { select: { name: true } } },
  },
} satisfies Prisma.ProductInclude;
export type ProductRecord = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

export const TIER_INCLUDE = { imageMedia: true } satisfies Prisma.BoxTierInclude;
export type TierRecord = Prisma.BoxTierGetPayload<{ include: typeof TIER_INCLUDE }>;

/** Şablon + tier özeti + öğeler (sortOrder) + ürün seçimi (görünürlük kararı için status/stok da gelir). */
export const TEMPLATE_INCLUDE = {
  tier: { select: { slug: true, label: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          unit: true,
          boxAmount: true,
          isFresh: true,
          stockStatus: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.BoxTemplateInclude;
export type TemplateRecord = Prisma.BoxTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

/** Üretici + fotoğraf yolu + yayındaki ürün sayısı. */
export const PRODUCER_INCLUDE = {
  photoMedia: { select: { path: true } },
  _count: { select: { products: { where: { deletedAt: null, status: ProductStatus.ACTIVE } } } },
} satisfies Prisma.ProducerInclude;
export type ProducerRecord = Prisma.ProducerGetPayload<{ include: typeof PRODUCER_INCLUDE }>;

export type ZoneRecord = DeliveryZone;
export type DeliveryDateRecord = DeliveryDateRow;

/** Web sekmeleri / panel notları için kategori özeti (F5: index/urunler {{#each categories}}, Category.panelNote tek sahip [B11]). */
export interface ActiveCategoryRecord {
  slug: string;
  label: string;
  panelNote: string | null;
}
export type SettingRecord = Setting;

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Yayındaki ürünler (ACTIVE, silinmemiş), products.js sırasıyla (sortOrder, createdAt).
   * `visibleOnly` → yalnız IN_STOCK/LOW (bootstrap [B22]); false → tüm stok durumları (public `GET /products`).
   */
  findActiveProducts(opts: { visibleOnly: boolean }): Promise<ProductRecord[]> {
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        ...(opts.visibleOnly ? { stockStatus: { in: [...VISIBLE_STOCK] } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: PRODUCT_INCLUDE,
    });
  }

  findActiveProductBySlug(slug: string): Promise<ProductRecord | null> {
    return this.prisma.product.findFirst({
      where: { slug, deletedAt: null, status: ProductStatus.ACTIVE },
      include: PRODUCT_INCLUDE,
    });
  }

  findActiveTiers(): Promise<TierRecord[]> {
    return this.prisma.boxTier.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: TIER_INCLUDE,
    });
  }

  findActiveTierBySlug(slug: string): Promise<TierRecord | null> {
    return this.prisma.boxTier.findFirst({ where: { slug, isActive: true }, include: TIER_INCLUDE });
  }

  /**
   * Aktif tier başına en güncel yayınlanmış şablon (weekStart ≤ verilen hafta başı) — `distinct` ile
   * tier başına tek satır; sıralama tierId → weekStart desc olduğundan ilk satır en günceldir.
   */
  findLatestPublishedTemplates(weekStartLte: Date): Promise<TemplateRecord[]> {
    return this.prisma.boxTemplate.findMany({
      where: { status: ContentStatus.PUBLISHED, weekStart: { lte: weekStartLte }, tier: { isActive: true } },
      orderBy: [{ tierId: 'asc' }, { weekStart: 'desc' }],
      distinct: ['tierId'],
      include: TEMPLATE_INCLUDE,
    });
  }

  findLatestPublishedTemplate(tierId: string, weekStartLte: Date): Promise<TemplateRecord | null> {
    return this.prisma.boxTemplate.findFirst({
      where: { tierId, status: ContentStatus.PUBLISHED, weekStart: { lte: weekStartLte } },
      orderBy: { weekStart: 'desc' },
      include: TEMPLATE_INCLUDE,
    });
  }

  findActiveZoneBySlug(slug: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findFirst({ where: { slug, isActive: true } });
  }

  findFirstActiveZone(): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  /** Bölgenin [fromInclusive, toExclusive) aralığındaki teslimat tarihleri (takvim günü, UTC gece yarısı Date). */
  findDeliveryDates(zoneId: string, fromInclusive: Date, toExclusive: Date): Promise<DeliveryDateRecord[]> {
    return this.prisma.deliveryDate.findMany({
      where: { zoneId, date: { gte: fromInclusive, lt: toExclusive } },
      orderBy: { date: 'asc' },
    });
  }

  /** Aktif kategoriler, sortOrder sırasıyla (slug/label/panelNote) — WebController sekmeleri. */
  findActiveCategories(): Promise<ActiveCategoryRecord[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true, label: true, panelNote: true },
    });
  }

  findSettingsByGroup(group: string): Promise<SettingRecord[]> {
    return this.prisma.setting.findMany({ where: { group } });
  }

  findActiveProducers(): Promise<ProducerRecord[]> {
    return this.prisma.producer.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: PRODUCER_INCLUDE,
    });
  }
}
