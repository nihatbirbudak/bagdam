import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** `POST /admin/delivery/dates/generate {weeks?}` — yoksa Setting `commerce.deliveryDatesHorizonWeeks` (8). */
export class GenerateDeliveryDatesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  weeks?: number;
}
