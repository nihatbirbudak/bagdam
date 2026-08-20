import { Module } from '@nestjs/common';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { ContentModule } from '../modules/content/content.module';
import { ContentSourceAdapter, WEB_CONTENT_SOURCE } from './web-content.source';
import { WebController } from './web.controller';

/**
 * Web katmanı — .hbs sayfalarını aynı servislerle render eder (ADR-0002 §5).
 * F3: CatalogModule → CatalogService.getBootstrap ile `{{> bootstrap}}` verisi (me/sub null) şablona gömülür.
 * F5: WEB_CONTENT_SOURCE → ContentSourceAdapter (ContentService: site/legal/posts · CatalogService: kategori sekmeleri);
 *     Prisma'ya doğrudan erişim yok; içerik cache'leri admin yazımında düşer (write-invalidate).
 */
@Module({
  imports: [CatalogModule, ContentModule],
  controllers: [WebController],
  providers: [ContentSourceAdapter, { provide: WEB_CONTENT_SOURCE, useExisting: ContentSourceAdapter }],
})
export class WebModule {}
