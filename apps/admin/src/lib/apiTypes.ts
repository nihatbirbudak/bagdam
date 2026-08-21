/**
 * API sözleşmesi zarfları (panelin kendi ihtiyaç duyduğu şekiller). Alan/enum tipleri
 * `@bagdam/shared`'dan; admin DTO şekilleri `lib/adminTypes.ts`'te.
 */
import type { Coupon, CouponRedemption, UserRole } from '@bagdam/shared';

/** Global hata zarfı (AllExceptionsFilter): `{ statusCode, message, error, requestId, timestamp, path }`. */
export interface ApiErrorEnvelope {
  statusCode: number;
  /** class-validator hatalarında dizi gelebilir. */
  message: string | string[];
  error?: string;
  requestId?: string;
  path?: string;
  timestamp?: string;
}

export type { UserRole };

/** `POST /auth/login` → `{ user }` ve `GET /auth/me` gövdesi (ADR-0009). */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole | string;
  emailVerifiedAt?: string | null;
  createdAt?: string;
}

/** `POST /auth/login` yanıtı (cookie set edilir; gövdede kullanıcı döner). */
export interface LoginResponse {
  user?: AuthUser;
}

/** `GET /health` (HealthController). */
export interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
  version?: string;
  db?: string;
  [key: string]: unknown;
}

/** Ortak sayfalama zarfı — admin liste uçları `{ items, total, page, limit }` döner. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * F5 sözleşmesi — içerik (SiteContent / Post / LegalDocument), toptan, ayarlar, teslimat.
 * Kaynak: görev sözleşmesi (A/B/C/D birebir). `@bagdam/shared` F5 tipleri geldiğinde (A/B ekliyor)
 * buradaki şekiller yalnız yeniden dışa aktarıma indirgenir; panel bu dosyadan import eder.
 * Yazım/alan adı farkı olursa sunucu (A registry / B registry) kaynaktır — bkz. open_issues.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── SiteContent (ekran 9–10) ─────────────────────────────────────────────── */

/**
 * İçerik şeması alan türleri. A registry: text | textarea | richtext | image | url | number | boolean | select | list.
 * Shared (`SiteContentFieldType`) ayrıca `html` (= richtext) ve `featured` (home.featured seçici) tanımlar; ikisi de kabul edilir.
 */
export type ContentFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'html'
  | 'image'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'list'
  | 'featured';

/** Select seçeneği: düz string ya da `{value,label}`. */
export type ContentFieldOption = string | { value: string; label: string };

/**
 * Ham şema alanı — A registry `name` + `itemFields`, shared/seed `key` + `item` yazar; SchemaForm ikisini de okur
 * (`normalizeSchema`). Panelde yalnız normalize edilmiş biçim (`ContentFieldNormalized`) kullanılır.
 */
export interface ContentFieldRaw {
  name?: string;
  key?: string;
  label?: string;
  type?: ContentFieldType | string;
  required?: boolean;
  options?: ContentFieldOption[];
  itemFields?: ContentFieldRaw[];
  item?: ContentFieldRaw[];
  help?: string;
  /** Metin alanı üst sınırı (varsa). */
  maxLength?: number;
}

/** `SiteContent.schema` — `{fields:[...]}`. */
export interface ContentSchema {
  fields: ContentFieldRaw[];
}

