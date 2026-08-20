// ── Paylaşılan enum'lar ───────────────────────────────────────────────────────
// Kaynak: docs/BACKEND-PLANI.md §2 (Prisma şeması, ENUM bloğu). Değerler Prisma
// enum'larıyla BİREBİR aynı string'lerdir; api/admin/(mobil) bu dosyayı import
// eder, kimse kendi kopyasını yazmaz. Kalıp:
//   export const X = { A: 'A', … } as const;   // değer nesnesi (Object.values sırası = Prisma sırası)
//   export type  X = (typeof X)[keyof typeof X]; // union tipi
//   export const X_VALUES: readonly X[]          // doğrulama / select seçenekleri
//   export const X_LABELS: Record<X, string>     // admin'de gösterilecek Türkçe etiket
// Yeni enum değeri eklenirken: Prisma şeması + buradaki üç yapı birlikte güncellenir.

// ── Kullanıcı ─────────────────────────────────────────────────────────────────
export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLE_VALUES: readonly UserRole[] = Object.values(UserRole);
export const USER_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  CUSTOMER: 'Müşteri',
  STAFF: 'Personel',
  ADMIN: 'Yönetici',
};

// ── Katalog ───────────────────────────────────────────────────────────────────
export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  HIDDEN: 'HIDDEN',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];
export const PRODUCT_STATUS_VALUES: readonly ProductStatus[] = Object.values(ProductStatus);
export const PRODUCT_STATUS_LABELS: Readonly<Record<ProductStatus, string>> = {
  DRAFT: 'Taslak',
  ACTIVE: 'Yayında',
  HIDDEN: 'Gizli',
};

/** Müşteri bootstrap'ında yalnız IN_STOCK / LOW görünür; SOLD_OUT ve OUT_OF_SEASON ürünler gömülmez [B22]. */
export const StockStatus = {
  IN_STOCK: 'IN_STOCK',
  LOW: 'LOW',
  SOLD_OUT: 'SOLD_OUT',
  OUT_OF_SEASON: 'OUT_OF_SEASON',
} as const;
export type StockStatus = (typeof StockStatus)[keyof typeof StockStatus];
export const STOCK_STATUS_VALUES: readonly StockStatus[] = Object.values(StockStatus);
export const STOCK_STATUS_LABELS: Readonly<Record<StockStatus, string>> = {
  IN_STOCK: 'Stokta',
  LOW: 'Az kaldı',
  SOLD_OUT: 'Tükendi',
  OUT_OF_SEASON: 'Sezon dışı',
};
/** Bootstrap'ta (müşteriye) gösterilen stok durumları. */
export const BOOTSTRAP_VISIBLE_STOCK_STATUSES: readonly StockStatus[] = [StockStatus.IN_STOCK, StockStatus.LOW];

// ── Teslimat ──────────────────────────────────────────────────────────────────
export const DeliveryDay = {
  SALI: 'SALI',
  PERSEMBE: 'PERSEMBE',
  CUMARTESI: 'CUMARTESI',
} as const;
export type DeliveryDay = (typeof DeliveryDay)[keyof typeof DeliveryDay];
export const DELIVERY_DAY_VALUES: readonly DeliveryDay[] = Object.values(DeliveryDay);
export const DELIVERY_DAY_LABELS: Readonly<Record<DeliveryDay, string>> = {
  SALI: 'Salı',
  PERSEMBE: 'Perşembe',
  CUMARTESI: 'Cumartesi',
};

/** Frontend'in (products.js DELIVERY_DAYS, cart.js CUTOFF_WEEKDAY, sub.deliveryDay) kullandığı gün kimliği. */
export type DeliveryDaySlug = 'sali' | 'persembe' | 'cumartesi';
export const DELIVERY_DAY_SLUG_VALUES: readonly DeliveryDaySlug[] = ['sali', 'persembe', 'cumartesi'];

/**
 * Prisma enum ↔ frontend slug ↔ haftanın günü.
 * `dow`: JS `Date.getDay()` ve ISO hafta günü için aynı sayı (Salı 2, Perşembe 4, Cumartesi 6).
 * Setting `commerce.deliveryDays [{id,label,dow}]` ile aynı şekil.
 */
