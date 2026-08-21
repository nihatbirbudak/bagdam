// F7 — HTTP yüzeyi: /me/subscription* (401/200, şekil, PATCH, skip 409, iptal akışı), /admin/subscriptions|cycles|ops|jobs
// (rol/CSRF zinciri, audit). Gerçek Nest + guard'lar + gerçek DB; zaman gerçek saat (fixture 2027 tarihlerinde → cycle#1 açık).
import { CookieJar } from '../auth/cookie-jar';
import { bodyOf, createSubsApp, type JsonBody, type SubsApp } from './harness';

jest.setTimeout(300_000);

const ME = '/api/v1/me/subscription';

describe('HTTP — /me/subscription* · /admin/subscriptions|cycles|ops|jobs', () => {
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

  it('GET /me/subscription: oturumsuz 401 · oturumlu 200 BootstrapSub (cart.js getSub şekli) · abonelik yoksa null', async () => {
    expect((await app.call('GET', ME)).status).toBe(401);

    const fx = await app.createFixture();
    const jar = new CookieJar();
    expect((await app.login(jar, fx.email, fx.password)).status).toBe(200);
    const res = await app.call('GET', ME, { jar });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const sub = await bodyOf<JsonBody>(res);
    expect(sub).toMatchObject({
      id: fx.subscriptionId,
      status: 'ACTIVE',
      isOneTime: false,
      tierId: expect.stringMatching(/^t-sub-/),
      freq: '1hafta',
      deliveryDay: 'sali',
      type: 'subscription',
      purchased: true,
      active: false,
      skipThisWeek: false,
      skipUsed: false,
      nextBoxDiscount: false,
      extras: [],
      discountBoxesLeft: 1,
      dunning: null,
      cancellation: null,
    });
    expect((sub.items as string[]).length).toBe(3);
    expect(sub.card).toEqual({ last4: '0001', brand: 'TEST' });
    const current = sub.currentCycle as JsonBody;
    expect(current).toMatchObject({ cycleNo: 1, status: 'SCHEDULED', deliveryOn: '2027-03-02', deliveryDay: 'sali', locked: false, prepaidAmount: app.tierPrice / 2 });
    expect(typeof current.total).toBe('number');
    expect(sub.extrasCutoff).toBe(Date.parse('2027-03-01T09:00:00.000Z'));
    expect(sub.nextDeliveryOn).toBe('2027-03-02');

    // Aboneliği olmayan kullanıcı → 200 null
    const other = await app.prisma.user.create({ data: { email: `nosub-${Date.now()}@test.local`, passwordHash: '$2b$04$abcdefghijklmnopqrstuu', role: 'CUSTOMER', isActive: true }, select: { id: true } });
    try {
      const res2 = await app.call('GET', ME, { headers: { authorization: `Bearer ${await tokenFor(app, other.id)}` } });
      expect(res2.status).toBe(200);
      expect(await res2.text()).toBe('null');
    } finally {
      await app.prisma.user.delete({ where: { id: other.id } });
    }
  });

  it('PATCH /me/subscription (gün) · skip cycle#1 409 · CSRF zorunlu · iptal akışı (talep → vazgeç)', async () => {
    const fx = await app.createFixture();
    const jar = new CookieJar();
    await app.login(jar, fx.email, fx.password);

    // CSRF'siz mutasyon 403
    expect((await app.call('PATCH', ME, { jar, csrf: false, body: { deliveryDay: 'persembe' } })).status).toBe(403);
    // Geçersiz gövde 400
    expect((await app.call('PATCH', ME, { jar, body: { deliveryDay: 'pazar' } })).status).toBe(400);

    const patched = await app.call('PATCH', ME, { jar, body: { deliveryDay: 'persembe' } });
    expect(patched.status).toBe(200);
    const body = await bodyOf<JsonBody>(patched);
    expect(body.deliveryDay).toBe('persembe');
    expect((body.currentCycle as JsonBody).deliveryOn).toBe('2027-03-04'); // cycle#1 aynı haftada yeni güne taşındı

    const skip = await app.call('POST', `${ME}/cycles/current/skip`, { jar });
    expect(skip.status).toBe(409);
    expect((await bodyOf(skip)).error).toBe('FIRST_CYCLE_NOT_SKIPPABLE');

    const cancel = await app.call('POST', `${ME}/cancel`, { jar, body: { reason: 'OTHER', note: 'deneme' } });
    expect(cancel.status).toBe(200);
    const cancelBody = await bodyOf<JsonBody>(cancel);
    expect(cancelBody.offer).toEqual({ pct: 50, boxes: 1 });
    const during = await bodyOf<JsonBody>(await app.call('GET', ME, { jar }));
    expect(during.status).toBe('CANCEL_REQUESTED');
    expect((during.cancellation as JsonBody).retentionOffered).toBe(true);
    const abandon = await app.call('POST', `${ME}/cancel/abandon`, { jar });
    expect(abandon.status).toBe(200);
    expect((await bodyOf<JsonBody>(abandon)).status).toBe('ACTIVE');

    // Audit satırları (module subscriptions)
    const audits = await app.prisma.auditLog.findMany({ where: { actorId: fx.userId, module: 'subscriptions' } });
    expect(audits.map((a) => a.action).sort()).toEqual(expect.arrayContaining(['UPDATE', 'CANCEL']));
  });

  it('admin: liste/detay/cycles/ops/jobs — müşteri 403, admin 200; POST /admin/jobs/:name/run CronLog yazar', async () => {
    const fx = await app.createFixture();
    const customer = new CookieJar();
    await app.login(customer, fx.email, fx.password);
    expect((await app.call('GET', '/api/v1/admin/subscriptions', { jar: customer })).status).toBe(403);
    expect((await app.call('GET', '/api/v1/admin/jobs', { jar: customer })).status).toBe(403);

    const admin = new CookieJar();
    await app.loginSeedAdmin(admin);
    const list = await app.call('GET', `/api/v1/admin/subscriptions?q=${encodeURIComponent(fx.email)}`, { jar: admin });
    expect(list.status).toBe(200);
    const listBody = await bodyOf<{ items: JsonBody[]; total: number; page: number; limit: number }>(list);
    expect(listBody.total).toBe(1);
    expect(listBody.items[0]).toMatchObject({ id: fx.subscriptionId, userEmail: fx.email, status: 'ACTIVE', frequencyWeeks: 1, deliveryDay: 'SALI' });

    const detail = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/subscriptions/${fx.subscriptionId}`, { jar: admin }));
    expect(Array.isArray(detail.cycles)).toBe(true);
    expect((detail.cycles as JsonBody[]).length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(detail.events)).toBe(true);

    const cycles = await app.call('GET', `/api/v1/admin/cycles?date=2027-03-02&zone=${app.zoneSlug}`, { jar: admin });
    expect(cycles.status).toBe(200);
    const cycleRows = await bodyOf<JsonBody[]>(cycles);
    expect(cycleRows.some((c) => c.id === fx.firstCycleId && c.userEmail === fx.email && c.orderNo !== null)).toBe(true);
    expect((await app.call('GET', '/api/v1/admin/cycles?date=2027-3-2', { jar: admin })).status).toBe(400);

    // Ops listeleri: henüz tahsil edilmiş cycle yok → boş dizi
    const pick = await app.call('GET', `/api/v1/admin/ops/pick-list?date=2027-03-02&zone=${app.zoneSlug}`, { jar: admin });
    expect(pick.status).toBe(200);
    expect(await bodyOf<unknown[]>(pick)).toEqual([]);
    const packing = await app.call('GET', `/api/v1/admin/ops/packing-list?date=2027-03-02&zone=${app.zoneSlug}`, { jar: admin });
    expect(packing.status).toBe(200);

    // Admin PATCH: not + strateji
    const patch = await app.call('PATCH', `/api/v1/admin/subscriptions/${fx.subscriptionId}`, { jar: admin, body: { chargeStrategy: 'PAYMENT_LINK', note: 'test notu' } });
    expect(patch.status).toBe(200);
    expect((await bodyOf<JsonBody>(patch)).chargeStrategy).toBe('PAYMENT_LINK');

    // Jobs
    const jobs = await app.call('GET', '/api/v1/admin/jobs', { jar: admin });
    expect(jobs.status).toBe(200);
    const jobList = await bodyOf<JsonBody[]>(jobs);
    expect(jobList.map((j) => j.name).sort()).toEqual([
      'cycles:ensure',
      'cycles:expire-payment-links',
      'cycles:lock-and-charge',
      'delivery-dates:generate',
      'kvkk:purge', // F10
      'payments:reconcile',
      'payments:retry',
      'reminders:cutoff',
    ]);
    const run = await app.call('POST', '/api/v1/admin/jobs/cycles:ensure/run', { jar: admin });
    expect(run.status).toBe(200);
    const runBody = await bodyOf<JsonBody>(run);
    expect(runBody).toMatchObject({ name: 'cycles:ensure', status: 'SUCCESS' });
    expect(typeof runBody.cronLogId).toBe('string');
    const log = await app.prisma.cronLog.findUnique({ where: { id: runBody.cronLogId as string } });
    expect(log).toMatchObject({ name: 'cycles:ensure', status: 'SUCCESS' });
    await app.prisma.cronLog.delete({ where: { id: log!.id } });
    expect((await app.call('POST', '/api/v1/admin/jobs/bilinmeyen/run', { jar: admin })).status).toBe(400);
    // Audit: jobs modülü
    const audit = await app.prisma.auditLog.findFirst({ where: { module: 'jobs', entityId: runBody.cronLogId as string } });
    expect(audit?.action).toBe('CREATE');
    if (audit) await app.prisma.auditLog.delete({ where: { id: audit.id } });
    await app.prisma.auditLog.deleteMany({ where: { module: 'subscriptions', entityId: fx.subscriptionId } });
  });
});

/** Test kullanıcısı için kısa ömürlü access token (AuthService) — guard Bearer'ı da kabul eder. */
async function tokenFor(app: SubsApp, userId: string): Promise<string> {
  const { AuthService } = await import('../../modules/auth/auth.service');
  const auth = app.app.get(AuthService) as unknown as { issueTokens?: (u: { id: string }) => Promise<{ accessToken: string }>; signAccessToken?: (u: unknown) => Promise<string> };
  const user = await app.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('user yok');
  if (typeof auth.issueTokens === 'function') return (await auth.issueTokens(user)).accessToken;
  // Yedek: JwtService ile doğrudan access token
  const { JwtService } = await import('@nestjs/jwt');
  const jwt = app.app.get(JwtService);
  return jwt.signAsync({ sub: user.id, role: user.role, email: user.email, typ: 'access', jti: `t-${Date.now()}` }, { secret: process.env.JWT_SECRET, expiresIn: '5m' });
}
