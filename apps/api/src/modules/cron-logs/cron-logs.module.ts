import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CronLogsAdminController } from './cron-logs-admin.controller';
import { CronLogsRepository } from './cron-logs.repository';
import { CronLogsService } from './cron-logs.service';

/** CronLogsModule (F10) — `cron_logs` okuma: ekran 22 › Cron günlüğü + sağlık kartı (HealthModule kullanır). */
@Module({
  imports: [PrismaModule],
  controllers: [CronLogsAdminController],
  providers: [CronLogsRepository, CronLogsService],
  exports: [CronLogsService],
})
export class CronLogsModule {}
