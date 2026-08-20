// F8 — PayTR hash/imza yardımcıları (saf; DB/HTTP yok). Dizilimler https://dev.paytr.com dokümanlarından (iFrame 1/2. adım,
// Durum Sorgu, İade, Link create/delete/callback, kayıtlı kart). Beklenen değerler bağımsız `createHmac` ile üretilir (UA paytr.service.spec kalıbı).
import { createHmac } from 'crypto';
import {
  buildUserBasket,
  callbackHash,
  capiDeleteHash,
  capiListHash,
  directPaymentHash,
  hashesEqual,
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
} from '../../modules/payments/providers/paytr/paytr.hash';
import { isPublicHttpUrl, normalizeIp, parseCallbackBody } from '../../modules/payments/providers/paytr/paytr.provider';

const KEY = 'testkey1234567890';
const SALT = 'testsalt1234567890';
const MERCHANT_ID = '123456';
const hmac = (data: string) => createHmac('sha256', KEY).update(data).digest('base64');

describe('PayTR hash yardımcıları (paytr.hash.ts)', () => {
  it('iframeTokenHash: merchant_id+user_ip+merchant_oid+email+payment_amount+user_basket+no_installment+max_installment+currency+test_mode + salt', () => {
    const basket = buildUserBasket([{ name: 'Haftanın Kutusu', unitPrice: 649, qty: 1 }]);
    const token = iframeTokenHash(
      { merchantId: MERCHANT_ID, userIp: '85.100.1.2', merchantOid: 'ord1001ab12', email: 'a@b.co', paymentAmount: 64900, userBasket: basket, noInstallment: 1, maxInstallment: 1, currency: 'TL', testMode: 1 },
      KEY,
      SALT,
    );
    expect(token).toBe(hmac(`${MERCHANT_ID}85.100.1.2ord1001ab12a@b.co64900${basket}11TL1${SALT}`));
    expect(token).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('buildUserBasket: base64 JSON [[ad, "birim fiyat", adet]]; boş sepet → []', () => {
    const decoded = JSON.parse(Buffer.from(buildUserBasket([{ name: 'Ürün 1', unitPrice: 18, qty: 1 }, { name: 'Ürün 2', unitPrice: 33.25, qty: 2 }]), 'base64').toString('utf8'));
    expect(decoded).toEqual([['Ürün 1', '18.00', 1], ['Ürün 2', '33.25', 2]]);
    expect(JSON.parse(Buffer.from(buildUserBasket([]), 'base64').toString('utf8'))).toEqual([]);
  });

  it('callbackHash / verifyCallbackHash: merchant_oid+salt+status+total_amount; status/tutar/hash kurcalaması → false', () => {
    const oid = 'ord1001ab12';
    const valid = hmac(`${oid}${SALT}success64900`);
    expect(callbackHash({ merchantOid: oid, status: 'success', totalAmount: '64900' }, KEY, SALT)).toBe(valid);
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'success', total_amount: '64900', hash: valid }, KEY, SALT)).toBe(true);
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'failed', total_amount: '64900', hash: valid }, KEY, SALT)).toBe(false);
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'success', total_amount: '9999', hash: valid }, KEY, SALT)).toBe(false);
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'success', total_amount: '64900', hash: 'bozuk' }, KEY, SALT)).toBe(false);
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'success', total_amount: '64900' }, KEY, SALT)).toBe(false);
    // Yanlış anahtarla üretilen hash
    expect(verifyCallbackHash({ merchant_oid: oid, status: 'success', total_amount: '64900', hash: createHmac('sha256', 'baska').update(`${oid}${SALT}success64900`).digest('base64') }, KEY, SALT)).toBe(false);
  });

  it('Link API bildirimi: callback_id+merchant_oid+salt+status+total_amount (callback_id doluysa önek)', () => {
    const valid = hmac(`lnkabc1PAYTROID${SALT}success10000`);
    expect(callbackHash({ callbackId: 'lnkabc1', merchantOid: 'PAYTROID', status: 'success', totalAmount: '10000' }, KEY, SALT)).toBe(valid);
    expect(verifyCallbackHash({ callback_id: 'lnkabc1', merchant_oid: 'PAYTROID', status: 'success', total_amount: '10000', hash: valid }, KEY, SALT)).toBe(true);
    // callback_id olmadan aynı hash tutmaz
    expect(verifyCallbackHash({ merchant_oid: 'PAYTROID', status: 'success', total_amount: '10000', hash: valid }, KEY, SALT)).toBe(false);
  });

  it('statusQueryHash / refundHash / linkCreateHash / linkDeleteHash / directPaymentHash / capi hash dizilimleri', () => {
    expect(statusQueryHash(MERCHANT_ID, 'ord1', KEY, SALT)).toBe(hmac(`${MERCHANT_ID}ord1${SALT}`));
    expect(refundHash(MERCHANT_ID, 'ord1', '10.25', KEY, SALT)).toBe(hmac(`${MERCHANT_ID}ord110.25${SALT}`));
    expect(linkCreateHash({ name: 'Bağdam kutu', price: 64900, currency: 'TL', maxInstallment: 1, linkType: 'collection', lang: 'tr', minCountOrEmail: 'a@b.co' }, KEY, SALT)).toBe(
      hmac(`Bağdam kutu64900TL1collectiontra@b.co${SALT}`),
    );
    expect(linkCreateHash({ name: 'Bağdam kutu', price: 64900, currency: 'TL', maxInstallment: 1, linkType: 'product', lang: 'tr', minCountOrEmail: '1' }, KEY, SALT)).toBe(
      hmac(`Bağdam kutu64900TL1producttr1${SALT}`),
    );
    expect(linkDeleteHash('NB2Zlz3', MERCHANT_ID, KEY, SALT)).toBe(hmac(`NB2Zlz3${MERCHANT_ID}${SALT}`));
    expect(
      directPaymentHash({ merchantId: MERCHANT_ID, userIp: '1.2.3.4', merchantOid: 'cycabc2', email: 'a@b.co', paymentAmount: '100.99', paymentType: 'card', installmentCount: 0, currency: 'TL', testMode: 1, non3d: 1 }, KEY, SALT),
    ).toBe(hmac(`${MERCHANT_ID}1.2.3.4cycabc2a@b.co100.99card0TL11${SALT}`));
    expect(capiListHash('UTOK', KEY, SALT)).toBe(hmac(`UTOK${SALT}`));
    expect(capiDeleteHash('CTOK', 'UTOK', KEY, SALT)).toBe(hmac(`CTOKUTOK${SALT}`));
  });

  it('toMerchantOid: alfanümerik kalır; alt çizgiler atılır (cyc_/lnk_ üreticileri); ≤64; boş → hata. isMerchantOid', () => {
    expect(toMerchantOid('ord1001Ab3U')).toBe('ord1001Ab3U');
    expect(toMerchantOid('cyc_cm1abc_2')).toBe('cyccm1abc2');
    expect(toMerchantOid('lnk_cm1abc_12')).toBe('lnkcm1abc12');
    expect(toMerchantOid('x'.repeat(80))).toHaveLength(64);
    expect(() => toMerchantOid('___')).toThrow(/merchant_oid/);
    expect(isMerchantOid('ord1001')).toBe(true);
    expect(isMerchantOid('ord_1001')).toBe(false);
    expect(isMerchantOid('')).toBe(false);
  });

  it('toKurus / toDecimalString / hashesEqual', () => {
    expect(toKurus(649)).toBe(64900);
    expect(toKurus(324.5)).toBe(32450);
    expect(toKurus(0.1 + 0.2)).toBe(30);
    expect(toDecimalString(100.999)).toBe('101.00');
    expect(toDecimalString(10.25)).toBe('10.25');
    expect(toDecimalString(150)).toBe('150.00');
    expect(hashesEqual('abc', 'abc')).toBe(true);
    expect(hashesEqual('abc', 'abd')).toBe(false);
    expect(hashesEqual('abc', 'abcd')).toBe(false);
  });

  it('parseCallbackBody: form-urlencoded metin / Buffer / nesne → düz sözlük; boş → null. normalizeIp, isPublicHttpUrl', () => {
    expect(parseCallbackBody('merchant_oid=ord1&status=success&total_amount=100&hash=a%2Bb%3D')).toEqual({ merchant_oid: 'ord1', status: 'success', total_amount: '100', hash: 'a+b=' });
    expect(parseCallbackBody(Buffer.from('merchant_oid=ord1&status=failed', 'utf8'))).toEqual({ merchant_oid: 'ord1', status: 'failed' });
    expect(parseCallbackBody({ merchant_oid: 'ord1', total_amount: 100, test_mode: true, hash: ['h1', 'h2'], nested: { a: 1 } })).toEqual({ merchant_oid: 'ord1', total_amount: '100', test_mode: 'true', hash: 'h1' });
    expect(parseCallbackBody('')).toBeNull();
    expect(parseCallbackBody(null)).toBeNull();
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp(undefined)).toBe('127.0.0.1');
    expect(normalizeIp('', '')).toBe('');
    expect(isPublicHttpUrl('https://bagdam.com/api/v1/payments/paytr/callback')).toBe(true);
    expect(isPublicHttpUrl('http://localhost:4010/x')).toBe(false);
    expect(isPublicHttpUrl('https://staging.bagdam.com:8443/x')).toBe(false);
    expect(isPublicHttpUrl('ftp://bagdam.com')).toBe(false);
  });
});
