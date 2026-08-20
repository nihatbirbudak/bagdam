import { describe, expect, it } from 'vitest';
import { OrderKind } from '../enums';
import type { PricingRules } from '../types/pricing';
import { computeShipping, meetsFreeThreshold } from './shipping';

// Test verisi = prototip değerleri (products.js DELIVERY_FEE 49, sepet.html 1000 TL eşiği) — ama fonksiyon
// bunları zone'dan alır; hiçbir sabit yoktur (ADR-0005 [B11]).
const URLA = { fee: 49, freeThreshold: 1000 };
const NO_THRESHOLD = { fee: 79, freeThreshold: null };

describe('pricing/shipping (ADR-0005: abone ‖ zone eşik)', () => {
  it('abonelik siparişi → 0 (tutardan bağımsız)', () => {
    expect(computeShipping({ subtotalAfterDiscount: 324.5, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.SUBSCRIPTION })).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
  });

  it('aktif abonesi olan müşteri → tekil ürün siparişinde de 0', () => {
    expect(computeShipping({ subtotalAfterDiscount: 89, zone: URLA, hasActiveSubscription: true, orderKind: OrderKind.SINGLE })).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
  });

  it('tekil ürün: eşik altı → zone.fee (49); eşik ve üstü → 0', () => {
    expect(computeShipping({ subtotalAfterDiscount: 999.99, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toEqual({ fee: 49, reason: 'ZONE_FEE' });
    expect(computeShipping({ subtotalAfterDiscount: 1000, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toEqual({ fee: 0, reason: 'THRESHOLD' });
    expect(computeShipping({ subtotalAfterDiscount: 1099, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toEqual({ fee: 0, reason: 'THRESHOLD' });
  });

  it('tek seferlik kutu: zone kuralı (649 → 49; 1099 → 0)', () => {
    expect(computeShipping({ subtotalAfterDiscount: 649, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.BOX_ONE_TIME }).fee).toBe(49);
    expect(computeShipping({ subtotalAfterDiscount: 1099, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.BOX_ONE_TIME }).fee).toBe(0);
  });

  it('eşiksiz bölge → hep ücret; ücretsiz bölge → 0', () => {
    expect(computeShipping({ subtotalAfterDiscount: 5000, zone: NO_THRESHOLD, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toEqual({ fee: 79, reason: 'ZONE_FEE' });
    expect(computeShipping({ subtotalAfterDiscount: 10, zone: { fee: 0, freeThreshold: null }, hasActiveSubscription: false, orderKind: OrderKind.SINGLE }).fee).toBe(0);
  });

  it('geçersiz zone değerleri hata', () => {
    expect(() => computeShipping({ subtotalAfterDiscount: 10, zone: { fee: -1, freeThreshold: null }, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toThrow(RangeError);
    expect(() => computeShipping({ subtotalAfterDiscount: 10, zone: { fee: 49, freeThreshold: Number.NaN }, hasActiveSubscription: false, orderKind: OrderKind.SINGLE })).toThrow(RangeError);
  });
});

describe('pricing/shipping kurallar Setting\'den (ADR-0018)', () => {
  const single = (subtotal: number, rules?: Partial<PricingRules>, hasActiveSubscription = false) =>
    computeShipping({ subtotalAfterDiscount: subtotal, zone: URLA, hasActiveSubscription, orderKind: OrderKind.SINGLE, rules });

  it('freeShippingRule gte (varsayılan): 1000 → 0; gt: 1000 → 49, 1000,01 → 0', () => {
    expect(single(1000).fee).toBe(0);
    expect(single(1000, { freeShippingRule: 'gte' })).toEqual({ fee: 0, reason: 'THRESHOLD' });
    expect(single(999.99, { freeShippingRule: 'gte' }).fee).toBe(49);
    expect(single(1000, { freeShippingRule: 'gt' })).toEqual({ fee: 49, reason: 'ZONE_FEE' });
    expect(single(1000.01, { freeShippingRule: 'gt' })).toEqual({ fee: 0, reason: 'THRESHOLD' });
    expect(meetsFreeThreshold(1000, 1000, 'gte')).toBe(true);
    expect(meetsFreeThreshold(1000, 1000, 'gt')).toBe(false);
  });

  it('subscriberFreeShipping true (varsayılan): aktif abone tekil üründe 0; false: bölge kuralı', () => {
    expect(single(89, undefined, true)).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
    expect(single(89, { subscriberFreeShipping: true }, true)).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
    expect(single(89, { subscriberFreeShipping: false }, true)).toEqual({ fee: 49, reason: 'ZONE_FEE' });
    expect(single(1000, { subscriberFreeShipping: false }, true)).toEqual({ fee: 0, reason: 'THRESHOLD' });
  });

  it('subscriberFreeShipping false: abonelik siparişinin kendisinde kargo yine 0; aktif abonenin tek seferlik kutusu da 0 (yalnız SINGLE etkilenir)', () => {
    const rules = { subscriberFreeShipping: false } as const;
    expect(computeShipping({ subtotalAfterDiscount: 324.5, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.SUBSCRIPTION, rules })).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
    expect(computeShipping({ subtotalAfterDiscount: 324.5, zone: URLA, hasActiveSubscription: true, orderKind: OrderKind.SUBSCRIPTION, rules })).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
    expect(computeShipping({ subtotalAfterDiscount: 649, zone: URLA, hasActiveSubscription: true, orderKind: OrderKind.BOX_ONE_TIME, rules })).toEqual({ fee: 0, reason: 'SUBSCRIBER' });
    expect(computeShipping({ subtotalAfterDiscount: 649, zone: URLA, hasActiveSubscription: false, orderKind: OrderKind.BOX_ONE_TIME, rules })).toEqual({ fee: 49, reason: 'ZONE_FEE' });
  });

  it('bozuk kural değeri → varsayılan (gte / true)', () => {
    expect(single(1000, { freeShippingRule: 'foo' as never }).fee).toBe(0);
    expect(single(89, { subscriberFreeShipping: 'no' as never }, true).fee).toBe(0);
  });
});
