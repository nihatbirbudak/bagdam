// ── Ödeme sağlayıcısı / tahsilat stratejisi DTO'ları (F7 — apps/api modules/payments sözleşmesi) ───────────────────
// Kaynak: BACKEND-PLANI §3 payments satırı, ADR-0006 (ikili strateji), ADR-0010 (PaymentProvider arayüzü, ManualProvider),
// docs/state-machines.md §4 (Payment) ve §8 adım 6. Burada yalnız saf tipler; Order/Payment/Refund/WebhookEvent DTO'ları
// `types/order.ts` içindedir (tekrar tanımlanmaz). iyzico adaptörü (F8) aynı tipleri doldurur.
import type { ChargeStrategy, PaymentProvider, PaymentStatus, WebhookStatus } from '../enums';
import type { Id, IsoDateTime } from './common';
import type { Money } from './pricing';

/** Sağlayıcı adı (Setting `payment.provider` / env `PAYMENT_PROVIDER`): `manual` test/geliştirme · `iyzico` F8. PayTR P2. */
export type PaymentProviderName = 'manual' | 'iyzico';
export const PAYMENT_PROVIDER_NAMES: readonly PaymentProviderName[] = ['manual', 'iyzico'];

/** Sağlayıcı adı ↔ Prisma `PaymentProvider` enum'u. */
export const PAYMENT_PROVIDER_ENUM_BY_NAME: Readonly<Record<PaymentProviderName, PaymentProvider>> = {
  manual: 'MANUAL',
  iyzico: 'IYZICO',
};
export function paymentProviderNameFromEnum(value: PaymentProvider): PaymentProviderName | null {
  if (value === 'MANUAL') return 'manual';
  if (value === 'IYZICO') return 'iyzico';
  return null; // PAYTR P2
}

/** `PaymentProvider.initCheckout` sonucu — Checkout Form içeriği (iyzico CF) ya da yönlendirme URL'si; manuel sağlayıcıda ikisi de null. */
export interface ProviderCheckoutInit {
  providerToken: string;
  redirectUrl: string | null;
  checkoutFormContent: string | null;
}

/** `PaymentProvider.retrieve(token)` — sağlayıcıdaki güncel sonuç (callback/reconcile). */
export interface ProviderRetrieveResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  providerPaymentId: string | null;
  /** Saklanan kart (registerCard) — iyzico cardUserKey/cardToken; yoksa null. */
  storedCard: ProviderStoredCard | null;
  failureCode: string | null;
  failureMessage: string | null;
  raw: unknown;
}

/** Sağlayıcının döndürdüğü saklı kart özeti (PaymentMethod satırı üretmek için). */
export interface ProviderStoredCard {
  providerCustomerKey: string;
  providerCardToken: string;
  bin: string | null;
  last4: string;
  brand: string | null;
  holderName: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/** `PaymentProvider.chargeStoredCard` (MIT / NON3D) sonucu. */
export interface ProviderChargeResult {
  ok: boolean;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  raw?: unknown;
}

/** `PaymentProvider.refund` sonucu. */
export interface ProviderRefundResult {
  ok: boolean;
  providerRefundId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  raw?: unknown;
}

/** `PaymentProvider.verifyWebhook(raw, signature)` — imza + ayrıştırılmış olay kimliği (WebhookEvent unique anahtarı için). */
export interface WebhookVerification {
  valid: boolean;
  eventType: string | null;
  /** Sağlayıcı olay/ödeme referansı (`@@unique(provider,eventType,providerRef)` bileşeni). */
  providerRef: string | null;
  payload: unknown;
  error: string | null;
}

/** `PaymentsService.recordWebhookEvent` sonucu — ikinci teslim `duplicate: true` + `IGNORED` (state-machines §4). */
export interface WebhookRecordResult {
  id: Id;
  status: WebhookStatus;
  duplicate: boolean;
}

/** `MerchantInitiatedCharge.charge(...)` sonucu — Payment yazıldı, sağlayıcı yanıtı alındı; cycle/Order geçişleri ÇAĞIRANIN (state-machines §8). */
export interface MitChargeOutcome {
  status: 'SUCCEEDED' | 'FAILED';
  paymentId: Id;
  conversationId: string;
  amount: Money;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

/** `PaymentLinkCharge.issue(...)` sonucu — Payment(kind LINK) yazıldı; cycle → AWAITING_PAYMENT geçişi ÇAĞIRANIN. */
export interface PaymentLinkIssue {
  status: 'AWAITING_PAYMENT';
  paymentId: Id;
  conversationId: string;
  amount: Money;
  /** 32 hex (16 rastgele bayt) — `GET /pay/:linkToken`. */
  linkToken: string;
  linkUrl: string;
  linkExpiresAt: IsoDateTime;
}

/** `ChargeStrategyResolver.for(subscription)` kararı: saklı kart yoksa MERCHANT_INITIATED → PAYMENT_LINK'e düşer (state-machines §14 #10). */
export interface ChargeStrategyDecision {
  kind: ChargeStrategy;
  /** Abonelikte istenen strateji ile farklıysa neden (ör. `NO_STORED_CARD`). */
  fallbackReason: 'NO_STORED_CARD' | null;
}

/** Public `GET /pay/:linkToken` (F7: JSON; F8: iyzico CF sayfası). Bilinmeyen token 404. */
export interface PaymentLinkInfo {
  status: PaymentStatus;
  amount: Money;
  /** Link son geçerlilik anı; yoksa null. */
  expiresAt: IsoDateTime | null;
  /** `expiresAt <= now` ya da Payment EXPIRED. */
  expired: boolean;
  orderNo: number;
}
