import { Controller, Get, Query } from '@nestjs/common';
import type { CronLogList } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CronLogsService } from './cron-logs.service';
import { CronLogQueryDto } from './dto/cron-log-query.dto';

/**
 * `GET /api/v1/admin/cron-logs?page&limit&name&status&search` — ekran 22 › Cron günlüğü.
 * (`GET /admin/jobs/runs` kayıt defterindeki job'ların son koşularını verir; burada sayfalı tam liste.)
 */
@Controller('admin/cron-logs')
@Roles('ADMIN', 'STAFF')
export class CronLogsAdminController {
  constructor(private readonly cronLogs: CronLogsService) {}

  @Get()
  list(@Query() query: CronLogQueryDto): Promise<CronLogList> {
    return this.cronLogs.list(query);
  }
}
