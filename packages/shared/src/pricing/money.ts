// ── Para yardımcıları: yuvarlama, KDV ayrıştırma, toplam, ekstra yuvarlama, yüzde indirim, biçim ──
// Kaynak: BACKEND-PLANI §1.1 Para (Decimal(12,2) TL KDV dahil, vatRate varsayılan 1; sepet.html `line*(0.01/1.01)`),
// cart.js `subExtraPrice` (Math.round), `money()` (tr-TR). Saf fonksiyonlar; DB/framework yok.
// İndirim yuvarlaması (`roundDiscount`) Setting `commerce.discountRounding` ile kuruş/tam TL arasında seçilir (ADR-0018).
import type { Money } from '../types/pricing';
import type { DiscountRounding } from '../types/settings';
import { COMMERCE_SETTINGS_DEFAULTS } from '../types/settings';

/** Varsayılan KDV oranı (yüzde): gıda %1 — `Product.vatRate`/`OrderLine.vatRate` varsayılanı (Setting `commerce.vatRate`). */
export const DEFAULT_VAT_RATE = 1;

/**
 * Kuruşa yuvarlar (2 ondalık, **yarım yukarı** — banker's değil: 1.005 → 1.01, 0.125 → 0.13).
 * Negatifte simetrik (−1.005 → −1.01). Floating-point artıklarını `Number.EPSILON` ile bastırır; −0 döndürmez.
 */
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
 * KDV dahil tutardan KDV tutarı (kuruşa yuvarlı). sepet.html `line * (0.01 / 1.01)` kuralının genel hali:
 * vat = gross × rate / (100 + rate). Yuvarlanmamış hâli için `vatFromGrossRaw`.
 */
export function vatFromGross(gross: Money, vatRatePct: number = DEFAULT_VAT_RATE): Money {
  return roundMoney(vatFromGrossRaw(gross, vatRatePct));
}

/** KDV dahil tutardan KDV tutarı — YUVARLANMAMIŞ (toplamda kuruş kaymasını önlemek için satırlar toplanıp sonra yuvarlanır). */
export function vatFromGrossRaw(gross: Money, vatRatePct: number = DEFAULT_VAT_RATE): number {
  if (!Number.isFinite(gross)) throw new TypeError('vatFromGross: tutar sonlu sayı olmalı');
  if (!Number.isFinite(vatRatePct) || vatRatePct < 0) throw new RangeError('vatFromGross: KDV oranı 0 ya da pozitif olmalı');
  return (gross * vatRatePct) / (100 + vatRatePct);
}

/** KDV dahil tutardan KDV hariç (matrah) tutar. */
export function netFromGross(gross: Money, vatRatePct: number = DEFAULT_VAT_RATE): Money {
  return roundMoney(gross - vatFromGross(gross, vatRatePct));
}

/** Tutarları toplar ve kuruşa yuvarlar (0.1 + 0.2 = 0.3). Boş liste → 0. */
export function sumMoney(values: readonly number[]): Money {
  let total = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) throw new TypeError(`sumMoney: sonlu bir sayı bekleniyordu, gelen: ${String(v)}`);
    total += v;
  }
  return roundMoney(total);
}

/**
 * Ekstra (kutu üstü ürün) fiyatı: cart.js `subExtraPrice` ile BİREBİR —
 * `Math.round(p.price * extra.factor)` → **tam TL**'ye yuvarlanır (kuruş yok).
 * `factor`: ürünün kendi birim fiyatını çarpan (250 g için 0.25, 3 demet için 3).
 */
export function roundExtraPrice(unitPrice: Money, factor: number): Money {
  if (!Number.isFinite(unitPrice) || !Number.isFinite(factor)) {
    throw new TypeError('roundExtraPrice: fiyat ve çarpan sonlu sayı olmalı');
  }
  return Math.round(unitPrice * factor);
}

/**
 * İndirim tutarını kurala göre yuvarlar (Setting `commerce.discountRounding`, ADR-0018):
 * `kurus` → kuruşa (324,50; varsayılan) · `tl` → tam TL'ye (Math.round, yarım yukarı: 324,50 → 325 — prototip cart.js).
 */
export function roundDiscount(value: number, rounding: DiscountRounding = COMMERCE_SETTINGS_DEFAULTS.discountRounding): Money {
  if (!Number.isFinite(value)) throw new TypeError(`roundDiscount: sonlu bir sayı bekleniyordu, gelen: ${String(value)}`);
  if (rounding === 'tl') {
    const rounded = Math.round(value); // cart.js ile birebir (tam TL)
    return rounded === 0 ? 0 : rounded; // -0 → 0
  }
  return roundMoney(value);
}

/** Yüzde indirim tutarı — yuvarlama `rounding` kuralına göre (varsayılan kuruş). pct 0–100. */
export function discountAmount(amount: Money, pct: number, rounding?: DiscountRounding): Money {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new RangeError('discountAmount: pct 0–100 aralığında olmalı');
  return roundDiscount((amount * pct) / 100, rounding);
}

/** Yüzde indirim uygulanmış tutar (indirim tutarı `rounding` kuralıyla yuvarlanır). */
export function applyDiscountPct(amount: Money, pct: number, rounding?: DiscountRounding): Money {
  return roundMoney(amount - discountAmount(amount, pct, rounding));
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
