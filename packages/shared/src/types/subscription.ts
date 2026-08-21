// ── Abonelik / cycle DTO'ları + frontend `sub` DTO'su ────────────────────────
// F7 (0003_commerce): Subscription / SubscriptionCycle / CycleItem / SubscriptionEvent / SubscriptionCancellation alanları
// database/schema.prisma ile birebir (Prisma kaynak); DTO yalnız join kolaylığı alanları (tierSlug, deliveryOn …) ekler.
import type {
  CancelOutcome,
  CancelReason,
  ChargeStrategy,
  CycleItemSource,
  CycleStatus,
  DeliveryDay,
  DeliveryDaySlug,
  SkipSource,
  SubEventType,
  SubscriptionStatus,
} from '../enums';
import type { Money } from '../pricing';
import type { Id, IsoDate, IsoDateTime } from './common';

// ── Frontend (cart.js) sözleşmesi ────────────────────────────────────────────

/** cart.js `sub.type`: "subscription" | "onetime" (kutu.html type toggle; canlı modda disabled). */
export type SubType = 'subscription' | 'onetime';

/** products.js FREQ_OPTIONS id'leri — Setting `commerce.frequencies[].id`; `${weeks}hafta` kalıbı. */
export type FreqId = '1hafta' | '2hafta' | '4hafta';
export const FREQ_ID_VALUES: readonly FreqId[] = ['1hafta', '2hafta', '4hafta'];
/** FreqId → Subscription.frequencyWeeks. */
export const FREQUENCY_WEEKS: Readonly<Record<FreqId, number>> = { '1hafta': 1, '2hafta': 2, '4hafta': 4 };
export function freqIdFromWeeks(weeks: number): FreqId {
  const hit = (Object.keys(FREQUENCY_WEEKS) as FreqId[]).find((k) => FREQUENCY_WEEKS[k] === weeks);
  return hit ?? '1hafta';
}

/** cart.js `sub.extras[]` öğesi — `subAddExtra(id, factor, label)`; `id` ürün slug'ı, `factor` birim fiyat çarpanı. */
export interface SubExtra {
  id: string;
  factor: number;
  label: string;
}

/**
 * cart.js `getSub()` şekli — `SUB_DEFAULTS` ile BİREBİR (localStorage taslağı ve `__BAGDAM__.sub` ortak çekirdeği):
 *   tierId, items, skipThisWeek, skipUsed, freq, deliveryDay, type, itemPrefs, extras, extrasCutoff, purchased
 * + kodda sonradan eklenen `active` (kutu sepette, ödenmedi) ve `nextBoxDiscount` (uyelik.html retention).
 */
export interface ClientSubCore {
  /** BoxTier.slug (small | sezon); taslakta null olabilir. */
  tierId: string | null;
  /** Kutu içeriği — ürün slug'ları (TEMPLATE + SWAP öğeleri), tier.count kadar. */
  items: string[];
  /** Açık cycle SKIPPED(USER) mı. */
  skipThisWeek: boolean;
  /** Atlama hakkı tükendi mi (skipsUsed >= skipsPerYear). */
  skipUsed: boolean;
  freq: FreqId;
  deliveryDay: DeliveryDaySlug | null;
  type: SubType;
  /** Kalıcı ürün tercihleri `{productSlug: seçenek}` — Subscription.itemPrefs [B4]. */
  itemPrefs: Record<string, string>;
  /** Açık cycle'ın EXTRA + CART_MERGE öğeleri. */
  extras: SubExtra[];
  /** Ekstraların geçerli olduğu kesim anı (epoch ms) — açık cycle'ın cutoffAt'i; cart.js süresi geçince ekstraları düşürür. */
  extrasCutoff: number | null;
  /** Ödeme tamamlandı (canlı abonelik). Sunucu DTO'sunda her zaman true. */
  purchased: boolean;
  /** Kutu sepette, henüz ödenmedi (yalnız localStorage taslağı). Sunucu DTO'sunda false. */
  active?: boolean;
  /** Retention teklifi kabul edildi → bir sonraki kutuda %50 (Subscription.nextBoxDiscountPct != null). */
  nextBoxDiscount?: boolean;
}

