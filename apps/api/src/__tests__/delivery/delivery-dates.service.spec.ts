// F7 — DeliveryDatesService (gerçek Nest modülü, gerçek DB bagdam_dev). Kapsam: findOrCreateFor (kesim anı Setting kuralıyla,
// teslimat günü değilse 400, idempotent), reserve atomik (capacity=1 bölgede paralel 2 istek → 1 başarı + 1 409 DAY_FULL),
// release, kapalı gün 409 DAY_CLOSED, bilinmeyen tarih 404, nextFor, isLocked/isFull, generate delegasyonu.
// Test verisi: `test-dd-<run>` bölgesi + tarihleri; sonda silinir. Anlar UTC (TZ'den bağımsız).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { addCalendarDays, computeCutoffAt, DEFAULT_TZ, nextDeliveryDateFor, weekdayOf, type CommerceSettings } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { DeliveryDatesService } from '../../modules/delivery/delivery-dates.service';
import { DeliveryModule } from '../../modules/delivery/delivery.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const ZONE_SLUG = `test-dd-${RUN}`;

describe('DeliveryDatesService — findOrCreateFor · reserve (atomik) · release · nextFor · isLocked', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dates: DeliveryDatesService;
  let commerce: CommerceSettings;
  let zoneId: string;

  beforeAll(async () => {
    requireDatabaseUrl();
    moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, SettingsModule, DeliveryModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    dates = moduleRef.get(DeliveryDatesService);
    commerce = await moduleRef.get(SettingsService).getCommerce();
    const zone = await prisma.deliveryZone.create({
      data: { name: 'Dates Test', slug: ZONE_SLUG, fee: new Prisma.Decimal('49'), freeThreshold: null, capacityPerDay: 1, isActive: true, sortOrder: 980 },
    });
    zoneId = zone.id;
  });

  afterAll(async () => {
    try {
      await prisma.deliveryDate.deleteMany({ where: { zoneId } });
      await prisma.deliveryZone.deleteMany({ where: { id: zoneId } });
    } finally {
      await moduleRef?.close();
    }
  });

  it('findOrCreateFor: yoksa oluşturur (day, cutoffAt = Setting kuralı, capacity = bölge, OPEN); ikinci çağrı aynı satır; Date girdisi de kabul', async () => {
    const slot = nextDeliveryDateFor('SALI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    const created = await dates.findOrCreateFor(zoneId, slot.date);
    expect(created.zoneId).toBe(zoneId);
    expect(created.day).toBe('SALI');
    expect(created.capacity).toBe(1);
    expect(created.reserved).toBe(0);
    expect(created.status).toBe('OPEN');
    expect(created.cutoffAt.getTime()).toBe(computeCutoffAt(slot.date, commerce.cutoff, DEFAULT_TZ).getTime());
    expect(created.zone.slug).toBe(ZONE_SLUG);

    const again = await dates.findOrCreateFor(zoneId, slot.date);
    expect(again.id).toBe(created.id);
    const viaDate = await dates.findOrCreateFor(zoneId, created.date);
    expect(viaDate.id).toBe(created.id);
    expect(await prisma.deliveryDate.count({ where: { zoneId } })).toBe(1);
  });

  it('findOrCreateFor: teslimat günü olmayan gün → 400 NOT_DELIVERY_DAY; takvimde olmayan gün → 400; bilinmeyen bölge → 404', async () => {
    // Bir sonraki Pazartesi (dow 1) — teslimat günü değil
    const today = nextDeliveryDateFor('SALI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff }).date;
    const monday = addCalendarDays(today, -1);
    expect(weekdayOf(monday)).toBe(1);
    await expect(dates.findOrCreateFor(zoneId, monday)).rejects.toMatchObject({ response: { error: 'NOT_DELIVERY_DAY' } });
    await expect(dates.findOrCreateFor(zoneId, '2026-02-30')).rejects.toMatchObject({ response: { error: 'INVALID_DATE' } });
    const future = addCalendarDays(today, 7 * 30); // uzak bir Salı
    await expect(dates.findOrCreateFor(`yok-${RUN}`, future)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reserve atomik: capacity=1 günde paralel 2 istek → 1 başarı + 1 409 DAY_FULL; reserved=1; release → 0; tekrar rezerv olur', async () => {
    const slot = nextDeliveryDateFor('PERSEMBE', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    const dd = await dates.findOrCreateFor(zoneId, slot.date);
    expect(dd.capacity).toBe(1);

    const results = await Promise.allSettled([dates.reserve(dd.id), dates.reserve(dd.id)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ConflictException);
    expect((failed[0]!.reason as ConflictException).getResponse()).toMatchObject({ error: 'DAY_FULL' });
    const afterReserve = await prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } });
    expect(afterReserve.reserved).toBe(1);
    expect(dates.isFull(afterReserve)).toBe(true);

    // Üçüncü deneme de dolu
    await expect(dates.reserve(dd.id)).rejects.toMatchObject({ response: { error: 'DAY_FULL' } });

    await dates.release(dd.id);
    const afterRelease = await prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } });
    expect(afterRelease.reserved).toBe(0);
    expect(dates.isFull(afterRelease)).toBe(false);

    // Eksiye düşmez
    await dates.release(dd.id);
    expect((await prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } })).reserved).toBe(0);

    const again = await dates.reserve(dd.id);
    expect(again.reserved).toBe(1);
    await dates.release(dd.id);

    // $transaction istemcisi ile de çalışır
    await prisma.$transaction(async (tx) => {
      const row = await dates.reserve(dd.id, tx);
      expect(row.reserved).toBe(1);
      await dates.release(dd.id, tx);
    });
    expect((await prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } })).reserved).toBe(0);
  });

  it('reserve: kapalı gün → 409 DAY_CLOSED (kapasite boş olsa da); bilinmeyen tarih → 404; release bilinmeyen → sessiz', async () => {
    const slot = nextDeliveryDateFor('CUMARTESI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    const dd = await dates.findOrCreateFor(zoneId, slot.date);
    await prisma.deliveryDate.update({ where: { id: dd.id }, data: { status: 'CLOSED' } });
    try {
      await expect(dates.reserve(dd.id)).rejects.toMatchObject({ response: { error: 'DAY_CLOSED' } });
      expect((await prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } })).reserved).toBe(0);
    } finally {
      await prisma.deliveryDate.update({ where: { id: dd.id }, data: { status: 'OPEN' } });
    }
    await expect(dates.reserve('ckolmayan0000000000000000')).rejects.toBeInstanceOf(NotFoundException);
    await expect(dates.release('ckolmayan0000000000000000')).resolves.toBeUndefined();
  });

  it('nextFor: after anından sonra kesimi geçmemiş ilk tarih (cart.js nextDeliveryDate kuralı); kesim geçmişse bir hafta sonrası', async () => {
    const now = new Date();
    const expected = nextDeliveryDateFor('SALI', now, { tz: DEFAULT_TZ, rule: commerce.cutoff });
    const row = await dates.nextFor(zoneId, 'SALI', now);
    expect(row.day).toBe('SALI');
    expect(row.cutoffAt.getTime()).toBe(expected.cutoffAt.getTime());
    expect(row.cutoffAt.getTime()).toBeGreaterThan(now.getTime());
    expect(dates.isLocked(row, now)).toBe(false);

    // Kesim anından 1 ms sonra sorulursa → bir sonraki hafta
    const afterCutoff = new Date(row.cutoffAt.getTime() + 1);
    const next = await dates.nextFor(zoneId, 'SALI', afterCutoff);
    expect(next.id).not.toBe(row.id);
    expect(next.cutoffAt.getTime() - row.cutoffAt.getTime()).toBe(7 * 86_400_000);
  });

  it('isLocked: kesim geçti → true; OPEN değil → true; açık gelecek → false (UTC anlarıyla, TZ bağımsız)', () => {
    const cutoffAt = new Date('2026-09-07T09:00:00.000Z'); // Pazartesi 12:00 Europe/Istanbul
    expect(dates.isLocked({ cutoffAt, status: 'OPEN' }, new Date('2026-09-07T08:59:59.999Z'))).toBe(false);
    expect(dates.isLocked({ cutoffAt, status: 'OPEN' }, new Date('2026-09-07T09:00:00.000Z'))).toBe(true);
    expect(dates.isLocked({ cutoffAt, status: 'CLOSED' }, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
    expect(dates.isLocked({ cutoffAt, status: 'LOCKED' }, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
    expect(dates.isFull({ reserved: 0, capacity: 0 })).toBe(true);
    expect(dates.isFull({ reserved: 2, capacity: 3 })).toBe(false);
  });

  it('generate(weeks) → DeliveryService.generateDates (idempotent; test bölgesi için üretir, ikinci koşu created 0)', async () => {
    const first = await dates.generate(1);
    expect(first.weeks).toBe(1);
    expect(first.zones).toBeGreaterThanOrEqual(1);
    const second = await dates.generate(1);
    expect(second.created).toBe(0);
    const count = await prisma.deliveryDate.count({ where: { zoneId } });
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
