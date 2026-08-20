import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AdminCustomerAnonymizeResult, AdminCustomerDetail, AdminCustomerList, AdminCustomerListItem } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { CustomersService } from './customers.service';
import { CustomerPatchDto } from './dto/customer-patch.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';

/**
 * CustomersAdminController — `/api/v1/admin/customers` (BACKEND-PLANI §3 customers satırı, §4 ekran 16).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('customers')` (PATCH → UPDATE, anonymize → ANONYMIZE; e-posta/telefon
 * interceptor'da redakte). Anonimleştirme yalnız ADMIN (KVKK, geri alınamaz).
 */
@Controller('admin/customers')
@Roles('ADMIN', 'STAFF')
@Audited('customers')
export class CustomersAdminController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: CustomerQueryDto): Promise<AdminCustomerList> {
    return this.customers.list(query);
  }

  @Get(':id')
  get(@Param() params: IdParamDto): Promise<AdminCustomerDetail> {
    return this.customers.get(params.id);
  }

  @Patch(':id')
  async patch(
    @Param() params: IdParamDto,
    @Body() dto: CustomerPatchDto,
    @CurrentUser('id') actorId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminCustomerListItem> {
    const result = await this.customers.patch(params.id, dto, actorId);
    setAuditValues(req, { entityId: params.id, label: result.item.name ?? undefined, oldValues: result.oldValues, newValues: result.newValues });
    return result.item;
  }

  /** KVKK anonimleştirme — yalnız ADMIN; 200 {id,email,anonymizedAt}; zaten anonim → 409. */
  @Post(':id/anonymize')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async anonymize(
    @Param() params: IdParamDto,
    @CurrentUser('id') actorId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminCustomerAnonymizeResult> {
    const result = await this.customers.anonymize(params.id, actorId);
    setAuditValues(req, { entityId: params.id, label: 'KVKK anonimleştirme', newValues: { anonymizedAt: result.anonymizedAt } });
    return result;
  }
}
