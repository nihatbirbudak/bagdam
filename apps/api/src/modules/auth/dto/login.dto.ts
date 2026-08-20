import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /auth/login {email, password}` — doğrulama mesajları Türkçe (ValidationPipe 400 zarfı). */
export class LoginDto {
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Parola gerekli' })
  @MaxLength(200)
  password!: string;
}
