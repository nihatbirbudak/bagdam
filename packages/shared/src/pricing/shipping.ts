// ── Kargo: abone ‖ zone eşik (ADR-0005) — değerler YALNIZ DeliveryZone.fee / freeThreshold'dan ──
// Prototip: cart.js `subDeliveryFee` (tek seferlik kutu → DELIVERY_FEE 49, abonelik → 0) ve sepet.html
// `freeShipping = isSubscriber || subtotal > 1000`. Eşik karşılaştırması (≥ / >) ve "aktif aboneye tekil üründe kargo 0"
// kuralı kodda sabit değil: Setting `commerce.freeShippingRule` / `commerce.subscriberFreeShipping` (ADR-0018, `rules`).
import { OrderKind } from '../enums';
import type { Money, PricingRules, ShippingResult, ZoneShippingRule } from '../types/pricing';
import { roundMoney } from './money';
import { isSubscriptionOrder } from './order-kind';
import { resolvePricingRules } from './rules';

export interface ShippingInput {
  /** İndirim sonrası ara toplam (Σ lineTotal − Σ discount), KDV dahil. */
  subtotalAfterDiscount: Money;
  zone: ZoneShippingRule;
  /** Müşterinin canlı aboneliği var → kargo 0 (tekil ürün siparişinde `rules.subscriberFreeShipping` true ise). */
  hasActiveSubscription: boolean;
  /** Sipariş türü; SUBSCRIPTION → kargo 0. */
  orderKind: OrderKind;
  /** Fiyatlama kuralları (ADR-0018); eksik alan varsayılan (gte / subscriberFreeShipping true). */
  rules?: Partial<PricingRules>;
}

/**
 * Kargo ücreti:
 * 1. abonelik siparişi (SUBSCRIPTION) → 0 (`SUBSCRIBER`) — her zaman;
 * 2. aktif abonesi olan müşteri → 0 (`SUBSCRIBER`); tekil ürün (SINGLE) siparişinde YALNIZ `rules.subscriberFreeShipping`
 *    true ise (varsayılan); false ise SINGLE'da bölge kuralına düşer;
 * 3. değilse eşik (null değilse): `gte` → `subtotalAfterDiscount ≥ zone.freeThreshold`, `gt` → `>` → 0 (`THRESHOLD`);
 * 4. aksi hâlde `zone.fee` (`ZONE_FEE`).
 * Varsayılan/katalog sabiti YOK: fee/threshold çağıranın verdiği zone'dan gelir (test verisinde 49 / 1000).
 */
export function computeShipping(input: ShippingInput): ShippingResult {
  const { zone } = input;
  if (!Number.isFinite(zone.fee) || zone.fee < 0) throw new RangeError('computeShipping: zone.fee 0 ya da pozitif olmalı');
  if (zone.freeThreshold !== null && (!Number.isFinite(zone.freeThreshold) || zone.freeThreshold < 0)) {
    throw new RangeError('computeShipping: zone.freeThreshold null ya da 0/pozitif olmalı');
  }
  const rules = resolvePricingRules(input.rules);
  if (isSubscriptionOrder(input.orderKind)) return { fee: 0, reason: 'SUBSCRIBER' };
  if (input.hasActiveSubscription && (input.orderKind !== OrderKind.SINGLE || rules.subscriberFreeShipping)) {
    return { fee: 0, reason: 'SUBSCRIBER' };
  }
  if (zone.freeThreshold !== null && meetsFreeThreshold(input.subtotalAfterDiscount, zone.freeThreshold, rules.freeShippingRule)) {
    return { fee: 0, reason: 'THRESHOLD' };
  }
  return { fee: roundMoney(zone.fee), reason: 'ZONE_FEE' };
}

/** Eşik karşılaştırması — Setting `commerce.freeShippingRule`: `gte` (≥, varsayılan) ya da `gt` (>). */
export function meetsFreeThreshold(subtotal: Money, threshold: Money, rule: PricingRules['freeShippingRule']): boolean {
  return rule === 'gt' ? subtotal > threshold : subtotal >= threshold;
}
