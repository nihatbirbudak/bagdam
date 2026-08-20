import { createHmac, timingSafeEqual } from 'crypto';
import type { Money } from '@bagdam/shared';

/**
 * PayTR hash/imza yardımcıları — SAF fonksiyonlar (DB/HTTP yok; birim test edilir). Kaynak: https://dev.paytr.com
 * (iFrame API 1/2. adım, Durum Sorgu, İade API, Link API create/delete/callback, Kart Saklama API).
 * Tüm imzalar: `base64( HMAC-SHA256( <dizilim>, merchant_key ) )`; merchant_salt dizilimin belirtilen yerine eklenir.
 * Dizilimler (doküman sırası — DEĞİŞTİRME):
 *  - iFrame get-token : merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode + merchant_salt
 *  - Bildirim (callback): merchant_oid + merchant_salt + status + total_amount
 *  - Link API callback : callback_id + merchant_oid + merchant_salt + status + total_amount
 *  - Durum sorgu       : merchant_id + merchant_oid + merchant_salt
 *  - İade              : merchant_id + merchant_oid + return_amount + merchant_salt
 *  - Link create       : name + price + currency + max_installment + link_type + lang + (min_count | email) + merchant_salt
 *  - Link delete       : id + merchant_id + merchant_salt
 *  - Direkt/kayıtlı kart ödeme (recurring dahil): merchant_id + user_ip + merchant_oid + email + payment_amount + payment_type + installment_count + currency + test_mode + non_3d + merchant_salt
 *  - Kayıtlı kart listesi (capi/list): utoken + merchant_salt · silme (capi/delete): ctoken + utoken + merchant_salt
 */

/** PayTR merchant_oid: en çok 64 alfanümerik karakter. */
export const PAYTR_MERCHANT_OID_MAX = 64;
const MERCHANT_OID_RE = /^[A-Za-z0-9]{1,64}$/;
const NON_ALNUM_RE = /[^A-Za-z0-9]/g;

/** `base64(HMAC-SHA256(data, key))`. */
export function hmacSha256Base64(data: string, key: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64');
}

/** Zamanlama-güvenli karşılaştırma (uzunluk farkı → false). */
export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isMerchantOid(value: unknown): value is string {
  return typeof value === 'string' && MERCHANT_OID_RE.test(value);
}

/**
 * Payment.conversationId → PayTR merchant_oid (yalnız [A-Za-z0-9], ≤64). Checkout conversationId'leri (B: `ord<orderNo><4>`) zaten
 * alfanümeriktir; F7 üreticileri (`cyc_<cycleId>_<n>`, `lnk_<cycleId>_<n>`) alt çizgili olduğundan alt çizgiler atılır.
 * Geri eşleme: `PaymentsRepository.findPaymentByMerchantOid` (tam eşleşme → providerPaymentId/providerToken → regexp_replace eşleşmesi).
 */
export function toMerchantOid(conversationId: string): string {
  const oid = conversationId.replace(NON_ALNUM_RE, '').slice(0, PAYTR_MERCHANT_OID_MAX);
  if (!oid) throw new Error(`PayTR merchant_oid üretilemedi: "${conversationId}"`);
  return oid;
}

/** TL → kuruş (tam sayı; PayTR iFrame/Link `payment_amount`/`price`). */
export function toKurus(amount: Money): number {
  return Math.round(amount * 100);
}

/** TL → "123.45" (PayTR Direkt/kayıtlı kart `payment_amount`, iade `return_amount`: nokta ayraçlı ondalık). */
export function toDecimalString(amount: Money): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

export interface PayTrBasketItem {
  name: string;
  /** Birim fiyat TL. */
  unitPrice: Money;
  qty: number;
}

/** PayTR `user_basket`: base64( JSON [[ad, "birim fiyat", adet], …] ). Boş sepet → base64("[]"). */
export function buildUserBasket(items: readonly PayTrBasketItem[]): string {
  const arr = items.map((i) => [String(i.name).slice(0, 200), toDecimalString(i.unitPrice), i.qty]);
  return Buffer.from(JSON.stringify(arr), 'utf8').toString('base64');
}

// ── İmzalar ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IframeTokenHashInput {
  merchantId: string;
  userIp: string;
  merchantOid: string;
  email: string;
  /** kuruş (int). */
  paymentAmount: number;
  /** base64 JSON. */
  userBasket: string;
  noInstallment: 0 | 1;
  maxInstallment: number;
  currency: string;
  testMode: 0 | 1;
}

/** iFrame API get-token `paytr_token`. */
export function iframeTokenHash(i: IframeTokenHashInput, merchantKey: string, merchantSalt: string): string {
  const hashStr =
    i.merchantId +
    i.userIp +
    i.merchantOid +
    i.email +
    String(i.paymentAmount) +
    i.userBasket +
    String(i.noInstallment) +
    String(i.maxInstallment) +
    i.currency +
    String(i.testMode);
  return hmacSha256Base64(hashStr + merchantSalt, merchantKey);
}

