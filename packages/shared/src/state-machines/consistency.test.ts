import { describe, expect, it } from 'vitest';
import {
  CANCEL_OUTCOME_VALUES,
  CYCLE_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  SUBSCRIPTION_STATUS_VALUES,
  SUB_EVENT_TYPE_VALUES,
} from '../enums';
import { cancellationMachine } from './cancellation';
import { cycleMachine } from './cycle';
import { ALL_STATE_MACHINES } from './index';
import { findMachineInconsistencies, type StateMachine } from './machine';
import { orderMachine } from './order';
import { paymentMachine } from './payment';
import { subscriptionMachine } from './subscription';

/** Generic parametreleri silinmiş ortak görünüm (union tipinde çağrı için). */
const MACHINES: readonly StateMachine<string, string>[] = ALL_STATE_MACHINES;

/**
 * Kod ↔ doküman tutarlılığı (docs/state-machines.md §13): her makinenin
 *  - durum listesi Prisma enum değerleriyle birebir,
 *  - her geçişin en az bir tetikleyici olayı,
 *  - her olay anahtarının tabloda bir geçişi olmalı.
 */
describe('state-machines/tutarlılık', () => {
  it('olay tabloları ve geçiş tabloları birbirini tam karşılar', () => {
    for (const machine of MACHINES) {
      expect(findMachineInconsistencies(machine), machine.name).toEqual([]);
    }
  });

  it('durum listeleri Prisma enum değerleriyle birebir (sıra dahil)', () => {
    expect(orderMachine.states).toEqual(ORDER_STATUS_VALUES);
    expect(subscriptionMachine.states).toEqual(SUBSCRIPTION_STATUS_VALUES);
    expect(cycleMachine.states).toEqual(CYCLE_STATUS_VALUES);
    expect(paymentMachine.states).toEqual(PAYMENT_STATUS_VALUES);
    expect(cancellationMachine.states).toEqual(CANCEL_OUTCOME_VALUES);
  });

  it('başlangıç durumları Prisma @default ile aynı', () => {
    expect(orderMachine.initial).toBe('PENDING_PAYMENT');
    expect(subscriptionMachine.initial).toBe('PENDING');
    expect(cycleMachine.initial).toBe('SCHEDULED');
    expect(paymentMachine.initial).toBe('PENDING');
    expect(cancellationMachine.initial).toBe('PENDING');
  });

  it('Subscription ve Cycle olay adları SubEventType ile uyumlu (OPS_*/ABANDON dışında)', () => {
    const known = new Set<string>(SUB_EVENT_TYPE_VALUES);
    const allowedExtras = new Set(['OPS_PREPARING', 'OPS_OUT_FOR_DELIVERY', 'OPS_DELIVERED', 'ABANDON']);
    for (const machine of [subscriptionMachine, cycleMachine, cancellationMachine]) {
      for (const events of Object.values(machine.events)) {
        for (const ev of events ?? []) {
          expect(known.has(ev) || allowedExtras.has(ev), `${machine.name}: ${ev}`).toBe(true);
        }
      }
    }
  });

  it('her makinede başlangıçtan erişilemeyen durum yok', () => {
    for (const machine of MACHINES) {
      const seen = new Set<string>([machine.initial]);
      const queue: string[] = [machine.initial];
      while (queue.length) {
        const s = queue.shift() as string;
        for (const n of (machine.transitions as Record<string, readonly string[]>)[s] ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      const unreachable = machine.states.filter((s) => !seen.has(s));
      expect(unreachable, machine.name).toEqual([]);
    }
  });
});
