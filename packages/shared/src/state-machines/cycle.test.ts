import { describe, expect, it } from 'vitest';
import { CYCLE_TERMINAL_STATES, assertCycleTransition, canCycleTransition, cycleMachine, isCycleEditable } from './cycle';
import { InvalidTransitionError } from './machine';

describe('state-machines/cycle', () => {
  it('kesim: SCHEDULED → LOCKED → CHARGED → PREPARING → OUT_FOR_DELIVERY → DELIVERED', () => {
    expect(canCycleTransition('SCHEDULED', 'LOCKED')).toBe(true);
    expect(canCycleTransition('LOCKED', 'CHARGED')).toBe(true);
    expect(canCycleTransition('CHARGED', 'PREPARING')).toBe(true);
    expect(canCycleTransition('PREPARING', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canCycleTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(cycleMachine.eventsFor('SCHEDULED', 'LOCKED')).toEqual(['LOCKED']);
  });

  it('PAYMENT_LINK: LOCKED → AWAITING_PAYMENT → CHARGED | UNPAID (süre doldu)', () => {
    expect(canCycleTransition('LOCKED', 'AWAITING_PAYMENT')).toBe(true);
    expect(canCycleTransition('AWAITING_PAYMENT', 'CHARGED')).toBe(true);
    expect(canCycleTransition('AWAITING_PAYMENT', 'UNPAID')).toBe(true);
    expect(canCycleTransition('AWAITING_PAYMENT', 'SCHEDULED')).toBe(false);
  });

  it('dunning: LOCKED → UNPAID → CHARGED (retry) | SKIPPED (tükendi)', () => {
    expect(canCycleTransition('LOCKED', 'UNPAID')).toBe(true);
    expect(canCycleTransition('UNPAID', 'CHARGED')).toBe(true);
    expect(cycleMachine.eventsFor('UNPAID', 'CHARGED')).toContain('RETRY');
    expect(canCycleTransition('UNPAID', 'SKIPPED')).toBe(true);
    expect(cycleMachine.eventsFor('UNPAID', 'SKIPPED')).toEqual(['UNPAID']);
  });

  it('atla → geri al: SCHEDULED → SKIPPED → SCHEDULED; kilitli cycle atlanamaz', () => {
    expect(canCycleTransition('SCHEDULED', 'SKIPPED')).toBe(true);
    expect(canCycleTransition('SKIPPED', 'SCHEDULED')).toBe(true);
    expect(cycleMachine.eventsFor('SKIPPED', 'SCHEDULED')).toEqual(['UNSKIP']);
    expect(canCycleTransition('LOCKED', 'SKIPPED')).toBe(false);
    expect(() => assertCycleTransition('CHARGED', 'SKIPPED')).toThrow(InvalidTransitionError);
  });

  it('yalnız SCHEDULED düzenlenebilir; terminal DELIVERED ve CANCELLED', () => {
    expect(isCycleEditable('SCHEDULED')).toBe(true);
    expect(isCycleEditable('LOCKED')).toBe(false);
    expect([...CYCLE_TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'DELIVERED']);
  });
});
