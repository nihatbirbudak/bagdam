import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

/**
 * PricingModule (F7) — `PricingService.quote` / `cycleCharge`: shared `computeQuote`/`computeCycleCharge` + Setting `commerce.*`
 * (ADR-0018 kuralları, KDV, ilk-kutu) + DeliveryZone kargo/eşik + kullanıcı bağlamı (canlı abonelik, ilk-kutu hakkı, retention).
 * Controller yok: `POST /checkout/quote` F8'de CheckoutModule bu servisi çağırır; abonelik motoru (`cycles:lock-and-charge`) `cycleCharge`'ı.
 * CacheModule @Global (AppModule) → SettingsService cache'i; testlerde `CacheModule.register` gerekir.
 */
@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [PricingRepository, PricingService],
  exports: [PricingService],
})
export class PricingModule {}
