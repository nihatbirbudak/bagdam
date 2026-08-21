// ── Ödeme sağlayıcısı / tahsilat stratejisi DTO'ları (F7 — apps/api modules/payments sözleşmesi; F8 PayTR) ─────────
// Kaynak: BACKEND-PLANI §3 payments satırı, ADR-0006 (ikili strateji), ADR-0010 (PaymentProvider arayüzü, ManualProvider),
// ADR-0019 (PayTR birincil; iyzico P2), docs/state-machines.md §4 (Payment) ve §8 adım 6. Burada yalnız saf tipler;
// Order/Payment/Refund/WebhookEvent DTO'ları `types/order.ts` içindedir (tekrar tanımlanmaz). PayTR adaptörü (F8) aynı tipleri doldurur.
import type { ChargeStrategy, PaymentProvider, PaymentStatus, WebhookStatus } from '../enums';
import type { Id, IsoDate, IsoDateTime } from './common';
import type { Money } from './pricing';

/**
 * Sağlayıcı adı (Setting `payment.provider` / env `PAYMENT_PROVIDER`): `manual` test/geliştirme · `paytr` birincil (ADR-0019, F8) ·
 * `iyzico` P2 (adaptör yok; seçilirse 503 PAYMENT_PROVIDER_UNAVAILABLE).
 */
export type PaymentProviderName = 'manual' | 'paytr' | 'iyzico';
export const PAYMENT_PROVIDER_NAMES: readonly PaymentProviderName[] = ['manual', 'paytr', 'iyzico'];

/** Sağlayıcı adı ↔ Prisma `PaymentProvider` enum'u. */
export const PAYMENT_PROVIDER_ENUM_BY_NAME: Readonly<Record<PaymentProviderName, PaymentProvider>> = {
  manual: 'MANUAL',
  paytr: 'PAYTR',
  iyzico: 'IYZICO',
};
export function paymentProviderNameFromEnum(value: PaymentProvider): PaymentProviderName | null {
  if (value === 'MANUAL') return 'manual';
  if (value === 'PAYTR') return 'paytr';
  if (value === 'IYZICO') return 'iyzico';
  return null;
}

/**
 * `PaymentProvider.initCheckout` sonucu — PayTR: `providerToken` = iFrame token'ı, `checkoutFormContent` = iframe HTML parçası
 * (ADR-0003 istisna 1 konteynerine basılır), `redirectUrl` = https://www.paytr.com/odeme/guvenli/<token>; manuel sağlayıcıda ikisi de null.
 */
export interface ProviderCheckoutInit {
  providerToken: string;
  redirectUrl: string | null;
  checkoutFormContent: string | null;
}

/** `PaymentProvider.retrieve(ref)` — sağlayıcıdaki güncel sonuç (callback/reconcile). PayTR: ref = merchant_oid (Durum Sorgu API). */
export interface ProviderRetrieveResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  providerPaymentId: string | null;
  /** Saklanan kart (registerCard / store_card) — PayTR utoken/ctoken; yoksa null. */
  storedCard: ProviderStoredCard | null;
  failureCode: string | null;
  failureMessage: string | null;
  raw: unknown;
}

/** Sağlayıcının döndürdüğü saklı kart özeti (PaymentMethod satırı üretmek için). PayTR: providerCustomerKey = utoken, providerCardToken = ctoken. */
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
  /** Sağlayıcı olay/ödeme referansı (`@@unique(provider,eventType,providerRef)` bileşeni). PayTR: `<merchant_oid>:<status>`. */
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

/**
 * `ChargeStrategyResolver` kararı: saklı kart yoksa MERCHANT_INITIATED → PAYMENT_LINK'e düşer (state-machines §14 #10);
 * F8: aktif sağlayıcı PayTR ve Setting `payment.storedCardEnabled=false` (kayıtlı kart/tekrarlayan tahsilat onayı yok) → PAYMENT_LINK
 * (`STORED_CARD_DISABLED`, ADR-0019).
 */
export interface ChargeStrategyDecision {
  kind: ChargeStrategy;
  /** Abonelikte istenen strateji ile farklıysa neden. */
  fallbackReason: 'NO_STORED_CARD' | 'STORED_CARD_DISABLED' | null;
}

