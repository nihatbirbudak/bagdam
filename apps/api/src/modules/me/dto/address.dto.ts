import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ID_RE, SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `PUT /me/address {fullName, phone(zorunlu), line, zoneId|zoneSlug, zip?}` — uyelik.html #addressForm
 * (ilçe text→select, ADR-0003 istisna 5; select değeri zoneSlug ya da zoneId gönderebilir). Telefon zorunlu [B10].
 */
export class UpsertAddressDto {
  @TrimString()
  @IsString()
  @MinLength(2, { message: 'Ad soyad en az 2 karakter olmalı' })
  @MaxLength(120)
  fullName!: string;

  @TrimString()
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon numarası girin' })
  @MaxLength(30)
  phone!: string;

  @TrimString()
  @IsString()
  @MinLength(5, { message: 'Adres en az 5 karakter olmalı' })
  @MaxLength(500)
  line!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: UpsertAddressDto) => o.zoneId !== undefined)
  @TrimString()
  @Matches(ID_RE, { message: 'zoneId geçersiz' })
  zoneId?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: UpsertAddressDto) => o.zoneSlug !== undefined)
  @TrimString()
  @Matches(SLUG_RE, { message: 'zoneSlug geçersiz' })
  zoneSlug?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((o: UpsertAddressDto) => o.zip !== null && o.zip !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(10)
  zip?: string | null;
}
