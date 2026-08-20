// F7/E — entegrasyon: SubscriptionsDepsAdapter (gerçek Pricing/Payments/Orders/Delivery servisleri) + admin manuel checkout
// (`POST /admin/subscriptions`: quote → Order PAID (MANUAL) → Subscription ACTIVE + cycle#1) + `POST /admin/jobs/:name/run {now}`.
// Gerçek Nest + guard'lar + gerçek DB; zaman `now` ile (2027 takvimi, TZ'den bağımsız).
import { CookieJar } from '../auth/cookie-jar';
import { deleteMailLogsWithPreviews } from '../auth/f6-harness';
import { afterCutoff, bodyOf, createSubsApp, type JsonBody, type SubsApp } from './harness';

jest.setTimeout(300_000);

describe('Manuel checkout (POST /admin/subscriptions) · deps adapter · jobs now ezmesi', () => {
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

  it('admin manuel checkout: Order PAID (CHECKOUT/MANUAL) + cycle#1 + ACTIVE; fiyat quote ile (ilk kutu %50, ekstra, kargo 0); DD rezerv +1; ikinci → 409; müşteri 403; tek seferlik kargo', async () => {
    // Fixture yalnız müşteri/adres/kart için: createFixture aboneliği de açar → ayrı kullanıcı kur
    const fx = await app.createFixture({ templateWeeks: 12 });
    const admin = new CookieJar();
    await app.loginSeedAdmin(admin);
    const tier = await app.prisma.boxTier.findUniqueOrThrow({ where: { id: fx.tierId } });
    // Aynı müşteride zaten abonelik var → 409 SUBSCRIPTION_EXISTS
    const dup = await app.call('POST', '/api/v1/admin/subscriptions', { jar: admin, body: { userId: fx.userId, tierSlug: tier.slug, deliveryDay: 'SALI', deliveryOn: '2027-03-09' } });
    expect(dup.status).toBe(409);
    expect((await bodyOf(dup)).error).toBe('SUBSCRIPTION_EXISTS');

    // Yeni müşteri (adres + kart), abonelik yok
    const email = `manual-${Date.now()}@test.local`;
    const user = await app.prisma.user.create({ data: { email, passwordHash: '$2b$04$abcdefghijklmnopqrstuu', name: 'Manuel Müşteri', phone: '+905550000000', role: 'CUSTOMER', isActive: true }, select: { id: true } });
    const address = await app.prisma.address.create({ data: { userId: user.id, fullName: 'Manuel Müşteri', phone: '+905550000000', line: 'Manuel Mah. 1', zoneId: fx.zoneId, isDefault: true } });
    const pm = await app.prisma.paymentMethod.create({ data: { userId: user.id, provider: 'MANUAL', providerCustomerKey: 'cus_manual', providerCardToken: 'ok:manual', last4: '0009', brand: 'TEST', isDefault: true, isActive: true } });
    const extraUnit = app.products.extra.unit;
    const factor = extraUnit === 'kg' ? 0.25 : 1;
    const ddBefore = await app.prisma.deliveryDate.findUnique({ where: { zoneId_date: { zoneId: fx.zoneId, date: new Date('2027-03-09T00:00:00.000Z') } } });
    try {
      // Müşteri rolü → 403
      const customer = new CookieJar();
      await app.login(customer, fx.email, fx.password);
      expect((await app.call('POST', '/api/v1/admin/subscriptions', { jar: customer, body: { userId: user.id, tierSlug: tier.slug, deliveryDay: 'SALI' } })).status).toBe(403);

      const res = await app.call('POST', '/api/v1/admin/subscriptions', {
        jar: admin,
        body: { userId: user.id, tierSlug: tier.slug, frequencyWeeks: 1, deliveryDay: 'SALI', deliveryOn: '2027-03-09', paymentMethodId: pm.id, chargeStrategy: 'MERCHANT_INITIATED', extras: [{ id: app.products.extra.slug, factor }], note: 'havale' },
      });
      expect(res.status).toBe(201);
      const body = await bodyOf<JsonBody>(res);
      const sub = body.subscription as JsonBody;
      const cycle = body.cycle as JsonBody;
      const order = body.order as JsonBody;
      const payment = body.payment as JsonBody;
      expect(sub).toMatchObject({ id: expect.any(String), status: 'ACTIVE', isOneTime: false, frequencyWeeks: 1, deliveryDay: 'SALI', discountBoxesLeft: 1, paymentMethodId: pm.id, addressId: address.id });
      expect(cycle).toMatchObject({ cycleNo: 1, status: 'SCHEDULED', deliveryOn: '2027-03-09', orderId: order.id });
      const extraTotal = Math.round(app.products.extra.price * factor);
      expect(order).toMatchObject({ status: 'PAID', grandTotal: app.tierPrice / 2 + extraTotal, prepaidAmount: app.tierPrice / 2 + extraTotal });
      expect(payment).toMatchObject({ status: 'SUCCEEDED', amount: app.tierPrice / 2 + extraTotal });
      // DB: Order + satırlar + ödeme + cycle#1 bağlantısı + DD rezerv
      const dbOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id as string }, include: { lines: true, payments: true } });
      expect(dbOrder.status).toBe('PAID');
      expect(dbOrder.kind).toBe('SUBSCRIPTION');
      expect(dbOrder.subscriptionId).toBe(sub.id);
      expect(dbOrder.paidAt).not.toBeNull();
      expect(dbOrder.lines.map((l) => l.kind).sort()).toEqual(['BOX', 'EXTRA']);
      expect(Number(dbOrder.discountTotal)).toBe(app.tierPrice / 2);
      expect(Number(dbOrder.shippingFee)).toBe(0);
      expect(dbOrder.payments).toHaveLength(1);
      expect(dbOrder.payments[0]).toMatchObject({ kind: 'CHECKOUT', provider: 'MANUAL', status: 'SUCCEEDED', conversationId: `chk_${order.id}` });
      const c1 = await app.cycle(cycle.id as string);
      expect(c1.orderId).toBe(order.id);
      expect(Number(c1.prepaidAmount)).toBe(app.tierPrice / 2 + extraTotal);
      expect(c1.items.filter((i) => i.source === 'TEMPLATE')).toHaveLength(3);
      expect(c1.items.filter((i) => i.source === 'EXTRA')).toHaveLength(1);
      const ddAfter = await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: c1.deliveryDateId } });
      expect(ddAfter.reserved).toBe((ddBefore?.reserved ?? 0) + 1);
      // Olaylar: CREATED + ADMIN_NOTE(manualCheckout) + ACTIVATED; ensure ileri cycle'ları üretti
      const types = (await app.events(sub.id as string)).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['CREATED', 'ADMIN_NOTE', 'ACTIVATED']));
      // Aktivasyondaki ensure gerçek saate göre ufuk uygular (2027 teslimatı ufuk dışı → yalnız cycle#1); ufuk içinden koşunca üretir
      expect((await app.cyclesOf(sub.id as string)).length).toBe(1);
      const ensured = await app.cycles.ensure(new Date('2027-03-08T07:00:00.000Z'), { subscriptionId: sub.id as string });
      expect(ensured.created).toBeGreaterThanOrEqual(1);
      expect((await app.cyclesOf(sub.id as string)).length).toBeGreaterThanOrEqual(2);
      expect((await app.prisma.user.findUnique({ where: { id: user.id } }))?.firstBoxesPromoUsedAt).not.toBeNull();
      // Aynı müşteriye ikinci → 409 SUBSCRIPTION_EXISTS (işlem geri alınır, rezerv değişmez)
      const again = await app.call('POST', '/api/v1/admin/subscriptions', { jar: admin, body: { userId: user.id, tierSlug: tier.slug, deliveryDay: 'SALI', deliveryOn: '2027-03-09' } });
      expect(again.status).toBe(409);
      expect((await bodyOf(again)).error).toBe('SUBSCRIPTION_EXISTS');
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: c1.deliveryDateId } })).reserved).toBe(ddAfter.reserved);

      // Kesim: cycle#1 peşin + ekstra (checkout'ta ödendi) → DELTA yok → CHARGED(0); sipariş değişmez
      const lock = await app.cycles.lockAndCharge(afterCutoff('2027-03-09'));
      expect(lock.errors).toBe(0);
      const c1b = await app.cycle(cycle.id as string);
      expect(c1b.status).toBe('CHARGED');
      expect(c1b.deltaOrderId).toBeNull();
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id as string } })).status).toBe('PAID');

      // Tek seferlik (ayrı müşteri): indirim yok, kargo bölge kuralı; tek cycle
      const user2 = await app.prisma.user.create({ data: { email: `manual2-${Date.now()}@test.local`, passwordHash: '$2b$04$abcdefghijklmnopqrstuu', role: 'CUSTOMER', isActive: true }, select: { id: true } });
      await app.prisma.address.create({ data: { userId: user2.id, fullName: 'Tek Seferlik', phone: '+905550000001', line: 'Manuel Mah. 2', zoneId: fx.zoneId, isDefault: true } });
      try {
        const one = await app.call('POST', '/api/v1/admin/subscriptions', { jar: admin, body: { userId: user2.id, tierSlug: tier.slug, isOneTime: true, deliveryDay: 'PERSEMBE', deliveryOn: '2027-03-11' } });
        expect(one.status).toBe(201);
        const oneBody = await bodyOf<JsonBody>(one);
        expect((oneBody.subscription as JsonBody).isOneTime).toBe(true);
        expect((oneBody.order as JsonBody).grandTotal).toBe(app.tierPrice + 49); // zone fee 49, eşik 1000 (tier 600)
        expect((await app.prisma.order.findUniqueOrThrow({ where: { id: (oneBody.order as JsonBody).id as string } })).kind).toBe('BOX_ONE_TIME');
        expect((await app.cyclesOf((oneBody.subscription as JsonBody).id as string)).length).toBe(1);
        // Adresi olmayan müşteri → 400
        const user3 = await app.prisma.user.create({ data: { email: `manual3-${Date.now()}@test.local`, passwordHash: '$2b$04$abcdefghijklmnopqrstuu', role: 'CUSTOMER', isActive: true }, select: { id: true } });
        try {
          const noAddr = await app.call('POST', '/api/v1/admin/subscriptions', { jar: admin, body: { userId: user3.id, tierSlug: tier.slug, deliveryDay: 'SALI' } });
          expect(noAddr.status).toBe(400);
          expect((await bodyOf(noAddr)).error).toBe('ADDRESS_INVALID');
        } finally {
          await app.prisma.user.delete({ where: { id: user3.id } });
        }
      } finally {
        await cleanupUser(app, user2.id);
      }
    } finally {
      await cleanupUser(app, user.id);
      await app.prisma.auditLog.deleteMany({ where: { module: 'subscriptions', createdAt: { gte: new Date(Date.now() - 10 * 60_000) }, entityId: { in: [user.id] } } });
    }
  });

  it('POST /admin/jobs/:name/run {now}: simülasyon zamanı (üretim dışı) → kesimi geçmiş cycle kilitlenir; biçimsiz now 400; CronLog satırı', async () => {
    const fx = await app.createFixture();
    const admin = new CookieJar();
    await app.loginSeedAdmin(admin);
    const bad = await app.call('POST', '/api/v1/admin/jobs/cycles:lock-and-charge/run', { jar: admin, body: { now: 'dün' } });
    expect(bad.status).toBe(400);
    const run = await app.call('POST', '/api/v1/admin/jobs/cycles:lock-and-charge/run', { jar: admin, body: { now: afterCutoff('2027-03-02').toISOString() } });
    expect(run.status).toBe(200);
    const body = await bodyOf<JsonBody>(run);
    expect(body.status).toBe('SUCCESS');
    expect((body.details as JsonBody).chargedZero).toBeGreaterThanOrEqual(1);
    expect((await app.cycle(fx.firstCycleId)).status).toBe('CHARGED');
    const log = await app.prisma.cronLog.findUnique({ where: { id: body.cronLogId as string } });
    expect(log?.startedAt.toISOString()).toBe(afterCutoff('2027-03-02').toISOString());
    await app.prisma.auditLog.deleteMany({ where: { module: 'jobs', entityId: body.cronLogId as string } });
  });

  it('deps adapter: aynı deneme numarasıyla ikinci MIT çağrısı SUCCEEDED ise çift tahsilat yapmaz; FAILED ise yeni numara', async () => {
    const fx = await app.createFixture();
    const c1 = await app.cycle(fx.firstCycleId);
    const pm = await app.prisma.paymentMethod.findUniqueOrThrow({ where: { id: fx.paymentMethodId! } });
    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: fx.orderId } });
    const ref = { id: order.id, orderNo: order.orderNo, status: order.status, grandTotal: Number(order.grandTotal) };
    const now = new Date('2027-03-01T10:00:00.000Z');
    const first = await app.deps.charge.chargeStoredCard({ cycle: c1, order: ref, paymentMethod: pm, amount: 10, kind: 'DELTA', attemptNo: 7, now });
    expect(first.status).toBe('SUCCEEDED');
    const second = await app.deps.charge.chargeStoredCard({ cycle: c1, order: ref, paymentMethod: pm, amount: 10, kind: 'DELTA', attemptNo: 7, now });
    expect(second).toMatchObject({ status: 'SUCCEEDED', paymentId: first.paymentId });
    expect(await app.prisma.payment.count({ where: { orderId: order.id, conversationId: { startsWith: `cyc_${c1.id}_` } } })).toBe(1);
    // Başarısız kart: aynı numara → yeni deneme numarası (çakışma yok)
    const failPm = await app.prisma.paymentMethod.create({ data: { userId: fx.userId, provider: 'MANUAL', providerCustomerKey: 'cus_f', providerCardToken: 'fail:x', last4: '0003', isDefault: false, isActive: true } });
    const f1 = await app.deps.charge.chargeStoredCard({ cycle: c1, order: ref, paymentMethod: failPm, amount: 10, kind: 'RETRY', attemptNo: 8, now });
    const f2 = await app.deps.charge.chargeStoredCard({ cycle: c1, order: ref, paymentMethod: failPm, amount: 10, kind: 'RETRY', attemptNo: 8, now });
    expect(f1.status).toBe('FAILED');
    expect(f2.status).toBe('FAILED');
    expect(f2.paymentId).not.toBe(f1.paymentId);
    const convs = (await app.prisma.payment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })).map((p) => p.conversationId);
    expect(convs).toEqual([`cyc_${c1.id}_7`, `cyc_${c1.id}_8`, `cyc_${c1.id}_9`]);
    // Ödeme linki: aynı numara ikinci kez → bir sonraki boş numara
    const l1 = await app.deps.charge.issuePaymentLink({ cycle: c1, order: ref, amount: 10, attemptNo: 1, now });
    const l2 = await app.deps.charge.issuePaymentLink({ cycle: c1, order: ref, amount: 10, attemptNo: 1, now });
    expect(l1.linkToken).toMatch(/^[0-9a-f]{32}$/);
    expect(l2.linkToken).not.toBe(l1.linkToken);
    const links = await app.prisma.payment.findMany({ where: { orderId: order.id, kind: 'LINK' }, orderBy: { createdAt: 'asc' } });
    expect(links.map((p) => p.conversationId)).toEqual([`lnk_${c1.id}_1`, `lnk_${c1.id}_2`]);
    await app.deps.charge.expirePaymentLink(l1.paymentId, now);
    await app.deps.charge.expirePaymentLink(l1.paymentId, now); // idempotent
    expect((await app.prisma.payment.findUnique({ where: { id: l1.paymentId } }))?.status).toBe('EXPIRED');
    // Order geçişi: aynı duruma geçiş no-op; iptal DD rezervini DEĞİŞTİRMEZ (rezervin sahibi motor)
    const dd = await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: c1.deliveryDateId } });
    await app.deps.orders.transition(order.id, 'PAID', { actor: 'SYSTEM', now });
    await app.deps.orders.transition(order.id, 'CANCELLED', { actor: 'SYSTEM', reason: 'test', now });
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: dd.id } })).reserved).toBe(dd.reserved);
  });
});

async function cleanupUser(app: SubsApp, userId: string): Promise<void> {
  const subs = await app.prisma.subscription.findMany({ where: { userId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  const orders = await app.prisma.order.findMany({ where: { OR: [{ userId }, { subscriptionId: { in: subIds } }] }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await app.prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await app.prisma.subscriptionCycle.deleteMany({ where: { subscriptionId: { in: subIds } } });
  // F8: manuel checkout Order PAID → `order.paid` e-postası (MailLog SKIPPED + önizleme) — test artığı bırakma
  await deleteMailLogsWithPreviews(app.prisma, { templateSlug: 'order-paid', entityId: { in: orderIds } });
  await app.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await app.prisma.subscription.deleteMany({ where: { id: { in: subIds } } });
  await app.prisma.auditLog.deleteMany({ where: { entityId: { in: [...subIds, userId] } } });
  await app.prisma.user.delete({ where: { id: userId } });
}
