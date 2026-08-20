// ── Ayarlar (Setting tablosu) DTO'ları ───────────────────────────────────────
import { CHARGE_STRATEGY_LABELS, CHARGE_STRATEGY_VALUES, type ChargeStrategy, type DeliveryDaySlug } from '../enums';
import type { Id, IsoDateTime } from './common';

/** Setting satırı — `isSecret` olanların değeri admin'e maskeli döner (`"••••"`). */
export interface Setting {
  key: string;
  group: string;
  value: unknown;
  isSecret: boolean;
  updatedAt: IsoDateTime;
}

/** `GET/PUT /admin/settings/:group` — anahtar → değer. */
export type SettingGroupValues = Record<string, unknown>;

/** Setting `commerce.deliveryDays` öğesi. */
export interface CommerceDeliveryDay {
  id: DeliveryDaySlug;
  label: string;
  /** Haftanın günü: Salı 2, Perşembe 4, Cumartesi 6. */
  dow: number;
}

/** Setting `commerce.frequencies` öğesi (bootstrap FreqOption'a `{id,label,note,allDays:false}` olarak basılır). */
export interface CommerceFrequency {
  id: string;
  weeks: number;
  label: string;
}

// ── Fiyatlama kuralları (ADR-0018) — kodda sabit değil, Setting `commerce.*` ile admin'den değiştirilebilir ───────
// Kalıp enums.ts ile aynı (değer nesnesi + union + _VALUES + _LABELS); Prisma enum'u DEĞİLDİR (Setting JSON değeri).

/** Ücretsiz kargo eşik karşılaştırması: `gte` = ara toplam ≥ eşik → ücretsiz (varsayılan); `gt` = eşiği aşınca (prototip `> 1000`). */
export const FreeShippingRule = {
  GTE: 'gte',
  GT: 'gt',
} as const;
export type FreeShippingRule = (typeof FreeShippingRule)[keyof typeof FreeShippingRule];
export const FREE_SHIPPING_RULE_VALUES: readonly FreeShippingRule[] = Object.values(FreeShippingRule);
export const FREE_SHIPPING_RULE_LABELS: Readonly<Record<FreeShippingRule, string>> = {
  gte: 'Eşik ve üzeri ücretsiz (≥ eşik)',
  gt: 'Eşiği aşınca ücretsiz (> eşik)',
};

/** İndirim tutarı yuvarlama: `kurus` = kuruş hassasiyeti (649 × %50 = 324,50; varsayılan); `tl` = tam TL'ye (Math.round → 325, prototip). */
export const DiscountRounding = {
  KURUS: 'kurus',
  TL: 'tl',
} as const;
export type DiscountRounding = (typeof DiscountRounding)[keyof typeof DiscountRounding];
export const DISCOUNT_ROUNDING_VALUES: readonly DiscountRounding[] = Object.values(DiscountRounding);
export const DISCOUNT_ROUNDING_LABELS: Readonly<Record<DiscountRounding, string>> = {
  kurus: 'Kuruş hassasiyeti (324,50)',
  tl: 'Tam TL’ye yuvarla (325)',
};

/**
 * Setting `commerce.*` anahtarları (BACKEND-PLANI §2 "Setting anahtarları"). Kargo/eşik BURADA YOK (DeliveryZone) [B11].
 * Bootstrap'a gizli olmayan alanlar gider (`BootstrapPayload.commerce`).
 */
