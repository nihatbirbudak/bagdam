import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { ProviderStoredCard } from '@bagdam/shared';
import { decimalToMoney } from '../../payments.mapper';
import { PaymentsRepository, type PaymentRecord } from '../../payments.repository';
import { PaymentsService, type PaymentOutcomeResult } from '../../payments.service';
import { PaymentSettlementService } from '../../settlement/payment-settlement.service';
import { PayTrConfigService, type PayTrConfig } from './paytr.config';
import { toKurus, verifyCallbackHash } from './paytr.hash';
import { normalizeIp, parseCallbackBody } from './paytr.provider';
import {
  PAYTR_CALLBACK_BAD_HASH,
  PAYTR_CALLBACK_EVENT_TYPE,
  PAYTR_CALLBACK_IP_REJECTED,
  PAYTR_CALLBACK_MISSING_FIELDS,
  PAYTR_CALLBACK_NOT_CONFIGURED,
  PAYTR_CALLBACK_OK,
  PAYTR_CALLBACK_PROCESSING_ERROR,
  type PayTrCallbackPayload,
} from './paytr.types';

export interface PaytrCallbackRequest {
  /** Ayrıştırılmış gövde (form-urlencoded → nesne). */
  body: Record<string, unknown> | null | undefined;
  /** Ham gövde (main.ts rawBody:true) — varsa imza bu metinden doğrulanır. */
  rawBody?: Buffer | string | null;
  /** İstemci IP'si (trust proxy → req.ip; X-Forwarded-For ilk hop). */
  ip?: string | null;
  now?: Date;
}

export type PaytrCallbackOutcome = 'processed' | 'ignored' | 'rejected' | 'soft-failed' | 'error';

export interface PaytrCallbackResult {
  httpStatus: number;
  /** Düz metin yanıt (PayTR yalnız "OK" bekler). */
  text: string;
  outcome: PaytrCallbackOutcome;
  webhookEventId: string | null;
  paymentId: string | null;
  /** Dinleyicinin (CheckoutCompletionService / PaymentSettlementService) uyguladığı sipariş sonucu. */
  order: PaymentOutcomeResult | null;
  /** soft-failed/error/rejected nedeni (log/test). */
  reason: string | null;
}

/** İşleme sırasında kalıcı (yeniden denemenin çözmeyeceği) hata: WebhookEvent FAILED + PayTR'ye "OK" (sonsuz tekrar olmasın). */
class CallbackSoftError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CallbackSoftError';
  }
}

/** WebhookEvent.payload'a yazılmadan önce kart token'ları maskelenir (PaymentMethod'da saklanır; olay kaydında gerekmez). */
const REDACT_KEYS = ['utoken', 'ctoken'] as const;
export function redactCallbackPayload(payload: PayTrCallbackPayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    out[k] = (REDACT_KEYS as readonly string[]).includes(k) && v ? '***' : v;
  }
  return out;
}

/**
 * PaytrCallbackService — `POST /api/v1/payments/paytr/callback` işleyicisi (ADR-0019; PayTR iFrame/Direkt/Link bildirimi):
 *  1. zorunlu alanlar (merchant_oid, status, total_amount, hash) → yoksa 400
 *  2. yapılandırma (Setting payment.* / .env PAYTR_*) → yoksa 500 (PayTR yeniden dener; admin ayarı tamamlar)
 *  3. IP allowlist (Setting payment.paytrCallbackAllowedIps) → dışındaysa 403
 *  4. hash (HMAC-SHA256 base64; Link API: callback_id önekli) → geçersiz 400 "PAYTR notification failed: bad hash" (kayıt yazılmaz)
 *  5. WebhookEvent (PAYTR, 'callback', `<merchant_oid>:<status>`) — ikinci teslim: PROCESSED ise IGNORED → "OK"; RECEIVED/FAILED ise yeniden işlenir
 *  6. Payment eşle (callback_id → merchant_oid; tam conversationId / providerPaymentId / alfanümerik indirgeme) → yoksa FAILED + "OK"
 *  7. success: tutar kontrolü (payment_amount ×100 = Payment.amount) → PaymentsService.settlePayment(SUCCEEDED + utoken/ctoken kartı)
 *     → kayıtlı dinleyici (B CheckoutCompletionService; yoksa varsayılan PaymentSettlementService): Order PAID → abonelik ACTIVE / cycle CHARGED →
 *     PaymentMethod → Notifier · failed: settlePayment(FAILED) → Order PAYMENT_FAILED
 *  8. WebhookEvent PROCESSED → "OK"; kalıcı hata (tutar uyuşmazlığı, geçersiz geçiş) → FAILED + "OK"; geçici hata → FAILED + 500 (PayTR tekrar gönderir)
 */
