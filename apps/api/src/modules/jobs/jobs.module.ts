import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { CustomersModule } from '../customers/customers.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { JobsAdminController } from './jobs-admin.controller';
import { JobsRepository } from './jobs.repository';
import { JobsScheduler } from './jobs.scheduler';
import { KvkkPurgeRepository } from './kvkk-purge.repository';
import { KvkkPurgeService } from './kvkk-purge.service';
import { JobsService } from './jobs.service';

/**
 * JobsModule (F7) — cron job'lar (BACKEND-PLANI §3 jobs satırı): kayıt defteri + CronLog + @Cron tetikleyicileri +
 * `POST /admin/jobs/:name/run`. ScheduleModule.forRoot yalnız instance 0 + ENABLE_CRON iken AppModule'de;
 * aksi hâlde JobsScheduler'ın @Cron'ları pasif kalır (runOnce elle/e2e için yine çalışır).
 * Bağımlılık: DeliveryModule (delivery-dates:generate), SubscriptionsModule (cycles:* / payments:retry / reminders:cutoff),
 * F8: CheckoutModule (payments:reconcile → CheckoutCompletionService.reconcile).
 * F10: SettingsModule (Setting privacy.*) + MailModule (MailLog + önizleme temizliği) + CustomersModule
 *      (pasif hesap anonimleştirme) → `kvkk:purge` (KvkkPurgeService/KvkkPurgeRepository; logs:cleanup bunun içinde).
 */
@Module({
  imports: [PrismaModule, DeliveryModule, SubscriptionsModule, CheckoutModule, SettingsModule, MailModule, CustomersModule],
  controllers: [JobsAdminController],
  providers: [JobsRepository, JobsService, JobsScheduler, KvkkPurgeRepository, KvkkPurgeService],
  exports: [JobsService],
})
export class JobsModule {}
