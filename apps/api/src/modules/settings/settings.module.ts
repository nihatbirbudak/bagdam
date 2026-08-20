import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

/**
 * SettingsModule (F5) — Setting tablosu: registry şemalı grup formu (admin 14a/15), sırlar AES-256-GCM şifreli
 * (common/crypto.util, SETTINGS_ENCRYPTION_KEY). `SettingsService` dışa açılır: DeliveryModule (deliveryDays/cutoff/ufuk),
 * WebController (seo/site), F6 MailModule (mail.*), F8 ödeme (payment.*). CacheModule @Global (AppModule) → CACHE_MANAGER
 * burada import edilmez; testlerde CacheModule.register gerekir. AppModule import'unu E ekler.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SettingsAdminController],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