export interface CommerceSettings {
  vatRate: number;
  deliveryDays: CommerceDeliveryDay[];
  frequencies: CommerceFrequency[];
  cutoff: { daysBefore: number; time: string };
  firstBoxDiscount: { pct: number; boxes: number; perUserOnce: boolean };
  skipsPerYear: number;
  firstCycleSkippable: boolean;
  retentionOffer: { pct: number; boxes: number; perUserOnce: boolean };
  /** Birim → çarpan listesi; `default` sayılı birimler için. Ör. `{kg:[0.25,0.5,1,2],"500 g":[1,2,3],default:[1,2,3,4]}`. */
  extraAmountOptions: Record<string, number[]>;
  deliveryWindow: string;
  deliveryDatesHorizonWeeks: number;
  dunning: { retryHours: number[]; pastDueAfterUnpaid: number };
  chargeStrategy: ChargeStrategy;
  paymentLinkHours: number;
  // ── Fiyatlama kuralları (ADR-0018; admin F5 Ayarlar › Kampanya/Bölgeler) — pricing `PricingRules` bunları okur ──
  /** Ücretsiz kargo eşiği karşılaştırması: `gte` ≥ eşik ücretsiz (varsayılan) · `gt` eşiği aşınca. Eşik değeri DeliveryZone'da. */
  freeShippingRule: FreeShippingRule;
  /** İlk-2-kutu / retention indirim tutarı yuvarlaması: `kurus` 324,50 (varsayılan) · `tl` tam TL 325. */
  discountRounding: DiscountRounding;
  /**
   * Aktif abonesi olan müşterinin TEKİL ürün (SINGLE) siparişinde kargo 0 mı? `true` (varsayılan) → 0;
   * `false` → bölge kuralı (eşik/ücret). Abonelik siparişinin kendisinde kargo her zaman 0 (ADR-0005).
   */
  subscriberFreeShipping: boolean;
}

/** Setting varsayılanları — seed ve testlerde tek kaynak (BACKEND-PLANI §2). */
export const COMMERCE_SETTINGS_DEFAULTS: Readonly<CommerceSettings> = {
  vatRate: 1,
  deliveryDays: [
    { id: 'sali', label: 'Salı', dow: 2 },
    { id: 'persembe', label: 'Perşembe', dow: 4 },
    { id: 'cumartesi', label: 'Cumartesi', dow: 6 },
  ],
  frequencies: [
    { id: '1hafta', weeks: 1, label: 'Haftada 1' },
    { id: '2hafta', weeks: 2, label: '2 haftada bir' },
    { id: '4hafta', weeks: 4, label: '4 haftada bir' },
  ],
  cutoff: { daysBefore: 1, time: '12:00' },
  firstBoxDiscount: { pct: 50, boxes: 2, perUserOnce: true },
  skipsPerYear: 1,
  firstCycleSkippable: false,
  retentionOffer: { pct: 50, boxes: 1, perUserOnce: true },
  extraAmountOptions: { kg: [0.25, 0.5, 1, 2], '500 g': [1, 2, 3], default: [1, 2, 3, 4] },
  deliveryWindow: '09:00–18:00',
  deliveryDatesHorizonWeeks: 8,
  dunning: { retryHours: [2, 12], pastDueAfterUnpaid: 2 },
  chargeStrategy: 'MERCHANT_INITIATED',
  paymentLinkHours: 20,
  freeShippingRule: 'gte',
  discountRounding: 'kurus',
  subscriberFreeShipping: true,
};

/** Setting `cookies.*`. */
export interface CookieSettings {
  analyticsEnabled: boolean;
}

/** Setting `seo.*` — sayfa başlıkları (anahtar = sayfa slug'ı). */
export type SeoSettings = Record<string, { title: string; description?: string }>;

/** Admin `POST /admin/settings/mail/test`. */
export interface MailTestRequest {
  to: string;
}

