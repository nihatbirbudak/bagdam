import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryDatesService } from './delivery-dates.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';

/**
 * DeliveryModule (F5 + F7) — bölgeler + teslimat tarihleri (ADR-0005; dto · controller · admin.controller · service · repository · mapper).
 *  - `DeliveryService` (F5): public zones/dates, admin bölge CRUD, tarih listesi/kapasite, `generateDates` (idempotent);
 *    CatalogService.buildBootstrap'ın deliveryDates'i ile aynı kaynak/kural.
 *  - `DeliveryDatesService` (F7): `generate` (cron `delivery-dates:generate`) · atomik `reserve/release` · `findOrCreateFor` ·
 *    `nextFor` · `isLocked/isFull` — checkout (F8), `cycles:ensure` / skip-unskip / iptal (abonelik motoru) ve Order yan etkileri bunu kullanır.
 * SettingsModule: deliveryDays/cutoff/ufuk Setting'den. CatalogModule import edilmez (bootstrap cache anahtarı doğrudan
 * düşürülür — döngü yok).
 */
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [DeliveryController, DeliveryAdminController],
  providers: [DeliveryRepository, DeliveryService, DeliveryDatesService],
  exports: [DeliveryService, DeliveryDatesService, DeliveryRepository],
})
export class DeliveryModule {}
