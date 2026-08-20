// F8 — PayTrProvider birim testleri: HTTP `PAYTR_HTTP` mock'lanır (gerçek PayTR'ye istek ATILMAZ), yapılandırma sahte PayTrConfigService.
// Kapsam: initCheckout istek alanları + hash + iframe/redirect; token hatası → 502; chargeStoredCard (kapalı → 503 PROVIDER_FEATURE_DISABLED;
// açık → recurring alanları + success/failed/wait_callback eşlemesi); refund isteği/eşlemesi; retrieve; createPaymentLink/deletePaymentLink;
// verifyWebhook (yapılandırma yüklü/yüklü değil).
import '../helpers/env';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PROVIDER_FEATURE_DISABLED } from '@bagdam/shared';
import type { PayTrConfig, PayTrConfigService } from '../../modules/payments/providers/paytr/paytr.config';
import { buildUserBasket, iframeTokenHash } from '../../modules/payments/providers/paytr/paytr.hash';
import type { PayTrHttp, PayTrHttpResponse } from '../../modules/payments/providers/paytr/paytr.http';
import { buildIframeHtml, PayTrProvider } from '../../modules/payments/providers/paytr/paytr.provider';
import { PAYTR_ENDPOINTS } from '../../modules/payments/providers/paytr/paytr.types';

const KEY = 'testkey1234567890';
const SALT = 'testsalt1234567890';
const MERCHANT_ID = '123456';
const hmac = (data: string) => createHmac('sha256', KEY).update(data).digest('base64');

function makeConfig(over: Partial<PayTrConfig> = {}): PayTrConfig {
  return {
    merchantId: MERCHANT_ID,
    merchantKey: KEY,
    merchantSalt: SALT,
    testMode: true,
    callbackAllowedIps: [],
    storedCardEnabled: false,
    nonThreeDsGranted: false,
    maxInstallment: 1,
    noInstallment: 1,
    currency: 'TL',
    enabled: true,
    configured: true,
    ...over,
  };
}

interface Call {
  url: string;
  form: Record<string, string>;
}

/** Sıradaki yanıtları kuyruktan veren mock HTTP; çağrıları kaydeder. */
class MockHttp implements PayTrHttp {
  calls: Call[] = [];
  queue: PayTrHttpResponse[] = [];
  async postForm(url: string, form: Record<string, string>): Promise<PayTrHttpResponse> {
    this.calls.push({ url, form });
    const next = this.queue.shift();
    if (!next) throw new Error(`mock http: beklenmeyen istek ${url}`);
    return next;
  }
  reply(json: unknown, status = 200): void {
    this.queue.push({ status, body: typeof json === 'string' ? json : JSON.stringify(json) });
  }
}

function makeProvider(cfg: PayTrConfig): { provider: PayTrProvider; http: MockHttp; config: { loads: number } } {
  const http = new MockHttp();
  const state = { loads: 0 };
  const fakeConfig = {
    load: async () => {
      state.loads++;
      return cfg;
    },
    requireConfigured: (c: PayTrConfig) => {
      if (!c.configured) throw new ServiceUnavailableException({ message: 'PayTR yok', error: 'PAYTR_NOT_CONFIGURED' });
      return c;
    },
  } as unknown as PayTrConfigService;
  return { provider: new PayTrProvider(fakeConfig, http), http, config: state };
}

const ORDER = { orderId: 'ord-id-1', orderNo: 1001, amount: 649, customer: { id: 'u1', email: 'musteri@test.local', name: 'Ayşe Yılmaz', phone: '+905001112233' } };

