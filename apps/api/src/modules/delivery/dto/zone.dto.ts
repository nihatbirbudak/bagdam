import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `POST /admin/delivery/zones` — DeliveryZone (ADR-0005: kargo ücreti/eşik TEK sahibi [B11]).
 * fee/freeThreshold TL (kuruş hassasiyeti; Decimal(12,2)). freeThreshold null → eşik yok.
 */
export class CreateDeliveryZoneDto {
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @TrimString()
  @Matches(SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı (en çok 60 karakter)' })
  @MaxLength(60)
  slug!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  fee!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  freeThreshold?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  capacityPerDay?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

/** `PUT /admin/delivery/zones/:id` — yalnız gönderilen alanlar güncellenir. */
export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto) {}

/** `PATCH /admin/delivery/zones/:id/active` */
export class DeliveryZoneActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