export interface SettingAuditRef {
  key: string;
  updatedBy?: Id | null;
  updatedAt: IsoDateTime;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// F5 — SETTINGS_REGISTRY: admin Ayarlar ekranları (14a/15) ve SettingsService'in TEK şema kaynağı (BACKEND-PLANI §2
// "Setting anahtarları", §4 ekran 14a/15, ADR-0014/0015/0018). Setting satırı anahtarı = `<group>.<field>`
// (mevcut `commerce.*`, `cookies.*`, `payment.*`, `seo.*` seed satırlarıyla uyumlu). `secret` tipli alanlar DB'de
// AES-256-GCM şifreli (apps/api common/crypto.util) tutulur, admin'e maskeli döner; admin boş/maske gönderirse değişmez.
// Yalnız EKLEME: yukarıdaki CommerceSettings / COMMERCE_SETTINGS_DEFAULTS değişmez; registry onları referans alır.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Admin formunun çizdiği alan tipleri. `secret` = text gibi girilir, maskeli okunur; `json` = yapılı değer (textarea/özel editör). */
export type SettingFieldType = 'text' | 'number' | 'boolean' | 'select' | 'secret' | 'json' | 'textarea';

export interface SettingSelectOption {
  value: string;
  label: string;
}

/** Bir ayar alanının şeması — `key` grup öneksiz alan adı (Setting.key = `<group>.<key>`). */
export interface SettingFieldMeta {
  key: string;
  label: string;
  type: SettingFieldType;
  /** Yalnız `select`. */
  options?: readonly SettingSelectOption[];
  help?: string;
  /** DB'de satır yoksa dönen değer (secret için anlamsız; yoksa `''`). */
  default?: unknown;
  /** Zorunlu alan (PUT'ta `null`/boş verilemez). Varsayılan false. */
  required?: boolean;
  /** number: izinli aralık (tam sayı isteniyorsa `integer`). */
  min?: number;
  max?: number;
  integer?: boolean;
}

export const SETTING_GROUP_NAMES = ['commerce', 'site', 'seo', 'cookies', 'mail', 'sms', 'payment'] as const;
export type SettingGroupName = (typeof SETTING_GROUP_NAMES)[number];

export interface SettingGroupMeta {
  group: SettingGroupName;
  label: string;
  description?: string;
  fields: readonly SettingFieldMeta[];
}

/** Admin'e dönen maske (secret alan değeri varsa). PUT'ta bu değer ya da boş metin gelirse alan DEĞİŞMEZ. */
export const SETTINGS_SECRET_MASK = '••••••';

/** `GET /admin/settings` / `GET /admin/settings/:group` alanı: şema + değer (secret → maske + hasValue). */
export interface AdminSettingField extends SettingFieldMeta {
  /** Çözümlenmiş değer (DB ya da default); secret: `SETTINGS_SECRET_MASK` ya da `''`. */
  value: unknown;
  isSecret: boolean;
  /** Yalnız secret: DB'de dolu bir değer var mı. */
  hasValue?: boolean;
  /** DB satırı varsa güncelleme anı; yoksa null (varsayılan gösteriliyor). */
  updatedAt: IsoDateTime | null;
}

export interface AdminSettingGroup {
  group: SettingGroupName;
  label: string;
  description?: string;
  fields: AdminSettingField[];
}

/** `PUT /admin/settings/:group` gövdesi — yalnız gönderilen alanlar yazılır (alan adı → değer). */
export type AdminSettingGroupPatch = Record<string, unknown>;

// ── Grup değer tipleri (SettingsService.get(group) çıktıları; sırlar ÇÖZÜLMÜŞ — yalnız sunucu içi) ───────────

export interface SiteSettings {
  name: string;
  /** Ticari unvan (fatura/sözleşme metinleri). */
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  instagramUrl: string;
}

export type MailProvider = 'smtp' | 'resend' | 'ses';
export const MAIL_PROVIDER_VALUES: readonly MailProvider[] = ['smtp', 'resend', 'ses'];

export interface MailSettings {
  provider: MailProvider;
  host: string;
  port: number;
  user: string;
  /** secret */
  pass: string;
  from: string;
  fromName: string;
}

export type SmsProvider = 'netgsm';
export const SMS_PROVIDER_VALUES: readonly SmsProvider[] = ['netgsm'];

export interface SmsSettings {
  provider: SmsProvider;
  user: string;
  /** secret */
  pass: string;
  /** Gönderici başlığı (Netgsm "mesaj başlığı"). */
  header: string;
}

/** Setting `payment.provider` — ADR-0019: PayTR birincil, manuel geliştirme/test; iyzico P2 (registry'de yok). */
export type PaymentProviderSetting = 'paytr' | 'manual';
export const PAYMENT_PROVIDER_SETTING_VALUES: readonly PaymentProviderSetting[] = ['paytr', 'manual'];

/**
 * Setting `payment.*` (ADR-0019 PayTR). Sırlar (merchantKey/merchantSalt) DB'de şifreli; `.env PAYTR_*` yedek
 * (apps/api PayTrConfigService: Setting dolu → Setting, boş → env). Prod'da Setting boşsa env zorunlu.
 */
export interface PaymentSettings {
  provider: PaymentProviderSetting;
  /** PayTR mağaza no (merchant_id). */
  paytrMerchantId: string;
  /** secret — PayTR merchant_key (HMAC anahtarı). */
  paytrMerchantKey: string;
  /** secret — PayTR merchant_salt. */
  paytrMerchantSalt: string;
  /** PayTR test modu (test_mode=1; canlı mağazada test işlemi). Lansmanda kapatılır (F11 checklist). */
  paytrTestMode: boolean;
  /** PayTR bildirim (callback) IP allowlist — virgülle ayrılmış; boşsa IP kontrolü yok (yalnız hash). */
  paytrCallbackAllowedIps: string;
  /** PayTR kayıtlı kart / tekrarlayan tahsilat (utoken/ctoken, non_3d) onayı alındı mı → MERCHANT_INITIATED mümkün; yoksa PAYMENT_LINK. */
  storedCardEnabled: boolean;
  /** Saklı karttan NON3D (merchant-initiated) yetkisi yazılı teyit edildi mi (F11 kararı). */
  nonThreeDsGranted: boolean;
  /** Azami taksit (1 = taksit yok → no_installment=1). */
  maxInstallment: number;
  /** Ödeme alma açık mı (kapalıysa checkout bakım metni). */
  enabled: boolean;
}

/** `cookies.*` — ADR-0015: analytics varsayılan false; marketing (F10 banner) varsayılan false. */
export interface CookieSettingsFull extends CookieSettings {
  marketingEnabled: boolean;
}

export const SITE_SETTINGS_DEFAULTS: Readonly<SiteSettings> = {
  name: 'Bağdam',
  legalName: '',
  contactEmail: '',
  contactPhone: '+90 (530) 949 40 93',
  instagramUrl: '',
};

export const MAIL_SETTINGS_DEFAULTS: Readonly<MailSettings> = {
  provider: 'smtp',
  host: '',
  port: 587,
  user: '',
  pass: '',
  from: '',
  fromName: 'Bağdam',
};

export const SMS_SETTINGS_DEFAULTS: Readonly<SmsSettings> = {
  provider: 'netgsm',
  user: '',
  pass: '',
  header: '',
};

export const PAYMENT_SETTINGS_DEFAULTS: Readonly<PaymentSettings> = {
  provider: 'manual',
  paytrMerchantId: '',
  paytrMerchantKey: '',
  paytrMerchantSalt: '',
  paytrTestMode: true,
  paytrCallbackAllowedIps: '',
  storedCardEnabled: false,
  nonThreeDsGranted: false,
  maxInstallment: 1,
  enabled: false,
};

export const COOKIE_SETTINGS_DEFAULTS: Readonly<CookieSettingsFull> = {
  analyticsEnabled: false,
  marketingEnabled: false,
};

/**
 * SEO sayfaları — Setting `seo.<sayfa> = {title, description?}` (seed ile aynı anahtarlar; WebController <title>).
 * Sayfa adı = views/<sayfa>.hbs.
 */
export const SEO_PAGES: readonly { readonly page: string; readonly label: string; readonly defaultTitle: string }[] = [
  { page: 'index', label: 'Ana sayfa', defaultTitle: "Bağdam — Urla'dan sofrana" },
  { page: 'urunler', label: 'Ürünler', defaultTitle: 'Bağdam — ürünler' },
  { page: 'urun', label: 'Ürün detayı', defaultTitle: 'Bağdam — ürün' },
  { page: 'kutu', label: 'Kutu', defaultTitle: 'Bağdam — kutu' },
  { page: 'sepet', label: 'Sepet', defaultTitle: 'Bağdam — sepet' },
  { page: 'uyelik', label: 'Üyelik', defaultTitle: 'Bağdam — üyelik' },
  { page: 'gunluk', label: 'Günlük', defaultTitle: 'Bağdam — günlük' },
  { page: 'nasil-seciyoruz', label: 'Nasıl seçiyoruz', defaultTitle: 'Bağdam — nasıl seçiyoruz' },
  { page: 'politikalar', label: 'Politikalar', defaultTitle: 'Bağdam — politikalar' },
  { page: 'toptan', label: 'Toptan', defaultTitle: 'Bağdam — toptan' },
  { page: '404', label: '404', defaultTitle: 'Bağdam — sayfa bulunamadı' },
  { page: 'coming-soon', label: 'Yakında', defaultTitle: "Bağdam — Urla'dan sofrana, yakında" },
];

/** `commerce.*` alanları — COMMERCE_SETTINGS_DEFAULTS ile aynı anahtarlar; ADR-0018 üç kural select/boolean. */
const COMMERCE_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'vatRate', label: 'Varsayılan KDV oranı (%)', type: 'number', min: 0, max: 100, required: true, default: COMMERCE_SETTINGS_DEFAULTS.vatRate, help: 'Ürün bazlı KDV ürün formunda; bu değer yeni ürünlerin varsayılanı.' },
  { key: 'deliveryDays', label: 'Teslimat günleri', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.deliveryDays, help: '[{id:"sali"|"persembe"|"cumartesi", label, dow}] — bootstrap DELIVERY_DAYS ve teslimat tarihi üretimi buradan.' },
  { key: 'frequencies', label: 'Abonelik sıklıkları', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.frequencies, help: '[{id, weeks, label}] — bootstrap FREQ_OPTIONS.' },
  { key: 'cutoff', label: 'Kesim kuralı', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.cutoff, help: '{daysBefore, time:"HH:mm"} — teslimattan kaç gün önce saat kaçta (ADR-0005: 1 gün önce 12:00).' },
  { key: 'firstBoxDiscount', label: 'İlk kutu indirimi', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.firstBoxDiscount, help: '{pct, boxes, perUserOnce} — ADR-0007 ilk 2 kutu %50.' },
  { key: 'skipsPerYear', label: 'Yılda atlama hakkı', type: 'number', integer: true, min: 0, max: 52, required: true, default: COMMERCE_SETTINGS_DEFAULTS.skipsPerYear },
  { key: 'firstCycleSkippable', label: 'İlk kutu atlanabilir', type: 'boolean', default: COMMERCE_SETTINGS_DEFAULTS.firstCycleSkippable },
  { key: 'retentionOffer', label: 'İptalde tutma teklifi', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.retentionOffer, help: '{pct, boxes, perUserOnce}.' },
  { key: 'extraAmountOptions', label: 'Ekstra miktar seçenekleri', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.extraAmountOptions, help: 'Birim → çarpan listesi; `default` zorunlu. Ör. {kg:[0.25,0.5,1,2],"500 g":[1,2,3],default:[1,2,3,4]}.' },
  { key: 'deliveryWindow', label: 'Teslimat saat aralığı', type: 'text', required: true, default: COMMERCE_SETTINGS_DEFAULTS.deliveryWindow },
  { key: 'deliveryDatesHorizonWeeks', label: 'Teslimat tarihi ufku (hafta)', type: 'number', integer: true, min: 1, max: 26, required: true, default: COMMERCE_SETTINGS_DEFAULTS.deliveryDatesHorizonWeeks, help: 'delivery-dates:generate kaç hafta ileri üretir.' },
  { key: 'dunning', label: 'Tahsilat yeniden deneme', type: 'json', required: true, default: COMMERCE_SETTINGS_DEFAULTS.dunning, help: '{retryHours: [2, 12], pastDueAfterUnpaid:2}.' },
  { key: 'chargeStrategy', label: 'Tahsilat stratejisi', type: 'select', options: CHARGE_STRATEGY_VALUES.map((value) => ({ value, label: CHARGE_STRATEGY_LABELS[value] })), required: true, default: COMMERCE_SETTINGS_DEFAULTS.chargeStrategy, help: 'NON3D yetkisi yoksa PAYMENT_LINK (F11 B planı).' },
  { key: 'paymentLinkHours', label: 'Ödeme linki süresi (saat)', type: 'number', integer: true, min: 1, max: 168, required: true, default: COMMERCE_SETTINGS_DEFAULTS.paymentLinkHours },
  { key: 'freeShippingRule', label: 'Ücretsiz kargo eşiği karşılaştırması', type: 'select', options: FREE_SHIPPING_RULE_VALUES.map((value) => ({ value, label: FREE_SHIPPING_RULE_LABELS[value] })), required: true, default: COMMERCE_SETTINGS_DEFAULTS.freeShippingRule, help: 'Eşik tutarı bölgede (Ayarlar › Bölgeler). ADR-0018.' },
  { key: 'discountRounding', label: 'İndirim yuvarlaması', type: 'select', options: DISCOUNT_ROUNDING_VALUES.map((value) => ({ value, label: DISCOUNT_ROUNDING_LABELS[value] })), required: true, default: COMMERCE_SETTINGS_DEFAULTS.discountRounding, help: 'ADR-0018.' },
  { key: 'subscriberFreeShipping', label: 'Aktif aboneye tekil üründe kargo ücretsiz', type: 'boolean', default: COMMERCE_SETTINGS_DEFAULTS.subscriberFreeShipping, help: 'Kapalıysa bölge kuralı uygulanır. ADR-0018.' },
];