export interface CallbackHashInput {
  merchantOid: string;
  status: string;
  totalAmount: string;
  /** Link API bildirimi (callback_id doluysa dizilim başına eklenir). */
  callbackId?: string | null;
}

/** Bildirim (callback) hash'i — iFrame/Direkt: merchant_oid+salt+status+total_amount · Link API: callback_id+merchant_oid+salt+status+total_amount. */
export function callbackHash(i: CallbackHashInput, merchantKey: string, merchantSalt: string): string {
  const prefix = i.callbackId ? i.callbackId : '';
  return hmacSha256Base64(prefix + i.merchantOid + merchantSalt + i.status + i.totalAmount, merchantKey);
}

/** Gelen bildirimin `hash` alanını doğrular (zamanlama-güvenli). Eksik alan → false. */
export function verifyCallbackHash(
  payload: { merchant_oid?: unknown; status?: unknown; total_amount?: unknown; hash?: unknown; callback_id?: unknown },
  merchantKey: string,
  merchantSalt: string,
): boolean {
  const { merchant_oid, status, total_amount, hash, callback_id } = payload;
  if (typeof merchant_oid !== 'string' || typeof status !== 'string' || typeof total_amount !== 'string' || typeof hash !== 'string') return false;
  if (!merchant_oid || !status || !hash) return false;
  const expected = callbackHash(
    { merchantOid: merchant_oid, status, totalAmount: total_amount, callbackId: typeof callback_id === 'string' && callback_id ? callback_id : null },
    merchantKey,
    merchantSalt,
  );
  return hashesEqual(expected, hash);
}

/** Durum Sorgu `paytr_token`: merchant_id + merchant_oid + merchant_salt. */
export function statusQueryHash(merchantId: string, merchantOid: string, merchantKey: string, merchantSalt: string): string {
  return hmacSha256Base64(merchantId + merchantOid + merchantSalt, merchantKey);
}

/** İade `paytr_token`: merchant_id + merchant_oid + return_amount + merchant_salt (return_amount "10.25" biçimi). */
export function refundHash(merchantId: string, merchantOid: string, returnAmount: string, merchantKey: string, merchantSalt: string): string {
  return hmacSha256Base64(merchantId + merchantOid + returnAmount + merchantSalt, merchantKey);
}

export interface LinkCreateHashInput {
  name: string;
  /** kuruş (int). */
  price: number;
  currency: string;
  maxInstallment: number;
  linkType: 'product' | 'collection';
  lang: string;
  /** product → min_count; collection → email. */
  minCountOrEmail: string;
}

/** Link API create `paytr_token`: name + price + currency + max_installment + link_type + lang + (min_count|email) + merchant_salt. */
export function linkCreateHash(i: LinkCreateHashInput, merchantKey: string, merchantSalt: string): string {
  const required = i.name + String(i.price) + i.currency + String(i.maxInstallment) + i.linkType + i.lang + i.minCountOrEmail;
  return hmacSha256Base64(required + merchantSalt, merchantKey);
}

/** Link API delete `paytr_token`: id + merchant_id + merchant_salt. */
export function linkDeleteHash(linkId: string, merchantId: string, merchantKey: string, merchantSalt: string): string {
  return hmacSha256Base64(linkId + merchantId + merchantSalt, merchantKey);
}

export interface DirectPaymentHashInput {
  merchantId: string;
  userIp: string;
  merchantOid: string;
  email: string;
  /** "123.45" (ondalık metin — Direkt/kayıtlı kart API'si kuruş DEĞİL). */
  paymentAmount: string;
  paymentType: 'card';
  installmentCount: number;
  currency: string;
  testMode: 0 | 1;
  non3d: 0 | 1;
}

/** Direkt API / kayıtlı karttan ödeme / tekrarlayan ödeme `paytr_token`. */
export function directPaymentHash(i: DirectPaymentHashInput, merchantKey: string, merchantSalt: string): string {
  const hashStr =
    i.merchantId +
    i.userIp +
    i.merchantOid +
    i.email +
    i.paymentAmount +
    i.paymentType +
    String(i.installmentCount) +
    i.currency +
    String(i.testMode) +
    String(i.non3d);
  return hmacSha256Base64(hashStr + merchantSalt, merchantKey);
}

/** Kayıtlı kart listesi (capi/list) `paytr_token`: utoken + merchant_salt. */
export function capiListHash(utoken: string, merchantKey: string, merchantSalt: string): string {
  return hmacSha256Base64(utoken + merchantSalt, merchantKey);
}

/** Kayıtlı kart silme (capi/delete) `paytr_token`: ctoken + utoken + merchant_salt. */
export function capiDeleteHash(ctoken: string, utoken: string, merchantKey: string, merchantSalt: string): string {
  return hmacSha256Base64(ctoken + utoken + merchantSalt, merchantKey);
}
