import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CouponsModule } from '../coupons/coupons.module';
import { SettingsModule } from '../settings/settings.module';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

/**
 * PricingModule (F7) — `PricingService.quote` / `cycleCharge`: shared `computeQuote`/`computeCycleCharge` + Setting `commerce.*`
 * (ADR-0018 kuralları, KDV, ilk-kutu) + DeliveryZone kargo/eşik + kullanıcı bağlamı (canlı abonelik, ilk-kutu hakkı, retention).
 * Controller yok: `POST /checkout/quote` (F8 CheckoutModule) bu servisi çağırır; abonelik motoru (`cycles:lock-and-charge`) `cycleCharge`'ı.
 * F8: kupon (`couponCode`) CouponsModule.CouponsService.validate ile doğrulanır, `pricing.coupon.ts#applyCouponToQuote` ile uygulanır.
 * CacheModule @Global (AppModule) → SettingsService cache'i; testlerde `CacheModule.register` gerekir.
 */
@Module({
  imports: [PrismaModule, SettingsModule, CouponsModule],
  providers: [PricingRepository, PricingService],
  exports: [PricingService],
})
export class PricingModule {}
