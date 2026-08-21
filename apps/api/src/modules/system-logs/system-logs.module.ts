import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SystemLogsAdminController } from './system-logs-admin.controller';
import { SystemLogsRepository } from './system-logs.repository';
import { SystemLogsService } from './system-logs.service';

/**
 * SystemLogsModule (F10) — `system_logs` yazma + admin listesi (ekran 22 › Sistem günlüğü).
 * `@Global`: AllExceptionsFilter main.ts'te `app.get(SystemLogsService)` ile erişir ve
 * başka modüller de servis enjekte edebilsin (AuditModule kalıbının aksine tek yönlü bağımlılık).
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SystemLogsAdminController],
  providers: [SystemLogsRepository, SystemLogsService],
  exports: [SystemLogsService],
})
export class SystemLogsModule {}
