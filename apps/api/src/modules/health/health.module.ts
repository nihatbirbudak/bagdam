import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CronLogsModule } from '../cron-logs/cron-logs.module';
import { WebhookEventsModule } from '../webhook-events/webhook-events.module';
import { HealthAdminController } from './health-admin.controller';
import { HealthController } from './health.controller';
import { HealthDetailedService } from './health-detailed.service';
import { HealthRepository } from './health.repository';

/**
 * HealthModule:
 *  - `GET /api/v1/health` (public, monitör) — PrismaService ile `SELECT 1`
 *  - `GET /api/v1/admin/health/detailed` (F10, ekran 22) — DB gecikmesi, zamanlayıcı + job'ların son koşusu,
 *    24 saatlik SystemLog/MailLog/WebhookEvent sayımları, açık ödeme problemleri, uyarı listesi.
 * SystemLogsService @Global modülden gelir.
 */
@Module({
  imports: [PrismaModule, CronLogsModule, WebhookEventsModule],
  controllers: [HealthController, HealthAdminController],
  providers: [HealthRepository, HealthDetailedService],
})
export class HealthModule {}
