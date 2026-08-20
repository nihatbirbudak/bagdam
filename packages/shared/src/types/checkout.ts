// ── Checkout DTO'ları (F8 — apps/api modules/checkout sözleşmesi) ───────────────────────────────────────────────
// Kaynak: BACKEND-PLANI §3 checkout/orders satırı, ADR-0003 (istisna 1/3), ADR-0006 (cycle#1 peşin), ADR-0019 (PayTR iFrame),
// docs/state-machines.md §1/§2/§4. `POST /checkout/quote` (misafir) ve `POST /checkout` (oturumlu) bu tipleri alır/döner.
// Fiyat HİÇBİR ZAMAN istemciden gelmez: satırlar slug + adet/çarpan olarak gelir, api katalogdan çözer (P1 kuralı).
// Eski `CheckoutQuoteRequest/CheckoutRequest/CheckoutResponse` (types/order.ts, F2 taslağı) korunur; F8 uçları BU tipleri kullanır.
import type { ConsentKind, DeliveryDaySlug, OrderStatus, PaymentProvider, PaymentStatus } from '../enums';
import type { Id, IsoDate, IsoDateTime } from './common';
import type { CouponRejectReason } from './coupon';
import type { Money, PricingNote, PricingResult } from './pricing';
import type { FreqId } from './subscription';

/** Sepet satırı (localStorage `bahceden_cart` öğesi) — `id` Product.slug, `qty` adet (tam sayı ≥ 1), `pref` ürün tercihi. */
export interface CheckoutLineInput {
  id: string;
  qty: number;
  pref?: string | null;
}

/** Kutu ekstrası — cart.js `sub.extras[]` ile aynı (`id` ürün slug'ı, `factor` birim fiyat çarpanı, `label` görünen metin). */
export interface CheckoutExtraInput {
  id: string;
  factor: number;
  label?: string | null;
}

/**
 * Sepetteki kutu taslağı (cart.js `bahceden_sub` — `active && !purchased`).
 * `tier` BoxTier.slug; `items` kutu içeriği (slug'lar; yoksa haftanın yayınlanmış şablonu); `isOneTime` tek seferlik kutu;
 * `frequencyWeeks` (1|2|4) ya da `freq` ('1hafta'…); `deliveryDay` teslimat günü slug'ı (checkout'ta seçilen tarihin günüyle eşleşmeli).
 */
export interface CheckoutBoxInput {
  tier: string;
  items?: string[];
  itemPrefs?: Record<string, string>;
  extras?: CheckoutExtraInput[];
  isOneTime?: boolean;
  frequencyWeeks?: number;
  freq?: FreqId;
  deliveryDay?: DeliveryDaySlug | null;
}

/**
 * `POST /checkout/quote` gövdesi (@Public). Misafirde kullanıcı bağlamı yok (ilk-kutu hakkı var sayılır, abone değil);
 * oturumluysa userId'den çözülür. `zoneSlug` yoksa: oturumlu kullanıcının varsayılan adres bölgesi → yoksa `urla`.
 */
export interface CheckoutQuoteInput {
  lines?: CheckoutLineInput[];
  box?: CheckoutBoxInput | null;
  zoneSlug?: string | null;
  couponCode?: string | null;
  /** cart.js `sub.skipThisWeek` — BOX/EXTRA 0 TL (yalnız canlı abonelik önizlemesi; checkout'ta yok sayılır). */
  skipThisWeek?: boolean;
}

/** Kupon durumu — quote yanıtında (`couponStatus`); geçersizse `valid:false` + Türkçe `message` + makine `reason`. */
export interface CheckoutCouponStatus {
  code: string;
  valid: boolean;
  /** UI'da doğrudan basılabilir Türkçe metin ("Kupon uygulandı: −50 TL" / "Kuponun süresi dolmuş"). */
  message: string;
  /** Uygulanan indirim (TL); geçersizse 0. */
  discount: Money;
  reason: CouponRejectReason | null;
}

/** Quote'a eklenen bölge özeti (kargo kuralı görünsün diye). */
export interface CheckoutQuoteZone {
  id: Id;
  slug: string;
  name: string;
  fee: Money;
  freeThreshold: Money | null;
}

/**
 * `POST /checkout/quote` yanıtı = shared `PricingResult` (subtotal/discountTotal/shippingFee/vatTotal/grandTotal/prepaidAmount/lines/notes)
 * + bölge + kupon durumu + `requiresAck` belge listesi (checkout'ta gösterilecek onay kutuları — ADR-0003 istisna 3).
 * `discountTotal` kupon indirimini de içerir; `prepaidAmount` (cycle#1 peşin) KUPONSUZ kutu+ekstra−ilk-kutu indirimi (motor tutarlılığı).
 */
export interface CheckoutQuoteResponse extends PricingResult {
  zone: CheckoutQuoteZone;
  couponStatus: CheckoutCouponStatus | null;
  /** Checkout'ta onaylanması gereken yayındaki belgeler (PREINFO/DISTANCE_SALES [+ SUBSCRIPTION_CONTRACT abonelikte]). */
  requiredConsents: CheckoutRequiredConsent[];
}

/** Checkout'ta zorunlu onay — `GET /legal` belgesinin özeti + karşılık gelen Consent türü. */
export interface CheckoutRequiredConsent {
  kind: Extract<ConsentKind, 'PREINFO_ACK' | 'CONTRACT_ACK' | 'SUBSCRIPTION_CONTRACT_ACK'>;
  documentSlug: string;
  version: number;
  title: string;
}

