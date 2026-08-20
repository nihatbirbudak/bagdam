import type {
  Money,
  PaymentProvider as PaymentProviderEnum,
  PaymentProviderName,
  ProviderChargeResult,
  ProviderCheckoutInit,
  ProviderPaymentLink,
  ProviderPaymentLinkInput,
  ProviderRefundResult,
  ProviderRetrieveResult,
  WebhookVerification,
} from '@bagdam/shared';

/** `initCheckout` için Order özeti — sağlayıcıya giden alanlar (PSP'ye kart verisi gitmez, yalnız tutar + müşteri). */
export interface ProviderOrderInput {
  orderId: string;
  orderNo: number;
  /** TL, KDV dahil. */
  amount: Money;
  customer: { id: string | null; email: string; name: string; phone: string };
  description?: string;
}

/** Sağlayıcıya giden sepet satırı (PayTR `user_basket` [[ad, birim fiyat, adet]]). */
export interface ProviderBasketItem {
  name: string;
  /** Birim fiyat TL. */
  unitPrice: Money;
  qty: number;
}

export interface InitCheckoutOptions {
  /** Payment.conversationId (idempotency; PayTR merchant_oid — yalnız [A-Za-z0-9], B: `ord<orderNo><rastgele4>`). */
  conversationId: string;
  /** Sağlayıcının sonuç bildirdiği URL (PayTR: panelde tanımlı bildirim URL'si — `POST /payments/paytr/callback`; bilgi amaçlı). */
  callbackUrl: string;
  /** Kart saklansın mı (abonelik checkout'u; PayTR: store_card=1 — yalnız Setting payment.storedCardEnabled açıkken gönderilir). */
  saveCard?: boolean;
  /** Sağlayıcıdaki müşteri anahtarı (PayTR utoken) — varsa aynı kullanıcıya kart eklenir. */
  customerKey?: string | null;
  /** Müşteri IP'si (PayTR user_ip zorunlu; X-Forwarded-For / req.ip). */
  ip?: string | null;
  /** Sepet satırları (PayTR user_basket); yoksa tek satır "Sipariş #<no>" = tutar. */
  basket?: ProviderBasketItem[];
  /** Teslimat adresi metni (PayTR user_address, ≤400). */
  address?: string | null;
  /** Başarı/başarısızlık dönüş URL'leri; yoksa WEB_URL/sepet.html?siparis=<no>&odeme=ok|hata. */
  okUrl?: string;
  failUrl?: string;
}

/** Saklı kart referansı (PaymentMethod satırı) — MIT tahsilat için yeterli alanlar (+ PayTR'nin istediği müşteri bilgisi). */
export interface StoredCardRef {
  id: string;
  /** PayTR utoken. */
  providerCustomerKey: string;
  /** PayTR ctoken. */
  providerCardToken: string;
  last4: string;
  /** Kart sahibi e-postası (PayTR kayıtlı kart ödemesinde zorunlu; MerchantInitiatedCharge PaymentMethod.user'dan doldurur). */
  email?: string | null;
  holderName?: string | null;
  /** Müşteri IP'si biliniyorsa (PayTR user_ip); sunucu başlatmalı tahsilatta yoksa 127.0.0.1. */
  ip?: string | null;
}

/** İade için Payment referansı. */
export interface RefundRef {
  id: string;
  conversationId: string;
  providerPaymentId: string | null;
  /** Ödemenin toplam tutarı (TL). */
  amount: Money;
}

/**
 * PaymentProvider — ödeme sağlayıcısı soyutlaması (ADR-0010/0019). Uygulamalar: `ManualProvider` (test/geliştirme; F7),
 * `PayTrProvider` (F8: iFrame token init, Durum Sorgu retrieve, kayıtlı karttan NON3D `chargeStoredCard` (recurring), İade API,
 * bildirim hash doğrulaması, Link API `createPaymentLink`). iyzico P2 (aynı arayüz).
 * Sağlayıcı HİÇBİR DB yazımı yapmaz; Payment/Refund/WebhookEvent satırları PaymentsService'te (ADR-0002).
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Prisma `PaymentProvider` enum karşılığı (Payment.provider / PaymentMethod.provider). */
  readonly enumValue: PaymentProviderEnum;

  /** Checkout Form / ödeme oturumu başlatır → providerToken + (CF/iframe içeriği | yönlendirme URL'si). */
  initCheckout(order: ProviderOrderInput, opts: InitCheckoutOptions): Promise<ProviderCheckoutInit>;

  /** Sağlayıcıdaki sonucu sorgular (callback doğrulama / `payments:reconcile`). PayTR: ref = merchant_oid (Payment.conversationId). */
  retrieve(ref: string): Promise<ProviderRetrieveResult>;

  /**
   * Saklı karttan tahsilat (merchant-initiated, NON3D) — `cycles:lock-and-charge`, `payments:retry`, admin charge.
   * Özellik kapalı/onaysızsa (PayTR Setting payment.storedCardEnabled=false) 503 `PROVIDER_FEATURE_DISABLED` fırlatır.
   */
  chargeStoredCard(paymentMethod: StoredCardRef, amount: Money, conversationId: string): Promise<ProviderChargeResult>;

  /** Tam ya da kısmi iade (admin `POST /admin/payments/:id/refund`, iptal akışı). */
  refund(payment: RefundRef, amount: Money): Promise<ProviderRefundResult>;

  /** Webhook ham gövdesi + imza → geçerlilik + olay kimliği (WebhookEvent unique anahtarı: eventType + providerRef). */
  verifyWebhook(raw: Buffer | string, signature: string | null | undefined): WebhookVerification;

  /** Ödeme linki (PAYMENT_LINK stratejisi — PayTR Link API). Desteklemeyen sağlayıcıda yok (`/pay/:linkToken` sayfası yerel JSON/iframe). */
  createPaymentLink?(input: ProviderPaymentLinkInput): Promise<ProviderPaymentLink>;

  /** Ödeme linkini iptal eder (süre dolumu / sipariş iptali). */
  deletePaymentLink?(linkId: string): Promise<boolean>;
}
