import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/** `POST /auth/forgot {email}` — kullanıcı olsun olmasın 200 {ok:true} (e-posta keşfi yok). */
export class ForgotPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  email!: string;
}
