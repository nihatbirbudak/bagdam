import { ConflictException } from '@nestjs/common';
import { InvalidTransitionError, type StateMachine } from '@bagdam/shared';

/**
 * 409 hata kodları (JSON zarfı `{statusCode:409, message, error}`; müşteri/admin istemcileri `error` koduna bakar).
 * Geçiş hataları: `${MAKİNE}_TRANSITION_INVALID` (B2 `ORDER_TRANSITION_INVALID` ile aynı kalıp).
 */
export const SUB_ERRORS = {
  SUBSCRIPTION_EXISTS: 'SUBSCRIPTION_EXISTS',
  NO_SUBSCRIPTION: 'NO_SUBSCRIPTION',
  NO_CURRENT_CYCLE: 'NO_CURRENT_CYCLE',
  CYCLE_LOCKED: 'CYCLE_LOCKED',
  CYCLE_NOT_EDITABLE: 'CYCLE_NOT_EDITABLE',
  FIRST_CYCLE_NOT_SKIPPABLE: 'FIRST_CYCLE_NOT_SKIPPABLE',
  SKIP_LIMIT_REACHED: 'SKIP_LIMIT_REACHED',
  NOT_SKIPPED: 'NOT_SKIPPED',
  DAY_FULL: 'DAY_FULL',
  BOX_ITEM_COUNT: 'BOX_ITEM_COUNT',
  PRODUCT_NOT_AVAILABLE: 'PRODUCT_NOT_AVAILABLE',
  PRODUCT_NOT_SWAPPABLE: 'PRODUCT_NOT_SWAPPABLE',
  PREF_INVALID: 'PREF_INVALID',
  EXTRA_FACTOR_INVALID: 'EXTRA_FACTOR_INVALID',
  FREQUENCY_INVALID: 'FREQUENCY_INVALID',
  DELIVERY_DAY_INVALID: 'DELIVERY_DAY_INVALID',
  ADDRESS_INVALID: 'ADDRESS_INVALID',
  PAYMENT_METHOD_INVALID: 'PAYMENT_METHOD_INVALID',
  CANCEL_ALREADY_REQUESTED: 'CANCEL_ALREADY_REQUESTED',
  NO_OPEN_CANCELLATION: 'NO_OPEN_CANCELLATION',
  RETENTION_NOT_OFFERED: 'RETENTION_NOT_OFFERED',
  NO_SCHEDULED_CYCLE: 'NO_SCHEDULED_CYCLE',
  BOX_TEMPLATE_MISSING: 'BOX_TEMPLATE_MISSING',
  NO_PAYMENT_METHOD: 'NO_PAYMENT_METHOD',
  CHARGE_NOT_APPLICABLE: 'CHARGE_NOT_APPLICABLE',
  SUBSCRIPTION_TRANSITION_INVALID: 'SUBSCRIPTION_TRANSITION_INVALID',
  CYCLE_TRANSITION_INVALID: 'CYCLE_TRANSITION_INVALID',
  CANCELLATION_TRANSITION_INVALID: 'CANCELLATION_TRANSITION_INVALID',
} as const;
export type SubErrorCode = (typeof SUB_ERRORS)[keyof typeof SUB_ERRORS];

export function conflict(error: SubErrorCode | string, message: string): ConflictException {
  return new ConflictException({ message, error });
}

const MACHINE_CODES: Record<string, string> = {
  Subscription: SUB_ERRORS.SUBSCRIPTION_TRANSITION_INVALID,
  SubscriptionCycle: SUB_ERRORS.CYCLE_TRANSITION_INVALID,
  SubscriptionCancellation: SUB_ERRORS.CANCELLATION_TRANSITION_INVALID,
};

/** shared `assertXTransition` → 409 `{error: X_TRANSITION_INVALID}` (state-machines.md §0). */
export function assertOr409<S extends string>(machine: StateMachine<S, string>, from: S, to: S): void {
  try {
    machine.assertTransition(from, to);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      throw conflict(MACHINE_CODES[err.machine] ?? 'INVALID_TRANSITION', err.message);
    }
    throw err;
  }
}

/** Bir hatanın 409 `DAY_FULL` olup olmadığı (B1 DeliveryDatesService.reserve ya da yerel uygulama). */
export function isDayFullError(err: unknown): boolean {
  if (!(err instanceof ConflictException)) return false;
  const body = err.getResponse();
  return typeof body === 'object' && body !== null && (body as { error?: string }).error === SUB_ERRORS.DAY_FULL;
}
