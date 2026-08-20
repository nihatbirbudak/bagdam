import { Module } from '@nestjs/common';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { WebController } from './web.controller';

/**
 * Web katmanı — .hbs sayfalarını aynı servislerle render eder (ADR-0002 §5).
 * F3: CatalogModule → CatalogService.getBootstrap ile `{{> bootstrap}}` verisi (me/sub null) şablona gömülür.
 */
@Module({
  imports: [CatalogModule],
  controllers: [WebController],
})
export class WebModule {}
