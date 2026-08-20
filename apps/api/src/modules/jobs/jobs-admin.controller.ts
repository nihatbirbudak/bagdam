import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { JobInfo, JobRunResult } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JobNameParamDto, JobRunBodyDto, JobRunsQueryDto } from './dto/job-name-param.dto';
import { JobsService, resolveJobNow } from './jobs.service';

/**
 * JobsAdminController — `/api/v1/admin/jobs` (ekran 22 Sistem; F10 UI):
 *  GET  /admin/jobs            → kayıtlı job'lar + cron + son koşu
 *  GET  /admin/jobs/runs       → son CronLog satırları (?name&limit)
 *  POST /admin/jobs/:name/run  → elle tetikle (yalnız ADMIN; e2e/test + ops) → JobRunResult; gövde `{now?: ISO}` yalnız
 *                                 geliştirme/test ortamında (ALLOW_JOB_TIME_OVERRIDE) — simülasyon zamanı ileri alır
 */
@Controller('admin/jobs')
@Roles('ADMIN')
@Audited('jobs')
export class JobsAdminController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(): Promise<JobInfo[]> {
    return this.jobs.list();
  }

  @Get('runs')
  runs(@Query() query: JobRunsQueryDto): Promise<JobRunResult[]> {
    return this.jobs.recentRuns(query.name, query.limit ?? 50);
  }

  @Post(':name/run')
  @HttpCode(HttpStatus.OK)
  async run(@Param() params: JobNameParamDto, @Body() body: JobRunBodyDto, @Req() req: AuthenticatedRequest): Promise<JobRunResult> {
    const now = resolveJobNow(body?.now);
    const result = await this.jobs.runOnce(params.name, now);
    setAuditValues(req, { entityId: result.cronLogId ?? params.name, label: params.name, newValues: { status: result.status, itemsProcessed: result.itemsProcessed, errors: result.errors, now: body?.now ?? null } });
    return result;
  }
}
