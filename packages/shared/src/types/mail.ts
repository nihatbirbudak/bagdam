// ── E-posta (MailModule, F6) DTO'ları — ADR-0014: şablonlar DB'de (SiteContent `mail.<slug>`), MailLog 90 gün ──
import type { MailStatus } from '../enums';
import type { Id, IsoDateTime } from './common';

/**
 * Şablon slug'ları — SiteContent anahtarı `mail.<slug>` (`{subject, html}`; Handlebars).
 * Kaynak liste apps/api `modules/mail/mail.constants.ts` + `site-content.registry.ts` (grup `mail`); burada yalnız tip.
 */
export type MailTemplateSlug =
  | 'welcome'
  | 'verify'
  | 'reset'
  | 'password-changed'
  | 'wholesale-lead'
  | 'test'
  | 'order-paid' // F8: sipariş onayı + yasal belge kopyası
  // ── F10 (ADR-0014 zorunlu şablon listesi) — abonelik motoru + teslimat olayları ──
  | 'cycle-charged' // haftalık kutu tahsil edildi (içerik + teslimat günü)
  | 'cycle-payment-failed' // tahsilat başarısız (kart güncelle + yeniden deneme zamanı)
  | 'cycle-awaiting-payment' // ödeme linki + son ödeme zamanı
  | 'cutoff-reminder' // kesimden 24 s önce (bu haftanın kutusu + değişiklik son saati + atlama)
  | 'order-shipped' // yola çıktı
  | 'order-delivered' // teslim edildi
  | 'order-delivery-failed' // teslim edilemedi + yeniden planlama
  | 'subscription-cancelled' // iptal teyidi + son kutu
  | 'subscription-past-due'; // üst üste başarısız tahsilat (abonelik askıda)

/** Notifier olayları — `Notifier.notify(event, payload)` (MailNotifier → MailService). F7+ yeni olaylar buraya EKLENİR. */
export type NotifierEvent =
  | 'customer.welcome'
  | 'customer.verify'
  | 'customer.reset'
  | 'customer.password-changed'
  | 'wholesale.new-lead'
  | 'order.paid' // F8: sipariş ödendi (OrdersService PAID yan etkisi → mail.order-paid)
  // ── F10: sipariş teslimat olayları (OrdersService.transition yan etkisi) ──
  | 'order.shipped'
  | 'order.delivered'
  | 'order.delivery-failed'
  // ── F10: abonelik motoru olayları (SubscriptionNotifier → MailNotifier; F7'de stub'dı) ──
  | 'cycle.charged'
  | 'cycle.payment-failed'
  | 'cycle.awaiting-payment'
  | 'subscription.cutoff-reminder'
  | 'subscription.cancelled'
  | 'subscription.past-due';

/** Admin `GET /admin/mail-logs?page&limit&status&to` satırı. */
export interface MailLogItem {
  id: Id;
  to: string;
  subject: string;
  templateSlug: string;
  entityId: string | null;
  status: MailStatus;
  error: string | null;
  messageId: string | null;
  /** DISABLE_MAIL önizleme dosyası (yalnız dev/test: NODE_ENV !== production). */
  previewPath: string | null;
  createdAt: IsoDateTime;
  sentAt: IsoDateTime | null;
}

export interface MailLogListQuery {
  page?: number;
  limit?: number;
  status?: MailStatus;
  /** Alıcı e-postasında içerir (büyük/küçük harf duyarsız). */
  to?: string;
}

export interface MailLogList {
  items: MailLogItem[];
  total: number;
  page: number;
  limit: number;
}

/** Admin `POST /admin/settings/mail/test {to}` → gönderim sonucu (DISABLE_MAIL'de SKIPPED + previewPath). */
export interface MailTestResult {
  logId: Id;
  status: MailStatus;
  messageId: string | null;
  previewPath: string | null;
  error: string | null;
}

