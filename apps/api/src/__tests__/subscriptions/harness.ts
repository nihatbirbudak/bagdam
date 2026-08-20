// F7 abonelik motoru test iskeleti — gerçek Nest uygulaması (rastgele port), gerçek DB (bagdam_dev), kendi verisini
// oluşturur ve sonda siler. Zaman: servislere `now` parametre olarak verilir (UTC anları; süreç TZ'sinden bağımsız —
// TZ=UTC ve Europe/Istanbul'da aynı sonuç). Deps: gerçek SubscriptionsDepsAdapter (PricingService · DeliveryDatesService · OrdersService ·
// MerchantInitiatedCharge/PaymentLinkCharge → ManualProvider: kart token'ı `fail:` → FAILED; `manual.setOutcome(fn)`).
// Ayarlar: `overrideCommerce()` SettingsService.getCommerce'i spy'lar (DB'deki Setting DEĞİŞMEZ).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { COMMERCE_SETTINGS_DEFAULTS, computeCutoffAt, isoDateToUtc, type CommerceSettings, type DeliveryDay, type IsoDate } from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
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
import { DeliveryModule } from '../../modules/delivery/delivery.module';
import { JobsModule } from '../../modules/jobs/jobs.module';
import { JobsService } from '../../modules/jobs/jobs.service';
import { MailModule } from '../../modules/mail/mail.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { CancellationService } from '../../modules/subscriptions/services/cancellation.service';
import { CyclesService } from '../../modules/subscriptions/services/cycles.service';
import { SubscriptionsService } from '../../modules/subscriptions/services/subscriptions.service';
import { ManualProvider } from '../../modules/payments/providers/manual.provider';
import { SubscriptionNotifier } from '../../modules/subscriptions/subscription-notifier';
import { SUBSCRIPTIONS_DEPS, type SubscriptionsDeps } from '../../modules/subscriptions/subscriptions.deps';
import { weekStartOf } from '../../modules/subscriptions/subscriptions.constants';
import { SubscriptionsModule } from '../../modules/subscriptions/subscriptions.module';
import { SubscriptionsRepository } from '../../modules/subscriptions/subscriptions.repository';
import { CookieJar } from '../auth/cookie-jar';
import { requireDatabaseUrl } from '../helpers/env';

process.env.DISABLE_MAIL = 'true';

export const RUN = Date.now().toString(36);

/** Sabit takvim: 2027-03-01 Pazartesi 10:00 Europe/Istanbul (07:00Z). Salı teslimat → 2027-03-02 (kesim 03-01 09:00Z). */
export const BASE_MONDAY: IsoDate = '2027-03-01';
export const BASE_NOW = new Date('2027-03-01T07:00:00.000Z');
export const T = (iso: string): Date => new Date(iso);
/** `date` gününün Europe/Istanbul `HH:mm` anı (kalıcı +03). */
export const at = (date: IsoDate, hhmm: string): Date => new Date(`${date}T${hhmm}:00+03:00`);

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean;
}

export interface TestProducts {
  /** Şablon havuzu (fresh, ACTIVE, stokta). */
  fresh: Array<{ id: string; slug: string; unit: string; price: number; extraOptions: unknown }>;
  /** Ekstra/sepet için ürün (ACTIVE, stokta). */
  extra: { id: string; slug: string; unit: string; price: number; extraOptions: unknown };
}

export interface FixtureOptions {
  isOneTime?: boolean;
  frequencyWeeks?: number;
  deliveryDay?: DeliveryDay;
  chargeStrategy?: 'MERCHANT_INITIATED' | 'PAYMENT_LINK';
  /** `null` → kart yok; `fail:` öneki → ManualProvider FAILED. */
  cardToken?: string | null;
  /** Kaç hafta şablon yayınlansın (ilk teslimat haftasından itibaren). */
  templateWeeks?: number;
  /** İlk teslimat günü (ISO); varsayılan BASE haftasındaki deliveryDay. */
  firstDeliveryOn?: IsoDate;
  /** Checkout'ta peşin ödenen tutar; varsayılan: tier fiyatı − ilk kutu indirimi (abonelik) / fiyat + kargo (tek seferlik). */
  prepaidAmount?: number;
  /** Şimdi (createFromCheckout/activate için). */
  now?: Date;
  itemPrefs?: Record<string, string>;
  /** Ayrı bölge (kapasite) — verilmezse ortak test bölgesi. */
  zoneId?: string;
  /** Aktifleştirme yapılmasın (PENDING kalsın). */
  skipActivate?: boolean;
  email?: string;
}

