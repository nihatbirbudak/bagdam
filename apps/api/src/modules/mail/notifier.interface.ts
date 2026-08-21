import type { NotifierEvent } from '@bagdam/shared';

/**
 * Notifier arayüzü (ADR-0014 / BACKEND-PLANI F6): iş modülleri (auth, wholesale; F7+ subscriptions/orders) e-postayı
 * doğrudan değil, olay olarak bildirir — `notify(event, payload)`. Uygulama: MailNotifier (MailService);
 * F7'de stub/alternatif (SMS, WhatsApp P2) aynı arayüzü uygular. `notify` ASLA fırlatmaz: bildirim hatası iş isteğini
 * bozmaz (MailLog FAILED + log).
 */
export const NOTIFIER = Symbol('NOTIFIER');

/** Olay → yük eşlemesi (yeni olay eklerken buraya ve shared NotifierEvent'e ekle). */
export interface NotifierPayloads {
  'customer.welcome': { user: NotifierUser };
  'customer.verify': { user: NotifierUser; verifyUrl: string };
  'customer.reset': { user: NotifierUser; resetUrl: string; expiresMinutes: number };
  'customer.password-changed': { user: NotifierUser; changedAt: Date };
  'wholesale.new-lead': { lead: NotifierLead };
  /** F8: sipariş ödendi (OrdersService PAID yan etkisi) → `mail.order-paid` (sipariş özeti + yasal belge kopyası bağlantıları). */
  'order.paid': { order: NotifierOrder };
  // ── F10: teslimat olayları (OrdersService.transition yan etkisi; aynı NotifierOrder yükü) ──
  /** Order → OUT_FOR_DELIVERY → `mail.order-shipped`. */
  'order.shipped': { order: NotifierOrder };
  /** Order → DELIVERED → `mail.order-delivered`. */
  'order.delivered': { order: NotifierOrder };
  /** Order → DELIVERY_FAILED → `mail.order-delivery-failed`; `reason` ops notu (kurye). */
  'order.delivery-failed': { order: NotifierOrder; reason: string | null };
  // ── F10: abonelik motoru olayları (SubscriptionNotifier zenginleştirir; F7 stub yerine) ──
  /** Kutu tahsil edildi → `mail.cycle-charged`. */
  'cycle.charged': { cycle: NotifierCycle; amount: number; orderNo: number | null; isDelta: boolean };
  /** Tahsilat başarısız → `mail.cycle-payment-failed` (kart güncelle + varsa sıradaki deneme anı). */
  'cycle.payment-failed': { cycle: NotifierCycle; amount: number; failure: string | null; nextRetryAt: Date | null; attemptNo: number; isDelta: boolean };
  /** Ödeme linki üretildi → `mail.cycle-awaiting-payment`. */
  'cycle.awaiting-payment': { cycle: NotifierCycle; amount: number; payUrl: string; expiresAt: Date; attemptNo: number };
  /** Kesimden ~24 s önce → `mail.cutoff-reminder` (cycle başına BİR kez: MailService.sendOnce). */
  'subscription.cutoff-reminder': { cycle: NotifierCycle; cutoffAt: Date };
  /** İptal onaylandı → `mail.subscription-cancelled`. */
  'subscription.cancelled': { user: NotifierUser; subscriptionId: string; tierName: string; effectiveAt: Date; lastBoxOn: string | null; refundAmount: number; refundDueAt: Date | null };
  /** Üst üste başarısız tahsilat → abonelik PAST_DUE → `mail.subscription-past-due`. */
  'subscription.past-due': { user: NotifierUser; subscriptionId: string; tierName: string; failedCycles: number };
}

/** F10 kutu satırı (CycleItem) — MailNotifier `qtyText` metnini üretir. */
export interface NotifierCycleItem {
  name: string;
  qty: number;
  unit: string | null;
  pref: string | null;
  /** CycleItemSource: TEMPLATE | SWAP | EXTRA. */
  source: string;
}

/**
 * F10 abonelik kutusu bağlamı — SubscriptionNotifier tarafından cycle + subscription kaydından doldurulur;
 * MailNotifier yalnız biçimlendirir (tarih/para/etiket). Para alanları TL (number).
 */
export interface NotifierCycle {
  cycleId: string;
  cycleNo: number;
  subscriptionId: string;
  user: NotifierUser;
  tierName: string;
  /** YYYY-MM-DD */
  deliveryOn: string;
  /** DeliveryDaySlug (sali/persembe/cumartesi) ya da enum adı. */
  deliveryDay: string;
  addressLine: string;
  zoneName: string;
  items: NotifierCycleItem[];
  /** uyelik.html (müşteri hesap sayfası). */
  accountUrl: string;
  /** kutu.html?tier=<slug> (kutu düzenleme). */
  boxUrl: string;
}

/** F8 sipariş onayı e-postasının satırı. */
export interface NotifierOrderLine {
  kind: string;
  name: string;
  qty: number;
  unit: string | null;
  pref: string | null;
  lineTotal: number;
}

/** F8 sipariş onayı e-postasındaki yasal belge bağlantısı (onaylanan sürüm). */
export interface NotifierLegalDoc {
  slug: string;
  version: number;
  title: string;
  url: string;
}

/** F8 `order.paid` yükü — para alanları TL (number); MailNotifier tr-TR metne çevirir. */
export interface NotifierOrder {
  id: string;
  orderNo: number;
  kind: string;
  status: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  /** YYYY-MM-DD */
  deliveryOn: string;
  deliveryDay: string;
  addressLine: string;
  zoneName: string;
  lines: NotifierOrderLine[];
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  vatTotal: number;
  grandTotal: number;
  couponCode: string | null;
  isSubscription: boolean;
  isOneTimeBox: boolean;
  paidAt: Date;
  legalDocuments: NotifierLegalDoc[];
  /** Müşteri sipariş sayfası (uyelik.html). */
  orderUrl: string;
}

export interface NotifierUser {
  id: string;
  email: string;
  name: string | null;
}

export interface NotifierLead {
  id: string;
  email: string;
  businessName: string | null;
  phone: string | null;
  note: string | null;
  createdAt: Date;
}

export interface Notifier {
  notify<E extends NotifierEvent>(event: E, payload: NotifierPayloads[E]): Promise<void>;
}
