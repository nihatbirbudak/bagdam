import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AdminCreateSubscriptionResult, AdminCycleListItem, Subscription, SubscriptionCycle, SubscriptionList } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { IdParamDto } from '../../catalog/dto/admin/id-param.dto';
import { AdminCreateSubscriptionDto, AdminCyclesQueryDto, AdminSubscriptionPatchDto, AdminSubscriptionsQueryDto, CycleCompensateDto, CycleStatusPatchDto } from '../dto/admin-subscription.dto';
import { CyclesService } from '../services/cycles.service';
import { ManualCheckoutService } from '../services/manual-checkout.service';
import { SubscriptionsService } from '../services/subscriptions.service';
import { ACTOR } from '../subscriptions.constants';

/**
 * SubscriptionsAdminController — `/api/v1/admin/subscriptions*` + `/api/v1/admin/cycles*` (BACKEND-PLANI §3, §4 ekran 20–21).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('subscriptions')`. `POST /admin/subscriptions` (yalnız ADMIN): manuel checkout —
 * ofis/havale siparişi (ManualCheckoutService: quote → Order PAID (MANUAL) → Subscription ACTIVE + cycle#1); F8 öncesi tek açılış yolu.
 */
@Controller('admin')
@Roles('ADMIN', 'STAFF')
@Audited('subscriptions')
export class SubscriptionsAdminController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly cycles: CyclesService,
    private readonly manualCheckout: ManualCheckoutService,
  ) {}

  // ── Abonelikler ─────────────────────────────────────────────────────────────

  /** Manuel checkout (ofis/havale/nakit) — müşteri adına abonelik ya da tek seferlik kutu; yalnız ADMIN. */
  @Post('subscriptions')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: AdminCreateSubscriptionDto, @CurrentUser('id') adminId: string | undefined, @Req() req: AuthenticatedRequest): Promise<AdminCreateSubscriptionResult> {
    const result = await this.manualCheckout.createForCustomer(dto, { adminId: adminId ?? null, now: new Date() });
    setAuditValues(req, { entityId: result.subscription.id, label: result.subscription.userEmail ?? dto.userId, newValues: { ...dto, orderNo: result.order.orderNo, grandTotal: result.order.grandTotal } });
    return result;
  }

  @Get('subscriptions')
  list(@Query() query: AdminSubscriptionsQueryDto): Promise<SubscriptionList> {
    return this.subscriptions.adminList(query);
  }

  @Get('subscriptions/:id')
  get(@Param() params: IdParamDto): Promise<Subscription> {
    return this.subscriptions.getDetail(params.id);
  }

  @Patch('subscriptions/:id')
  async patch(@Param() params: IdParamDto, @Body() dto: AdminSubscriptionPatchDto, @CurrentUser('role') role: string | undefined, @Req() req: AuthenticatedRequest): Promise<Subscription> {
    const result = await this.subscriptions.adminPatch(params.id, dto, role === 'STAFF' ? ACTOR.OPS : ACTOR.ADMIN);
    setAuditValues(req, { entityId: params.id, label: result.userEmail, newValues: { ...dto } });
    return result;
  }

  // ── Cycle'lar ───────────────────────────────────────────────────────────────

  @Get('cycles')
  listCycles(@Query() query: AdminCyclesQueryDto): Promise<AdminCycleListItem[]> {
    return this.cycles.listForDate(query.date, { status: query.status, zoneSlug: query.zone });
  }

  @Patch('cycles/:id/status')
  async setCycleStatus(@Param() params: IdParamDto, @Body() dto: CycleStatusPatchDto, @CurrentUser('role') role: string | undefined, @Req() req: AuthenticatedRequest): Promise<SubscriptionCycle> {
    const cycle = await this.cycles.adminSetStatus(params.id, dto.status, { note: dto.note, actor: role === 'STAFF' ? ACTOR.OPS : ACTOR.ADMIN }, new Date());
    setAuditValues(req, { entityId: params.id, label: `cycle#${cycle.cycleNo}`, newValues: { status: dto.status, note: dto.note } });
    return cycle;
  }

  @Post('cycles/:id/charge')
  @HttpCode(HttpStatus.OK)
  async charge(@Param() params: IdParamDto, @Req() req: AuthenticatedRequest): Promise<SubscriptionCycle> {
    const cycle = await this.cycles.adminCharge(params.id, ACTOR.ADMIN, new Date());
    setAuditValues(req, { entityId: params.id, label: `cycle#${cycle.cycleNo}`, newValues: { status: cycle.status } });
    return cycle;
  }

  @Post('cycles/:id/send-payment-link')
  @HttpCode(HttpStatus.OK)
  async sendPaymentLink(@Param() params: IdParamDto, @Req() req: AuthenticatedRequest): Promise<{ cycle: SubscriptionCycle; linkToken: string; linkExpiresAt: string }> {
    const result = await this.cycles.adminSendPaymentLink(params.id, ACTOR.ADMIN, new Date());
    setAuditValues(req, { entityId: params.id, label: `cycle#${result.cycle.cycleNo}`, newValues: { linkExpiresAt: result.linkExpiresAt } });
    return result;
  }

  @Post('cycles/:id/compensate')
  @HttpCode(HttpStatus.OK)
  async compensate(@Param() params: IdParamDto, @Body() dto: CycleCompensateDto, @Req() req: AuthenticatedRequest): Promise<SubscriptionCycle> {
    const cycle = await this.cycles.compensate(params.id, dto, ACTOR.ADMIN, new Date());
    setAuditValues(req, { entityId: params.id, label: 'telafi', newValues: { productId: dto.productId, qty: dto.qty ?? 1, note: dto.note, targetCycleId: cycle.id } });
    return cycle;
  }
}
