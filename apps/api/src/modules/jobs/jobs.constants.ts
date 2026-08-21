import { PRIVACY_SETTINGS_DEFAULTS, type PrivacySettings } from '@bagdam/shared';

/**
 * JobsModule sabitleri (F10 `kvkk:purge`). Saklama süreleri Setting `privacy.*`'ten okunur;
 * buradaki varsayılanlar yalnız ayar okunamadığında/geçersiz olduğunda devreye girer (ADR-0015 matrisi).
 */
export const KVKK_PRIVACY_DEFAULTS: Readonly<PrivacySettings> = PRIVACY_SETTINGS_DEFAULTS;

/** AuditLog PII maskelemesinde tek turda okunan satır sayısı. */
export const KVKK_AUDIT_SCAN_BATCH = 500;

/** Tek koşuda taranacak azami AuditLog satırı (aşılırsa kalan bir sonraki koşuya devreder). */
export const KVKK_AUDIT_SCAN_MAX_ROWS = 50_000;

/** Tek koşuda anonimleştirilecek azami pasif müşteri sayısı. */
export const KVKK_INACTIVE_BATCH = 200;

/**
 * KVKK maskeleme işareti. `[redacted]` (AuditLogInterceptor, yazma anında) ile karıştırılmasın:
 * `[silindi]` = saklama süresi dolduğu için SONRADAN temizlendi (docs/kvkk-veri-saklama.md).
 */
export const KVKK_PURGED = '[silindi]';
