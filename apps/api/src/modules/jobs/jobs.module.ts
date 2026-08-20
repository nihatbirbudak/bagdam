import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { JobsAdminController } from './jobs-admin.controller';
import { JobsRepository } from './jobs.repository';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

/**
 * JobsModule (F7) — cron job'lar (BACKEND-PLANI §3 jobs satırı): kayıt defteri + CronLog + @Cron tetikleyicileri +
 * `POST /admin/jobs/:name/run`. ScheduleModule.forRoot yalnız instance 0 + ENABLE_CRON iken AppModule'de;
 * aksi hâlde JobsScheduler'ın @Cron'ları pasif kalır (runOnce elle/e2e için yine çalışır).
 * Bağımlılık: DeliveryModule (delivery-dates:generate), SubscriptionsModule (cycles:* / payments:retry / reminders:cutoff),
 * F8: CheckoutModule (payments:reconcile → CheckoutCompletionService.reconcile).
 */
@Module({
  imports: [PrismaModule, DeliveryModule, SubscriptionsModule, CheckoutModule],
  controllers: [JobsAdminController],
  providers: [JobsRepository, JobsService, JobsScheduler],
  exports: [JobsService],
})
export class JobsModule {}
