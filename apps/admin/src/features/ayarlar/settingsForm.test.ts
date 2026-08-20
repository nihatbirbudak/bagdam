import { describe, expect, it } from 'vitest';
import type { AdminSettingField } from '../../lib/apiTypes';
import {
  isSettingsDraftDirty,
  normalizeSettingsGroup,
  normalizeSettingsGroups,
  paymentModeWarnings,
  selectOptionsFor,
  toSettingsBody,
  toSettingsDraft,
  validateSettingsDraft,
} from './settingsForm';

const MAIL_FIELDS: AdminSettingField[] = [
  { key: 'provider', label: 'Sağlayıcı', type: 'select', options: ['smtp', 'resend', 'ses'], value: 'smtp' },
  { key: 'host', label: 'SMTP', type: 'text', value: 'smtp.example.com' },
  { key: 'port', label: 'Port', type: 'number', value: 587 },
  { key: 'pass', label: 'Parola', type: 'secret', value: '••••••', hasValue: true },
  { key: 'fromName', label: 'Gönderen adı', type: 'text', value: '' },
];

describe('settingsForm — normalize', () => {
  it('B sözleşmesi: [{group,label,fields:[…]}] → grup listesi; secret maskeli + hasValue', () => {
    const groups = normalizeSettingsGroups([
      { group: 'mail', label: 'E-posta', fields: MAIL_FIELDS },
      { group: 'payment', fields: [{ key: 'iyzicoSecretKey', label: 'Gizli', type: 'secret', value: '••••••', hasValue: true }] },
    ]);
    expect(groups.map((g) => g.group)).toEqual(['mail', 'payment']);
    expect(groups[1].label).toBe('Ödeme');
    expect(groups[0].fields.find((f) => f.key === 'pass')).toMatchObject({ type: 'secret', hasValue: true, masked: true });
  });

  it('yalnız değer haritası gelirse alanlar değerden türetilir (secret anahtar adından)', () => {
    const g = normalizeSettingsGroup({ vatRate: 1, subscriberFreeShipping: true, deliveryWindow: '09:00–18:00', dunning: { retryHours: [24, 72] }, smtpPass: 'x' }, 'commerce');
    expect(g?.group).toBe('commerce');
    expect(g?.label).toBe('Ticaret / Kampanya');
    const byKey = Object.fromEntries((g?.fields ?? []).map((f) => [f.key, f]));
    expect(byKey.vatRate.type).toBe('number');
    expect(byKey.vatRate.label).toBe('Varsayılan KDV oranı (%)');
    expect(byKey.subscriberFreeShipping.type).toBe('boolean');
    expect(byKey.deliveryWindow.type).toBe('text');
    expect(byKey.dunning.type).toBe('json');
    expect(byKey.smtpPass.type).toBe('secret');
  });

  it('`{group:{…}}` haritası ve `{items:[…]}` zarfı da kabul edilir', () => {
    expect(normalizeSettingsGroups({ cookies: { fields: [{ key: 'analyticsEnabled', type: 'boolean', value: false }] } }).map((g) => g.group)).toEqual(['cookies']);
    expect(normalizeSettingsGroups({ items: [{ group: 'seo', fields: [] }] }).map((g) => g.group)).toEqual(['seo']);
    expect(normalizeSettingsGroups(null)).toEqual([]);
  });
});

