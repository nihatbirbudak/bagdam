/**
 * JWT ayarları (ADR-0009): access 15 dk (JWT_SECRET) + refresh 30 gün (JWT_REFRESH_SECRET, rotasyonlu).
 * Sırlar yalnız env'den okunur; eksikse ilk kullanımda açık hata (production'da env-validator zaten
 * bootstrap'ta durdurur). Süreler sabittir — istemciler (admin, cart.js) bu değerlere göre yenileme yapar.
 */

/** Access JWT ömrü (saniye) — 15 dakika. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh JWT ömrü (saniye) — 30 gün. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** JWT payload `typ` alanı — access token refresh yerine (ve tersi) kullanılamaz. */
export type TokenType = 'access' | 'refresh';

export interface JwtSecrets {
  access: string;
  refresh: string;
}

type JwtSecretEnvKey = 'JWT_SECRET' | 'JWT_REFRESH_SECRET';

function requireSecret(key: JwtSecretEnvKey): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`${key} tanımlı değil — apps/api/.env dosyasını .env.example'a göre tamamlayın`);
  }
  return value;
}

/** İki sırrı env'den okur; AuthService kurulurken bir kez çağrılır (fail-fast). */
export function loadJwtSecrets(): JwtSecrets {
  return { access: requireSecret('JWT_SECRET'), refresh: requireSecret('JWT_REFRESH_SECRET') };
}
