// F7 — PaymentsModule (gerçek Nest uygulaması + rastgele port, gerçek DB bagdam_dev). Guard'lar test modülünde YOK.
// Kapsam: ManualProvider başarı/başarısız (token öneki + setOutcome) · PaymentProviderFactory · MIT charge → Payment SUCCEEDED/FAILED,
// conversationId idempotency (409) · PaymentLink issue → linkToken 32 hex + linkExpiresAt = now + paymentLinkHours · GET /pay/:token JSON ·
// expireLinksDue · WebhookEvent unique ile çift teslim IGNORED · refund (kısmi → tam) · ChargeStrategyResolver fallback · state machine 409.
// Test verisi: kullanıcı + `test-pay-<run>` bölgesi/tarih + Order/PaymentMethod satırları (doğrudan Prisma); sonda silinir.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ConflictException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { computeCutoffAt, DEFAULT_TZ, isoDateToUtc, nextDeliveryDateFor, type CommerceSettings, type PaymentLinkInfo } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { ChargeStrategyResolver, MerchantInitiatedCharge, PaymentLinkCharge } from '../../modules/payments/charge/charge-strategy';
import { LINK_TOKEN_RE, MANUAL_FAIL_TOKEN_PREFIX } from '../../modules/payments/payments.constants';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PaymentsService } from '../../modules/payments/payments.service';
import { ManualProvider } from '../../modules/payments/providers/manual.provider';
import { PaymentProviderFactory } from '../../modules/payments/providers/payment-provider.factory';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const ZONE_SLUG = `test-pay-${RUN}`;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('PaymentsModule — ManualProvider · ChargeStrategy (MIT / LINK) · PaymentsService · GET /api/v1/pay/:linkToken', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let manual: ManualProvider;
  let factory: PaymentProviderFactory;
  let mit: MerchantInitiatedCharge;
  let link: PaymentLinkCharge;
  let resolver: ChargeStrategyResolver;
  let settings: SettingsService;
  let commerce: CommerceSettings;
  let baseUrl: string;
  let userId: string;
  let zoneId: string;
  let deliveryDateId: string;
  let deliveryOn: Date;
  let okCard: { id: string; provider: 'MANUAL'; providerCustomerKey: string; providerCardToken: string; last4: string };
  let failCard: typeof okCard;
  let hadProviderRow = false;

  const api = async (method: string, path: string) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, { method });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, body: json, headers: res.headers };
  };

  const createOrder = async (grandTotal: number, kind: 'SUBSCRIPTION' | 'SINGLE' = 'SUBSCRIPTION') =>
    prisma.order.create({
      data: {
        kind,
        status: 'PENDING_PAYMENT',
        userId,
        customerName: 'Ödeme Test',
        customerEmail: `pay-${RUN}@test.local`,
        customerPhone: '+905000000000',
        zoneId,
        deliveryDateId,
        deliveryDay: 'SALI',
        deliveryOn,
        addressSnapshot: { fullName: 'Ödeme Test', phone: '+905000000000', line: 'Test', zoneId, zoneName: 'Pay Test', zip: null },
        subtotal: dec(grandTotal),
        discountTotal: dec(0),
        shippingFee: dec(0),
        vatTotal: dec(0),
        grandTotal: dec(grandTotal),
      },
    });

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, SettingsModule, PaymentsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    payments = app.get(PaymentsService);
    manual = app.get(ManualProvider);
    factory = app.get(PaymentProviderFactory);
    mit = app.get(MerchantInitiatedCharge);
    link = app.get(PaymentLinkCharge);
    resolver = app.get(ChargeStrategyResolver);
    settings = app.get(SettingsService);
    commerce = await settings.getCommerce();

    // Aktif sağlayıcı testte manuel olmalı (Setting satırı yoksa env/varsayılan zaten manual; varsa sonda geri alınır)
    hadProviderRow = (await prisma.setting.findUnique({ where: { key: 'payment.provider' } })) !== null;
    if ((await factory.resolveName()) !== 'manual') await settings.set('payment', { provider: 'manual' });

    const user = await prisma.user.create({ data: { email: `pay-${RUN}@test.local`, passwordHash: 'x', name: 'Ödeme Test' } });
    userId = user.id;
    const zone = await prisma.deliveryZone.create({
      data: { name: 'Pay Test', slug: ZONE_SLUG, fee: dec(49), freeThreshold: dec(1000), capacityPerDay: 999, isActive: true, sortOrder: 970 },
    });
    zoneId = zone.id;
    const slot = nextDeliveryDateFor('SALI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    deliveryOn = isoDateToUtc(slot.date);
    const dd = await prisma.deliveryDate.create({
      data: { zoneId, day: 'SALI', date: deliveryOn, cutoffAt: computeCutoffAt(slot.date, commerce.cutoff, DEFAULT_TZ), capacity: 999, reserved: 0, status: 'OPEN' },
    });
    deliveryDateId = dd.id;
    const ok = await prisma.paymentMethod.create({
      data: { userId, provider: 'MANUAL', providerCustomerKey: `cust_${RUN}`, providerCardToken: `ok:card-${RUN}`, last4: '0001', brand: 'TEST', isDefault: true },
    });
    okCard = { id: ok.id, provider: 'MANUAL', providerCustomerKey: ok.providerCustomerKey, providerCardToken: ok.providerCardToken, last4: ok.last4 };
    const fail = await prisma.paymentMethod.create({
      data: { userId, provider: 'MANUAL', providerCustomerKey: `cust_${RUN}`, providerCardToken: `${MANUAL_FAIL_TOKEN_PREFIX}card-${RUN}`, last4: '0002', isDefault: false },
    });
    failCard = { id: fail.id, provider: 'MANUAL', providerCustomerKey: fail.providerCustomerKey, providerCardToken: fail.providerCardToken, last4: fail.last4 };
  });

  afterAll(async () => {
    try {
      manual.resetOutcome();
      if (userId) {
        const orders = await prisma.order.findMany({ where: { userId }, select: { id: true } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } }); // Refund cascade
        await prisma.order.deleteMany({ where: { userId } });
        await prisma.paymentMethod.deleteMany({ where: { userId } });
      }
      await prisma.webhookEvent.deleteMany({ where: { providerRef: { startsWith: `ref-${RUN}` } } });
      if (deliveryDateId) await prisma.deliveryDate.deleteMany({ where: { id: deliveryDateId } });
      if (zoneId) await prisma.deliveryZone.deleteMany({ where: { id: zoneId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      if (!hadProviderRow) {
        await prisma.setting.deleteMany({ where: { key: 'payment.provider' } });
        settings.invalidate('payment');
      }
    } finally {
      await app?.close();
    }
  });

  // ── ManualProvider + Factory ──────────────────────────────────────────────────────────────────────────────────────

  it('ManualProvider: ok token → SUCCEEDED (man_pay_…); fail: öneki → FAILED MANUAL_DECLINED; setOutcome ezer; reset geri alır', async () => {
    const ok = await manual.chargeStoredCard(okCard, 100, `t_${RUN}_1`);
    expect(ok.ok).toBe(true);
    expect(ok.providerPaymentId).toMatch(/^man_pay_[a-f0-9]{12}$/);
    const fail = await manual.chargeStoredCard(failCard, 100, `t_${RUN}_2`);
    expect(fail).toMatchObject({ ok: false, providerPaymentId: null, failureCode: 'MANUAL_DECLINED' });

    const seen: string[] = [];
    manual.setOutcome(({ conversationId }) => {
      seen.push(conversationId);
      return 'FAILED';
    });
    try {
      const forced = await manual.chargeStoredCard(okCard, 100, `t_${RUN}_3`);
      expect(forced.ok).toBe(false);
      expect(seen).toEqual([`t_${RUN}_3`]);
      manual.setOutcome(() => ({ ok: true, providerPaymentId: 'custom_1', failureCode: null, failureMessage: null }));
      expect((await manual.chargeStoredCard(failCard, 1, `t_${RUN}_4`)).providerPaymentId).toBe('custom_1');
    } finally {
      manual.resetOutcome();
    }
    expect((await manual.chargeStoredCard(failCard, 1, `t_${RUN}_5`)).ok).toBe(false);

    const verified = manual.verifyWebhook(JSON.stringify({ eventType: 'payment.succeeded', providerRef: 'x' }), 'manual');
    expect(verified).toMatchObject({ valid: true, eventType: 'payment.succeeded', providerRef: 'x' });
    expect(manual.verifyWebhook('{bozuk', 'manual').valid).toBe(false);
    expect(manual.verifyWebhook('{}', 'yanlış').valid).toBe(false);
  });

  it('PaymentProviderFactory: aktif manual; get(iyzico) → 503 PAYMENT_PROVIDER_UNAVAILABLE (F8); getByEnum(MANUAL) → ManualProvider', async () => {
    expect(await factory.resolveName()).toBe('manual');
    expect((await factory.getActive()).name).toBe('manual');
    expect(factory.getByEnum('MANUAL')).toBe(manual);
    expect(() => factory.get('iyzico')).toThrow(/etkin değil/);
    try {
      factory.getByEnum('PAYTR');
      throw new Error('fırlatmalıydı');
    } catch (err) {
      expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({ error: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    }
    expect(factory.listProviders()).toEqual(['manual']);
  });

  // ── MIT charge ────────────────────────────────────────────────────────────────────────────────────────────────────

  it('MerchantInitiatedCharge.charge: ok kart → Payment SUCCEEDED (CYCLE_CHARGE, isMerchantInitiated, is3ds=false, paidAt, cyc_<cycle>_1); aynı attempt → 409 PAYMENT_DUPLICATE', async () => {
    const order = await createOrder(384.5);
    const cycle = { id: `cyc-ok-${RUN}`, cycleNo: 2 };
    const res = await mit.charge(cycle, order, okCard);
    expect(res.status).toBe('SUCCEEDED');
    expect(res.amount).toBe(384.5);
    expect(res.conversationId).toBe(`cyc_${cycle.id}_1`);
    expect(res.providerPaymentId).toMatch(/^man_pay_/);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(row).toMatchObject({
      orderId: order.id,
      provider: 'MANUAL',
      kind: 'CYCLE_CHARGE',
      status: 'SUCCEEDED',
      isMerchantInitiated: true,
      is3ds: false,
      attemptNo: 1,
      paymentMethodId: okCard.id,
      failureCode: null,
    });
    expect(row.paidAt).not.toBeNull();
    expect(Number(row.amount.toString())).toBe(384.5);

    await expect(mit.charge(cycle, order, okCard, { attemptNo: 1 })).rejects.toMatchObject({ response: { error: 'PAYMENT_DUPLICATE' } });
    // attemptNo verilmezse Order'daki Payment sayısı + 1 → yeni conversationId
    const second = await mit.charge(cycle, order, okCard, { kind: 'RETRY' });
    expect(second.conversationId).toBe(`cyc_${cycle.id}_2`);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } })).kind).toBe('RETRY');
  });

  it('MerchantInitiatedCharge.charge: fail kartı → Payment FAILED (MANUAL_DECLINED); RETRY attempt 2 ok kartla → SUCCEEDED; sağlayıcı istisnası → FAILED PROVIDER_ERROR', async () => {
    const order = await createOrder(200);
    const cycle = { id: `cyc-fail-${RUN}`, cycleNo: 3 };
    const failed = await mit.charge(cycle, order, failCard);
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('MANUAL_DECLINED');
    expect(failed.failureMessage).toMatch(/reddedildi/);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: failed.paymentId } });
    expect(row.status).toBe('FAILED');
    expect(row.paidAt).toBeNull();

    const retry = await mit.charge(cycle, order, okCard, { kind: 'RETRY', attemptNo: 2 });
    expect(retry.status).toBe('SUCCEEDED');
    expect(retry.conversationId).toBe(`cyc_${cycle.id}_2`);

    // FAILED terminal: tekrar başarıya çekilemez → 409 INVALID_TRANSITION
    await expect(payments.markSucceeded(failed.paymentId)).rejects.toMatchObject({ response: { error: 'INVALID_TRANSITION' } });
    // SUCCEEDED idempotent
    expect((await payments.markSucceeded(retry.paymentId)).status).toBe('SUCCEEDED');

    manual.setOutcome(() => {
      throw new Error('sağlayıcı zaman aşımı (simülasyon)');
    });
    try {
      const err = await mit.charge(cycle, order, okCard, { attemptNo: 3 });
      expect(err.status).toBe('FAILED');
      expect(err.failureCode).toBe('PROVIDER_ERROR');
    } finally {
      manual.resetOutcome();
    }
  });

  // ── Payment link + GET /pay/:token ────────────────────────────────────────────────────────────────────────────────

  it('PaymentLinkCharge.issue → Payment LINK (is3ds, lnk_<cycle>_1), linkToken 32 hex, linkExpiresAt = now + paymentLinkHours, linkUrl /api/v1/pay/<token>', async () => {
    const order = await createOrder(649);
    const cycle = { id: `cyc-link-${RUN}`, cycleNo: 2 };
    const now = new Date('2026-09-01T09:00:00.000Z');
    const issued = await link.issue(cycle, order, { now });
    expect(issued.status).toBe('AWAITING_PAYMENT');
    expect(issued.linkToken).toMatch(LINK_TOKEN_RE);
    expect(issued.linkUrl.endsWith(`/api/v1/pay/${issued.linkToken}`)).toBe(true);
    expect(new Date(issued.linkExpiresAt).getTime()).toBe(now.getTime() + commerce.paymentLinkHours * 3_600_000);
    expect(issued.conversationId).toBe(`lnk_${cycle.id}_1`);
    expect(issued.amount).toBe(649);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: issued.paymentId } });
    expect(row).toMatchObject({ kind: 'LINK', status: 'PENDING', is3ds: true, isMerchantInitiated: false, provider: 'MANUAL', linkToken: issued.linkToken });
    expect(row.linkExpiresAt?.toISOString()).toBe(issued.linkExpiresAt);

    // Public JSON
    const res = await api('GET', `/pay/${issued.linkToken}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const info = res.body as PaymentLinkInfo;
    expect(info).toEqual({ status: 'PENDING', amount: 649, expiresAt: issued.linkExpiresAt, expired: false, orderNo: order.orderNo });

    // Süre dolunca: expireLinksDue(now + süre) → EXPIRED; GET expired:true
    const expired = await payments.expireLinksDue(new Date(new Date(issued.linkExpiresAt).getTime() + 1));
    expect(expired.some((p) => p.id === issued.paymentId)).toBe(true);
    const after = await api('GET', `/pay/${issued.linkToken}`);
    expect((after.body as PaymentLinkInfo).status).toBe('EXPIRED');
    expect((after.body as PaymentLinkInfo).expired).toBe(true);
    // EXPIRED terminal: başarıya çekilemez
    await expect(payments.markSucceeded(issued.paymentId)).rejects.toMatchObject({ response: { error: 'INVALID_TRANSITION' } });

    // Yeniden link: attempt 2
    const reissued = await link.issue(cycle, order, { hours: 1 });
    expect(reissued.conversationId).toBe(`lnk_${cycle.id}_2`);
    expect(reissued.linkToken).not.toBe(issued.linkToken);
  });

  it('GET /pay/:token: bilinmeyen 32 hex → 404 PAYMENT_LINK_NOT_FOUND; biçimsiz → 400', async () => {
    const missing = await api('GET', `/pay/${'0'.repeat(32)}`);
    expect(missing.status).toBe(404);
    expect((missing.body as ErrorBody).error).toBe('PAYMENT_LINK_NOT_FOUND');
    expect((await api('GET', '/pay/kisa')).status).toBe(400);
    expect((await api('GET', `/pay/${'G'.repeat(32)}`)).status).toBe(400);
  });

  // ── WebhookEvent idempotency ──────────────────────────────────────────────────────────────────────────────────────

  it('recordWebhookEvent: ilk teslim RECEIVED (duplicate:false); aynı (provider,eventType,providerRef) ikinci teslim IGNORED (duplicate:true, satır eklenmez); PROCESSED/FAILED', async () => {
    const providerRef = `ref-${RUN}-1`;
    const first = await payments.recordWebhookEvent({ provider: 'MANUAL', eventType: 'payment.succeeded', providerRef, payload: { a: 1 }, signatureValid: true });
    expect(first.duplicate).toBe(false);
    expect(first.status).toBe('RECEIVED');
    const second = await payments.recordWebhookEvent({ provider: 'MANUAL', eventType: 'payment.succeeded', providerRef, payload: { a: 2 }, signatureValid: true });
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe('IGNORED');
    expect(second.id).toBe(first.id);
    expect(await prisma.webhookEvent.count({ where: { provider: 'MANUAL', eventType: 'payment.succeeded', providerRef } })).toBe(1);
    // Farklı eventType aynı ref → yeni satır
    const other = await payments.recordWebhookEvent({ provider: 'MANUAL', eventType: 'payment.failed', providerRef, payload: {}, signatureValid: false });
    expect(other.duplicate).toBe(false);

    const processed = await payments.markWebhookProcessed(first.id);
    expect(processed.status).toBe('PROCESSED');
    expect(processed.processedAt).not.toBeNull();
    const failed = await payments.markWebhookFailed(other.id, 'imza geçersiz');
    expect(failed).toMatchObject({ status: 'FAILED', error: 'imza geçersiz' });
  });

  // ── Refund ────────────────────────────────────────────────────────────────────────────────────────────────────────

  it('refund: 500 TL ödemeden 100 → PARTIAL_REFUNDED; 400 → REFUNDED; tekrar → 409 PAYMENT_NOT_REFUNDABLE; aşım/negatif → 400', async () => {
    const order = await createOrder(500);
    const charged = await mit.charge({ id: `cyc-ref-${RUN}` }, order, okCard);
    expect(charged.status).toBe('SUCCEEDED');

    await expect(payments.refund(charged.paymentId, 600)).rejects.toMatchObject({ response: { error: 'REFUND_AMOUNT_EXCEEDS' } });
    await expect(payments.refund(charged.paymentId, 0)).rejects.toMatchObject({ response: { error: 'REFUND_AMOUNT_INVALID' } });

    const partial = await payments.refund(charged.paymentId, 100, { reason: 'ayıplı ürün' });
    expect(partial.ok).toBe(true);
    expect(partial.refund.status).toBe('SUCCEEDED');
    expect(partial.refund.providerRefundId).toMatch(/^man_ref_/);
    expect(partial.payment.status).toBe('PARTIAL_REFUNDED');
    expect(partial.refundedTotal).toBe(100);

    await expect(payments.refund(charged.paymentId, 400.01)).rejects.toMatchObject({ response: { error: 'REFUND_AMOUNT_EXCEEDS' } });
    const full = await payments.refund(charged.paymentId, 400);
    expect(full.payment.status).toBe('REFUNDED');
    expect(full.refundedTotal).toBe(500);
    expect(await prisma.refund.count({ where: { paymentId: charged.paymentId, status: 'SUCCEEDED' } })).toBe(2);

    await expect(payments.refund(charged.paymentId, 1)).rejects.toBeInstanceOf(ConflictException);
    // Tahsil edilmemiş ödeme iade edilemez
    const pendingLink = await link.issue({ id: `cyc-ref2-${RUN}` }, order);
    await expect(payments.refund(pendingLink.paymentId, 1)).rejects.toMatchObject({ response: { error: 'PAYMENT_NOT_REFUNDABLE' } });
  });

  // ── Resolver ──────────────────────────────────────────────────────────────────────────────────────────────────────

  it('ChargeStrategyResolver.for: MIT + kart → MIT; MIT kartsız/pasif → PAYMENT_LINK (NO_STORED_CARD); PAYMENT_LINK → LINK', () => {
    const a = resolver.for({ chargeStrategy: 'MERCHANT_INITIATED', paymentMethodId: okCard.id });
    expect(a.kind).toBe('MERCHANT_INITIATED');
    expect(a.fallbackReason).toBeNull();
    expect(a.strategy).toBe(mit);
    const b = resolver.for({ chargeStrategy: 'MERCHANT_INITIATED', paymentMethodId: null });
    expect(b).toMatchObject({ kind: 'PAYMENT_LINK', fallbackReason: 'NO_STORED_CARD' });
    expect(b.strategy).toBe(link);
    const c = resolver.for({ chargeStrategy: 'MERCHANT_INITIATED', paymentMethodId: okCard.id, paymentMethod: { isActive: false, deletedAt: null } });
    expect(c.kind).toBe('PAYMENT_LINK');
    const d = resolver.for({ chargeStrategy: 'PAYMENT_LINK', paymentMethodId: okCard.id });
    expect(d).toMatchObject({ kind: 'PAYMENT_LINK', fallbackReason: null });
  });
});
