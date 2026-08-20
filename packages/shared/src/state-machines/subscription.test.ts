import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './machine';
import {
  SUBSCRIPTION_ENGINE_ACTIVE_STATES,
  SUBSCRIPTION_TERMINAL_STATES,
  assertSubscriptionTransition,
  canSubscriptionTransition,
  subscriptionMachine,
} from './subscription';

describe('state-machines/subscription', () => {
  it('PENDING → ACTIVE (ilk ödeme) | CANCELLED (ödeme başarısız)', () => {
    expect(canSubscriptionTransition('PENDING', 'ACTIVE')).toBe(true);
    expect(canSubscriptionTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canSubscriptionTransition('PENDING', 'PAST_DUE')).toBe(false);
    expect(subscriptionMachine.eventsFor('PENDING', 'ACTIVE')).toEqual(['ACTIVATED']);
  });

  it('ACTIVE → PAST_DUE (UNPAID×2) → ACTIVE (CHARGED)', () => {
    expect(canSubscriptionTransition('ACTIVE', 'PAST_DUE')).toBe(true);
    expect(subscriptionMachine.eventsFor('ACTIVE', 'PAST_DUE')).toEqual(['UNPAID']);
    expect(canSubscriptionTransition('PAST_DUE', 'ACTIVE')).toBe(true);
    expect(subscriptionMachine.eventsFor('PAST_DUE', 'ACTIVE')).toEqual(['CHARGED']);
    expect(canSubscriptionTransition('PAST_DUE', 'COMPLETED')).toBe(false);
  });

  it('iptal akışı: ACTIVE → CANCEL_REQUESTED → ACTIVE (retention/abandon) | CANCELLED', () => {
    expect(canSubscriptionTransition('ACTIVE', 'CANCEL_REQUESTED')).toBe(true);
    expect(canSubscriptionTransition('CANCEL_REQUESTED', 'ACTIVE')).toBe(true);
    expect(subscriptionMachine.eventsFor('CANCEL_REQUESTED', 'ACTIVE')).toContain('RETENTION_USED');
    expect(canSubscriptionTransition('CANCEL_REQUESTED', 'CANCELLED')).toBe(true);
    expect(canSubscriptionTransition('CANCELLED', 'ACTIVE')).toBe(false);
  });

  it('tek seferlik kutu: ACTIVE → COMPLETED; terminal', () => {
    expect(canSubscriptionTransition('ACTIVE', 'COMPLETED')).toBe(true);
    expect(subscriptionMachine.isTerminal('COMPLETED')).toBe(true);
    expect([...SUBSCRIPTION_TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'COMPLETED']);
  });

  it('motor yalnız ACTIVE/PAST_DUE/CANCEL_REQUESTED abonelikleri işler', () => {
    expect(SUBSCRIPTION_ENGINE_ACTIVE_STATES).toEqual(['ACTIVE', 'PAST_DUE', 'CANCEL_REQUESTED']);
    expect(() => assertSubscriptionTransition('COMPLETED', 'ACTIVE')).toThrow(InvalidTransitionError);
  });
});
