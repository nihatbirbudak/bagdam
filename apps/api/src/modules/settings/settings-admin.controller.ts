import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { findSettingGroup, type AdminSettingGroup } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import type { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { REDACTED } from '../../common/interceptors/audit-log.interceptor';
import { SettingsGroupParamDto } from './dto/settings-group-param.dto';
import { SettingsService } from './settings.service';

/**
 * SettingsAdminController — `/api/v1/admin/settings` (BACKEND-PLANI §3 content satırı "GET/PUT /admin/settings/:group",
 * §4 ekran 14a/15). Class-level `@Roles('ADMIN','STAFF')` + `@Audited('settings')`.
 *  - GET  /admin/settings            → tüm gruplar (registry şeması + değer; sırlar maskeli)
 *  - GET  /admin/settings/:group     → tek grup
 *  - PUT  /admin/settings/:group     → {field: value, …} kısmi güncelleme; secret boş/maske → değişmez
 *  - POST /admin/settings/mail/test  → F6: MailModule'deki MailAdminController sunar (MailService.sendTest; DISABLE_MAIL'de
 *    SKIPPED + önizleme) — SettingsModule ↔ MailModule döngüsü olmasın diye rota oraya taşındı (F5'teki 501 kalktı).
 * Gövde şeması dinamik olduğundan DTO sınıfı yok: ValidationPipe düz `Object`i atlar, doğrulama SettingsService'te (registry).
 * Audit: newValues secret alanlar `[redacted]` olarak yazılır (interceptor'ın gövde kopyası yerine).
 */
@Controller('admin/settings')
@Roles('ADMIN', 'STAFF')
@Audited('settings')
export class SettingsAdminController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): Promise<AdminSettingGroup[]> {
    return this.settings.listGroups();
  }

  @Get(':group')
  getGroup(@Param() params: SettingsGroupParamDto): Promise<AdminSettingGroup> {
    return this.settings.getGroup(params.group);
  }

  @Put(':group')
  async updateGroup(
    @Param() params: SettingsGroupParamDto,
    @Body() body: Record<string, unknown>,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminSettingGroup> {
    const result = await this.settings.set(params.group, body);
    const meta = findSettingGroup(params.group);
    // newValues: yazılan normalize değerler; secret alanlar yalnız "[redacted]" (düz/şifreli sır audit'e girmez)
    const newValues: Record<string, unknown> = {};
    for (const field of result.changed) {
      newValues[field] = field in result.values ? result.values[field] : REDACTED;
    }
    setAuditValues(req, { entityId: params.group, label: meta?.label ?? params.group, newValues });
    return result.group;
  }
}
