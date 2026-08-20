import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** Admin `POST /admin/payments/:id/refund` gövdesi (shared `RefundRequest`): `amount` TL (>0, en çok 2 ondalık), `reason` ≤200. */
export class RefundRequestDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'İade tutarı sayı olmalı (en çok 2 ondalık)' })
  @IsPositive({ message: 'İade tutarı pozitif olmalı' })
  amount!: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: RefundRequestDto) => o.reason !== undefined && o.reason !== null)
  @TrimString()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
