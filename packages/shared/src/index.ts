// ── @bagdam/shared — giriş noktası ──────────────────────────────────────────
// api, admin ve (ileride) mobil aynı dosyayı import eder (ADR-0002 §3).
// Bölümler: enum'lar (Prisma ile birebir) · DTO tipleri · durum makineleri · fiyatlama.
// Kural: burada iş mantığı yok; DB erişimi yok; yalnız saf tipler/sabitler/saf fonksiyonlar.

// Enum'lar — değer nesnesi + union tipi + *_VALUES + *_LABELS (Türkçe)
export * from './enums';

// DTO tipleri
export * from './types/common';
export * from './types/settings';
export * from './types/media';
export * from './types/user';
export * from './types/delivery';
export * from './types/catalog';
export * from './types/content';
export * from './types/wholesale';
export * from './types/order';
export * from './types/subscription';
export * from './types/coupon'; // F7: minimal kupon şeması (Coupon / CouponRedemption; admin/checkout UI P2)
export * from './types/pricing';
export * from './types/admin'; // F4: admin panel DTO'ları (katalog CRUD + medya)
export * from './types/mail'; // F6: MailModule (şablon slug'ları, Notifier olayları, MailLog admin DTO'ları)
export * from './types/payment'; // F7: PaymentProvider / ChargeStrategy sözleşmesi (apps/api modules/payments)
export * from './types/checkout'; // F8: checkout quote/checkout DTO'ları (apps/api modules/checkout)
export * from './types/system'; // F10: sistem günlükleri (system/cron/webhook) + sağlık kartı (ekran 22)

// Durum makineleri (Order / Subscription / Cycle / Payment / Cancellation) — docs/state-machines.md ile aynı
export * from './state-machines';

// Fiyatlama — tek doğruluk kaynağı (KDV, ilk-2-kutu, ekstra yuvarlama, kargo/eşik zone'dan, kesim TZ'li)
export * from './pricing';
