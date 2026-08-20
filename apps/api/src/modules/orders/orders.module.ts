import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CouponsModule } from '../coupons/coupons.module';
import { DeliveryDatesService } from '../delivery/delivery-dates.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { MailModule } from '../mail/mail.module';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersController } from './orders.controller';
import { ORDERS_DEPS } from './orders.deps';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * OrdersModule (F7/B2) — Order çekirdeği: `/api/v1/orders/*` (müşteri) + `/api/v1/admin/orders` (ekran 17) + `OrdersService`
 * (F8 checkout `createFromQuote`, abonelik motoru `createForCycle/createDeltaForCycle`, her yerde `transition/cancel`).
 * MeModule bunu import eder (`GET /me/orders[/:orderNo]`); SubscriptionsModule motor adapter'ında kullanır.
 * `ORDERS_DEPS` (DeliveryDate atomik rezerv/iade) = B1 `DeliveryDatesService` (E entegrasyonu; `reserve/release(deliveryDateId, tx?)`
 * imzası yapısal olarak aynı — reserve başarıda güncel satırı döner, çağıran sonucu kullanmaz). Testler `PrismaOrdersDeps`
 * (aynı SQL, OrdersRepository üzerinden) casus sarmalayıcısıyla ezer. Bağımlılık: PrismaModule (@Global) + DeliveryModule (→ SettingsModule)
 * + F8: CouponsModule (PAID → kupon usedCount++, iptal/iade → serbest) + MailModule (Notifier `order.paid`); döngü yok.
 */
@Module({
  imports: [PrismaModule, DeliveryModule, CouponsModule, MailModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersRepository, OrdersService, { provide: ORDERS_DEPS, useExisting: DeliveryDatesService }],
  exports: [OrdersService, OrdersRepository, ORDERS_DEPS],
})
export class OrdersModule {}
