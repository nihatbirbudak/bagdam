// ── Ekstralar (kutu üstü ürünler): miktar seçenekleri + fiyat + toplam ────────
// Kaynak: cart.js `subExtraOptions` (kg → 250 g/500 g/1 kg/2 kg; "500 g" → 500 g/1 kg/1,5 kg; sayılı birim → 1..4 × birim),
// `subExtraPrice` (Math.round(price × factor)), `subExtrasTotal`; Setting `commerce.extraAmountOptions`
// `{kg:[0.25,0.5,1,2],"500 g":[1,2,3],default:[1,2,3,4]}`; Product.extraOptions `[{factor,label}]` null → Setting.
import type { ExtraOption } from '../types/catalog';
import type { Money } from '../types/pricing';
import type { CommerceSettings } from '../types/settings';
import { COMMERCE_SETTINGS_DEFAULTS } from '../types/settings';
import { roundExtraPrice, sumMoney } from './money';

/** Birim metninden gram değeri: "kg" → 1000, "500 g" → 500, "250 gr" → 250, "1 kg" → 1000; ağırlık birimi değilse null. */
export function unitGrams(unit: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)?\s*(kg|g|gr)\s*$/i.exec(unit);
  if (!m) return null;
  const qty = m[1] ? Number(m[1].replace(',', '.')) : 1;
  const mult = m[2]!.toLowerCase() === 'kg' ? 1000 : 1;
  return qty * mult;
}

/** Ağırlık etiketi: < 1000 g → "250 g"; ≥ 1000 → "1 kg" / "1,5 kg" (Türkçe virgül, gereksiz sıfır yok). */
export function formatWeightLabel(grams: number): string {
  if (grams < 1000) return `${formatNumberTr(grams)} g`;
  return `${formatNumberTr(grams / 1000)} kg`;
}

function formatNumberTr(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded).replace('.', ',');
}

/**
 * Çarpan listesinden seçenek etiketleri üretir — cart.js `subExtraOptions` ile aynı metinler:
 *   unit "kg", [0.25,0.5,1,2] → "250 g","500 g","1 kg","2 kg" · unit "500 g", [1,2,3] → "500 g","1 kg","1,5 kg" ·
 *   unit "demet", [1,2,3,4] → "1 demet" … "4 demet".
 */
export function buildExtraOptions(unit: string, factors: readonly number[]): ExtraOption[] {
  const grams = unitGrams(unit);
  return factors.map((factor) => {
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError(`buildExtraOptions: çarpan pozitif olmalı (${String(factor)})`);
    const label = grams !== null ? formatWeightLabel(grams * factor) : `${formatNumberTr(factor)} ${unit.trim()}`;
    return { factor, label };
  });
}

/**
 * Ürünün ekstra miktar seçeneklerini çözer:
 * 1. `productOptions` (Product.extraOptions) doluysa o;
 * 2. yoksa Setting `extraAmountOptions[unit]` (anahtar birebir, ör. "kg", "500 g"), yoksa `default` — etiketler üretilir.
 */
export function resolveExtraOptions(
  unit: string,
  settings: Pick<CommerceSettings, 'extraAmountOptions'> = COMMERCE_SETTINGS_DEFAULTS,
  productOptions?: readonly ExtraOption[] | null,
): ExtraOption[] {
  if (productOptions && productOptions.length > 0) return productOptions.map((o) => ({ factor: o.factor, label: o.label }));
  const table = settings.extraAmountOptions;
  const factors = table[unit] ?? table[unit.trim()] ?? table['default'] ?? [];
  return buildExtraOptions(unit, factors);
}

/** Bir ekstra satırının fiyatı — cart.js `subExtraPrice` (tam TL). */
export function extraPrice(unitPrice: Money, factor: number): Money {
  return roundExtraPrice(unitPrice, factor);
}

/** Ekstraların toplamı — cart.js `subExtrasTotal` (her biri tam TL'ye yuvarlanmış, sonra toplanır). */
export function extrasTotal(extras: readonly { unitPrice: Money; factor: number }[]): Money {
  return sumMoney(extras.map((e) => roundExtraPrice(e.unitPrice, e.factor)));
}
