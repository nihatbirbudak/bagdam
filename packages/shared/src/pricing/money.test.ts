import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE,
  applyDiscountPct,
  discountAmount,
  formatMoneyTr,
  netFromGross,
  roundExtraPrice,
  roundMoney,
  sumMoney,
  vatFromGross,
  vatFromGrossRaw,
} from './money';

describe('pricing/money roundMoney', () => {
  it('kuruşa yuvarlar — yarım yukarı (banker\'s değil)', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.125)).toBe(0.13); // banker's olsaydı 0.12
    expect(roundMoney(2.675)).toBe(2.68); // float artığı (2.67499…) bastırılır
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(649.5)).toBe(649.5);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('negatif tutarları simetrik yuvarlar, -0 döndürmez', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(Object.is(roundMoney(-0.004), 0)).toBe(true);
  });

  it('sonlu olmayan değerde hata fırlatır', () => {
    expect(() => roundMoney(Number.NaN)).toThrow(TypeError);
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('pricing/money KDV', () => {
  it('varsayılan KDV %1', () => {
    expect(DEFAULT_VAT_RATE).toBe(1);
  });

  it('KDV dahil tutardan KDV ve matrahı ayırır (sepet.html 0.01/1.01 kuralı)', () => {
    expect(vatFromGross(1099)).toBe(10.88); // 1099 × 1/101 = 10.8811…
    expect(vatFromGross(649)).toBe(6.43); // 6.4257…
    expect(netFromGross(1099)).toBe(1088.12);
    expect(vatFromGross(1099) + netFromGross(1099)).toBeCloseTo(1099, 2);
    // sepet.html formülüyle birebir: line * (0.01 / 1.01)
    expect(vatFromGrossRaw(1099)).toBeCloseTo(1099 * (0.01 / 1.01), 10);
  });

  it('farklı oran ile çalışır; negatif oran hata', () => {
    expect(vatFromGross(120, 20)).toBe(20);
    expect(netFromGross(120, 20)).toBe(100);
    expect(vatFromGross(100, 0)).toBe(0);
    expect(() => vatFromGross(100, -1)).toThrow(RangeError);
  });
});

describe('pricing/money sumMoney', () => {
  it('toplar ve kuruşa yuvarlar', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([649, 125, 267])).toBe(1041);
    expect(sumMoney([])).toBe(0);
    expect(() => sumMoney([1, Number.NaN])).toThrow(TypeError);
  });
});

describe('pricing/money roundExtraPrice (cart.js subExtraPrice ile birebir)', () => {
  it('tam TL yuvarlar', () => {
    expect(roundExtraPrice(249, 0.25)).toBe(62); // 62.25 → 62
    expect(roundExtraPrice(249, 0.5)).toBe(125); // 124.5 → 125
    expect(roundExtraPrice(89, 3)).toBe(267);
    expect(roundExtraPrice(149.9, 2)).toBe(300); // 299.8 → 300
  });
});

describe('pricing/money indirim', () => {
  it('yüzde indirim tutarı ve uygulanmış tutar (kuruş hassasiyeti)', () => {
    expect(discountAmount(649, 50)).toBe(324.5);
    expect(applyDiscountPct(649, 50)).toBe(324.5);
    expect(applyDiscountPct(1099, 0)).toBe(1099);
    expect(() => discountAmount(100, 101)).toThrow(RangeError);
  });
});

describe('pricing/money formatMoneyTr', () => {
  it('binlik ayırıcı nokta, kuruş varsa virgül', () => {
    expect(formatMoneyTr(1099)).toBe('1.099');
    expect(formatMoneyTr(649)).toBe('649');
    expect(formatMoneyTr(1099.5)).toBe('1.099,50');
    expect(formatMoneyTr(324.5)).toBe('324,50');
  });
});