/** `GET /admin/site-content` öğesi ve `GET /admin/site-content/:key` gövdesi (shared `AdminSiteContentItem`). */
export interface AdminSiteContent {
  key: string;
  label: string;
  /** Registry sayfa grubu: global · index · urunler · kutu · nasil-seciyoruz · toptan · gunluk. */
  page?: string;
  schema: ContentSchema | null;
  value: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** `PUT /admin/site-content/:key` gövdesi. */
export interface AdminSiteContentUpdate {
  value: unknown;
}

/** `home.featured` öğesi — ürün ve tier kartları karışık sırada [B7] (shared `HomeFeaturedItem` ile aynı). */
export interface FeaturedItem {
  type: 'product' | 'tier';
  /** Product.slug ya da BoxTier.slug. */
  ref: string;
  order: number;
}

/* ── Günlük (Post, ekran 11) ──────────────────────────────────────────────── */

/** `GET /admin/posts` satırı / `GET /admin/posts/:id`. */
export interface AdminPost {
  id: string;
  slug: string;
  /** Kart rozeti (ör. "not", "hikâye", "tarif"). */
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt: string | null;
  bodyHtml: string;
  coverMediaId: string | null;
  /** Kapak görselinin genel URL'si (mapper; yoksa null). */
  coverUrl?: string | null;
  relatedSlugs: string[];
  status: ContentStatusValue;
  publishedAt: string | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export type ContentStatusValue = 'DRAFT' | 'PUBLISHED';

/** `POST /admin/posts` gövdesi; `PUT /admin/posts/:id` aynı alanların kısmi hâli. */
export interface AdminPostInput {
  slug: string;
  kind: string;
  readMinutes: number;
  titleHtml: string;
  excerpt: string | null;
  bodyHtml: string;
  coverMediaId: string | null;
  relatedSlugs: string[];
  status: ContentStatusValue;
}

export interface AdminPostListQuery {
  page?: number;
  limit?: number;
  status?: ContentStatusValue | '';
}

/* ── Yasal metinler (LegalDocument, ekran 12) ─────────────────────────────── */

export type LegalKindValue =
  | 'PRIVACY'
  | 'TERMS'
  | 'DISTANCE_SALES'
  | 'DELIVERY'
  | 'RETURNS'
  | 'KVKK'
  | 'COOKIE'
  | 'COOKIE_SETTINGS'
  | 'PREINFO'
  | 'SUBSCRIPTION_CONTRACT'
  | 'MARKETING_CONSENT';

/** `GET /admin/legal` → slug başına özet; `versions` sürüm satırları. */
export interface AdminLegalVersionRow {
  id: string;
  version: number;
  title: string;
  isCurrent: boolean;
  effectiveFrom: string;
  requiresAck: boolean;
  showInNav: boolean;
  sortOrder: number;
  contentHash?: string;
  createdAt: string;
}

/** shared `AdminLegalGroup`: nav/sıra/onay slug düzeyinde (yayındaki, yoksa en son sürümden). */
export interface AdminLegalSlug {
  slug: string;
  kind: LegalKindValue | string;
  title: string;
  currentVersion: number | null;
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
  versions: AdminLegalVersionRow[];
}

/** `GET /admin/legal/:id` — tam belge (gövde dahil). */
export interface AdminLegalDocument extends AdminLegalVersionRow {
  kind: LegalKindValue | string;
  slug: string;
  leadHtml: string | null;
  bodyHtml: string;
  contentHash: string;
}

/** `POST /admin/legal/:slug/versions` gövdesi — yeni taslak sürüm (isCurrent=false); `kind` yalnız yeni slug'da. */
export interface AdminLegalVersionInput {
  title: string;
  leadHtml?: string | null;
  bodyHtml: string;
  kind?: LegalKindValue;
  requiresAck?: boolean;
  showInNav?: boolean;
  sortOrder?: number;
}

/** `PUT /admin/legal/:id` — yalnız taslakta (isCurrent=false); yayındakinde 409. */
export interface AdminLegalVersionUpdate {
  title?: string;
  leadHtml?: string | null;
  bodyHtml?: string;
}

/** `PATCH /admin/legal/:id/nav`. */
export interface AdminLegalNavPatch {
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
}

/** `POST /admin/legal/:id/publish`. */
export interface AdminLegalPublishInput {
  effectiveFrom?: string;
}

/* ── Toptan talepleri (WholesaleLead, ekran 13) ───────────────────────────── */

export type LeadStatusValue = 'NEW' | 'CONTACTED' | 'CLOSED';

export interface AdminWholesaleLead {
  id: string;
  email: string;
  businessName: string | null;
  phone: string | null;
  note: string | null;
  status: LeadStatusValue;
  ip?: string | null;
  createdAt: string;
}

export interface AdminWholesaleLeadPatch {
  status?: LeadStatusValue;
  note?: string | null;
}

export interface AdminWholesaleLeadQuery {
  status?: LeadStatusValue | '';
  page?: number;
  limit?: number;
}

/* ── Ayarlar (Setting, ekran 14a/15) ──────────────────────────────────────── */

export type SettingFieldType = 'text' | 'number' | 'boolean' | 'select' | 'secret' | 'json' | 'textarea';

/** Setting alan meta + değeri — `GET /admin/settings` içindeki `fields[]` öğesi (shared `AdminSettingField`). */
export interface AdminSettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  options?: ContentFieldOption[];
  help?: string;
  default?: unknown;
  /** Zorunlu alan (PUT'ta boş verilemez). */
  required?: boolean;
  /** number: izinli aralık; `integer` tam sayı ister. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** Secret alanda maskeli (`'••••••'`); diğerlerinde gerçek değer. */
  value?: unknown;
  isSecret?: boolean;
  /** Secret alan: sunucuda değer var mı (maskeli gösterim için). */
  hasValue?: boolean;
  masked?: boolean;
  /** DB satırı varsa güncelleme anı; yoksa null (varsayılan gösteriliyor). */
  updatedAt?: string | null;
}

/** `GET /admin/settings` öğesi / `GET /admin/settings/:group` gövdesi. */
export interface AdminSettingGroup {
  group: string;
  label: string;
  description?: string;
  fields: AdminSettingField[];
}

/** `PUT /admin/settings/:group` gövdesi — alan → değer (secret: boş/maske → değiştirme). */
export type AdminSettingGroupUpdate = Record<string, unknown>;

/* ── Teslimat bölgeleri / tarihleri (ekran 14a) ───────────────────────────── */

export type DeliveryDayValue = 'SALI' | 'PERSEMBE' | 'CUMARTESI';
export type DeliveryDateStatusValue = 'OPEN' | 'LOCKED' | 'CLOSED';

/** `GET /admin/delivery/zones` satırı (Decimal alanlar string ya da number gelebilir). */
export interface AdminDeliveryZone {
  id: string;
  name: string;
  slug: string;
  fee: number | string;
  freeThreshold: number | string | null;
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}

/** `POST /admin/delivery/zones` gövdesi; `PUT` aynı. */
export interface AdminDeliveryZoneInput {
  name: string;
  slug: string;
  fee: number;
  freeThreshold: number | null;
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}

/** `GET /admin/delivery/dates?zone&from&to` satırı. */
export interface AdminDeliveryDate {
  id: string;
  zoneId: string;
  zoneName?: string;
  zoneSlug?: string;
  day: DeliveryDayValue;
  date: string;
  cutoffAt: string;
  capacity: number;
  reserved: number;
  status: DeliveryDateStatusValue;
}

export interface AdminDeliveryDatePatch {
  capacity?: number;
  status?: DeliveryDateStatusValue;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * F6 sözleşmesi — müşteriler (ekran 16), e-posta günlüğü (MailLog), e-posta test gönderimi.
 * Kaynak: görev sözleşmesi (A/B/C). Enum/etiketler `@bagdam/shared` (USER_ROLE_*, CONSENT_KIND_*, IYS_STATUS_*,
 * MAIL_STATUS_*). Sunucu (A) alan adı/şekil farkı gösterirse `features/musteriler/customers.ts` ve
 * `features/sistem/mailLogs.ts` normalize eder; bu dosyadaki şekiller panelin gördüğü hâldir.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ConsentKindValue =
  | 'PREINFO_ACK'
  | 'CONTRACT_ACK'
  | 'SUBSCRIPTION_CONTRACT_ACK'
  | 'KVKK_ACK'
  | 'MARKETING_EMAIL'
  | 'MARKETING_SMS'
  | 'COOKIE_ANALYTICS'
  | 'COOKIE_MARKETING';

export type IysStatusValue = 'NOT_APPLICABLE' | 'PENDING' | 'SYNCED' | 'FAILED';

export type MailStatusValue = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

/* ── Müşteriler (User, ekran 16) ──────────────────────────────────────────── */

/** `GET /admin/customers?q&role&page&limit` satırı. Parola/refresh/reset alanları ASLA gelmez. */
export interface AdminCustomerListItem {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: UserRole | string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  /** F8'de dolar; şimdilik 0 / null gelebilir. */
  orderCount?: number;
  lastOrderAt?: string | null;
  subscriptionStatus?: string | null;
}

export interface AdminCustomerListQuery {
  q?: string;
  role?: UserRole | string | '';
  page?: number;
  limit?: number;
}

/** Müşterinin tek adresi (MVP; `Address` + bölge adı). */
export interface AdminCustomerAddress {
  id: string;
  fullName: string;
  phone: string;
  line: string;
  zoneId: string;
  zoneName?: string | null;
  zoneSlug?: string | null;
  zip: string | null;
  isDefault?: boolean;
  updatedAt?: string | null;
}

/** Consent satırı (KVKK / pazarlama / sözleşme onayları). */
export interface AdminCustomerConsent {
  id: string;
  kind: ConsentKindValue | string;
  granted: boolean;
  documentId: string | null;
  /** Onaylanan belgenin slug/başlık/sürümü (mapper verirse). */
  documentSlug?: string | null;
  documentTitle?: string | null;
  documentVersion?: number | null;
  source?: string | null;
  iysStatus?: IysStatusValue | string | null;
  revokedAt?: string | null;
  createdAt: string;
}

/** Müşteriye ait son audit satırları özeti (`AuditLog` — actor ya da entity bu kullanıcı). */
export interface AdminCustomerAuditEntry {
  id: string;
  action: string;
  module: string;
  summary: string | null;
  actorEmail?: string | null;
  createdAt: string;
}

/** `GET /admin/customers/:id` — profil + adres + onaylar + audit özeti (+ F8: siparişler boş). */
export interface AdminCustomerDetail extends AdminCustomerListItem {
  marketingOptIn?: boolean;
  updatedAt?: string | null;
  address: AdminCustomerAddress | null;
  consents: AdminCustomerConsent[];
  audit: AdminCustomerAuditEntry[];
  /** F8'de dolar. */
  orders: { items: unknown[]; total: number };
}

/** `PATCH /admin/customers/:id` gövdesi (kısmi). */
export interface AdminCustomerPatch {
  isActive?: boolean;
  name?: string | null;
  phone?: string | null;
}

/* ── E-posta günlüğü (MailLog, Sistem) ────────────────────────────────────── */

/** `GET /admin/mail-logs?page&limit&status&to` satırı (MailLog tablosu birebir). */
export interface AdminMailLog {
  id: string;
  to: string;
  subject: string;
  templateSlug: string;
  entityId: string | null;
  status: MailStatusValue | string;
  /** Hata metni; DISABLE_MAIL'de `preview:<dosya>` (render edilmiş HTML yolu, yalnız dev). */
  error: string | null;
  messageId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface AdminMailLogQuery {
  status?: MailStatusValue | '';
  to?: string;
  page?: number;
  limit?: number;
}

/** `POST /admin/settings/mail/test {to}` yanıtı — MailService.send sonucu (MailLog satırı ya da özet). */
export interface AdminMailSendResult {
  id?: string;
  mailLogId?: string;
  status?: MailStatusValue | string;
  to?: string;
  subject?: string;
  error?: string | null;
  messageId?: string | null;
  preview?: string | null;
  /** A sözleşmesi (shared MailTestResult): DISABLE_MAIL'de yazılan önizleme dosyası. */
  previewPath?: string | null;
  logId?: string;
  message?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * F8 sözleşmesi — siparişler (ekran 17), ödeme/iade, kuponlar (ekran 23).
 * Sipariş/ödeme DTO'ları `@bagdam/shared` (types/order.ts, F7 OrdersModule) — burada yalnız yeniden dışa aktarım;
 * kupon admin uçları (B) sözleşmeden: `GET /admin/coupons?q&active&page`, `GET /admin/coupons/:id` (+ redemptions),
 * `POST`, `PUT`, `DELETE` (soft), `PATCH /:id/active`. İade: `POST /admin/payments/:id/refund {amount, reason?}`.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type {
  AdminOrderList,
  AdminOrderListQuery,
  AdminRefundResult,
  Coupon,
  CouponInput,
  CouponListItem,
  CouponRedemption,
  Order,
  OrderBillingPatch,
  OrderInvoicePatch,
  OrderLine,
  OrderNoteRequest,
  OrderStatusPatch,
  OrderSummary,
  Payment,
  Refund,
  RefundRequest,
} from '@bagdam/shared';

/** `GET /admin/coupons?q&active&page&limit` sorgusu (B). `active`: '' tümü · 'true' · 'false'. */
export interface AdminCouponListQuery {
  q?: string;
  active?: '' | 'true' | 'false';
  page?: number;
  limit?: number;
}

/** `GET /admin/coupons/:id` — kupon + kullanımlar (CouponRedemption; sipariş no/e-posta mapper verirse). */
export interface AdminCouponDetail extends Coupon {
  redemptions: Array<CouponRedemption & { customerEmail?: string | null }>;
}

// `AdminRefundResult` (POST /admin/payments/:id/refund yanıtı) artık shared'dan: ok/refund/payment/refundedTotal + orderStatus/orderTransitioned (F8/E).


/* ═══════════════════════════════════════════════════════════════════════════
 * F9 sözleşmesi — ops/abonelik ekranları (14b Teslimat tarihleri · 18 Ödeme Problemleri · 19 Abonelikler ·
 * 20 Teslimat Günü · 21 Özet). DTO'ların TAMAMI `@bagdam/shared`'dan gelir; burada yalnız yeniden dışa
 * aktarım ve panelin kendi sorgu/gövde takma adları vardır.
 *
 * Uçlar (apps/api kaynağından okundu — imzalar birebir):
 *   GET   /admin/delivery/dates?zone&from&to            → DeliveryDateAdmin[]
 *   PATCH /admin/delivery/dates/:id {capacity?,status?} → DeliveryDateAdmin
 *   POST  /admin/delivery/dates/generate {weeks?}       → DeliveryDatesGenerateResult
 *   GET   /admin/subscriptions?status&q&page&limit      → SubscriptionList
 *   GET   /admin/subscriptions/:id                      → Subscription (+cycles +cancellations +events)
 *   PATCH /admin/subscriptions/:id                      → Subscription
 *   GET   /admin/cycles?date&status&zone                → AdminCycleListItem[]
 *   PATCH /admin/cycles/:id/status {status,note?}       → SubscriptionCycle
 *   POST  /admin/cycles/:id/charge                      → SubscriptionCycle
 *   POST  /admin/cycles/:id/send-payment-link           → {cycle, linkToken, linkExpiresAt}
 *   POST  /admin/cycles/:id/compensate {productId,qty?,label?,note} → SubscriptionCycle
 *   GET   /admin/ops/pick-list?date&zone                → PickListRow[]
 *   GET   /admin/ops/packing-list?date&zone             → PackingListEntry[]
 *   GET   /admin/ops/day-summary?date&zone              → OpsDaySummary
 *   POST  /admin/ops/bulk-status                        → OpsBulkStatusResult
 *   GET   /admin/payment-issues?kind&q&page&limit       → PaymentIssueList
 *   GET   /admin/dashboard                              → AdminDashboard
 * ═══════════════════════════════════════════════════════════════════════════ */

export type {
  AdminCycleListItem,
  AdminDashboard,
  AdminDashboardCutoff,
  AdminDashboardEvent,
  AdminDashboardOrders,
  AdminDashboardSubscriptions,
  CycleItem,
  DeliveryDateAdmin,
  DeliveryDatesGenerateResult,
  OpsBulkStatus,
  OpsBulkStatusItemResult,
  OpsBulkStatusRequest,
  OpsBulkStatusResult,
  OpsDaySummary,
  OpsDaySummaryZone,
  PackingListEntry,
  PackingListItem,
  PaymentIssueCounts,
  PaymentIssueItem,
  PaymentIssueKind,
  PaymentIssueList,
  PickListPref,
  PickListRow,
  Subscription,
  SubscriptionCancellation,
  SubscriptionCycle,
  SubscriptionEvent,
  SubscriptionList,
  SubscriptionListItem,
} from '@bagdam/shared';

import type { ChargeStrategy, CycleStatus, DeliveryDay, SubscriptionStatus } from '@bagdam/shared';

/* ── Ekran 14b — Ayarlar › Teslimat tarihleri ─────────────────────────────── */

/** `GET /admin/delivery/dates` sorgusu (bölge + hafta aralığı). */
export interface AdminDeliveryDatesQuery {
  zone?: string;
  from?: string;
  to?: string;
}

/* ── Ekran 19 — Abonelikler ───────────────────────────────────────────────── */

/** `GET /admin/subscriptions?status&q&page&limit` (AdminSubscriptionsQueryDto ile birebir). */
export interface AdminSubscriptionsQuery {
  status?: SubscriptionStatus | '';
  q?: string;
  page?: number;
  limit?: number;
}

/** `PATCH /admin/subscriptions/:id` (AdminSubscriptionPatchDto ile birebir; tier/type değişimi YOK — ADR-0008). */
export interface AdminSubscriptionPatchBody {
  status?: SubscriptionStatus;
  frequencyWeeks?: number;
  deliveryDay?: DeliveryDay;
  addressId?: string;
  paymentMethodId?: string | null;
  chargeStrategy?: ChargeStrategy;
  note?: string;
}

/** `GET /admin/cycles?date&status&zone` sorgusu; `status` virgüllü liste. */
export interface AdminCyclesQuery {
  date: string;
  status?: string;
  zone?: string;
}

/** `POST /admin/cycles/:id/compensate` gövdesi — 0 TL EXTRA satırı [B19]. */
export interface AdminCycleCompensateBody {
  productId: string;
  qty?: number;
  label?: string;
  note: string;
}

/** `POST /admin/cycles/:id/send-payment-link` yanıtı. */
export interface AdminPaymentLinkResult {
  cycle: { id: string; cycleNo: number; status: CycleStatus | string; paymentDueAt: string | null };
  linkToken: string;
  linkExpiresAt: string;
}

/* ── Ekran 18 — Ödeme Problemleri ─────────────────────────────────────────── */

/** `GET /admin/payment-issues?kind&q&page&limit` sorgusu (PaymentIssuesQueryDto ile birebir). */
export interface AdminPaymentIssuesQuery {
  kind?: 'ORDER' | 'CYCLE' | '';
  q?: string;
  page?: number;
  limit?: number;
}

/* ── Ekran 20 — Teslimat Günü (ops) ───────────────────────────────────────── */

/** `GET /admin/ops/pick-list` · `packing-list` · `day-summary` ortak sorgusu. */
export interface AdminOpsDateQuery {
  date: string;
  zone?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * F10 sözleşmesi — Ekran 22 "Sistem": günlükler + sağlık + işler.
 *
 *   GET  /admin/audit-logs?page&limit&module&action&actorId&entityId&search → Paginated<AdminAuditLog>
 *   GET  /admin/system-logs?page&limit&level&module&requestId&search        → SystemLogList
 *   GET  /admin/cron-logs?page&limit&name&status&search                     → CronLogList
 *   GET  /admin/mail-logs?page&limit&status&to                              → MailLogList
 *   GET  /admin/webhook-events?page&limit&provider&status&search            → WebhookEventList
 *   GET  /admin/health/detailed                                             → AdminHealthDetailed
 *   GET  /admin/jobs                                                        → JobInfo[]
 *   POST /admin/jobs/:name/run                                              → JobRunResult (yalnız dev/staging)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type {
  AdminHealthDb,
  AdminHealthDetailed,
  AdminHealthScheduler,
  CronLogItem,
  CronLogList,
  CronLogListQuery,
  CronLogStatus,
  JobInfo,
  JobRunResult,
  SystemLogItem,
  SystemLogLevel,
  SystemLogList,
  SystemLogListQuery,
  WebhookEventItem,
  WebhookEventList,
  WebhookEventListQuery,
} from '@bagdam/shared';

/** `GET /admin/audit-logs` sorgusu (AuditQueryDto ile birebir). */
export interface AdminAuditLogQuery {
  page?: number;
  limit?: number;
  module?: string;
  action?: string;
  actorId?: string;
  entityId?: string;
  search?: string;
}
