import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `:orderNo` yol parametresi — müşteri uçları (`/me/orders/:orderNo`, `/orders/:orderNo/*`); sayı, ≥ 1001 (0004_raw_commerce). */
export class OrderNoParamDto {
  @Type(() => Number)
  @IsInt({ message: 'orderNo sayı olmalı' })
  @Min(1)
  @Max(2_147_483_647)
  orderNo!: number;
}
