import { describe, expect, it } from 'vitest';
import { COMMERCE_SETTINGS_DEFAULTS, DISCOUNT_ROUNDING_VALUES, FREE_SHIPPING_RULE_VALUES } from '../types/settings';
import { DEFAULT_PRICING_RULES, resolvePricingRules } from './rules';

describe('pricing/rules — Setting commerce.* fiyatlama kuralları (ADR-0018)', () => {
  it('varsayılanlar COMMERCE_SETTINGS_DEFAULTS ile aynı: gte / kurus / true', () => {
    expect(DEFAULT_PRICING_RULES).toEqual({ freeShippingRule: 'gte', discountRounding: 'kurus', subscriberFreeShipping: true });
    expect(DEFAULT_PRICING_RULES.freeShippingRule).toBe(COMMERCE_SETTINGS_DEFAULTS.freeShippingRule);
    expect(DEFAULT_PRICING_RULES.discountRounding).toBe(COMMERCE_SETTINGS_DEFAULTS.discountRounding);
    expect(DEFAULT_PRICING_RULES.subscriberFreeShipping).toBe(COMMERCE_SETTINGS_DEFAULTS.subscriberFreeShipping);
    expect(FREE_SHIPPING_RULE_VALUES).toEqual(['gte', 'gt']);
    expect(DISCOUNT_ROUNDING_VALUES).toEqual(['kurus', 'tl']);
  });

  it('resolvePricingRules: verilmezse/boşsa varsayılan; kısmi verilince yalnız o alan değişir', () => {
    expect(resolvePricingRules()).toEqual(DEFAULT_PRICING_RULES);
    expect(resolvePricingRules(null)).toEqual(DEFAULT_PRICING_RULES);
    expect(resolvePricingRules({})).toEqual(DEFAULT_PRICING_RULES);
    expect(resolvePricingRules({ freeShippingRule: 'gt' })).toEqual({ freeShippingRule: 'gt', discountRounding: 'kurus', subscriberFreeShipping: true });
    expect(resolvePricingRules({ discountRounding: 'tl', subscriberFreeShipping: false })).toEqual({ freeShippingRule: 'gte', discountRounding: 'tl', subscriberFreeShipping: false });
    // CommerceSettings'in tamamı da verilebilir (üst küme)
    expect(resolvePricingRules({ ...COMMERCE_SETTINGS_DEFAULTS, discountRounding: 'tl' }).discountRounding).toBe('tl');
  });

  it('bozuk Setting değeri → sessizce varsayılan (mapper mergeCommerceSettings politikası)', () => {
    expect(resolvePricingRules({ freeShippingRule: 'foo' as never, discountRounding: 1 as never, subscriberFreeShipping: 'yes' as never })).toEqual(DEFAULT_PRICING_RULES);
    expect(resolvePricingRules({ freeShippingRule: undefined, discountRounding: null as never })).toEqual(DEFAULT_PRICING_RULES);
  });
});