export const DELIVERY_DAY_META: Readonly<Record<DeliveryDay, { readonly slug: DeliveryDaySlug; readonly label: string; readonly dow: number }>> = {
  SALI: { slug: 'sali', label: 'Salı', dow: 2 },
  PERSEMBE: { slug: 'persembe', label: 'Perşembe', dow: 4 },
  CUMARTESI: { slug: 'cumartesi', label: 'Cumartesi', dow: 6 },
};
export const DELIVERY_DAY_BY_SLUG: Readonly<Record<DeliveryDaySlug, DeliveryDay>> = {
  sali: DeliveryDay.SALI,
  persembe: DeliveryDay.PERSEMBE,
  cumartesi: DeliveryDay.CUMARTESI,
};
export function deliveryDayToSlug(day: DeliveryDay): DeliveryDaySlug {
  return DELIVERY_DAY_META[day].slug;
}
export function deliveryDayFromSlug(slug: string): DeliveryDay | null {
  return (DELIVERY_DAY_BY_SLUG as Record<string, DeliveryDay | undefined>)[slug] ?? null;
}

export const DeliveryDateStatus = {
  OPEN: 'OPEN',
  LOCKED: 'LOCKED',
  CLOSED: 'CLOSED',
} as const;
export type DeliveryDateStatus = (typeof DeliveryDateStatus)[keyof typeof DeliveryDateStatus];
export const DELIVERY_DATE_STATUS_VALUES: readonly DeliveryDateStatus[] = Object.values(DeliveryDateStatus);
export const DELIVERY_DATE_STATUS_LABELS: Readonly<Record<DeliveryDateStatus, string>> = {
  OPEN: 'Açık',
  LOCKED: 'Kilitli (kesim geçti)',
  CLOSED: 'Kapalı',
};

// ── Sipariş ───────────────────────────────────────────────────────────────────
/** Karışık sepette öncelik: SUBSCRIPTION > BOX_ONE_TIME > SINGLE [B15] (bkz. ORDER_KIND_PRIORITY). */
export const OrderKind = {
  SINGLE: 'SINGLE',
  BOX_ONE_TIME: 'BOX_ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];
export const ORDER_KIND_VALUES: readonly OrderKind[] = Object.values(OrderKind);
export const ORDER_KIND_LABELS: Readonly<Record<OrderKind, string>> = {
  SINGLE: 'Tekil ürün',
  BOX_ONE_TIME: 'Tek seferlik kutu',
  SUBSCRIPTION: 'Abonelik',
};
/** Büyük sayı = yüksek öncelik; karışık sepette Order.kind = en yüksek öncelikli tür. */
export const ORDER_KIND_PRIORITY: Readonly<Record<OrderKind, number>> = {
  SINGLE: 1,
  BOX_ONE_TIME: 2,
  SUBSCRIPTION: 3,
};

export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  PREPARING: 'PREPARING',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUS_VALUES: readonly OrderStatus[] = Object.values(OrderStatus);
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'Ödeme bekliyor',
  PAID: 'Ödendi',
  PREPARING: 'Hazırlanıyor',
  OUT_FOR_DELIVERY: 'Yolda',
  DELIVERED: 'Teslim edildi',
  DELIVERY_FAILED: 'Teslim edilemedi',
  CANCELLED: 'İptal edildi',
  REFUNDED: 'İade edildi',
  PAYMENT_FAILED: 'Ödeme başarısız',
};

export const OrderLineKind = {
  PRODUCT: 'PRODUCT',
  BOX: 'BOX',
  EXTRA: 'EXTRA',
} as const;
export type OrderLineKind = (typeof OrderLineKind)[keyof typeof OrderLineKind];
export const ORDER_LINE_KIND_VALUES: readonly OrderLineKind[] = Object.values(OrderLineKind);
export const ORDER_LINE_KIND_LABELS: Readonly<Record<OrderLineKind, string>> = {
  PRODUCT: 'Ürün',
  BOX: 'Kutu',
  EXTRA: 'Ekstra',
};

export const BillingParty = {
  INDIVIDUAL: 'INDIVIDUAL',
  CORPORATE: 'CORPORATE',
} as const;
export type BillingParty = (typeof BillingParty)[keyof typeof BillingParty];
export const BILLING_PARTY_VALUES: readonly BillingParty[] = Object.values(BillingParty);
export const BILLING_PARTY_LABELS: Readonly<Record<BillingParty, string>> = {
  INDIVIDUAL: 'Bireysel',
  CORPORATE: 'Kurumsal',
};

