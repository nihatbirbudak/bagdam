import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './machine';
import { PAYMENT_TERMINAL_STATES, assertPaymentTransition, canPaymentTransition, paymentMachine } from './payment';

describe('state-machines/payment', () => {
  it('3DS akışı: PENDING → REQUIRES_3DS → SUCCEEDED | FAILED | EXPIRED', () => {
    expect(canPaymentTransition('PENDING', 'REQUIRES_3DS')).toBe(true);
    expect(canPaymentTransition('REQUIRES_3DS', 'SUCCEEDED')).toBe(true);
    expect(canPaymentTransition('REQUIRES_3DS', 'FAILED')).toBe(true);
    expect(canPaymentTransition('REQUIRES_3DS', 'EXPIRED')).toBe(true);
    expect(canPaymentTransition('REQUIRES_3DS', 'PENDING')).toBe(false);
  });

  it('MIT (NON3D): PENDING → SUCCEEDED doğrudan', () => {
    expect(canPaymentTransition('PENDING', 'SUCCEEDED')).toBe(true);
    expect(paymentMachine.eventsFor('PENDING', 'SUCCEEDED')).toEqual(['PROVIDER_SUCCESS']);
  });

  it('iade: SUCCEEDED → REFUNDED | PARTIAL_REFUNDED → REFUNDED; başarısız ödeme iade edilemez', () => {
    expect(canPaymentTransition('SUCCEEDED', 'REFUNDED')).toBe(true);
    expect(canPaymentTransition('SUCCEEDED', 'PARTIAL_REFUNDED')).toBe(true);
    expect(canPaymentTransition('PARTIAL_REFUNDED', 'REFUNDED')).toBe(true);
    expect(() => assertPaymentTransition('FAILED', 'REFUNDED')).toThrow(InvalidTransitionError);
    expect([...PAYMENT_TERMINAL_STATES].sort()).toEqual(['EXPIRED', 'FAILED', 'REFUNDED']);
  });
});