/** `__BAGDAM__.sub` / `GET /me/subscription` içindeki açık (düzenlenebilir ya da yoldaki) cycle özeti. */
export interface ClientCycleSummary {
  id: Id;
  cycleNo: number;
  status: CycleStatus;
  skipSource: SkipSource | null;
  deliveryOn: IsoDate;
  deliveryDay: DeliveryDaySlug;
  cutoffAtIso: IsoDateTime;
  /** cutoffAt <= now (artık düzenlenemez). */
  locked: boolean;
  /** Kilit sonrası snapshot toplamı ("Bu haftaki ödeme"); SCHEDULED iken canlı quote. */
  total: Money | null;
  prepaidAmount: Money;
  /** PAYMENT_LINK: ödeme linki (AWAITING_PAYMENT iken). */
  paymentLinkUrl: string | null;
  paymentDueAtIso: IsoDateTime | null;
}

/**
 * Bootstrap `__BAGDAM__.sub` ve `GET /me/subscription` yanıtı: cart.js çekirdeği + sunucu durum alanları
 * (ADR-0003 istisna 7: uyelik'te PAST_DUE / CANCEL_REQUESTED / ödeme bekliyor metinleri bunlardan).
 * Eşleme (Subscription + açık cycle → DTO): tierId=tier.slug · items=açık cycle TEMPLATE/SWAP slug'ları ·
 * extras=EXTRA/CART_MERGE {id:slug,factor:qty,label} · extrasCutoff=açık cycle cutoffAt(ms) ·
 * skipThisWeek=açık cycle SKIPPED(USER) · skipUsed=skipsUsed>=skipsPerYear · freq=`${frequencyWeeks}hafta` ·
 * deliveryDay=slug · type=isOneTime?'onetime':'subscription' · purchased=true · active=false ·
 * nextBoxDiscount=nextBoxDiscountPct!=null.
 */
export interface BootstrapSub extends ClientSubCore {
  id: Id;
  status: SubscriptionStatus;
  isOneTime: boolean;
  purchased: true;
  active: false;
  /** Düzenlenebilir (SCHEDULED/SKIPPED, kesimi geçmemiş) en yakın cycle; yoksa null. */
  currentCycle: ClientCycleSummary | null;
  /** Kilitlenmiş ve henüz teslim edilmemiş cycle (LOCKED…OUT_FOR_DELIVERY / UNPAID / AWAITING_PAYMENT); yoksa null. */
  inFlightCycle: ClientCycleSummary | null;
  nextDeliveryOn: IsoDate | null;
  nextCutoffAtIso: IsoDateTime | null;
  /** Tahsilat sorunu bayrağı (UNPAID cycle var ya da PAST_DUE). */
  dunning: { active: boolean; retryCount: number; nextRetryAtIso: IsoDateTime | null } | null;
  /** Açık iptal akışı (CANCEL_REQUESTED). */
  cancellation: { id: Id; outcome: CancelOutcome; retentionOffered: boolean; effectiveAtIso: IsoDateTime | null } | null;
  discountBoxesLeft: number;
  /** Saklı kart özeti (uyelik kart alanı). */
  card: { last4: string; brand: string | null } | null;
}

/** `GET /me/subscription` = BootstrapSub (aynı DTO). */
export type MeSubscriptionResponse = BootstrapSub;

/** `PATCH /me/subscription` — type/tier değişimi YOK (canlı modda butonlar disabled) [B13]. */
export interface SubscriptionPatch {
  freq?: FreqId;
  deliveryDay?: DeliveryDaySlug;
  addressId?: Id;
  paymentMethodId?: Id;
}

/** `PATCH /me/subscription/cycles/current` — swap/pref/extras (SCHEDULED iken, kesimden önce). */
export interface CurrentCyclePatch {
  items?: string[];
  itemPrefs?: Record<string, string>;
  extras?: SubExtra[];
}

/** `POST /me/subscription/cycles/current/merge-cart` — "bu haftaki kutuma ekle". */
export interface MergeCartRequest {
  lines: Array<{ id: string; qty: number; pref?: string | null }>;
}

/** `POST /me/subscription/cancel {reason,note}` → teklif. */
export interface CancelRequest {
  reason: CancelReason;
  note?: string;
}
export interface CancelResponse {
  cancellationId: Id;
  /** Retention teklifi (üye başına 1 kez); yoksa null → doğrudan confirm/abandon. */
  offer: { pct: number; boxes: number } | null;
}

// ── Admin / API DTO'ları ──────────────────────────────────────────────────────