// ── Abonelik ──────────────────────────────────────────────────────────────────
/** PAUSED: şema-var/UI-yok (P2); COMPLETED: tek seferlik kutu teslim edildi [B2]. */
export const SubscriptionStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  PAUSED: 'PAUSED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
export const SUBSCRIPTION_STATUS_VALUES: readonly SubscriptionStatus[] = Object.values(SubscriptionStatus);
export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  PENDING: 'Ödeme bekliyor',
  ACTIVE: 'Aktif',
  PAST_DUE: 'Ödeme gecikmiş',
  PAUSED: 'Duraklatıldı',
  CANCEL_REQUESTED: 'İptal talebi alındı',
  CANCELLED: 'İptal edildi',
  COMPLETED: 'Tamamlandı',
};

/** AWAITING_PAYMENT: PAYMENT_LINK stratejisi (3DS ödeme linki gönderildi, süre doluncaya kadar) [B27]. */
export const CycleStatus = {
  SCHEDULED: 'SCHEDULED',
  LOCKED: 'LOCKED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  SKIPPED: 'SKIPPED',
  CHARGED: 'CHARGED',
  UNPAID: 'UNPAID',
  PREPARING: 'PREPARING',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type CycleStatus = (typeof CycleStatus)[keyof typeof CycleStatus];
export const CYCLE_STATUS_VALUES: readonly CycleStatus[] = Object.values(CycleStatus);
export const CYCLE_STATUS_LABELS: Readonly<Record<CycleStatus, string>> = {
  SCHEDULED: 'Planlandı',
  LOCKED: 'Kilitlendi',
  AWAITING_PAYMENT: 'Ödeme bekliyor (link)',
  SKIPPED: 'Atlandı',
  CHARGED: 'Tahsil edildi',
  UNPAID: 'Tahsil edilemedi',
  PREPARING: 'Hazırlanıyor',
  OUT_FOR_DELIVERY: 'Yolda',
  DELIVERED: 'Teslim edildi',
  CANCELLED: 'İptal edildi',
};

export const CycleItemSource = {
  TEMPLATE: 'TEMPLATE',
  SWAP: 'SWAP',
  EXTRA: 'EXTRA',
  CART_MERGE: 'CART_MERGE',
} as const;
export type CycleItemSource = (typeof CycleItemSource)[keyof typeof CycleItemSource];
export const CYCLE_ITEM_SOURCE_VALUES: readonly CycleItemSource[] = Object.values(CycleItemSource);
export const CYCLE_ITEM_SOURCE_LABELS: Readonly<Record<CycleItemSource, string>> = {
  TEMPLATE: 'Haftanın şablonu',
  SWAP: 'Değiştirildi',
  EXTRA: 'Ekstra',
  CART_MERGE: 'Sepetten eklendi',
};

export const SkipSource = {
  USER: 'USER',
  OPS: 'OPS',
  UNPAID: 'UNPAID',
} as const;
export type SkipSource = (typeof SkipSource)[keyof typeof SkipSource];
export const SKIP_SOURCE_VALUES: readonly SkipSource[] = Object.values(SkipSource);
export const SKIP_SOURCE_LABELS: Readonly<Record<SkipSource, string>> = {
  USER: 'Üye atladı',
  OPS: 'Operasyon atladı',
  UNPAID: 'Tahsil edilemedi',
};

export const ChargeStrategy = {
  MERCHANT_INITIATED: 'MERCHANT_INITIATED',
  PAYMENT_LINK: 'PAYMENT_LINK',
} as const;
export type ChargeStrategy = (typeof ChargeStrategy)[keyof typeof ChargeStrategy];
export const CHARGE_STRATEGY_VALUES: readonly ChargeStrategy[] = Object.values(ChargeStrategy);
export const CHARGE_STRATEGY_LABELS: Readonly<Record<ChargeStrategy, string>> = {
  MERCHANT_INITIATED: 'Saklı karttan tahsilat (NON3D)',
  PAYMENT_LINK: 'Ödeme linki (3DS)',
};

// ── Ödeme ─────────────────────────────────────────────────────────────────────
export const PaymentProvider = {
  IYZICO: 'IYZICO',
  PAYTR: 'PAYTR',
  MANUAL: 'MANUAL',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];
export const PAYMENT_PROVIDER_VALUES: readonly PaymentProvider[] = Object.values(PaymentProvider);
export const PAYMENT_PROVIDER_LABELS: Readonly<Record<PaymentProvider, string>> = {
  IYZICO: 'iyzico',
  PAYTR: 'PayTR',
  MANUAL: 'Manuel',
};

export const PaymentKind = {
  CHECKOUT: 'CHECKOUT',
  CYCLE_CHARGE: 'CYCLE_CHARGE',
  DELTA: 'DELTA',
  RETRY: 'RETRY',
  LINK: 'LINK',
} as const;
export type PaymentKind = (typeof PaymentKind)[keyof typeof PaymentKind];
export const PAYMENT_KIND_VALUES: readonly PaymentKind[] = Object.values(PaymentKind);
export const PAYMENT_KIND_LABELS: Readonly<Record<PaymentKind, string>> = {
  CHECKOUT: 'Checkout (ilk ödeme)',
  CYCLE_CHARGE: 'Dönem tahsilatı',
  DELTA: 'Ek tahsilat (DELTA)',
  RETRY: 'Yeniden deneme',
  LINK: 'Ödeme linki',
};

export const PaymentStatus = {
  PENDING: 'PENDING',
  REQUIRES_3DS: 'REQUIRES_3DS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIAL_REFUNDED: 'PARTIAL_REFUNDED',
  EXPIRED: 'EXPIRED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = Object.values(PaymentStatus);
export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  PENDING: 'Bekliyor',
  REQUIRES_3DS: '3D Secure bekliyor',
  SUCCEEDED: 'Başarılı',
  FAILED: 'Başarısız',
  REFUNDED: 'İade edildi',
  PARTIAL_REFUNDED: 'Kısmi iade',
  EXPIRED: 'Süresi doldu',
};

export const WebhookStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  IGNORED: 'IGNORED',
} as const;
export type WebhookStatus = (typeof WebhookStatus)[keyof typeof WebhookStatus];
export const WEBHOOK_STATUS_VALUES: readonly WebhookStatus[] = Object.values(WebhookStatus);
export const WEBHOOK_STATUS_LABELS: Readonly<Record<WebhookStatus, string>> = {
  RECEIVED: 'Alındı',
  PROCESSED: 'İşlendi',
  FAILED: 'Hata',
  IGNORED: 'Yok sayıldı (çift teslim)',
};

