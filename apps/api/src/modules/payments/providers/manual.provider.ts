import { Injectable, Logger } from '@nestjs/common';
import type {
  Money,
  PaymentProvider as PaymentProviderEnum,
  PaymentProviderName,
  ProviderChargeResult,
  ProviderCheckoutInit,
  ProviderRefundResult,
  ProviderRetrieveResult,
  WebhookVerification,
} from '@bagdam/shared';
import { randomBytes } from 'crypto';
import { MANUAL_FAIL_TOKEN_PREFIX, MANUAL_WEBHOOK_SIGNATURE } from '../payments.constants';
import type { InitCheckoutOptions, PaymentProvider, ProviderOrderInput, RefundRef, StoredCardRef } from './payment-provider.interface';

/** `setOutcome` geri çağrısına giden bağlam. */
export interface ManualChargeContext {
  paymentMethod: StoredCardRef;
  amount: Money;
  conversationId: string;
}
/** Kısa yol: 'SUCCEEDED' | 'FAILED' ya da tam sonuç. */
export type ManualChargeOutcome = 'SUCCEEDED' | 'FAILED' | ProviderChargeResult;
export type ManualOutcomeFn = (ctx: ManualChargeContext) => ManualChargeOutcome | Promise<ManualChargeOutcome>;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/**
 * ManualProvider — test/geliştirme sağlayıcısı (ADR-0010 "ManualProvider testte"). Dış çağrı yok, her şey anında:
 *  - `chargeStoredCard`: `setOutcome(fn)` verilmişse onun kararı; yoksa kart token'ı `fail:` ile başlıyorsa FAILED (`MANUAL_DECLINED`),
 *    aksi hâlde SUCCEEDED (`providerPaymentId = man_pay_…`). Testler iki yolu da kullanır; `resetOutcome()` varsayılana döner.
 *  - `initCheckout`: CF içeriği yok (null/null) — F8 manuel akışta checkout anında PAID sayılır (ManualProvider ile staging demo).
 *  - `retrieve`: her zaman SUCCEEDED (manuel sandbox).
 *  - `refund`: her zaman başarılı (`man_ref_…`).
 *  - `verifyWebhook`: imza `manual` ise geçerli; gövde JSON `{eventType, providerRef, …}`.
 * Gerçek para hareketi YOK; prod'da Setting `payment.provider = manual` seçilmemelidir (F11 checklist).
 */
@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'manual';
  readonly enumValue: PaymentProviderEnum = 'MANUAL';
  private readonly logger = new Logger(ManualProvider.name);
  private outcome: ManualOutcomeFn | null = null;

  /** Test kancası: sonraki `chargeStoredCard` çağrılarının sonucunu belirler (null → varsayılan token kuralı). */
  setOutcome(fn: ManualOutcomeFn | null): void {
    this.outcome = fn;
  }

  resetOutcome(): void {
    this.outcome = null;
  }

  async initCheckout(order: ProviderOrderInput, opts: InitCheckoutOptions): Promise<ProviderCheckoutInit> {
    this.logger.log(`manual initCheckout: order #${order.orderNo} ${order.amount} TL (${opts.conversationId})`);
    return { providerToken: rid('man_tok'), redirectUrl: null, checkoutFormContent: null };
  }

  async retrieve(token: string): Promise<ProviderRetrieveResult> {
    return {
      status: 'SUCCEEDED',
      providerPaymentId: `man_pay_${token}`,
      storedCard: null,
      failureCode: null,
      failureMessage: null,
      raw: { provider: 'manual', token },
    };
  }

  async chargeStoredCard(paymentMethod: StoredCardRef, amount: Money, conversationId: string): Promise<ProviderChargeResult> {
    if (this.outcome) {
      const decided = await this.outcome({ paymentMethod, amount, conversationId });
      if (decided === 'SUCCEEDED') return this.succeeded(conversationId);
      if (decided === 'FAILED') return this.declined();
      return decided;
    }
    if (paymentMethod.providerCardToken.startsWith(MANUAL_FAIL_TOKEN_PREFIX)) return this.declined();
    return this.succeeded(conversationId);
  }

  async refund(payment: RefundRef, amount: Money): Promise<ProviderRefundResult> {
    this.logger.log(`manual refund: payment ${payment.id} ${amount} TL`);
    return { ok: true, providerRefundId: rid('man_ref'), failureCode: null, failureMessage: null, raw: { provider: 'manual', amount } };
  }

  verifyWebhook(raw: Buffer | string, signature: string | null | undefined): WebhookVerification {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    let payload: unknown = null;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return { valid: false, eventType: null, providerRef: null, payload: text, error: 'INVALID_JSON' };
    }
    const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const eventType = typeof obj.eventType === 'string' ? obj.eventType : null;
    const providerRef =
      typeof obj.providerRef === 'string' ? obj.providerRef : typeof obj.paymentId === 'string' ? obj.paymentId : null;
    const valid = signature === MANUAL_WEBHOOK_SIGNATURE;
    return { valid, eventType, providerRef, payload, error: valid ? null : 'INVALID_SIGNATURE' };
  }

  private succeeded(conversationId: string): ProviderChargeResult {
    return { ok: true, providerPaymentId: rid('man_pay'), failureCode: null, failureMessage: null, raw: { provider: 'manual', conversationId } };
  }

  private declined(): ProviderChargeResult {
    return {
      ok: false,
      providerPaymentId: null,
      failureCode: 'MANUAL_DECLINED',
      failureMessage: 'Manuel sağlayıcı: kart reddedildi (simülasyon)',
      raw: { provider: 'manual' },
    };
  }
}
