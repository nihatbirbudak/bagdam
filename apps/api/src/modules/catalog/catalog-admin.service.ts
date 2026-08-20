import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDateIn,
  DEFAULT_TZ,
  isoDateToUtc,
  type AdminBoxTemplate,
  type AdminBoxTier,
  type AdminBoxWeek,
  type AdminCategory,
  type AdminPage,
  type AdminProducer,
  type AdminProductDetail,
  type AdminProductImage,
  type AdminProductListItem,
  type AdminProductLot,
  type IsoDate,
} from '@bagdam/shared';
import { ContentStatus, Prisma } from '@prisma/client';
import {
  toAdminCategory,
  toAdminPoolProduct,
  toAdminProducer,
  toAdminProductDetail,
  toAdminProductImage,
  toAdminProductListItem,
  toAdminProductLot,
  toAdminTemplate,
  toAdminTier,
} from './catalog-admin.mapper';
import { CatalogAdminRepository, type TemplateItemInput } from './catalog-admin.repository';
import { CatalogService, weekMondayOf } from './catalog.service';
import type { BoxTemplateItemDto, BoxTemplateQueryDto, CreateBoxTemplateDto, UpdateBoxTemplateDto } from './dto/admin/box-template.dto';
import type { UpdateCategoryDto } from './dto/admin/category.dto';
import type { CreateProductImageDto, UpdateProductImageDto } from './dto/admin/image.dto';
import type { CreateLotDto, UpdateLotDto } from './dto/admin/lot.dto';
import type { CreateProducerDto, UpdateProducerDto } from './dto/admin/producer.dto';
import type { ProductPairDto, ProductStatusDto, ProductStockDto } from './dto/admin/product-patch.dto';
import type { AdminProductQueryDto } from './dto/admin/product-query.dto';
import type { CreateProductDto, UpdateProductDto } from './dto/admin/product-upsert.dto';
import type { UpdateTierDto } from './dto/admin/tier.dto';

/** Admin liste varsayılanları (PaginationQueryDto: page ≥1, limit 1–100). */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

/** PUBLISHED şablonun öğeleri değiştiğinde yanıta eklenen uyarı (BACKEND-PLANI §3 box-templates PUT). */
const PUBLISHED_ITEMS_WARNING =
  'Yayındaki şablonun içeriği değişti: kutu.html ve bu haftanın bootstrap yükü anında güncellenir; oluşturulmuş cycle içerikleri (F7) etkilenmez.';