// ── Toptan / içerik / yasal ───────────────────────────────────────────────────
export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  CLOSED: 'CLOSED',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];
export const LEAD_STATUS_VALUES: readonly LeadStatus[] = Object.values(LeadStatus);
export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  NEW: 'Yeni',
  CONTACTED: 'İletişime geçildi',
  CLOSED: 'Kapatıldı',
};

export const ContentStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];
export const CONTENT_STATUS_VALUES: readonly ContentStatus[] = Object.values(ContentStatus);
export const CONTENT_STATUS_LABELS: Readonly<Record<ContentStatus, string>> = {
  DRAFT: 'Taslak',
  PUBLISHED: 'Yayında',
};

/** 8 politika nav'da (showInNav); PREINFO / SUBSCRIPTION_CONTRACT / MARKETING_CONSENT hash/link ile erişilir [B16]. */
export const LegalKind = {
  PRIVACY: 'PRIVACY',
  TERMS: 'TERMS',
  DISTANCE_SALES: 'DISTANCE_SALES',
  DELIVERY: 'DELIVERY',
  RETURNS: 'RETURNS',
  KVKK: 'KVKK',
  COOKIE: 'COOKIE',
  COOKIE_SETTINGS: 'COOKIE_SETTINGS',
  PREINFO: 'PREINFO',
  SUBSCRIPTION_CONTRACT: 'SUBSCRIPTION_CONTRACT',
  MARKETING_CONSENT: 'MARKETING_CONSENT',
} as const;
export type LegalKind = (typeof LegalKind)[keyof typeof LegalKind];
export const LEGAL_KIND_VALUES: readonly LegalKind[] = Object.values(LegalKind);
export const LEGAL_KIND_LABELS: Readonly<Record<LegalKind, string>> = {
  PRIVACY: 'Gizlilik Politikası',
  TERMS: 'Kullanım Koşulları',
  DISTANCE_SALES: 'Mesafeli Satış Sözleşmesi',
  DELIVERY: 'Teslimat Politikası',
  RETURNS: 'İade ve Cayma Politikası',
  KVKK: 'KVKK Aydınlatma Metni',
  COOKIE: 'Çerez Politikası',
  COOKIE_SETTINGS: 'Çerez Tercihleri',
  PREINFO: 'Ön Bilgilendirme Formu',
  SUBSCRIPTION_CONTRACT: 'Abonelik Sözleşmesi',
  MARKETING_CONSENT: 'Ticari Elektronik İleti İzni',
};

