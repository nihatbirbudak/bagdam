import { COUPON_KIND_VALUES, COUPON_SCOPE_VALUES, type CouponKind, type CouponScope } from '@bagdam/shared';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EmptyToNull, ToOptionalBoolean, TrimString } from '../../catalog/dto/admin/transforms';

/** Admin `POST /admin/coupons` · `PUT /admin/coupons/:id` gövdesi (shared `CouponInput`). */
export class CouponUpsertDto {
  @TrimString()
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsIn(COUPON_KIND_VALUES, { message: 'kind PERCENT | AMOUNT olmalı' })
  kind!: CouponKind;

  /** PERCENT: 0–100 · AMOUNT: TL. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value!: number;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CouponUpsertDto) => o.minSubtotal !== null && o.minSubtotal !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minSubtotal?: number | null;

  @IsOptional()
  @IsIn(COUPON_SCOPE_VALUES, { message: 'appliesTo ALL | SINGLE | BOX olmalı' })
  appliesTo?: CouponScope;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CouponUpsertDto) => o.startsAt !== null && o.startsAt !== undefined)
  @IsISO8601({}, { message: 'startsAt ISO 8601 olmalı' })
  startsAt?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CouponUpsertDto) => o.endsAt !== null && o.endsAt !== undefined)
  @IsISO8601({}, { message: 'endsAt ISO 8601 olmalı' })
  endsAt?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CouponUpsertDto) => o.usageLimit !== null && o.usageLimit !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CouponUpsertDto) => o.perUserLimit !== null && o.perUserLimit !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perUserLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === null ? null : typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: CouponUpsertDto) => o.note !== null && o.note !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Admin `GET /admin/coupons?q&active&page&limit`. */
export class CouponQueryDto extends PaginationQueryDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @ToOptionalBoolean()
  @IsBoolean()
  active?: boolean;
}

/** Admin `PATCH /admin/coupons/:id/active {isActive}`. */
export class CouponActivePatchDto {
  @IsBoolean()
  isActive!: boolean;
}
