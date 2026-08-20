import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  PROVIDER_FEATURE_DISABLED,
  type Money,
  type PaymentProvider as PaymentProviderEnum,
  type PaymentProviderName,
  type ProviderChargeResult,
  type ProviderCheckoutInit,
  type ProviderPaymentLink,
  type ProviderPaymentLinkInput,
  type ProviderRefundResult,
  type ProviderRetrieveResult,
  type WebhookVerification,
} from '@bagdam/shared';
import { formatInTimeZone } from 'date-fns-tz';
import type { InitCheckoutOptions, PaymentProvider, ProviderOrderInput, RefundRef, StoredCardRef } from '../payment-provider.interface';
import {
  merchantFailUrl,
  merchantOkUrl,
  PAYTR_LANG,
  PAYTR_TIMEOUT_LIMIT_MIN,
  PayTrConfigService,
  paytrCallbackUrl,
  webBaseUrl,
  type PayTrConfig,
} from './paytr.config';
import {
  buildUserBasket,
  capiDeleteHash,
  capiListHash,
  directPaymentHash,
  iframeTokenHash,
  isMerchantOid,
  linkCreateHash,
  linkDeleteHash,
  refundHash,
  statusQueryHash,
  toDecimalString,
  toKurus,
  toMerchantOid,
  verifyCallbackHash,
} from './paytr.hash';
import { PAYTR_HTTP, parseJsonBody, type PayTrHttp } from './paytr.http';
import {
  PAYTR_CALLBACK_EVENT_TYPE,
  PAYTR_ENDPOINTS,
  type PayTrCallbackPayload,
  type PayTrLinkCreateResponse,
  type PayTrLinkDeleteResponse,
  type PayTrRecurringResponse,
  type PayTrRefundResponse,
  type PayTrStatusResponse,
  type PayTrStoredCard,
  type PayTrTokenResponse,
} from './paytr.types';

const ISTANBUL_TZ = 'Europe/Istanbul';
const EMAIL_MAX = 100;
const NAME_MAX = 60;
const ADDRESS_MAX = 400;
const PHONE_MAX = 20;
const LINK_NAME_MIN = 4;
const LINK_NAME_MAX = 200;
/** Sunucu başlatmalı (MIT) tahsilatta müşteri IP'si yok — PayTR user_ip zorunlu olduğundan yer tutucu. */
const FALLBACK_USER_IP = '127.0.0.1';

function clip(s: string | null | undefined, max: number, fallback = '-'): string {
  const v = (s ?? '').trim();
  return (v || fallback).slice(0, max);
}

/** IPv6-mapped IPv4 (`::ffff:1.2.3.4`) → `1.2.3.4`; boş → yedek. */
export function normalizeIp(ip: string | null | undefined, fallback = FALLBACK_USER_IP): string {
  const v = (ip ?? '').trim();
  if (!v) return fallback;
  return v.startsWith('::ffff:') ? v.slice(7) : v;
}

/** iFrame HTML parçası (ADR-0003 istisna 1 konteynerine basılır; iframeResizer PayTR dokümanı). F10: CSP frame-src/script-src www.paytr.com. */
export function buildIframeHtml(token: string): string {
  return (
    `<script src="${PAYTR_ENDPOINTS.iframeResizer}"></script>` +
    `<iframe src="${PAYTR_ENDPOINTS.iframeBase}${token}" id="paytriframe" frameborder="0" scrolling="no" style="width:100%;"></iframe>` +
    `<script>iFrameResize({},'#paytriframe');</script>`
  );
}

/** Public http(s) URL mi (PayTR callback_link/ok_url kuralı: localhost ve port yasak). */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.port) return false;
    const host = u.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0' && !host.endsWith('.local');
  } catch {
    return false;
  }
}