export const ConsentKind = {
  PREINFO_ACK: 'PREINFO_ACK',
  CONTRACT_ACK: 'CONTRACT_ACK',
  SUBSCRIPTION_CONTRACT_ACK: 'SUBSCRIPTION_CONTRACT_ACK',
  KVKK_ACK: 'KVKK_ACK',
  MARKETING_EMAIL: 'MARKETING_EMAIL',
  MARKETING_SMS: 'MARKETING_SMS',
  COOKIE_ANALYTICS: 'COOKIE_ANALYTICS',
  COOKIE_MARKETING: 'COOKIE_MARKETING',
} as const;
export type ConsentKind = (typeof ConsentKind)[keyof typeof ConsentKind];
export const CONSENT_KIND_VALUES: readonly ConsentKind[] = Object.values(ConsentKind);
export const CONSENT_KIND_LABELS: Readonly<Record<ConsentKind, string>> = {
  PREINFO_ACK: 'Ön bilgilendirme formu onayı',
  CONTRACT_ACK: 'Mesafeli satış sözleşmesi onayı',
  SUBSCRIPTION_CONTRACT_ACK: 'Abonelik sözleşmesi onayı',
  KVKK_ACK: 'KVKK aydınlatma metni onayı',
  MARKETING_EMAIL: 'E-posta ile ticari ileti izni',
  MARKETING_SMS: 'SMS ile ticari ileti izni',
  COOKIE_ANALYTICS: 'Analitik çerez izni',
  COOKIE_MARKETING: 'Pazarlama çerezi izni',
};

export const IysStatus = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
} as const;
export type IysStatus = (typeof IysStatus)[keyof typeof IysStatus];
export const IYS_STATUS_VALUES: readonly IysStatus[] = Object.values(IysStatus);
export const IYS_STATUS_LABELS: Readonly<Record<IysStatus, string>> = {
  NOT_APPLICABLE: 'İYS kapsamı dışında',
  PENDING: 'İYS bildirimi bekliyor',
  SYNCED: "İYS'ye iletildi",
  FAILED: 'İYS hatası',
};

// ── İptal / retention ─────────────────────────────────────────────────────────
/** uyelik.html iptal akışındaki `data-reason` değerleriyle eşlenir. */
export const CancelReason = {
  PRICE: 'PRICE',
  VARIETY: 'VARIETY',
  DELIVERY_DAYS: 'DELIVERY_DAYS',
  OTHER: 'OTHER',
} as const;
export type CancelReason = (typeof CancelReason)[keyof typeof CancelReason];
export const CANCEL_REASON_VALUES: readonly CancelReason[] = Object.values(CancelReason);
export const CANCEL_REASON_LABELS: Readonly<Record<CancelReason, string>> = {
  PRICE: 'Fiyat',
  VARIETY: 'Çeşitlilik',
  DELIVERY_DAYS: 'Teslimat günleri',
  OTHER: 'Diğer',
};

/** Her iptal akışı bir SubscriptionCancellation satırı; outcome akışın sonucu [B8]. */
export const CancelOutcome = {
  PENDING: 'PENDING',
  RETENTION_ACCEPTED: 'RETENTION_ACCEPTED',
  CANCELLED: 'CANCELLED',
  ABANDONED: 'ABANDONED',
} as const;
export type CancelOutcome = (typeof CancelOutcome)[keyof typeof CancelOutcome];
export const CANCEL_OUTCOME_VALUES: readonly CancelOutcome[] = Object.values(CancelOutcome);
export const CANCEL_OUTCOME_LABELS: Readonly<Record<CancelOutcome, string>> = {
  PENDING: 'Bekliyor',
  RETENTION_ACCEPTED: 'Teklif kabul edildi',
  CANCELLED: 'İptal edildi',
  ABANDONED: 'Vazgeçildi',
};

