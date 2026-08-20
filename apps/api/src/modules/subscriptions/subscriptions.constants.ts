import { addCalendarDays, DEFAULT_TZ, DELIVERY_DAY_META, weekdayOf, type DeliveryDay, type IsoDate } from '@bagdam/shared';
import { fromZonedTime } from 'date-fns-tz';

/** Abonelik motoru sabitleri (F7). Ayar olmayan, iş kuralı niteliğinde tek noktadan değiştirilecek değerler. */

/** SubscriptionEvent.actor değerleri (VarChar(10)). */
export const ACTOR = { USER: 'USER', SYSTEM: 'SYSTEM', ADMIN: 'ADMIN', OPS: 'OPS', PSP: 'PSP' } as const;
export type Actor = (typeof ACTOR)[keyof typeof ACTOR];

/** `cycles:lock-and-charge` / `payments:retry` / `cycles:expire-payment-links` parti büyüklüğü ve tur sayısı (state-machines §8). */
export const LOCK_BATCH_SIZE = 50;
export const LOCK_MAX_ROUNDS = 20;

/** `cycles:ensure` abonelik sayfası (state-machines §7: 200'lük sayfalar). */
export const ENSURE_PAGE_SIZE = 200;
/** Bir abonelik için tek koşuda üretilecek en çok cycle (sonsuz döngü koruması). */
export const ENSURE_MAX_CYCLES_PER_RUN = 26;

/**
 * Dunning son deneme sınırı — state-machines §14 #1 KARAR: yeniden denemeler teslimat gününü aşmaz;
 * teslimat günü 08:00 (Europe/Istanbul, paketleme başlangıcı) sonrasına düşen denemeler atlanır →
 * cycle SKIPPED(UNPAID). Setting `commerce.dunning.retryHours` değerleri aynen kalır, yalnız sınır uygulanır.
 */
export const DUNNING_RETRY_DEADLINE_TIME = '08:00';

/** `reminders:cutoff` penceresi: kesimden bu kadar saat önce (job saatlik koşar; pencere 1 saat). */
export const CUTOFF_REMINDER_HOURS_BEFORE = 24;
export const CUTOFF_REMINDER_WINDOW_MS = 60 * 60 * 1000;

/** İptal onayında iade son tarihi (gün) — yasal üst sınır 15 (ADR-0007); 14 seçildi. */
export const CANCEL_REFUND_DAYS = 14;

/** SystemLog uyarılarının "günde 1 digest" penceresi (ms). */
export const SYSTEM_WARN_DIGEST_MS = 24 * 60 * 60 * 1000;

/** Ödeme linki tokenı: 16 bayt → 32 hex. */
export const LINK_TOKEN_BYTES = 16;

/** Notifier stub bellek tamponu. */
export const NOTIFIER_BUFFER_SIZE = 200;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// ── Takvim yardımcıları (TZ'den bağımsız — shared cutoff fonksiyonlarıyla aynı yaklaşım) ─────────────────────

/** Takvim gününün haftasının Pazartesi'si (ISO hafta). */
export function weekStartOf(date: IsoDate): IsoDate {
  return addCalendarDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Hafta başına (Pazartesi) göre teslimat gününün takvim günü: Salı +1, Perşembe +3, Cumartesi +5. */
export function deliveryDateInWeek(weekStart: IsoDate, day: DeliveryDay): IsoDate {
  return addCalendarDays(weekStart, DELIVERY_DAY_META[day].dow - 1);
}

/** Teslimat gününün dunning son deneme anı (UTC instant): `date` 08:00 Europe/Istanbul. */
export function dunningDeadlineFor(deliveryOn: IsoDate, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(`${deliveryOn}T${DUNNING_RETRY_DEADLINE_TIME}:00`, tz);
}

/** Teslimat gününün sonu (ertesi gün 00:00 Europe/Istanbul) — iptal `effectiveAt` hesabı. */
export function endOfDeliveryDay(deliveryOn: IsoDate, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(`${addCalendarDays(deliveryOn, 1)}T00:00:00`, tz);
}

/** Yıl dönümü (skipsResetAt): aynı gün/ay, +1 yıl (UTC aritmetiği; saniye hassasiyeti yeterli). */
export function addOneYear(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + 1);
  return out;
}
