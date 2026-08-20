import { Controller, Get, Query } from '@nestjs/common';
import type { PackingListEntry, PickListRow } from '@bagdam/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OpsDateQueryDto } from '../dto/admin-subscription.dto';
import { CyclesService } from '../services/cycles.service';

/**
 * OpsAdminController — `/api/v1/admin/ops/*` (ekran 21 Teslimat Günü; F9 UI): pick/packing listeleri (JSON).
 * Yalnız CHARGED/PREPARING/OUT_FOR_DELIVERY cycle'lar (ödemesi alınmış) listeye girer.
 */
@Controller('admin/ops')
@Roles('ADMIN', 'STAFF')
export class OpsAdminController {
  constructor(private readonly cycles: CyclesService) {}

  @Get('pick-list')
  pickList(@Query() query: OpsDateQueryDto): Promise<PickListRow[]> {
    return this.cycles.pickList(query.date, query.zone);
  }

  @Get('packing-list')
  packingList(@Query() query: OpsDateQueryDto): Promise<PackingListEntry[]> {
    return this.cycles.packingList(query.date, query.zone);
  }
}
