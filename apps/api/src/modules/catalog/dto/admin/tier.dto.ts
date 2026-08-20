import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, ID_RE, TrimString } from './transforms';

/** `PUT /admin/tiers/:id {label, itemCount, price, note?, imageMediaId?, isRecommended?, isActive?, sortOrder?}` — kısmi; isRecommended=true diğerlerini false yapar. */
export class UpdateTierDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  itemCount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999.99)
  price?: number;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(160)
  note?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'imageMediaId geçersiz' })
  imageMediaId?: string | null;

  @IsOptional()
  @IsBoolean()
  isRecommended?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}
