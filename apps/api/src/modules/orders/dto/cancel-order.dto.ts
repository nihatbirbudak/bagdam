import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';
import { ORDER_CANCEL_REASON_MAX } from '../orders.constants';

/** `POST /orders/:orderNo/cancel {reason?}` — müşteri iptali (yalnız PENDING_PAYMENT | PAID | PAYMENT_FAILED ve kesimden önce). */
export class CancelOrderDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(ORDER_CANCEL_REASON_MAX)
  reason?: string;
}
