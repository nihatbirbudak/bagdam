import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  assertPaymentTransition,
  InvalidTransitionError,
  PAYMENT_COLLECTED_STATES,
  PAYMENT_OPEN_STATES,
  roundMoney,
  type Money,
  type PaymentLinkInfo,
  type WebhookRecordResult,
} from '@bagdam/shared';
import { Prisma, type PaymentKind, type PaymentProvider as PaymentProviderEnum, type PaymentStatus } from '@prisma/client';
import { decimalToMoney, moneyToDecimal, toJsonValue, toPaymentLinkInfo } from './payments.mapper';
import {
  PaymentsRepository,
  type DbClient,
  type PaymentMethodRecord,
  type PaymentRecord,
  type PaymentWithOrderRecord,
  type RefundRecord,
  type WebhookEventRecord,
} from './payments.repository';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

/** `recordPayment` girdisi — Payment PENDING satırı (conversationId unique = idempotency; P2002 → 409 `PAYMENT_DUPLICATE`). */
export interface RecordPaymentInput {
  orderId: string;
  provider: PaymentProviderEnum;
  kind: PaymentKind;
  conversationId: string;
  amount: Money;
  paymentMethodId?: string | null;
  is3ds: boolean;
  isMerchantInitiated: boolean;
  attemptNo?: number;
  providerToken?: string | null;
  linkToken?: string | null;
  linkExpiresAt?: Date | null;
}

export interface MarkSucceededInput {
  providerPaymentId?: string | null;
  rawResponse?: unknown;
  paidAt?: Date;
}

export interface MarkFailedInput {
  failureCode: string;
  failureMessage?: string | null;
  rawResponse?: unknown;
}

export interface RefundInput {
  reason?: string | null;
  /** Admin User.id (audit). */
  requestedBy?: string | null;
}

export interface RefundResult {
  ok: boolean;
  refund: RefundRecord;
  payment: PaymentRecord;
  /** Bu ödeme için şimdiye kadar başarıyla iade edilen toplam (bu iade dahil). */
  refundedTotal: Money;
}

export interface RecordWebhookInput {
  provider: PaymentProviderEnum;
  eventType: string;
  providerRef: string;
  payload: unknown;
  signatureValid: boolean;
}

function prismaCode(err: unknown): string | null {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
}