describe('settingsForm — taslak ↔ gövde', () => {
  it('taslak: number metin, secret undefined, json pretty', () => {
    const d = toSettingsDraft([...MAIL_FIELDS, { key: 'extra', label: 'x', type: 'json', value: { a: 1 } }]);
    expect(d.port).toBe('587');
    expect(d.pass).toBeUndefined();
    expect(d.provider).toBe('smtp');
    expect(d.extra).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('gövde: dokunulmamış/maske secret gönderilmez; yeni secret gönderilir; number/json çevrilir', () => {
    const base = toSettingsDraft(MAIL_FIELDS);
    expect(toSettingsBody(MAIL_FIELDS, base)).toEqual({ provider: 'smtp', host: 'smtp.example.com', port: 587, fromName: '' });
    expect(toSettingsBody(MAIL_FIELDS, { ...base, pass: '••••••' }).pass).toBeUndefined();
    expect(toSettingsBody(MAIL_FIELDS, { ...base, pass: '' }).pass).toBeUndefined();
    expect(toSettingsBody(MAIL_FIELDS, { ...base, pass: 'yeni-sifre', port: '2525' })).toMatchObject({ pass: 'yeni-sifre', port: 2525 });
    const jsonFields: AdminSettingField[] = [{ key: 'dunning', label: 'd', type: 'json' }];
    expect(toSettingsBody(jsonFields, { dunning: '{"retryHours":[24,72]}' })).toEqual({ dunning: { retryHours: [24, 72] } });
    expect(toSettingsBody(jsonFields, { dunning: '' })).toEqual({ dunning: null });
  });

  it('doğrulama: sayı / JSON / select üyeliği; ADR-0018 select seçenekleri shared etiketlerinden', () => {
    const commerce: AdminSettingField[] = [
      { key: 'freeShippingRule', label: 'Eşik', type: 'select', value: 'gte' },
      { key: 'discountRounding', label: 'Yuvarlama', type: 'select', value: 'kurus' },
      { key: 'chargeStrategy', label: 'Strateji', type: 'select', value: 'MERCHANT_INITIATED' },
      { key: 'vatRate', label: 'KDV', type: 'number', value: 1 },
      { key: 'dunning', label: 'd', type: 'json' },
    ];
    expect(selectOptionsFor('commerce', commerce[0]).map((o) => o.value)).toEqual(['gte', 'gt']);
    expect(selectOptionsFor('commerce', commerce[1]).map((o) => o.value)).toEqual(['kurus', 'tl']);
    expect(selectOptionsFor('commerce', commerce[2]).map((o) => o.value)).toEqual(['MERCHANT_INITIATED', 'PAYMENT_LINK']);
    const errors = validateSettingsDraft('commerce', commerce, { freeShippingRule: 'maybe', discountRounding: 'tl', chargeStrategy: 'PAYMENT_LINK', vatRate: 'abc', dunning: '{bozuk' });
    expect(errors.freeShippingRule).toBeTruthy();
    expect(errors.discountRounding).toBeUndefined();
    expect(errors.vatRate).toBeTruthy();
    expect(errors.dunning).toBeTruthy();
  });

  it('B registry required/min/max/integer: zorunlu boş, aralık dışı, ondalık', () => {
    const fields: AdminSettingField[] = [
      { key: 'vatRate', label: 'KDV', type: 'number', required: true, min: 0, max: 100, value: 1 },
      { key: 'port', label: 'Port', type: 'number', integer: true, min: 1, max: 65535, value: 587 },
      { key: 'name', label: 'Ad', type: 'text', required: true, value: 'Bağdam' },
    ];
    expect(validateSettingsDraft('x', fields, { vatRate: '', port: '2,5', name: '' })).toEqual({ vatRate: 'Zorunlu sayı', port: 'Tam sayı olmalı', name: 'Zorunlu alan' });
    expect(validateSettingsDraft('x', fields, { vatRate: '101', port: '70000', name: 'a' })).toEqual({ vatRate: 'En çok 100', port: 'En çok 65535' });
    expect(validateSettingsDraft('x', fields, { vatRate: '10', port: '465', name: 'a' })).toEqual({});
  });

  it('dirty: secret yeni değer ya da herhangi bir alan farkı', () => {
    const base = toSettingsDraft(MAIL_FIELDS);
    expect(isSettingsDraftDirty(MAIL_FIELDS, base, { ...base })).toBe(false);
    expect(isSettingsDraftDirty(MAIL_FIELDS, base, { ...base, host: 'x' })).toBe(true);
    expect(isSettingsDraftDirty(MAIL_FIELDS, base, { ...base, pass: 'yeni' })).toBe(true);
    expect(isSettingsDraftDirty(MAIL_FIELDS, base, { ...base, pass: '' })).toBe(false);
  });
});

describe('settingsForm — Ödeme (ADR-0019 PayTR)', () => {
  const PAYTR_FIELDS: AdminSettingField[] = [
    { key: 'provider', label: 'Sağlayıcı', type: 'select', value: 'paytr' },
    { key: 'paytrMerchantId', label: 'Mağaza no', type: 'text', value: '123456' },
    { key: 'paytrMerchantKey', label: 'Key', type: 'secret', value: '••••••', hasValue: true },
    { key: 'paytrMerchantSalt', label: 'Salt', type: 'secret', value: '', hasValue: false },
    { key: 'paytrTestMode', label: 'Test modu', type: 'boolean', value: true },
    { key: 'storedCardEnabled', label: 'Kayıtlı kart', type: 'boolean', value: false },
    { key: 'enabled', label: 'Açık', type: 'boolean', value: true },
  ];

  it('sağlayıcı seçenekleri: paytr + manual (sunucu options vermezse); registry etiketleri paytr alanları için', () => {
    expect(selectOptionsFor('payment', { key: 'provider', label: 'Sağlayıcı', type: 'select' }).map((o) => o.value)).toEqual(['paytr', 'manual']);
    const g = normalizeSettingsGroup({ group: 'payment', fields: [{ key: 'paytrMerchantSalt', type: 'secret', value: '••••••', hasValue: true }, { key: 'paytrTestMode', type: 'boolean', value: true }] });
    expect(g?.fields.map((f) => f.label)).toEqual(['PayTR merchant salt', 'PayTR test modu']);
  });

  it('uyarılar: test modu + eksik salt + kayıtlı kart kapalı; manuel sağlayıcı; ödeme kapalı; registry PayTR alanı yok', () => {
    const codes = paymentModeWarnings({ fields: PAYTR_FIELDS }).map((w) => w.code);
    expect(codes).toEqual(['PAYTR_TEST_MODE', 'PAYTR_CREDENTIALS_MISSING', 'STORED_CARD_OFF']);
    expect(paymentModeWarnings({ fields: PAYTR_FIELDS }).find((w) => w.code === 'PAYTR_CREDENTIALS_MISSING')?.message).toContain('paytrMerchantSalt');

    const live = PAYTR_FIELDS.map((f) => (f.key === 'paytrTestMode' ? { ...f, value: false } : f.key === 'paytrMerchantSalt' ? { ...f, value: '••••••', hasValue: true } : f.key === 'storedCardEnabled' ? { ...f, value: true } : f));
    expect(paymentModeWarnings({ fields: live })).toEqual([]);

    const manual = PAYTR_FIELDS.map((f) => (f.key === 'provider' ? { ...f, value: 'manual' } : f.key === 'enabled' ? { ...f, value: false } : f));
    expect(paymentModeWarnings({ fields: manual }).map((w) => w.code)).toEqual(['MANUAL_PROVIDER', 'PAYMENTS_DISABLED']);

    const legacy = [{ key: 'provider', label: 'Sağlayıcı', type: 'select', value: 'iyzico' } as AdminSettingField, { key: 'iyzicoApiKey', label: 'x', type: 'secret', hasValue: false } as AdminSettingField];
    expect(paymentModeWarnings({ fields: legacy }).map((w) => w.code)).toEqual(['REGISTRY_NO_PAYTR', 'IYZICO_P2']);
    expect(paymentModeWarnings(null)).toEqual([]);
  });
});
