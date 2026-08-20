import { describe, expect, it } from 'vitest';
import { COMMERCE_SETTINGS_DEFAULTS } from '../types/settings';
import { buildExtraOptions, extraPrice, extrasTotal, formatWeightLabel, resolveExtraOptions, unitGrams } from './extras';

describe('pricing/extras seçenekler (cart.js subExtraOptions ile birebir)', () => {
  it('kg birimi → 250 g / 500 g / 1 kg / 2 kg', () => {
    expect(resolveExtraOptions('kg')).toEqual([
      { factor: 0.25, label: '250 g' },
      { factor: 0.5, label: '500 g' },
      { factor: 1, label: '1 kg' },
      { factor: 2, label: '2 kg' },
    ]);
  });

  it('"500 g" birimi → 500 g / 1 kg / 1,5 kg', () => {
    expect(resolveExtraOptions('500 g')).toEqual([
      { factor: 1, label: '500 g' },
      { factor: 2, label: '1 kg' },
      { factor: 3, label: '1,5 kg' },
    ]);
  });

  it('sayılı birim (adet, demet) → 1..4 × birim (default listesi)', () => {
    expect(resolveExtraOptions('demet')).toEqual([
      { factor: 1, label: '1 demet' },
      { factor: 2, label: '2 demet' },
      { factor: 3, label: '3 demet' },
      { factor: 4, label: '4 demet' },
    ]);
    expect(resolveExtraOptions('adet').map((o) => o.label)).toEqual(['1 adet', '2 adet', '3 adet', '4 adet']);
  });

  it('Product.extraOptions doluysa Setting yerine o kullanılır', () => {
    const own = [{ factor: 6, label: '6 adet' }, { factor: 12, label: '12 adet' }];
    expect(resolveExtraOptions('adet', COMMERCE_SETTINGS_DEFAULTS, own)).toEqual(own);
    expect(resolveExtraOptions('adet', COMMERCE_SETTINGS_DEFAULTS, [])).toHaveLength(4); // boş → Setting
  });

  it('Setting tablosu değişince seçenekler değişir; default yoksa boş', () => {
    expect(resolveExtraOptions('kg', { extraAmountOptions: { kg: [0.5, 1] } })).toEqual([
      { factor: 0.5, label: '500 g' },
      { factor: 1, label: '1 kg' },
    ]);
    expect(resolveExtraOptions('demet', { extraAmountOptions: { kg: [1] } })).toEqual([]);
  });

  it('ağırlık yardımcıları', () => {
    expect(unitGrams('kg')).toBe(1000);
    expect(unitGrams('500 g')).toBe(500);
    expect(unitGrams('250 gr')).toBe(250);
    expect(unitGrams('1 kg')).toBe(1000);
    expect(unitGrams('demet')).toBeNull();
    expect(formatWeightLabel(250)).toBe('250 g');
    expect(formatWeightLabel(1000)).toBe('1 kg');
    expect(formatWeightLabel(1500)).toBe('1,5 kg');
    expect(formatWeightLabel(2500)).toBe('2,5 kg');
    expect(buildExtraOptions('kg', [0.75])).toEqual([{ factor: 0.75, label: '750 g' }]);
    expect(() => buildExtraOptions('kg', [0])).toThrow(RangeError);
  });
});

describe('pricing/extras fiyat ve toplam (cart.js subExtraPrice / subExtrasTotal)', () => {
  it('her ekstra tam TL\'ye yuvarlanır, sonra toplanır', () => {
    expect(extraPrice(249, 0.25)).toBe(62);
    expect(extraPrice(249, 0.5)).toBe(125);
    expect(extrasTotal([
      { unitPrice: 249, factor: 0.25 }, // 62
      { unitPrice: 249, factor: 0.5 }, // 125
      { unitPrice: 89, factor: 3 }, // 267
    ])).toBe(454);
    expect(extrasTotal([])).toBe(0);
  });

  it('"kutuma ekle" (sepetten taşınan ürün: factor = adet) → adet × fiyat', () => {
    expect(extraPrice(89, 2)).toBe(178);
  });
});
