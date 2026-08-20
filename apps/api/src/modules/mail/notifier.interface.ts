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
