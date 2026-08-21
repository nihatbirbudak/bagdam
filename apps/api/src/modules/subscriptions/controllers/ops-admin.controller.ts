import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import type { OpsBulkStatusResult, OpsDaySummary, PackingListEntry, PickListRow } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OpsBulkStatusDto, OpsDateQueryDto } from '../dto/admin-subscription.dto';
import { CyclesService } from '../services/cycles.service';
import { OpsService } from '../services/ops.service';
import { ACTOR } from '../subscriptions.constants';

/**
 * OpsAdminController — `/api/v1/admin/ops/*` (ekran 20 "Teslimat Günü", ekran 21 "Özet"; F9 UI):
 *  GET  /admin/ops/pick-list?date=&zone=     → ürün bazında toplama listesi (tercih dağılımı + parti kodu)
 *  GET  /admin/ops/packing-list?date=&zone=  → müşteri bazında paketleme fişi (içerik + tercih + adres + not)
 *  GET  /admin/ops/day-summary?date=&zone=   → günün özeti (durum dağılımı, tier kırılımı, ciro, kapasite/kesim)
 *  POST /admin/ops/bulk-status               → toplu durum ilerletme (PREPARING → OUT_FOR_DELIVERY → DELIVERED /
 *                                              DELIVERY_FAILED yalnız siparişte); hep-ya-hiç, geçersiz → 409
 * Listeler yalnız CHARGED/PREPARING/OUT_FOR_DELIVERY cycle'ları (ödemesi alınmış) kapsar; özet tüm durumları sayar.
 * Sınıf düzeyinde `@Roles('ADMIN','STAFF')`; mutasyon `@Audited('subscriptions')` (CSRF guard zinciri AppModule'de).
 */
@Controller('admin/ops')
@Roles('ADMIN', 'STAFF')
export class OpsAdminController {
  constructor(
    private readonly cycles: CyclesService,
    private readonly ops: OpsService,
  ) {}

  @Get('pick-list')
  pickList(@Query() query: OpsDateQueryDto): Promise<PickListRow[]> {
    return this.cycles.pickList(query.date, query.zone);
  }

  @Get('packing-list')
  packingList(@Query() query: OpsDateQueryDto): Promise<PackingListEntry[]> {
    return this.cycles.packingList(query.date, query.zone);
  }

  @Get('day-summary')
  daySummary(@Query() query: OpsDateQueryDto): Promise<OpsDaySummary> {
    return this.ops.daySummary(query.date, query.zone, new Date());
  }

  @Post('bulk-status')
  @HttpCode(HttpStatus.OK)
  @Audited('subscriptions')
  async bulkStatus(
    @Body() dto: OpsBulkStatusDto,
    @CurrentUser('id') actorId: string | undefined,
    @CurrentUser('role') role: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<OpsBulkStatusResult> {
    const result = await this.ops.bulkStatus(dto, { actor: role === 'STAFF' ? ACTOR.OPS : ACTOR.ADMIN, actorId: actorId ?? null }, new Date());
    setAuditValues(req, {
      label: 'toplu durum ' + dto.status,
      newValues: { status: dto.status, requested: result.requested, updated: result.updated, failed: result.failed, skipped: result.skipped, note: dto.note ?? null },
    });
    return result;
  }
}