/**
 * PayTrProvider — ADR-0019 (PaymentProvider arayüzü; HTTP `PAYTR_HTTP` üzerinden, testlerde mock — gerçek PayTR'ye istek atılmaz).
 *  - `initCheckout`  : iFrame API get-token (merchant_oid = Payment.conversationId [A-Za-z0-9], payment_amount kuruş, user_basket base64,
 *                      no_installment/max_installment Setting, currency TL, test_mode Setting, merchant_ok/fail_url = WEB_URL/sepet.html?siparis=<no>&odeme=ok|hata,
 *                      timeout_limit 30, debug_on test modunda 1, lang tr; store_card=1 (+utoken) yalnız saveCard && Setting storedCardEnabled)
 *                      → {providerToken: token, checkoutFormContent: iframe HTML, redirectUrl: https://www.paytr.com/odeme/guvenli/<token>}
 *  - `retrieve(ref)` : Durum Sorgu (ref = merchant_oid/conversationId) → SUCCEEDED | PENDING (PayTR 'error' kanıt değil — callback beklenir)
 *  - `chargeStoredCard`: Kayıtlı kart tekrarlayan ödeme (non_3d=1, recurring_payment=1, utoken/ctoken) — Setting storedCardEnabled kapalıysa 503 PROVIDER_FEATURE_DISABLED
 *  - `refund`        : İade API (return_amount "10.25")
 *  - `verifyWebhook` : bildirim hash'i (merchant_oid+salt+status+total_amount; Link API: callback_id önekli) — son yüklenen yapılandırmayla (sync);
 *                      `verifyCallback` async sürümü yapılandırmayı yükler
 *  - `createPaymentLink` / `deletePaymentLink`: Link API (PAYMENT_LINK stratejisi; callback_id = merchant_oid eşlemesi)
 *  - `listStoredCards` / `deleteStoredCard`: capi/list · capi/delete (/me/cards yardımcıları)
 * Sağlayıcı DB'ye DOKUNMAZ (ADR-0002); Payment/WebhookEvent/PaymentMethod yazımı PaymentsService / PaymentSettlementService / PaytrCallbackService'te.
 */
