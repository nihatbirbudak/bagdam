import {
  CANCEL_REASON_VALUES,
  DELIVERY_DAY_SLUG_VALUES,
  FREQ_ID_VALUES,
  type CancelReason,
  type DeliveryDaySlug,
  type FreqId,
} from '@bagdam/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ID_RE, SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';

/** `PATCH /me/subscription` — freq/deliveryDay/addressId/paymentMethodId (tier/type değişimi YOK — ADR-0008). */
export class SubscriptionPatchDto {
  @IsOptional()
  @IsIn(FREQ_ID_VALUES)
  freq?: FreqId;

  @IsOptional()
  @IsIn(DELIVERY_DAY_SLUG_VALUES)
  deliveryDay?: DeliveryDaySlug;

  @IsOptional()
  @Matches(ID_RE, { message: 'addressId geçersiz' })
  addressId?: string;

  @IsOptional()
  @Matches(ID_RE, { message: 'paymentMethodId geçersiz' })
  paymentMethodId?: string;
}

/** cart.js `sub.extras[]` öğesi: ürün slug'ı + çarpan + etiket. */
export class SubExtraDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'extras[].id geçersiz' })
  id!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(100)
  factor!: number;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(80)
  label?: string;
}

/**
 * `PATCH /me/subscription/cycles/current` — swap/pref/extras (SCHEDULED ve kesimden önce).
 * `cycleId` (bootstrap `currentCycle.id`) verilirse değişiklik O cycle'a uygulanır; kesimi geçtiyse 409 CYCLE_LOCKED
 * ("11:59 kabul / 12:01 red"); verilmezse en yakın düzenlenebilir cycle (kesim geçtiyse sonraki hafta).
 */
export class CurrentCyclePatchDto {
  @IsOptional()
  @Matches(ID_RE, { message: 'cycleId geçersiz' })
  cycleId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(SLUG_RE, { each: true, message: 'items[] ürün slug olmalı' })
  items?: string[];

  @IsOptional()
  @IsObject()
  itemPrefs?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SubExtraDto)
  extras?: SubExtraDto[];
}

export class MergeCartLineDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'lines[].id geçersiz' })
  id!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  qty!: number;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(60)
  pref?: string | null;
}

/** `POST /me/subscription/cycles/current/merge-cart` — "bu haftaki kutuma ekle" (`cycleId` kuralı CurrentCyclePatchDto ile aynı). */
export class MergeCartDto {
  @IsOptional()
  @Matches(ID_RE, { message: 'cycleId geçersiz' })
  cycleId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MergeCartLineDto)
  lines!: MergeCartLineDto[];
}

/** `POST /me/subscription/cancel {reason, note?}`. */
export class CancelRequestDto {
  @IsIn(CANCEL_REASON_VALUES)
  reason!: CancelReason;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;
}