export interface Subscription {
  id: Id;
  userId: Id;
  userEmail?: string;
  userName?: string | null;
  tierId: Id;
  tierSlug: string;
  tierLabel?: string;
  isOneTime: boolean;
  status: SubscriptionStatus;
  frequencyWeeks: number;
  deliveryDay: DeliveryDay;
  zoneId: Id;
  addressId: Id | null;
  paymentMethodId: Id | null;
  itemPrefs: Record<string, string>;
  chargeStrategy: ChargeStrategy;
  discountBoxesLeft: number;
  nextBoxDiscountPct: number | null;
  skipsUsed: number;
  skipsResetAt: IsoDateTime | null;
  failedCycles: number;
  contractDocId: Id | null;
  startedAt: IsoDateTime | null;
  nextDeliveryOn: IsoDate | null;
  nextCutoffAt: IsoDateTime | null;
  cancelRequestedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cycles?: SubscriptionCycle[];
  cancellations?: SubscriptionCancellation[];
  events?: SubscriptionEvent[];
}

/** Admin `GET /admin/subscriptions` satırı. */
export interface SubscriptionListItem {
  id: Id;
  userEmail: string;
  userName: string | null;
  tierSlug: string;
  isOneTime: boolean;
  status: SubscriptionStatus;
  frequencyWeeks: number;
  deliveryDay: DeliveryDay;
  zoneName: string;
  nextDeliveryOn: IsoDate | null;
  failedCycles: number;
  startedAt: IsoDateTime | null;
}

/** Admin `PATCH /admin/subscriptions/:id`. */
export interface SubscriptionAdminPatch {
  status?: SubscriptionStatus;
  frequencyWeeks?: number;
  deliveryDay?: DeliveryDay;
  addressId?: Id;
  paymentMethodId?: Id | null;
  chargeStrategy?: ChargeStrategy;
  note?: string;
}

export interface CycleItem {
  id: Id;
  cycleId: Id;
  source: CycleItemSource;
  productId: Id;
  productSlug?: string;
  productName?: string;
  lotId: Id | null;
  swapOfProductId: string | null;
  pref: string | null;
  qty: number;
  unit: string | null;
  label: string | null;
  /** Kilit snapshot'ı; telafi = EXTRA unitPrice 0 [B19]. */
  unitPrice: Money | null;
  lotCode: string | null;
  sortOrder: number;
}

export interface SubscriptionCycle {
  id: Id;
  subscriptionId: Id;
  cycleNo: number;
  deliveryDateId: Id;
  deliveryOn?: IsoDate;
  cutoffAt?: IsoDateTime;
  status: CycleStatus;
  skipSource: SkipSource | null;
  boxPrice: Money | null;
  extrasTotal: Money | null;
  discount: Money | null;
  shippingFee: Money | null;
  total: Money | null;
  prepaidAmount: Money;
  orderId: Id | null;
  deltaOrderId: Id | null;
  lockedAt: IsoDateTime | null;
  skippedAt: IsoDateTime | null;
  paymentDueAt: IsoDateTime | null;
  retryCount: number;
  nextRetryAt: IsoDateTime | null;
  items: CycleItem[];
}

/** Admin `PATCH /admin/cycles/:id/status` (ops: PREPARING/OUT_FOR_DELIVERY/DELIVERED/CANCELLED). */
export interface CycleStatusPatch {
  status: CycleStatus;
  note?: string;
}

/** Admin `POST /admin/cycles/:id/compensate` — telafi: 0 TL EXTRA satırı [B19]. */
export interface CycleCompensateRequest {
  productId: Id;
  qty?: number;
  label?: string;
  note: string;
}

