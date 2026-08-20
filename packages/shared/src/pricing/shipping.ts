// ── Kargo: abone ‖ zone eşik (ADR-0005) — değerler YALNIZ DeliveryZone.fee / freeThreshold'dan ──
// Prototip: cart.js `subDeliveryFee` (tek seferlik kutu → DELIVERY_FEE 49, abonelik → 0) ve sepet.html
// `freeShipping = isSubscriber || subtotal > 1000` (burada eşik karşılaştırması ≥ — görev tanımı; bkz. test notu).
import type { OrderKind } from '../enums';
import type { Money, ShippingResult, ZoneShippingRule } from '../types/pricing';
import { roundMoney } from './money';
import { isSubscriptionOrder } from './order-kind';

export interface ShippingInput {
  /** İndirim sonrası ara toplam (Σ lineTotal − Σ discount), KDV dahil. */
  subtotalAfterDiscount: Money;
  zone: ZoneShippingRule;
  /** Müşterinin canlı aboneliği var → kargo 0 (tekil ürün siparişinde de). */
  hasActiveSubscription: boolean;
  /** Sipariş türü; SUBSCRIPTION → kargo 0. */
  orderKind: OrderKind;
}

/**
 * Kargo ücreti:
 * 1. abonelik (aktif abonelik VEYA abonelik siparişi) → 0 (`SUBSCRIBER`);
 * 2. değilse `subtotalAfterDiscount ≥ zone.freeThreshold` (eşik null değilse) → 0 (`THRESHOLD`);
 * 3. aksi hâlde `zone.fee` (`ZONE_FEE`).
 * Varsayılan/katalog sabiti YOK: fee/threshold çağıranın verdiği zone'dan gelir (test verisinde 49 / 1000).
 */
export function computeShipping(input: ShippingInput): ShippingResult {
  const { zone } = input;
  if (!Number.isFinite(zone.fee) || zone.fee < 0) throw new RangeError('computeShipping: zone.fee 0 ya da pozitif olmalı');
  if (zone.freeThreshold !== null && (!Number.isFinite(zone.freeThreshold) || zone.freeThreshold < 0)) {
    throw new RangeError('computeShipping: zone.freeThreshold null ya da 0/pozitif olmalı');
  }
  if (input.hasActiveSubscription || isSubscriptionOrder(input.orderKind)) return { fee: 0, reason: 'SUBSCRIBER' };
  if (zone.freeThreshold !== null && input.subtotalAfterDiscount >= zone.freeThreshold) return { fee: 0, reason: 'THRESHOLD' };
  return { fee: roundMoney(zone.fee), reason: 'ZONE_FEE' };
}
