// ── Kesim ve teslimat tarihleri (TZ'li) — ADR-0004 / ADR-0005 ───────────────────
// Kesim = teslimat gününden `daysBefore` gün önce `time` (varsayılan 1 gün önce 12:00), TZ Europe/Istanbul (kalıcı +03).
// TEK kaynak: cart.js'teki `CUTOFF_WEEKDAY` (2 gün önce 23:59) ve `lockedDeliveryDay` (`getHours()>=12`) kuralları
// burada tek kurala iner; bootstrap `deliveryDates[].cutoffAtIso` ve `DeliveryDate.cutoffAt` bu fonksiyonlardan üretilir.
// Süreç TZ'sinden BAĞIMSIZ: takvim günü `formatInTimeZone` ile, gün aritmetiği UTC-proleptik (Date.UTC), kesim anı
// `fromZonedTime('<date>T<HH:mm>:00', tz)`; `Date#getHours/getDay` (yerel TZ) HİÇ kullanılmaz.
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { DELIVERY_DAY_META, DeliveryDay } from '../enums';
import type { IsoDate } from '../types/common';
import type { CutoffRule, DeliveryDateOptions, DeliveryDateSlot } from '../types/pricing';
import { COMMERCE_SETTINGS_DEFAULTS } from '../types/settings';

