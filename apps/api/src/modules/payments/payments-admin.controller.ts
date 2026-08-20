import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { AdminRefundResult } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { RefundRequestDto } from './dto/refund.dto';
import { PaymentsAdminService } from './payments-admin.service';

/**
 * PaymentsAdminController — `/api/v1/admin/payments` (BACKEND-PLANI §3 payments admin satırı; ekran 17 Siparişler › Ödemeler):
 *  POST /admin/payments/:id/refund {amount, reason?} → {ok, refund, payment, refundedTotal, orderStatus…} (yalnız ADMIN; @Audited('payments') → CREATE).
 * 404 PAYMENT_NOT_FOUND · 409 PAYMENT_NOT_REFUNDABLE · 400 REFUND_AMOUNT_INVALID|REFUND_AMOUNT_EXCEEDS · sağlayıcı reddi → 200 ok:false.
 */
@Controller('admin/payments')
@Roles('ADMIN')
@Audited('payments')
export class PaymentsAdminController {
  constructor(private readonly admin: PaymentsAdminService) {}

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  async refund(
    @Param() params: IdParamDto,
    @Body() dto: RefundRequestDto,
    @CurrentUser('id') actorId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminRefundResult> {
    const result = await this.admin.refund(params.id, { amount: dto.amount, reason: dto.reason ?? null, actorId: actorId ?? null });
    setAuditValues(req, {
      entityId: params.id,
      label: result.orderNo ? `#${result.orderNo} iade` : 'iade',
      newValues: { amount: dto.amount, reason: dto.reason ?? null, ok: result.ok, paymentStatus: result.payment.status, refundedTotal: result.refundedTotal, orderStatus: result.orderStatus },
    });
    return result;
  }
}
