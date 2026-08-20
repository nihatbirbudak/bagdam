import { Injectable, Logger } from '@nestjs/common';
import {
  roundMoney,
  type ChargeStrategy as ChargeStrategyKind,
  type ChargeStrategyDecision,
  type MitChargeOutcome,
  type Money,
  type PaymentLinkIssue,
} from '@bagdam/shared';
import type { PaymentKind, PaymentMethod, Prisma } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import { buildPayLinkUrl, cycleConversationId, generateLinkToken, linkConversationId } from '../payments.constants';
import { decimalToMoney } from '../payments.mapper';
import type { DbClient, PaymentRecord } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';

/** Tahsilatın bağlandığı cycle (Payment'ta FK yok; conversationId `cyc_<cycleId>_<n>` ile izlenir). */
export interface CycleRef {
  id: string;
  cycleNo?: number;
  subscriptionId?: string;
}

/** Tahsil edilecek Order (cycle#n Order'ı ya da cycle#1 DELTA Order'ı) — tutar varsayılanı `grandTotal`. */
export interface OrderRef {
  id: string;
  orderNo?: number;
  grandTotal: Prisma.Decimal | number;
}

/** Saklı kart kaydı (PaymentMethod) — MIT için gereken alanlar (+ aktiflik bilgisi varsa). */
export type StoredCardRecord = Pick<PaymentMethod, 'id' | 'provider' | 'providerCustomerKey' | 'providerCardToken' | 'last4'> &
  Partial<Pick<PaymentMethod, 'isActive' | 'deletedAt'>>;

export interface MitChargeOptions {
  /** CYCLE_CHARGE (varsayılan) · DELTA (cycle#1 ekstraları) · RETRY (dunning). */
  kind?: Extract<PaymentKind, 'CYCLE_CHARGE' | 'DELTA' | 'RETRY'>;
  /** Yoksa `order.grandTotal`. */
  amount?: Money;
  /** Yoksa Order'ın mevcut Payment sayısı + 1 (idempotency: `cyc_<cycleId>_<attemptNo>`). */
  attemptNo?: number;
  conversationId?: string;
  now?: Date;
  tx?: DbClient;
}

export interface PaymentLinkOptions {
  amount?: Money;
  attemptNo?: number;
  /** Yoksa Setting `commerce.paymentLinkHours` (20). */
  hours?: number;
  now?: Date;
  tx?: DbClient;
}

export type MitChargeResult = MitChargeOutcome & { payment: PaymentRecord };
export type PaymentLinkIssueResult = PaymentLinkIssue & { payment: PaymentRecord };

/**
 * MerchantInitiatedCharge — saklı karttan NON3D tahsilat (ADR-0006 MERCHANT_INITIATED; state-machines §8 adım 6, §9).
 * `charge(cycle, order, paymentMethod, opts)`: Payment(kind CYCLE_CHARGE|DELTA|RETRY, isMerchantInitiated, is3ds=false, attemptNo,
 * conversationId `cyc_<cycleId>_<attemptNo>`) → kartın sağlayıcısı `chargeStoredCard` → Payment SUCCEEDED | FAILED.
 * Cycle/Order/abonelik geçişleri ve SubscriptionEvent ÇAĞIRANIN (CyclesService). Sağlayıcı istisnası → FAILED `PROVIDER_ERROR` (fırlatmaz).
 * Tutar ≤ 0 → sağlayıcıya gidilmez, Payment doğrudan SUCCEEDED (tutar 0 kaydı; normalde çağıran `due<=0`'da buraya gelmez).
 */
@Injectable()
export class MerchantInitiatedCharge {
  readonly kind: ChargeStrategyKind = 'MERCHANT_INITIATED';
  private readonly logger = new Logger(MerchantInitiatedCharge.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
  ) {}

  async charge(cycle: CycleRef, order: OrderRef, paymentMethod: StoredCardRecord, opts: MitChargeOptions = {}): Promise<MitChargeResult> {
    const now = opts.now ?? new Date();
    const amount = roundMoney(opts.amount ?? decimalToMoney(order.grandTotal));
    const attemptNo = opts.attemptNo ?? (await this.payments.countForOrder(order.id, opts.tx)) + 1;
    const conversationId = opts.conversationId ?? cycleConversationId(cycle.id, attemptNo);
    const provider = this.providers.getByEnum(paymentMethod.provider);

    const payment = await this.payments.recordPayment(
      {
        orderId: order.id,
        provider: paymentMethod.provider,
        kind: opts.kind ?? 'CYCLE_CHARGE',
        conversationId,
        amount,
        paymentMethodId: paymentMethod.id,
        is3ds: false,
        isMerchantInitiated: true,
        attemptNo,
      },
      opts.tx,
    );

    if (amount <= 0) {
      const done = await this.payments.markSucceeded(payment.id, { paidAt: now }, opts.tx);
      return this.outcome('SUCCEEDED', done, amount);
    }

    try {
      const res = await provider.chargeStoredCard(
        { id: paymentMethod.id, providerCustomerKey: paymentMethod.providerCustomerKey, providerCardToken: paymentMethod.providerCardToken, last4: paymentMethod.last4 },
        amount,
        conversationId,
      );
      if (res.ok) {
        const done = await this.payments.markSucceeded(payment.id, { providerPaymentId: res.providerPaymentId, rawResponse: res.raw, paidAt: now }, opts.tx);
        this.logger.log(`MIT tahsilat OK: cycle ${cycle.id} order ${order.id} ${amount} TL (${conversationId})`);
        return this.outcome('SUCCEEDED', done, amount);
      }
      const failed = await this.payments.markFailed(
        payment.id,
        { failureCode: res.failureCode ?? 'PROVIDER_DECLINED', failureMessage: res.failureMessage ?? 'Tahsilat reddedildi', rawResponse: res.raw },
        opts.tx,
      );
      this.logger.warn(`MIT tahsilat RED: cycle ${cycle.id} order ${order.id} ${amount} TL — ${failed.failureCode}`);
      return this.outcome('FAILED', failed, amount);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`MIT tahsilat sağlayıcı hatası: cycle ${cycle.id} — ${message}`);
      const failed = await this.payments.markFailed(payment.id, { failureCode: 'PROVIDER_ERROR', failureMessage: message }, opts.tx);
      return this.outcome('FAILED', failed, amount);
    }
  }

  private outcome(status: 'SUCCEEDED' | 'FAILED', payment: PaymentRecord, amount: Money): MitChargeResult {
    return {
      status,
      paymentId: payment.id,
      conversationId: payment.conversationId,
      amount,
      providerPaymentId: payment.providerPaymentId,
      failureCode: payment.failureCode,
      failureMessage: payment.failureMessage,
      payment,
    };
  }
}

