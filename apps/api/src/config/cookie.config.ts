import type { CookieOptions } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './jwt.config';

/**
 * Çerez adları ve seçenekleri (ADR-0009):
 * - `access_token`  httpOnly · SameSite=Lax · Secure (prod) · path=/            · 15 dk
 * - `refresh_token` httpOnly · SameSite=Lax · Secure (prod) · path=/api/v1/auth · 30 gün
 * - `csrf_token`    httpOnly:false (JS okur) · SameSite=Lax · path=/ — double-submit: `X-CSRF-Token` == çerez
 * Dev'de Secure=false (http://localhost). COOKIE_DOMAIN env'i isteğe bağlı (varsayılan: istek host'u).
 */

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
/** Mutasyon isteklerinde beklenen başlık (küçük harf — Node header anahtarları küçük harflidir). */
export const CSRF_HEADER = 'x-csrf-token';

/** Refresh çerezi yalnız auth uçlarına gider (global prefix `api/v1` dahil — main.ts ile aynı). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** CSRF çerezi ömrü — oturumdan uzun; her GET /auth/csrf ve login yeniler. */
const CSRF_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function cookieDomain(): string | undefined {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return domain ? domain : undefined;
}

function baseOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    domain: cookieDomain(),
    path,
  };
}

export function accessCookieOptions(): CookieOptions {
  return { ...baseOptions('/'), maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 };
}

export function refreshCookieOptions(): CookieOptions {
  return { ...baseOptions(REFRESH_COOKIE_PATH), maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 };
}

export function csrfCookieOptions(): CookieOptions {
  return { ...baseOptions('/'), httpOnly: false, maxAge: CSRF_COOKIE_TTL_MS };
}

/** Silme seçenekleri: path/domain/secure/sameSite set ile aynı olmalı (maxAge/expires hariç). */
export function clearAccessCookieOptions(): CookieOptions {
  return baseOptions('/');
}

export function clearRefreshCookieOptions(): CookieOptions {
  return baseOptions(REFRESH_COOKIE_PATH);
}
