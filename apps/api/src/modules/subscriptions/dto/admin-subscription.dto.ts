import {
  CHARGE_STRATEGY_VALUES,
  CYCLE_STATUS_VALUES,
  DELIVERY_DAY_VALUES,
  OPS_BULK_STATUS_VALUES,
  SUBSCRIPTION_STATUS_VALUES,
  type ChargeStrategy,
  type CycleStatus,
  type DeliveryDay,
  type OpsBulkStatus,
  type SubscriptionStatus,
} from '@bagdam/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ID_RE, ISO_DATE_RE, SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';

/** `GET /admin/subscriptions?status&q&page&limit`. */
export class AdminSubscriptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUS_VALUES)
  status?: SubscriptionStatus;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(160)
  q?: string;
}

/** `PATCH /admin/subscriptions/:id` — durum (CANCELLED/PAUSED/ACTIVE), sıklık, gün, adres, kart, strateji, not. */
export class AdminSubscriptionPatchDto {
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUS_VALUES)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  frequencyWeeks?: number;

  @IsOptional()
  @IsIn(DELIVERY_DAY_VALUES)
  deliveryDay?: DeliveryDay;

  @IsOptional()
  @Matches(ID_RE, { message: 'addressId geçersiz' })
  addressId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'paymentMethodId geçersiz' })
  paymentMethodId?: string | null;

  @IsOptional()
  @IsIn(CHARGE_STRATEGY_VALUES)
  chargeStrategy?: ChargeStrategy;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Virgüllü liste → dizi (query `status=CHARGED,PREPARING`). */
function toStatusList({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return value;
}

/** `GET /admin/cycles?date=YYYY-MM-DD&status=A,B&zone=slug`. */
export class AdminCyclesQueryDto {
  @Matches(ISO_DATE_RE, { message: 'date YYYY-MM-DD olmalı' })
  date!: string;

  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @IsIn(CYCLE_STATUS_VALUES, { each: true })
  status?: CycleStatus[];

  @IsOptional()
  @TrimString()
  @Matches(SLUG_RE, { message: 'zone geçersiz' })
  zone?: string;
}

/** `GET /admin/ops/pick-list?date=&zone=` / `packing-list`. */
export class OpsDateQueryDto {
  @Matches(ISO_DATE_RE, { message: 'date YYYY-MM-DD olmalı' })
  date!: string;

  @IsOptional()
  @TrimString()
  @Matches(SLUG_RE, { message: 'zone geçersiz' })
  zone?: string;
}

/**
 * `POST /admin/ops/bulk-status` — seçili cycle'ları ve/veya siparişleri aynı duruma ilerletir (ekran 20).
 * `DELIVERY_FAILED` yalnız siparişlerde geçerlidir (cycle makinesinde yoktur) → cycleIds ile birlikte 409.
 * `skipInvalid` verilmezse hep-ya-hiç: bir satırın geçişi bile geçersizse hiçbiri uygulanmaz (409).
 */
export class OpsBulkStatusDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Matches(ID_RE, { each: true, message: 'cycleIds[] geçersiz' })
  cycleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Matches(ID_RE, { each: true, message: 'orderIds[] geçersiz' })
  orderIds?: string[];

  @IsIn(OPS_BULK_STATUS_VALUES)
  status!: OpsBulkStatus;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;
}

/** `PATCH /admin/cycles/:id/status {status, note?}`. */
export class CycleStatusPatchDto {
  @IsIn(CYCLE_STATUS_VALUES)
  status!: CycleStatus;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** `POST /admin/cycles/:id/compensate {productId, qty?, label?, note}` — telafi: 0 TL EXTRA satırı [B19]. */
export class CycleCompensateDto {
  @Matches(ID_RE, { message: 'productId geçersiz' })
  productId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(100)
  qty?: number;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(80)
  label?: string;

  @TrimString()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  note!: string;
}

/** Admin manuel checkout ekstrası: ürün slug'ı + çarpan (Setting extraAmountOptions / ürün seçenekleri) + etiket. */
export class AdminCreateSubscriptionExtraDto {
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
 * `POST /admin/subscriptions` — manuel (ofis/havale/nakit) checkout: müşteri adına kutu aboneliği ya da tek seferlik kutu açar;
 * fiyat PricingService.quote, Order PAID (MANUAL ödeme), Subscription ACTIVE + cycle#1 (ManualCheckoutService).
 * `deliveryOn` verilmezse bölge+gün için kesimi geçmemiş ilk tarih; `items` verilmezse haftanın yayınlanmış şablonu.
 */
export class AdminCreateSubscriptionDto {
  @Matches(ID_RE, { message: 'userId geçersiz' })
  userId!: string;

  @TrimString()
  @Matches(SLUG_RE, { message: 'tierSlug geçersiz' })
  tierSlug!: string;

  @IsOptional()
  @IsBoolean()
  isOneTime?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  frequencyWeeks?: number;

  @IsIn(DELIVERY_DAY_VALUES)
  deliveryDay!: DeliveryDay;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'deliveryOn YYYY-MM-DD olmalı' })
  deliveryOn?: string;

  @IsOptional()
  @Matches(ID_RE, { message: 'addressId geçersiz' })
  addressId?: string;

  @IsOptional()
  @Matches(ID_RE, { message: 'paymentMethodId geçersiz' })
  paymentMethodId?: string;

  @IsOptional()
  @IsIn(CHARGE_STRATEGY_VALUES)
  chargeStrategy?: ChargeStrategy;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(SLUG_RE, { each: true, message: 'items[] ürün slug olmalı' })
  items?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AdminCreateSubscriptionExtraDto)
  extras?: AdminCreateSubscriptionExtraDto[];

  @IsOptional()
  @IsObject()
  itemPrefs?: Record<string, string>;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;
}
