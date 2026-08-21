/**
 * Ekran 21 (Özet) saf yardımcıları — test edilir.
 * Veri `GET /admin/dashboard` (`AdminDashboard`) ucundan gelir; burada yalnız gösterim türevleri vardır.
 */
import type { AdminDashboardCutoff } from '../../lib/apiTypes';

export interface CutoffDigest {
  total: number;
  open: number;
  locked: number;
  full: number;
  /** Bu haftaya planlanmış toplam kutu sayısı. */
  cycles: number;
}

/** Kesim panosu özeti: kaç gün açık, kaçı kilitli (kesim geçti / gün kapalı), kaçı dolu. */
export function summarizeCutoff(rows: readonly AdminDashboardCutoff[]): CutoffDigest {
  const d: CutoffDigest = { total: rows.length, open: 0, locked: 0, full: 0, cycles: 0 };
  for (const r of rows) {
    if (r.locked) d.locked += 1;
    else d.open += 1;
    if (r.capacity > 0 && r.reserved >= r.capacity) d.full += 1;
    d.cycles += r.cycleCount;
  }
  return d;
}

/** Kesim satırı sağ sütun metni: "kesim geçti" / "dolu" / "12/100". */
export function cutoffStateText(row: Pick<AdminDashboardCutoff, 'locked' | 'capacity' | 'reserved'>): string {
  if (row.locked) return 'kesim geçti';
  if (row.capacity > 0 && row.reserved >= row.capacity) return 'dolu';
  return `${row.reserved}/${row.capacity}`;
}

/** Kesim satırı vurgusu (Tailwind renk sınıfı). */
export function cutoffTone(row: Pick<AdminDashboardCutoff, 'locked' | 'capacity' | 'reserved'>): 'muted' | 'bad' | 'good' {
  if (row.locked) return 'muted';
  if (row.capacity > 0 && row.reserved >= row.capacity) return 'bad';
  return 'good';
}

/** Siparişler ekranına götüren tarih filtresi (`?from=&to=`). */
export function dayQuery(day: string): string {
  return `?from=${day}&to=${day}`;
}

/** Haftalık pencere sorgusu — `weekStart` sunucudan gelir, bitiş +6 gün. */
export function weekQuery(weekStart: string): string {
  return `?from=${weekStart}&to=${addDays(weekStart, 6)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` + gün (TZ kaymasız; UTC öğlen üzerinden). */
export function addDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) + days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** `YYYY-MM-DD` → Türkçe gün adı (TZ kaymasız; UTC öğlen üzerinden). */
export function weekdayLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return '';
  return WEEKDAY_TR[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).getUTCDay()];
}
