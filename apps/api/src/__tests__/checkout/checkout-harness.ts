// F8 checkout test iskeleti — gerçek Nest uygulaması (rastgele port), gerçek DB (bagdam_dev), Node fetch + CookieJar.
// Modüller: Auth/Audit/Mail/Settings/Delivery/Pricing/Payments/Orders/Subscriptions/Coupons/Checkout/Me + guard zinciri
// JwtAuth → Csrf → Roles + AuditLogInterceptor. Sağlayıcı: ManualProvider (Setting payment.provider geçici olarak manual; sonda geri).
// Test verisi: geçici tier + bölge + teslimat tarihleri (açık / dolu / kesimi geçmiş) + müşteri + adres; seed ürünleri/yasal belgeler salt okunur.
// Sonda her şey silinir (cleanup) — seed satırları değişmez.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { addCalendarDays, calendarDateIn, computeCutoffAt, DEFAULT_TZ, isoDateToUtc, type IsoDate } from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { CheckoutCompletionService } from '../../modules/checkout/checkout-completion.service';
import { CheckoutModule } from '../../modules/checkout/checkout.module';
import { CheckoutService } from '../../modules/checkout/checkout.service';
import { getSiteContentRegistryEntry } from '../../modules/content/site-content.registry';
import { CouponsModule } from '../../modules/coupons/coupons.module';
import { CouponsService } from '../../modules/coupons/coupons.service';
import { DeliveryModule } from '../../modules/delivery/delivery.module';
import { MailModule } from '../../modules/mail/mail.module';
import { MeModule } from '../../modules/me/me.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { OrdersService } from '../../modules/orders/orders.service';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PaymentsService } from '../../modules/payments/payments.service';
import { ManualProvider } from '../../modules/payments/providers/manual.provider';
import { PaymentProviderFactory } from '../../modules/payments/providers/payment-provider.factory';
import { PricingModule } from '../../modules/pricing/pricing.module';
import { PricingService } from '../../modules/pricing/pricing.service';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { SubscriptionsService } from '../../modules/subscriptions/services/subscriptions.service';
import { SubscriptionsModule } from '../../modules/subscriptions/subscriptions.module';
import { CookieJar } from '../auth/cookie-jar';
import { deleteMailLogsWithPreviews, requireSeedAdmin } from '../auth/f6-harness';
import { REPO_ROOT, requireDatabaseUrl } from '../helpers/env';

process.env.DISABLE_MAIL = 'true';

export const RUN = Date.now().toString(36);
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean;
}

export type JsonBody = Record<string, unknown> & { error?: string; statusCode?: number; message?: string | string[] };

export async function bodyOf<T = JsonBody>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface TestProduct {
  id: string;
  slug: string;
  name: string;
  unit: string;
  price: number;
  vatRate: number;
  prefOptions: string[];
  extraOptions: unknown;
}

export interface CheckoutFixtureUser {
  userId: string;
  email: string;
  password: string;
  addressId: string;
  jar: CookieJar;
}

export interface CheckoutApp {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
  settings: SettingsService;
  checkout: CheckoutService;
  completion: CheckoutCompletionService;
  coupons: CouponsService;
  orders: OrdersService;
  payments: PaymentsService;
  pricing: PricingService;
  subscriptions: SubscriptionsService;
  manual: ManualProvider;
  providers: PaymentProviderFactory;
  /** Test tier (600 TL, 3 ürün) + bölge (kargo 49, eşik 1000, kapasite 50). */
  tierId: string;
  tierSlug: string;
  tierPrice: number;
  zoneId: string;
  zoneSlug: string;
  zoneFee: number;
  /** Açık (bugün+10), dolu (bugün+12, kapasite 0), kesimi geçmiş (bugün) teslimat tarihleri. */
  openDate: { id: string; iso: IsoDate; day: 'SALI' };
  fullDate: { id: string; iso: IsoDate };
  lockedDate: { id: string; iso: IsoDate };
  /** Seed ürünleri: fresh havuzu (şablon/kutu) + ekstra/tekil için ürünler (salt okunur). */
  fresh: TestProduct[];
  single: TestProduct[];
  call(method: Method, path: string, opts?: CallOptions): Promise<Response>;
  login(jar: CookieJar, email: string, password: string): Promise<Response>;
  loginSeedAdmin(jar: CookieJar): Promise<string>;
  /** Geçici müşteri + adres (test bölgesinde) + giriş yapılmış kavanoz. */
  createCustomer(tag?: string): Promise<CheckoutFixtureUser>;
  /** Quote'tan zorunlu onayları checkout gövdesi biçimine çevirir. */
  consentsFor(required: Array<{ kind: string; documentSlug: string; version: number }>): Array<{ kind: string; documentSlug: string; version: number }>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
}

