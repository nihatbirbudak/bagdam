import { DELIVERY_DAY_SLUG_VALUES, FREQ_ID_VALUES, type DeliveryDaySlug, type FreqId } from '@bagdam/shared';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EmptyToNull, ID_RE, ISO_DATE_RE, SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';
import { LEGAL_SLUG_RE } from '../../content/dto/content-params.dto';

/** Checkout onayı türleri (requiresAck belgeler — ADR-0003 istisna 3). */
export const CHECKOUT_CONSENT_KINDS = ['PREINFO_ACK', 'CONTRACT_ACK', 'SUBSCRIPTION_CONTRACT_ACK'] as const;
export type CheckoutConsentKind = (typeof CHECKOUT_CONSENT_KINDS)[number];

/** Sepet satırı: `id` ürün slug'ı, `qty` adet (1–99), `pref` ürün tercihi (≤60). */
export class CheckoutLineDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'ürün kimliği (slug) geçersiz' })
  id!: string;

  @Type(() => Number)
  @IsInt({ message: 'adet tam sayı olmalı' })
  @Min(1)
  @Max(99)
  qty!: number;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutLineDto) => o.pref !== null && o.pref !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(60)
  pref?: string | null;
}

/** Kutu ekstrası: `id` ürün slug'ı, `factor` çarpan (Setting extraAmountOptions / Product.extraOptions ile doğrulanır). */
export class CheckoutExtraDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'ekstra ürün kimliği geçersiz' })
  id!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(100)
  factor!: number;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutExtraDto) => o.label !== null && o.label !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(80)
  label?: string | null;
}

/** Sepetteki kutu taslağı (cart.js `bahceden_sub`). */
export class CheckoutBoxDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'kutu boyu (tier) geçersiz' })
  tier!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @Matches(SLUG_RE, { each: true, message: 'kutu içeriği slug listesi olmalı' })
  items?: string[];

  @IsOptional()
  @IsObject()
  itemPrefs?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CheckoutExtraDto)
  extras?: CheckoutExtraDto[];

  @IsOptional()
  @IsBoolean()
  isOneTime?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  frequencyWeeks?: number;

  @IsOptional()
  @IsIn(FREQ_ID_VALUES, { message: 'freq 1hafta | 2hafta | 4hafta olmalı' })
  freq?: FreqId;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutBoxDto) => o.deliveryDay !== null && o.deliveryDay !== undefined)
  @IsIn(DELIVERY_DAY_SLUG_VALUES, { message: 'deliveryDay sali | persembe | cumartesi olmalı' })
  deliveryDay?: DeliveryDaySlug | null;
}

/** `POST /checkout/quote` gövdesi (@Public). */
export class CheckoutQuoteDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines?: CheckoutLineDto[];

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutQuoteDto) => o.box !== null && o.box !== undefined)
  @ValidateNested()
  @Type(() => CheckoutBoxDto)
  box?: CheckoutBoxDto | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutQuoteDto) => o.zoneSlug !== null && o.zoneSlug !== undefined)
  @TrimString()
  @Matches(SLUG_RE, { message: 'zoneSlug geçersiz' })
  zoneSlug?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutQuoteDto) => o.couponCode !== null && o.couponCode !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(40)
  couponCode?: string | null;

  @IsOptional()
  @IsBoolean()
  skipThisWeek?: boolean;
}

/** Checkout onayı: belge slug'ı + onaylanan sürüm (yayındaki sürümle aynı olmalı). */
export class CheckoutConsentDto {
  @IsIn(CHECKOUT_CONSENT_KINDS, { message: 'kind PREINFO_ACK | CONTRACT_ACK | SUBSCRIPTION_CONTRACT_ACK olmalı' })
  kind!: CheckoutConsentKind;

  @TrimString()
  @Matches(LEGAL_SLUG_RE, { message: 'documentSlug geçersiz' })
  documentSlug!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

/** `POST /checkout` gövdesi (oturumlu). */
export class CheckoutDto extends CheckoutQuoteDto {
  @TrimString()
  @Matches(ID_RE, { message: 'addressId geçersiz' })
  addressId!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutDto) => o.deliveryDateId !== null && o.deliveryDateId !== undefined)
  @TrimString()
  @Matches(ID_RE, { message: 'deliveryDateId geçersiz' })
  deliveryDateId?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutDto) => o.deliveryOn !== null && o.deliveryOn !== undefined)
  @TrimString()
  @Matches(ISO_DATE_RE, { message: 'deliveryOn YYYY-MM-DD olmalı' })
  deliveryOn?: string | null;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CheckoutConsentDto)
  consents!: CheckoutConsentDto[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: CheckoutDto) => o.note !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: CheckoutDto) => o.paymentMethodId !== null && o.paymentMethodId !== undefined)
  @TrimString()
  @Matches(ID_RE, { message: 'paymentMethodId geçersiz' })
  paymentMethodId?: string | null;

  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;
}
