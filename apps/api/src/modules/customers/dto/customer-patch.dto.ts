import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** `PATCH /admin/customers/:id {isActive?, name?, phone?}` — isActive=false oturumları düşürür; phone null/'' temizler. */
export class CustomerPatchDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(2, { message: 'Ad en az 2 karakter olmalı' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((o: CustomerPatchDto) => o.phone !== null && o.phone !== '')
  @TrimString()
  @IsString()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon numarası girin' })
  phone?: string | null;
}
