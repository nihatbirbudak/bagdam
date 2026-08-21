import { Module } from '@nestjs/common';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { ContentModule } from '../modules/content/content.module';
import { DeliveryModule } from '../modules/delivery/delivery.module';
import { SettingsModule } from '../modules/settings/settings.module';
import { SubscriptionsModule } from '../modules/subscriptions/subscriptions.module';
import { ContentSourceAdapter, WEB_CONTENT_SOURCE } from './web-content.source';
import { WebController } from './web.controller';

/**
 * Web katmanı — .hbs sayfalarını aynı servislerle render eder (ADR-0002 §5).
 * F3: CatalogModule → CatalogService.getBootstrap ile `{{> bootstrap}}` verisi (me/sub null) şablona gömülür.
 * F5: WEB_CONTENT_SOURCE → ContentSourceAdapter (ContentService: site/legal/posts · CatalogService: kategori sekmeleri);
 *     Prisma'ya doğrudan erişim yok; içerik cache'leri admin yazımında düşer (write-invalidate).
 * F8: DeliveryModule → DeliveryService.listPublicZones (sepet.hbs `__BAGDAM_CHECKOUT__`: onay belgeleri + bölgeler).
 * F10: SettingsModule → SettingsService.getCookies (çerez banner'ı partial'ı: kapalı kategori basılmaz).
 * F9: SubscriptionsModule → SubscriptionsService.getForUser (`__BAGDAM__.sub`: oturumlu üyenin satın alınmış abonelik
 *     DTO'su; `GET /me/subscription` ile aynı şekil). SubscriptionsModule web katmanına bağımlı DEĞİLDİR (döngü yok).
 */
@Module({
  imports: [CatalogModule, ContentModule, DeliveryModule, SubscriptionsModule, SettingsModule],
  controllers: [WebController],
  providers: [ContentSourceAdapter, { provide: WEB_CONTENT_SOURCE, useExisting: ContentSourceAdapter }],
})
export class WebModule {}
