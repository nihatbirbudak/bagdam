import { Controller, Get, Header, Param } from '@nestjs/common';
import type { PaymentLinkInfo } from '@bagdam/shared';
import { Public } from '../../common/decorators/public.decorator';
import { LinkTokenParamDto } from './dto/link-token-param.dto';
import { PaymentsService } from './payments.service';

/**
 * PayController — public `GET /api/v1/pay/:linkToken` (BACKEND-PLANI §3 payments satırı [B27]).
 * F7: JSON `{status, amount, expiresAt, expired, orderNo}` (ödeme linki durumu); F8: iyzico Checkout Form sayfası (3DS) aynı rota.
 * Kişisel ödeme bilgisi → `no-store`. Biçimsiz token 400, bilinmeyen 404 `PAYMENT_LINK_NOT_FOUND`.
 */
@Controller('pay')
@Public()
export class PayController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':linkToken')
  @Header('Cache-Control', 'private, no-store')
  info(@Param() params: LinkTokenParamDto): Promise<PaymentLinkInfo> {
    return this.payments.getPaymentLinkInfo(params.linkToken, new Date());
  }
}
