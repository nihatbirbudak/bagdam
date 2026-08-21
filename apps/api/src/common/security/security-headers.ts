import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { cspHeaderForPath } from './content-security-policy';

/**
 * Güvenlik başlıkları — tek yerde kurulur (main.ts bootstrap + `__tests__/security` harness'i
 * aynı fonksiyonu çağırır; testte doğrulanan başlıklar üretimde de aynıdır).
 *
 * Kararlar (ADR-0015, F10):
 *  - **CSP**: helmet'in kendi CSP'si KAPALI; yola göre üç ayrı politika (`content-security-policy.ts`).
 *    helmet tek bir politika koyabildiği için ayrı middleware yazıldı.
 *  - **HSTS**: yalnız production (lokal http://127.0.0.1 tarayıcıda HTTPS'e kilitlenmesin).
 *  - **X-Powered-By**: Express'in kendi header'ı kapatılır (sürüm/teknoloji sızıntısı).
 *  - **COEP/CORP**: kapalı — PayTR iFrame'i ve panelin başka origin'den görsel çekmesi için (F1 kararı).
 *  - **Referrer-Policy**: `strict-origin-when-cross-origin` (PayTR'ye tam URL gitmesin, ama aynı
 *    origin içinde yönlendirme kaynağı korunsun).
 */

export interface SecurityHeaderOptions {
  isProduction: boolean;
  /** nginx arkasında tek hop (main.ts'te de ayrıca kuruluyor; testlerde kapalı). */
  trustProxy?: boolean;
}

/** HSTS: 1 yıl + alt alan adları (Cloudflare "Always HTTPS" ile birlikte). */
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/** Yola göre CSP başlığı koyan middleware (helmet'ten sonra çalışır). */
export function cspMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', cspHeaderForPath(req.path ?? req.url ?? '/'));
  next();
}

/** helmet seçenekleri — ortamdan bağımsız kısım tek yerde (test bunu da doğrular). */
export function helmetOptions(isProduction: boolean): Parameters<typeof helmet>[0] {
  return {
    // CSP'yi cspMiddleware koyar (yola göre üç politika).
    contentSecurityPolicy: false,
    // PayTR iFrame uyumluluğu + görsellerin admin origin'inden yüklenebilmesi (F1).
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    // Ödeme sayfası PayTR'ye yönlenirken pencere bağı kopmamalı.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HSTS yalnız production (lokal geliştirmede tarayıcıyı HTTPS'e kilitlemesin).
    strictTransportSecurity: isProduction
      ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true, preload: false }
      : false,
    // frame-ancestors CSP'de; eski tarayıcılar için X-Frame-Options da DENY.
    frameguard: { action: 'deny' },
  };
}

/**
 * Uygulamaya güvenlik ara katmanlarını kurar. `RequestIdMiddleware`'den SONRA,
 * route'lardan ÖNCE çağrılmalı.
 */
export function applySecurityHeaders(app: NestExpressApplication, opts: SecurityHeaderOptions): void {
  // Express'in "X-Powered-By: Express" header'ı — teknoloji/sürüm sızıntısı.
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);
  app.use(helmet(helmetOptions(opts.isProduction)));
  app.use(cspMiddleware);
}