// ── Abonelik olay günlüğü ─────────────────────────────────────────────────────
/** SubscriptionEvent.type — durum makinesi geçişlerinin tetikleyici adları bu enum'la uyumludur (bkz. state-machines/). */
export const SubEventType = {
  CREATED: 'CREATED',
  ACTIVATED: 'ACTIVATED',
  TIER_CHANGED: 'TIER_CHANGED',
  FREQ_CHANGED: 'FREQ_CHANGED',
  DAY_CHANGED: 'DAY_CHANGED',
  PREF_CHANGED: 'PREF_CHANGED',
  SWAP: 'SWAP',
  EXTRA_ADDED: 'EXTRA_ADDED',
  EXTRA_REMOVED: 'EXTRA_REMOVED',
  CART_MERGED: 'CART_MERGED',
  SKIP: 'SKIP',
  UNSKIP: 'UNSKIP',
  LOCKED: 'LOCKED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CHARGED: 'CHARGED',
  DELTA_CHARGED: 'DELTA_CHARGED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  RETRY: 'RETRY',
  UNPAID: 'UNPAID',
  CARD_UPDATED: 'CARD_UPDATED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  RETENTION_OFFERED: 'RETENTION_OFFERED',
  RETENTION_USED: 'RETENTION_USED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  PAUSED: 'PAUSED',
  RESUMED: 'RESUMED',
  ADMIN_NOTE: 'ADMIN_NOTE',
} as const;
export type SubEventType = (typeof SubEventType)[keyof typeof SubEventType];
export const SUB_EVENT_TYPE_VALUES: readonly SubEventType[] = Object.values(SubEventType);
export const SUB_EVENT_TYPE_LABELS: Readonly<Record<SubEventType, string>> = {
  CREATED: 'Abonelik oluşturuldu',
  ACTIVATED: 'Aktifleştirildi (ilk ödeme)',
  TIER_CHANGED: 'Kutu boyu değişti',
  FREQ_CHANGED: 'Sıklık değişti',
  DAY_CHANGED: 'Teslimat günü değişti',
  PREF_CHANGED: 'Ürün tercihi değişti',
  SWAP: 'Ürün değiştirildi',
  EXTRA_ADDED: 'Ekstra eklendi',
  EXTRA_REMOVED: 'Ekstra çıkarıldı',
  CART_MERGED: 'Sepet kutuya eklendi',
  SKIP: 'Hafta atlandı',
  UNSKIP: 'Atlama geri alındı',
  LOCKED: 'Kesim: kilitlendi',
  AWAITING_PAYMENT: 'Ödeme linki gönderildi',
  CHARGED: 'Tahsil edildi',
  DELTA_CHARGED: 'Ek tutar tahsil edildi',
  PAYMENT_FAILED: 'Tahsilat başarısız',
  RETRY: 'Tahsilat yeniden denendi',
  UNPAID: 'Tahsil edilemedi',
  CARD_UPDATED: 'Kart güncellendi',
  CANCEL_REQUESTED: 'İptal talebi',
  RETENTION_OFFERED: 'Kalma teklifi sunuldu',
  RETENTION_USED: 'Kalma teklifi kullanıldı',
  CANCELLED: 'İptal edildi',
  COMPLETED: 'Tamamlandı',
  PAUSED: 'Duraklatıldı',
  RESUMED: 'Devam ettirildi',
  ADMIN_NOTE: 'Yönetici notu',
};

// ── E-posta ───────────────────────────────────────────────────────────────────
export const MailStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type MailStatus = (typeof MailStatus)[keyof typeof MailStatus];
export const MAIL_STATUS_VALUES: readonly MailStatus[] = Object.values(MailStatus);
export const MAIL_STATUS_LABELS: Readonly<Record<MailStatus, string>> = {
  QUEUED: 'Kuyrukta',
  SENT: 'Gönderildi',
  FAILED: 'Hata',
  SKIPPED: 'Atlandı (DISABLE_MAIL)',
};
