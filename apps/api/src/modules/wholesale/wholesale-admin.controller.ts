import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { WholesaleLead, WholesaleLeadList } from '@bagdam/shared';
import { Audited } from '../../common/decorators/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { WholesaleLeadPatchDto } from './dto/lead-patch.dto';
import { WholesaleLeadQueryDto } from './dto/lead-query.dto';
import { WholesaleService } from './wholesale.service';

/**
 * WholesaleAdminController — `/api/v1/admin/wholesale-leads` (BACKEND-PLANI §3 wholesale admin, §4 ekran 13).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('wholesale')` (PATCH audit'e düşer; e-posta/telefon redakte — interceptor).
 */
@Controller('admin/wholesale-leads')
@Roles('ADMIN', 'STAFF')
@Audited('wholesale')
export class WholesaleAdminController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get()
  list(@Query() query: WholesaleLeadQueryDto): Promise<WholesaleLeadList> {
    return this.wholesale.list(query);
  }

  @Get(':id')
  get(@Param() params: IdParamDto): Promise<WholesaleLead> {
    return this.wholesale.get(params.id);
  }

  @Patch(':id')
  patch(@Param() params: IdParamDto, @Body() dto: WholesaleLeadPatchDto): Promise<WholesaleLead> {
    return this.wholesale.patch(params.id, dto);
  }
}
