import { DELIVERY_DATE_STATUS_VALUES, type DeliveryDateStatus } from '@bagdam/shared';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** `PATCH /admin/delivery/dates/:id {capacity?, status?}` — en az biri zorunlu (serviste 400). */
export class DeliveryDatePatchDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  capacity?: number;

  @IsOptional()
  @IsIn(DELIVERY_DATE_STATUS_VALUES)
  status?: DeliveryDateStatus;
}
