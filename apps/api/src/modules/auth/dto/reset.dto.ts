import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** `POST /auth/reset {token, password(min 8)}` — token: forgot e-postasındaki ham değer (64 hex); DB'de sha256'sı. */
export class ResetPasswordDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/, { message: 'token geçersiz' })
  token!: string;

  @IsString()
  @MinLength(8, { message: 'Parola en az 8 karakter olmalı' })
  @MaxLength(200)
  password!: string;
}
