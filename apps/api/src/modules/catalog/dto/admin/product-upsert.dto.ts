import { PRODUCT_STATUS_VALUES, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EmptyToNull, ID_RE, SLUG_RE, TrimString } from './transforms';

/** Product.extraOptions öğesi `{factor,label}` (cart.js subExtraOptions). */
export class ExtraOptionDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  factor!: number;

  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;
}

/**
 * `POST /admin/products` gövdesi (BACKEND-PLANI §3; AdminProductInput). Görseller ve partiler ayrı uçlardan.
 * Opsiyonel metinlerde boş string → null (formdan boş gelirse alan temizlenir).
 */
export class CreateProductDto {
  @TrimString()
  @Matches(SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı (1–80)' })
  slug!: string;

  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Matches(ID_RE, { message: 'categoryId geçersiz' })
  categoryId!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(40)
  group?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'producerId geçersiz' })
  producerId?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(80)
  metaNote?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999.99)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  vatRate?: number;

  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  unit!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(60)
  boxAmount?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ExtraOptionDto)
  extraOptions?: ExtraOptionDto[] | null;

  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(2000)
  storageText?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(120)
  allergenText?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(120)
  freshnessNote?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(40)
  prefLabel?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  prefOptions?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(11)
  prefDefault?: number | null;

  @IsOptional()
  @IsBoolean()
  isFresh?: boolean;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(40)
  season?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_VALUES)
  status?: ProductStatus;

  @IsOptional()
  @IsIn(STOCK_STATUS_VALUES)
  stockStatus?: StockStatus;

  @IsOptional()
  @IsBoolean()
  pairWithBox?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  pairOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

/** `PUT /admin/products/:id` — aynı gövde, tüm alanlar opsiyonel (kısmi güncelleme). */
export class UpdateProductDto extends PartialType(CreateProductDto) {}
