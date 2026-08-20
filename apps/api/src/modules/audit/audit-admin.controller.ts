import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLogListResponse, AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * `GET /api/v1/admin/audit-logs?page&limit&module&action&actorId&entityId&search` — yalnız ADMIN (ADR-0015).
 * Yanıt `{items, total, page, limit}` (admin liste zarfı). Salt okunur; satırlar asla değişmez.
 */
@Controller('admin/audit-logs')
@Roles('ADMIN')
export class AuditAdminController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto): Promise<AuditLogListResponse> {
    return this.audit.list(query);
  }
}
