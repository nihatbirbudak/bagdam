import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService } from './jobs.service';

const TZ = 'Europe/Istanbul';

/**
 * JobsScheduler — @Cron kayıtları (BACKEND-PLANI §3 jobs satırı). ScheduleModule yalnız instance 0 + ENABLE_CRON
 * iken AppModule'de açılır; açılmadığında bu dekoratörler etkisizdir (staging/çoklu instance güvenli).
 * Her tetik `JobsService.runOnce(name, new Date())` → CronLog. Cron ifadeleri JobsService kayıt defteriyle aynı.
 */
@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(private readonly jobs: JobsService) {}

  @Cron('30 0 * * *', { name: 'delivery-dates:generate', timeZone: TZ })
  deliveryDatesGenerate(): Promise<void> {
    return this.fire('delivery-dates:generate');
  }

  @Cron('0 * * * *', { name: 'cycles:ensure', timeZone: TZ })
  cyclesEnsure(): Promise<void> {
    return this.fire('cycles:ensure');
  }

  @Cron('*/5 * * * *', { name: 'cycles:lock-and-charge', timeZone: TZ })
  cyclesLockAndCharge(): Promise<void> {
    return this.fire('cycles:lock-and-charge');
  }

  @Cron('*/10 * * * *', { name: 'cycles:expire-payment-links', timeZone: TZ })
  cyclesExpirePaymentLinks(): Promise<void> {
    return this.fire('cycles:expire-payment-links');
  }

  @Cron('*/15 * * * *', { name: 'payments:retry', timeZone: TZ })
  paymentsRetry(): Promise<void> {
    return this.fire('payments:retry');
  }

  @Cron('0 * * * *', { name: 'reminders:cutoff', timeZone: TZ })
  remindersCutoff(): Promise<void> {
    return this.fire('reminders:cutoff');
  }

  private async fire(name: string): Promise<void> {
    try {
      await this.jobs.runOnce(name, new Date());
    } catch (err) {
      this.logger.error(`${name} tetiklenemedi: ${(err as Error).message}`);
    }
  }
}
