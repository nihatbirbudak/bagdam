import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE,
  applyDiscountPct,
  discountAmount,
  formatMoneyTr,
  netFromGross,
  roundExtraPrice,
  roundMoney,
  vatFromGross,
} from './index';

describe('pricing/roundMoney', () => {
  it('kuruşa yuvarlar (yarım yukarı)', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(649.5)).toBe(649.5);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('negatif tutarları simetrik yuvarlar', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.004)).toBe(0); // -0 döndürmez
  });

  it('sonlu olmayan değerde hata fırlatır', () => {
    expect(() => roundMoney(Number.NaN)).toThrow(TypeError);
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('pricing/KDV', () => {
  it('varsayılan KDV %1', () => {
    expect(DEFAULT_VAT_RATE).toBe(1);
  });

  it('KDV dahil tutardan KDV ve matrahı ayırır (sepet.html 0.01/1.01 kuralı)', () => {
    // 1099 TL kutu: KDV = 1099 × 1/101 ≈ 10.88
    expect(vatFromGross(1099)).toBe(10.88);
    expect(netFromGross(1099)).toBe(1088.12);
    expect(vatFromGross(1099) + netFromGross(1099)).toBeCloseTo(1099, 2);
  });

  it('farklı oran ile çalışır', () => {
    expect(vatFromGross(120, 20)).toBe(20);
    expect(netFromGross(120, 20)).toBe(100);
  });
});

describe('pricing/roundExtraPrice (cart.js subExtraPrice ile birebir)', () => {
  it('tam TL yuvarlar', () => {
    expect(roundExtraPrice(249, 0.25)).toBe(62); // 62.25 → 62
    expect(roundExtraPrice(249, 0.5)).toBe(125); // 124.5 → 125
    expect(roundExtraPrice(89, 3)).toBe(267);
  });
});

describe('pricing/indirim', () => {
  it('yüzde indirim tutarı ve uygulanmış tutar', () => {
    expect(discountAmount(649, 50)).toBe(324.5);
    expect(applyDiscountPct(649, 50)).toBe(324.5);
    expect(applyDiscountPct(1099, 0)).toBe(1099);
    expect(() => discountAmount(100, 101)).toThrow(RangeError);
  });
});

describe('pricing/formatMoneyTr', () => {
  it('binlik ayırıcı nokta, kuruş varsa virgül', () => {
    expect(formatMoneyTr(1099)).toBe('1.099');
    expect(formatMoneyTr(649)).toBe('649');
    expect(formatMoneyTr(1099.5)).toBe('1.099,50');
  });
});
