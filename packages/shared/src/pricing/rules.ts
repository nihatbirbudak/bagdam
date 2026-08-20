// ── Fiyatlama kuralları (ADR-0018) — Setting `commerce.*` ile admin'den değişen üç kural ──────────
// Kodda SABİT YOK: freeShippingRule (gte|gt) · discountRounding (kurus|tl) · subscriberFreeShipping (boolean).
// Çağıran (api PricingService / admin önizleme) DB'den çözdüğü CommerceSettings'i `PricingContext.rules` ile verir;
// vermezse ya da bir alan eksik/bozuksa varsayılan (COMMERCE_SETTINGS_DEFAULTS) kullanılır — mevcut çağrılar kırılmaz.
import type { PricingRules } from '../types/pricing';
import { COMMERCE_SETTINGS_DEFAULTS, DISCOUNT_ROUNDING_VALUES, FREE_SHIPPING_RULE_VALUES } from '../types/settings';

/** Varsayılan kurallar — `COMMERCE_SETTINGS_DEFAULTS` ile aynı kaynak (gte / kurus / true). */
export const DEFAULT_PRICING_RULES: Readonly<PricingRules> = {
  freeShippingRule: COMMERCE_SETTINGS_DEFAULTS.freeShippingRule,
  discountRounding: COMMERCE_SETTINGS_DEFAULTS.discountRounding,
  subscriberFreeShipping: COMMERCE_SETTINGS_DEFAULTS.subscriberFreeShipping,
};

function isOneOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

/**
 * Kısmi/ham kuralları tam `PricingRules`'a tamamlar. Eksik alan → varsayılan; geçersiz değer (Setting JSON'u bozuk,
 * ör. `"foo"` ya da boolean olmayan bayrak) → sessizce varsayılan (catalog mapper `mergeCommerceSettings` ile aynı politika).
 */
export function resolvePricingRules(rules?: Partial<PricingRules> | null): PricingRules {
  const freeShippingRule: unknown = rules?.freeShippingRule;
  const discountRounding: unknown = rules?.discountRounding;
  const subscriberFreeShipping: unknown = rules?.subscriberFreeShipping;
  return {
    freeShippingRule: isOneOf(FREE_SHIPPING_RULE_VALUES, freeShippingRule) ? freeShippingRule : DEFAULT_PRICING_RULES.freeShippingRule,
    discountRounding: isOneOf(DISCOUNT_ROUNDING_VALUES, discountRounding) ? discountRounding : DEFAULT_PRICING_RULES.discountRounding,
    subscriberFreeShipping: typeof subscriberFreeShipping === 'boolean' ? subscriberFreeShipping : DEFAULT_PRICING_RULES.subscriberFreeShipping,
  };
}
