import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuditAdminController } from './audit-admin.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * AuditModule (F4) — AuditLog yazma (AuditService.record ← AuditLogInterceptor, APP_INTERCEPTOR AppModule'de)
 * ve admin listesi (GET /admin/audit-logs). `AuditService` dışa açılır; interceptor AppModule'de kayıtlı
 * olduğundan guard/interceptor sırası tek yerde (app.module.ts) görünür.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditAdminController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