@Injectable()
export class PaytrCallbackService {
  private readonly logger = new Logger(PaytrCallbackService.name);

  constructor(
    private readonly config: PayTrConfigService,
    private readonly payments: PaymentsService,
    private readonly repo: PaymentsRepository,
    private readonly settlement: PaymentSettlementService,
  ) {}

  async handle(req: PaytrCallbackRequest): Promise<PaytrCallbackResult> {
    const now = req.now ?? new Date();
    const payload = parseCallbackBody(req.rawBody && String(req.rawBody).length > 0 ? req.rawBody : req.body) ?? parseCallbackBody(req.body);
    if (!payload || !payload.merchant_oid || !payload.status || typeof payload.total_amount !== 'string' || !payload.hash) {
      this.logger.warn(`PayTR callback eksik alan: keys=[${Object.keys(payload ?? {}).join(',')}]`);
      return reject(400, PAYTR_CALLBACK_MISSING_FIELDS, 'MISSING_FIELDS');
    }
    const merchantOid = payload.merchant_oid;
    const cfg = await this.config.load();
    if (!cfg.configured) {
      this.logger.error(`PayTR callback işlenemedi (${merchantOid}): mağaza bilgileri tanımlı değil`);
      return reject(500, PAYTR_CALLBACK_NOT_CONFIGURED, 'NOT_CONFIGURED');
    }
    const ip = normalizeIp(req.ip, '');
    if (!this.ipAllowed(cfg, ip)) {
      this.logger.warn(`PayTR callback IP reddedildi: ${ip || '(yok)'} (${merchantOid})`);
      return reject(403, PAYTR_CALLBACK_IP_REJECTED, 'IP_REJECTED');
    }
    if (!verifyCallbackHash(payload, cfg.merchantKey, cfg.merchantSalt)) {
      this.logger.warn(`PayTR callback hash geçersiz: ${merchantOid} status=${payload.status}`);
      return reject(400, PAYTR_CALLBACK_BAD_HASH, 'BAD_HASH');
    }

    const providerRef = `${merchantOid}:${payload.status}`;
    const stored = redactCallbackPayload(payload);
    const rec = await this.payments.recordWebhookEvent({ provider: 'PAYTR', eventType: PAYTR_CALLBACK_EVENT_TYPE, providerRef, payload: stored, signatureValid: true });
    if (rec.duplicate) {
      if (rec.event.status === 'PROCESSED') {
        this.logger.log(`PayTR callback çift teslim (işlenmişti): ${providerRef} → OK`);
        return { httpStatus: 200, text: PAYTR_CALLBACK_OK, outcome: 'ignored', webhookEventId: rec.id, paymentId: null, order: null, reason: 'DUPLICATE' };
      }
      this.logger.warn(`PayTR callback yeniden işleniyor (önceki ${rec.event.status}): ${providerRef}`);
    }

    let paymentId: string | null = null;
    try {
      const done = await this.process(payload, stored, now);
      paymentId = done.paymentId;
      await this.payments.markWebhookProcessed(rec.id, now);
      return { httpStatus: 200, text: PAYTR_CALLBACK_OK, outcome: 'processed', webhookEventId: rec.id, paymentId, order: done.order, reason: null };
    } catch (err) {
      if (err instanceof CallbackSoftError) {
        this.logger.error(`PayTR callback kalıcı hata (${providerRef}): ${err.message}`);
        await this.payments.markWebhookFailed(rec.id, err.message, now);
        return { httpStatus: 200, text: PAYTR_CALLBACK_OK, outcome: 'soft-failed', webhookEventId: rec.id, paymentId, order: null, reason: err.code };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PayTR callback işleme hatası (${providerRef}): ${message}`, err instanceof Error ? err.stack : undefined);
      await this.payments.markWebhookFailed(rec.id, message, now).catch(() => undefined);
      return { httpStatus: 500, text: PAYTR_CALLBACK_PROCESSING_ERROR, outcome: 'error', webhookEventId: rec.id, paymentId, order: null, reason: 'PROCESSING_ERROR' };
    }
  }

  /** IP allowlist boşsa herkes; doluysa tam eşleşme. */
  private ipAllowed(cfg: PayTrConfig, ip: string): boolean {
    if (cfg.callbackAllowedIps.length === 0) return true;
    return ip.length > 0 && cfg.callbackAllowedIps.includes(ip);
  }

  /** Payment eşle + yerleştir. Kalıcı sorunlar CallbackSoftError. */
  private async process(payload: PayTrCallbackPayload, stored: Record<string, string>, now: Date): Promise<{ paymentId: string; order: PaymentOutcomeResult | null }> {
    const payment = await this.findPayment(payload);
    if (!payment) throw new CallbackSoftError('PAYMENT_NOT_FOUND', `Ödeme bulunamadı: merchant_oid=${payload.merchant_oid}${payload.callback_id ? ` callback_id=${payload.callback_id}` : ''}`);
    if (payment.provider !== 'PAYTR') throw new CallbackSoftError('PROVIDER_MISMATCH', `Ödeme ${payment.id} sağlayıcısı ${payment.provider}, PAYTR değil`);

    if (payload.status === 'success') {
      const expectedKurus = toKurus(decimalToMoney(payment.amount));
      const paidRaw = payload.payment_amount ?? payload.total_amount;
      const paidKurus = Number.parseInt(paidRaw, 10);
      if (!Number.isFinite(paidKurus) || paidKurus !== expectedKurus) {
        throw new CallbackSoftError('AMOUNT_MISMATCH', `Tutar uyuşmazlığı: beklenen ${expectedKurus} kuruş, gelen ${paidRaw} (total_amount ${payload.total_amount}) — ödeme ${payment.id} kapatılmadı`);
      }
      const storedCard = this.storedCardOf(payload);
      let res;
      try {
        res = await this.payments.settlePayment(payment, { status: 'SUCCEEDED', providerPaymentId: payload.merchant_oid, rawResponse: stored, paidAt: now, storedCard, actor: 'PSP' });
      } catch (err) {
        throw this.asSoftIfTerminal(err, payment);
      }
      // PAYMENT_LINK: cycle CHARGED (+ Order PAID) — kayıtlı dinleyiciden bağımsız, idempotent (state-machines §8 callback SUCCESS)
      if (payment.kind === 'LINK') await this.settlement.completeLinkCycle(res.payment, 'PSP', now);
      return { paymentId: payment.id, order: res.outcome };
    }

    const failureCode = (payload.failed_reason_code?.trim() ? `PAYTR_${payload.failed_reason_code.trim()}` : 'PAYTR_FAILED').slice(0, 40);
    try {
      const res = await this.payments.settlePayment(payment, { status: 'FAILED', failureCode, failureMessage: payload.failed_reason_msg ?? null, rawResponse: stored, actor: 'PSP' });
      return { paymentId: payment.id, order: res.outcome };
    } catch (err) {
      throw this.asSoftIfTerminal(err, payment);
    }
  }

  /** Geçersiz durum geçişi (ödeme EXPIRED/FAILED iken başarı geldi vb.) kalıcıdır — yeniden deneme çözmez. */
  private asSoftIfTerminal(err: unknown, payment: PaymentRecord): unknown {
    if (err instanceof ConflictException) {
      const body = err.getResponse() as { error?: string; message?: string };
      if (body?.error === 'INVALID_TRANSITION') {
        return new CallbackSoftError('INVALID_TRANSITION', `Ödeme ${payment.id} ${payment.status} durumunda — ${body.message ?? err.message} (elle inceleme/iade gerekebilir)`);
      }
    }
    return err;
  }

  /** callback_id (Link API) → merchant_oid. */
  private async findPayment(payload: PayTrCallbackPayload): Promise<PaymentRecord | null> {
    if (payload.callback_id) {
      const byCallbackId = await this.repo.findPaymentByMerchantOid(payload.callback_id);
      if (byCallbackId) return byCallbackId;
    }
    return this.repo.findPaymentByMerchantOid(payload.merchant_oid);
  }

  /** utoken + ctoken geldiyse saklı kart özeti (kart alanları PayTR bildiriminde opsiyonel). */
  private storedCardOf(payload: PayTrCallbackPayload): ProviderStoredCard | null {
    const utoken = payload.utoken?.trim();
    const ctoken = payload.ctoken?.trim();
    if (!utoken || !ctoken) return null;
    const digits = (payload.masked_pan ?? '').replace(/\D/g, '');
    const last4 = (payload.last_4 ?? digits.slice(-4)).slice(-4) || '****';
    return {
      providerCustomerKey: utoken,
      providerCardToken: ctoken,
      bin: digits.length >= 6 ? digits.slice(0, 6) : null,
      last4,
      brand: payload.kart_marka ?? payload.card_type ?? null,
      holderName: null,
      expMonth: null,
      expYear: null,
    };
  }
}

function reject(httpStatus: number, text: string, reason: string): PaytrCallbackResult {
  return { httpStatus, text, outcome: 'rejected', webhookEventId: null, paymentId: null, order: null, reason };
}
