import { Controller, Get, Query } from '@nestjs/common';
import type { SystemLogList } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemLogQueryDto } from './dto/system-log-query.dto';
import { SystemLogsService } from './system-logs.service';

/**
 * `GET /api/v1/admin/system-logs?page&limit&level&module&requestId&search` — ekran 22 › Sistem günlüğü.
 * Salt okunur; satırlar panelden silinmez (`kvkk:purge` 30 günde temizler).
 */
@Controller('admin/system-logs')
@Roles('ADMIN', 'STAFF')
export class SystemLogsAdminController {
  constructor(private readonly systemLogs: SystemLogsService) {}

  @Get()
  list(@Query() query: SystemLogQueryDto): Promise<SystemLogList> {
    return this.systemLogs.list(query);
  }
}
