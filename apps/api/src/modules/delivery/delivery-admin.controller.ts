import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { DeliveryDateAdmin, DeliveryDatesGenerateResult, DeliveryZone } from '@bagdam/shared';
import { Audited } from '../../common/decorators/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { DeliveryService } from './delivery.service';
import { DeliveryDatePatchDto } from './dto/date-patch.dto';
import { AdminDeliveryDatesQueryDto } from './dto/dates-query.dto';
import { GenerateDeliveryDatesDto } from './dto/generate.dto';
import { CreateDeliveryZoneDto, DeliveryZoneActiveDto, UpdateDeliveryZoneDto } from './dto/zone.dto';

/**
 * DeliveryAdminController — `/api/v1/admin/delivery/*` (BACKEND-PLANI §3 delivery admin satırı, §4 ekran 14a/14b).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('delivery')`. Bölge silme yok (Address/DeliveryDate FK) → isActive.
 * Tarih düzenleme (kapasite/kapat) 14b F9 ekranıdır; uç burada hazır, 14a önizleme salt-okunur kullanır.
 */
@Controller('admin/delivery')
@Roles('ADMIN', 'STAFF')
@Audited('delivery')
export class DeliveryAdminController {
  constructor(private readonly delivery: DeliveryService) {}

  // ── Bölgeler ────────────────────────────────────────────────────────────────

  @Get('zones')
  listZones(): Promise<DeliveryZone[]> {
    return this.delivery.listZones();
  }

  @Get('zones/:id')
  getZone(@Param() params: IdParamDto): Promise<DeliveryZone> {
    return this.delivery.getZone(params.id);
  }

  @Post('zones')
  createZone(@Body() dto: CreateDeliveryZoneDto): Promise<DeliveryZone> {
    return this.delivery.createZone(dto);
  }

  @Put('zones/:id')
  updateZone(@Param() params: IdParamDto, @Body() dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    return this.delivery.updateZone(params.id, dto);
  }

  @Patch('zones/:id/active')
  setZoneActive(@Param() params: IdParamDto, @Body() dto: DeliveryZoneActiveDto): Promise<DeliveryZone> {
    return this.delivery.setZoneActive(params.id, dto.isActive);
  }

  // ── Tarihler ────────────────────────────────────────────────────────────────

  @Get('dates')
  listDates(@Query() query: AdminDeliveryDatesQueryDto): Promise<DeliveryDateAdmin[]> {
    return this.delivery.listDates(query);
  }

  /** Not: 'dates/generate' statik rota (POST) — 'dates/:id' PATCH ile metot farklı; yine de önce tanımlı. */
  @Post('dates/generate')
  @HttpCode(HttpStatus.OK)
  generateDates(@Body() dto: GenerateDeliveryDatesDto): Promise<DeliveryDatesGenerateResult> {
    return this.delivery.generateDates(dto.weeks);
  }

  @Patch('dates/:id')
  patchDate(@Param() params: IdParamDto, @Body() dto: DeliveryDatePatchDto): Promise<DeliveryDateAdmin> {
    return this.delivery.patchDate(params.id, dto);
  }
}
