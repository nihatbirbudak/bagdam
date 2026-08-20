import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Coupon, CouponDetail, CouponList } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import type { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { CouponActivePatchDto, CouponQueryDto, CouponUpsertDto } from './dto/coupon.dto';
import { CouponsService } from './coupons.service';

/**
 * CouponsAdminController — `/api/v1/admin/coupons` (F8 ekran "Kuponlar"):
 *  GET /admin/coupons?q&active&page&limit · GET /admin/coupons/:id (+ kullanımlar) · POST · PUT /:id · DELETE /:id (soft) · PATCH /:id/active
 * Okuma ADMIN/STAFF; mutasyonlar yalnız ADMIN (para etkisi). `@Audited('coupons')` → CREATE/UPDATE/DELETE satırları.
 */
@Controller('admin/coupons')
@Roles('ADMIN', 'STAFF')
@Audited('coupons')
export class CouponsAdminController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list(@Query() query: CouponQueryDto): Promise<CouponList> {
    return this.coupons.list(query);
  }

  @Get(':id')
  get(@Param() params: IdParamDto): Promise<CouponDetail> {
    return this.coupons.getDetail(params.id);
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() dto: CouponUpsertDto, @Req() req: AuthenticatedRequest): Promise<Coupon> {
    const coupon = await this.coupons.create(dto);
    setAuditValues(req, { entityId: coupon.id, label: coupon.code, newValues: { code: coupon.code, kind: coupon.kind, value: coupon.value, appliesTo: coupon.appliesTo } });
    return coupon;
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param() params: IdParamDto, @Body() dto: CouponUpsertDto, @Req() req: AuthenticatedRequest): Promise<Coupon> {
    const coupon = await this.coupons.update(params.id, dto);
    setAuditValues(req, { entityId: coupon.id, label: coupon.code, newValues: { code: coupon.code, kind: coupon.kind, value: coupon.value, appliesTo: coupon.appliesTo, isActive: coupon.isActive } });
    return coupon;
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async remove(@Param() params: IdParamDto, @Req() req: AuthenticatedRequest): Promise<Coupon> {
    const coupon = await this.coupons.softDelete(params.id);
    setAuditValues(req, { entityId: coupon.id, label: coupon.code, newValues: { deleted: true } });
    return coupon;
  }

  @Patch(':id/active')
  @Roles('ADMIN')
  async setActive(@Param() params: IdParamDto, @Body() dto: CouponActivePatchDto, @Req() req: AuthenticatedRequest): Promise<Coupon> {
    const coupon = await this.coupons.setActive(params.id, dto.isActive);
    setAuditValues(req, { entityId: coupon.id, label: coupon.code, newValues: { isActive: coupon.isActive } });
    return coupon;
  }
}
