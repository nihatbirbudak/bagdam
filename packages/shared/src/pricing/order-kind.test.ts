import { describe, expect, it } from 'vitest';
import { OrderKind, OrderLineKind } from '../enums';
import { isSubscriptionOrder, lineOrderKind, resolveOrderKind } from './order-kind';

const PRODUCT = { kind: OrderLineKind.PRODUCT };
const BOX = { kind: OrderLineKind.BOX };
const EXTRA = { kind: OrderLineKind.EXTRA };

describe('pricing/order-kind (ADR-0008: SUBSCRIPTION > BOX_ONE_TIME > SINGLE)', () => {
  it('yalnız ürünler → SINGLE (aktif abone olsa da ayrı sipariş)', () => {
    expect(resolveOrderKind([PRODUCT, PRODUCT], { isSubscriptionCheckout: false })).toBe(OrderKind.SINGLE);
    expect(resolveOrderKind([PRODUCT], { isSubscriptionCheckout: true })).toBe(OrderKind.SINGLE);
  });

  it('abonelik kutusu (+ ekstra + ürün) → SUBSCRIPTION', () => {
    expect(resolveOrderKind([BOX], { isSubscriptionCheckout: true })).toBe(OrderKind.SUBSCRIPTION);
    expect(resolveOrderKind([PRODUCT, BOX, EXTRA], { isSubscriptionCheckout: true })).toBe(OrderKind.SUBSCRIPTION);
  });

  it('tek seferlik kutu (+ ürün) → BOX_ONE_TIME', () => {
    expect(resolveOrderKind([BOX], { isSubscriptionCheckout: false })).toBe(OrderKind.BOX_ONE_TIME);
    expect(resolveOrderKind([PRODUCT, BOX, EXTRA], { isSubscriptionCheckout: false })).toBe(OrderKind.BOX_ONE_TIME);
  });

  it('DELTA (yalnız ekstra) türü kutudan miras alır', () => {
    expect(resolveOrderKind([EXTRA], { isSubscriptionCheckout: true })).toBe(OrderKind.SUBSCRIPTION);
    expect(resolveOrderKind([EXTRA], { isSubscriptionCheckout: false })).toBe(OrderKind.BOX_ONE_TIME);
  });

  it('boş sepet → SINGLE; satır türü tek tek', () => {
    expect(resolveOrderKind([], { isSubscriptionCheckout: true })).toBe(OrderKind.SINGLE);
    expect(lineOrderKind(PRODUCT, { isSubscriptionCheckout: true })).toBe(OrderKind.SINGLE);
    expect(lineOrderKind(BOX, { isSubscriptionCheckout: true })).toBe(OrderKind.SUBSCRIPTION);
    expect(isSubscriptionOrder(OrderKind.SUBSCRIPTION)).toBe(true);
    expect(isSubscriptionOrder(OrderKind.BOX_ONE_TIME)).toBe(false);
  });
});