export async function createCheckoutApp(): Promise<CheckoutApp> {
  requireDatabaseUrl();
  const moduleRef = await Test.createTestingModule({
    imports: [
      CacheModule.register({ isGlobal: true }),
      PrismaModule,
      AuthModule,
      AuditModule,
      MailModule,
      SettingsModule,
      DeliveryModule,
      PricingModule,
      PaymentsModule,
      OrdersModule,
      SubscriptionsModule,
      CouponsModule,
      CheckoutModule,
      MeModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace(/\/$/, '');
  const prisma = app.get(PrismaService);
  const settings = app.get(SettingsService);
  const providers = app.get(PaymentProviderFactory);
  const startedAt = new Date();

  // mail.order-paid şablonu (seed) — DB'de yoksa seed değerinden kur (testler sipariş onayı e-postasını doğrular; kalıcı seed satırı, silinmez)
  await ensureOrderPaidTemplate(prisma);

  // Sağlayıcı manuel (Setting satırı yoksa env/varsayılan zaten manual; varsa sonda geri alınır)
  const providerRow = await prisma.setting.findUnique({ where: { key: 'payment.provider' } });
  const hadProviderRow = providerRow !== null;
  const previousProvider = providerRow?.value ?? null;
  if ((await providers.resolveName()) !== 'manual') await settings.set('payment', { provider: 'manual' });

  // Seed ürünleri (salt okunur)
  const toP = (r: { id: string; slug: string; name: string; unit: string; price: { toString(): string }; vatRate: number; prefOptions: string[]; extraOptions: unknown }): TestProduct => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    unit: r.unit,
    price: Number(r.price.toString()),
    vatRate: r.vatRate,
    prefOptions: r.prefOptions,
    extraOptions: r.extraOptions,
  });
  const select = { id: true, slug: true, name: true, unit: true, price: true, vatRate: true, prefOptions: true, extraOptions: true } as const;
  const freshRows = await prisma.product.findMany({ where: { isFresh: true, status: 'ACTIVE', stockStatus: { in: ['IN_STOCK', 'LOW'] }, deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 6, select });
  if (freshRows.length < 3) throw new Error(`Seed'de en az 3 fresh ürün gerekli (bulunan ${freshRows.length}) — pnpm db:seed`);
  const singleRows = await prisma.product.findMany({ where: { isFresh: false, status: 'ACTIVE', stockStatus: { in: ['IN_STOCK', 'LOW'] }, deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 4, select });
  if (singleRows.length < 2) throw new Error('Seed’de en az 2 fresh olmayan aktif ürün gerekli');

  // Test tier + bölge + tarihler
  const tierPrice = 600;
  const tier = await prisma.boxTier.create({ data: { slug: `t-chk-${RUN}`, label: `Checkout Kutu ${RUN}`, itemCount: 3, price: tierPrice, isActive: true, sortOrder: 98 } });
  const zoneFee = 49;
  const zone = await prisma.deliveryZone.create({ data: { slug: `z-chk-${RUN}`, name: `Checkout Bölge ${RUN}`, fee: zoneFee, freeThreshold: 1000, capacityPerDay: 50, isActive: true, sortOrder: 98 } });
  const today = calendarDateIn(startedAt, DEFAULT_TZ);
  const mkDate = async (offset: number, capacity: number) => {
    const iso = addCalendarDays(today, offset) as IsoDate;
    const row = await prisma.deliveryDate.create({ data: { zoneId: zone.id, day: 'SALI', date: isoDateToUtc(iso), cutoffAt: computeCutoffAt(iso), capacity, reserved: 0, status: 'OPEN' } });
    return { id: row.id, iso };
  };
  const open = await mkDate(10, 50);
  const full = await mkDate(12, 0);
  const locked = await mkDate(0, 50);
  // cycle#1 haftası için yayınlanmış şablon (kutu içeriği verilmezse buradan)
  const weekStart = weekMonday(open.iso);
  await prisma.boxTemplate.create({
    data: { tierId: tier.id, weekStart: isoDateToUtc(weekStart), status: 'PUBLISHED', curatorName: 'Test', items: { create: freshRows.slice(0, 3).map((p, i) => ({ productId: p.id, qtyLabel: `1 ${p.unit}`, sortOrder: i, isSwappable: true })) } },
  });

  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];

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
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
    opts.jar?.absorb(res);
    return res;
  };
  const login = async (jar: CookieJar, email: string, password: string): Promise<Response> => {
    await call('GET', '/api/v1/auth/csrf', { jar });
    return call('POST', '/api/v1/auth/login', { jar, body: { email, password } });
  };

  const createCustomer = async (tag = 'c'): Promise<CheckoutFixtureUser> => {
    const password = 'Checkout-1234!';
    const email = `chk-${RUN}-${tag}-${createdUserIds.length}@test.local`;
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 4), name: 'Checkout Test', phone: '+905551112233', role: 'CUSTOMER', isActive: true }, select: { id: true } });
    createdUserIds.push(user.id);
    createdEmails.push(email);
    const address = await prisma.address.create({ data: { userId: user.id, fullName: 'Checkout Test', phone: '+905551112233', line: 'Test Mah. 1. Sk. No:1', zoneId: zone.id, zip: '35430', isDefault: true } });
    const jar = new CookieJar();
    const res = await login(jar, email, password);
    if (res.status !== 200) throw new Error(`test müşterisi giriş yapamadı: ${res.status}`);
    return { userId: user.id, email, password, addressId: address.id, jar };
  };

  const cleanup = async (): Promise<void> => {
    const userIds = [...createdUserIds];
    if (userIds.length > 0) {
      const subs = await prisma.subscription.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const subIds = subs.map((s) => s.id);
      const orders = await prisma.order.findMany({ where: { OR: [{ userId: { in: userIds } }, { subscriptionId: { in: subIds } }, { zoneId: zone.id }] }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      await deleteMailLogsWithPreviews(prisma, { OR: [{ entityId: { in: orderIds } }, { to: { in: createdEmails } }] });
      await prisma.consent.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }] } });
      await prisma.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.subscriptionCycle.deleteMany({ where: { subscriptionId: { in: subIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.subscription.deleteMany({ where: { id: { in: subIds } } });
      await prisma.paymentMethod.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...subIds, ...userIds, ...orderIds] } }], createdAt: { gte: startedAt } } });
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.webhookEvent.deleteMany({ where: { providerRef: { startsWith: `chk-${RUN}` } } });
    await prisma.systemLog.deleteMany({ where: { module: 'subscriptions', fingerprint: { startsWith: `ensure:no-template:${tier.id}` } } });
    await prisma.deliveryDate.deleteMany({ where: { zoneId: zone.id } });
    await prisma.deliveryZone.delete({ where: { id: zone.id } }).catch(() => undefined);
    await prisma.boxTemplate.deleteMany({ where: { tierId: tier.id } });
    await prisma.boxTier.delete({ where: { id: tier.id } }).catch(() => undefined);
    await prisma.cronLog.deleteMany({ where: { name: 'payments:reconcile', startedAt: { gte: startedAt } } });
    if (!hadProviderRow) {
      await prisma.setting.deleteMany({ where: { key: 'payment.provider' } });
    } else if (previousProvider !== null && previousProvider !== 'manual') {
      await prisma.setting.update({ where: { key: 'payment.provider' }, data: { value: previousProvider } });
    }
    settings.invalidate('payment');
  };

  return {
    app,
    baseUrl,
    prisma,
    settings,
    checkout: app.get(CheckoutService),
    completion: app.get(CheckoutCompletionService),
    coupons: app.get(CouponsService),
    orders: app.get(OrdersService),
    payments: app.get(PaymentsService),
    pricing: app.get(PricingService),
    subscriptions: app.get(SubscriptionsService),
    manual: app.get(ManualProvider),
    providers,
    tierId: tier.id,
    tierSlug: tier.slug,
    tierPrice,
    zoneId: zone.id,
    zoneSlug: zone.slug,
    zoneFee,
    openDate: { id: open.id, iso: open.iso, day: 'SALI' },
    fullDate: full,
    lockedDate: locked,
    fresh: freshRows.map(toP),
    single: singleRows.map(toP),
    call,
    login,
    async loginSeedAdmin(jar) {
      const admin = requireSeedAdmin();
      const res = await login(jar, admin.email, admin.password);
      if (res.status !== 200) throw new Error(`seed admin girişi başarısız: ${res.status}`);
      return ((await res.json()) as { user: { id: string } }).user.id;
    },
    createCustomer,
    consentsFor: (required) => required.map((r) => ({ kind: r.kind, documentSlug: r.documentSlug, version: r.version })),
    cleanup,
    async close() {
      await app.close();
    },
  };
}

/** `mail.order-paid` SiteContent satırı yoksa seed dosyasından (registry şemasıyla) oluşturur. */
async function ensureOrderPaidTemplate(prisma: PrismaService): Promise<void> {
  const key = 'mail.order-paid';
  if (await prisma.siteContent.findUnique({ where: { key } })) return;
  const seed = JSON.parse(readFileSync(resolve(REPO_ROOT, 'database', 'seeds', 'content', 'site-content.json'), 'utf8')) as { values: Record<string, unknown> };
  const entry = getSiteContentRegistryEntry(key);
  const value = seed.values[key];
  if (!entry || !value) throw new Error('mail.order-paid seed/registry girdisi yok');
  await prisma.siteContent.create({ data: { key, label: entry.label, schema: entry.schema as unknown as Prisma.InputJsonObject, value: value as Prisma.InputJsonObject, updatedBy: null } });
}

/** Takvim gününün haftasının Pazartesi'si (TZ'siz). */
export function weekMonday(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10) as IsoDate;
}
