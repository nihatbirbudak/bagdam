import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MailLogList, MailTestResult } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import type { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MailLogQueryDto } from './dto/mail-log-query.dto';
import { MailTestDto } from './dto/mail-test.dto';
import { MailService } from './mail.service';

/**
 * MailAdminController — `/api/v1/admin/mail-logs` (Sistem › E-posta günlüğü) + `POST /api/v1/admin/settings/mail/test`
 * (Ayarlar › E-posta "test gönder"; F5'teki 501 yerine — rota SettingsAdminController'dan buraya taşındı ki
 * SettingsModule ↔ MailModule döngüsü oluşmasın). `@Roles('ADMIN','STAFF')`; test gönderimi audit'e düşer.
 */
@Controller('admin')
@Roles('ADMIN', 'STAFF')
export class MailAdminController {
  constructor(private readonly mail: MailService) {}

  /** `GET /admin/mail-logs?page&limit&status&to` → {items,total,page,limit}; önizleme yolu yalnız dev/test. */
  @Get('mail-logs')
  list(@Query() query: MailLogQueryDto): Promise<MailLogList> {
    return this.mail.listLogs(query);
  }

  /** `POST /admin/settings/mail/test {to}` → 200 MailTestResult (DISABLE_MAIL'de SKIPPED + previewPath; SMTP yoksa FAILED + error). */
  @Post('settings/mail/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited('settings')
  async sendTest(@Body() dto: MailTestDto, @Req() req: AuthenticatedRequest): Promise<MailTestResult> {
    const result = await this.mail.sendTest(dto.to);
    setAuditValues(req, { entityId: result.logId || 'mail-test', label: 'E-posta testi', newValues: { status: result.status, templateSlug: 'test' } });
    return result;
  }
}
