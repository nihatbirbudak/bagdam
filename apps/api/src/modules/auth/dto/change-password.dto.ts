import { IsString, MaxLength, MinLength } from 'class-validator';

/** `PATCH /auth/me/password {currentPassword, newPassword}` — en az 8 karakter (seed ile aynı eşik). */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Mevcut parola gerekli' })
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Yeni parola en az 8 karakter olmalı' })
  @MaxLength(200)
  newPassword!: string;
}
