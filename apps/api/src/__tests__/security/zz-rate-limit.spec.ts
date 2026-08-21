// F10 güvenlik — hız sınırı (ThrottlerGuard). Kendi uygulamasını kurar: diğer güvenlik suite'leri
// throttler olmadan koşar (yüzlerce istek 429 yemesin), burada sınırlar bilerek zorlanır.
// Dosya adı `zz-` ile başlar: dizin içinde en son koşsun (IP kovaları başka suite'i etkilemesin).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { HealthModule } from '../../modules/health/health.module';
import { CronLogsModule } from '../../modules/cron-logs/cron-logs.module';
import { MailModule } from '../../modules/mail/mail.module';
import { SystemLogsModule } from '../../modules/system-logs/system-logs.module';
import { WebhookEventsModule } from '../../modules/webhook-events/webhook-events.module';
import { requireDatabaseUrl } from '../helpers/env';
import { RUN } from './security-harness';

jest.setTimeout(180_000);

process.env.DISABLE_MAIL = 'true';

/** AppModule ile aynı genel sınır. */
const GLOBAL_LIMIT = 100;
const GLOBAL_TTL_MS = 60_000;

describe('Hız sınırı — ThrottlerGuard (F10)', () => {
  let app: INestApplication;
  let baseUrl = '';

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        ThrottlerModule.forRoot([{ ttl: GLOBAL_TTL_MS, limit: GLOBAL_LIMIT }]),
        PrismaModule,
        SystemLogsModule,
        CronLogsModule,
        WebhookEventsModule,
        HealthModule,
        AuthModule,
        AuditModule,
        MailModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  }

  it('POST /auth/forgot: 3/dk sınırı — 4. istek 429 (kod TOO_MANY_REQUESTS)', async () => {
    const email = `test-f10-rate-${RUN}@bagdam.test`; // kayıtsız e-posta: 200 döner, MailLog yazılmaz
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      codes.push((await post('/api/v1/auth/forgot', { email })).status);
    }
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[3]).toBe(429);

    const blocked = await post('/api/v1/auth/forgot', { email });
    const body = (await blocked.json()) as { statusCode: number; code?: string };
    expect(body.statusCode).toBe(429);
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('POST /auth/login: 10/dk sınırı — 11. istek 429 (kaba kuvvet yavaşlatma)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      codes.push((await post('/api/v1/auth/login', { email: `yok-${RUN}-${i}@bagdam.test`, password: 'Yanlis-1234' })).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('GET /health @SkipThrottle: sınır uygulanmaz (monitör kilitlenmesin)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      codes.push((await fetch(`${baseUrl}/api/v1/health`)).status);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});