/** Varsayılan saat dilimi (ADR-0004). */
export const DEFAULT_TZ = 'Europe/Istanbul';
/** Varsayılan kesim kuralı — Setting `commerce.cutoff`. */
export const DEFAULT_CUTOFF_RULE: Readonly<CutoffRule> = COMMERCE_SETTINGS_DEFAULTS.cutoff;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC gece yarısı (takvim aritmetiği için; gerçek bir "an" değildir). Geçersiz/olmayan tarih → RangeError. */
export function isoDateToUtc(date: IsoDate): Date {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new RangeError(`Geçersiz takvim günü (YYYY-MM-DD bekleniyor): ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) {
    throw new RangeError(`Takvimde olmayan gün: ${date}`);
  }
  return utc;
}

/** UTC gece yarısı → `YYYY-MM-DD`. */
export function utcToIsoDate(utcMidnight: Date): IsoDate {
  const y = utcMidnight.getUTCFullYear();
  const mo = String(utcMidnight.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcMidnight.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Takvim gününe gün ekler/çıkarır (TZ'siz, DST'siz). */
export function addCalendarDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError('addCalendarDays: gün sayısı tam sayı olmalı');
  return utcToIsoDate(new Date(isoDateToUtc(date).getTime() + days * DAY_MS));
}

/** Takvim gününün haftanın günü (0 Pazar … 6 Cumartesi) — JS `getDay` ile aynı sayı, süreç TZ'sinden bağımsız. */
export function weekdayOf(date: IsoDate): number {
  return isoDateToUtc(date).getUTCDay();
}

/** Bir anın verilen TZ'deki takvim günü (`YYYY-MM-DD`). */
export function calendarDateIn(instant: Date, tz: string = DEFAULT_TZ): IsoDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError('calendarDateIn: geçersiz tarih');
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** Haftanın gününe (0–6) karşılık gelen teslimat günü enum'u; teslimat günü değilse null. */
export function deliveryDayForWeekday(weekday: number): DeliveryDay | null {
  for (const day of Object.values(DeliveryDay)) {
    if (DELIVERY_DAY_META[day].dow === weekday) return day;
  }
  return null;
}

/**
 * Teslimat gününün kesim anı (UTC instant): `deliveryDate − rule.daysBefore` günü `rule.time` (TZ).
 * Ör. 2026-08-25 (Salı), {1, "12:00"}, Europe/Istanbul → 2026-08-24T09:00:00.000Z (Pazartesi 12:00 +03).
 */
export function computeCutoffAt(deliveryDate: IsoDate, rule: CutoffRule = DEFAULT_CUTOFF_RULE, tz: string = DEFAULT_TZ): Date {
  if (!Number.isInteger(rule.daysBefore) || rule.daysBefore < 0) {
    throw new RangeError(`computeCutoffAt: daysBefore 0 ya da pozitif tam sayı olmalı (${String(rule.daysBefore)})`);
  }
  if (!HHMM_RE.test(rule.time)) throw new RangeError(`computeCutoffAt: time 'HH:mm' olmalı (${rule.time})`);
  const cutoffDate = addCalendarDays(deliveryDate, -rule.daysBefore);
  const instant = fromZonedTime(`${cutoffDate}T${rule.time}:00`, tz);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`computeCutoffAt: geçersiz saat dilimi (${tz})`);
  return instant;
}

/** Kesimden önce mi? `now < cutoffAt` (tam kesim anında artık kilitli: state-machines "cutoffAt <= now → LOCKED"). */
export function isBeforeCutoff(now: Date, cutoffAt: Date): boolean {
  return now.getTime() < cutoffAt.getTime();
}

/**
 * `from` anından itibaren `weeks` haftalık ufukta (7×weeks takvim günü, TZ'ye göre bugün dahil) teslimat günlerine
 * düşen tarihler — her biri kesim anı ve kilit bayrağıyla, tarih sırasına göre.
 * - Varsayılan `includeLocked=false`: kesimi geçmiş (bu hafta için kilitli) tarihler listeye girmez.
 * - `includeLocked=true`: ufuktaki her teslimat günü döner (her gün tam `weeks` kez → 3 gün × 8 hafta = 24).
 * `delivery-dates:generate` (8 hafta), bootstrap `deliveryDates` ve cart.js `nextDeliveryDate` (F9) bunu kullanır.
 */
export function nextDeliveryDates(
  from: Date,
  deliveryDays: readonly DeliveryDay[],
  weeks: number,
  options: DeliveryDateOptions = {},
): DeliveryDateSlot[] {
  if (!Number.isInteger(weeks) || weeks < 0) throw new RangeError('nextDeliveryDates: weeks 0 ya da pozitif tam sayı olmalı');
  const tz = options.tz ?? DEFAULT_TZ;
  const rule = options.rule ?? DEFAULT_CUTOFF_RULE;
  const wanted = new Map<number, DeliveryDay>();
  for (const day of deliveryDays) wanted.set(DELIVERY_DAY_META[day].dow, day);
  const today = calendarDateIn(from, tz);
  const slots: DeliveryDateSlot[] = [];
  for (let offset = 0; offset < weeks * 7; offset++) {
    const date = addCalendarDays(today, offset);
    const day = wanted.get(weekdayOf(date));
    if (!day) continue;
    const cutoffAt = computeCutoffAt(date, rule, tz);
    const locked = !isBeforeCutoff(from, cutoffAt);
    if (locked && !options.includeLocked) continue;
    slots.push({ day, date, cutoffAt, locked });
  }
  return slots;
}

/**
 * Belirli bir teslimat gününün bir sonraki AÇIK tarihi — cart.js `nextDeliveryDate(dayId)` ile aynı mantık:
 * haftanın bir sonraki o günü; o gün kilitliyse (kesim geçti / bugün) bir hafta sonrası.
 */
export function nextDeliveryDateFor(day: DeliveryDay, from: Date, options: DeliveryDateOptions = {}): DeliveryDateSlot {
  const slot = nextDeliveryDates(from, [day], 2, { ...options, includeLocked: false })[0];
  if (!slot) throw new Error('nextDeliveryDateFor: 2 haftalık ufukta açık tarih bulunamadı (beklenmez)');
  return slot;
}

/**
 * Şu an kilitli teslimat günleri — cart.js `lockedDeliveryDay` kuralının tek kaynağa indirgenmiş hâli:
 * bir gün, bu haftaki (bugün dahil bir sonraki) tarihinin kesimi geçtiyse — yani kesimden teslimat gününün
 * sonuna kadar — kilitlidir. 1 gün önce 12:00 kuralıyla Salı/Perşembe/Cumartesi için aynı anda en çok bir gün kilitlidir.
 */
export function lockedDeliveryDays(now: Date, deliveryDays: readonly DeliveryDay[], options: DeliveryDateOptions = {}): DeliveryDay[] {
  const tz = options.tz ?? DEFAULT_TZ;
  const rule = options.rule ?? DEFAULT_CUTOFF_RULE;
  const today = calendarDateIn(now, tz);
  const locked: DeliveryDay[] = [];
  for (const day of deliveryDays) {
    // Bu haftaki (bugün dahil) bir sonraki tarih
    const diff = (DELIVERY_DAY_META[day].dow - weekdayOf(today) + 7) % 7;
    const date = addCalendarDays(today, diff);
    if (!isBeforeCutoff(now, computeCutoffAt(date, rule, tz))) locked.push(day);
  }
  return locked;
}

/** cart.js `lockedDeliveryDay()` karşılığı: kilitli gün (varsa ilki), yoksa null. */
export function lockedDeliveryDay(now: Date, deliveryDays: readonly DeliveryDay[], options: DeliveryDateOptions = {}): DeliveryDay | null {
  return lockedDeliveryDays(now, deliveryDays, options)[0] ?? null;
}