/** Türkçe karakter duyarlı slug (database/seeds/lib/slug.ts ile aynı kural — üretici adı → slug). */
const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};
export function slugify(input: string): string {
  const mapped = Array.from(input.trim())
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return mapped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Prisma bilinen hata kodu mu? (P2002 unique · P2003 FK · P2025 kayıt yok) */
function prismaCode(err: unknown): string | null {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
}

/** number → Prisma.Decimal (kuruş hassasiyeti; Decimal(12,2)). */
function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/** `YYYY-MM-DD` → UTC gece yarısı; takvimde yoksa 400. */
function toDateOrThrow(field: string, value: string): Date {
  try {
    return isoDateToUtc(value);
  } catch {
    throw new BadRequestException(`${field} takvimde olmayan bir gün: ${value}`);
  }
}

/** undefined → alan dokunulmaz; null → DB'ye null; string → Date. */
function optionalDate(field: string, value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return toDateOrThrow(field, value);
}

/**
 * CatalogAdminService — katalog admin iş kuralları (BACKEND-PLANI §3 catalog admin satırı, §4 ekran 2–7).
 * - Her mutasyon sonunda CatalogService.invalidateBootstrapCache() (sonraki bootstrap DB'den kurulur).
 * - Tekillikler: slug (409), parti kodu ürün içinde (409), tier+hafta (409), güncel parti / kapak / önerilen tier tek.
 * - Soft delete: Product.deletedAt (görsel/parti satırları kalır); Producer'da deletedAt yok → isActive=false.
 * - weekStart her zaman haftanın Pazartesi'sine yuvarlanır (bootstrap/public uçlarla aynı hafta tanımı).
 */
@Injectable()
export class CatalogAdminService {
  private readonly logger = new Logger(CatalogAdminService.name);

  constructor(
    private readonly repo: CatalogAdminRepository,
    private readonly catalog: CatalogService,
  ) {}

  // ── Ürün ────────────────────────────────────────────────────────────────────

  async listProducts(query: AdminProductQueryDto): Promise<AdminPage<AdminProductListItem>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total } = await this.repo.findProducts(
      { q: query.q || undefined, categoryId: query.categoryId, status: query.status, stockStatus: query.stockStatus, isFresh: query.isFresh },
      page,
      limit,
    );
    return { items: rows.map(toAdminProductListItem), total, page, limit };
  }

  async getProduct(id: string): Promise<AdminProductDetail> {
    const row = await this.repo.findProductById(id);
    if (!row) throw new NotFoundException('Ürün bulunamadı');
    return toAdminProductDetail(row);
  }

  async createProduct(dto: CreateProductDto): Promise<AdminProductDetail> {
    await this.assertRefs(dto.categoryId, dto.producerId ?? null);
    const data: Prisma.ProductUncheckedCreateInput = {
      slug: dto.slug,
      name: dto.name,
      categoryId: dto.categoryId,
      group: dto.group ?? null,
      producerId: dto.producerId ?? null,
      metaNote: dto.metaNote ?? null,
      price: toDecimal(dto.price),
      vatRate: dto.vatRate ?? 1,
      unit: dto.unit,
      boxAmount: dto.boxAmount ?? null,
      extraOptions: dto.extraOptions === undefined || dto.extraOptions === null ? Prisma.JsonNull : dto.extraOptions.map((o) => ({ factor: o.factor, label: o.label })),
      description: dto.description,
      storageText: dto.storageText ?? null,
      allergenText: dto.allergenText ?? null,
      freshnessNote: dto.freshnessNote ?? null,
      prefLabel: dto.prefLabel ?? null,
      prefOptions: dto.prefOptions ?? [],
      prefDefault: dto.prefDefault ?? null,
      isFresh: dto.isFresh ?? false,
      season: dto.season ?? null,
      status: dto.status ?? 'ACTIVE',
      stockStatus: dto.stockStatus ?? 'IN_STOCK',
      pairWithBox: dto.pairWithBox ?? false,
      pairOrder: dto.pairOrder ?? 0,
      sortOrder: dto.sortOrder ?? 0,
    };
    try {
      const row = await this.repo.createProduct(data);
      await this.invalidate();
      return toAdminProductDetail(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug}`);
      throw err;
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<AdminProductDetail> {
    await this.ensureProduct(id);
    await this.assertRefs(dto.categoryId, dto.producerId ?? null);
    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.group !== undefined ? { group: dto.group } : {}),
      ...(dto.producerId !== undefined ? { producerId: dto.producerId } : {}),
      ...(dto.metaNote !== undefined ? { metaNote: dto.metaNote } : {}),
      ...(dto.price !== undefined ? { price: toDecimal(dto.price) } : {}),
      ...(dto.vatRate !== undefined ? { vatRate: dto.vatRate } : {}),
      ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
      ...(dto.boxAmount !== undefined ? { boxAmount: dto.boxAmount } : {}),
      ...(dto.extraOptions !== undefined
        ? { extraOptions: dto.extraOptions === null ? Prisma.JsonNull : dto.extraOptions.map((o) => ({ factor: o.factor, label: o.label })) }
        : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.storageText !== undefined ? { storageText: dto.storageText } : {}),
      ...(dto.allergenText !== undefined ? { allergenText: dto.allergenText } : {}),
      ...(dto.freshnessNote !== undefined ? { freshnessNote: dto.freshnessNote } : {}),
      ...(dto.prefLabel !== undefined ? { prefLabel: dto.prefLabel } : {}),
      ...(dto.prefOptions !== undefined ? { prefOptions: dto.prefOptions } : {}),
      ...(dto.prefDefault !== undefined ? { prefDefault: dto.prefDefault } : {}),
      ...(dto.isFresh !== undefined ? { isFresh: dto.isFresh } : {}),
      ...(dto.season !== undefined ? { season: dto.season } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.stockStatus !== undefined ? { stockStatus: dto.stockStatus } : {}),
      ...(dto.pairWithBox !== undefined ? { pairWithBox: dto.pairWithBox } : {}),
      ...(dto.pairOrder !== undefined ? { pairOrder: dto.pairOrder } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    try {
      const row = await this.repo.updateProduct(id, data);
      await this.invalidate();
      return toAdminProductDetail(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug ?? ''}`);
      throw err;
    }
  }

  async deleteProduct(id: string): Promise<void> {
    await this.ensureProduct(id);
    await this.repo.softDeleteProduct(id, new Date());
    await this.invalidate();
  }

  async setProductStatus(id: string, dto: ProductStatusDto): Promise<AdminProductDetail> {
    await this.ensureProduct(id);
    const row = await this.repo.updateProduct(id, { status: dto.status });
    await this.invalidate();
    return toAdminProductDetail(row);
  }

  async setProductStock(id: string, dto: ProductStockDto): Promise<AdminProductDetail> {
    await this.ensureProduct(id);
    const row = await this.repo.updateProduct(id, { stockStatus: dto.stockStatus });
    await this.invalidate();
    return toAdminProductDetail(row);
  }

  async setProductPair(id: string, dto: ProductPairDto): Promise<AdminProductDetail> {
    await this.ensureProduct(id);
    const row = await this.repo.updateProduct(id, {
      pairWithBox: dto.pairWithBox,
      ...(dto.pairOrder !== undefined ? { pairOrder: dto.pairOrder } : {}),
    });
    await this.invalidate();
    return toAdminProductDetail(row);
  }

  /** Verilen sıra → sortOrder 0..n-1; listede olmayan ürünler dokunulmaz. Döner: güncellenen sayı. */
  async reorderProducts(ids: string[]): Promise<{ updated: number }> {
    const updated = await this.repo.reorderProducts(ids);
    await this.invalidate();
    return { updated };
  }

  // ── Parti ───────────────────────────────────────────────────────────────────

  async createLot(productId: string, dto: CreateLotDto): Promise<AdminProductLot> {
    await this.ensureProduct(productId);
    if (dto.producerId) await this.assertProducer(dto.producerId);
    const setCurrent = dto.setCurrent ?? true;
    try {
      const row = await this.repo.createLot(
        productId,
        {
          lotCode: dto.lotCode,
          harvestDate: optionalDate('harvestDate', dto.harvestDate) ?? null,
          bestBefore: optionalDate('bestBefore', dto.bestBefore) ?? null,
          tastingNote: dto.tastingNote ?? null,
          producerId: dto.producerId ?? null,
        },
        setCurrent,
      );
      await this.invalidate();
      return toAdminProductLot(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu parti kodu bu üründe zaten var: ${dto.lotCode}`);
      throw err;
    }
  }

  async updateLot(productId: string, lotId: string, dto: UpdateLotDto): Promise<AdminProductLot> {
    await this.ensureProduct(productId);
    const existing = await this.repo.findLot(productId, lotId);
    if (!existing) throw new NotFoundException('Parti bulunamadı');
    if (dto.producerId) await this.assertProducer(dto.producerId);
    // isCurrent=false ile güncel partiyi "güncel değil" yapmak ürünü partisiz bırakır → reddet (başka partiyi güncel yap).
    if (dto.isCurrent === false && existing.isCurrent) {
      throw new BadRequestException('Güncel parti doğrudan kaldırılamaz; başka bir partiyi güncel yapın.');
    }
    const makeCurrent = dto.isCurrent === true || dto.setCurrent === true;
    const data: Prisma.ProductLotUncheckedUpdateInput = {
      ...(dto.lotCode !== undefined ? { lotCode: dto.lotCode } : {}),
      ...(dto.harvestDate !== undefined ? { harvestDate: optionalDate('harvestDate', dto.harvestDate) } : {}),
      ...(dto.bestBefore !== undefined ? { bestBefore: optionalDate('bestBefore', dto.bestBefore) } : {}),
      ...(dto.tastingNote !== undefined ? { tastingNote: dto.tastingNote } : {}),
      ...(dto.producerId !== undefined ? { producerId: dto.producerId } : {}),
    };
    try {
      const row = await this.repo.updateLot(productId, lotId, data, makeCurrent);
      await this.invalidate();
      return toAdminProductLot(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu parti kodu bu üründe zaten var: ${dto.lotCode ?? ''}`);
      throw err;
    }
  }

  async deleteLot(productId: string, lotId: string): Promise<void> {
    await this.ensureProduct(productId);
    const existing = await this.repo.findLot(productId, lotId);
    if (!existing) throw new NotFoundException('Parti bulunamadı');
    await this.repo.deleteLot(productId, lotId, existing.isCurrent);
    await this.invalidate();
  }

  // ── Görsel ──────────────────────────────────────────────────────────────────

  async addImage(productId: string, dto: CreateProductImageDto): Promise<AdminProductImage> {
    await this.ensureProduct(productId);
    if (!(await this.repo.mediaExists(dto.mediaId))) throw new NotFoundException('Medya dosyası bulunamadı');
    if (await this.repo.findImageByMedia(productId, dto.mediaId)) throw new ConflictException('Bu görsel üründe zaten var');
    const count = await this.repo.countImages(productId);
    // İlk görsel otomatik kapak olur; aksi hâlde yalnız istenirse.
    const isCover = dto.isCover ?? count === 0;
    const sortOrder = await this.repo.nextImageSortOrder(productId);
    const row = await this.repo.createImage(productId, { mediaId: dto.mediaId, alt: dto.alt ?? null, isCover, sortOrder });
    await this.invalidate();
    return toAdminProductImage(row);
  }

  async updateImage(productId: string, imageId: string, dto: UpdateProductImageDto): Promise<AdminProductImage> {
    await this.ensureProduct(productId);
    const existing = await this.repo.findImage(productId, imageId);
    if (!existing) throw new NotFoundException('Görsel bulunamadı');
    if (dto.isCover === false && existing.isCover) {
      throw new BadRequestException('Kapak doğrudan kaldırılamaz; başka bir görseli kapak yapın.');
    }
    const row = await this.repo.updateImage(
      productId,
      imageId,
      {
        ...(dto.alt !== undefined ? { alt: dto.alt } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      dto.isCover === true,
    );
    await this.invalidate();
    return toAdminProductImage(row);
  }

  async reorderImages(productId: string, ids: string[]): Promise<{ updated: number }> {
    await this.ensureProduct(productId);
    const updated = await this.repo.reorderImages(productId, ids);
    await this.invalidate();
    return { updated };
  }

  /** Görsel bağını kaldırır — MediaFile silinmez (medya kütüphanesinde kalır). */
  async deleteImage(productId: string, imageId: string): Promise<void> {
    await this.ensureProduct(productId);
    const existing = await this.repo.findImage(productId, imageId);
    if (!existing) throw new NotFoundException('Görsel bulunamadı');
    await this.repo.deleteImage(productId, imageId, existing.isCover);
    await this.invalidate();
  }

  // ── Kategori ────────────────────────────────────────────────────────────────

  async listCategories(): Promise<AdminCategory[]> {
    const rows = await this.repo.findCategories();
    return rows.map(toAdminCategory);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<AdminCategory> {
    if (!(await this.repo.findCategoryById(id))) throw new NotFoundException('Kategori bulunamadı');
    const row = await this.repo.updateCategory(id, {
      label: dto.label,
      ...(dto.panelNote !== undefined ? { panelNote: dto.panelNote } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.legacyTab !== undefined ? { legacyTab: dto.legacyTab } : {}),
    });
    await this.invalidate();
    return toAdminCategory(row);
  }

  async reorderCategories(ids: string[]): Promise<{ updated: number }> {
    const updated = await this.repo.reorderCategories(ids);
    await this.invalidate();
    return { updated };
  }

  // ── Üretici ─────────────────────────────────────────────────────────────────

  async listProducers(): Promise<AdminProducer[]> {
    const rows = await this.repo.findProducers();
    return rows.map(toAdminProducer);
  }

  async getProducer(id: string): Promise<AdminProducer> {
    const row = await this.repo.findProducerById(id);
    if (!row) throw new NotFoundException('Üretici bulunamadı');
    return toAdminProducer(row);
  }

  async createProducer(dto: CreateProducerDto): Promise<AdminProducer> {
    if (dto.photoMediaId && !(await this.repo.mediaExists(dto.photoMediaId))) throw new NotFoundException('Medya dosyası bulunamadı');
    const slug = dto.slug ?? (await this.uniqueProducerSlug(dto.name));
    try {
      const row = await this.repo.createProducer({
        name: dto.name,
        slug,
        village: dto.village ?? null,
        district: dto.district ?? 'Urla',
        story: dto.story ?? null,
        photoMediaId: dto.photoMediaId ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
      await this.invalidate();
      return toAdminProducer(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${slug}`);
      throw err;
    }
  }

  async updateProducer(id: string, dto: UpdateProducerDto): Promise<AdminProducer> {
    if (!(await this.repo.findProducerById(id))) throw new NotFoundException('Üretici bulunamadı');
    if (dto.photoMediaId && !(await this.repo.mediaExists(dto.photoMediaId))) throw new NotFoundException('Medya dosyası bulunamadı');
    try {
      const row = await this.repo.updateProducer(id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        ...(dto.village !== undefined ? { village: dto.village } : {}),
        ...(dto.district !== undefined ? { district: dto.district } : {}),
        ...(dto.story !== undefined ? { story: dto.story } : {}),
        ...(dto.photoMediaId !== undefined ? { photoMediaId: dto.photoMediaId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      });
      await this.invalidate();
      return toAdminProducer(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug ?? ''}`);
      throw err;
    }
  }

  /** Producer'da deletedAt yok → pasifleştirme (isActive=false); ürün bağları korunur. */
  async deactivateProducer(id: string): Promise<void> {
    if (!(await this.repo.findProducerById(id))) throw new NotFoundException('Üretici bulunamadı');
    await this.repo.updateProducer(id, { isActive: false });
    await this.invalidate();
  }

  // ── Tier ────────────────────────────────────────────────────────────────────

  async listTiers(): Promise<AdminBoxTier[]> {
    const rows = await this.repo.findTiers();
    return rows.map(toAdminTier);
  }

  async updateTier(id: string, dto: UpdateTierDto): Promise<AdminBoxTier> {
    const existing = await this.repo.findTierById(id);
    if (!existing) throw new NotFoundException('Kutu boyu bulunamadı');
    if (dto.imageMediaId && !(await this.repo.mediaExists(dto.imageMediaId))) throw new NotFoundException('Medya dosyası bulunamadı');
    const makeRecommended = dto.isRecommended === true;
    const row = await this.repo.updateTier(
      id,
      {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.itemCount !== undefined ? { itemCount: dto.itemCount } : {}),
        ...(dto.price !== undefined ? { price: toDecimal(dto.price) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.imageMediaId !== undefined ? { imageMediaId: dto.imageMediaId } : {}),
        ...(dto.isRecommended === false ? { isRecommended: false } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      makeRecommended,
    );
    await this.invalidate();
    return toAdminTier(row);
  }

  // ── Haftanın kutusu (BoxTemplate) ───────────────────────────────────────────

  async listTemplates(query: BoxTemplateQueryDto): Promise<AdminBoxTemplate[]> {
    const rows = await this.repo.findTemplates({
      tierId: query.tierId,
      from: query.from ? toDateOrThrow('from', query.from) : undefined,
      to: query.to ? toDateOrThrow('to', query.to) : undefined,
    });
    return rows.map((r) => toAdminTemplate(r));
  }

  async getTemplate(id: string): Promise<AdminBoxTemplate> {
    const row = await this.repo.findTemplateById(id);
    if (!row) throw new NotFoundException('Şablon bulunamadı');
    return toAdminTemplate(row);
  }

  async createTemplate(dto: CreateBoxTemplateDto): Promise<AdminBoxTemplate> {
    if (!(await this.repo.findTierById(dto.tierId))) throw new NotFoundException('Kutu boyu bulunamadı');
    const weekStart = this.toWeekStart('weekStart', dto.weekStart);
    const items = await this.buildTemplateItems(dto.items);
    try {
      const row = await this.repo.createTemplate(
        { tierId: dto.tierId, weekStart: isoDateToUtc(weekStart), curatorName: dto.curatorName ?? null, status: ContentStatus.DRAFT },
        items,
      );
      await this.invalidate();
      return toAdminTemplate(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu kutu boyu için ${weekStart} haftasında zaten bir şablon var`);
      throw err;
    }
  }

  /** DRAFT: serbest; PUBLISHED: öğeler değişebilir ama yanıtta `warning` döner (BACKEND-PLANI §3). */
  async updateTemplate(id: string, dto: UpdateBoxTemplateDto): Promise<AdminBoxTemplate> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new NotFoundException('Şablon bulunamadı');
    const items = dto.items ? await this.buildTemplateItems(dto.items) : undefined;
    const row = await this.repo.updateTemplate(id, { ...(dto.curatorName !== undefined ? { curatorName: dto.curatorName } : {}) }, items);
    await this.invalidate();
    const warning = items && existing.status === ContentStatus.PUBLISHED ? PUBLISHED_ITEMS_WARNING : undefined;
    return toAdminTemplate(row, warning);
  }

  /** Yayınla: aynı tier + hafta içindeki diğer PUBLISHED şablonlar DRAFT'a iner (tekillik) — bootstrap bunu basar. */
  async publishTemplate(id: string): Promise<AdminBoxTemplate> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new NotFoundException('Şablon bulunamadı');
    if (existing.items.length === 0) throw new BadRequestException('Boş şablon yayınlanamaz; önce ürün ekleyin.');
    // Hafta aralığı şablonun kendi gününden değil, o haftanın Pazartesi'sinden (Pazartesi..Pazar) hesaplanır.
    const monday = weekMondayOf(this.isoOf(existing.weekStart));
    const row = await this.repo.publishTemplate(id, existing.tierId, isoDateToUtc(monday), isoDateToUtc(addCalendarDays(monday, 6)));
    await this.invalidate();
    return toAdminTemplate(row);
  }

  /** Gelecek haftaya kopya: weekStart+7, DRAFT, aynı öğeler; hedef haftada şablon varsa 409. */
  async cloneNextWeek(id: string): Promise<AdminBoxTemplate> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new NotFoundException('Şablon bulunamadı');
    const nextWeek = addCalendarDays(this.isoOf(existing.weekStart), 7);
    const items: TemplateItemInput[] = existing.items.map((i, index) => ({
      productId: i.productId,
      qtyLabel: i.qtyLabel,
      isSwappable: i.isSwappable,
      sortOrder: index,
    }));
    try {
      const row = await this.repo.createTemplate(
        { tierId: existing.tierId, weekStart: isoDateToUtc(nextWeek), curatorName: existing.curatorName, status: ContentStatus.DRAFT },
        items,
      );
      await this.invalidate();
      return toAdminTemplate(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`${nextWeek} haftasında bu kutu boyu için zaten bir şablon var`);
      throw err;
    }
  }

  /** Yalnız DRAFT silinir; yayındaki şablon için 409 (önce başka şablon yayınlanmalı). */
  async deleteTemplate(id: string): Promise<void> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new NotFoundException('Şablon bulunamadı');
    if (existing.status === ContentStatus.PUBLISHED) throw new ConflictException('Yayındaki şablon silinemez');
    await this.repo.deleteTemplate(id);
    await this.invalidate();
  }

  /** `GET /admin/box-week?week=` — o haftanın (Pazartesi) tier başına şablonu (yoksa null) + fresh havuz. */
  async getBoxWeek(week?: string): Promise<AdminBoxWeek> {
    const weekStart = this.toWeekStart('week', week ?? calendarDateIn(new Date(), DEFAULT_TZ));
    const weekEnd = addCalendarDays(weekStart, 6);
    const [tiers, templates, pool] = await Promise.all([
      this.repo.findTiers(),
      this.repo.findTemplatesInWeek(isoDateToUtc(weekStart), isoDateToUtc(weekEnd)),
      this.repo.findPoolProducts(),
    ]);
    return {
      weekStart,
      tiers: tiers.map((t) => {
        // Aynı hafta içinde birden fazla satır varsa (Pazartesi dışı eski kayıt) yayındaki, yoksa ilk kayıt.
        const ofTier = templates.filter((tpl) => tpl.tierId === t.id);
        const chosen = ofTier.find((tpl) => tpl.status === ContentStatus.PUBLISHED) ?? ofTier[0] ?? null;
        return {
          tier: { id: t.id, slug: t.slug, label: t.label, itemCount: t.itemCount, isActive: t.isActive },
          template: chosen ? toAdminTemplate(chosen) : null,
        };
      }),
      pool: pool.map(toAdminPoolProduct),
    };
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  private async invalidate(): Promise<void> {
    try {
      await this.catalog.invalidateBootstrapCache();
    } catch (err) {
      // Cache düşürme başarısızsa 60 s sonra kendiliğinden yenilenir; mutasyonu geri alma.
      this.logger.warn(`Bootstrap cache düşürülemedi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async ensureProduct(id: string): Promise<void> {
    if (!(await this.repo.findProductById(id))) throw new NotFoundException('Ürün bulunamadı');
  }

  private async assertProducer(id: string): Promise<void> {
    if (!(await this.repo.producerExists(id))) throw new NotFoundException('Üretici bulunamadı');
  }

  /** Kategori/üretici referansları var mı (FK hatası yerine okunur 404). */
  private async assertRefs(categoryId: string | undefined, producerId: string | null): Promise<void> {
    if (categoryId && !(await this.repo.categoryExists(categoryId))) throw new NotFoundException('Kategori bulunamadı');
    if (producerId) await this.assertProducer(producerId);
  }

  private async uniqueProducerSlug(name: string): Promise<string> {
    const base = slugify(name) || 'uretici';
    let candidate = base;
    for (let i = 2; await this.repo.producerSlugExists(candidate); i++) candidate = `${base}-${i}`.slice(0, 80);
    return candidate;
  }

  /** Şablon öğeleri: ürünler var mı (silinmemiş), tekrar yok mu; sıra dizideki sıradır. */
  private async buildTemplateItems(items: BoxTemplateItemDto[]): Promise<TemplateItemInput[]> {
    const ids = items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Şablonda aynı ürün birden fazla kez olamaz');
    if (ids.length > 0) {
      const existing = new Set(await this.repo.findExistingProductIds(ids));
      const missing = ids.filter((id) => !existing.has(id));
      if (missing.length > 0) throw new NotFoundException(`Ürün bulunamadı: ${missing.join(', ')}`);
    }
    return items.map((i, index) => ({ productId: i.productId, qtyLabel: i.qtyLabel, isSwappable: i.isSwappable ?? true, sortOrder: index }));
  }

  /** YYYY-MM-DD (haftanın herhangi bir günü) → takvim denetimi (400) → Pazartesi. */
  private toWeekStart(field: string, value: string): IsoDate {
    toDateOrThrow(field, value);
    return weekMondayOf(value);
  }

  private isoOf(utcMidnight: Date): IsoDate {
    const y = utcMidnight.getUTCFullYear();
    const m = String(utcMidnight.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utcMidnight.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
