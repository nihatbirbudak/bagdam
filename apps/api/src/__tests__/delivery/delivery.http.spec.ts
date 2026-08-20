// F5 — Delivery uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK. Kapsam: public zones/dates şekli + bootstrap deliveryDates ile parite ·
// admin zone CRUD (slug 409, isActive, bootstrap cache düşer) · dates generate idempotent · admin dates liste/patch.
// Test verisi: `test-zone-<run>` bölgesi + tarihleri; sonda silinir. Seed bölgeleri (urla/cesme) DEĞİŞTİRİLMEZ.
import '../helpers/env';
import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DELIVERY_DAY_SLUG_VALUES,
  DEFAULT_TZ,
  DeliveryDay,
  calendarDateIn,
  nextDeliveryDates,
  type DeliveryDate,
  type DeliveryDateAdmin,
  type DeliveryDatesGenerateResult,
  type DeliveryZone,
  type DeliveryZonePublic,
} from '@bagdam/shared';
import type { Cache } from 'cache-manager';
import cookieParser from 'cookie-parser';
import { CACHE_KEYS } from '../../common/cache-keys';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CatalogService } from '../../modules/catalog/catalog.service';
import { DeliveryModule } from '../../modules/delivery/delivery.module';
import { DeliveryService } from '../../modules/delivery/delivery.service';
import { SettingsModule } from '../../modules/settings/settings.module';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const ZONE_SLUG = `test-zone-${RUN}`;
const ALL_DAYS = Object.values(DeliveryDay);

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Delivery HTTP — /api/v1/delivery/* + /api/v1/admin/delivery/*', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cache: Cache;
  let catalog: CatalogService;
  let delivery: DeliveryService;
  let baseUrl: string;
  let zone: DeliveryZone;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, body: json, headers: res.headers };
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, SettingsModule, CatalogModule, DeliveryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    cache = app.get<Cache>(CACHE_MANAGER);
    catalog = app.get(CatalogService);
    delivery = app.get(DeliveryService);
  });

  afterAll(async () => {
    try {
      const z = await prisma.deliveryZone.findUnique({ where: { slug: ZONE_SLUG } });
      if (z) {
        await prisma.deliveryDate.deleteMany({ where: { zoneId: z.id } });
        await prisma.deliveryZone.delete({ where: { id: z.id } });
      }
      await cache.del(CACHE_KEYS.bootstrapAnonymous);
    } finally {
      await app?.close();
    }
  });

  // ── Public ─────────────────────────────────────────────────────────────────

  it('GET /delivery/zones → aktif bölgeler {id,slug,name,fee,freeThreshold} (urla fee/eşik sayısal; kapasite gitmez)', async () => {
    const res = await api('GET', '/delivery/zones');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const zones = res.body as DeliveryZonePublic[];
    const urla = zones.find((z) => z.slug === 'urla');
    expect(urla).toBeDefined();
    expect(typeof urla!.fee).toBe('number');
    expect(urla!.freeThreshold === null || typeof urla!.freeThreshold === 'number').toBe(true);
    expect(Object.keys(urla!).sort()).toEqual(['fee', 'freeThreshold', 'id', 'name', 'slug']);
  });

  it('GET /delivery/dates (varsayılan urla, 4 hafta) → [{day,date,cutoffAtIso,locked,full}] sıralı; bootstrap deliveryDates ile BİREBİR', async () => {
    const res = await api('GET', '/delivery/dates');
    expect(res.status).toBe(200);
    const dates = res.body as DeliveryDate[];
    expect(Array.isArray(dates)).toBe(true);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(12);
    const today = calendarDateIn(new Date(), DEFAULT_TZ);
    for (const d of dates) {
      expect(DELIVERY_DAY_SLUG_VALUES).toContain(d.day);
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.date >= today).toBe(true);
      expect(Number.isNaN(Date.parse(d.cutoffAtIso))).toBe(false);
      expect(typeof d.locked).toBe('boolean');
      expect(typeof d.full).toBe('boolean');
      expect(Object.keys(d).sort()).toEqual(['cutoffAtIso', 'date', 'day', 'full', 'locked']);
    }
    expect([...dates.map((d) => d.date)].sort()).toEqual(dates.map((d) => d.date));

    const explicit = await api('GET', '/delivery/dates?zone=urla&weeks=4');
    expect(explicit.body).toEqual(dates);

    // Aynı kaynak: CatalogService.buildBootstrap(now).deliveryDates ≡ DeliveryService.getDates('urla', 4, now)
    const now = new Date();
    const [bootstrap, viaDelivery] = await Promise.all([catalog.buildBootstrap(now), delivery.getDates('urla', 4, now)]);
    expect(viaDelivery).toEqual(bootstrap.deliveryDates);
  });

  it('GET /delivery/dates?zone=yok → 404 · weeks=0 / weeks=13 → 400', async () => {
    expect((await api('GET', `/delivery/dates?zone=yok-${RUN}`)).status).toBe(404);
    expect((await api('GET', '/delivery/dates?weeks=0')).status).toBe(400);
    expect((await api('GET', '/delivery/dates?weeks=13')).status).toBe(400);
  });

  // ── Admin: bölgeler ────────────────────────────────────────────────────────

  it('POST /admin/delivery/zones → 201 DeliveryZone; aynı slug 409; geçersiz gövde 400; bootstrap cache düşer', async () => {
    await cache.set(CACHE_KEYS.bootstrapAnonymous, { marker: true }, 60_000);
    const res = await api('POST', '/admin/delivery/zones', {
      name: 'Test Bölge',
      slug: ZONE_SLUG,
      fee: 59.5,
      freeThreshold: 1500,
      capacityPerDay: 5,
      sortOrder: 900,
    });
    expect(res.status).toBe(201);
    zone = res.body as DeliveryZone;
    expect(zone).toMatchObject({ name: 'Test Bölge', slug: ZONE_SLUG, fee: 59.5, freeThreshold: 1500, capacityPerDay: 5, isActive: true, sortOrder: 900 });
    expect(typeof zone.id).toBe('string');
    expect(await cache.get(CACHE_KEYS.bootstrapAnonymous)).toBeUndefined();

    const dup = await api('POST', '/admin/delivery/zones', { name: 'Kopya', slug: ZONE_SLUG, fee: 1 });
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).message).toMatch(/slug/i);

    expect((await api('POST', '/admin/delivery/zones', { name: 'x', slug: 'Büyük Harf', fee: 1 })).status).toBe(400);
    expect((await api('POST', '/admin/delivery/zones', { name: 'x', slug: 'test-neg', fee: -1 })).status).toBe(400);
    expect((await api('POST', '/admin/delivery/zones', { name: 'x', slug: 'test-extra', fee: 1, foo: 1 })).status).toBe(400);
  });

  it('GET /admin/delivery/zones listeler; PUT günceller (fee, eşik null); PATCH active=false → public listede yok, admin’de var', async () => {
    const list = await api('GET', '/admin/delivery/zones');
    expect(list.status).toBe(200);
    expect((list.body as DeliveryZone[]).some((z) => z.id === zone.id)).toBe(true);

    const one = await api('GET', `/admin/delivery/zones/${zone.id}`);
    expect(one.status).toBe(200);
    expect((one.body as DeliveryZone).slug).toBe(ZONE_SLUG);

    const put = await api('PUT', `/admin/delivery/zones/${zone.id}`, { fee: 61, freeThreshold: null, name: 'Test Bölge 2' });
    expect(put.status).toBe(200);
    expect(put.body as DeliveryZone).toMatchObject({ fee: 61, freeThreshold: null, name: 'Test Bölge 2', capacityPerDay: 5 });
    expect((await api('PUT', `/admin/delivery/zones/${zone.id}`, {})).status).toBe(400);
    expect((await api('PUT', `/admin/delivery/zones/${zone.id}`, { slug: 'urla' })).status).toBe(409);
    expect((await api('PUT', '/admin/delivery/zones/ckolmayan0000000000000000', { fee: 1 })).status).toBe(404);

    await cache.set(CACHE_KEYS.bootstrapAnonymous, { marker: true }, 60_000);
    const off = await api('PATCH', `/admin/delivery/zones/${zone.id}/active`, { isActive: false });
    expect(off.status).toBe(200);
    expect((off.body as DeliveryZone).isActive).toBe(false);
    expect(await cache.get(CACHE_KEYS.bootstrapAnonymous)).toBeUndefined();
    const pub = (await api('GET', '/delivery/zones')).body as DeliveryZonePublic[];
    expect(pub.some((z) => z.slug === ZONE_SLUG)).toBe(false);
    expect((await api('GET', `/delivery/dates?zone=${ZONE_SLUG}`)).status).toBe(404);
    const adm = (await api('GET', '/admin/delivery/zones')).body as DeliveryZone[];
    expect(adm.find((z) => z.id === zone.id)?.isActive).toBe(false);

    const on = await api('PATCH', `/admin/delivery/zones/${zone.id}/active`, { isActive: true });
    expect((on.body as DeliveryZone).isActive).toBe(true);
    expect(((await api('GET', '/delivery/zones')).body as DeliveryZonePublic[]).some((z) => z.slug === ZONE_SLUG)).toBe(true);
  });

  // ── Admin: tarihler ────────────────────────────────────────────────────────

  it('POST /admin/delivery/dates/generate {weeks:2} → test bölgesi için 3 gün × 2 hafta tarih; ikinci koşu created=0 (idempotent)', async () => {
    const expectedSlots = nextDeliveryDates(new Date(), ALL_DAYS, 2, { tz: DEFAULT_TZ, includeLocked: true });
    expect(expectedSlots.length).toBe(6);

    await cache.set(CACHE_KEYS.bootstrapAnonymous, { marker: true }, 60_000);
    const first = await api('POST', '/admin/delivery/dates/generate', { weeks: 2 });
    expect(first.status).toBe(200);
    const r1 = first.body as DeliveryDatesGenerateResult;
    expect(r1.weeks).toBe(2);
    expect(r1.zones).toBeGreaterThanOrEqual(1);
    expect(r1.created).toBeGreaterThanOrEqual(expectedSlots.length);
    expect(r1.from).toBe(expectedSlots[0]!.date);
    expect(r1.to).toBe(expectedSlots[expectedSlots.length - 1]!.date);
    expect(await cache.get(CACHE_KEYS.bootstrapAnonymous)).toBeUndefined();

    const rows = (await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}`)).body as DeliveryDateAdmin[];
    expect(rows.length).toBe(expectedSlots.length);
    expect(rows.map((r) => r.date)).toEqual(expectedSlots.map((s) => s.date));
    for (const [i, row] of rows.entries()) {
      expect(row).toMatchObject({ zoneId: zone.id, zoneName: 'Test Bölge 2', capacity: 5, reserved: 0, status: 'OPEN', day: expectedSlots[i]!.day });
      expect(new Date(row.cutoffAt).getTime()).toBe(expectedSlots[i]!.cutoffAt.getTime());
    }

    const second = await api('POST', '/admin/delivery/dates/generate', { weeks: 2 });
    expect(second.status).toBe(200);
    const r2 = second.body as DeliveryDatesGenerateResult;
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(0);
    expect(((await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}`)).body as DeliveryDateAdmin[]).length).toBe(expectedSlots.length);

    // Seed bölgeleri: kapasite/reserved/status dokunulmadı (yalnız day/cutoffAt tazelenebilir)
    const urla = await prisma.deliveryZone.findUniqueOrThrow({ where: { slug: 'urla' } });
    const urlaDates = await prisma.deliveryDate.findMany({ where: { zoneId: urla.id }, take: 3 });
    for (const d of urlaDates) expect(d.capacity).toBe(urla.capacityPerDay);

    expect((await api('POST', '/admin/delivery/dates/generate', { weeks: 0 })).status).toBe(400);
  });

  it('GET /delivery/dates?zone=test → public şekil; PATCH /admin/delivery/dates/:id capacity/status → full/locked; 400/404', async () => {
    const pub = (await api('GET', `/delivery/dates?zone=${ZONE_SLUG}&weeks=2`)).body as DeliveryDate[];
    expect(pub.length).toBe(6);
    expect(pub.every((d) => d.full === false)).toBe(true);

    const rows = (await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}`)).body as DeliveryDateAdmin[];
    const target = rows[rows.length - 1]!;

    const capped = await api('PATCH', `/admin/delivery/dates/${target.id}`, { capacity: 0 });
    expect(capped.status).toBe(200);
    expect((capped.body as DeliveryDateAdmin).capacity).toBe(0);
    let after = (await api('GET', `/delivery/dates?zone=${ZONE_SLUG}&weeks=2`)).body as DeliveryDate[];
    expect(after.find((d) => d.date === target.date)?.full).toBe(true);

    const closed = await api('PATCH', `/admin/delivery/dates/${target.id}`, { status: 'CLOSED' });
    expect((closed.body as DeliveryDateAdmin).status).toBe('CLOSED');
    after = (await api('GET', `/delivery/dates?zone=${ZONE_SLUG}&weeks=2`)).body as DeliveryDate[];
    expect(after.find((d) => d.date === target.date)?.locked).toBe(true);

    expect((await api('PATCH', `/admin/delivery/dates/${target.id}`, {})).status).toBe(400);
    expect((await api('PATCH', `/admin/delivery/dates/${target.id}`, { status: 'YOK' })).status).toBe(400);
    expect((await api('PATCH', '/admin/delivery/dates/ckolmayan0000000000000000', { capacity: 1 })).status).toBe(404);

    // Admin liste aralık doğrulaması
    expect((await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}&from=2026-02-30`)).status).toBe(400);
    expect((await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}&from=2026-03-10&to=2026-03-01`)).status).toBe(400);
    expect((await api('GET', `/admin/delivery/dates?zone=yok-${RUN}`)).status).toBe(404);
    const ranged = (await api('GET', `/admin/delivery/dates?zone=${ZONE_SLUG}&from=${target.date}&to=${target.date}`)).body as DeliveryDateAdmin[];
    expect(ranged.map((r) => r.id)).toEqual([target.id]);
  });
});
