import { IsString, Matches } from 'class-validator';

/** `GET /auth/verify?token=<jwt typ:verify>` — e-postadaki bağlantı; sonuç 302 /uyelik.html?dogrulandi=1|0. */
export class VerifyQueryDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]{20,2048}$/, { message: 'token geçersiz' })
  token!: string;
}
