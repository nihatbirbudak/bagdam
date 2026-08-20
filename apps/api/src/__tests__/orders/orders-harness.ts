// F7/B2 test iskeleti — gerçek Nest uygulaması (rastgele port), gerçek DB (bagdam_dev), Node fetch + CookieJar.
// İki kurulum: `createOrdersServiceApp` (yalnız PrismaModule + OrdersModule; ORDERS_DEPS casus sarmalayıcı — servis testleri)
// ve `createOrdersHttpApp` (Auth/Audit/Mail/Me/Orders + guard zinciri JwtAuth → Csrf → Roles + AuditLogInterceptor — HTTP testleri).
// Test verisi: geçici bölge (`test-orders-<run>`) + teslimat tarihleri (açık / kesimi geçmiş / dolu / yakın) + geçici müşteri + adres;
// sonda `cleanupOrdersFixture` hepsini siler (seed bölgeleri/tarihleri DEĞİŞMEZ).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { addCalendarDays, calendarDateIn, computeCutoffAt, DEFAULT_TZ, isoDateToUtc, type AddressSnapshot } from '@bagdam/shared';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { MailModule } from '../../modules/mail/mail.module';
import { MeModule } from '../../modules/me/me.module';
import { ORDERS_DEPS, PrismaOrdersDeps, type OrdersDeps } from '../../modules/orders/orders.deps';
import { OrdersModule } from '../../modules/orders/orders.module';
import { OrdersRepository } from '../../modules/orders/orders.repository';
import { OrdersService } from '../../modules/orders/orders.service';
import type { Tx } from '../../modules/orders/orders.types';
import { cleanupUsers, requireSeedAdmin, type Method } from '../auth/f6-harness';
import { CookieJar } from '../auth/cookie-jar';
import { requireDatabaseUrl } from '../helpers/env';

process.env.DISABLE_MAIL = 'true';

export const AUTH = '/api/v1/auth';
export const TEST_PASSWORD = 'Orders-Parola-123';

/** Casus deps: gerçek PrismaOrdersDeps'e delege eder, çağrıları sayar (reserve/release doğrulaması). */
export interface SpyOrdersDeps extends OrdersDeps {
  reserve: jest.Mock<Promise<void>, [string, Tx?]>;
  release: jest.Mock<Promise<void>, [string, Tx?]>;
}

export function spyDeps(repo: OrdersRepository): SpyOrdersDeps {
  const real = new PrismaOrdersDeps(repo);
  return {
    reserve: jest.fn((id: string, tx?: Tx) => real.reserve(id, tx)),
    release: jest.fn((id: string, tx?: Tx) => real.release(id, tx)),
  };
}

async function finishApp(builder: TestingModuleBuilder, withCookies: boolean): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  if (withCookies) app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace(/\/$/, '');
  return { app, baseUrl };
}

// ── Servis testleri ──────────────────────────────────────────────────────────

export interface OrdersServiceApp {
  app: INestApplication;
  prisma: PrismaService;
  orders: OrdersService;
  deps: SpyOrdersDeps;
  close(): Promise<void>;
}

export async function createOrdersServiceApp(): Promise<OrdersServiceApp> {
  requireDatabaseUrl();
  const builder = Test.createTestingModule({ imports: [CacheModule.register({ isGlobal: true }), PrismaModule, OrdersModule] })
    .overrideProvider(ORDERS_DEPS)
    .useFactory({ factory: (repo: OrdersRepository) => spyDeps(repo), inject: [OrdersRepository] });
  const { app } = await finishApp(builder, false);
  return {
    app,
    prisma: app.get(PrismaService),
    orders: app.get(OrdersService),
    deps: app.get<SpyOrdersDeps>(ORDERS_DEPS),
    async close() {
      await app.close();
    },
  };
}

// ── HTTP testleri ────────────────────────────────────────────────────────────

export interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean;
}

export interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

export interface OrdersHttpApp {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
  orders: OrdersService;
  call(method: Method, path: string, opts?: CallOptions): Promise<Response>;
  login(jar: CookieJar, email: string, password: string): Promise<Response>;
  loginSeedAdmin(jar: CookieJar): Promise<string>;
  close(): Promise<void>;
}