export interface Fixture {
  userId: string;
  email: string;
  password: string;
  addressId: string;
  paymentMethodId: string | null;
  subscriptionId: string;
  firstCycleId: string;
  orderId: string;
  tierId: string;
  zoneId: string;
}

export interface SubsApp {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
  repo: SubscriptionsRepository;
  subscriptions: SubscriptionsService;
  cycles: CyclesService;
  cancellation: CancellationService;
  jobs: JobsService;
  /** Gerçek deps adapter'ı (SUBSCRIPTIONS_DEPS). */
  deps: SubscriptionsDeps;
  /** ManualProvider test kancası (setOutcome / resetOutcome). */
  manual: ManualProvider;
  notifier: SubscriptionNotifier;
  settings: SettingsService;
  products: TestProducts;
  tierId: string;
  tierPrice: number;
  zoneId: string;
  zoneSlug: string;
  call(method: Method, path: string, opts?: CallOptions): Promise<Response>;
  login(jar: CookieJar, email: string, password: string): Promise<Response>;
  loginSeedAdmin(jar: CookieJar): Promise<string>;
  /** Ayarları geçici olarak ez (DB değişmez); `restore()` döner. */
  overrideCommerce(patch: Partial<CommerceSettings>): () => void;
  createZone(slug: string, capacity: number): Promise<string>;
  publishTemplates(tierId: string, weekStarts: IsoDate[]): Promise<void>;
  createFixture(opts?: FixtureOptions): Promise<Fixture>;
  /** Bir cycle'ın güncel hâli (DB'den). */
  cycle(id: string): Promise<NonNullable<Awaited<ReturnType<SubscriptionsRepository['findCycleById']>>>>;
  cyclesOf(subscriptionId: string): Promise<Awaited<ReturnType<SubscriptionsRepository['findCyclesOfSubscription']>>>;
  sub(id: string): Promise<NonNullable<Awaited<ReturnType<SubscriptionsRepository['findSubscriptionById']>>>>;
  events(subscriptionId: string): Promise<Array<{ type: string; cycleId: string | null; data: unknown }>>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
}

