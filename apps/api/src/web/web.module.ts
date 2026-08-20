import { Module } from '@nestjs/common';
import { WebController } from './web.controller';

/**
 * Web katmanı — .hbs sayfalarını aynı servislerle render eder (ADR-0002 §5).
 * F3'te CatalogModule import edilip bootstrap verisi şablona gömülür.
 */
@Module({
  controllers: [WebController],
})
export class WebModule {}
