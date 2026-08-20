import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, TrimString } from './transforms';

/**
 * `PUT /admin/categories/:id {label, panelNote?, sortOrder?, isActive?, legacyTab?}`
 * Yeni kategori oluşturma MVP'de yok (ikon statik assets/icons/<slug>.png [B17]); slug değişmez.
 */
export class UpdateCategoryDto {
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(2000)
  panelNote?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Bootstrap `product.tab` (pantry | dairy | firin); null → tab yazılmaz (boxes). */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(20)
  legacyTab?: string | null;
}
