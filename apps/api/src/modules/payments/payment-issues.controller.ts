import { Controller, Get, Query } from '@nestjs/common';
import type { PaymentIssueList } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentIssuesQueryDto } from './dto/payment-issues-query.dto';
import { PaymentIssuesService } from './payment-issues.service';

/**
 * PaymentIssuesController — `GET /api/v1/admin/payment-issues` (ekran 18 "Ödeme Problemleri"; F9).
 * PAYMENT_FAILED siparişler + UNPAID/AWAITING_PAYMENT cycle'lar tek listede; salt okuma (audit yok).
 * Eylemler mevcut uçlarda: `POST /admin/cycles/:id/charge` · `POST /admin/cycles/:id/send-payment-link` ·
 * `POST /admin/orders/:id/notes` · `PATCH /admin/orders/:id/status`.
 */
@Controller('admin/payment-issues')
@Roles('ADMIN', 'STAFF')
export class PaymentIssuesController {
  constructor(private readonly issues: PaymentIssuesService) {}

  @Get()
  list(@Query() query: PaymentIssuesQueryDto): Promise<PaymentIssueList> {
    return this.issues.list(query);
  }
}