const SITE_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'name', label: 'Site adı', type: 'text', required: true, default: SITE_SETTINGS_DEFAULTS.name },
  { key: 'legalName', label: 'Ticari unvan', type: 'text', default: SITE_SETTINGS_DEFAULTS.legalName, help: 'Fatura/sözleşme metinlerinde.' },
  { key: 'contactEmail', label: 'İletişim e-postası', type: 'text', default: SITE_SETTINGS_DEFAULTS.contactEmail },
  { key: 'contactPhone', label: 'İletişim telefonu', type: 'text', default: SITE_SETTINGS_DEFAULTS.contactPhone },
  { key: 'instagramUrl', label: 'Instagram adresi', type: 'text', default: SITE_SETTINGS_DEFAULTS.instagramUrl },
];

const SEO_FIELDS: readonly SettingFieldMeta[] = [
  ...SEO_PAGES.map<SettingFieldMeta>((p) => ({
    key: p.page,
    label: `${p.label} — başlık/açıklama`,
    type: 'json',
    default: { title: p.defaultTitle },
    help: '{title, description?} — sayfanın <title> ve meta description değeri.',
  })),
  { key: 'description', label: 'Varsayılan açıklama (meta description)', type: 'textarea', default: '', help: 'Sayfa özelinde açıklama yoksa bu kullanılır.' },
  { key: 'ogImage', label: 'Paylaşım görseli (og:image URL)', type: 'text', default: '' },
];

