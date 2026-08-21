// F9/C — ekran 21 "Özet": GET /admin/dashboard. Gerçek Nest + guard'lar + gerçek DB (bagdam_dev).
// Metrikler türetilmiştir; test mutlak sayı yerine "fixture eklenince artar" ilişkisini doğrular
// (paylaşılan geliştirme DB'sinde başka satırlar da olabilir).
import { CookieJar } from '../auth/cookie-jar';
import { afterCutoff, bodyOf, createSubsApp, type JsonBody, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

const URL = '/api/v1/admin/dashboard';

describe('HTTP — /admin/dashboard (ekran 21 Özet)', () => {
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

  it('yetki: oturumsuz 401, müşteri 403, admin 200', async () => {
    expect((await app.call('GET', URL)).status).toBe(401);
    const fx = await app.createFixture();
    const customer = new CookieJar();
    await app.login(customer, fx.email, fx.password);
    expect((await app.call('GET', URL, { jar: customer })).status).toBe(403);
    expect((await app.call('GET', URL, { jar: admin })).status).toBe(200);
  });

  it('metrikler: şekil doğru; abonelik ve ödeme problemi sayaçları fixture ile artar', async () => {
    const before = await bodyOf<JsonBody>(await app.call('GET', URL, { jar: admin }));
    expect(before).toMatchObject({
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      orders: expect.any(Object),
      subscriptions: expect.any(Object),
      paymentIssues: expect.any(Object),
    });
    expect(Number.isNaN(Date.parse(before.serverNowIso as string))).toBe(false);
    // weekStart Pazartesi olmalı (ISO hafta)
    expect(new Date(`${before.weekStart as string}T00:00:00Z`).getUTCDay()).toBe(1);
    for (const key of ['todayCount', 'todayRevenue', 'weekCount', 'weekRevenue', 'pendingPaymentCount', 'deliveringTodayCount']) {
      expect(typeof (before.orders as JsonBody)[key]).toBe('number');
    }
    for (const key of ['active', 'pastDue', 'cancelRequested', 'pending', 'oneTimeActive', 'newThisWeek']) {
      expect(typeof (before.subscriptions as JsonBody)[key]).toBe('number');
    }
    expect(Array.isArray(before.cutoffs)).toBe(true);
    expect(Array.isArray(before.recentEvents)).toBe(true);

    // Yeni aktif abonelik → active sayacı artar
    const activeBefore = (before.subscriptions as JsonBody).active as number;
    const fx = await app.createFixture();
    const afterCreate = await bodyOf<JsonBody>(await app.call('GET', URL, { jar: admin }));
    expect((afterCreate.subscriptions as JsonBody).active).toBe(activeBefore + 1);
    // Son olaylar: yeni aboneliğin CREATED/ACTIVATED olayları listede
    const events = afterCreate.recentEvents as Array<JsonBody>;
    expect(events.some((e) => e.subscriptionId === fx.subscriptionId)).toBe(true);
    expect(events[0]).toMatchObject({ id: expect.any(String), type: expect.any(String), actor: expect.any(String), createdAt: expect.any(String) });

    // Tahsil edilemeyen cycle → paymentIssues.unpaidCycles artar
    const unpaidBefore = (afterCreate.paymentIssues as JsonBody).unpaidCycles as number;
    const bad = await app.createFixture({ zoneId: await app.createZone(`z-dash-${Date.now().toString(36)}`, 999), cardToken: `fail:${Date.now()}` });
    await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    await app.cycles.lockAndCharge(afterCutoff('2027-03-09'));
    expect((await app.cyclesOf(bad.subscriptionId)).some((c) => c.status === 'UNPAID')).toBe(true);
    const afterUnpaid = await bodyOf<JsonBody>(await app.call('GET', URL, { jar: admin }));
    expect((afterUnpaid.paymentIssues as JsonBody).unpaidCycles).toBe(unpaidBefore + 1);
    expect((afterUnpaid.paymentIssues as JsonBody).total).toBe(
      ((afterUnpaid.paymentIssues as JsonBody).failedOrders as number) +
        ((afterUnpaid.paymentIssues as JsonBody).unpaidCycles as number) +
        ((afterUnpaid.paymentIssues as JsonBody).awaitingPaymentCycles as number),
    );
  });

  it('kesim satırları: bu haftanın teslimat günleri kapasite/rezerv/kilit bilgisiyle gelir', async () => {
    const rows = ((await bodyOf<JsonBody>(await app.call('GET', URL, { jar: admin }))).cutoffs ?? []) as Array<JsonBody>;
    for (const row of rows) {
      expect(row).toMatchObject({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        zoneSlug: expect.any(String),
        zoneName: expect.any(String),
        cutoffAtIso: expect.any(String),
        locked: expect.any(Boolean),
        status: expect.any(String),
        capacity: expect.any(Number),
        reserved: expect.any(Number),
        cycleCount: expect.any(Number),
      });
      expect(Number.isNaN(Date.parse(row.cutoffAtIso as string))).toBe(false);
    }
  });
});
