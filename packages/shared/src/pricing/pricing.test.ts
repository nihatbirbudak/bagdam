import { describe, expect, it } from 'vitest';
import { OrderKind, OrderLineKind } from '../enums';
import type { PricingContext, PricingLineInput } from '../types/pricing';
import { computeCycleCharge, computeQuote, roundMoney, vatFromGrossRaw } from './index';

// Prototip verisi: products.js SUB_TIERS small 649 (6'lı) / sezon 1099 (10'lu), DELIVERY_FEE 49, sepet.html 1000 TL eşiği.
// Kargo değerleri fonksiyona zone ile verilir (ADR-0005 [B11]); fiyatlar satırlarla gelir.
const ZONE = { fee: 49, freeThreshold: 1000 };
const BOX_SMALL: PricingLineInput = { kind: OrderLineKind.BOX, unitPrice: 649, qty: 1, tierSlug: 'small' };
const BOX_SEZON: PricingLineInput = { kind: OrderLineKind.BOX, unitPrice: 1099, qty: 1, tierSlug: 'sezon' };
const EXTRA_ZEYTINYAGI_500G: PricingLineInput = { kind: OrderLineKind.EXTRA, unitPrice: 249, qty: 0.5, productId: 'zeytinyagi' }; // 124.5 → 125
const EXTRA_DOMATES_3: PricingLineInput = { kind: OrderLineKind.EXTRA, unitPrice: 89, qty: 3, productId: 'domates' }; // 267
const PRODUCT_89x2: PricingLineInput = { kind: OrderLineKind.PRODUCT, unitPrice: 89, qty: 2, productId: 'ekmek' }; // 178

const base: PricingContext = {
  zone: ZONE,
  hasActiveSubscription: false,
  isSubscriptionCheckout: false,
  firstBoxesLeft: 0,
  retentionPct: null,
  vatRateDefault: 1,
};
const ctx = (o: Partial<PricingContext> = {}): PricingContext => ({ ...base, ...o });
const codes = (q: { notes: { code: string }[] }) => q.notes.map((n) => n.code);
/** sepet.html: `vat += lineTotal * (0.01/1.01)` (satır satır), sonra tek yuvarlama. */
const sepetVat = (lineTotals: number[]) => roundMoney(lineTotals.reduce((s, l) => s + l * (0.01 / 1.01), 0));