const MAIL_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'provider', label: 'Sağlayıcı', type: 'select', options: [{ value: 'smtp', label: 'SMTP' }, { value: 'resend', label: 'Resend' }, { value: 'ses', label: 'Amazon SES' }], required: true, default: MAIL_SETTINGS_DEFAULTS.provider },
  { key: 'host', label: 'SMTP sunucusu', type: 'text', default: MAIL_SETTINGS_DEFAULTS.host },
  { key: 'port', label: 'SMTP portu', type: 'number', integer: true, min: 1, max: 65535, default: MAIL_SETTINGS_DEFAULTS.port, help: '587 STARTTLS / 465 SSL.' },
  { key: 'user', label: 'SMTP kullanıcı adı', type: 'text', default: MAIL_SETTINGS_DEFAULTS.user },
  { key: 'pass', label: 'SMTP parolası', type: 'secret', help: 'Şifreli saklanır; boş bırakılırsa değişmez.' },
  { key: 'from', label: 'Gönderen adresi', type: 'text', default: MAIL_SETTINGS_DEFAULTS.from, help: 'DKIM imzalı alan adından (ADR-0014).' },
  { key: 'fromName', label: 'Gönderen adı', type: 'text', default: MAIL_SETTINGS_DEFAULTS.fromName },
];

