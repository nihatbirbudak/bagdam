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

/** `initCheckout` için Order özeti — sağlayıcıya giden alanlar (PSP'ye kart verisi gitmez, yalnız tutar + müşteri). */
export interface ProviderOrderInput {
  orderId: string;
  orderNo: number;
  /** TL, KDV dahil. */
  amount: Money;
  customer: { id: string | null; email: string; name: string; phone: string };
  description?: string;
}

export interface InitCheckoutOptions {
  /** Payment.conversationId (idempotency). */
  conversationId: string;
  /** Sağlayıcının 3DS/CF sonrası döneceği URL (`POST /payments/iyzico/callback`, F8). */
  callbackUrl: string;
  /** Kart saklansın mı (abonelik checkout'u: registerCard). */
  saveCard?: boolean;
  /** Sağlayıcıdaki müşteri anahtarı (iyzico cardUserKey) — varsa saklı kart listesi gösterilir. */
  customerKey?: string | null;
  ip?: string | null;
}

/** Saklı kart referansı (PaymentMethod satırı) — MIT tahsilat için yeterli alanlar. */
export interface StoredCardRef {
  id: string;
  providerCustomerKey: string;
  providerCardToken: string;
  last4: string;
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
 * PaymentProvider — ödeme sağlayıcısı soyutlaması (ADR-0010). Uygulamalar: `ManualProvider` (test/geliştirme; F7),
 * `IyzicoProvider` (F8: Checkout Form init/retrieve, registerCard, saklı karttan NON3D `chargeStoredCard`, iade, webhook HMAC).
 * Sağlayıcı HİÇBİR DB yazımı yapmaz; Payment/Refund/WebhookEvent satırları PaymentsService'te (ADR-0002).
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Prisma `PaymentProvider` enum karşılığı (Payment.provider / PaymentMethod.provider). */
  readonly enumValue: PaymentProviderEnum;

  /** Checkout Form / ödeme oturumu başlatır → providerToken + (CF içeriği | yönlendirme URL'si). */
  initCheckout(order: ProviderOrderInput, opts: InitCheckoutOptions): Promise<ProviderCheckoutInit>;

  /** Sağlayıcıdaki sonucu sorgular (callback doğrulama / `payments:reconcile`). */
  retrieve(token: string): Promise<ProviderRetrieveResult>;

  /** Saklı karttan tahsilat (merchant-initiated, NON3D) — `cycles:lock-and-charge`, `payments:retry`, admin charge. */
  chargeStoredCard(paymentMethod: StoredCardRef, amount: Money, conversationId: string): Promise<ProviderChargeResult>;

  /** Tam ya da kısmi iade (admin `POST /admin/payments/:id/refund`, iptal akışı). */
  refund(payment: RefundRef, amount: Money): Promise<ProviderRefundResult>;

  /** Webhook ham gövdesi + imza → geçerlilik + olay kimliği (WebhookEvent unique anahtarı: eventType + providerRef). */
  verifyWebhook(raw: Buffer | string, signature: string | null | undefined): WebhookVerification;
}
