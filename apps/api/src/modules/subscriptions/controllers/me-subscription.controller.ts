import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from '@nestjs/common';
import type { BootstrapSub, CancelResponse } from '@bagdam/shared';
import type { Response } from 'express';
import { Audited, setAuditValues } from '../../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CancelRequestDto, CurrentCyclePatchDto, MergeCartDto, SubscriptionPatchDto } from '../dto/me-subscription.dto';
import { CancellationService, type CancelConfirmResponse } from '../services/cancellation.service';
import { SubscriptionsService } from '../services/subscriptions.service';

/**
 * MeSubscriptionController — `/api/v1/me/subscription*` (BACKEND-PLANI §3 subscriptions satırı; oturumlu müşteri,
 * JwtAuthGuard zorunlu, @Roles yok). Mutasyonlar CSRF'li + `@Audited('subscriptions')`.
 *  GET            → BootstrapSub | null (cart.js getSub() şekli + sunucu durum alanları)
 *  PATCH          → freq / deliveryDay / addressId / paymentMethodId
 *  PATCH cycles/current · POST cycles/current/merge-cart · POST/DELETE cycles/current/skip
 *  POST cancel {reason,note} → {cancellationId, offer} · POST retention/accept · POST cancel/confirm · POST cancel/abandon
 */
@Controller('me/subscription')
@Audited('subscriptions')
export class MeSubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly cancellation: CancellationService,
  ) {}

  /** Abonelik yoksa gövde JSON `null` (cart.js JSON.parse bekler). */
  @Get()
  async get(@CurrentUser('id') userId: string, @Res() res: Response): Promise<void> {
    const sub: BootstrapSub | null = await this.subscriptions.getForUser(userId);
    res.status(HttpStatus.OK).setHeader('Cache-Control', 'private, no-store');
    res.json(sub);
  }

  @Patch()
  async patch(@CurrentUser('id') userId: string, @Body() dto: SubscriptionPatchDto, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.subscriptions.patchForUser(userId, dto);
    setAuditValues(req, { entityId: sub.id, label: 'abonelik', newValues: { freq: dto.freq, deliveryDay: dto.deliveryDay, addressId: dto.addressId, paymentMethodId: dto.paymentMethodId } });
    return sub;
  }

  @Patch('cycles/current')
  async patchCurrentCycle(@CurrentUser('id') userId: string, @Body() dto: CurrentCyclePatchDto, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.subscriptions.patchCurrentCycle(userId, dto);
    setAuditValues(req, { entityId: sub.currentCycle?.id ?? sub.id, label: 'kutu içeriği' });
    return sub;
  }

  @Post('cycles/current/merge-cart')
  @HttpCode(HttpStatus.OK)
  async mergeCart(@CurrentUser('id') userId: string, @Body() dto: MergeCartDto, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.subscriptions.mergeCart(userId, dto);
    setAuditValues(req, { entityId: sub.currentCycle?.id ?? sub.id, label: 'sepet → kutu' });
    return sub;
  }

  @Post('cycles/current/skip')
  @HttpCode(HttpStatus.OK)
  async skip(@CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.subscriptions.skip(userId);
    setAuditValues(req, { entityId: sub.currentCycle?.id ?? sub.id, label: 'hafta atlandı' });
    return sub;
  }

  @Delete('cycles/current/skip')
  @HttpCode(HttpStatus.OK)
  async unskip(@CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.subscriptions.unskip(userId);
    setAuditValues(req, { entityId: sub.currentCycle?.id ?? sub.id, label: 'atlama geri alındı' });
    return sub;
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser('id') userId: string, @Body() dto: CancelRequestDto, @Req() req: AuthenticatedRequest): Promise<CancelResponse> {
    const result = await this.cancellation.request(userId, dto);
    setAuditValues(req, { entityId: result.cancellationId, label: 'iptal talebi', newValues: { reason: dto.reason, offer: result.offer } });
    return result;
  }

  @Post('retention/accept')
  @HttpCode(HttpStatus.OK)
  async acceptRetention(@CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.cancellation.accept(userId);
    setAuditValues(req, { entityId: sub.id, label: 'kalma teklifi kabul' });
    return sub;
  }

  @Post('cancel/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmCancel(@CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest): Promise<CancelConfirmResponse> {
    const result = await this.cancellation.confirm(userId);
    setAuditValues(req, { entityId: result.cancellation.subscriptionId, label: 'iptal onayı', newValues: { effectiveAt: result.cancellation.effectiveAt, refundAmount: result.cancellation.refundAmount } });
    return result;
  }

  @Post('cancel/abandon')
  @HttpCode(HttpStatus.OK)
  async abandonCancel(@CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest): Promise<BootstrapSub> {
    const sub = await this.cancellation.abandon(userId);
    setAuditValues(req, { entityId: sub.id, label: 'iptalden vazgeçildi' });
    return sub;
  }
}
