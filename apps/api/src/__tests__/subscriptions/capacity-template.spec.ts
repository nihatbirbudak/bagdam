// F7 DoD — "gün dolu → 409" (unskip DAY_FULL + ensure dolu günde cycle üretmez + uyarı) ve
// "şablon yoksa cycle üretilmez + ops uyarısı" (SystemLog WARN günde 1 digest; şablon yayınlanınca üretilir).
// Ayrı dosya: kendi tier'ı (RUN) — engine.spec'in yayınladığı şablonlardan etkilenmez.
import { BASE_NOW, createSubsApp, RUN, T, type SubsApp } from './harness';

jest.setTimeout(300_000);

describe('Kapasite ve şablon kuralları', () => {
  let app: SubsApp;

  beforeAll(async () => {
    app = await createSubsApp();
  });

  afterAll(async () => {
    try {
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('şablon yoksa cycle üretilmez + ops uyarısı (SystemLog WARN, digest); şablon yayınlanınca sonraki ensure üretir', async () => {
    const fx = await app.createFixture({ templateWeeks: 1 }); // yalnız 03-01 haftası yayında
    expect((await app.cyclesOf(fx.subscriptionId)).length).toBe(1);
    const r1 = await app.cycles.ensure(BASE_NOW, { subscriptionId: fx.subscriptionId });
    expect(r1.created).toBe(0);
    expect(r1.skippedNoTemplate).toBe(1);
    const fingerprint = `ensure:no-template:${fx.tierId}:2027-03-08`;
    let warn = await app.prisma.systemLog.findMany({ where: { fingerprint } });
    expect(warn).toHaveLength(1); // activate içindeki ensure + bu koşu → tek satır (digest)
    expect(warn[0]).toMatchObject({ level: 'WARN', module: 'subscriptions', action: 'cycles:ensure' });
    const count = warn[0]!.occurrenceCount;
    expect(count).toBeGreaterThanOrEqual(2);
    // Aynı gün bir koşu daha: aynı satır, sayaç artar (günde 1 digest)
    await app.cycles.ensure(T('2027-03-01T08:00:00.000Z'), { subscriptionId: fx.subscriptionId });
    warn = await app.prisma.systemLog.findMany({ where: { fingerprint } });
    expect(warn).toHaveLength(1);
    expect(warn[0]!.occurrenceCount).toBe(count + 1);

    await app.publishTemplates(fx.tierId, ['2027-03-08']);
    const r2 = await app.cycles.ensure(BASE_NOW, { subscriptionId: fx.subscriptionId });
    expect(r2.created).toBe(1);
    const cycles = await app.cyclesOf(fx.subscriptionId);
    expect(cycles.map((c) => c.deliveryDate.date.toISOString().slice(0, 10))).toEqual(['2027-03-02', '2027-03-09']);
    // 03-15 haftası yok → yine durur, ikinci cycle üretilmez
    const r3 = await app.cycles.ensure(BASE_NOW, { subscriptionId: fx.subscriptionId });
    expect(r3.created).toBe(0);
    expect(r3.skippedNoTemplate).toBe(1);
  });

  it('gün dolu → 409 DAY_FULL (unskip) ve ensure dolu günde cycle üretmez + uyarı', async () => {
    const zoneId = await app.createZone(`z-full-${RUN}`, 1);
    // A: 2 haftada bir Salı → 03-02, 03-16, 03-30, 04-13 (her biri kapasite 1'i doldurur)
    const a = await app.createFixture({ frequencyWeeks: 2, zoneId, templateWeeks: 12 });
    const aCycles = await app.cyclesOf(a.subscriptionId);
    expect(aCycles.map((c) => c.deliveryDate.date.toISOString().slice(0, 10))).toEqual(['2027-03-02', '2027-03-16', '2027-03-30', '2027-04-13']);
    const dd0316 = await app.prisma.deliveryDate.findUnique({ where: { zoneId_date: { zoneId, date: new Date('2027-03-16T00:00:00.000Z') } } });
    expect(dd0316).toMatchObject({ capacity: 1, reserved: 1 });

    // B: haftalık Salı, ilk teslimat 03-09 (boş) → ensure 03-16'da dolu → durur + uyarı
    const b = await app.createFixture({ zoneId, firstDeliveryOn: '2027-03-09', templateWeeks: 12 });
    const bCycles = await app.cyclesOf(b.subscriptionId);
    expect(bCycles.map((c) => c.deliveryDate.date.toISOString().slice(0, 10))).toEqual(['2027-03-09']);
    const rb = await app.cycles.ensure(BASE_NOW, { subscriptionId: b.subscriptionId });
    expect(rb.created).toBe(0);
    expect(rb.skippedFull).toBe(1);
    expect(await app.prisma.systemLog.count({ where: { fingerprint: `ensure:day-full:${dd0316!.id}` } })).toBe(1);

    // A 03-16'yı atlar → yer açılır → B'nin ensure'ı 03-16'yı alır → A geri almak isteyince 409 DAY_FULL
    const tue = T('2027-03-02T12:00:00.000Z');
    const skipped = await app.subscriptions.skip(a.userId, tue);
    expect(skipped.currentCycle?.deliveryOn).toBe('2027-03-16');
    expect((await app.prisma.deliveryDate.findUnique({ where: { id: dd0316!.id } }))!.reserved).toBe(0);
    const rb2 = await app.cycles.ensure(tue, { subscriptionId: b.subscriptionId });
    expect(rb2.created).toBeGreaterThanOrEqual(1);
    expect((await app.prisma.deliveryDate.findUnique({ where: { id: dd0316!.id } }))!.reserved).toBe(1);
    await expect(app.subscriptions.unskip(a.userId, tue)).rejects.toMatchObject({ response: { error: 'DAY_FULL' } });
    // Atlama durumu değişmedi, hak harcanmış kaldı
    const aSub = await app.sub(a.subscriptionId);
    expect(aSub.skipsUsed).toBe(1);
    expect((await app.cyclesOf(a.subscriptionId)).find((c) => c.cycleNo === 2)?.status).toBe('SKIPPED');
    // Doğrudan rezerv de 409 DAY_FULL
    await expect(app.deps.deliveryDates.reserve(dd0316!.id)).rejects.toMatchObject({ response: { error: 'DAY_FULL' } });
  });
});
