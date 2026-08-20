import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * CatalogModule (F3) — katalog okumaları + bootstrap (ADR-0002 dilimi: dto · controller · service · repository · mapper).
 * `CatalogService` dışa açılır: WebModule `{{> bootstrap}}` için, F4 admin controller'ı cache düşürmek için kullanır.
 * CacheModule @Global (AppModule) → CACHE_MANAGER burada ayrıca import edilmez; testlerde CacheModule.register gerekir.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
