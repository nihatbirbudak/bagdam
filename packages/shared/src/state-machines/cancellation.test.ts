import { describe, expect, it } from 'vitest';
import {
  CANCELLATION_MAX_EFFECTIVE_DAYS,
  CANCELLATION_MAX_REFUND_DAYS,
  CANCELLATION_TERMINAL_STATES,
  assertCancellationTransition,
  canCancellationTransition,
  cancellationMachine,
} from './cancellation';
import { InvalidTransitionError } from './machine';

describe('state-machines/cancellation', () => {
  it('PENDING → RETENTION_ACCEPTED | CANCELLED | ABANDONED', () => {
    expect(canCancellationTransition('PENDING', 'RETENTION_ACCEPTED')).toBe(true);
    expect(canCancellationTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canCancellationTransition('PENDING', 'ABANDONED')).toBe(true);
    expect(cancellationMachine.eventsFor('PENDING', 'RETENTION_ACCEPTED')).toEqual(['RETENTION_USED']);
  });

  it('sonuçlar terminal — yeni iptal akışı yeni satır', () => {
    expect([...CANCELLATION_TERMINAL_STATES].sort()).toEqual(['ABANDONED', 'CANCELLED', 'RETENTION_ACCEPTED']);
    expect(() => assertCancellationTransition('ABANDONED', 'CANCELLED')).toThrow(InvalidTransitionError);
    expect(() => assertCancellationTransition('RETENTION_ACCEPTED', 'PENDING')).toThrow(InvalidTransitionError);
  });

  it('yasal sınırlar: fesih ≤ 7 gün, iade ≤ 15 gün', () => {
    expect(CANCELLATION_MAX_EFFECTIVE_DAYS).toBe(7);
    expect(CANCELLATION_MAX_REFUND_DAYS).toBe(15);
  });
});
