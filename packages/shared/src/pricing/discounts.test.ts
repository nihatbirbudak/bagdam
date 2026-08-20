import { describe, expect, it } from 'vitest';
import { OrderKind, OrderLineKind } from '../enums';
import { computeDeltaOrder, firstBoxesDiscount, resolveBoxDiscount, retentionDiscount } from './discounts';

describe('pricing/discounts ilk-2-kutu (ADR-0007)', () => {
  it('hak varsa kutuya %50 — kuruş hassasiyetiyle (649 → 324,50; 1099 → 549,50)', () => {
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 2 })).toBe(324.5);
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 1 })).toBe(324.5);
    expect(firstBoxesDiscount({ boxTotal: 1099, firstBoxesLeft: 2 })).toBe(549.5);
  });

  it('hak bittiyse / yüzde 0 / kutu 0 → 0', () => {
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 0 })).toBe(0);
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 2, pct: 0 })).toBe(0);
    expect(firstBoxesDiscount({ boxTotal: 0, firstBoxesLeft: 2 })).toBe(0);
    expect(() => firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 1.5 })).toThrow(RangeError);
  });

  it('Setting yüzdesi parametreyle değişir', () => {
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 1, pct: 20 })).toBe(129.8);
  });
});

describe('pricing/discounts retention', () => {
  it('nextBoxDiscountPct varsa kutuya uygulanır (uyelik.html: 1 kutuluk %50)', () => {
    expect(retentionDiscount({ boxTotal: 649, retentionPct: 50 })).toBe(324.5);
    expect(retentionDiscount({ boxTotal: 649, retentionPct: null })).toBe(0);
    expect(retentionDiscount({ boxTotal: 649, retentionPct: 0 })).toBe(0);
  });
});

describe('pricing/discounts resolveBoxDiscount (sıra: ilk-kutu → retention; üst üste binmez)', () => {
  it('ilk-kutu hakkı varken retention devreye girmez', () => {
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 1, retentionPct: 50 })).toEqual({ amount: 324.5, kind: 'FIRST_BOXES', pct: 50 });
  });
  it('hak bitince retention', () => {
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 0, retentionPct: 50 })).toEqual({ amount: 324.5, kind: 'RETENTION', pct: 50 });
  });
  it('ikisi de yoksa 0', () => {
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 0, retentionPct: null })).toEqual({ amount: 0, kind: null, pct: 0 });
  });
});

describe('pricing/discounts yuvarlama Setting commerce.discountRounding (ADR-0018)', () => {
  it('kurus (varsayılan): 649 %50 → 324,50; tl: → 325 (Math.round, prototip)', () => {
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 2, rounding: 'kurus' })).toBe(324.5);
    expect(firstBoxesDiscount({ boxTotal: 649, firstBoxesLeft: 2, rounding: 'tl' })).toBe(325);
    expect(retentionDiscount({ boxTotal: 649, retentionPct: 50, rounding: 'kurus' })).toBe(324.5);
    expect(retentionDiscount({ boxTotal: 649, retentionPct: 50, rounding: 'tl' })).toBe(325);
    expect(firstBoxesDiscount({ boxTotal: 1099, firstBoxesLeft: 1, rounding: 'tl' })).toBe(550); // 549,50 → 550
  });

  it('resolveBoxDiscount ctx.rules ile: tl → 325 (ilk-kutu ve retention); rules yoksa / bozuksa kuruş', () => {
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 1, retentionPct: null, rules: { discountRounding: 'tl' } })).toEqual({ amount: 325, kind: 'FIRST_BOXES', pct: 50 });
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 0, retentionPct: 50, rules: { discountRounding: 'tl' } })).toEqual({ amount: 325, kind: 'RETENTION', pct: 50 });
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 1, retentionPct: null, rules: {} }).amount).toBe(324.5);
    expect(resolveBoxDiscount(649, { firstBoxesLeft: 1, retentionPct: null, rules: { discountRounding: 'lira' as never } }).amount).toBe(324.5);
  });
});

describe('pricing/discounts computeDeltaOrder (ADR-0006: kesim öncesi eklenen ekstralar ayrı küçük sipariş)', () => {
  const extras = [
    { kind: OrderLineKind.EXTRA, unitPrice: 249, qty: 0.5, productId: 'zeytinyagi' }, // 124.5 → 125 (cart.js)
    { kind: OrderLineKind.EXTRA, unitPrice: 89, qty: 3, productId: 'domates' }, // 267
  ];

  it('kargo yok, indirim yok, KDV satır bazlı, tür abonelikten miras', () => {
    const q = computeDeltaOrder(extras, { isSubscriptionCheckout: true, vatRateDefault: 1 });
    expect(q.orderKind).toBe(OrderKind.SUBSCRIPTION);
    expect(q.lines.map((l) => l.lineTotal)).toEqual([125, 267]);
    expect(q.subtotal).toBe(392);
    expect(q.discountTotal).toBe(0);
    expect(q.shippingFee).toBe(0);
    expect(q.vatTotal).toBe(3.88); // 392 × 1/101 = 3.8811…
    expect(q.grandTotal).toBe(392);
    expect(q.prepaidAmount).toBeNull();
    expect(q.notes.map((n) => n.code)).toContain('DELTA_NO_SHIPPING');
  });

  it('tek seferlik kutunun DELTA\'sı BOX_ONE_TIME', () => {
    expect(computeDeltaOrder(extras, { isSubscriptionCheckout: false, vatRateDefault: 1 }).orderKind).toBe(OrderKind.BOX_ONE_TIME);
  });

  it('EXTRA dışı satır kabul etmez; boş liste 0 + EMPTY notu', () => {
    expect(() => computeDeltaOrder([{ kind: OrderLineKind.PRODUCT, unitPrice: 89, qty: 1 }], { isSubscriptionCheckout: true, vatRateDefault: 1 })).toThrow(TypeError);
    const empty = computeDeltaOrder([], { isSubscriptionCheckout: true, vatRateDefault: 1 });
    expect(empty.grandTotal).toBe(0);
    expect(empty.notes[0]?.code).toBe('EMPTY');
  });

  it('telafi: 0 TL EXTRA satırı (ADR-0008) → 0 tutar', () => {
    const q = computeDeltaOrder([{ kind: OrderLineKind.EXTRA, unitPrice: 0, qty: 1 }], { isSubscriptionCheckout: true, vatRateDefault: 1 });
    expect(q.grandTotal).toBe(0);
    expect(q.vatTotal).toBe(0);
  });
});
