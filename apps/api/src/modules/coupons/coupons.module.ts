import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CouponsAdminController } from './coupons-admin.controller';
import { CouponsRepository } from './coupons.repository';
import { CouponsService } from './coupons.service';

/**
 * CouponsModule (F8) — Coupon / CouponRedemption: doğrulama (`CouponsService.validate` → PricingService.quote kupon uygulaması),
 * kullanım kaydı (checkout reserve → Order PAID confirm (usedCount++) → iptal/iade release) + admin `/admin/coupons` CRUD.
 * Bağımlılık yalnız PrismaModule (döngü yok: PricingModule ve OrdersModule bunu import eder).
 */
@Module({
  imports: [PrismaModule],
  controllers: [CouponsAdminController],
  providers: [CouponsRepository, CouponsService],
  exports: [CouponsService, CouponsRepository],
})
export class CouponsModule {}