describe('pricing/computeQuote — cart.js/sepet.html senaryoları', () => {
  it('6\'lı kutu 649 + ekstralar, abonelik (indirim hakkı yok): kargo dahil, KDV sepet.html ile aynı kuruş', () => {
    const q = computeQuote([BOX_SMALL, EXTRA_ZEYTINYAGI_500G, EXTRA_DOMATES_3], ctx({ isSubscriptionCheckout: true }));
    expect(q.orderKind).toBe(OrderKind.SUBSCRIPTION);
    expect(q.lines.map((l) => l.lineTotal)).toEqual([649, 125, 267]);
    expect(q.subtotal).toBe(1041); // kutu.html: tier + extras
    expect(q.discountTotal).toBe(0);
    expect(q.shippingFee).toBe(0); // "Kargo: Dahil"
    expect(q.vatTotal).toBe(sepetVat([1041])); // sepet.html kutu satırı = tier + extras tek satır
    expect(q.vatTotal).toBe(10.31);
    expect(q.grandTotal).toBe(1041);
    expect(q.prepaidAmount).toBe(1041);
    expect(codes(q)).toEqual(['FREE_SHIPPING_SUBSCRIBER']);
  });

  it('ilk 2 kutu %50 (ADR-0007): kutuya iner, ekstralara değil; 649 → 324,50', () => {
    const q = computeQuote([BOX_SMALL, EXTRA_DOMATES_3], ctx({ isSubscriptionCheckout: true, firstBoxesLeft: 2 }));
    expect(q.discountTotal).toBe(324.5);
    expect(q.lines[0]?.discount).toBe(324.5);
    expect(q.lines[1]?.discount).toBe(0);
    expect(q.subtotal).toBe(916);
    expect(q.grandTotal).toBe(591.5); // 324,50 + 267
    expect(q.prepaidAmount).toBe(591.5);
    // KDV indirim sonrası tutardan: (324.5 + 267) × 1/101
    expect(q.vatTotal).toBe(roundMoney(vatFromGrossRaw(591.5)));
    expect(q.lines[0]?.vatAmount).toBe(3.21); // 324.5/101
    expect(codes(q)).toEqual(['FIRST_BOXES_DISCOUNT', 'FREE_SHIPPING_SUBSCRIBER']);
    expect(q.notes[0]?.amount).toBe(324.5);
  });

  it('10\'lu kutu 1099 abonelik, ilk kutu → 549,50; kargo 0', () => {
    const q = computeQuote([BOX_SEZON], ctx({ isSubscriptionCheckout: true, firstBoxesLeft: 1 }));
    expect(q.discountTotal).toBe(549.5);
    expect(q.grandTotal).toBe(549.5);
    expect(q.shippingFee).toBe(0);
  });

  it('retention %50: ilk-kutu hakkı bitince bir kutuya; ikisi birlikte üst üste binmez', () => {
    const r = computeQuote([BOX_SMALL], ctx({ isSubscriptionCheckout: true, retentionPct: 50 }));
    expect(r.discountTotal).toBe(324.5);
    expect(codes(r)).toContain('RETENTION_DISCOUNT');
    const both = computeQuote([BOX_SMALL], ctx({ isSubscriptionCheckout: true, firstBoxesLeft: 1, retentionPct: 50 }));
    expect(both.discountTotal).toBe(324.5);
    expect(codes(both)).toContain('FIRST_BOXES_DISCOUNT');
    expect(codes(both)).not.toContain('RETENTION_DISCOUNT');
  });

  it('tek seferlik kutu: indirim yok, kargo zone kuralı (649 → 49; 1099 → eşik üstü 0)', () => {
    const small = computeQuote([BOX_SMALL], ctx({ firstBoxesLeft: 2 }));
    expect(small.orderKind).toBe(OrderKind.BOX_ONE_TIME);
    expect(small.discountTotal).toBe(0);
    expect(small.shippingFee).toBe(49); // kutu.html subDeliveryFee
    expect(small.grandTotal).toBe(698);
    expect(small.prepaidAmount).toBe(649); // kargo peşin kutu tutarına girmez
    expect(codes(small)).toEqual(['NO_BOX_DISCOUNT_ONE_TIME', 'SHIPPING_FEE']);
    const sezon = computeQuote([BOX_SEZON], ctx());
    expect(sezon.shippingFee).toBe(0); // sepet.html: subtotal > 1000 → "Dahil"
    expect(codes(sezon)).toEqual(['FREE_SHIPPING_THRESHOLD']);
  });

  it('tekil ürünler: kargo 49 / eşik 1000 → 0; aktif aboneye kargo 0', () => {
    const q = computeQuote([PRODUCT_89x2], ctx());
    expect(q.orderKind).toBe(OrderKind.SINGLE);
    expect(q.subtotal).toBe(178);
    expect(q.shippingFee).toBe(49);
    expect(q.vatTotal).toBe(sepetVat([178]));
    expect(q.grandTotal).toBe(227);
    expect(q.prepaidAmount).toBeNull();
    expect(computeQuote([PRODUCT_89x2], ctx({ hasActiveSubscription: true })).shippingFee).toBe(0);
    // eşik: 999 → 49, 1000 → 0
    const p999 = computeQuote([{ kind: OrderLineKind.PRODUCT, unitPrice: 999, qty: 1 }], ctx());
    const p1000 = computeQuote([{ kind: OrderLineKind.PRODUCT, unitPrice: 500, qty: 2 }], ctx());
    expect(p999.shippingFee).toBe(49);
    expect(p1000.shippingFee).toBe(0);
    expect(p1000.grandTotal).toBe(1000);
  });

  it('karışık sepet: abonelik kutusu + ürün → SUBSCRIPTION, her şeye kargo 0; tek seferlik kutu + ürün → BOX_ONE_TIME + zone kuralı', () => {
    const sub = computeQuote([PRODUCT_89x2, BOX_SMALL], ctx({ isSubscriptionCheckout: true }));
    expect(sub.orderKind).toBe(OrderKind.SUBSCRIPTION);
    expect(sub.shippingFee).toBe(0);
    expect(sub.grandTotal).toBe(827);
    expect(sub.prepaidAmount).toBe(649); // yalnız kutu kısmı
    const once = computeQuote([PRODUCT_89x2, BOX_SMALL], ctx());
    expect(once.orderKind).toBe(OrderKind.BOX_ONE_TIME);
    expect(once.subtotal).toBe(827);
    expect(once.shippingFee).toBe(49);
    expect(once.grandTotal).toBe(876);
    const onceBig = computeQuote([PRODUCT_89x2, BOX_SEZON], ctx());
    expect(onceBig.shippingFee).toBe(0); // 1277 ≥ 1000
  });

  it('KDV %1 ayrıştırma: çok satırlı sepette sepet.html formülüyle aynı kuruş; satır KDV\'leri ayrı ayrı yuvarlı', () => {
    const q = computeQuote([BOX_SEZON, PRODUCT_89x2], ctx());
    expect(q.vatTotal).toBe(sepetVat([1099, 178])); // 12.64
    expect(q.lines.map((l) => l.vatAmount)).toEqual([10.88, 1.76]);
    const lineSum = roundMoney(q.lines.reduce((s, l) => s + l.vatAmount, 0));
    expect(Math.abs(lineSum - q.vatTotal)).toBeLessThanOrEqual(0.01 * q.lines.length);
  });

  it('satır KDV oranı satırdan, yoksa ctx varsayılanı', () => {
    const q = computeQuote(
      [{ kind: OrderLineKind.PRODUCT, unitPrice: 120, qty: 1, vatRate: 20 }, { kind: OrderLineKind.PRODUCT, unitPrice: 101, qty: 1 }],
      ctx({ hasActiveSubscription: true }),
    );
    expect(q.lines.map((l) => l.vatRate)).toEqual([20, 1]);
    expect(q.lines.map((l) => l.vatAmount)).toEqual([20, 1]);
    expect(q.vatTotal).toBe(21);
  });

  it('skipThisWeek (cart.js): kutu ve ekstralar 0, indirim yok, ürünler ödenir; abonelik kargo 0', () => {
    const q = computeQuote([BOX_SMALL, EXTRA_DOMATES_3, PRODUCT_89x2], ctx({ isSubscriptionCheckout: true, firstBoxesLeft: 2, skipThisWeek: true }));
    expect(q.lines.map((l) => l.lineTotal)).toEqual([0, 0, 178]);
    expect(q.discountTotal).toBe(0);
    expect(q.subtotal).toBe(178);
    expect(q.shippingFee).toBe(0);
    expect(q.grandTotal).toBe(178);
    expect(q.prepaidAmount).toBe(0);
    expect(codes(q)).toEqual(['SKIPPED_WEEK', 'FREE_SHIPPING_SUBSCRIBER']);
    // yalnız kutu + atla → toplam 0 (sepet.html "BU HAFTA ATLANDI", Toplam 0 TL)
    const only = computeQuote([BOX_SMALL, EXTRA_DOMATES_3], ctx({ isSubscriptionCheckout: true, skipThisWeek: true }));
    expect(only.grandTotal).toBe(0);
    expect(only.vatTotal).toBe(0);
  });

  it('boş sepet → sıfırlar, SINGLE, kargo 0, EMPTY notu', () => {
    const q = computeQuote([], ctx());
    expect(q).toMatchObject({ orderKind: OrderKind.SINGLE, subtotal: 0, discountTotal: 0, shippingFee: 0, vatTotal: 0, grandTotal: 0, prepaidAmount: null });
    expect(codes(q)).toEqual(['EMPTY']);
  });

  it('değişmezler: grandTotal = subtotal − discount + shipping; girdi satırları değiştirilmez', () => {
    const input = [BOX_SMALL, EXTRA_DOMATES_3, PRODUCT_89x2];
    const snapshot = JSON.stringify(input);
    for (const c of [ctx(), ctx({ isSubscriptionCheckout: true, firstBoxesLeft: 2 }), ctx({ hasActiveSubscription: true })]) {
      const q = computeQuote(input, c);
      expect(q.grandTotal).toBe(roundMoney(q.subtotal - q.discountTotal + q.shippingFee));
      expect(q.vatTotal).toBeLessThanOrEqual(q.subtotal);
    }
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('geçersiz satır hata (negatif fiyat/adet, negatif KDV)', () => {
    expect(() => computeQuote([{ kind: OrderLineKind.PRODUCT, unitPrice: -1, qty: 1 }], ctx())).toThrow(RangeError);
    expect(() => computeQuote([{ kind: OrderLineKind.PRODUCT, unitPrice: 1, qty: -1 }], ctx())).toThrow(RangeError);
    expect(() => computeQuote([{ kind: OrderLineKind.PRODUCT, unitPrice: 1, qty: 1, vatRate: -1 }], ctx())).toThrow(RangeError);
  });
});

describe('pricing/computeCycleCharge — kilit snapshot\'ı ve DELTA (state-machines §8, ADR-0006)', () => {
  it('cycle#1 peşin + sonradan eklenen ekstra → yalnız DELTA tahsil edilir', () => {
    // checkout: 649 kutu, ilk kutu %50 → 324,50 peşin. Kesime kadar 500 g zeytinyağı (125) eklendi.
    const q = computeCycleCharge({
      boxPrice: 649,
      extras: [{ unitPrice: 249, factor: 0.5 }],
      isOneTime: false,
      zone: ZONE,
      firstBoxesLeft: 2, // checkout'ta henüz düşmedi: kilit snapshot'ı aynı indirimi uygular
      retentionPct: null,
      prepaidAmount: 324.5,
    });
    expect(q).toEqual({ boxPrice: 649, extrasTotal: 125, discount: 324.5, shippingFee: 0, total: 449.5, due: 125, discountKind: 'FIRST_BOXES' });
  });

  it('cycle#1 ekstra yok → due 0 (tahsilat yok, CHARGED)', () => {
    const q = computeCycleCharge({ boxPrice: 649, extras: [], isOneTime: false, zone: ZONE, firstBoxesLeft: 2, retentionPct: null, prepaidAmount: 324.5 });
    expect(q.due).toBe(0);
  });

  it('cycle#2: ikinci indirimli kutu (hak 1) tümü tahsil; cycle#3: tam fiyat; retention sonraki kutuya', () => {
    expect(computeCycleCharge({ boxPrice: 649, extras: [], isOneTime: false, zone: ZONE, firstBoxesLeft: 1, retentionPct: null, prepaidAmount: 0 })).toMatchObject({ total: 324.5, due: 324.5 });
    expect(computeCycleCharge({ boxPrice: 649, extras: [], isOneTime: false, zone: ZONE, firstBoxesLeft: 0, retentionPct: null, prepaidAmount: 0 })).toMatchObject({ total: 649, due: 649, discountKind: null });
    expect(computeCycleCharge({ boxPrice: 649, extras: [{ unitPrice: 89, factor: 3 }], isOneTime: false, zone: ZONE, firstBoxesLeft: 0, retentionPct: 50, prepaidAmount: 0 })).toMatchObject({ discount: 324.5, total: 591.5, discountKind: 'RETENTION' });
  });

  it('tek seferlik kutu: indirim yok, kargo zone kuralı, peşin ödendiyse due 0', () => {
    const q = computeCycleCharge({ boxPrice: 649, extras: [], isOneTime: true, zone: ZONE, firstBoxesLeft: 2, retentionPct: 50, prepaidAmount: 698 });
    expect(q).toMatchObject({ discount: 0, shippingFee: 49, total: 698, due: 0, discountKind: null });
    // 1099 → eşik üstü kargo 0
    expect(computeCycleCharge({ boxPrice: 1099, extras: [], isOneTime: true, zone: ZONE, firstBoxesLeft: 0, retentionPct: null, prepaidAmount: 0 }).shippingFee).toBe(0);
  });
});
