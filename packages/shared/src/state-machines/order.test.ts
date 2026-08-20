import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './machine';
import { ORDER_TERMINAL_STATES, assertOrderTransition, canOrderTransition, isOrderCustomerCancellable, orderMachine } from './order';

describe('state-machines/order', () => {
  it('mutlu yol: PENDING_PAYMENT → PAID → PREPARING → OUT_FOR_DELIVERY → DELIVERED', () => {
    expect(canOrderTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canOrderTransition('PAID', 'PREPARING')).toBe(true);
    expect(canOrderTransition('PREPARING', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canOrderTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(orderMachine.eventsFor('PENDING_PAYMENT', 'PAID')).toEqual(['PAYMENT_SUCCEEDED']);
  });

  it('ödeme başarısız → yeniden dene ya da iptal', () => {
    expect(canOrderTransition('PENDING_PAYMENT', 'PAYMENT_FAILED')).toBe(true);
    expect(canOrderTransition('PAYMENT_FAILED', 'PENDING_PAYMENT')).toBe(true);
    expect(canOrderTransition('PAYMENT_FAILED', 'CANCELLED')).toBe(true);
    expect(canOrderTransition('PAYMENT_FAILED', 'PAID')).toBe(false);
  });

  it('teslim edilemedi → yeniden dağıtım / iptal / iade; teslim edildikten sonra yalnız iade', () => {
    expect(canOrderTransition('DELIVERY_FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canOrderTransition('DELIVERED', 'REFUNDED')).toBe(true);
    expect(canOrderTransition('DELIVERED', 'CANCELLED')).toBe(false);
    expect(canOrderTransition('DELIVERED', 'PREPARING')).toBe(false);
  });

  it('assertOrderTransition geçersiz geçişte InvalidTransitionError fırlatır', () => {
    expect(() => assertOrderTransition('CANCELLED', 'PAID')).toThrow(InvalidTransitionError);
    expect(() => assertOrderTransition('PAID', 'PREPARING')).not.toThrow();
    try {
      assertOrderTransition('REFUNDED', 'PAID');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as InvalidTransitionError).code).toBe('INVALID_TRANSITION');
      expect((err as InvalidTransitionError).machine).toBe('Order');
    }
  });

  it('terminal durumlar CANCELLED ve REFUNDED', () => {
    expect([...ORDER_TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'REFUNDED']);
  });

  it('müşteri iptali yalnız ödeme öncesi/ödendi aşamasında', () => {
    expect(isOrderCustomerCancellable('PAID')).toBe(true);
    expect(isOrderCustomerCancellable('PREPARING')).toBe(false);
  });
});