const SMS_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'provider', label: 'Sağlayıcı', type: 'select', options: [{ value: 'netgsm', label: 'Netgsm' }], required: true, default: SMS_SETTINGS_DEFAULTS.provider },
  { key: 'user', label: 'Kullanıcı adı', type: 'text', default: SMS_SETTINGS_DEFAULTS.user },
  { key: 'pass', label: 'Parola', type: 'secret', help: 'Şifreli saklanır; boş bırakılırsa değişmez.' },
  { key: 'header', label: 'Mesaj başlığı', type: 'text', default: SMS_SETTINGS_DEFAULTS.header },
];

/** `payment.*` alanları — ADR-0019 PayTR (iFrame API + callback + Link API + Kayıtlı Kart API); iyzico P2. */
const PAYMENT_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'provider', label: 'Sağlayıcı', type: 'select', options: [{ value: 'paytr', label: 'PayTR' }, { value: 'manual', label: 'Manuel (geliştirme/test)' }], required: true, default: PAYMENT_SETTINGS_DEFAULTS.provider, help: 'Manuel sağlayıcı gerçek tahsilat yapmaz; canlıda PayTR seçilmelidir (F11 checklist).' },
  { key: 'paytrMerchantId', label: 'PayTR mağaza no (merchant_id)', type: 'text', default: PAYMENT_SETTINGS_DEFAULTS.paytrMerchantId, help: 'PayTR paneli › Destek & Kurulum › Entegrasyon Bilgileri. Boşsa .env PAYTR_MERCHANT_ID.' },
  { key: 'paytrMerchantKey', label: 'PayTR merchant_key', type: 'secret', help: 'Şifreli saklanır; boş bırakılırsa değişmez. Boşsa .env PAYTR_MERCHANT_KEY.' },
  { key: 'paytrMerchantSalt', label: 'PayTR merchant_salt', type: 'secret', help: 'Şifreli saklanır; boş bırakılırsa değişmez. Boşsa .env PAYTR_MERCHANT_SALT.' },
  { key: 'paytrTestMode', label: 'PayTR test modu', type: 'boolean', default: PAYMENT_SETTINGS_DEFAULTS.paytrTestMode, help: 'Açıkken işlemler test_mode=1 ile gider (gerçek tahsilat yok). Lansmanda KAPATILMALI — panelde uyarı gösterilir.' },
  { key: 'paytrCallbackAllowedIps', label: 'PayTR bildirim IP allowlist', type: 'text', default: PAYMENT_SETTINGS_DEFAULTS.paytrCallbackAllowedIps, help: 'Virgülle ayrılmış IP listesi (PayTR bildirim sunucuları). Boşsa yalnız hash doğrulaması yapılır.' },
  { key: 'storedCardEnabled', label: 'Kayıtlı kart / tekrarlayan tahsilat açık', type: 'boolean', default: PAYMENT_SETTINGS_DEFAULTS.storedCardEnabled, help: 'PayTR kayıtlı kart (utoken/ctoken) onayı alındıysa aç → saklı karttan tahsilat (MERCHANT_INITIATED). Kapalıyken abonelik tahsilatı ödeme linkiyle (PAYMENT_LINK).' },
  { key: 'nonThreeDsGranted', label: 'NON3D (saklı karttan) yetkisi alındı', type: 'boolean', default: PAYMENT_SETTINGS_DEFAULTS.nonThreeDsGranted, help: 'PayTR non_3d onayı yazılı teyit edildi mi (F11 kararı: commerce.chargeStrategy).' },
  { key: 'maxInstallment', label: 'Azami taksit', type: 'number', integer: true, min: 1, max: 12, required: true, default: PAYMENT_SETTINGS_DEFAULTS.maxInstallment, help: '1 = taksit yok (no_installment=1). 2–12 taksit seçeneği açar.' },
  { key: 'enabled', label: 'Ödeme alma açık', type: 'boolean', default: PAYMENT_SETTINGS_DEFAULTS.enabled },
];