export interface SubscriptionEvent {
  id: Id;
  subscriptionId: Id;
  cycleId: Id | null;
  type: SubEventType;
  /** USER | SYSTEM | ADMIN | OPS | PSP */
  actor: string;
  data: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

/** Olay aktörleri (SubscriptionEvent.actor, VarChar(10)). */
export const SUB_EVENT_ACTORS = ['USER', 'SYSTEM', 'ADMIN', 'OPS', 'PSP'] as const;
export type SubEventActor = (typeof SUB_EVENT_ACTORS)[number];

/** SubscriptionCancellation — her iptal AKIŞI bir satır [B8]; Abonelik Sözleşmeleri Yön. md.24-25. */
export interface SubscriptionCancellation {
  id: Id;
  subscriptionId: Id;
  reason: CancelReason | null;
  reasonText: string | null;
  retentionOffered: boolean;
  outcome: CancelOutcome;
  requestedAt: IsoDateTime;
  /** Feshin yürürlük anı — en geç talep + 7 gün. */
  effectiveAt: IsoDateTime | null;
  confirmedAt: IsoDateTime | null;
  refundAmount: Money | null;
  /** İade son tarihi — en geç fesih + 15 gün. */
  refundDueAt: IsoDateTime | null;
}

/** Ops toplama listesinde bir ürünün tercih dağılımı ("olgun 3 · ham 2") — F9 ekran 20. */
export interface PickListPref {
  pref: string;
  /** Bu tercihi isteyen satırların miktar toplamı. */
  qty: number;
  /** Kaç kutuda geçiyor. */
  count: number;
}

/** Ops `GET /admin/ops/pick-list?date=&zone=` satırı. */
export interface PickListRow {
  productId: Id;
  productSlug: string;
  productName: string;
  unit: string | null;
  lotCode: string | null;
  /** Toplam adet/çarpan. */
  totalQty: number;
  boxCount: number;
  extraCount: number;
  /** F9: kutu (TEMPLATE/SWAP) satırlarının miktar toplamı. */
  boxQty: number;
  /** F9: ekstra (EXTRA/CART_MERGE) satırlarının miktar toplamı. */
  extraQty: number;
  /** F9: paketlemede basılan birim etiketleri (CycleItem.label ?? Product.boxAmount) — tekrarsız. */
  labels: string[];
  /** F9: tercih dağılımı (tercihsiz satırlar girmez); tercih adına göre sıralı. */
  prefs: PickListPref[];
}

/** Ops paketleme fişi satırı (kutu içeriği) — F9: ürün kimliği, miktar ve birim eklendi. */
export interface PackingListItem {
  productId: Id;
  productSlug: string;
  name: string;
  label: string | null;
  pref: string | null;
  source: CycleItemSource;
  lotCode: string | null;
  /** EXTRA/CART_MERGE çarpanı; kutu satırlarında 1. */
  qty: number;
  unit: string | null;
}

/** Ops `GET /admin/ops/packing-list?date=&zone=` öğesi (kutu başına fiş). */
export interface PackingListEntry {
  cycleId: Id;
  subscriptionId: Id;
  orderNo: number | null;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  zoneName: string;
  tierSlug: string;
  tierLabel: string;
  curatorName: string | null;
  status: CycleStatus;
  items: PackingListItem[];
  note: string | null;
  // ── F9 ekleri (ekran 20 paketleme fişi + yazdırma görünümü) — sunucu hepsini doldurur ──────
  cycleNo: number;
  isOneTime: boolean;
  deliveryOn: IsoDate;
  deliveryDay: DeliveryDaySlug;
  zoneSlug: string;
  customerEmail: string;
  addressZip: string | null;
  /** Aboneliğin kalıcı ürün tercihleri (kutuda olmayanlar dahil) [B4]. */
  itemPrefs: Record<string, string>;
  /** Siparişin durumu (cycle ile birlikte ilerler); sipariş yoksa null. */
  orderStatus: string | null;
  /** Ops notu — telafi kayıtları da burada [B19]. */
  adminNote: string | null;
  /** Kilit snapshot toplamı ("bu haftaki ödeme"); kilitlenmemişse null. */
  total: Money | null;
  boxItemCount: number;
  extraItemCount: number;
}

// ── F7 ekleri (SubscriptionsModule / JobsModule) — yalnız EKLEME ─────────────────────────────────────────────

/** Admin `GET /admin/subscriptions?status&q&page&limit` yanıtı. */
export interface SubscriptionList {
  items: SubscriptionListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Admin `GET /admin/cycles?date&status&zone` satırı — cycle + abonelik/müşteri/sipariş özeti (ekran 21). */
export interface AdminCycleListItem extends SubscriptionCycle {
  userEmail: string;
  userName: string | null;
  tierSlug: string;
  zoneName: string;
  isOneTime: boolean;
  subscriptionStatus: SubscriptionStatus;
  orderNo: number | null;
  orderStatus: string | null;
  deltaOrderNo: number | null;
}

/**
 * Abonelik motoru bildirim olayları (F7 stub — `SubscriptionNotifier`; F10'da MailNotifier şablonlarına bağlanır).
 * `subscription.cutoff-reminder`: `reminders:cutoff` job'ı (kesimden ~24 s önce).
 */
export type SubscriptionNotifierEvent =
  | 'subscription.activated'
  | 'cycle.charged'
  | 'cycle.payment-failed'
  | 'cycle.awaiting-payment'
  | 'subscription.cancelled'
  | 'subscription.cutoff-reminder'
  /** F10: üst üste başarısız tahsilat → abonelik PAST_DUE (mail.subscription-past-due). */
  | 'subscription.past-due';

/** Stub bildiriminin kaydı (testler ve admin teşhisi için son N olay bellekte tutulur). */
export interface SubscriptionNotification {
  event: SubscriptionNotifierEvent;
  subscriptionId: Id;
  userId: Id;
  cycleId: Id | null;
  data: Record<string, unknown>;
  at: IsoDateTime;
}

/** Job (cron) adları — JobsService kayıt defteri + `POST /admin/jobs/:name/run`. kvkk:purge / logs:cleanup F10. */
export type JobName =
  | 'delivery-dates:generate'
  | 'cycles:ensure'
  | 'cycles:lock-and-charge'
  | 'cycles:expire-payment-links'
  | 'payments:retry'
  | 'reminders:cutoff'
  | 'payments:reconcile' // F8: PENDING kalmış checkout ödemeleri (sağlayıcı sorgusu / 24 s EXPIRED + Order CANCELLED + DD iade)
  | 'kvkk:purge'; // F10: KVKK saklama matrisi (MailLog/SystemLog/CronLog yaş bazlı silme + AuditLog PII maskeleme + pasif müşteri anonimleştirme); logs:cleanup bunun içinde
export const JOB_NAME_VALUES: readonly JobName[] = [
  'delivery-dates:generate',
  'cycles:ensure',
  'cycles:lock-and-charge',
  'cycles:expire-payment-links',
  'payments:retry',
  'reminders:cutoff',
  'payments:reconcile',
  'kvkk:purge',
];

/** Bir job koşusunun sonucu (CronLog satırıyla aynı alanlar). */
export interface JobRunResult {
  name: JobName;
  status: 'SUCCESS' | 'FAILED';
  itemsProcessed: number;
  errors: number;
  details: Record<string, unknown> | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  durationMs: number;
  cronLogId: Id | null;
}

/** Admin `GET /admin/jobs` satırı: kayıtlı job + cron ifadesi + son koşu. */
export interface JobInfo {
  name: JobName;
  cron: string;
  description: string;
  lastRun: JobRunResult | null;
}

// ── F7/E ekleri — admin manuel checkout (`POST /admin/subscriptions`) — yalnız EKLEME ──────────────────────────
// Ofis/havale/nakit siparişi: admin müşteri adına abonelik ya da tek seferlik kutu açar; fiyat PricingService.quote,
// Order PAID (MANUAL ödeme), Subscription ACTIVE + cycle#1. F8 checkout'un sunucu tarafı iskeletiyle aynı orkestrasyon.

export interface AdminCreateSubscriptionRequest {
  userId: Id;
  tierSlug: string;
  isOneTime?: boolean;
  /** Yoksa 1 (tek seferlikte yok sayılır). */
  frequencyWeeks?: number;
  deliveryDay: DeliveryDay;
  /** İlk teslimat günü (YYYY-MM-DD); yoksa bölge+gün için kesimi geçmemiş ilk tarih. */
  deliveryOn?: IsoDate;
  /** Yoksa müşterinin varsayılan adresi. */
  addressId?: Id;
  paymentMethodId?: Id;
  /** Yoksa Setting commerce.chargeStrategy. */
  chargeStrategy?: ChargeStrategy;
  /** Kutu içeriği (ürün slug'ları); yoksa haftanın yayınlanmış şablonu. */
  items?: string[];
  extras?: SubExtra[];
  itemPrefs?: Record<string, string>;
  note?: string;
}

export interface AdminCreateSubscriptionResult {
  subscription: Subscription;
  cycle: SubscriptionCycle;
  order: { id: Id; orderNo: number; status: string; grandTotal: Money; prepaidAmount: Money };
  payment: { id: Id; status: string; amount: Money };
}

// ── F9 ekleri (ops ekranları 20/21 — `/admin/ops/*`) — yalnız EKLEME ─────────────────────────────────────────
// Ekran 20 "Teslimat Günü": pick/packing listelerinin yanında günün özeti ve toplu durum ilerletme.
// Zaman: tüm anlar mutlak ISO (istemci saatine güvenilmez — bootstrap `serverNow` ile fark hesaplanır) [B49].

/** Ops gün özetinde bir bölgenin teslimat tarihi satırı (kapasite/kesim durumu). */
export interface OpsDaySummaryZone {
  zoneId: Id;
  zoneSlug: string;
  zoneName: string;
  /** O gün için DeliveryDate satırı yoksa null (hiç sipariş üretilmemiş). */
  deliveryDateId: Id | null;
  cutoffAtIso: IsoDateTime | null;
  /** cutoffAt <= now ya da status !== OPEN. */
  locked: boolean;
  status: string | null;
  capacity: number | null;
  reserved: number | null;
  /** Bu bölgede o güne düşen cycle sayısı (tüm durumlar). */
  cycleCount: number;
  /** Teslimata girecek (CHARGED/PREPARING/OUT_FOR_DELIVERY) cycle sayısı. */
  fulfillableCount: number;
}

/** `GET /admin/ops/day-summary?date=&zone=` — ekran 20 üst şeridi + ekran 21 "bu haftanın kesim durumu". */
export interface OpsDaySummary {
  date: IsoDate;
  /** Filtrelenen bölge slug'ı; tüm bölgeler ise null. */
  zone: string | null;
  serverNowIso: IsoDateTime;
  /** Cycle durum dağılımı (yalnız o gün, sıfır olanlar yazılmaz). */
  cycleCountsByStatus: Partial<Record<CycleStatus, number>>;
  cycleCount: number;
  /** CHARGED + PREPARING + OUT_FOR_DELIVERY (pick/packing listesine giren kutular). */
  fulfillableCount: number;
  deliveredCount: number;
  skippedCount: number;
  /** Ödeme sorunlu cycle'lar (o gün). */
  unpaidCount: number;
  awaitingPaymentCount: number;
  /** Teslimata giren kutuların tier dağılımı. */
  boxCountByTier: Array<{ tierSlug: string; tierLabel: string; count: number }>;
  /** Teslimata giren kutulardaki toplam kutu içi satır ve ekstra satırı. */
  boxItemCount: number;
  extraItemCount: number;
  /** Teslimata giren cycle'ların sipariş toplamı (ana + delta). */
  revenue: Money;
  /** Aboneliğe bağlı olmayan (tekil ürün) siparişler — aynı teslimat günü. */
  standaloneOrderCount: number;
  standaloneOrderRevenue: Money;
  zones: OpsDaySummaryZone[];
}

/** Toplu durum ilerletmede hedef durumlar (ekran 20): cycle'lar için ilk üçü, siparişler için dördü de geçerli. */
export const OPS_BULK_STATUS_VALUES = ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'] as const;
export type OpsBulkStatus = (typeof OPS_BULK_STATUS_VALUES)[number];

/**
 * `POST /admin/ops/bulk-status` — seçili cycle'ları ve/veya siparişleri aynı duruma ilerletir.
 * Varsayılan davranış hep-ya-hiç: bir tanesinin geçişi bile geçersizse hiçbiri uygulanmaz → 409
 * `{error:'OPS_BULK_TRANSITION_INVALID'}`. `skipInvalid:true` verilirse geçersizler atlanır, sonuçta raporlanır.
 * `DELIVERY_FAILED` cycle makinesinde yoktur → cycleIds ile birlikte gönderilirse 409.
 */
export interface OpsBulkStatusRequest {
  cycleIds?: Id[];
  orderIds?: Id[];
  status: OpsBulkStatus;
  note?: string;
  skipInvalid?: boolean;
}

export interface OpsBulkStatusItemResult {
  kind: 'cycle' | 'order';
  id: Id;
  ok: boolean;
  from: string | null;
  to: string;
  /** Başarısızsa hata kodu (CYCLE_TRANSITION_INVALID / ORDER_TRANSITION_INVALID / …). */
  error?: string;
  message?: string;
  /** Bilgi amaçlı: cycle satırında sipariş numarası. */
  orderNo?: number | null;
}

export interface OpsBulkStatusResult {
  status: OpsBulkStatus;
  requested: number;
  updated: number;
  failed: number;
  skipped: number;
  items: OpsBulkStatusItemResult[];
}
