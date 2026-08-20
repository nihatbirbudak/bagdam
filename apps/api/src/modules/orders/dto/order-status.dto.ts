import { ORDER_STATUS_VALUES, type OrderStatus } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';
import { ORDER_CANCEL_REASON_MAX } from '../orders.constants';

/** `PATCH /admin/orders/:id/status {status, reason?}` — geçersiz geçiş 409 ORDER_TRANSITION_INVALID; CANCELLED/REFUNDED için reason zorunlu (400). */
export class OrderStatusPatchDto {
  @IsIn(ORDER_STATUS_VALUES, { message: 'status geçersiz' })
  status!: OrderStatus;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(ORDER_CANCEL_REASON_MAX)
  reason?: string;
}
