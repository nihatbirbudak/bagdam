import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, ID_RE, SLUG_RE, TrimString } from './transforms';

/** `POST /admin/producers` — slug verilmezse addan türetilir (Türkçe duyarlı). */
export class CreateProducerDto {
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @TrimString()
  @Matches(SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı (1–80)' })
  slug?: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(80)
  village?: string | null;

  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  district?: string;

  /** şema-var/UI-yok (üretici sayfası P2) — yine de düzenlenebilir. */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(5000)
  story?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'photoMediaId geçersiz' })
  photoMediaId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

/** `PUT /admin/producers/:id` — kısmi. */
export class UpdateProducerDto extends PartialType(CreateProducerDto) {}
