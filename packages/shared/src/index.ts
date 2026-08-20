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

// Durum makineleri (Order / Subscription / Cycle / Payment / Cancellation) — docs/state-machines.md ile aynı
export * from './state-machines';

// Fiyatlama (F2'de dolacak)
export * from './pricing';
