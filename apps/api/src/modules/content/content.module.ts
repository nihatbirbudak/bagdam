import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { ContentAdminController } from './content-admin.controller';
import { ContentAdminService } from './content-admin.service';
import { ContentController } from './content.controller';
import { ContentRepository } from './content.repository';
import { ContentService } from './content.service';
import { SitemapController } from './sitemap.controller';

/**
 * ContentModule (F5) — SiteContent (şemalı bloklar) · Post (günlük) · LegalDocument (sürümlü yasal metinler) · Consent
 * · sitemap/robots (ADR-0002 dilimi: dto · controller (+admin) · service (+admin) · repository · mapper).
 * `ContentService` dışa açılır: WebModule `site`/`legal`/`posts` şablon verisi için kullanır (C).
 * CacheModule @Global (AppModule) → CACHE_MANAGER burada ayrıca import edilmez; testlerde CacheModule.register gerekir.
 * `sitemap.xml`/`robots.txt` global prefix dışında kalmalı: SITEMAP_ROUTES_EXCLUDED_FROM_PREFIX (main.ts exclude).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ContentController, ContentAdminController, SitemapController],
  providers: [ContentRepository, ContentService, ContentAdminService],
  exports: [ContentService],
})
export class ContentModule {}
