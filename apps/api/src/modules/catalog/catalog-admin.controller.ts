import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type {
  AdminBoxTemplate,
  AdminBoxTier,
  AdminBoxWeek,
  AdminCategory,
  AdminPage,
  AdminProducer,
  AdminProductDetail,
  AdminProductImage,
  AdminProductListItem,
  AdminProductLot,
} from '@bagdam/shared';
import { Audited } from '../../common/decorators/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogAdminService } from './catalog-admin.service';
import { BoxTemplateQueryDto, BoxWeekQueryDto, CreateBoxTemplateDto, UpdateBoxTemplateDto } from './dto/admin/box-template.dto';
import { UpdateCategoryDto } from './dto/admin/category.dto';
import { IdParamDto, ImageParamsDto, LotParamsDto } from './dto/admin/id-param.dto';
import { CreateProductImageDto, UpdateProductImageDto } from './dto/admin/image.dto';
import { CreateLotDto, UpdateLotDto } from './dto/admin/lot.dto';
import { CreateProducerDto, UpdateProducerDto } from './dto/admin/producer.dto';
import { ProductPairDto, ProductStatusDto, ProductStockDto } from './dto/admin/product-patch.dto';
import { AdminProductQueryDto } from './dto/admin/product-query.dto';
import { CreateProductDto, UpdateProductDto } from './dto/admin/product-upsert.dto';
import { ReorderDto } from './dto/admin/reorder.dto';
import { UpdateTierDto } from './dto/admin/tier.dto';

/**
 * CatalogAdminController — `/api/v1/admin/*` katalog CRUD (BACKEND-PLANI §3 catalog admin satırı, §4 ekran 2–7).
 * Class-level `@Roles('ADMIN','STAFF')` (RolesGuard) + `@Audited('catalog')` (AuditLogInterceptor: mutasyonlar AuditLog'a).
 * İnce katman: doğrulama DTO'larda, kurallar CatalogAdminService'te; her mutasyon bootstrap cache'ini düşürür.
 * Yanıt kodları: POST oluşturma 201 · eylem (reorder/publish) 200 · DELETE 204.
 */
@Controller('admin')
@Roles('ADMIN', 'STAFF')
@Audited('catalog')
export class CatalogAdminController {
  constructor(private readonly service: CatalogAdminService) {}

  // ── Ürünler ─────────────────────────────────────────────────────────────────

  @Get('products')
  listProducts(@Query() query: AdminProductQueryDto): Promise<AdminPage<AdminProductListItem>> {
    return this.service.listProducts(query);
  }

  /** Not: 'products/reorder' statik rota, 'products/:id'den önce tanımlı olmalı (Express eşleme sırası). */
  @Post('products/reorder')
  @HttpCode(HttpStatus.OK)
  reorderProducts(@Body() dto: ReorderDto): Promise<{ updated: number }> {
    return this.service.reorderProducts(dto.ids);
  }

  @Get('products/:id')
  getProduct(@Param() params: IdParamDto): Promise<AdminProductDetail> {
    return this.service.getProduct(params.id);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto): Promise<AdminProductDetail> {
    return this.service.createProduct(dto);
  }

