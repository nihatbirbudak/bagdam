// F9/C — ops uçları: /admin/ops/pick-list · packing-list · day-summary · bulk-status + /admin/payment-issues.
// Gerçek Nest + guard'lar + gerçek DB (bagdam_dev); zaman servislere `now` ile verilir (TZ'den bağımsız).
// Fixture: 2027-03-01 Pazartesi; Salı teslimat 2027-03-02, kesim 2027-03-01 12:00 Europe/Istanbul (09:00Z).
import { COMMERCE_SETTINGS_DEFAULTS, resolveExtraOptions, type ExtraOption } from '@bagdam/shared';
import { CookieJar } from '../auth/cookie-jar';
import { afterCutoff, beforeCutoff, bodyOf, createSubsApp, type JsonBody, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

const OPS = '/api/v1/admin/ops';
const DAY = '2027-03-02';

interface PickRow extends JsonBody {
  productSlug: string;
  totalQty: number;
  boxCount: number;
  extraCount: number;
  boxQty: number;
  extraQty: number;
  labels: string[];
  prefs: Array<{ pref: string; qty: number; count: number }>;
}

interface PackEntry extends JsonBody {
  cycleId: string;
  cycleNo: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  addressLine: string;
  zoneSlug: string;
  deliveryOn: string;
  deliveryDay: string;
  items: Array<{ productSlug: string; name: string; pref: string | null; source: string; qty: number; unit: string | null; label: string | null }>;
  itemPrefs: Record<string, string>;
  orderStatus: string | null;
  adminNote: string | null;
  boxItemCount: number;
  extraItemCount: number;
}

describe('HTTP — /admin/ops/* (ekran 20) · /admin/payment-issues (ekran 18)', () => {
  let app: SubsApp;
  let admin: CookieJar;

  beforeAll(async () => {
    app = await createSubsApp();
    admin = new CookieJar();
    await app.loginSeedAdmin(admin);
  });

  afterAll(async () => {
    try {
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('pick-list: ürün bazında toplam + kutu/ekstra kırılımı + tercih dağılımı + etiketler; packing-list: müşteri fişi', async () => {
    const fx = await app.createFixture();
    // Ekstra ekle → pick listesinde extraCount/extraQty ayrı sayılmalı
    const options = resolveExtraOptions(app.products.extra.unit, COMMERCE_SETTINGS_DEFAULTS, app.products.extra.extraOptions as ExtraOption[] | null);
    const opt = options[0]!;
    await app.subscriptions.patchCurrentCycle(fx.userId, { extras: [{ id: app.products.extra.slug, factor: opt.factor, label: opt.label }] }, beforeCutoff(DAY));
    // Kesim → CHARGED (pick/packing yalnız ödemesi alınmış cycle'ları listeler)
    await app.cycles.lockAndCharge(afterCutoff(DAY));
    expect((await app.cycle(fx.firstCycleId)).status).toBe('CHARGED');

    const pick = await bodyOf<PickRow[]>(await app.call('GET', `${OPS}/pick-list?date=${DAY}&zone=${app.zoneSlug}`, { jar: admin }));
    expect(pick.length).toBe(4); // 3 şablon ürünü + 1 ekstra
    const boxRow = pick.find((r) => r.productSlug === app.products.fresh[0]!.slug)!;
    expect(boxRow).toMatchObject({ boxCount: 1, extraCount: 0, boxQty: 1, totalQty: 1 });
    expect(Array.isArray(boxRow.prefs)).toBe(true);
    expect(boxRow.labels.length).toBeGreaterThanOrEqual(1); // qtyLabel "1 <birim>"
    expect(boxRow.unit).toBe(app.products.fresh[0]!.unit);
    const extraRow = pick.find((r) => r.productSlug === app.products.extra.slug)!;
    expect(extraRow).toMatchObject({ boxCount: 0, extraCount: 1, boxQty: 0, extraQty: opt.factor, totalQty: opt.factor });
    // Tercih dağılımı: ürünün prefOptions'ı varsa varsayılan tercih satıra düşer
    for (const row of pick) {
      for (const p of row.prefs) expect(p.qty).toBeGreaterThan(0);
    }

    const packing = await bodyOf<PackEntry[]>(await app.call('GET', `${OPS}/packing-list?date=${DAY}&zone=${app.zoneSlug}`, { jar: admin }));
    const entry = packing.find((e) => e.cycleId === fx.firstCycleId)!;
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      cycleNo: 1,
      isOneTime: false,
      deliveryOn: DAY,
      deliveryDay: 'sali',
      zoneSlug: app.zoneSlug,
      customerEmail: fx.email,
      customerPhone: '+905551112233',
      addressLine: 'Test Mah. 1',
      tierSlug: expect.stringMatching(/^t-sub-/),
      status: 'CHARGED',
      orderStatus: 'PAID',
      curatorName: 'Test Küratör',
    });
    expect(entry.items.length).toBe(4);
    expect(entry.boxItemCount).toBe(3);
    expect(entry.extraItemCount).toBe(1);
    const packedExtra = entry.items.find((i) => i.productSlug === app.products.extra.slug)!;
    expect(packedExtra.source).toBe('EXTRA');
    expect(packedExtra.qty).toBe(opt.factor);
    expect(packedExtra.unit).toBe(app.products.extra.unit);
    expect(typeof entry.itemPrefs).toBe('object');
    expect(entry.adminNote === null || typeof entry.adminNote === 'string').toBe(true);

    // Bölge süzgeci: bilinmeyen bölge → 404, geçersiz tarih → 400, müşteri → 403
    expect((await app.call('GET', `${OPS}/pick-list?date=${DAY}&zone=yok-boyle-bir-bolge`, { jar: admin })).status).toBe(404);
    expect((await app.call('GET', `${OPS}/packing-list?date=2027-3-2`, { jar: admin })).status).toBe(400);
    const customer = new CookieJar();
    await app.login(customer, fx.email, fx.password);
    expect((await app.call('GET', `${OPS}/pick-list?date=${DAY}`, { jar: customer })).status).toBe(403);
  });

  it('day-summary: durum dağılımı, tier kırılımı, ciro, kapasite/kesim satırı', async () => {
    const zoneSlug = `z-ops-sum-${Date.now().toString(36)}`;
    const zoneId = await app.createZone(zoneSlug, 999);
    const fx = await app.createFixture({ zoneId });
    await app.cycles.lockAndCharge(afterCutoff(DAY));

    const summary = await bodyOf<JsonBody>(await app.call('GET', `${OPS}/day-summary?date=${DAY}&zone=${zoneSlug}`, { jar: admin }));
    expect(summary).toMatchObject({ date: DAY, zone: zoneSlug, cycleCount: 1, fulfillableCount: 1, deliveredCount: 0, skippedCount: 0, unpaidCount: 0, awaitingPaymentCount: 0 });
    expect(typeof summary.serverNowIso).toBe('string');
    expect(Number.isNaN(Date.parse(summary.serverNowIso as string))).toBe(false);
    expect((summary.cycleCountsByStatus as Record<string, number>).CHARGED).toBe(1);
    const tiers = summary.boxCountByTier as Array<{ tierSlug: string; count: number }>;
    expect(tiers).toEqual([{ tierSlug: expect.stringMatching(/^t-sub-/), tierLabel: expect.any(String), count: 1 }]);
    expect(summary.boxItemCount).toBe(3);
    expect(summary.extraItemCount).toBe(0);
    // cycle#1 peşin ödendi → ana siparişin grandTotal'ı ciroya girer
    expect(summary.revenue).toBe(app.tierPrice / 2);
    const zones = summary.zones as Array<JsonBody>;
    expect(zones.length).toBe(1);
    expect(zones[0]).toMatchObject({ zoneSlug, cycleCount: 1, fulfillableCount: 1, capacity: 999, status: 'OPEN' });
    expect(zones[0]!.reserved).toBeGreaterThanOrEqual(1);
    // locked = kesim geçti mi (sunucu saatine göre); fixture takvimi 2027 → gerçek saatte henüz geçmemiş olmalı
    expect(zones[0]!.locked).toBe(Date.parse(zones[0]!.cutoffAtIso as string) <= Date.parse(summary.serverNowIso as string));
    expect(fx.subscriptionId).toBeTruthy();
  });

  it('bulk-status: CHARGED → PREPARING → OUT_FOR_DELIVERY (cycle + sipariş birlikte); geçersiz geçiş 409, skipInvalid ile atlanır', async () => {
    const zoneSlug = `z-ops-bulk-${Date.now().toString(36)}`;
    const zoneId = await app.createZone(zoneSlug, 999);
    const a = await app.createFixture({ zoneId });
    const b = await app.createFixture({ zoneId });
    await app.cycles.lockAndCharge(afterCutoff(DAY));

    const first = await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId, b.firstCycleId], status: 'PREPARING', note: 'paketleme başladı' } });
    expect(first.status).toBe(200);
    const firstBody = await bodyOf<JsonBody>(first);
    expect(firstBody).toMatchObject({ status: 'PREPARING', requested: 2, updated: 2, failed: 0, skipped: 0 });
    expect((await app.cycle(a.firstCycleId)).status).toBe('PREPARING');
    // Cycle geçişi kendi siparişini de ilerletir
    expect((await app.prisma.order.findUnique({ where: { id: a.orderId } }))?.status).toBe('PREPARING');

    // Geçersiz: PREPARING → DELIVERED (makinede yok) → hep-ya-hiç, hiçbiri uygulanmaz
    const invalid = await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId], status: 'DELIVERED' } });
    expect(invalid.status).toBe(409);
    expect((await bodyOf(invalid)).error).toBe('OPS_BULK_TRANSITION_INVALID');
    expect((await app.cycle(a.firstCycleId)).status).toBe('PREPARING');

    // DELIVERY_FAILED cycle makinesinde yok → cycleIds ile 409
    const notForCycle = await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId], status: 'DELIVERY_FAILED' } });
    expect(notForCycle.status).toBe(409);
    expect((await bodyOf(notForCycle)).error).toBe('CYCLE_TRANSITION_INVALID');

    // İleri adım: ikisi de OUT_FOR_DELIVERY
    const second = await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId, b.firstCycleId], status: 'OUT_FOR_DELIVERY' } });
    expect(second.status).toBe(200);
    expect((await bodyOf<JsonBody>(second)).updated).toBe(2);

    // Karışık parti: biri yolda (geçerli), biri zaten OUT_FOR_DELIVERY olarak tekrar gönderilirse → skipInvalid ile atlanır
    await app.cycles.adminSetStatus(b.firstCycleId, 'DELIVERED', { actor: 'OPS' }, afterCutoff(DAY));
    const mixed = await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId, b.firstCycleId], status: 'DELIVERED', skipInvalid: true } });
    expect(mixed.status).toBe(200);
    const mixedBody = await bodyOf<JsonBody>(mixed);
    expect(mixedBody).toMatchObject({ requested: 2, updated: 1, skipped: 1 });
    const items = mixedBody.items as Array<JsonBody>;
    expect(items.find((i) => i.id === b.firstCycleId)).toMatchObject({ ok: false, error: 'CYCLE_ALREADY_IN_STATUS' });
    expect((await app.cycle(a.firstCycleId)).status).toBe('DELIVERED');

    // Boş gövde 400 · bilinmeyen durum 400 · CSRF'siz 403 · müşteri 403
    expect((await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { status: 'PREPARING' } })).status).toBe(400);
    expect((await app.call('POST', `${OPS}/bulk-status`, { jar: admin, body: { cycleIds: [a.firstCycleId], status: 'CHARGED' } })).status).toBe(400);
    expect((await app.call('POST', `${OPS}/bulk-status`, { jar: admin, csrf: false, body: { cycleIds: [a.firstCycleId], status: 'DELIVERED' } })).status).toBe(403);

    // Audit satırı (module subscriptions, action CREATE)
    const audit = await app.prisma.auditLog.findFirst({ where: { module: 'subscriptions', summary: { contains: 'toplu durum' } }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    await app.prisma.auditLog.deleteMany({ where: { module: 'subscriptions', summary: { contains: 'toplu durum' } } });
  });

  it('payment-issues: UNPAID cycle + PAYMENT_FAILED sipariş tek listede; sayaçlar ve müşteri alanları dolu', async () => {
    const zoneSlug = `z-ops-pay-${Date.now().toString(36)}`;
    const zoneId = await app.createZone(zoneSlug, 999);
    // Kart reddi → cycle#2 UNPAID (cycle#1 peşin ödenmiş olduğundan tahsilat #2'de)
    const fx = await app.createFixture({ zoneId, cardToken: `fail:${Date.now()}` });
    await app.cycles.lockAndCharge(afterCutoff(DAY)); // #1 peşin → CHARGED (tutar 0)
    await app.cycles.lockAndCharge(afterCutoff('2027-03-09')); // #2 → MIT reddi → UNPAID
    const cycles = await app.cyclesOf(fx.subscriptionId);
    const unpaid = cycles.find((c) => c.status === 'UNPAID');
    expect(unpaid).toBeDefined();

    const res = await app.call('GET', `/api/v1/admin/payment-issues?q=${encodeURIComponent(fx.email)}`, { jar: admin });
    expect(res.status).toBe(200);
    const body = await bodyOf<JsonBody>(res);
    const items = body.items as Array<JsonBody>;
    const row = items.find((i) => i.cycleId === unpaid!.id)!;
    expect(row).toMatchObject({
      kind: 'CYCLE',
      status: 'UNPAID',
      customerEmail: fx.email,
      subscriptionId: fx.subscriptionId,
      subscriptionStatus: expect.any(String),
      hasCard: true,
    });
    expect(row.amount).toBeGreaterThan(0);
    expect(row.deliveryOn).toBe('2027-03-09');
    expect(typeof row.retryCount).toBe('number');
    expect((body.counts as JsonBody).unpaidCycles).toBeGreaterThanOrEqual(1);
    expect((body.counts as JsonBody).total).toBeGreaterThanOrEqual(1);

    // kind süzgeci: yalnız siparişler istendiğinde cycle satırı gelmez
    const onlyOrders = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/payment-issues?kind=ORDER&q=${encodeURIComponent(fx.email)}`, { jar: admin }));
    expect((onlyOrders.items as Array<JsonBody>).every((i) => i.kind === 'ORDER')).toBe(true);

    const customer = new CookieJar();
    await app.login(customer, fx.email, fx.password);
    expect((await app.call('GET', '/api/v1/admin/payment-issues', { jar: customer })).status).toBe(403);
  });
});
