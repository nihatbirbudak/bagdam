import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/refresh` — asıl kaynak `refresh_token` çerezi (path=/api/v1/auth). Gövdedeki `refreshToken`
 * yalnız Bearer akışı (testler / ileride mobil) için isteğe bağlı yedek; web istemcileri göndermez.
 */
export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}
