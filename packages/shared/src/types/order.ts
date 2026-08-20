// ── Sipariş / ödeme DTO'ları ─────────────────────────────────────────────────
import type {
  BillingParty,
  DeliveryDay,
  OrderKind,
  OrderLineKind,
  OrderStatus,
  PaymentKind,
  PaymentProvider,
  PaymentStatus,
  WebhookStatus,
} from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDate, IsoDateTime } from './common';
import type { AddressSnapshot } from './user';

/** OrderLine.metadata (BOX satırı): kutu içeriği snapshot'ı. */
export interface OrderLineBoxMetadata {
  items: Array<{
    productId: Id;
    slug?: string;
    name: string;
    pref: string | null;
    boxAmount: string | null;
    lotCode: string | null;
  }>;
}

export interface OrderLine {
  id: Id;
  orderId: Id;
  kind: OrderLineKind;
  productId: Id | null;
  productSlug?: string | null;
  tierSlug: string | null;
  name: string;
  unit: string | null;
  /** EXTRA: ürün fiyatının çarpanı (factor); PRODUCT: adet; BOX: 1. */
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
  vatRate: number;
  pref: string | null;
  lotCode: string | null;
  metadata: OrderLineBoxMetadata | Record<string, unknown> | null;
}

/** Order — ödendikten sonra DEĞİŞMEZ (snapshot) [B25]. */
export interface Order {
  id: Id;
  orderNo: number;
  kind: OrderKind;
  status: OrderStatus;
  userId: Id | null;
  subscriptionId: Id | null;
  customerName: string;
  /** = User.email (checkout'ta readonly) [B15]. */
  customerEmail: string;
  customerPhone: string;
  zoneId: Id | null;
  deliveryDateId: Id | null;
  deliveryDay: DeliveryDay;
  deliveryOn: IsoDate;
  addressSnapshot: AddressSnapshot;
  billingParty: BillingParty;
  billingName: string | null;
  billingTaxNo: string | null;
  billingTaxOffice: string | null;
  subtotal: Money;
  /** İlk-kutu %50 / retention — grandTotal'a YANSIR. */
  discountTotal: Money;
  shippingFee: Money;
  vatTotal: Money;
  grandTotal: Money;
  couponCode: string | null;
  paidAt: IsoDateTime | null;
  invoiceNo: string | null;
  invoicePdfPath: string | null;
  note: string | null;
  /** Telafi (ayıplı ürün) kaydı MVP'de burada [B19]. */
  adminNote: string | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  lines: OrderLine[];
  payments?: Payment[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `GET /me/orders` ve admin liste satırı. */
export interface OrderSummary {
  id: Id;
  orderNo: number;
  kind: OrderKind;
  status: OrderStatus;
  customerName?: string;
  customerEmail?: string;
  deliveryDay: DeliveryDay;
  deliveryOn: IsoDate;
  grandTotal: Money;
  lineCount: number;
  paidAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** `GET /orders/:orderNo/status` — sepet.html `?siparis=` sonucu. */
export interface OrderStatusResponse {
  orderNo: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus | null;
  /** Abonelik siparişiyse aboneliğin durumu (uyelik yönlendirmesi için). */
  subscriptionId: Id | null;
}

/** Admin `PATCH /admin/orders/:id/status`. */
export interface OrderStatusPatch {
  status: OrderStatus;
  /** CANCELLED/REFUNDED için zorunlu kısa neden. */
  reason?: string;
}
/** Admin `PATCH /admin/orders/:id/invoice`. */
export interface OrderInvoicePatch {
  invoiceNo: string | null;
  invoicePdfPath?: string | null;
}
/** Admin `PATCH /admin/orders/:id/billing` — kurumsal fatura alanları (şema-var/UI: admin) [B20]. */
export interface OrderBillingPatch {
  billingParty: BillingParty;
  billingName?: string | null;
  billingTaxNo?: string | null;
  billingTaxOffice?: string | null;
}

/** PaymentMethod — yalnız PSP token'ı; kart verisi bizde yok (ADR-0010). `GET /me/cards`. */
export interface PaymentMethod {
  id: Id;
  provider: PaymentProvider;
  bin: string | null;
  last4: string;
  brand: string | null;
  holderName: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: IsoDateTime;
}

export interface Payment {
  id: Id;
  orderId: Id;
  orderNo?: number;
  provider: PaymentProvider;
  kind: PaymentKind;
  /** Idempotency anahtarı (`chk_<orderId>`, `cyc_<cycleId>_<attemptNo>` …). */
  conversationId: string;
  providerPaymentId: string | null;
  paymentMethodId: Id | null;
  amount: Money;
  status: PaymentStatus;
  is3ds: boolean;
  isMerchantInitiated: boolean;
  /** PAYMENT_LINK stratejisi — `GET /pay/:linkToken` [B27]; müşteriye yalnız URL döner. */
  linkExpiresAt: IsoDateTime | null;
  attemptNo: number;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: IsoDateTime | null;
  refunds?: Refund[];
  createdAt: IsoDateTime;
}

export interface Refund {
  id: Id;
  paymentId: Id;
  amount: Money;
  reason: string | null;
  providerRefundId: string | null;
  status: PaymentStatus;
  requestedBy: Id | null;
  createdAt: IsoDateTime;
}

/** Admin `POST /admin/payments/:id/refund`. */
export interface RefundRequest {
  amount: Money;
  reason?: string;
}

export interface WebhookEvent {
  id: Id;
  provider: PaymentProvider;
  eventType: string;
  providerRef: string;
  signatureValid: boolean;
  status: WebhookStatus;
  error: string | null;
  receivedAt: IsoDateTime;
  processedAt: IsoDateTime | null;
}

// ── Checkout ─────────────────────────────────────────────────────────────────

/** Sepet satırı (localStorage `bahceden_cart` öğesi) — tekil ürün. */
export interface CartLineInput {
  /** Product.slug. */
  id: string;
  qty: number;
  pref?: string | null;
}

/** Sepetteki kutu taslağı (cart.js sub: active && !purchased). */
export interface CartBoxInput {
  tierId: string;
  type: 'subscription' | 'onetime';
  freq: string;
  deliveryDay: string | null;
  items: string[];
  itemPrefs: Record<string, string>;
  extras: Array<{ id: string; factor: number; label: string }>;
}

/**
 * Cart (DB `carts`) — üye sepeti; şema-var/kullanım P2 (ADR-0016 "üye sepeti merge"; `GET/PUT /me/cart` P2).
 * `items` = CartLineInput[] · `boxDraft` = CartBoxInput | null (localStorage `bahceden_cart` / `bahceden_sub` taslağının DB kopyası).
 */
export interface Cart {
  id: Id;
  userId: Id;
  items: CartLineInput[];
  boxDraft: CartBoxInput | null;
  updatedAt: IsoDateTime;
}

/** `POST /checkout/quote` — fiyat özeti (PricingService tek kaynak). */
export interface CheckoutQuoteRequest {
  lines: CartLineInput[];
  box?: CartBoxInput | null;
  zoneId?: Id | null;
  deliveryDateId?: Id | null;
}

export interface QuoteLine {
  kind: OrderLineKind;
  ref: string;
  name: string;
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
  vatRate: number;
}

export interface CheckoutQuote {
  kind: OrderKind;
  lines: QuoteLine[];
  subtotal: Money;
  discountTotal: Money;
  discountLabel: string | null;
  shippingFee: Money;
  vatTotal: Money;
  grandTotal: Money;
  /** Abonelik cycle#1 peşin tutarı (= grandTotal'ın kutu kısmı). */
  prepaidAmount: Money | null;
}

/** `POST /checkout` — `$transaction`: doğrula → DeliveryDate rezerv → Order [+ Subscription PENDING + cycle#1] → Payment → CF init. */
export interface CheckoutRequest extends CheckoutQuoteRequest {
  addressId: Id;
  deliveryDateId: Id;
  consents: Array<{ kind: string; documentId?: Id | null; granted: boolean }>;
  note?: string;
  /** Saklı kartla ödeme (yoksa Checkout Form). */
  paymentMethodId?: Id | null;
  saveCard?: boolean;
}

export interface CheckoutResponse {
  orderNo: number;
  orderId: Id;
  paymentId: Id;
  /** iyzico Checkout Form içeriği (ADR-0003 istisna 1) — ManualProvider'da null. */
  checkoutFormContent: string | null;
  /** Saklı kartla anında başarıysa doğrudan PAID. */
  status: OrderStatus;
}

// ── F7/B2 ekleri (OrdersModule) — yalnız EKLEME (BACKEND-PLANI §3 checkout/orders satırı; docs/state-machines.md §1) ──

/** Order.deliveryOn/paidAt vb. okunurken kullanılan aktör — SubscriptionEvent.actor ile aynı küme (USER | SYSTEM | ADMIN | OPS | PSP). */
export type OrderActor = 'USER' | 'SYSTEM' | 'ADMIN' | 'OPS' | 'PSP';

/**
 * Sipariş satırı snapshot girdisi — `OrdersService.createFromQuote(input).lines[]`.
 * PricedLine (shared computeQuote çıktısı) + snapshot alanları: `name` zorunlu, `unit/lotCode/metadata` isteğe bağlı.
 * EXTRA: `qty` = çarpan (factor), `lineTotal` tam TL; BOX: `tierSlug` dolu, `metadata.items` kutu içeriği; PRODUCT: adet.
 */
export interface OrderLineSnapshotInput {
  kind: OrderLineKind;
  productId?: Id | null;
  tierSlug?: string | null;
  name: string;
  unit?: string | null;
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
  vatRate: number;
  pref?: string | null;
  lotCode?: string | null;
  metadata?: OrderLineBoxMetadata | Record<string, unknown> | null;
}

/** `GET /me/orders` — F7/B2: gerçek veri (`MeOrderList` ile aynı zarf; `items` artık OrderSummary). */
export interface MeOrderListResponse {
  items: OrderSummary[];
  total: number;
}

/** Admin `GET /admin/orders?status&kind&from&to&deliveryOn&q&page&limit` sorgusu (from/to: createdAt, Europe/Istanbul takvim günü, dahil). */
export interface AdminOrderListQuery {
  status?: OrderStatus;
  kind?: OrderKind;
  from?: IsoDate;
  to?: IsoDate;
  /** Teslimat günü (YYYY-MM-DD) — ops günü filtresi. */
  deliveryOn?: IsoDate;
  /** orderNo (sayı) ya da ad/e-posta/telefon içerir. */
  q?: string;
  page?: number;
  limit?: number;
}

/** Admin `GET /admin/orders` zarfı (liste satırı OrderSummary + müşteri alanları dolu). */
export interface AdminOrderList {
  items: OrderSummary[];
  total: number;
  page: number;
  limit: number;
}

/** Admin `POST /admin/orders/:id/notes {adminNote}` — nota zaman damgalı satır EKLENİR (silinmez; telafi kaydı da burada [B19]). */
export interface OrderNoteRequest {
  adminNote: string;
}

/** Müşteri `POST /orders/:orderNo/cancel {reason?}` — yalnız PENDING_PAYMENT | PAID | PAYMENT_FAILED ve kesimden önce (abonelik siparişi: /me/subscription/cancel). */
export interface OrderCancelRequest {
  reason?: string;
}

/**
 * Orders hata kodları (409/400/404 `{error}`):
 * DAY_FULL · DAY_LOCKED · ORDER_TRANSITION_INVALID · ORDER_STATE_CHANGED · ORDER_NOT_FOUND · ORDER_CUTOFF_PASSED ·
 * ORDER_NOT_CANCELLABLE · ORDER_SUBSCRIPTION_MANAGED · ORDER_REASON_REQUIRED · ORDER_EMPTY · ZONE_MISMATCH ·
 * CYCLE_NOT_FOUND · CYCLE_ORDER_EXISTS · CYCLE_DELTA_EXISTS · DELTA_NOTHING_DUE · BILLING_CORPORATE_FIELDS_REQUIRED
 */
export type OrdersErrorCode =
  | 'DAY_FULL'
  | 'DAY_LOCKED'
  | 'ORDER_TRANSITION_INVALID'
  | 'ORDER_STATE_CHANGED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_CUTOFF_PASSED'
  | 'ORDER_NOT_CANCELLABLE'
  | 'ORDER_SUBSCRIPTION_MANAGED'
  | 'ORDER_REASON_REQUIRED'
  | 'ORDER_EMPTY'
  | 'ZONE_MISMATCH'
  | 'CYCLE_NOT_FOUND'
  | 'CYCLE_ORDER_EXISTS'
  | 'CYCLE_DELTA_EXISTS'
  | 'DELTA_NOTHING_DUE'
  | 'BILLING_CORPORATE_FIELDS_REQUIRED';
