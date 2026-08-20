import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CheckoutQuoteResponse, CheckoutResult } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CheckoutService } from './checkout.service';
import { CheckoutDto, CheckoutQuoteDto } from './dto/checkout.dto';

/**
 * CheckoutController — `/api/v1/checkout` (BACKEND-PLANI §3 checkout satırı; ADR-0003 istisna 1/3):
 *  POST /checkout/quote  (@Public) — fiyat özeti: PricingResult + bölge + kupon durumu + zorunlu onay belgeleri (misafirde kullanıcı bağlamı yok;
 *                         oturum varsa JwtAuthGuard req.user'ı doldurur → ilk-kutu hakkı / abone kargo / kupon perUser). `no-store` (kişisel fiyat).
 *  POST /checkout        (oturumlu; CSRF'li; @Audited) — sipariş + ödeme başlatma → 201 CheckoutResult (iFrame/redirect ya da PAID).
 * Hız sınırı: quote 60/dk (sepet her değişimde çağırır), checkout 10/dk.
 */
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Public()
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  quote(@Body() dto: CheckoutQuoteDto, @Req() req: AuthenticatedRequest): Promise<CheckoutQuoteResponse> {
    return this.checkout.quote(dto, { userId: req.user?.id ?? null });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited('checkout')
  async create(@CurrentUser('id') userId: string, @Body() dto: CheckoutDto, @Req() req: AuthenticatedRequest): Promise<CheckoutResult> {
    const rawUa = req.headers['user-agent'];
    const result = await this.checkout.checkout(dto, {
      userId,
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: Array.isArray(rawUa) ? (rawUa[0] ?? null) : (rawUa ?? null),
    });
    setAuditValues(req, {
      entityId: result.orderId,
      label: `#${result.orderNo}`,
      newValues: { orderNo: result.orderNo, status: result.status, grandTotal: result.grandTotal, provider: result.payment.providerName, paymentStatus: result.payment.status },
    });
    return result;
  }
}
