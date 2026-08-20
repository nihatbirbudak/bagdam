import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Önce apps/api/.env, sonra kök .env (eksik değişkenler için) — cwd'den bağımsız.
// __dirname: dist/ (derlenmiş) ya da src/ — her ikisinde de `..` = apps/api.
// quiet: dotenv v17'nin "injecting env" reklam satırlarını bastır.
loadEnv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadEnv({ path: resolve(__dirname, '..', '..', '..', '.env'), quiet: true });

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import hbs from 'hbs';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { APP_VERSION, PARTIALS_DIR, PUBLIC_DIR, VIEWS_DIR, getSiteMode, validateEnv } from './config';
import { resolveUploadsDir } from './modules/media/media.constants';
import { WEB_ROUTES_EXCLUDED_FROM_PREFIX } from './web/web.routes';

/** Production'da CORS allow-list'e sabit eklenen alan adları (ADR-0012). */
const PRODUCTION_ORIGINS = [
  'https://bagdam.com',
  'https://www.bagdam.com',
  'https://admin.bagdam.com',
  'https://staging.bagdam.com',
  'https://admin-staging.bagdam.com',
];

/** Geliştirme: localhost / 127.0.0.1 / 0.0.0.0 (herhangi bir port). */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/;
/** Geliştirme: yerel ağ IP'leri (telefonla test). */
const PRIVATE_NET_ORIGIN =
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

type CorsCallback = (err: Error | null, allow?: boolean) => void;

/** CORS origin fonksiyonu — UA kalıbı: env URL'leri + sabit domainler; dev'de localhost/yerel ağ. */
function buildCorsOrigin(isProduction: boolean): (origin: string | undefined, cb: CorsCallback) => void {
  const allowed = new Set<string>(
    [process.env.WEB_URL, process.env.ADMIN_URL, ...PRODUCTION_ORIGINS].filter(
      (o): o is string => typeof o === 'string' && o.length > 0,
    ),
  );
  return (origin, cb) => {
    // Sunucudan sunucuya / same-origin istekler (Origin header'ı yok)
    if (!origin) return cb(null, true);
    if (!isProduction && (LOCAL_ORIGIN.test(origin) || PRIVATE_NET_ORIGIN.test(origin))) {
      return cb(null, true);
    }
    if (allowed.has(origin)) return cb(null, true);
    return cb(null, false);
  };
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';

  // Env değişkenleri fail-fast doğrula — sessiz çalışma-zamanı hatası yerine bootstrap'ta dur.
  validateEnv();

  // Fatal süreç hataları: logla ve çık (PM2 yeniden başlatır). F10'da SystemLog'a da yazılacak.
  process.on('uncaughtException', (err: Error) => {
    logger.fatal(`uncaughtException: ${err.message}`, err.stack);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.fatal(`unhandledRejection: ${msg}`, reason instanceof Error ? reason.stack : undefined);
    process.exit(1);
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // F8: iyzico webhook HMAC doğrulaması için ham gövde gerekli
  });

  // nginx arkasında doğru req.ip için trust proxy (tek hop)
  app.set('trust proxy', 1);

  // RequestId middleware — CORS/Guard pipeline'ından ÖNCE çalışmalı
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => requestIdMiddleware.use(req, res, next));

  // Body boyutu sınırları — DoS koruması (dosya yükleme multipart, bu sınırdan etkilenmez)
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.use(
    helmet({
      contentSecurityPolicy: false, // F10: CSP (frame-src iyzico vb.) ile birlikte açılacak
      crossOriginEmbedderPolicy: false, // iyzico CF iFrame uyumluluğu
      crossOriginResourcePolicy: false, // görseller admin/web origin'lerinden yüklenebilmeli
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // ---- View engine (hbs) + statik dosyalar (ADR-0003) ----
  // Motoru açıkça kaydet: Express'in kendi require('hbs') çözümlemesine (pnpm katmanı) bağımlı kalma.
  app.engine('hbs', hbs.__express);
  app.setBaseViewsDir(VIEWS_DIR);
  app.setViewEngine('hbs');
  if (existsSync(PARTIALS_DIR)) {
    // F3: {{> bootstrap}} partial'ı buradan yüklenecek (şimdilik boş dizin)
    hbs.registerPartials(PARTIALS_DIR, (err?: Error) => {
      if (err) logger.error(`hbs partial kaydı başarısız: ${err.message}`);
    });
  }
  // public/: styles.css + assets/** — prod'da nginx doğrudan servis eder; burada dev + yedek.
  // Prod: uzun ömürlü/immutable (F3'te cart.js?v= ile sürümlenir). Dev: her istekte doğrula.
  app.useStaticAssets(
    PUBLIC_DIR,
    isProduction ? { maxAge: '365d', immutable: true, index: false } : { maxAge: 0, etag: true, index: false },
  );
  // uploads/: admin yüklemeleri (F4 MediaModule → <uploads>/<klasör>/<ad>-<damga>.webp + -thumb.webp).
  // Dosya adları damgalı (içerik değişmez) → 30 gün cache; prod'da nginx aynı dizini `/uploads/` ile servis eder.
  // UPLOADS_DIR env ile taşınabilir (media.constants#resolveUploadsDir — yükleme ile aynı kaynak).
  const uploadsDir = resolveUploadsDir();
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/', maxAge: '30d', index: false, dotfiles: 'ignore' });

  // Global prefix: REST uçları /api/v1 altında; WebController rotaları (HTML) prefix dışında.
  app.setGlobalPrefix('api/v1', { exclude: WEB_ROUTES_EXCLUDED_FROM_PREFIX });

  // CORS — credentials: cookie tabanlı oturum (ADR-0009)
  app.enableCors({
    origin: buildCorsOrigin(isProduction),
    credentials: true,
  });

  // Global validation pipe — DTO doğrulama
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter — JSON hata zarfı (/api/*) + 404.hbs (web)
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 4010);
  const host = process.env.HOST ?? '127.0.0.1';
  app.enableShutdownHooks(); // PM2 reload için graceful shutdown (SIGTERM → Nest close)
  await app.listen(port, host);

  // ADR-0004: TZ logu — PM2 TZ=Europe/Istanbul bekleniyor
  const tz = process.env.TZ ?? '(ayarsız — sistem saat dilimi)';
  logger.log(`TZ=${tz} · Intl=${Intl.DateTimeFormat().resolvedOptions().timeZone} · now=${new Date().toString()}`);
  logger.log(
    `Bağdam API v${APP_VERSION} — http://${host}:${port} · api: /api/v1 · env: ${process.env.NODE_ENV ?? 'development'} · SITE_MODE: ${getSiteMode()}`,
  );
}

bootstrap().catch((err: unknown) => {
  // validateEnv hatası vb. — okunur mesaj, sıfır dışı çıkış
  console.error('[Bootstrap] Başlatma hatası:', err instanceof Error ? err.message : err);
  process.exit(1);
});
