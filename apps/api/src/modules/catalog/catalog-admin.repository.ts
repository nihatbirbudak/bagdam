import { Injectable } from '@nestjs/common';
import { ContentStatus, Prisma, ProductStatus, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * CatalogAdminRepository — admin katalog CRUD sorguları; Prisma YALNIZ burada (ADR-0002).
 * Public okumalar CatalogRepository'de kalır; burası yazma + admin listeleri. İş kuralları (tekillik,
 * kapak/güncel parti mantığı, 409/404 kararları) CatalogAdminService'tedir — burada yalnız veri erişimi.
 * Zaman: ham SQL yok; takvim günleri UTC gece yarısı Date olarak gelir (ADR-0004).
 */

export const ADMIN_PRODUCT_INCLUDE = {
  category: { select: { id: true, slug: true, label: true } },
  producer: { select: { id: true, name: true } },
  images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], include: { media: true } },
  lots: {
    orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
    include: { producer: { select: { name: true } } },
  },
} satisfies Prisma.ProductInclude;
export type AdminProductRecord = Prisma.ProductGetPayload<{ include: typeof ADMIN_PRODUCT_INCLUDE }>;

export const ADMIN_PRODUCT_LIST_INCLUDE = {
  category: { select: { slug: true, label: true } },
  producer: { select: { name: true } },
  images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: 1, include: { media: { select: { path: true } } } },
} satisfies Prisma.ProductInclude;
export type AdminProductListRecord = Prisma.ProductGetPayload<{ include: typeof ADMIN_PRODUCT_LIST_INCLUDE }>;

export const ADMIN_LOT_INCLUDE = { producer: { select: { name: true } } } satisfies Prisma.ProductLotInclude;
export type AdminLotRecord = Prisma.ProductLotGetPayload<{ include: typeof ADMIN_LOT_INCLUDE }>;

export const ADMIN_IMAGE_INCLUDE = { media: true } satisfies Prisma.ProductImageInclude;
export type AdminImageRecord = Prisma.ProductImageGetPayload<{ include: typeof ADMIN_IMAGE_INCLUDE }>;

export const ADMIN_CATEGORY_INCLUDE = {
  _count: { select: { products: { where: { deletedAt: null } } } },
} satisfies Prisma.CategoryInclude;
export type AdminCategoryRecord = Prisma.CategoryGetPayload<{ include: typeof ADMIN_CATEGORY_INCLUDE }>;

export const ADMIN_PRODUCER_INCLUDE = {
  photoMedia: { select: { path: true } },
  _count: { select: { products: { where: { deletedAt: null } } } },
} satisfies Prisma.ProducerInclude;
export type AdminProducerRecord = Prisma.ProducerGetPayload<{ include: typeof ADMIN_PRODUCER_INCLUDE }>;

export const ADMIN_TIER_INCLUDE = { imageMedia: { select: { path: true } } } satisfies Prisma.BoxTierInclude;
export type AdminTierRecord = Prisma.BoxTierGetPayload<{ include: typeof ADMIN_TIER_INCLUDE }>;

export const ADMIN_TEMPLATE_INCLUDE = {
  tier: { select: { id: true, slug: true, label: true } },
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { product: { select: { id: true, slug: true, name: true } } },
  },
} satisfies Prisma.BoxTemplateInclude;
export type AdminTemplateRecord = Prisma.BoxTemplateGetPayload<{ include: typeof ADMIN_TEMPLATE_INCLUDE }>;

export const ADMIN_POOL_SELECT = {
  id: true,
  slug: true,
  name: true,
  unit: true,
  boxAmount: true,
  status: true,
  stockStatus: true,
  sortOrder: true,
} satisfies Prisma.ProductSelect;
export type AdminPoolRecord = Prisma.ProductGetPayload<{ select: typeof ADMIN_POOL_SELECT }>;

export interface AdminProductFilter {
  q?: string;
  categoryId?: string;
  status?: ProductStatus;
  stockStatus?: StockStatus;
  isFresh?: boolean;
}

export interface TemplateItemInput {
  productId: string;
  qtyLabel: string;
  isSwappable: boolean;
  sortOrder: number;
}

