// F8 — PayTR callback (POST /api/v1/payments/paytr/callback): gerçek Nest uygulaması + rastgele port + gerçek DB bagdam_dev. Guard'lar test
// modülünde YOK (@Public/@SkipCsrf gerçek uygulamada; burada rota davranışı). PayTR'ye istek atılmaz (callback gelen yön). Kapsam:
// eksik alan 400 · IP allowlist 403 · geçersiz hash 400 (WebhookEvent yazılmaz) · geçerli success → WebhookEvent PROCESSED + Payment SUCCEEDED
// + Order PAID (varsayılan dinleyici PaymentSettlementService) + utoken/ctoken → PaymentMethod · ikinci teslim IGNORED (OK) · failed → FAILED +
// Order PAYMENT_FAILED · tutar uyuşmazlığı → soft FAILED (OK, ödeme PENDING kalır) · bilinmeyen merchant_oid → OK + FAILED · PayTR yapılandırması
// Setting payment.* (test değerleri yazılır, sonda ham satırlar geri konur) · LINK ödemesi (`lnk_<cycleId>_1`, callback_id eşlemesi) → cycle CHARGED.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { computeCutoffAt, DEFAULT_TZ, isoDateToUtc, nextDeliveryDateFor, type CommerceSettings } from '@bagdam/shared';
import { Prisma, type Setting } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PaymentsRepository } from '../../modules/payments/payments.repository';
import { PaymentsService } from '../../modules/payments/payments.service';
import { callbackHash } from '../../modules/payments/providers/paytr/paytr.hash';
import { PAYTR_CALLBACK_BAD_HASH, PAYTR_CALLBACK_IP_REJECTED, PAYTR_CALLBACK_OK } from '../../modules/payments/providers/paytr/paytr.types';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { SubscriptionsModule } from '../../modules/subscriptions/subscriptions.module';
import { deleteMailLogsWithPreviews } from '../auth/f6-harness';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(180_000);

const RUN = Date.now().toString(36);
const ZONE_SLUG = `test-paytr-${RUN}`;
const KEY = `testkey-${RUN}`;
const SALT = `testsalt-${RUN}`;
const MERCHANT_ID = '123456';
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));
const PAYMENT_KEYS = ['payment.paytrMerchantId', 'payment.paytrMerchantKey', 'payment.paytrMerchantSalt', 'payment.paytrTestMode', 'payment.paytrCallbackAllowedIps'];

