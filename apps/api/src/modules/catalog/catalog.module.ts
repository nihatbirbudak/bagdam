import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminRepository } from './catalog-admin.repository';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * CatalogModule (F3) — katalog okumaları + bootstrap (ADR-0002 dilimi: dto · controller · service · repository · mapper).
 * `CatalogService` dışa açılır: WebModule `{{> bootstrap}}` için kullanır.
 * F4: CatalogAdminController (/api/v1/admin/*) + CatalogAdminService/Repository — her mutasyon CatalogService.invalidateBootstrapCache().
 * CacheModule @Global (AppModule) → CACHE_MANAGER burada ayrıca import edilmez; testlerde CacheModule.register gerekir.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogRepository, CatalogService, CatalogAdminRepository, CatalogAdminService],
  exports: [CatalogService],
})
export class CatalogModule {}
