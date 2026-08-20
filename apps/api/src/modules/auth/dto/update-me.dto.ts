import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** `PATCH /auth/me {name?, phone?}` — boş dizge/null telefon alanı temizler (User.phone opsiyonel, ADR-0009). */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Ad en az 2 karakter olmalı' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((o: UpdateMeDto) => o.phone !== null && o.phone !== '')
  @IsString()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon numarası girin' })
  phone?: string | null;
}
