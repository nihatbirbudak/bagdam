import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotImplementedException, Param, Post, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MeAddress, MeConsent, MeOrderListResponse, Order, PaymentMethod } from '@bagdam/shared';
import type { Response } from 'express';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { OrderNoParamDto } from '../orders/dto/order-no-param.dto';
import { UpsertAddressDto } from './dto/address.dto';
import { MeConsentDto } from './dto/consent.dto';
import { MeService } from './me.service';

/**
 * MeController — önek /api/v1/me (BACKEND-PLANI §3 me satırı; CUSTOMER/STAFF/ADMIN oturumlu — JwtAuthGuard zorunlu,
 * @Roles yok). Mutasyonlar CSRF'li (çerezli istek) ve audit'li (`@Audited('me')`: ad/telefon/adres interceptor'da redakte).
 *  GET/PUT /me/address · GET /me/orders · GET /me/orders/:orderNo (F7/B2: OrdersService) · GET/POST /me/consents
 *  F8: GET /me/cards (PaymentMethod) · DELETE /me/cards/:id (isActive=false) · POST /me/cards/add-session → 501 (PayTR: kart ilk ödemede saklanır)
 */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** Adres yoksa gövde JSON `null` (Nest null dönüşü boş gövde verirdi; cart.js JSON.parse bekler). */
  @Get('address')
  async getAddress(@CurrentUser('id') userId: string, @Res() res: Response): Promise<void> {
    const address: MeAddress | null = await this.me.getAddress(userId);
    res.status(HttpStatus.OK).json(address);
  }

  /** Upsert (tek adres MVP; isDefault true) → 200 MeAddress; bölge geçersiz → 400 ZONE_INVALID. */
  @Put('address')
  @Audited('me')
  async putAddress(@CurrentUser('id') userId: string, @Body() dto: UpsertAddressDto, @Req() req: AuthenticatedRequest): Promise<MeAddress> {
    const address = await this.me.upsertAddress(userId, dto);
    setAuditValues(req, { entityId: address.id, label: 'adres', newValues: { zoneId: address.zoneId, zoneSlug: address.zoneSlug } });
    return address;
  }

  @Get('orders')
  listOrders(@CurrentUser('id') userId: string): Promise<MeOrderListResponse> {
    return this.me.listOrders(userId);
  }

  /** Sipariş detayı (satırlar dahil; ödemeler müşteriye dönmez) — başkasının siparişi 404. */
  @Get('orders/:orderNo')
  getOrder(@CurrentUser('id') userId: string, @Param() params: OrderNoParamDto): Promise<Order> {
    return this.me.getOrder(userId, params.orderNo);
  }

  /** Saklı kartlar (yalnız PSP token özeti: last4/brand; kart verisi bizde yok — ADR-0010). */
  @Get('cards')
  listCards(@CurrentUser('id') userId: string): Promise<PaymentMethod[]> {
    return this.me.listCards(userId);
  }

  /** Kartı pasifleştir (isActive=false; abonelik MIT ise ChargeStrategyResolver PAYMENT_LINK'e düşer). Sahip değilse 404. */
  @Delete('cards/:id')
  @Audited('me')
  async deleteCard(@CurrentUser('id') userId: string, @Param() params: IdParamDto, @Req() req: AuthenticatedRequest): Promise<PaymentMethod> {
    const card = await this.me.deleteCard(userId, params.id);
    setAuditValues(req, { entityId: card.id, label: `kart ****${card.last4}`, newValues: { isActive: false } });
    return card;
  }

  /** PayTR'de ayrı kart ekleme oturumu yok: kart ilk ödemede (checkout iFrame, store_card) saklanır → 501 (F9/P2 notu). */
  @Post('cards/add-session')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  addCardSession(): never {
    throw new NotImplementedException({ message: 'Kart ilk ödemede saklanır', error: 'NOT_IMPLEMENTED' });
  }

  @Get('consents')
  listConsents(@CurrentUser('id') userId: string): Promise<MeConsent[]> {
    return this.me.listConsents(userId);
  }

  /** Pazarlama izni değişikliği → 201 {kind, granted, createdAt}; iysStatus PENDING. */
  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Audited('me')
  setConsent(@CurrentUser('id') userId: string, @Body() dto: MeConsentDto, @Req() req: AuthenticatedRequest): Promise<MeConsent> {
    const rawUa = req.headers['user-agent'];
    setAuditValues(req, { entityId: userId, label: dto.kind, newValues: { kind: dto.kind, granted: dto.granted } });
    return this.me.setConsent(userId, dto, {
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: Array.isArray(rawUa) ? (rawUa[0] ?? null) : (rawUa ?? null),
    });
  }
}