describe('POST /api/v1/payments/paytr/callback — PayTR bildirimi', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let repo: PaymentsRepository;
  let settings: SettingsService;
  let commerce: CommerceSettings;
  let baseUrl: string;
  let userId: string;
  let zoneId: string;
  let deliveryDateId: string;
  let deliveryOn: Date;
  let savedRows: Setting[] = [];
  const createdSubs: string[] = [];

  const post = async (form: Record<string, string>, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}/api/v1/payments/paytr/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
    });
    return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') ?? '' };
  };

  const signed = (merchantOid: string, status: 'success' | 'failed', totalAmount: string, extra: Record<string, string> = {}, callbackId?: string) => ({
    merchant_oid: merchantOid,
    status,
    total_amount: totalAmount,
    payment_amount: extra.payment_amount ?? totalAmount,
    payment_type: 'card',
    currency: 'TL',
    test_mode: '1',
    ...(callbackId ? { callback_id: callbackId } : {}),
    ...extra,
    hash: callbackHash({ merchantOid, status, totalAmount, callbackId: callbackId ?? null }, KEY, SALT),
  });

  const createOrder = async (grandTotal: number, opts: { kind?: 'SINGLE' | 'SUBSCRIPTION' | 'BOX_ONE_TIME'; subscriptionId?: string | null } = {}) =>
    prisma.order.create({
      data: {
        kind: opts.kind ?? 'SINGLE',
        status: 'PENDING_PAYMENT',
        userId,
        subscriptionId: opts.subscriptionId ?? null,
        customerName: 'PayTR Test',
        customerEmail: `paytr-${RUN}@test.local`,
        customerPhone: '+905000000000',
        zoneId,
        deliveryDateId,
        deliveryDay: 'SALI',
        deliveryOn,
        addressSnapshot: { fullName: 'PayTR Test', phone: '+905000000000', line: 'Test', zoneId, zoneName: 'PayTR Test', zip: null },
        subtotal: dec(grandTotal),
        discountTotal: dec(0),
        shippingFee: dec(0),
        vatTotal: dec(0),
        grandTotal: dec(grandTotal),
      },
    });

  const createCheckoutPayment = async (orderId: string, amount: number, conversationId: string) =>
    payments.recordPayment({ orderId, provider: 'PAYTR', kind: 'CHECKOUT', conversationId, amount, is3ds: true, isMerchantInitiated: false, providerToken: `tok-${conversationId}` });

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, SettingsModule, PaymentsModule, SubscriptionsModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    payments = app.get(PaymentsService);
    repo = app.get(PaymentsRepository);
    settings = app.get(SettingsService);
    commerce = await settings.getCommerce();

    // PayTR test yapılandırması Setting'e yazılır (ham satırlar sonda geri konur)
    savedRows = await prisma.setting.findMany({ where: { key: { in: PAYMENT_KEYS } } });
    await settings.set('payment', { paytrMerchantId: MERCHANT_ID, paytrMerchantKey: KEY, paytrMerchantSalt: SALT, paytrTestMode: true, paytrCallbackAllowedIps: '' });

    const user = await prisma.user.create({ data: { email: `paytr-${RUN}@test.local`, passwordHash: 'x', name: 'PayTR Test' } });
    userId = user.id;
    const zone = await prisma.deliveryZone.create({
      data: { name: 'PayTR Test', slug: ZONE_SLUG, fee: dec(49), freeThreshold: dec(1000), capacityPerDay: 999, isActive: true, sortOrder: 971 },
    });
    zoneId = zone.id;
    const slot = nextDeliveryDateFor('SALI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    deliveryOn = isoDateToUtc(slot.date);
    const dd = await prisma.deliveryDate.create({
      data: { zoneId, day: 'SALI', date: deliveryOn, cutoffAt: computeCutoffAt(slot.date, commerce.cutoff, DEFAULT_TZ), capacity: 999, reserved: 0, status: 'OPEN' },
    });
    deliveryDateId = dd.id;
  });

  afterAll(async () => {
    try {
      if (userId) {
        const orders = await prisma.order.findMany({ where: { userId }, select: { id: true } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
        // callback → Order PAID yan etkisi `mail.order-paid` MailLog + DISABLE_MAIL önizlemesi üretir → yetim satır/dosya bırakma
        await deleteMailLogsWithPreviews(prisma, { OR: [{ entityId: { in: orders.map((o) => o.id) } }, { to: `paytr-${RUN}@test.local` }] });
        if (createdSubs.length > 0) {
          await prisma.subscriptionCycle.deleteMany({ where: { subscriptionId: { in: createdSubs } } });
          await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId: { in: createdSubs } } });
        }
        await prisma.order.deleteMany({ where: { userId } });
        if (createdSubs.length > 0) await prisma.subscription.deleteMany({ where: { id: { in: createdSubs } } });
        await prisma.paymentMethod.deleteMany({ where: { userId } });
      }
      await prisma.webhookEvent.deleteMany({ where: { provider: 'PAYTR', providerRef: { contains: RUN } } });
      if (deliveryDateId) await prisma.deliveryDate.deleteMany({ where: { id: deliveryDateId } });
      if (zoneId) await prisma.deliveryZone.deleteMany({ where: { id: zoneId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      // Setting satırlarını ham hâliyle geri koy (yoksa sil)
      await prisma.setting.deleteMany({ where: { key: { in: PAYMENT_KEYS } } });
      for (const row of savedRows) {
        await prisma.setting.create({ data: { key: row.key, group: row.group, value: row.value as Prisma.InputJsonValue, isSecret: row.isSecret } });
      }
      settings.invalidate('payment');
    } finally {
      await app?.close();
    }
  });

  it('eksik alan → 400 düz metin; geçersiz hash → 400 "PAYTR notification failed: bad hash" (WebhookEvent yazılmaz)', async () => {
    const missing = await post({ merchant_oid: `ordx${RUN}`, status: 'success' });
    expect(missing.status).toBe(400);
    expect(missing.contentType).toContain('text/plain');
    expect(missing.text).toContain('missing fields');

    const bad = await post({ merchant_oid: `ordbad${RUN}`, status: 'success', total_amount: '100', hash: 'gecersiz' });
    expect(bad.status).toBe(400);
    expect(bad.text).toBe(PAYTR_CALLBACK_BAD_HASH);
    expect(await prisma.webhookEvent.count({ where: { provider: 'PAYTR', providerRef: `ordbad${RUN}:success` } })).toBe(0);
  });

  it('IP allowlist: Setting payment.paytrCallbackAllowedIps dışından → 403; listede → işlenir', async () => {
    const order = await createOrder(100);
    const oid = `ordip${RUN}`;
    await createCheckoutPayment(order.id, 100, oid);
    await settings.set('payment', { paytrCallbackAllowedIps: '10.0.0.1' });
    try {
      const rejected = await post(signed(oid, 'success', '10000'));
      expect(rejected.status).toBe(403);
      expect(rejected.text).toBe(PAYTR_CALLBACK_IP_REJECTED);
      expect((await payments.findByConversationId(oid))?.status).toBe('PENDING');
      await settings.set('payment', { paytrCallbackAllowedIps: '127.0.0.1, ::1, 10.0.0.1' });
      const ok = await post(signed(oid, 'success', '10000'));
      expect(ok.status).toBe(200);
      expect(ok.text).toBe(PAYTR_CALLBACK_OK);
      expect((await payments.findByConversationId(oid))?.status).toBe('SUCCEEDED');
    } finally {
      await settings.set('payment', { paytrCallbackAllowedIps: '' });
    }
  });

  it('geçerli success → "OK" + WebhookEvent PROCESSED (utoken/ctoken maskeli) + Payment SUCCEEDED (providerPaymentId=merchant_oid) + Order PAID + PaymentMethod; ikinci teslim IGNORED', async () => {
    const order = await createOrder(649);
    const oid = `ordok${RUN}`;
    const payment = await createCheckoutPayment(order.id, 649, oid);
    const res = await post(signed(oid, 'success', '64900', { utoken: `UTOK-${RUN}`, ctoken: `CTOK-${RUN}`, masked_pan: '454360******0001', kart_marka: 'VISA' }));
    expect(res.status).toBe(200);
    expect(res.text).toBe(PAYTR_CALLBACK_OK);
    expect(res.contentType).toContain('text/plain');

    const event = await prisma.webhookEvent.findUnique({ where: { provider_eventType_providerRef: { provider: 'PAYTR', eventType: 'callback', providerRef: `${oid}:success` } } });
    expect(event?.status).toBe('PROCESSED');
    expect(event?.signatureValid).toBe(true);
    expect((event?.payload as Record<string, string>).utoken).toBe('***');
    expect((event?.payload as Record<string, string>).ctoken).toBe('***');
    expect((event?.payload as Record<string, string>).merchant_oid).toBe(oid);

    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe('SUCCEEDED');
    expect(paid.providerPaymentId).toBe(oid);
    expect(paid.paidAt).not.toBeNull();
    const pm = await prisma.paymentMethod.findFirst({ where: { userId, provider: 'PAYTR', providerCardToken: `CTOK-${RUN}` } });
    expect(pm).toMatchObject({ providerCustomerKey: `UTOK-${RUN}`, last4: '0001', bin: '454360', brand: 'VISA', isDefault: true, isActive: true });
    expect(paid.paymentMethodId).toBe(pm!.id);
    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paidOrder.status).toBe('PAID');
    expect(paidOrder.paidAt).not.toBeNull();

    // Çift teslim: aynı (merchant_oid,status) → OK, satır eklenmez, durum değişmez
    const again = await post(signed(oid, 'success', '64900'));
    expect(again.status).toBe(200);
    expect(again.text).toBe(PAYTR_CALLBACK_OK);
    expect(await prisma.webhookEvent.count({ where: { provider: 'PAYTR', providerRef: `${oid}:success` } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCEEDED');
  });

  it('failed → Payment FAILED (PAYTR_<kod>) + Order PAYMENT_FAILED; ardından aynı ödemeye success → terminal (soft FAILED, OK)', async () => {
    const order = await createOrder(200);
    const oid = `ordfail${RUN}`;
    const payment = await createCheckoutPayment(order.id, 200, oid);
    const res = await post(signed(oid, 'failed', '0', { failed_reason_code: '6', failed_reason_msg: 'Yetersiz bakiye' }));
    expect(res.status).toBe(200);
    expect(res.text).toBe(PAYTR_CALLBACK_OK);
    const failed = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'PAYTR_6', failureMessage: 'Yetersiz bakiye' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');

    const late = await post(signed(oid, 'success', '20000'));
    expect(late.status).toBe(200);
    expect(late.text).toBe(PAYTR_CALLBACK_OK);
    const ev = await prisma.webhookEvent.findUnique({ where: { provider_eventType_providerRef: { provider: 'PAYTR', eventType: 'callback', providerRef: `${oid}:success` } } });
    expect(ev?.status).toBe('FAILED');
    expect(ev?.error).toMatch(/FAILED|INVALID|terminal|durumunda/i);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });

  it('tutar uyuşmazlığı (payment_amount ≠ Payment.amount) → OK ama WebhookEvent FAILED, Payment PENDING kalır; bilinmeyen merchant_oid → OK + FAILED', async () => {
    const order = await createOrder(300);
    const oid = `ordamt${RUN}`;
    const payment = await createCheckoutPayment(order.id, 300, oid);
    const res = await post(signed(oid, 'success', '29900'));
    expect(res.status).toBe(200);
    expect(res.text).toBe(PAYTR_CALLBACK_OK);
    const ev = await prisma.webhookEvent.findUnique({ where: { provider_eventType_providerRef: { provider: 'PAYTR', eventType: 'callback', providerRef: `${oid}:success` } } });
    expect(ev?.status).toBe('FAILED');
    expect(ev?.error).toContain('Tutar uyuşmazlığı');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT');

    // Yeniden teslim (önceki FAILED) → yeniden işlenir; doğru tutarla gelirse SUCCEEDED
    const fixed = await post(signed(oid, 'success', '30000'));
    expect(fixed.text).toBe(PAYTR_CALLBACK_OK);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCEEDED');

    const unknown = await post(signed(`ordyok${RUN}`, 'success', '100'));
    expect(unknown.status).toBe(200);
    expect(unknown.text).toBe(PAYTR_CALLBACK_OK);
    const evUnknown = await prisma.webhookEvent.findUnique({ where: { provider_eventType_providerRef: { provider: 'PAYTR', eventType: 'callback', providerRef: `ordyok${RUN}:success` } } });
    expect(evUnknown?.status).toBe('FAILED');
    expect(evUnknown?.error).toContain('Ödeme bulunamadı');
  });

  it('LINK ödemesi (lnk_<cycleId>_1): PayTR merchant_oid farklı, callback_id alfanümerik eşleme → Payment SUCCEEDED + cycle CHARGED + Order PAID', async () => {
    const tier = await prisma.boxTier.findFirstOrThrow({ where: { isActive: true } });
    const sub = await prisma.subscription.create({
      data: { userId, tierId: tier.id, status: 'ACTIVE', deliveryDay: 'SALI', zoneId, chargeStrategy: 'PAYMENT_LINK', startedAt: new Date() },
    });
    createdSubs.push(sub.id);
    const order = await createOrder(384.5, { kind: 'SUBSCRIPTION', subscriptionId: sub.id });
    const cycle = await prisma.subscriptionCycle.create({
      data: { subscriptionId: sub.id, cycleNo: 2, deliveryDateId, status: 'AWAITING_PAYMENT', orderId: order.id, total: dec(384.5), boxPrice: dec(384.5), paymentDueAt: new Date(Date.now() + 3_600_000) },
    });
    const conversationId = `lnk_${cycle.id}_1`;
    const payment = await payments.recordPayment({ orderId: order.id, provider: 'PAYTR', kind: 'LINK', conversationId, amount: 384.5, is3ds: true, isMerchantInitiated: false, linkToken: 'a'.repeat(32), linkExpiresAt: new Date(Date.now() + 3_600_000) });
    const callbackId = conversationId.replace(/[^A-Za-z0-9]/g, '');
    expect(await repo.findPaymentByMerchantOid(callbackId)).toMatchObject({ id: payment.id });

    const res = await post(signed(`PAYTR${RUN}X`, 'success', '38450', {}, callbackId));
    expect(res.status).toBe(200);
    expect(res.text).toBe(PAYTR_CALLBACK_OK);
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(settled.status).toBe('SUCCEEDED');
    expect((await prisma.subscriptionCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status).toBe('CHARGED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    const ev = await prisma.webhookEvent.findUnique({ where: { provider_eventType_providerRef: { provider: 'PAYTR', eventType: 'callback', providerRef: `PAYTR${RUN}X:success` } } });
    expect(ev?.status).toBe('PROCESSED');
  });
});
