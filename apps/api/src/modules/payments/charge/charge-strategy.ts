import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  PROVIDER_FEATURE_DISABLED,
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
import { PaymentsRepository, type DbClient, type PaymentRecord } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import type { StoredCardRef } from '../providers/payment-provider.interface';
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
  Partial<Pick<PaymentMethod, 'isActive' | 'deletedAt' | 'holderName'>>;

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

/** Sağlayıcı istisnası → failureCode: 503 PROVIDER_FEATURE_DISABLED (kayıtlı kart onayı yok) ayrı kodlanır; diğerleri PROVIDER_ERROR. */
function providerFailureCode(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse() as { error?: string };
    if (body?.error === PROVIDER_FEATURE_DISABLED) return PROVIDER_FEATURE_DISABLED;
  }
  return 'PROVIDER_ERROR';
}

/**
 * MerchantInitiatedCharge — saklı karttan NON3D tahsilat (ADR-0006 MERCHANT_INITIATED; state-machines §8 adım 6, §9).
 * `charge(cycle, order, paymentMethod, opts)`: Payment(kind CYCLE_CHARGE|DELTA|RETRY, isMerchantInitiated, is3ds=false, attemptNo,
 * conversationId `cyc_<cycleId>_<attemptNo>`) → kartın sağlayıcısı `chargeStoredCard` → Payment SUCCEEDED | FAILED.
 * Cycle/Order/abonelik geçişleri ve SubscriptionEvent ÇAĞIRANIN (CyclesService). Sağlayıcı istisnası → FAILED `PROVIDER_ERROR`
 * (PayTR kayıtlı kart onayı kapalıysa `PROVIDER_FEATURE_DISABLED`; fırlatmaz). F8: PayTR'nin istediği kart sahibi e-postası/adı
 * PaymentMethod.user'dan doldurulur (`StoredCardRef.email/holderName`).
 * Tutar ≤ 0 → sağlayıcıya gidilmez, Payment doğrudan SUCCEEDED (tutar 0 kaydı; normalde çağıran `due<=0`'da buraya gelmez).
 */
@Injectable()
export class MerchantInitiatedCharge {
  readonly kind: ChargeStrategyKind = 'MERCHANT_INITIATED';
  private readonly logger = new Logger(MerchantInitiatedCharge.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
    private readonly repo: PaymentsRepository,
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
      const res = await provider.chargeStoredCard(await this.cardRef(paymentMethod, opts.tx), amount, conversationId);
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
      const failureCode = providerFailureCode(err);
      this.logger.error(`MIT tahsilat sağlayıcı hatası (${failureCode}): cycle ${cycle.id} — ${message}`);
      const failed = await this.payments.markFailed(payment.id, { failureCode, failureMessage: message }, opts.tx);
      return this.outcome('FAILED', failed, amount);
    }
  }

  /** StoredCardRef: PaymentMethod + sahibi (e-posta/ad) — PayTR kayıtlı kart ödemesinde zorunlu; okunamazsa yalnız token'lar. */
  private async cardRef(pm: StoredCardRecord, tx?: DbClient): Promise<StoredCardRef> {
    const base: StoredCardRef = { id: pm.id, providerCustomerKey: pm.providerCustomerKey, providerCardToken: pm.providerCardToken, last4: pm.last4, holderName: pm.holderName ?? null };
    try {
      const full = await this.repo.findPaymentMethodWithUser(pm.id, tx);
      if (full) return { ...base, email: full.user.email, holderName: full.holderName ?? full.user.name ?? null };
    } catch (err) {
      this.logger.warn(`PaymentMethod sahibi okunamadı (${pm.id}): ${(err as Error).message}`);
    }
    return base;
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
 * F8: `GET /pay/:linkToken` sayfası (B/C) aktif sağlayıcı PayTR ise `PayTrProvider.createPaymentLink` ile PayTR linkine yönlendirir/gömer;
 * callback_id = conversationId'nin alfanümerik hâli → callback bu Payment'ı bulur (PaymentsRepository.findPaymentByMerchantOid).
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
 *  - `for(sub)` (sync, F7): MERCHANT_INITIATED ama saklı kart yok/pasif → PAYMENT_LINK (`NO_STORED_CARD`; state-machines §14 #10).
 *  - `resolve(sub)` (F8, async): ek olarak aktif sağlayıcı PayTR ve Setting `payment.storedCardEnabled=false` → PAYMENT_LINK
 *    (`STORED_CARD_DISABLED`, ADR-0019: kayıtlı kart onayı gelene kadar abonelik tahsilatı ödeme linkiyle).
 *  - `resolveDefault()` (F8): yeni abonelik için Setting `commerce.chargeStrategy` + aynı PayTR kuralı → B checkout `createFromCheckout.chargeStrategy`.
 */
@Injectable()
export class ChargeStrategyResolver {
  private readonly logger = new Logger(ChargeStrategyResolver.name);

  constructor(
    private readonly mit: MerchantInitiatedCharge,
    private readonly link: PaymentLinkCharge,
    private readonly settings: SettingsService,
    private readonly providers: PaymentProviderFactory,
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

  /** `for()` + sağlayıcı yeteneği (PayTR kayıtlı kart onayı). */
  async resolve(subscription: SubscriptionChargeContext): Promise<ResolvedChargeStrategy> {
    const base = this.for(subscription);
    if (base.kind !== 'MERCHANT_INITIATED') return base;
    if (await this.storedCardsUnavailable()) {
      this.logger.warn('MERCHANT_INITIATED istendi ama PayTR kayıtlı kart onayı kapalı (payment.storedCardEnabled=false) → PAYMENT_LINK');
      return { kind: 'PAYMENT_LINK', fallbackReason: 'STORED_CARD_DISABLED', strategy: this.link };
    }
    return base;
  }

  /** Yeni abonelik için varsayılan strateji (Setting commerce.chargeStrategy; PayTR onayı yoksa PAYMENT_LINK). */
  async resolveDefault(): Promise<ChargeStrategyDecision> {
    const commerce = await this.settings.getCommerce();
    if (commerce.chargeStrategy === 'MERCHANT_INITIATED' && (await this.storedCardsUnavailable())) {
      return { kind: 'PAYMENT_LINK', fallbackReason: 'STORED_CARD_DISABLED' };
    }
    return { kind: commerce.chargeStrategy, fallbackReason: null };
  }

  /** Aktif sağlayıcı paytr ve Setting payment.storedCardEnabled kapalı mı. */
  private async storedCardsUnavailable(): Promise<boolean> {
    try {
      if ((await this.providers.resolveName()) !== 'paytr') return false;
      const payment = await this.settings.getPayment();
      return payment.storedCardEnabled !== true;
    } catch (err) {
      this.logger.warn(`Kayıtlı kart yeteneği okunamadı: ${(err as Error).message}`);
      return false;
    }
  }
}
