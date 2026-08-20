// ── Durum makineleri — toplu dışa aktarım ────────────────────────────────────
export * from './machine';
export * from './order';
export * from './subscription';
export * from './cycle';
export * from './payment';
export * from './cancellation';

import { cancellationMachine } from './cancellation';
import { cycleMachine } from './cycle';
import { orderMachine } from './order';
import { paymentMachine } from './payment';
import { subscriptionMachine } from './subscription';

/** Tüm makineler (doküman üretimi / tutarlılık testi). */
export const ALL_STATE_MACHINES = [orderMachine, subscriptionMachine, cycleMachine, paymentMachine, cancellationMachine] as const;
