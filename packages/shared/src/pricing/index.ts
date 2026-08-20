// ── Fiyatlama (paylaşılan kurallar) ───────────────────────────────────────────
// F2'de dolacak (YOL-HARITASI F2: "KDV, ilk-2-kutu, ekstra yuvarlama, kargo/eşik
// zone'dan, kesim hesabı TZ'li"). Şimdilik: para tipi, KDV sabiti ve yuvarlama
// yardımcıları. Tek doğruluk kaynağı ileride apps/api PricingService'tir; bu
// dosya onun yalın (DB'siz) hesap çekirdeği olur — admin ve web önizlemeleri
// aynı fonksiyonları kullanır (ADR-0002: kimse kendi hesabını yazmaz).

/**
 * Para: TL, KDV DAHİL, 2 ondalık. DB'de `Decimal(12,2)`; API DTO'larında number
 * (mapper: `Number(decimal)`). Toplama/çarpma sonrası mutlaka `roundMoney`.
 * (Integer-kuruş yerine number seçildi; tutarlar küçük, çarpan sayısı az —
 * F2'de gerekirse kuruş tabanlı tam sayıya geçilir, imza değişmez.)
 */
export type Money = number;

/** Varsayılan KDV oranı (yüzde): gıda %1 — `Product.vatRate`/`OrderLine.vatRate` varsayılanı (ADR-0001). */
export const DEFAULT_VAT_RATE = 1;

/** Kuruşa yuvarlar (2 ondalık, yarım yukarı). Floating nokta artıklarını `Number.EPSILON` ile bastırır. */
export function roundMoney(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new TypeError(`roundMoney: sonlu bir sayı bekleniyordu, gelen: ${String(value)}`);
  }
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const rounded = (sign * Math.round((abs + Number.EPSILON) * 100)) / 100;
  return rounded === 0 ? 0 : rounded; // -0 → 0
}

/**
 * KDV dahil tutardan KDV tutarı. sepet.html'deki `line * (0.01 / 1.01)` kuralının genel hali:
 * vat = gross × rate / (100 + rate).
 */
export function vatFromGross(gross: Money, vatRatePct: number = DEFAULT_VAT_RATE): Money {
  if (vatRatePct < 0) throw new RangeError('vatFromGross: KDV oranı negatif olamaz');
  return roundMoney((gross * vatRatePct) / (100 + vatRatePct));
}

/** KDV dahil tutardan KDV hariç (matrah) tutar. */
export function netFromGross(gross: Money, vatRatePct: number = DEFAULT_VAT_RATE): Money {
  return roundMoney(gross - vatFromGross(gross, vatRatePct));
}

/**
 * Ekstra (kutu üstü ürün) fiyatı: cart.js `subExtraPrice` ile BİREBİR —
 * `Math.round(p.price * extra.factor)` → tam TL'ye yuvarlanır (kuruş yok).
 * `factor`: ürünün kendi birim fiyatını çarpan (250 g için 0.25 vb.).
 */
export function roundExtraPrice(unitPrice: Money, factor: number): Money {
  if (!Number.isFinite(unitPrice) || !Number.isFinite(factor)) {
    throw new TypeError('roundExtraPrice: fiyat ve çarpan sonlu sayı olmalı');
  }
  return Math.round(unitPrice * factor);
}

/** Yüzde indirim tutarı (kuruşa yuvarlı). pct 0–100. */
export function discountAmount(amount: Money, pct: number): Money {
  if (pct < 0 || pct > 100) throw new RangeError('discountAmount: pct 0–100 aralığında olmalı');
  return roundMoney((amount * pct) / 100);
}

/** Yüzde indirim uygulanmış tutar. */
export function applyDiscountPct(amount: Money, pct: number): Money {
  return roundMoney(amount - discountAmount(amount, pct));
}

/** Tutarı Türkçe biçimde yazar ("1.099" / "1.099,50") — cart.js `money()` ile aynı görünüm (binlik nokta, kuruş varsa virgül). */
export function formatMoneyTr(amount: Money): string {
  const rounded = roundMoney(amount);
  const hasCents = Math.round(rounded * 100) % 100 !== 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(rounded);
}

// ── F2'de eklenecekler (TODO) ────────────────────────────────────────────────
// TODO(F2): shippingFee({ isSubscriber, zone: { fee, freeThreshold }, subtotal }) — abone ‖ zone eşik (ADR-0005)
// TODO(F2): firstBoxesDiscount({ discountBoxesLeft, pct: 50 }) — ilk 2 kutu %50 (ADR-0007)
// TODO(F2): retentionDiscount({ nextBoxDiscountPct }) — 1 kutu %50 (ADR-0007)
// TODO(F2): cutoffAtFor(deliveryDate: IsoDate, { daysBefore: 1, time: '12:00' }, tz = 'Europe/Istanbul') — date-fns-tz (ADR-0004)
// TODO(F2): quoteCart(lines, ctx) — karışık sepet kind önceliği (SUBSCRIPTION > BOX_ONE_TIME > SINGLE), KDV satır bazlı
// TODO(F2): quoteCycle(cycle, ctx) — boxPrice + extras − discount + shippingFee; cycle#1 DELTA = total − prepaidAmount (ADR-0006)
