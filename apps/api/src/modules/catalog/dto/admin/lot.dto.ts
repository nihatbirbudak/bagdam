import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, ID_RE, ISO_DATE_RE, TrimString } from './transforms';

/** `POST /admin/products/:id/lots` — FE batch (lotCode) + why (tastingNote); setCurrent varsayılan true. */
export class CreateLotDto {
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  lotCode!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ISO_DATE_RE, { message: 'harvestDate YYYY-MM-DD olmalı' })
  harvestDate?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ISO_DATE_RE, { message: 'bestBefore YYYY-MM-DD olmalı' })
  bestBefore?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(2000)
  tastingNote?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'producerId geçersiz' })
  producerId?: string | null;

  /** true (varsayılan): bu parti güncel olur, ürünün diğer partileri isCurrent=false. */
  @IsOptional()
  @IsBoolean()
  setCurrent?: boolean;
}

/** `PATCH /admin/products/:id/lots/:lotId` — isCurrent=true diğerlerini false yapar. */
export class UpdateLotDto extends PartialType(CreateLotDto) {
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