export async function createOrdersHttpApp(): Promise<OrdersHttpApp> {
  requireDatabaseUrl();
  const builder = Test.createTestingModule({
    imports: [CacheModule.register({ isGlobal: true }), PrismaModule, AuthModule, AuditModule, MailModule, MeModule, OrdersModule],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ],
  });
  const { app, baseUrl } = await finishApp(builder, true);

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
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
    prisma: app.get(PrismaService),
    orders: app.get(OrdersService),
    call,
    login,
    async loginSeedAdmin(jar) {
      const admin = requireSeedAdmin();
      const res = await login(jar, admin.email, admin.password);
      if (res.status !== 200) throw new Error(`seed admin girişi başarısız: ${res.status}`);
      return ((await res.json()) as { user: { id: string } }).user.id;
    },
    async close() {
      await app.close();
    },
  };
}

// ── Ortak veri (fixture) ─────────────────────────────────────────────────────

export interface OrdersFixture {
  run: string;
  startedAt: Date;
  zoneId: string;
  zoneSlug: string;
  zoneName: string;
  userId: string;
  email: string;
  addressId: string;
  address: AddressSnapshot;
  /** Açık, kesimi gelecekte (bugün+10) — siparişler buna. */
  openDateId: string;
  openDateIso: string;
  openCutoffAt: Date;
  /** Kesimi geçmiş (bugün → kesim dün 12:00). */
  lockedDateId: string;
  /** Kapasite 0 → DAY_FULL. */
  fullDateId: string;
  /** Açık ikinci tarih (bugün+3) — müşteri iptali "kesim geçti" senaryosunda cutoffAt geriye çekilir. */
  soonDateId: string;
  soonDateIso: string;
}

export async function createOrdersFixture(prisma: PrismaService, tag: string): Promise<OrdersFixture> {
  const run = `${tag}-${Date.now().toString(36)}`;
  const startedAt = new Date();
  const zone = await prisma.deliveryZone.create({
    data: { name: `Test Orders ${run}`, slug: `test-orders-${run}`, fee: 49, freeThreshold: 1000, capacityPerDay: 5, isActive: true, sortOrder: 990 },
  });
  const today = calendarDateIn(startedAt, DEFAULT_TZ);
  const mk = async (offset: number, capacity: number) => {
    const dateIso = addCalendarDays(today, offset);
    const row = await prisma.deliveryDate.create({
      data: { zoneId: zone.id, day: 'SALI', date: isoDateToUtc(dateIso), cutoffAt: computeCutoffAt(dateIso), capacity, reserved: 0, status: 'OPEN' },
    });
    return { row, dateIso };
  };
  const open = await mk(10, 5);
  const locked = await mk(0, 5); // kesim = dün 12:00 → geçmiş
  const full = await mk(12, 0);
  const soon = await mk(3, 5);

  const email = `test-orders-${run}@bagdam.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), name: 'Sipariş Test', phone: '+90 555 000 11 22', role: 'CUSTOMER', isActive: true },
    select: { id: true },
  });
  const addr = await prisma.address.create({
    data: { userId: user.id, fullName: 'Sipariş Test', phone: '+90 555 000 11 22', line: 'Test Mah. 1. Sk. No:1', zoneId: zone.id, zip: '35430', isDefault: true },
  });
  return {
    run,
    startedAt,
    zoneId: zone.id,
    zoneSlug: zone.slug,
    zoneName: zone.name,
    userId: user.id,
    email,
    addressId: addr.id,
    address: { fullName: addr.fullName, phone: addr.phone, line: addr.line, zoneId: zone.id, zoneName: zone.name, zip: addr.zip },
    openDateId: open.row.id,
    openDateIso: open.dateIso,
    openCutoffAt: open.row.cutoffAt,
    lockedDateId: locked.row.id,
    fullDateId: full.row.id,
    soonDateId: soon.row.id,
    soonDateIso: soon.dateIso,
  };
}

/** Siparişler (cascade satır/ödeme) → abonelikler (cascade cycle/item/event) → tarihler → bölge → audit → kullanıcılar. */
export async function cleanupOrdersFixture(prisma: PrismaService, fx: OrdersFixture, extraUserIds: string[] = []): Promise<void> {
  const userIds = [fx.userId, ...extraUserIds];
  await prisma.order.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { zoneId: fx.zoneId }] } });
  await prisma.subscription.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { zoneId: fx.zoneId }] } });
  await prisma.deliveryDate.deleteMany({ where: { zoneId: fx.zoneId } });
  await prisma.address.deleteMany({ where: { zoneId: fx.zoneId } });
  await prisma.deliveryZone.delete({ where: { id: fx.zoneId } }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { module: 'orders', createdAt: { gte: fx.startedAt } } });
  await cleanupUsers(prisma, userIds, [fx.email], fx.startedAt);
}