/** Public `GET /pay/:linkToken` (F7: JSON; F8: PayTR ödeme linki/iframe sayfası). Bilinmeyen token 404. */
export interface PaymentLinkInfo {
  status: PaymentStatus;
  amount: Money;
  /** Link son geçerlilik anı; yoksa null. */
  expiresAt: IsoDateTime | null;
  /** `expiresAt <= now` ya da Payment EXPIRED. */
  expired: boolean;
  orderNo: number;
}

// ── F8: sağlayıcı ödeme linki (PAYMENT_LINK stratejisi — PayTR Link API; ADR-0019) ─────────────────────────────────

/** `PayTrProvider.createPaymentLink(...)` girdisi — tutar TL, `conversationId` = Payment.conversationId (callback_id olarak döner). */
export interface ProviderPaymentLinkInput {
  amount: Money;
  /** Link başlığı (PayTR: 4–200 karakter). */
  name: string;
  conversationId: string;
  /** Linkin son geçerlilik anı (yoksa süresiz). */
  expiresAt?: Date | null;
  /** Ödeyen e-postası (PayTR collection linkinde zorunlu). */
  email?: string | null;
}

export interface ProviderPaymentLink {
  /** Sağlayıcı link kimliği (PayTR `id`; silme/iptal için). */
  linkId: string;
  /** Müşteriye gösterilen ödeme URL'si (302 ya da iframe src). */
  url: string;
  raw?: unknown;
}

/** Sağlayıcı özelliği kapalı/onaysız (ör. PayTR kayıtlı kart onayı yok) — 503 zarfı `error` kodu. */
export const PROVIDER_FEATURE_DISABLED = 'PROVIDER_FEATURE_DISABLED';

// ── F9 ekleri (ekran 18 "Ödeme Problemleri") — yalnız EKLEME ──────────────────────────────────────────────────
// Birleşik liste: PAYMENT_FAILED siparişler + UNPAID / AWAITING_PAYMENT abonelik cycle'ları.
// Eylemler ayrı uçlarda: POST /admin/cycles/:id/charge · POST /admin/cycles/:id/send-payment-link ·
// PATCH /admin/orders/:id/status · POST /admin/orders/:id/notes (müşteriye not).

export const PAYMENT_ISSUE_KINDS = ['ORDER', 'CYCLE'] as const;
export type PaymentIssueKind = (typeof PAYMENT_ISSUE_KINDS)[number];

/** `GET /admin/payment-issues` satırı — sipariş ya da cycle kaynaklı tek bir tahsilat sorunu. */
export interface PaymentIssueItem {
  kind: PaymentIssueKind;
  /** Satır kimliği: ORDER → orderId, CYCLE → cycleId. */
  id: Id;
  orderId: Id | null;
  orderNo: number | null;
  cycleId: Id | null;
  cycleNo: number | null;
  subscriptionId: Id | null;
  /** OrderStatus (ORDER) ya da CycleStatus (CYCLE). */
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Tahsil edilemeyen tutar (sipariş grandTotal'ı). */
  amount: Money;
  deliveryOn: IsoDate | null;
  /** Dunning: kaçıncı deneme ve sıradaki deneme anı (cycle satırlarında). */
  retryCount: number;
  nextRetryAtIso: IsoDateTime | null;
  /** PAYMENT_LINK: linkin son geçerlilik anı. */
  paymentDueAtIso: IsoDateTime | null;
  /** Açık ödeme linki (varsa) — "ödeme linki gönder" sonrası dolar. */
  paymentLinkUrl: string | null;
  /** Son başarısız denemenin sağlayıcı kodu/mesajı. */
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastAttemptAtIso: IsoDateTime | null;
  /** Saklı kart var mı (yeniden çekim mümkün mü). */
  hasCard: boolean;
  /** Abonelik PAST_DUE bayrağı. */
  subscriptionStatus: string | null;
  failedCycles: number;
  createdAtIso: IsoDateTime;
}

export interface PaymentIssueCounts {
  failedOrders: number;
  unpaidCycles: number;
  awaitingPaymentCycles: number;
  total: number;
}

/** `GET /admin/payment-issues?kind=&q=&page=&limit=` yanıtı. */
export interface PaymentIssueList {
  items: PaymentIssueItem[];
  total: number;
  page: number;
  limit: number;
  counts: PaymentIssueCounts;
}
