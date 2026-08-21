// F10 güvenlik test iskeleti — gerçek Nest uygulaması (rastgele port), gerçek DB (bagdam_dev), Node fetch + CookieJar.
//
// AppModule ile aynı modül kümesi (WebModule ve ThrottlerGuard hariç: hız sınırı testi kendi uygulamasını kurar,
// diğer suite'ler 429 yemesin) + aynı guard zinciri JwtAuth → Csrf → Roles + AuditLogInterceptor.
// main.ts'teki güvenlik başlıkları (`applySecurityHeaders`) burada da uygulanır → testte doğrulanan başlık = üretimdeki başlık.
//
// Test verisi: 4 geçici kullanıcı (kurban müşteri · saldırgan müşteri · STAFF · pasif) + 1 Order (IDOR) +
// seed admin girişi. Sonda hepsi silinir; seed satırlarına DOKUNULMAZ.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { applySecurityHeaders } from '../../common/security/security-headers';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CheckoutModule } from '../../modules/checkout/checkout.module';
import { ContentModule } from '../../modules/content/content.module';
import { CouponsModule } from '../../modules/coupons/coupons.module';
import { CronLogsModule } from '../../modules/cron-logs/cron-logs.module';
import { CustomersModule } from '../../modules/customers/customers.module';
import { DashboardModule } from '../../modules/dashboard/dashboard.module';
import { DeliveryModule } from '../../modules/delivery/delivery.module';
import { HealthModule } from '../../modules/health/health.module';
import { JobsModule } from '../../modules/jobs/jobs.module';
import { MailModule } from '../../modules/mail/mail.module';
import { MediaModule } from '../../modules/media/media.module';
import { MeModule } from '../../modules/me/me.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PricingModule } from '../../modules/pricing/pricing.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SubscriptionsModule } from '../../modules/subscriptions/subscriptions.module';
import { SystemLogsModule } from '../../modules/system-logs/system-logs.module';
import { WebhookEventsModule } from '../../modules/webhook-events/webhook-events.module';
import { WholesaleModule } from '../../modules/wholesale/wholesale.module';
import { CookieJar } from '../auth/cookie-jar';
import { cleanupUsers, requireSeedAdmin, type SessionUserBody } from '../auth/f6-harness';
import { requireDatabaseUrl } from '../helpers/env';

process.env.DISABLE_MAIL = 'true';
// Cron'lar test uygulamasında çalışmasın (ScheduleModule zaten kurulmuyor; JobsModule kayıt defteri için gerekli).
process.env.ENABLE_CRON = 'false';

/** Bu koşuya özgü sonek — paralel/ardışık koşularda e-posta çakışmasın. */
export const RUN = Date.now().toString(36);

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  /** false → kavanozda csrf_token olsa da X-CSRF-Token gönderilmez. */
  csrf?: boolean;
  /** Ham gövde (JSON dışı içerik tipleri; `headers['content-type']` ile birlikte). */
  raw?: string | Buffer;
}

export interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
  error?: string;
  requestId?: string;
  path?: string;
}

export const AUTH = '/api/v1/auth';
export const PASSWORD = 'Guvenlik-Parola-123';

export interface SecurityActor {
  id: string;
  email: string;
  jar: CookieJar;
}

export interface SecurityApp {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
  call(method: Method, path: string, opts?: CallOptions): Promise<Response>;
  login(jar: CookieJar, email: string, password: string): Promise<Response>;
  createUser(input: { email: string; password: string; name?: string | null; role?: 'CUSTOMER' | 'STAFF' | 'ADMIN'; isActive?: boolean }): Promise<string>;
  close(): Promise<void>;
}

export async function createSecurityApp(): Promise<SecurityApp> {
  requireDatabaseUrl();
  const moduleRef = await Test.createTestingModule({
    imports: [
      CacheModule.register({ isGlobal: true }),
      PrismaModule,
      SystemLogsModule,
      CronLogsModule,
      WebhookEventsModule,
      HealthModule,
      AuthModule,
      AuditModule,
      MailModule,
      MeModule,
      CustomersModule,
      CatalogModule,
      MediaModule,
      ContentModule,
      SettingsModule,
      DeliveryModule,
      CouponsModule,
      PricingModule,
      PaymentsModule,
      OrdersModule,
      WholesaleModule,
      SubscriptionsModule,
      CheckoutModule,
      DashboardModule,
      JobsModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // main.ts ile aynı sıra: güvenlik başlıkları → cookieParser → prefix → pipe → filter
  applySecurityHeaders(app, { isProduction: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace(/\/$/, '');
  const prisma = app.get(PrismaService);

  const call = async (method: Method, path: string, opts: CallOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.jar) {
      const cookie = opts.jar.header(path);
      if (cookie) headers.cookie = cookie;
      if (opts.csrf !== false) {
        const csrf = opts.jar.get('csrf_token');
        if (csrf) headers['x-csrf-token'] = csrf.value;
      }
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      redirect: 'manual',
    });
    opts.jar?.absorb(res);
    return res;
  };

  const login = async (jar: CookieJar, email: string, password: string): Promise<Response> => {
    await call('GET', `${AUTH}/csrf`, { jar });
    return call('POST', `${AUTH}/login`, { jar, body: { email, password } });
  };

  return {
    app,
    baseUrl,
    prisma,
    call,
    login,
    async createUser(input) {
      const row = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash: await bcrypt.hash(input.password, 4),
          name: input.name ?? null,
          role: input.role ?? 'CUSTOMER',
          isActive: input.isActive ?? true,
        },
        select: { id: true },
      });
      return row.id;
    },
    async close() {
      await app.close();
    },
  };
}

/** Seed admin ile giriş (SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD) → kullanıcı id'si. */
export async function loginSeedAdmin(t: SecurityApp, jar: CookieJar): Promise<string> {
  const admin = requireSeedAdmin();
  const res = await t.login(jar, admin.email, admin.password);
  if (res.status !== 200) throw new Error(`seed admin girişi başarısız: ${res.status}`);
  return ((await res.json()) as { user: SessionUserBody }).user.id;
}

/** Bir aktör (geçici kullanıcı + oturum açılmış kavanoz) üretir. */
export async function makeActor(
  t: SecurityApp,
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN',
  tag: string,
): Promise<SecurityActor> {
  const email = `test-f10-${tag}-${RUN}@bagdam.test`;
  const id = await t.createUser({ email, password: PASSWORD, role, name: `F10 ${tag}` });
  const jar = new CookieJar();
  const res = await t.login(jar, email, PASSWORD);
  if (res.status !== 200) throw new Error(`${tag} girişi başarısız: ${res.status}`);
  return { id, email, jar };
}

export async function bodyOf<T = ErrorBody>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (null as unknown as T));
}

/** Geçici kullanıcıları ve yan kayıtlarını siler (f6-harness cleanupUsers + orders). */
export async function cleanupSecurityData(
  t: SecurityApp,
  userIds: string[],
  emails: string[],
  since: Date,
): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length > 0) {
    await t.prisma.order.deleteMany({ where: { userId: { in: ids } } });
  }
  await cleanupUsers(t.prisma, ids, emails, since);
}