/**
 * PaymentsService — Payment / Refund / WebhookEvent yaşam döngüsü (state-machines §4; ADR-0006/0010).
 *  - Payment satırı yazmanın TEK yolu: `recordPayment` (conversationId idempotency) → `markSucceeded/markFailed/markExpired/markRequires3ds`
 *    (her biri `assertPaymentTransition`; geçersiz → 409 `INVALID_TRANSITION`).
 *  - Order/cycle/abonelik geçişleri BURADA DEĞİL (OrdersService / CyclesService — çağıran orkestre eder; §8).
 *  - `refund`: sağlayıcı iadesi + Refund satırı + Payment PARTIAL_REFUNDED/REFUNDED.
 *  - `recordWebhookEvent`: `@@unique(provider,eventType,providerRef)` → ikinci teslim `duplicate:true` + `IGNORED` (satır eklenmez);
 *    `markWebhookProcessed/Failed`.
 *  - `expireLinksDue(now)`: kind LINK, açık (PENDING|REQUIRES_3DS), `linkExpiresAt <= now` → EXPIRED (cycle tarafı `cycles:expire-payment-links`).
 *  - `getPaymentLinkInfo(token, now)`: public `GET /pay/:linkToken` JSON'u.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly providers: PaymentProviderFactory,
  ) {}

  // ── Payment ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async recordPayment(input: RecordPaymentInput, tx?: DbClient): Promise<PaymentRecord> {
    const amount = roundMoney(input.amount);
    if (amount < 0) throw new BadRequestException({ message: 'Ödeme tutarı negatif olamaz', error: 'PAYMENT_AMOUNT_INVALID' });
    try {
      return await this.repo.createPayment(
        {
          orderId: input.orderId,
          provider: input.provider,
          kind: input.kind,
          conversationId: input.conversationId,
          amount: moneyToDecimal(amount),
          paymentMethodId: input.paymentMethodId ?? null,
          is3ds: input.is3ds,
          isMerchantInitiated: input.isMerchantInitiated,
          attemptNo: input.attemptNo ?? 1,
          providerToken: input.providerToken ?? null,
          linkToken: input.linkToken ?? null,
          linkExpiresAt: input.linkExpiresAt ?? null,
          status: 'PENDING',
        },
        tx,
      );
    } catch (err) {
      if (prismaCode(err) === 'P2002') {
        throw new ConflictException({ message: `Bu ödeme zaten kayıtlı: ${input.conversationId}`, error: 'PAYMENT_DUPLICATE' });
      }
      throw err;
    }
  }

  async requirePayment(paymentId: string, tx?: DbClient): Promise<PaymentRecord> {
    const row = await this.repo.findPaymentById(paymentId, tx);
    if (!row) throw new NotFoundException({ message: `Ödeme bulunamadı: ${paymentId}`, error: 'PAYMENT_NOT_FOUND' });
    return row;
  }

  findByConversationId(conversationId: string, tx?: DbClient): Promise<PaymentRecord | null> {
    return this.repo.findPaymentByConversationId(conversationId, tx);
  }

  findByLinkToken(linkToken: string, tx?: DbClient): Promise<PaymentWithOrderRecord | null> {
    return this.repo.findPaymentByLinkToken(linkToken, tx);
  }

  listForOrder(orderId: string, tx?: DbClient): Promise<PaymentRecord[]> {
    return this.repo.findPaymentsByOrder(orderId, tx);
  }

  countForOrder(orderId: string, tx?: DbClient): Promise<number> {
    return this.repo.countPaymentsForOrder(orderId, tx);
  }

  findPaymentMethod(id: string, tx?: DbClient): Promise<PaymentMethodRecord | null> {
    return this.repo.findPaymentMethodById(id, tx);
  }

  /** PENDING → REQUIRES_3DS (CF/link açıldı). */
  async markRequires3ds(paymentId: string, providerToken: string | null, tx?: DbClient): Promise<PaymentRecord> {
    const payment = await this.requirePayment(paymentId, tx);
    this.assertTransition(payment.status, 'REQUIRES_3DS');
    return this.repo.updatePayment(paymentId, { status: 'REQUIRES_3DS', providerToken: providerToken ?? payment.providerToken }, tx);
  }

  /** PENDING | REQUIRES_3DS → SUCCEEDED (`paidAt`, `providerPaymentId`). Aynı durumdaysa (çift callback) idempotent döner. */
  async markSucceeded(paymentId: string, input: MarkSucceededInput = {}, tx?: DbClient): Promise<PaymentRecord> {
    const payment = await this.requirePayment(paymentId, tx);
    if (payment.status === 'SUCCEEDED') return payment; // idempotent (webhook + callback)
    this.assertTransition(payment.status, 'SUCCEEDED');
    const raw = toJsonValue(input.rawResponse);
    return this.repo.updatePayment(
      paymentId,
      {
        status: 'SUCCEEDED',
        paidAt: input.paidAt ?? new Date(),
        providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
        ...(raw !== undefined ? { rawResponse: raw } : {}),
      },
      tx,
    );
  }

  /** PENDING | REQUIRES_3DS → FAILED (`failureCode/Message`). */
  async markFailed(paymentId: string, input: MarkFailedInput, tx?: DbClient): Promise<PaymentRecord> {
    const payment = await this.requirePayment(paymentId, tx);
    this.assertTransition(payment.status, 'FAILED');
    const raw = toJsonValue(input.rawResponse);
    return this.repo.updatePayment(
      paymentId,
      {
        status: 'FAILED',
        failureCode: input.failureCode.slice(0, 40),
        failureMessage: input.failureMessage ? input.failureMessage.slice(0, 255) : null,
        ...(raw !== undefined ? { rawResponse: raw } : {}),
      },
      tx,
    );
  }

  /** PENDING | REQUIRES_3DS → EXPIRED (link süresi / checkout zaman aşımı). */
  async markExpired(paymentId: string, tx?: DbClient): Promise<PaymentRecord> {
    const payment = await this.requirePayment(paymentId, tx);
    if (payment.status === 'EXPIRED') return payment;
    this.assertTransition(payment.status, 'EXPIRED');
    return this.repo.updatePayment(paymentId, { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: 'Ödeme süresi doldu' }, tx);
  }

  /** Süresi dolmuş açık ödeme linklerini EXPIRED yapar; etkilenen Payment satırlarını döner (cycle tarafı çağıranda). */
  async expireLinksDue(now: Date, tx?: DbClient): Promise<PaymentRecord[]> {
    const due = await this.repo.findExpiredOpenLinks(now, PAYMENT_OPEN_STATES, tx);
    const out: PaymentRecord[] = [];
    for (const p of due) out.push(await this.markExpired(p.id, tx));
    if (out.length > 0) this.logger.log(`expireLinksDue: ${out.length} ödeme linki süresi doldu`);
    return out;
  }

  // ── Refund ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * İade: tahsil edilmiş (SUCCEEDED | PARTIAL_REFUNDED) ödemeden `amount` (kalan ≥ amount > 0) → sağlayıcı iadesi →
   * Refund SUCCEEDED/FAILED → Payment PARTIAL_REFUNDED / REFUNDED (toplam = tutar). Sağlayıcı reddederse `ok:false` (fırlatmaz).
   */
  async refund(paymentId: string, amount: Money, input: RefundInput = {}): Promise<RefundResult> {
    const payment = await this.requirePayment(paymentId);
    if (!PAYMENT_COLLECTED_STATES.includes(payment.status)) {
      throw new ConflictException({ message: 'Yalnız tahsil edilmiş ödemeler iade edilebilir', error: 'PAYMENT_NOT_REFUNDABLE' });
    }
    const wanted = roundMoney(amount);
    if (!(wanted > 0)) throw new BadRequestException({ message: 'İade tutarı pozitif olmalı', error: 'REFUND_AMOUNT_INVALID' });
    const total = decimalToMoney(payment.amount);
    const already = decimalToMoney(await this.repo.sumSucceededRefunds(paymentId));
    const remaining = roundMoney(total - already);
    if (wanted > remaining) {
      throw new BadRequestException({ message: `İade tutarı kalan tutarı aşıyor (kalan ${remaining} TL)`, error: 'REFUND_AMOUNT_EXCEEDS' });
    }

    const provider = this.providers.getByEnum(payment.provider);
    let refund = await this.repo.createRefund({
      paymentId,
      amount: moneyToDecimal(wanted),
      reason: input.reason ? input.reason.slice(0, 255) : null,
      requestedBy: input.requestedBy ?? null,
      status: 'PENDING',
    });
    const res = await provider.refund(
      { id: payment.id, conversationId: payment.conversationId, providerPaymentId: payment.providerPaymentId, amount: total },
      wanted,
    );
    if (!res.ok) {
      refund = await this.repo.updateRefund(refund.id, { status: 'FAILED' });
      this.logger.warn(`refund başarısız: payment ${paymentId} ${wanted} TL — ${res.failureCode ?? '?'} ${res.failureMessage ?? ''}`);
      return { ok: false, refund, payment, refundedTotal: already };
    }
    refund = await this.repo.updateRefund(refund.id, { status: 'SUCCEEDED', providerRefundId: res.providerRefundId });
    const refundedTotal = roundMoney(already + wanted);
    const target: PaymentStatus = refundedTotal >= total ? 'REFUNDED' : 'PARTIAL_REFUNDED';
    let updated = payment;
    if (payment.status !== target) {
      this.assertTransition(payment.status, target);
      updated = await this.repo.updatePayment(paymentId, { status: target });
    }
    this.logger.log(`refund: payment ${paymentId} ${wanted} TL → ${target} (toplam ${refundedTotal}/${total})`);
    return { ok: true, refund, payment: updated, refundedTotal };
  }

  // ── WebhookEvent (idempotency) ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Webhook teslimini kaydeder. Aynı (provider, eventType, providerRef) ikinci kez gelirse satır EKLENMEZ;
   * sonuç `duplicate:true, status:'IGNORED'` ve var olan satır döner — çağıran durum geçişi uygulamaz (state-machines §4).
   */
  async recordWebhookEvent(input: RecordWebhookInput): Promise<WebhookRecordResult & { event: WebhookEventRecord }> {
    const payload = toJsonValue(input.payload) ?? {};
    try {
      const event = await this.repo.createWebhookEvent({
        provider: input.provider,
        eventType: input.eventType.slice(0, 80),
        providerRef: input.providerRef.slice(0, 160),
        payload,
        signatureValid: input.signatureValid,
        status: 'RECEIVED',
      });
      return { id: event.id, status: event.status, duplicate: false, event };
    } catch (err) {
      if (prismaCode(err) !== 'P2002') throw err;
      const existing = await this.repo.findWebhookEvent(input.provider, input.eventType.slice(0, 80), input.providerRef.slice(0, 160));
      if (!existing) throw err;
      this.logger.warn(`webhook çift teslim yok sayıldı: ${input.provider} ${input.eventType} ${input.providerRef} (ilk: ${existing.id})`);
      return { id: existing.id, status: 'IGNORED', duplicate: true, event: existing };
    }
  }

  markWebhookProcessed(id: string, now: Date = new Date()): Promise<WebhookEventRecord> {
    return this.repo.updateWebhookEvent(id, { status: 'PROCESSED', processedAt: now, error: null });
  }

  markWebhookFailed(id: string, error: string, now: Date = new Date()): Promise<WebhookEventRecord> {
    return this.repo.updateWebhookEvent(id, { status: 'FAILED', processedAt: now, error: error.slice(0, 2000) });
  }

  findWebhookEvent(id: string): Promise<WebhookEventRecord | null> {
    return this.repo.findWebhookEventById(id);
  }

  // ── Public ödeme linki ────────────────────────────────────────────────────────────────────────────────────────────

  /** `GET /pay/:linkToken` → {status, amount, expiresAt, expired, orderNo}; bilinmeyen token 404. */
  async getPaymentLinkInfo(linkToken: string, now: Date = new Date()): Promise<PaymentLinkInfo> {
    const row = await this.repo.findPaymentByLinkToken(linkToken);
    if (!row) throw new NotFoundException({ message: 'Ödeme bağlantısı bulunamadı', error: 'PAYMENT_LINK_NOT_FOUND' });
    return toPaymentLinkInfo(row, now);
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────────────────────────────────────────────────

  private assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    try {
      assertPaymentTransition(from, to);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({ message: err.message, error: 'INVALID_TRANSITION' });
      }
      throw err;
    }
  }
}