const COOKIES_FIELDS: readonly SettingFieldMeta[] = [
  { key: 'analyticsEnabled', label: 'Analitik çerezler', type: 'boolean', default: COOKIE_SETTINGS_DEFAULTS.analyticsEnabled, help: 'ADR-0015: varsayılan kapalı; banner F10.' },
  { key: 'marketingEnabled', label: 'Pazarlama çerezleri', type: 'boolean', default: COOKIE_SETTINGS_DEFAULTS.marketingEnabled },
];

/** Tüm ayar grupları — admin ekran sırası (14a: commerce/site/seo/cookies · 15: mail/sms/payment). */
export const SETTINGS_REGISTRY: readonly SettingGroupMeta[] = [
  { group: 'commerce', label: 'Kampanya ve teslimat kuralları', description: 'Fiyatlama/abonelik kuralları (ADR-0018). Kargo ücreti ve eşik bölgelerde.', fields: COMMERCE_FIELDS },
  { group: 'site', label: 'Site bilgileri', fields: SITE_FIELDS },
  { group: 'seo', label: 'SEO', description: 'Sayfa başlıkları ve açıklamalar.', fields: SEO_FIELDS },
  { group: 'cookies', label: 'Çerezler', fields: COOKIES_FIELDS },
  { group: 'mail', label: 'E-posta', description: 'SMTP/sağlayıcı bilgileri; parola şifreli saklanır. Test gönderimi F6.', fields: MAIL_FIELDS },
  { group: 'sms', label: 'SMS', fields: SMS_FIELDS },
  { group: 'payment', label: 'Ödeme', description: 'PayTR mağaza bilgileri (merchant_key/salt şifreli saklanır), test modu, bildirim IP listesi, kayıtlı kart onayı (ADR-0019).', fields: PAYMENT_FIELDS },
];

export function isSettingGroupName(value: unknown): value is SettingGroupName {
  return typeof value === 'string' && (SETTING_GROUP_NAMES as readonly string[]).includes(value);
}

export function findSettingGroup(group: string): SettingGroupMeta | undefined {
  return SETTINGS_REGISTRY.find((g) => g.group === group);
}

export function findSettingField(group: string, field: string): SettingFieldMeta | undefined {
  return findSettingGroup(group)?.fields.find((f) => f.key === field);
}

/** Grubun varsayılan değer nesnesi (secret alanlar `''`). */
export function settingGroupDefaults(group: string): Record<string, unknown> {
  const meta = findSettingGroup(group);
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const f of meta.fields) out[f.key] = f.type === 'secret' ? '' : (f.default ?? '');
  return out;
}