/** `POST /checkout` gövdesindeki onay öğesi — belge slug'ı + onaylanan sürüm (yayındaki sürümle aynı olmalı). */
export interface CheckoutConsentInput {
  kind: Extract<ConsentKind, 'PREINFO_ACK' | 'CONTRACT_ACK' | 'SUBSCRIPTION_CONTRACT_ACK'>;
  documentSlug: string;
  version: number;
}

/**
 * `POST /checkout` gövdesi (oturumlu): quote girdisi + adres + teslimat günü + onaylar + (isteğe bağlı) saklı kart.
 * Teslimat günü: `deliveryDateId` (DeliveryDate.id) ya da `deliveryOn` (YYYY-MM-DD; `GET /delivery/dates` `date` alanı — bölge adresten).
 * `paymentMethodId` verilirse saklı karttan tahsilat (sağlayıcı desteklemiyorsa iFrame'e düşer); yoksa iFrame/redirect.
 */
export interface CheckoutInput extends CheckoutQuoteInput {
  addressId: Id;
  deliveryDateId?: Id;
  deliveryOn?: IsoDate;
  consents: CheckoutConsentInput[];
  note?: string;
  paymentMethodId?: Id | null;
  /** Abonelik checkout'unda kart saklama onayı (PayTR store_card); varsayılan: abonelikte true. */
  saveCard?: boolean;
}

/** Checkout ödeme bilgisi — iFrame içeriği (`checkoutFormContent`) ya da yönlendirme (`redirectUrl`); manuel sağlayıcıda ikisi de null. */
export interface CheckoutPaymentInfo {
  paymentId: Id;
  provider: PaymentProvider;
  /** Sağlayıcı adı (`manual` | `paytr` | …) — istemci "test ödeme onaylandı" görünümü için `manual`'a bakar. */
  providerName: string;
  status: PaymentStatus;
  /** Sağlayıcı oturum/iFrame token'ı (PayTR iframe token). */
  token: string | null;
  checkoutFormContent: string | null;
  redirectUrl: string | null;
  /** Payment.conversationId (PayTR merchant_oid) — teşhis/izleme. */
  conversationId: string;
}

/** `POST /checkout` yanıtı (201). `status` PAID ise ödeme anında tamamlandı (manuel ya da saklı kart). */
export interface CheckoutResult {
  orderNo: number;
  orderId: Id;
  status: OrderStatus;
  subscriptionId: Id | null;
  grandTotal: Money;
  payment: CheckoutPaymentInfo;
  notes: PricingNote[];
}

/** `GET /orders/:orderNo/status` yanıtı F8 genişletmesi — bkz. types/order.ts `OrderStatusResponse` (aynı DTO). */
export interface CheckoutStatusPoll {
  orderNo: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus | null;
  paidAt: IsoDateTime | null;
  subscriptionId: Id | null;
  subscriptionStatus: string | null;
}

/**
 * Checkout hata kodları (400/404/409 `{error}`):
 * CHECKOUT_EMPTY · PRODUCT_NOT_AVAILABLE · PREF_INVALID · TIER_INVALID · EXTRA_FACTOR_INVALID · ZONE_INVALID · ZONE_MISMATCH ·
 * ADDRESS_INVALID · DELIVERY_DATE_REQUIRED · DELIVERY_DATE_INVALID · DELIVERY_DAY_MISMATCH · DAY_LOCKED · DAY_FULL ·
 * CONSENT_REQUIRED · CONSENT_DOCUMENT_INVALID · CONSENT_DOCUMENT_OUTDATED · COUPON_INVALID · PAYMENT_METHOD_INVALID ·
 * SUBSCRIPTION_EXISTS · CHECKOUT_IN_PROGRESS · PAYMENT_INIT_FAILED · PAYMENTS_DISABLED · FREQUENCY_INVALID · DELIVERY_DAY_INVALID
 */
export type CheckoutErrorCode =
  | 'CHECKOUT_EMPTY'
  | 'PRODUCT_NOT_AVAILABLE'
  | 'PREF_INVALID'
  | 'TIER_INVALID'
  | 'EXTRA_FACTOR_INVALID'
  | 'ZONE_INVALID'
  | 'ZONE_MISMATCH'
  | 'ADDRESS_INVALID'
  | 'DELIVERY_DATE_REQUIRED'
  | 'DELIVERY_DATE_INVALID'
  | 'DELIVERY_DAY_MISMATCH'
  | 'DAY_LOCKED'
  | 'DAY_FULL'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_DOCUMENT_INVALID'
  | 'CONSENT_DOCUMENT_OUTDATED'
  | 'COUPON_INVALID'
  | 'PAYMENT_METHOD_INVALID'
  | 'SUBSCRIPTION_EXISTS'
  | 'CHECKOUT_IN_PROGRESS'
  | 'PAYMENT_INIT_FAILED'
  | 'PAYMENTS_DISABLED'
  | 'FREQUENCY_INVALID'
  | 'DELIVERY_DAY_INVALID';

/** `POST /me/cards/add-session` — PayTR'de ayrı kart ekleme akışı yok (kart ilk ödemede saklanır) → 501. */
export interface CardAddSessionUnavailable {
  message: string;
  error: 'NOT_IMPLEMENTED';
}

/** `payments:reconcile` job özeti (CronLog.details). */
export interface PaymentsReconcileResult {
  /** İncelenen açık checkout ödemesi. */
  checked: number;
  succeeded: number;
  failed: number;
  expired: number;
  /** Sağlayıcıda hâlâ bekleyen (24 s dolmamış). */
  stillPending: number;
  /** Ödemesiz kalmış eski siparişler (PENDING_PAYMENT|PAYMENT_FAILED > 24 s) → CANCELLED. */
  staleOrdersCancelled: number;
  errors: number;
}
