// ── Order.kind çözümü — karışık sepet önceliği SUBSCRIPTION > BOX_ONE_TIME > SINGLE (ADR-0008 [B15]) ──
import { ORDER_KIND_PRIORITY, OrderKind, OrderLineKind } from '../enums';
import type { PricingContext, PricingLineInput } from '../types/pricing';

/**
 * Tek satırın işaret ettiği sipariş türü:
 * - BOX / EXTRA → `isSubscriptionCheckout` ? SUBSCRIPTION : BOX_ONE_TIME (EXTRA'lar kutuya aittir; DELTA Order'da
 *   kutu satırı olmasa da tür abonelikten miras alınır — state-machines §8 adım 5).
 * - PRODUCT → SINGLE (aktif abonesi olan müşterinin tekil ürün siparişi de ayrı bir SINGLE siparişidir; sepet.html
 *   "ayrı bir sipariş olarak işlenir").
 */
export function lineOrderKind(line: Pick<PricingLineInput, 'kind'>, ctx: Pick<PricingContext, 'isSubscriptionCheckout'>): OrderKind {
  if (line.kind === OrderLineKind.PRODUCT) return OrderKind.SINGLE;
  return ctx.isSubscriptionCheckout ? OrderKind.SUBSCRIPTION : OrderKind.BOX_ONE_TIME;
}

/**
 * Karışık sepette Order.kind = en yüksek öncelikli tür (`ORDER_KIND_PRIORITY`):
 * abonelik kutusu + tekil ürünler → SUBSCRIPTION; tek seferlik kutu + ürünler → BOX_ONE_TIME; yalnız ürünler → SINGLE.
 * Boş sepet → SINGLE.
 */
export function resolveOrderKind(
  lines: readonly Pick<PricingLineInput, 'kind'>[],
  ctx: Pick<PricingContext, 'isSubscriptionCheckout'>,
): OrderKind {
  let best: OrderKind = OrderKind.SINGLE;
  for (const line of lines) {
    const kind = lineOrderKind(line, ctx);
    if (ORDER_KIND_PRIORITY[kind] > ORDER_KIND_PRIORITY[best]) best = kind;
  }
  return best;
}

/** Abonelik siparişi mi (kargo 0, ilk-2-kutu/retention uygulanabilir)? */
export function isSubscriptionOrder(kind: OrderKind): boolean {
  return kind === OrderKind.SUBSCRIPTION;
}