describe('PayTrProvider (mock HTTP)', () => {
  const savedWebUrl = process.env.WEB_URL;
  beforeAll(() => {
    process.env.WEB_URL = 'https://www.bagdam.com';
  });
  afterAll(() => {
    if (savedWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = savedWebUrl;
  });

  it('initCheckout: get-token isteği doküman alanlarıyla + paytr_token; yanıt → token, iframe HTML, redirectUrl', async () => {
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'success', token: 'TOK123' });
    const basket = [{ name: 'Haftanın Kutusu', unitPrice: 649, qty: 1 }];
    const res = await provider.initCheckout(ORDER, {
      conversationId: 'ord1001ab12',
      callbackUrl: 'https://www.bagdam.com/api/v1/payments/paytr/callback',
      ip: '::ffff:85.100.1.2',
      basket,
      address: 'Urla, İzmir',
      saveCard: true, // storedCardEnabled=false → store_card GÖNDERİLMEZ
    });
    expect(res).toEqual({ providerToken: 'TOK123', redirectUrl: `${PAYTR_ENDPOINTS.iframeBase}TOK123`, checkoutFormContent: buildIframeHtml('TOK123') });
    expect(res.checkoutFormContent).toContain('iframeResizer.min.js');
    expect(res.checkoutFormContent).toContain('https://www.paytr.com/odeme/guvenli/TOK123');

    expect(http.calls).toHaveLength(1);
    const { url, form } = http.calls[0];
    expect(url).toBe(PAYTR_ENDPOINTS.getToken);
    const userBasket = buildUserBasket(basket);
    expect(form).toMatchObject({
      merchant_id: MERCHANT_ID,
      user_ip: '85.100.1.2',
      merchant_oid: 'ord1001ab12',
      email: 'musteri@test.local',
      payment_amount: '64900',
      user_basket: userBasket,
      debug_on: '1',
      no_installment: '1',
      max_installment: '1',
      user_name: 'Ayşe Yılmaz',
      user_address: 'Urla, İzmir',
      user_phone: '+905001112233',
      merchant_ok_url: 'https://www.bagdam.com/sepet.html?siparis=1001&odeme=ok',
      merchant_fail_url: 'https://www.bagdam.com/sepet.html?siparis=1001&odeme=hata',
      timeout_limit: '30',
      currency: 'TL',
      test_mode: '1',
      lang: 'tr',
    });
    expect(form.store_card).toBeUndefined();
    expect(form.paytr_token).toBe(
      iframeTokenHash({ merchantId: MERCHANT_ID, userIp: '85.100.1.2', merchantOid: 'ord1001ab12', email: 'musteri@test.local', paymentAmount: 64900, userBasket, noInstallment: 1, maxInstallment: 1, currency: 'TL', testMode: 1 }, KEY, SALT),
    );
    expect(form.paytr_token).toBe(hmac(`${MERCHANT_ID}85.100.1.2ord1001ab12musteri@test.local64900${userBasket}11TL1${SALT}`));
  });

  it('initCheckout: storedCardEnabled + saveCard → store_card=1 (+utoken); alt çizgili conversationId → merchant_oid alfanümerik; canlı modda test_mode=0/debug_on=0, taksit 3', async () => {
    const { provider, http } = makeProvider(makeConfig({ storedCardEnabled: true, testMode: false, maxInstallment: 3, noInstallment: 0 }));
    http.reply({ status: 'success', token: 'TOK2' });
    await provider.initCheckout(ORDER, { conversationId: 'chk_cm1abc', callbackUrl: '', saveCard: true, customerKey: 'UTOK1', ip: '1.2.3.4' });
    const form = http.calls[0].form;
    expect(form).toMatchObject({ merchant_oid: 'chkcm1abc', store_card: '1', utoken: 'UTOK1', test_mode: '0', debug_on: '0', max_installment: '3', no_installment: '0' });
    // basket verilmezse tek satır: sipariş tutarı
    expect(JSON.parse(Buffer.from(form.user_basket, 'base64').toString('utf8'))).toEqual([['Bağdam sipariş #1001', '649.00', 1]]);
  });

  it('initCheckout: PayTR failed → 502 PAYTR_TOKEN_FAILED; bozuk gövde → 502 PAYTR_BAD_RESPONSE; yapılandırma yok → 503', async () => {
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'failed', reason: 'paytr_token gecersiz' });
    await expect(provider.initCheckout(ORDER, { conversationId: 'ord1', callbackUrl: '' })).rejects.toMatchObject({ response: { error: 'PAYTR_TOKEN_FAILED' } });
    http.reply('<html>502</html>', 502);
    await expect(provider.initCheckout(ORDER, { conversationId: 'ord1', callbackUrl: '' })).rejects.toBeInstanceOf(BadGatewayException);
    const none = makeProvider(makeConfig({ merchantKey: '', configured: false }));
    await expect(none.provider.initCheckout(ORDER, { conversationId: 'ord1', callbackUrl: '' })).rejects.toMatchObject({ response: { error: 'PAYTR_NOT_CONFIGURED' } });
    expect(none.http.calls).toHaveLength(0);
  });

  it('chargeStoredCard: storedCardEnabled=false → 503 PROVIDER_FEATURE_DISABLED (HTTP çağrısı yok)', async () => {
    const { provider, http } = makeProvider(makeConfig({ storedCardEnabled: false }));
    await expect(provider.chargeStoredCard({ id: 'pm1', providerCustomerKey: 'UTOK', providerCardToken: 'CTOK', last4: '0001', email: 'a@b.co' }, 100, 'cyc_c1_1')).rejects.toMatchObject({
      response: { error: PROVIDER_FEATURE_DISABLED },
    });
    expect(http.calls).toHaveLength(0);
  });

  it('chargeStoredCard: açık → /odeme recurring isteği (non_3d=1, recurring_payment=1, utoken/ctoken, payment_amount "100.50", hash) → success/failed/wait_callback', async () => {
    const { provider, http } = makeProvider(makeConfig({ storedCardEnabled: true }));
    http.reply({ status: 'success', msg: 'Ödeme Başarılı.' });
    const ok = await provider.chargeStoredCard({ id: 'pm1', providerCustomerKey: 'UTOK', providerCardToken: 'CTOK', last4: '0001', email: 'a@b.co', holderName: 'Ayşe' }, 100.5, 'cyc_c1_1');
    expect(ok).toMatchObject({ ok: true, providerPaymentId: 'cycc11', failureCode: null });
    const form = http.calls[0].form;
    expect(http.calls[0].url).toBe(PAYTR_ENDPOINTS.directPayment);
    expect(form).toMatchObject({
      merchant_id: MERCHANT_ID,
      user_ip: '127.0.0.1',
      merchant_oid: 'cycc11',
      email: 'a@b.co',
      payment_type: 'card',
      payment_amount: '100.50',
      installment_count: '0',
      currency: 'TL',
      test_mode: '1',
      non_3d: '1',
      recurring_payment: '1',
      utoken: 'UTOK',
      ctoken: 'CTOK',
      user_name: 'Ayşe',
      client_lang: 'tr',
    });
    expect(form.paytr_token).toBe(hmac(`${MERCHANT_ID}127.0.0.1cycc11a@b.co100.50card0TL11${SALT}`));

    http.reply({ status: 'failed', msg: 'Yetersiz bakiye', try_again: 'false' });
    const failed = await provider.chargeStoredCard({ id: 'pm1', providerCustomerKey: 'UTOK', providerCardToken: 'CTOK', last4: '0001', email: 'a@b.co' }, 100, 'cyc_c1_2');
    expect(failed).toMatchObject({ ok: false, providerPaymentId: null, failureCode: 'PAYTR_DECLINED', failureMessage: 'Yetersiz bakiye' });

    http.reply({ status: 'wait_callback' });
    const wait = await provider.chargeStoredCard({ id: 'pm1', providerCustomerKey: 'UTOK', providerCardToken: 'CTOK', last4: '0001', email: 'a@b.co' }, 100, 'cyc_c1_3');
    expect(wait).toMatchObject({ ok: false, failureCode: 'PAYTR_WAIT_CALLBACK' });

    // e-posta yoksa 400 (MerchantInitiatedCharge PaymentMethod.user'dan doldurur)
    await expect(provider.chargeStoredCard({ id: 'pm1', providerCustomerKey: 'UTOK', providerCardToken: 'CTOK', last4: '0001' }, 100, 'cyc_c1_4')).rejects.toMatchObject({ response: { error: 'PAYTR_EMAIL_REQUIRED' } });
  });

  it('refund: /odeme/iade (merchant_oid = providerPaymentId, return_amount "10.25", hash) → ok / error eşlemesi', async () => {
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'success', is_test: 1, merchant_oid: 'ord1001ab12', return_amount: '10.25', reference_no: 'REF1' });
    const ok = await provider.refund({ id: 'p1', conversationId: 'ord1001ab12', providerPaymentId: 'ord1001ab12', amount: 649 }, 10.25);
    expect(ok).toMatchObject({ ok: true, providerRefundId: 'REF1' });
    const form = http.calls[0].form;
    expect(http.calls[0].url).toBe(PAYTR_ENDPOINTS.refund);
    expect(form).toMatchObject({ merchant_id: MERCHANT_ID, merchant_oid: 'ord1001ab12', return_amount: '10.25' });
    expect(form.reference_no).toMatch(/^[A-Za-z0-9]{1,64}$/);
    expect(form.paytr_token).toBe(hmac(`${MERCHANT_ID}ord1001ab1210.25${SALT}`));

    http.reply({ status: 'error', err_no: '006', err_msg: 'Iade tutari hatali' });
    const bad = await provider.refund({ id: 'p1', conversationId: 'cyc_c1_1', providerPaymentId: null, amount: 100 }, 5);
    expect(bad).toMatchObject({ ok: false, providerRefundId: null, failureCode: 'PAYTR_006', failureMessage: 'Iade tutari hatali' });
    expect(http.calls[1].form.merchant_oid).toBe('cycc11'); // providerPaymentId yoksa conversationId alfanümerik
  });

  it('retrieve: durum-sorgu (hash merchant_id+merchant_oid+salt) → success SUCCEEDED; error → PENDING (kanıt değil)', async () => {
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'success', payment_amount: '649.00', payment_total: '649.00', odeme_tipi: 'KART' });
    const ok = await provider.retrieve('ord1001ab12');
    expect(ok).toMatchObject({ status: 'SUCCEEDED', providerPaymentId: 'ord1001ab12' });
    expect(http.calls[0].url).toBe(PAYTR_ENDPOINTS.statusQuery);
    expect(http.calls[0].form).toMatchObject({ merchant_id: MERCHANT_ID, merchant_oid: 'ord1001ab12', paytr_token: hmac(`${MERCHANT_ID}ord1001ab12${SALT}`) });
    http.reply({ status: 'error', err_no: '004', err_msg: 'Islem bulunamadi' });
    const pending = await provider.retrieve('cyc_c1_1');
    expect(pending).toMatchObject({ status: 'PENDING', failureCode: 'PAYTR_004' });
    expect(http.calls[1].form.merchant_oid).toBe('cycc11');
  });

  it('createPaymentLink: collection (email) → link/create alanları + hash + expiry_date Europe/Istanbul + callback_link/callback_id; deletePaymentLink', async () => {
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'success', id: 'NB2Zlz3', link: 'https://www.paytr.com/link/NB2Zlz3' });
    const link = await provider.createPaymentLink({ amount: 384.5, name: 'Bağdam kutu #12', conversationId: 'lnk_cm1abc_1', email: 'a@b.co', expiresAt: new Date('2026-09-01T17:00:00+03:00') });
    expect(link).toMatchObject({ linkId: 'NB2Zlz3', url: 'https://www.paytr.com/link/NB2Zlz3' });
    const form = http.calls[0].form;
    expect(http.calls[0].url).toBe(PAYTR_ENDPOINTS.linkCreate);
    expect(form).toMatchObject({
      merchant_id: MERCHANT_ID,
      name: 'Bağdam kutu #12',
      price: '38450',
      currency: 'TL',
      max_installment: '1',
      link_type: 'collection',
      lang: 'tr',
      email: 'a@b.co',
      expiry_date: '2026-09-01 17:00:00',
      callback_link: 'https://www.bagdam.com/api/v1/payments/paytr/callback',
      callback_id: 'lnkcm1abc1',
      debug_on: '1',
    });
    expect(form.min_count).toBeUndefined();
    expect(form.paytr_token).toBe(hmac(`Bağdam kutu #1238450TL1collectiontra@b.co${SALT}`));

    // e-posta yoksa product + min_count/max_count 1
    http.reply({ status: 'success', id: 'X1', link: 'https://www.paytr.com/link/X1' });
    await provider.createPaymentLink({ amount: 10, name: 'Ek', conversationId: 'lnk_cm1abc_2' });
    expect(http.calls[1].form).toMatchObject({ link_type: 'product', min_count: '1', max_count: '1', name: 'Bağdam Ek' });
    expect(http.calls[1].form.paytr_token).toBe(hmac(`Bağdam Ek1000TL1producttr1${SALT}`));

    http.reply({ status: 'error', err_msg: 'Gecersiz istek' });
    await expect(provider.createPaymentLink({ amount: 10, name: 'Ek', conversationId: 'lnk_cm1abc_3' })).rejects.toMatchObject({ response: { error: 'PAYTR_LINK_FAILED' } });

    http.reply({ status: 'success' });
    expect(await provider.deletePaymentLink('NB2Zlz3')).toBe(true);
    expect(http.calls[3].url).toBe(PAYTR_ENDPOINTS.linkDelete);
    expect(http.calls[3].form).toMatchObject({ merchant_id: MERCHANT_ID, id: 'NB2Zlz3', paytr_token: hmac(`NB2Zlz3${MERCHANT_ID}${SALT}`) });
  });

  it('createPaymentLink: WEB_URL localhost/portlu ise callback_link gönderilmez (yalnız geliştirme)', async () => {
    process.env.WEB_URL = 'http://localhost:4010';
    const { provider, http } = makeProvider(makeConfig());
    http.reply({ status: 'success', id: 'L1', link: 'https://www.paytr.com/link/L1' });
    await provider.createPaymentLink({ amount: 10, name: 'Link', conversationId: 'lnk_cm1abc_1', email: 'a@b.co' });
    expect(http.calls[0].form.callback_link).toBeUndefined();
    expect(http.calls[0].form.callback_id).toBeUndefined();
    process.env.WEB_URL = 'https://www.bagdam.com';
  });

  it('verifyWebhook: yapılandırma yüklenmeden PAYTR_NOT_CONFIGURED; verifyCallback yükler → geçerli/geçersiz hash; providerRef merchant_oid:status', async () => {
    const { provider } = makeProvider(makeConfig());
    const raw = `merchant_oid=ord1001ab12&status=success&total_amount=64900&hash=${encodeURIComponent(hmac(`ord1001ab12${SALT}success64900`))}`;
    expect(provider.verifyWebhook(raw, null)).toMatchObject({ valid: false, error: 'PAYTR_NOT_CONFIGURED', providerRef: 'ord1001ab12:success' });
    const ok = await provider.verifyCallback(raw);
    expect(ok).toMatchObject({ valid: true, eventType: 'callback', providerRef: 'ord1001ab12:success', error: null });
    expect((ok.payload as { merchant_oid: string }).merchant_oid).toBe('ord1001ab12');
    const bad = await provider.verifyCallback('merchant_oid=ord1001ab12&status=success&total_amount=1&hash=xx');
    expect(bad).toMatchObject({ valid: false, error: 'INVALID_SIGNATURE' });
    expect(provider.verifyWebhook('', null)).toMatchObject({ valid: false, error: 'INVALID_BODY' });
  });
});
