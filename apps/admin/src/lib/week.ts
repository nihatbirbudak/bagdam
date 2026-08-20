/**
 * Hafta yardımcıları — BoxTemplate.weekStart "haftanın pazartesisi" (`@db.Date`, TZ'siz `YYYY-MM-DD`).
 * Tüm hesaplar takvim günü üzerinden (UTC öğlen) yapılır; yerel TZ kaymasına karşı korunur.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcNoon(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Verilen ISO gün → ait olduğu haftanın pazartesisi (ISO hafta; pazartesi = 1). */
export function mondayOf(isoDate: string): string {
  const d = toUtcNoon(isoDate);
  const dow = d.getUTCDay(); // 0 Pazar … 6 Cumartesi
  const diff = dow === 0 ? -6 : 1 - dow;
  return toIsoDate(new Date(d.getTime() + diff * DAY_MS));
}

/** Bugünün (Europe/Istanbul) pazartesisi. */
export function currentWeekStart(now: Date = new Date()): string {
  const local = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD
  return mondayOf(local);
}

/** ISO güne `days` gün ekler. */
export function addDays(isoDate: string, days: number): string {
  return toIsoDate(new Date(toUtcNoon(isoDate).getTime() + days * DAY_MS));
}

/** Hafta etiketi: "18–24 Ağu 2026". */
export function formatWeekRange(weekStart: string): string {
  const start = toUtcNoon(weekStart);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = sameMonth ? String(start.getUTCDate()) : fmt(start, false);
  return `${startLabel}–${fmt(end, true)}`;
}

/** `YYYY-MM-DD` biçim denetimi. */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtcNoon(s).getTime());
}