@Injectable()
export class PayTrProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'paytr';
  readonly enumValue: PaymentProviderEnum = 'PAYTR';
  private readonly logger = new Logger(PayTrProvider.name);
  /** `verifyWebhook` (sync) için son yüklenen yapılandırma. */
  private lastConfig: PayTrConfig | null = null;

  constructor(
    private readonly config: PayTrConfigService,
    @Inject(PAYTR_HTTP) private readonly http: PayTrHttp,
  ) {}

  /** Yapılandırmayı yükler ve sync `verifyWebhook` için saklar. */
  async loadConfig(): Promise<PayTrConfig> {
    const cfg = await this.config.load();
    this.lastConfig = cfg;
    return cfg;
  }

  // ── iFrame checkout ───────────────────────────────────────────────────────────────────────────────────────────────

  async initCheckout(order: ProviderOrderInput, opts: InitCheckoutOptions): Promise<ProviderCheckoutInit> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const merchantOid = toMerchantOid(opts.conversationId);
    const userIp = normalizeIp(opts.ip);
    const email = clip(order.customer.email, EMAIL_MAX, '');
    if (!email) throw new BadRequestException({ message: 'Ödeme için müşteri e-postası gerekli', error: 'PAYTR_EMAIL_REQUIRED' });
    const paymentAmount = toKurus(order.amount);
    if (!(paymentAmount > 0)) throw new BadRequestException({ message: 'Ödeme tutarı pozitif olmalı', error: 'PAYMENT_AMOUNT_INVALID' });
    const basketItems = opts.basket && opts.basket.length > 0 ? opts.basket : [{ name: order.description ?? `Bağdam sipariş #${order.orderNo}`, unitPrice: order.amount, qty: 1 }];
    const userBasket = buildUserBasket(basketItems);
    const testMode: 0 | 1 = cfg.testMode ? 1 : 0;

    const paytrToken = iframeTokenHash(
      { merchantId: cfg.merchantId, userIp, merchantOid, email, paymentAmount, userBasket, noInstallment: cfg.noInstallment, maxInstallment: cfg.maxInstallment, currency: cfg.currency, testMode },
      cfg.merchantKey,
      cfg.merchantSalt,
    );
    const form: Record<string, string> = {
      merchant_id: cfg.merchantId,
      user_ip: userIp,
      merchant_oid: merchantOid,
      email,
      payment_amount: String(paymentAmount),
      paytr_token: paytrToken,
      user_basket: userBasket,
      debug_on: testMode ? '1' : '0',
      no_installment: String(cfg.noInstallment),
      max_installment: String(cfg.maxInstallment),
      user_name: clip(order.customer.name, NAME_MAX),
      user_address: clip(opts.address, ADDRESS_MAX),
      user_phone: clip(order.customer.phone, PHONE_MAX),
      merchant_ok_url: opts.okUrl ?? merchantOkUrl(order.orderNo),
      merchant_fail_url: opts.failUrl ?? merchantFailUrl(order.orderNo),
      timeout_limit: String(PAYTR_TIMEOUT_LIMIT_MIN),
      currency: cfg.currency,
      test_mode: String(testMode),
      lang: PAYTR_LANG,
    };
    // Kart saklama yalnız onay (Setting storedCardEnabled) varsa istenir — iFrame API dokümanında store_card yok; PayTR teyidi gerekir (ADR-0019).
    if (opts.saveCard && cfg.storedCardEnabled) {
      form.store_card = '1';
      if (opts.customerKey) form.utoken = opts.customerKey;
    }

    const res = await this.http.postForm(PAYTR_ENDPOINTS.getToken, form);
    const json = parseJsonBody<PayTrTokenResponse>(res);
    if (!json) {
      this.logger.error(`PayTR get-token yanıtı okunamadı (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
      throw new BadGatewayException({ message: 'Ödeme sağlayıcısından geçersiz yanıt alındı', error: 'PAYTR_BAD_RESPONSE' });
    }
    if (json.status !== 'success' || !json.token) {
      this.logger.error(`PayTR get-token başarısız (${merchantOid}): ${json.reason ?? 'neden yok'}`);
      throw new BadGatewayException({ message: `Ödeme başlatılamadı: ${json.reason ?? 'PayTR token alınamadı'}`, error: 'PAYTR_TOKEN_FAILED' });
    }
    this.logger.log(`PayTR iFrame token alındı: sipariş #${order.orderNo} ${order.amount} TL (${merchantOid}${testMode ? ', test' : ''})`);
    return { providerToken: json.token, redirectUrl: `${PAYTR_ENDPOINTS.iframeBase}${json.token}`, checkoutFormContent: buildIframeHtml(json.token) };
  }

  // ── Durum sorgu ───────────────────────────────────────────────────────────────────────────────────────────────────

  async retrieve(ref: string): Promise<ProviderRetrieveResult> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const merchantOid = isMerchantOid(ref) ? ref : toMerchantOid(ref);
    const res = await this.http.postForm(PAYTR_ENDPOINTS.statusQuery, {
      merchant_id: cfg.merchantId,
      merchant_oid: merchantOid,
      paytr_token: statusQueryHash(cfg.merchantId, merchantOid, cfg.merchantKey, cfg.merchantSalt),
    });
    const json = parseJsonBody<PayTrStatusResponse>(res);
    if (!json) {
      return { status: 'PENDING', providerPaymentId: null, storedCard: null, failureCode: 'PAYTR_BAD_RESPONSE', failureMessage: `HTTP ${res.status}`, raw: res.body.slice(0, 500) };
    }
    if (json.status === 'success') {
      return { status: 'SUCCEEDED', providerPaymentId: merchantOid, storedCard: null, failureCode: null, failureMessage: null, raw: json };
    }
    // 'error' = PayTR'de başarılı işlem yok (bulunamadı / henüz ödenmedi / başarısız) — kesin başarısızlık kanıtı değil; callback ya da 24 s EXPIRED
    return { status: 'PENDING', providerPaymentId: null, storedCard: null, failureCode: json.err_no ? `PAYTR_${json.err_no}` : 'PAYTR_ERROR', failureMessage: json.err_msg ?? null, raw: json };
  }

  // ── Kayıtlı karttan tahsilat (MIT / recurring) ───────────────────────────────────────────────────────────────────

  async chargeStoredCard(paymentMethod: StoredCardRef, amount: Money, conversationId: string): Promise<ProviderChargeResult> {
    const cfg = await this.loadConfig();
    if (!cfg.storedCardEnabled) {
      throw new ServiceUnavailableException({
        message: 'PayTR kayıtlı kart / tekrarlayan tahsilat onayı kapalı (Ayarlar › Ödeme › storedCardEnabled) — ödeme linki stratejisi kullanılır',
        error: PROVIDER_FEATURE_DISABLED,
      });
    }
    this.config.requireConfigured(cfg);
    const merchantOid = toMerchantOid(conversationId);
    const email = clip(paymentMethod.email, EMAIL_MAX, '');
    if (!email) throw new BadRequestException({ message: 'Kayıtlı karttan tahsilat için kart sahibinin e-postası gerekli', error: 'PAYTR_EMAIL_REQUIRED' });
    const paymentAmount = toDecimalString(amount);
    const userIp = normalizeIp(paymentMethod.ip);
    const testMode: 0 | 1 = cfg.testMode ? 1 : 0;
    const installmentCount = 0;
    const paytrToken = directPaymentHash(
      { merchantId: cfg.merchantId, userIp, merchantOid, email, paymentAmount, paymentType: 'card', installmentCount, currency: cfg.currency, testMode, non3d: 1 },
      cfg.merchantKey,
      cfg.merchantSalt,
    );
    const form: Record<string, string> = {
      merchant_id: cfg.merchantId,
      user_ip: userIp,
      merchant_oid: merchantOid,
      email,
      payment_type: 'card',
      payment_amount: paymentAmount,
      installment_count: String(installmentCount),
      currency: cfg.currency,
      test_mode: String(testMode),
      non_3d: '1',
      recurring_payment: '1',
      utoken: paymentMethod.providerCustomerKey,
      ctoken: paymentMethod.providerCardToken,
      user_name: clip(paymentMethod.holderName, NAME_MAX, 'Bağdam müşterisi'),
      user_address: '-',
      user_phone: '-',
      user_basket: buildUserBasket([{ name: 'Bağdam abonelik tahsilatı', unitPrice: amount, qty: 1 }]),
      merchant_ok_url: `${webBaseUrl()}/uyelik.html`,
      merchant_fail_url: `${webBaseUrl()}/uyelik.html`,
      debug_on: testMode ? '1' : '0',
      client_lang: PAYTR_LANG,
      paytr_token: paytrToken,
    };
    const res = await this.http.postForm(PAYTR_ENDPOINTS.directPayment, form);
    const json = parseJsonBody<PayTrRecurringResponse>(res);
    if (!json) {
      this.logger.error(`PayTR recurring yanıtı okunamadı (HTTP ${res.status}, ${merchantOid}): ${res.body.slice(0, 200)}`);
      return { ok: false, providerPaymentId: null, failureCode: 'PAYTR_BAD_RESPONSE', failureMessage: `PayTR geçersiz yanıt (HTTP ${res.status})`, raw: res.body.slice(0, 500) };
    }
    if (json.status === 'success') {
      this.logger.log(`PayTR kayıtlı kart tahsilatı OK: ${merchantOid} ${paymentAmount} TL`);
      return { ok: true, providerPaymentId: merchantOid, failureCode: null, failureMessage: null, raw: json };
    }
    if (json.status === 'wait_callback') {
      // Banka sonucu asenkron: eşzamanlı kanıt yok → FAILED olarak işlenir, bildirim gelirse callback servisi loglar (SİSTEM-DURUMU notu)
      this.logger.warn(`PayTR recurring wait_callback: ${merchantOid} — sonuç bildirim URL'sine gelecek`);
      return { ok: false, providerPaymentId: null, failureCode: 'PAYTR_WAIT_CALLBACK', failureMessage: 'PayTR sonucu bildirimle gönderecek (wait_callback)', raw: json };
    }
    const message = json.msg ?? json.err_msg ?? json.reason ?? 'PayTR tahsilatı reddetti';
    this.logger.warn(`PayTR kayıtlı kart tahsilatı RED: ${merchantOid} — ${message}`);
    return { ok: false, providerPaymentId: null, failureCode: json.err_no ? `PAYTR_${json.err_no}` : 'PAYTR_DECLINED', failureMessage: message, raw: json };
  }

  // ── İade ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  async refund(payment: RefundRef, amount: Money): Promise<ProviderRefundResult> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const merchantOid = payment.providerPaymentId && isMerchantOid(payment.providerPaymentId) ? payment.providerPaymentId : toMerchantOid(payment.conversationId);
    const returnAmount = toDecimalString(amount);
    const referenceNo = `${merchantOid}r${Date.now().toString(36)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    const res = await this.http.postForm(PAYTR_ENDPOINTS.refund, {
      merchant_id: cfg.merchantId,
      merchant_oid: merchantOid,
      return_amount: returnAmount,
      reference_no: referenceNo,
      paytr_token: refundHash(cfg.merchantId, merchantOid, returnAmount, cfg.merchantKey, cfg.merchantSalt),
    });
    const json = parseJsonBody<PayTrRefundResponse>(res);
    if (!json) {
      return { ok: false, providerRefundId: null, failureCode: 'PAYTR_BAD_RESPONSE', failureMessage: `PayTR geçersiz yanıt (HTTP ${res.status})`, raw: res.body.slice(0, 500) };
    }
    if (json.status === 'success') {
      this.logger.log(`PayTR iade OK: ${merchantOid} ${returnAmount} TL (ref ${json.reference_no ?? referenceNo})`);
      return { ok: true, providerRefundId: json.reference_no ?? referenceNo, failureCode: null, failureMessage: null, raw: json };
    }
    this.logger.warn(`PayTR iade RED: ${merchantOid} ${returnAmount} TL — ${json.err_no ?? ''} ${json.err_msg ?? ''}`);
    return { ok: false, providerRefundId: null, failureCode: json.err_no ? `PAYTR_${json.err_no}` : 'PAYTR_REFUND_FAILED', failureMessage: json.err_msg ?? 'PayTR iadeyi reddetti', raw: json };
  }

  // ── Bildirim (callback) doğrulama ─────────────────────────────────────────────────────────────────────────────────

  /** Sync arayüz sürümü — son yüklenen yapılandırma ile (yüklenmemişse geçersiz: `PAYTR_NOT_CONFIGURED`). Controller `verifyCallback` kullanır. */
  verifyWebhook(raw: Buffer | string | Record<string, unknown>, _signature: string | null | undefined): WebhookVerification {
    const payload = parseCallbackBody(raw);
    if (!payload) return { valid: false, eventType: PAYTR_CALLBACK_EVENT_TYPE, providerRef: null, payload: null, error: 'INVALID_BODY' };
    const providerRef = payload.merchant_oid && payload.status ? `${payload.merchant_oid}:${payload.status}` : null;
    const cfg = this.lastConfig;
    if (!cfg || !cfg.configured) return { valid: false, eventType: PAYTR_CALLBACK_EVENT_TYPE, providerRef, payload, error: 'PAYTR_NOT_CONFIGURED' };
    const valid = verifyCallbackHash(payload, cfg.merchantKey, cfg.merchantSalt);
    return { valid, eventType: PAYTR_CALLBACK_EVENT_TYPE, providerRef, payload, error: valid ? null : 'INVALID_SIGNATURE' };
  }

  /** Async sürüm: yapılandırmayı yükler, sonra `verifyWebhook`. */
  async verifyCallback(raw: Buffer | string | Record<string, unknown>): Promise<WebhookVerification> {
    await this.loadConfig();
    return this.verifyWebhook(raw, null);
  }

  // ── Link API (PAYMENT_LINK) ───────────────────────────────────────────────────────────────────────────────────────

  async createPaymentLink(input: ProviderPaymentLinkInput): Promise<ProviderPaymentLink> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const price = toKurus(input.amount);
    if (!(price > 0)) throw new BadRequestException({ message: 'Ödeme linki tutarı pozitif olmalı', error: 'PAYMENT_AMOUNT_INVALID' });
    let name = (input.name ?? '').trim();
    if (name.length < LINK_NAME_MIN) name = `Bağdam ${name}`.trim();
    name = name.slice(0, LINK_NAME_MAX);
    const email = clip(input.email, EMAIL_MAX, '');
    const linkType: 'product' | 'collection' = email ? 'collection' : 'product';
    const minCountOrEmail = email || '1';
    const callbackId = toMerchantOid(input.conversationId);
    const paytrToken = linkCreateHash(
      { name, price, currency: cfg.currency, maxInstallment: cfg.maxInstallment, linkType, lang: PAYTR_LANG, minCountOrEmail },
      cfg.merchantKey,
      cfg.merchantSalt,
    );
    const form: Record<string, string> = {
      merchant_id: cfg.merchantId,
      name,
      price: String(price),
      currency: cfg.currency,
      max_installment: String(cfg.maxInstallment),
      link_type: linkType,
      lang: PAYTR_LANG,
      debug_on: cfg.testMode ? '1' : '0',
      paytr_token: paytrToken,
    };
    if (linkType === 'collection') form.email = email;
    else {
      form.min_count = '1';
      form.max_count = '1';
    }
    if (input.expiresAt) form.expiry_date = formatInTimeZone(input.expiresAt, ISTANBUL_TZ, 'yyyy-MM-dd HH:mm:ss');
    const callbackLink = paytrCallbackUrl();
    if (isPublicHttpUrl(callbackLink)) {
      form.callback_link = callbackLink;
      form.callback_id = callbackId;
    } else {
      this.logger.warn(`PayTR Link API callback_link public değil (${callbackLink}) — link bildirimsiz oluşturuluyor (yalnız geliştirme)`);
    }
    const res = await this.http.postForm(PAYTR_ENDPOINTS.linkCreate, form);
    const json = parseJsonBody<PayTrLinkCreateResponse>(res);
    if (!json) throw new BadGatewayException({ message: 'PayTR link yanıtı okunamadı', error: 'PAYTR_BAD_RESPONSE' });
    if (json.status !== 'success' || !json.id || !json.link) {
      this.logger.error(`PayTR link oluşturulamadı (${callbackId}): ${json.reason ?? json.err_msg ?? 'neden yok'}`);
      throw new BadGatewayException({ message: `Ödeme linki oluşturulamadı: ${json.reason ?? json.err_msg ?? 'PayTR hatası'}`, error: 'PAYTR_LINK_FAILED' });
    }
    this.logger.log(`PayTR ödeme linki: ${json.id} ${input.amount} TL (${callbackId})`);
    return { linkId: String(json.id), url: json.link, raw: json };
  }

  async deletePaymentLink(linkId: string): Promise<boolean> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const res = await this.http.postForm(PAYTR_ENDPOINTS.linkDelete, {
      merchant_id: cfg.merchantId,
      id: linkId,
      debug_on: cfg.testMode ? '1' : '0',
      paytr_token: linkDeleteHash(linkId, cfg.merchantId, cfg.merchantKey, cfg.merchantSalt),
    });
    const json = parseJsonBody<PayTrLinkDeleteResponse>(res);
    const ok = json?.status === 'success';
    if (!ok) this.logger.warn(`PayTR link silinemedi (${linkId}): ${json?.reason ?? json?.err_msg ?? `HTTP ${res.status}`}`);
    return ok;
  }

  // ── Kayıtlı kart yardımcıları (/me/cards) ─────────────────────────────────────────────────────────────────────────

  async listStoredCards(utoken: string): Promise<PayTrStoredCard[]> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const res = await this.http.postForm(PAYTR_ENDPOINTS.capiList, { merchant_id: cfg.merchantId, utoken, paytr_token: capiListHash(utoken, cfg.merchantKey, cfg.merchantSalt) });
    const json = parseJsonBody<unknown>(res);
    if (Array.isArray(json)) return json as PayTrStoredCard[];
    this.logger.warn(`PayTR capi/list beklenmeyen yanıt: ${res.body.slice(0, 200)}`);
    return [];
  }

  async deleteStoredCard(utoken: string, ctoken: string): Promise<boolean> {
    const cfg = this.config.requireConfigured(await this.loadConfig());
    const res = await this.http.postForm(PAYTR_ENDPOINTS.capiDelete, {
      merchant_id: cfg.merchantId,
      utoken,
      ctoken,
      paytr_token: capiDeleteHash(ctoken, utoken, cfg.merchantKey, cfg.merchantSalt),
    });
    const json = parseJsonBody<{ status?: string; err_msg?: string }>(res);
    const ok = json?.status === 'success';
    if (!ok) this.logger.warn(`PayTR capi/delete başarısız: ${json?.err_msg ?? `HTTP ${res.status}`}`);
    return ok;
  }
}

/** Bildirim gövdesi: ham form-urlencoded (Buffer/string) ya da ayrıştırılmış nesne → düz string sözlüğü. */
export function parseCallbackBody(raw: Buffer | string | Record<string, unknown> | null | undefined): PayTrCallbackPayload | null {
  if (raw === null || raw === undefined) return null;
  const out: Record<string, string> = {};
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    if (!text.trim()) return null;
    if (text.trim().startsWith('{')) {
      try {
        return parseCallbackBody(JSON.parse(text) as Record<string, unknown>);
      } catch {
        return null;
      }
    }
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  } else if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
    }
  } else {
    return null;
  }
  if (Object.keys(out).length === 0) return null;
  return out as PayTrCallbackPayload;
}