@Injectable()
export class CatalogAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Ürün ────────────────────────────────────────────────────────────────────

  /** Silinmemiş ürünler (admin listesi): filtre + sayfalama; sıra sortOrder → createdAt. */
  async findProducts(
    filter: AdminProductFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: AdminProductListRecord[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.stockStatus ? { stockStatus: filter.stockStatus } : {}),
      ...(filter.isFresh !== undefined ? { isFresh: filter.isFresh } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { slug: { contains: filter.q, mode: 'insensitive' } },
              { producer: { is: { name: { contains: filter.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: ADMIN_PRODUCT_LIST_INCLUDE,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { rows, total };
  }

  /** Silinmemiş ürün (detay); yoksa null. */
  findProductById(id: string): Promise<AdminProductRecord | null> {
    return this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: ADMIN_PRODUCT_INCLUDE });
  }

  createProduct(data: Prisma.ProductUncheckedCreateInput): Promise<AdminProductRecord> {
    return this.prisma.product.create({ data, include: ADMIN_PRODUCT_INCLUDE });
  }

  updateProduct(id: string, data: Prisma.ProductUncheckedUpdateInput): Promise<AdminProductRecord> {
    return this.prisma.product.update({ where: { id }, data, include: ADMIN_PRODUCT_INCLUDE });
  }

  /** Soft delete (deletedAt); görsel/parti satırları kalır (ADR-0002). */
  softDeleteProduct(id: string, now: Date): Promise<void> {
    return this.prisma.product.update({ where: { id }, data: { deletedAt: now } }).then(() => undefined);
  }

  /** Verilen sıradaki ürünlere sortOrder 0..n-1 (tek transaction). Yalnız silinmemiş ürünler. */
  async reorderProducts(ids: string[]): Promise<number> {
    const results = await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.product.updateMany({ where: { id, deletedAt: null }, data: { sortOrder: index } })),
    );
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  /** Yayındaki tüm fresh ürünler (haftanın kutusu havuzu) — silinmemiş, status ACTIVE/DRAFT/HIDDEN hepsi (admin karar verir). */
  findPoolProducts(): Promise<AdminPoolRecord[]> {
    return this.prisma.product.findMany({
      where: { deletedAt: null, isFresh: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: ADMIN_POOL_SELECT,
    });
  }

  /** Verilen id'lerden silinmemiş olanlar (şablon öğesi doğrulaması). */
  findExistingProductIds(ids: string[]): Promise<string[]> {
    return this.prisma.product
      .findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })
      .then((rows) => rows.map((r) => r.id));
  }

  categoryExists(id: string): Promise<boolean> {
    return this.prisma.category.findUnique({ where: { id }, select: { id: true } }).then(Boolean);
  }

  producerExists(id: string): Promise<boolean> {
    return this.prisma.producer.findUnique({ where: { id }, select: { id: true } }).then(Boolean);
  }

  mediaExists(id: string): Promise<boolean> {
    return this.prisma.mediaFile.findUnique({ where: { id }, select: { id: true } }).then(Boolean);
  }

  // ── Parti ───────────────────────────────────────────────────────────────────

  findLot(productId: string, lotId: string): Promise<AdminLotRecord | null> {
    return this.prisma.productLot.findFirst({ where: { id: lotId, productId }, include: ADMIN_LOT_INCLUDE });
  }

  /** Parti oluşturur; `setCurrent` ise aynı transaction'da diğerlerini isCurrent=false yapar. */
  async createLot(productId: string, data: Omit<Prisma.ProductLotUncheckedCreateInput, 'productId'>, setCurrent: boolean): Promise<AdminLotRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (setCurrent) await tx.productLot.updateMany({ where: { productId, isCurrent: true }, data: { isCurrent: false } });
      return tx.productLot.create({ data: { ...data, productId, isCurrent: setCurrent }, include: ADMIN_LOT_INCLUDE });
    });
  }

  /** Parti günceller; `makeCurrent` ise aynı transaction'da diğerlerini isCurrent=false yapar. */
  async updateLot(productId: string, lotId: string, data: Prisma.ProductLotUncheckedUpdateInput, makeCurrent: boolean): Promise<AdminLotRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (makeCurrent) {
        await tx.productLot.updateMany({ where: { productId, isCurrent: true, NOT: { id: lotId } }, data: { isCurrent: false } });
      }
      return tx.productLot.update({ where: { id: lotId }, data: { ...data, ...(makeCurrent ? { isCurrent: true } : {}) }, include: ADMIN_LOT_INCLUDE });
    });
  }

  /** Partiyi siler; silinen güncel parti ise en yeni kalan partiyi güncel yapar (FE batch/why boş kalmasın). */
  async deleteLot(productId: string, lotId: string, wasCurrent: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productLot.delete({ where: { id: lotId } });
      if (wasCurrent) {
        const next = await tx.productLot.findFirst({ where: { productId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (next) await tx.productLot.update({ where: { id: next.id }, data: { isCurrent: true } });
      }
    });
  }

  // ── Görsel ──────────────────────────────────────────────────────────────────

  findImage(productId: string, imageId: string): Promise<AdminImageRecord | null> {
    return this.prisma.productImage.findFirst({ where: { id: imageId, productId }, include: ADMIN_IMAGE_INCLUDE });
  }

  findImageByMedia(productId: string, mediaId: string): Promise<AdminImageRecord | null> {
    return this.prisma.productImage.findFirst({ where: { productId, mediaId }, include: ADMIN_IMAGE_INCLUDE });
  }

  countImages(productId: string): Promise<number> {
    return this.prisma.productImage.count({ where: { productId } });
  }

  /** Sıradaki sortOrder (max+1); görsel yoksa 0. */
  async nextImageSortOrder(productId: string): Promise<number> {
    const agg = await this.prisma.productImage.aggregate({ where: { productId }, _max: { sortOrder: true } });
    return agg._max.sortOrder === null ? 0 : agg._max.sortOrder + 1;
  }

  /** Görsel ekler; `isCover` ise diğer kapakları kaldırır (tek transaction). */
  async createImage(productId: string, data: { mediaId: string; alt: string | null; isCover: boolean; sortOrder: number }): Promise<AdminImageRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (data.isCover) await tx.productImage.updateMany({ where: { productId, isCover: true }, data: { isCover: false } });
      return tx.productImage.create({ data: { ...data, productId }, include: ADMIN_IMAGE_INCLUDE });
    });
  }

  async updateImage(productId: string, imageId: string, data: Prisma.ProductImageUncheckedUpdateInput, makeCover: boolean): Promise<AdminImageRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (makeCover) await tx.productImage.updateMany({ where: { productId, isCover: true, NOT: { id: imageId } }, data: { isCover: false } });
      return tx.productImage.update({ where: { id: imageId }, data: { ...data, ...(makeCover ? { isCover: true } : {}) }, include: ADMIN_IMAGE_INCLUDE });
    });
  }

  /** Görsel bağını siler (MediaFile silinmez); kapak silindiyse sıradaki ilk görsel kapak olur. */
  async deleteImage(productId: string, imageId: string, wasCover: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      if (wasCover) {
        const next = await tx.productImage.findFirst({ where: { productId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } });
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isCover: true } });
      }
    });
  }

  async reorderImages(productId: string, ids: string[]): Promise<number> {
    const results = await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.productImage.updateMany({ where: { id, productId }, data: { sortOrder: index } })),
    );
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  // ── Kategori ────────────────────────────────────────────────────────────────

  findCategories(): Promise<AdminCategoryRecord[]> {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }], include: ADMIN_CATEGORY_INCLUDE });
  }

  findCategoryById(id: string): Promise<AdminCategoryRecord | null> {
    return this.prisma.category.findUnique({ where: { id }, include: ADMIN_CATEGORY_INCLUDE });
  }

  updateCategory(id: string, data: Prisma.CategoryUpdateInput): Promise<AdminCategoryRecord> {
    return this.prisma.category.update({ where: { id }, data, include: ADMIN_CATEGORY_INCLUDE });
  }

  async reorderCategories(ids: string[]): Promise<number> {
    const results = await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.category.updateMany({ where: { id }, data: { sortOrder: index } })),
    );
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  // ── Üretici ─────────────────────────────────────────────────────────────────

  findProducers(): Promise<AdminProducerRecord[]> {
    return this.prisma.producer.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: ADMIN_PRODUCER_INCLUDE });
  }

  findProducerById(id: string): Promise<AdminProducerRecord | null> {
    return this.prisma.producer.findUnique({ where: { id }, include: ADMIN_PRODUCER_INCLUDE });
  }

  producerSlugExists(slug: string): Promise<boolean> {
    return this.prisma.producer.findUnique({ where: { slug }, select: { id: true } }).then(Boolean);
  }

  createProducer(data: Prisma.ProducerUncheckedCreateInput): Promise<AdminProducerRecord> {
    return this.prisma.producer.create({ data, include: ADMIN_PRODUCER_INCLUDE });
  }

  updateProducer(id: string, data: Prisma.ProducerUncheckedUpdateInput): Promise<AdminProducerRecord> {
    return this.prisma.producer.update({ where: { id }, data, include: ADMIN_PRODUCER_INCLUDE });
  }

  // ── Tier ────────────────────────────────────────────────────────────────────

  findTiers(): Promise<AdminTierRecord[]> {
    return this.prisma.boxTier.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }], include: ADMIN_TIER_INCLUDE });
  }

  findTierById(id: string): Promise<AdminTierRecord | null> {
    return this.prisma.boxTier.findUnique({ where: { id }, include: ADMIN_TIER_INCLUDE });
  }

  /** Tier günceller; `makeRecommended` ise diğerlerinin isRecommended'ı aynı transaction'da false olur. */
  async updateTier(id: string, data: Prisma.BoxTierUncheckedUpdateInput, makeRecommended: boolean): Promise<AdminTierRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (makeRecommended) await tx.boxTier.updateMany({ where: { isRecommended: true, NOT: { id } }, data: { isRecommended: false } });
      return tx.boxTier.update({ where: { id }, data: { ...data, ...(makeRecommended ? { isRecommended: true } : {}) }, include: ADMIN_TIER_INCLUDE });
    });
  }

  // ── Haftanın kutusu (BoxTemplate) ───────────────────────────────────────────

  findTemplates(filter: { tierId?: string; from?: Date; to?: Date }): Promise<AdminTemplateRecord[]> {
    return this.prisma.boxTemplate.findMany({
      where: {
        ...(filter.tierId ? { tierId: filter.tierId } : {}),
        ...(filter.from || filter.to ? { weekStart: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
      },
      orderBy: [{ weekStart: 'desc' }, { tier: { sortOrder: 'asc' } }],
      include: ADMIN_TEMPLATE_INCLUDE,
    });
  }

  findTemplateById(id: string): Promise<AdminTemplateRecord | null> {
    return this.prisma.boxTemplate.findUnique({ where: { id }, include: ADMIN_TEMPLATE_INCLUDE });
  }

  findTemplateByTierWeek(tierId: string, weekStart: Date): Promise<AdminTemplateRecord | null> {
    return this.prisma.boxTemplate.findUnique({ where: { tierId_weekStart: { tierId, weekStart } }, include: ADMIN_TEMPLATE_INCLUDE });
  }

  /** Belirli haftadaki (Pazartesi..Pazar) tüm şablonlar — box-week görünümü. */
  findTemplatesInWeek(weekStart: Date, weekEnd: Date): Promise<AdminTemplateRecord[]> {
    return this.prisma.boxTemplate.findMany({
      where: { weekStart: { gte: weekStart, lte: weekEnd } },
      orderBy: [{ weekStart: 'asc' }],
      include: ADMIN_TEMPLATE_INCLUDE,
    });
  }

  createTemplate(data: { tierId: string; weekStart: Date; curatorName: string | null; status: ContentStatus }, items: TemplateItemInput[]): Promise<AdminTemplateRecord> {
    return this.prisma.boxTemplate.create({
      data: { ...data, items: { create: items } },
      include: ADMIN_TEMPLATE_INCLUDE,
    });
  }

  /** Şablon alanlarını ve (verildiyse) öğelerini tek transaction'da değiştirir (öğeler silinip yeniden yazılır). */
  async updateTemplate(id: string, data: Prisma.BoxTemplateUncheckedUpdateInput, items: TemplateItemInput[] | undefined): Promise<AdminTemplateRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.boxTemplateItem.deleteMany({ where: { templateId: id } });
        if (items.length > 0) await tx.boxTemplateItem.createMany({ data: items.map((i) => ({ ...i, templateId: id })) });
      }
      return tx.boxTemplate.update({ where: { id }, data, include: ADMIN_TEMPLATE_INCLUDE });
    });
  }

  /** Yayınla: aynı tier + aynı hafta aralığındaki diğer PUBLISHED şablonlar DRAFT'a iner (tekillik). */
  async publishTemplate(id: string, tierId: string, weekStart: Date, weekEnd: Date): Promise<AdminTemplateRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.boxTemplate.updateMany({
        where: { tierId, status: ContentStatus.PUBLISHED, weekStart: { gte: weekStart, lte: weekEnd }, NOT: { id } },
        data: { status: ContentStatus.DRAFT },
      });
      return tx.boxTemplate.update({ where: { id }, data: { status: ContentStatus.PUBLISHED }, include: ADMIN_TEMPLATE_INCLUDE });
    });
  }

  deleteTemplate(id: string): Promise<void> {
    return this.prisma.boxTemplate.delete({ where: { id } }).then(() => undefined);
  }
}
