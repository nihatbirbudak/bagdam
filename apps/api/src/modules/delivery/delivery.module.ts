import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryController } from './delivery.controller';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';

/**
 * DeliveryModule (F5) — bölgeler + teslimat tarihleri (ADR-0005; dto · controller · admin.controller · service · repository · mapper).
 * `DeliveryService` dışa açılır: E, CatalogService.buildBootstrap'ın deliveryDates'ini buna bağlar; F7 cron
 * `delivery-dates:generate` → `generateDates()`; F8 checkout atomik rezerv (F7'de eklenir).
 * SettingsModule: deliveryDays/cutoff/ufuk Setting'den. CatalogModule import edilmez (bootstrap cache anahtarı doğrudan
 * düşürülür — döngü yok). AppModule import'unu E ekler.
 */
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [DeliveryController, DeliveryAdminController],
  providers: [DeliveryRepository, DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
