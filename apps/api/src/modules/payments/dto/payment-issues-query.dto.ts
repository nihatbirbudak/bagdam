import { PAYMENT_ISSUE_KINDS, type PaymentIssueKind } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `GET /admin/payment-issues?kind=&q=&page=&limit=` (ekran 18 "Ödeme Problemleri").
 * `kind` verilmezse iki kaynak birleştirilir (PAYMENT_FAILED siparişler + UNPAID/AWAITING_PAYMENT cycle'lar).
 * `q`: sipariş no (sayı) ya da müşteri adı/e-posta/telefon parçası.
 */
export class PaymentIssuesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PAYMENT_ISSUE_KINDS)
  kind?: PaymentIssueKind;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(160)
  q?: string;
}