export async function createSubsApp(): Promise<SubsApp> {
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
      SubscriptionsModule,
      JobsModule,
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
  const repo = app.get(SubscriptionsRepository);
  const settings = app.get(SettingsService);
  const deps = app.get<SubscriptionsDeps>(SUBSCRIPTIONS_DEPS);
  const manual = app.get(ManualProvider);

  // ── Katalog: ürünler (salt okunur seed) ──────────────────────────────────────
  const freshRows = await prisma.product.findMany({
    where: { isFresh: true, status: 'ACTIVE', stockStatus: { in: ['IN_STOCK', 'LOW'] }, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    take: 6,
    select: { id: true, slug: true, unit: true, price: true, extraOptions: true },
  });
  if (freshRows.length < 4) throw new Error(`Seed'de en az 4 fresh ürün gerekli (bulunan ${freshRows.length}) — pnpm db:seed`);
  const extraRow = await prisma.product.findFirst({
    where: { status: 'ACTIVE', stockStatus: { in: ['IN_STOCK', 'LOW'] }, deletedAt: null, isFresh: false },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, slug: true, unit: true, price: true, extraOptions: true },
  });
  if (!extraRow) throw new Error('Seed’de fresh olmayan aktif ürün yok');
  const toP = (r: (typeof freshRows)[number]) => ({ id: r.id, slug: r.slug, unit: r.unit, price: Number(r.price.toString()), extraOptions: r.extraOptions });
  const products: TestProducts = { fresh: freshRows.map(toP), extra: toP(extraRow) };

  // ── Test tier + bölge ────────────────────────────────────────────────────────
  const tierPrice = 600;
  const tier = await prisma.boxTier.create({ data: { slug: `t-sub-${RUN}`, label: `Test Kutu ${RUN}`, itemCount: 3, price: tierPrice, isActive: true, sortOrder: 99 } });
  const zoneSlug = `z-sub-${RUN}`;
  const zone = await prisma.deliveryZone.create({ data: { slug: zoneSlug, name: `Test Bölge ${RUN}`, fee: 49, freeThreshold: 1000, capacityPerDay: 999, isActive: true, sortOrder: 99 } });

  const createdUserIds: string[] = [];
  const createdZoneIds: string[] = [zone.id];
  const createdTierIds: string[] = [tier.id];
  const startedAt = new Date();

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

  const publishTemplates = async (tierId: string, weekStarts: IsoDate[]): Promise<void> => {
    for (const ws of weekStarts) {
      const weekStart = isoDateToUtc(ws);
      const existing = await prisma.boxTemplate.findUnique({ where: { tierId_weekStart: { tierId, weekStart } } });
      if (existing) {
        await prisma.boxTemplate.update({ where: { id: existing.id }, data: { status: 'PUBLISHED' } });
        continue;
      }
      await prisma.boxTemplate.create({
        data: {
          tierId,
          weekStart,
          status: 'PUBLISHED',
          curatorName: 'Test Küratör',
          items: { create: products.fresh.slice(0, 3).map((p, i) => ({ productId: p.id, qtyLabel: `1 ${p.unit}`, sortOrder: i, isSwappable: true })) },
        },
      });
    }
  };

  const createZone = async (slug: string, capacity: number): Promise<string> => {
    const z = await prisma.deliveryZone.create({ data: { slug, name: slug, fee: 49, freeThreshold: 1000, capacityPerDay: capacity, isActive: true, sortOrder: 99 } });
    createdZoneIds.push(z.id);
    return z.id;
  };

  const createFixture = async (opts: FixtureOptions = {}): Promise<Fixture> => {
    const now = opts.now ?? BASE_NOW;
    const deliveryDay: DeliveryDay = opts.deliveryDay ?? 'SALI';
    const zoneId = opts.zoneId ?? zone.id;
    const isOneTime = opts.isOneTime ?? false;
    const dow = { SALI: 1, PERSEMBE: 3, CUMARTESI: 5 }[deliveryDay];
    const firstDeliveryOn: IsoDate = opts.firstDeliveryOn ?? addDays(BASE_MONDAY, dow);
    const templateWeeks = opts.templateWeeks ?? 12;
    const firstWeek = weekStartOf(firstDeliveryOn);
    await publishTemplates(tier.id, Array.from({ length: templateWeeks }, (_, i) => addDays(firstWeek, i * 7)));

    const password = 'Test-1234!';
    const email = opts.email ?? `sub-${RUN}-${createdUserIds.length}@test.local`;
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 4), name: 'Test Abone', role: 'CUSTOMER', isActive: true }, select: { id: true } });
    createdUserIds.push(user.id);
    const address = await prisma.address.create({ data: { userId: user.id, fullName: 'Test Abone', phone: '+905551112233', line: 'Test Mah. 1', zoneId, isDefault: true } });
    let paymentMethodId: string | null = null;
    const cardToken = opts.cardToken === undefined ? `ok:${RUN}` : opts.cardToken;
    if (cardToken !== null) {
      const pm = await prisma.paymentMethod.create({ data: { userId: user.id, provider: 'MANUAL', providerCustomerKey: `cus_${RUN}`, providerCardToken: cardToken, last4: '0001', brand: 'TEST', isDefault: true, isActive: true } });
      paymentMethodId = pm.id;
    }
    const dd = await deps.deliveryDates.findOrCreateFor(zoneId, firstDeliveryOn);
    await deps.deliveryDates.reserve(dd.id);
    const prepaidAmount = opts.prepaidAmount ?? (isOneTime ? tierPrice + 49 : tierPrice / 2);
    const order = await prisma.order.create({
      data: {
        kind: isOneTime ? 'BOX_ONE_TIME' : 'SUBSCRIPTION',
        status: 'PAID',
        paidAt: now,
        userId: user.id,
        customerName: 'Test Abone',
        customerEmail: email,
        customerPhone: '+905551112233',
        zoneId,
        deliveryDateId: dd.id,
        deliveryDay,
        deliveryOn: dd.date,
        addressSnapshot: { fullName: 'Test Abone', phone: '+905551112233', line: 'Test Mah. 1', zoneId, zoneName: 'Test', zip: null },
        subtotal: tierPrice,
        discountTotal: isOneTime ? 0 : tierPrice / 2,
        shippingFee: isOneTime ? 49 : 0,
        vatTotal: 0,
        grandTotal: prepaidAmount,
      },
    });
    const subsService = app.get(SubscriptionsService);
    const { subscription, cycle } = await subsService.createFromCheckout(
      { id: user.id },
      {
        tierSlug: tier.slug,
        frequencyWeeks: opts.frequencyWeeks ?? 1,
        deliveryDay,
        zoneId,
        addressId: address.id,
        paymentMethodId,
        isOneTime,
        itemPrefs: opts.itemPrefs ?? {},
        chargeStrategy: opts.chargeStrategy ?? 'MERCHANT_INITIATED',
        deliveryDateId: dd.id,
        orderId: order.id,
        prepaidAmount,
        now,
      },
    );
    await prisma.order.update({ where: { id: order.id }, data: { subscriptionId: subscription.id } });
    if (!opts.skipActivate) await subsService.activate(subscription.id, { now });
    return { userId: user.id, email, password, addressId: address.id, paymentMethodId, subscriptionId: subscription.id, firstCycleId: cycle.id, orderId: order.id, tierId: tier.id, zoneId };
  };

  const originalGetCommerce = settings.getCommerce.bind(settings);
  const overrideCommerce = (patch: Partial<CommerceSettings>): (() => void) => {
    const spy = jest.spyOn(settings, 'getCommerce').mockImplementation(async () => ({ ...COMMERCE_SETTINGS_DEFAULTS, ...(await originalGetCommerce()), ...patch }));
    return () => spy.mockRestore();
  };

  const cleanup = async (): Promise<void> => {
    const userIds = [...createdUserIds];
    if (userIds.length > 0) {
      const subs = await prisma.subscription.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const subIds = subs.map((s) => s.id);
      const orders = await prisma.order.findMany({ where: { OR: [{ userId: { in: userIds } }, { subscriptionId: { in: subIds } }] }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.subscriptionCycle.deleteMany({ where: { subscriptionId: { in: subIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.subscription.deleteMany({ where: { id: { in: subIds } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...subIds, ...userIds] } }], createdAt: { gte: startedAt } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.cronLog.deleteMany({ where: { startedAt: { gte: new Date('2027-01-01T00:00:00Z'), lt: new Date('2028-01-01T00:00:00Z') } } });
    const dds = await prisma.deliveryDate.findMany({ where: { zoneId: { in: createdZoneIds } }, select: { id: true } });
    await prisma.systemLog.deleteMany({
      where: {
        module: 'subscriptions',
        OR: [...createdTierIds.map((t) => ({ fingerprint: { startsWith: `ensure:no-template:${t}` } })), { fingerprint: { in: dds.map((d) => `ensure:day-full:${d.id}`) } }],
      },
    });
    await prisma.deliveryDate.deleteMany({ where: { zoneId: { in: createdZoneIds } } });
    await prisma.deliveryZone.deleteMany({ where: { id: { in: createdZoneIds } } });
    await prisma.boxTemplate.deleteMany({ where: { tierId: { in: createdTierIds } } });
    await prisma.boxTier.deleteMany({ where: { id: { in: createdTierIds } } });
  };

  return {
    app,
    baseUrl,
    prisma,
    repo,
    subscriptions: app.get(SubscriptionsService),
    cycles: app.get(CyclesService),
    cancellation: app.get(CancellationService),
    jobs: app.get(JobsService),
    deps,
    manual,
    notifier: app.get(SubscriptionNotifier),
    settings,
    products,
    tierId: tier.id,
    tierPrice,
    zoneId: zone.id,
    zoneSlug,
    call,
    login,
    async loginSeedAdmin(jar) {
      const email = process.env.SEED_ADMIN_EMAIL?.trim();
      const password = process.env.SEED_ADMIN_PASSWORD;
      if (!email || !password) throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil (apps/api/.env)');
      const res = await login(jar, email, password);
      if (res.status !== 200) throw new Error(`seed admin girişi başarısız: ${res.status}`);
      return ((await res.json()) as { user: { id: string } }).user.id;
    },
    overrideCommerce,
    createZone,
    publishTemplates,
    createFixture,
    async cycle(id) {
      const c = await repo.findCycleById(id);
      if (!c) throw new Error(`cycle yok: ${id}`);
      return c;
    },
    cyclesOf: (subscriptionId) => repo.findCyclesOfSubscription(subscriptionId),
    async sub(id) {
      const s = await repo.findSubscriptionById(id);
      if (!s) throw new Error(`sub yok: ${id}`);
      return s;
    },
    async events(subscriptionId) {
      const rows = await prisma.subscriptionEvent.findMany({ where: { subscriptionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return rows.map((r) => ({ type: r.type, cycleId: r.cycleId, data: r.data }));
    },
    cleanup,
    async close() {
      await app.close();
    },
  };
}

/** Takvim günü + gün (TZ'siz). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Teslimat gününün kesim anı (varsayılan kural: 1 gün önce 12:00 Europe/Istanbul). */
export function cutoffOf(deliveryOn: IsoDate): Date {
  return computeCutoffAt(deliveryOn);
}

/** Kesimden `ms` sonrası. */
export function afterCutoff(deliveryOn: IsoDate, ms = 60_000): Date {
  return new Date(cutoffOf(deliveryOn).getTime() + ms);
}

export function beforeCutoff(deliveryOn: IsoDate, ms = 60_000): Date {
  return new Date(cutoffOf(deliveryOn).getTime() - ms);
}

export type JsonBody = Record<string, unknown> & { error?: string; statusCode?: number };

export async function bodyOf<T = JsonBody>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type PrismaClientLike = Prisma.TransactionClient;