/**
 * PaymentLinkCharge — 3DS ödeme linki (ADR-0006 PAYMENT_LINK; state-machines §3 LOCKED→AWAITING_PAYMENT, §8 adım 6).
 * `issue(cycle, order, opts)`: Payment(kind LINK, is3ds, linkToken 32 hex rastgele, linkExpiresAt = now + Setting `commerce.paymentLinkHours`,
 * conversationId `lnk_<cycleId>_<attemptNo>`) → `{status:'AWAITING_PAYMENT', linkToken, linkUrl, linkExpiresAt}`.
 * cycle AWAITING_PAYMENT + paymentDueAt + e-posta ÇAĞIRANIN. Süre dolunca `PaymentsService.expireLinksDue(now)` / `markExpired`.
 */
@Injectable()
export class PaymentLinkCharge {
  readonly kind: ChargeStrategyKind = 'PAYMENT_LINK';
  private readonly logger = new Logger(PaymentLinkCharge.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
    private readonly settings: SettingsService,
  ) {}

  async issue(cycle: CycleRef, order: OrderRef, opts: PaymentLinkOptions = {}): Promise<PaymentLinkIssueResult> {
    const now = opts.now ?? new Date();
    const amount = roundMoney(opts.amount ?? decimalToMoney(order.grandTotal));
    const attemptNo = opts.attemptNo ?? (await this.payments.countForOrder(order.id, opts.tx)) + 1;
    const conversationId = linkConversationId(cycle.id, attemptNo);
    const hours = opts.hours ?? (await this.settings.getCommerce()).paymentLinkHours;
    const linkExpiresAt = new Date(now.getTime() + hours * 3_600_000);
    const provider = await this.providers.getActive();
    const linkToken = generateLinkToken();

    const payment = await this.payments.recordPayment(
      {
        orderId: order.id,
        provider: provider.enumValue,
        kind: 'LINK',
        conversationId,
        amount,
        is3ds: true,
        isMerchantInitiated: false,
        attemptNo,
        linkToken,
        linkExpiresAt,
      },
      opts.tx,
    );
    this.logger.log(`Ödeme linki üretildi: cycle ${cycle.id} order ${order.id} ${amount} TL, son ${linkExpiresAt.toISOString()}`);
    return {
      status: 'AWAITING_PAYMENT',
      paymentId: payment.id,
      conversationId,
      amount,
      linkToken,
      linkUrl: buildPayLinkUrl(linkToken),
      linkExpiresAt: linkExpiresAt.toISOString(),
      payment,
    };
  }
}

/** `ChargeStrategyResolver.for(...)` girdisi — Subscription satırı (ya da aynı alanlara sahip nesne). */
export interface SubscriptionChargeContext {
  chargeStrategy: ChargeStrategyKind;
  paymentMethodId: string | null;
  /** Saklı kart satırı biliniyorsa aktiflik kontrolü için (null = kart yok). */
  paymentMethod?: Pick<PaymentMethod, 'isActive' | 'deletedAt'> | null;
}

export type ResolvedChargeStrategy = ChargeStrategyDecision &
  ({ kind: 'MERCHANT_INITIATED'; strategy: MerchantInitiatedCharge } | { kind: 'PAYMENT_LINK'; strategy: PaymentLinkCharge });

/**
 * ChargeStrategyResolver — abonelik başına strateji (Subscription.chargeStrategy = Setting kopyası, ADR-0006).
 * MERCHANT_INITIATED ama saklı kart yok/pasif → PAYMENT_LINK'e düşer (`fallbackReason: 'NO_STORED_CARD'`; state-machines §14 #10, karar: evet + log).
 */
@Injectable()
export class ChargeStrategyResolver {
  private readonly logger = new Logger(ChargeStrategyResolver.name);

  constructor(
    private readonly mit: MerchantInitiatedCharge,
    private readonly link: PaymentLinkCharge,
  ) {}

  for(subscription: SubscriptionChargeContext): ResolvedChargeStrategy {
    if (subscription.chargeStrategy === 'MERCHANT_INITIATED') {
      const card = subscription.paymentMethod;
      const hasCard = subscription.paymentMethodId !== null && (card === undefined || (card !== null && card.isActive && card.deletedAt === null));
      if (hasCard) return { kind: 'MERCHANT_INITIATED', fallbackReason: null, strategy: this.mit };
      this.logger.warn('MERCHANT_INITIATED istendi ama saklı kart yok/pasif → PAYMENT_LINK');
      return { kind: 'PAYMENT_LINK', fallbackReason: 'NO_STORED_CARD', strategy: this.link };
    }
    return { kind: 'PAYMENT_LINK', fallbackReason: null, strategy: this.link };
  }
}