  @Put('products/:id')
  updateProduct(@Param() params: IdParamDto, @Body() dto: UpdateProductDto): Promise<AdminProductDetail> {
    return this.service.updateProduct(params.id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param() params: IdParamDto): Promise<void> {
    return this.service.deleteProduct(params.id);
  }

  @Patch('products/:id/status')
  setStatus(@Param() params: IdParamDto, @Body() dto: ProductStatusDto): Promise<AdminProductDetail> {
    return this.service.setProductStatus(params.id, dto);
  }

  @Patch('products/:id/stock')
  setStock(@Param() params: IdParamDto, @Body() dto: ProductStockDto): Promise<AdminProductDetail> {
    return this.service.setProductStock(params.id, dto);
  }

  @Patch('products/:id/pair')
  setPair(@Param() params: IdParamDto, @Body() dto: ProductPairDto): Promise<AdminProductDetail> {
    return this.service.setProductPair(params.id, dto);
  }

  // ── Partiler ────────────────────────────────────────────────────────────────

  @Post('products/:id/lots')
  createLot(@Param() params: IdParamDto, @Body() dto: CreateLotDto): Promise<AdminProductLot> {
    return this.service.createLot(params.id, dto);
  }

  @Patch('products/:id/lots/:lotId')
  updateLot(@Param() params: LotParamsDto, @Body() dto: UpdateLotDto): Promise<AdminProductLot> {
    return this.service.updateLot(params.id, params.lotId, dto);
  }

  @Delete('products/:id/lots/:lotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLot(@Param() params: LotParamsDto): Promise<void> {
    return this.service.deleteLot(params.id, params.lotId);
  }

  // ── Görseller ───────────────────────────────────────────────────────────────

  @Post('products/:id/images')
  addImage(@Param() params: IdParamDto, @Body() dto: CreateProductImageDto): Promise<AdminProductImage> {
    return this.service.addImage(params.id, dto);
  }

  @Post('products/:id/images/reorder')
  @HttpCode(HttpStatus.OK)
  reorderImages(@Param() params: IdParamDto, @Body() dto: ReorderDto): Promise<{ updated: number }> {
    return this.service.reorderImages(params.id, dto.ids);
  }

  @Patch('products/:id/images/:imageId')
  updateImage(@Param() params: ImageParamsDto, @Body() dto: UpdateProductImageDto): Promise<AdminProductImage> {
    return this.service.updateImage(params.id, params.imageId, dto);
  }

  @Delete('products/:id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(@Param() params: ImageParamsDto): Promise<void> {
    return this.service.deleteImage(params.id, params.imageId);
  }

  // ── Kategoriler ─────────────────────────────────────────────────────────────

  @Get('categories')
  listCategories(): Promise<AdminCategory[]> {
    return this.service.listCategories();
  }

  @Post('categories/reorder')
  @HttpCode(HttpStatus.OK)
  reorderCategories(@Body() dto: ReorderDto): Promise<{ updated: number }> {
    return this.service.reorderCategories(dto.ids);
  }

  @Put('categories/:id')
  updateCategory(@Param() params: IdParamDto, @Body() dto: UpdateCategoryDto): Promise<AdminCategory> {
    return this.service.updateCategory(params.id, dto);
  }

  // ── Üreticiler ──────────────────────────────────────────────────────────────

  @Get('producers')
  listProducers(): Promise<AdminProducer[]> {
    return this.service.listProducers();
  }

  @Get('producers/:id')
  getProducer(@Param() params: IdParamDto): Promise<AdminProducer> {
    return this.service.getProducer(params.id);
  }

  @Post('producers')
  createProducer(@Body() dto: CreateProducerDto): Promise<AdminProducer> {
    return this.service.createProducer(dto);
  }

  @Put('producers/:id')
  updateProducer(@Param() params: IdParamDto, @Body() dto: UpdateProducerDto): Promise<AdminProducer> {
    return this.service.updateProducer(params.id, dto);
  }

  /** Producer'da deletedAt yok → isActive=false (ürün bağları korunur). */
  @Delete('producers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateProducer(@Param() params: IdParamDto): Promise<void> {
    return this.service.deactivateProducer(params.id);
  }

  // ── Tier'lar ────────────────────────────────────────────────────────────────

  @Get('tiers')
  listTiers(): Promise<AdminBoxTier[]> {
    return this.service.listTiers();
  }

  @Put('tiers/:id')
  updateTier(@Param() params: IdParamDto, @Body() dto: UpdateTierDto): Promise<AdminBoxTier> {
    return this.service.updateTier(params.id, dto);
  }

  // ── Haftanın kutusu ─────────────────────────────────────────────────────────

  @Get('box-templates')
  listTemplates(@Query() query: BoxTemplateQueryDto): Promise<AdminBoxTemplate[]> {
    return this.service.listTemplates(query);
  }

  @Get('box-templates/:id')
  getTemplate(@Param() params: IdParamDto): Promise<AdminBoxTemplate> {
    return this.service.getTemplate(params.id);
  }

  @Post('box-templates')
  createTemplate(@Body() dto: CreateBoxTemplateDto): Promise<AdminBoxTemplate> {
    return this.service.createTemplate(dto);
  }

  @Put('box-templates/:id')
  updateTemplate(@Param() params: IdParamDto, @Body() dto: UpdateBoxTemplateDto): Promise<AdminBoxTemplate> {
    return this.service.updateTemplate(params.id, dto);
  }

  @Delete('box-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param() params: IdParamDto): Promise<void> {
    return this.service.deleteTemplate(params.id);
  }

  @Post('box-templates/:id/publish')
  @HttpCode(HttpStatus.OK)
  publishTemplate(@Param() params: IdParamDto): Promise<AdminBoxTemplate> {
    return this.service.publishTemplate(params.id);
  }

  @Post('box-templates/:id/clone-next-week')
  cloneNextWeek(@Param() params: IdParamDto): Promise<AdminBoxTemplate> {
    return this.service.cloneNextWeek(params.id);
  }

  @Get('box-week')
  getBoxWeek(@Query() query: BoxWeekQueryDto): Promise<AdminBoxWeek> {
    return this.service.getBoxWeek(query.week);
  }
}
