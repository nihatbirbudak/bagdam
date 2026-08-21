/**
 * Ekran 14b (Ayarlar › Teslimat tarihleri) — saf yardımcılar (test edilir).
 *
 * Sözleşme (F5 DeliveryModule, F9'da düzenlemeye açılıyor):
 *   `GET   /admin/delivery/dates?zone=&from=&to=`        → DeliveryDateAdmin[]
 *   `PATCH /admin/delivery/dates/:id {capacity?,status?}` → DeliveryDateAdmin  (en az biri zorunlu; 400)
 *   `POST  /admin/delivery/dates/generate {weeks?}`       → DeliveryDatesGenerateResult (idempotent)
 *
 * Kurallar: kesim = teslimattan bir gün önce 12:00 (ADR-0005) — `cutoffAt` mutlak an, istemci saatine
 * güvenilmez, sunucudan gelen değer kullanılır. `LOCKED` kesim geçtiği için sunucunun verdiği durumdur;
 * ops yalnız `OPEN ↔ CLOSED` arasında gidip gelir. Kapasite varsayılan 999 (fiilen sınırsız) [B9].
 */
import {
  DELIVERY_DATE_STATUS_LABELS,
  DELIVERY_DAY_LABELS,
  type DeliveryDateAdmin,
  type DeliveryDateStatus,
  type DeliveryDay,
} from '@bagdam/shared';
import { addDays, mondayOf } from '../../lib/week';

/* ── Etiket / stil ──────────────────────────────────────────────────────── */

export function deliveryDayLabel(day: string): string {
  return (DELIVERY_DAY_LABELS as Record<string, string>)[day as DeliveryDay] ?? day;
}

export function dateStatusLabel(status: string): string {
  return (DELIVERY_DATE_STATUS_LABELS as Record<string, string>)[status as DeliveryDateStatus] ?? status;
}

export const DATE_STATUS_STYLE: Record<DeliveryDateStatus, string> = {
  OPEN: 'bg-olive-soft text-olive-deep ring-olive/30',
  LOCKED: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  CLOSED: 'bg-brand-100 text-brand-500 ring-brand-300',
};

/* ── Doluluk ───────────────────────────────────────────────────────────── */

export interface Occupancy {
  reserved: number;
  capacity: number;
  /** 0–100 arası tam sayı; kapasite 0 ise rezerve varsa 100, yoksa 0. */
  pct: number;
  full: boolean;
  /** ≥ %80 (ve dolu değil) — ops uyarısı. */
  nearlyFull: boolean;
  free: number;
}

export function occupancyOf(d: Pick<DeliveryDateAdmin, 'reserved' | 'capacity'>): Occupancy {
  const reserved = Math.max(0, Number(d.reserved) || 0);
  const capacity = Math.max(0, Number(d.capacity) || 0);
  const pct = capacity === 0 ? (reserved > 0 ? 100 : 0) : Math.min(100, Math.round((reserved / capacity) * 100));
  const full = reserved >= capacity;
  return { reserved, capacity, pct, full, nearlyFull: !full && pct >= 80, free: Math.max(0, capacity - reserved) };
}

/* ── Kesim ─────────────────────────────────────────────────────────────── */

/** Kesim geçti mi (mutlak `cutoffAt` — sunucu anı; `now` çağıran tarafından verilir). */
export function isCutoffPassed(cutoffAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!cutoffAt) return false;
  const t = new Date(cutoffAt).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

/** "3 sa 12 dk kaldı" / "kesim geçti" — geri sayım metni. */
export function cutoffCountdown(cutoffAt: string | null | undefined, now: Date = new Date()): string {
  if (!cutoffAt) return '—';
  const t = new Date(cutoffAt).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = t - now.getTime();
  if (diff <= 0) return 'kesim geçti';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} gün ${hours} sa kaldı`;
  if (hours > 0) return `${hours} sa ${minutes} dk kaldı`;
  return `${minutes} dk kaldı`;
}

/* ── Düzenleme kuralları ───────────────────────────────────────────────── */

/** Ops yalnız OPEN ↔ CLOSED çevirir; LOCKED sunucunun (kesim geçti) durumudur. */
export function toggleStatusTarget(status: string): DeliveryDateStatus | null {
  if (status === 'OPEN') return 'CLOSED';
  if (status === 'CLOSED') return 'OPEN';
  return null;
}

export function toggleStatusLabel(status: string): string {
  return status === 'CLOSED' ? 'Günü aç' : 'Günü kapat';
}

/**
 * Kapasite doğrulaması: 0–100000 tam sayı; rezerve edilenin altına düşürülemez
 * (sunucu rezervasyonları serbest bırakmaz — ops önce siparişi taşımalı).
 */
export function validateCapacity(raw: string, reserved: number): string | null {
  const s = raw.trim();
  if (!s) return 'Kapasite gerekli';
  if (!/^\d+$/.test(s)) return 'Kapasite tam sayı olmalı';
  const n = Number(s);
  if (n > 100_000) return 'Kapasite en çok 100000 olabilir';
  if (n < reserved) return `Kapasite rezerve edilenin (${reserved}) altına düşürülemez`;
  return null;
}

export function validateWeeks(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Hafta sayısı gerekli';
  if (!/^\d+$/.test(s)) return 'Hafta sayısı tam sayı olmalı';
  const n = Number(s);
  if (n < 1 || n > 26) return 'Hafta sayısı 1–26 arası olmalı';
  return null;
}

/* ── Hafta seçici ──────────────────────────────────────────────────────── */

export interface WeekWindow {
  /** Haftanın pazartesisi (`YYYY-MM-DD`). */
  weekStart: string;
  /** Haftanın pazarı — API `to` parametresi. */
  weekEnd: string;
}

/** Verilen güne göre hafta penceresi (offset: 0 = bu hafta, +1 = gelecek hafta). */
export function weekWindow(fromIso: string, offset = 0): WeekWindow {
  const weekStart = addDays(mondayOf(fromIso), offset * 7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

/* ── Özet (ekran başlığı + Özet kartı) ─────────────────────────────────── */

export interface DatesDigest {
  total: number;
  open: number;
  closed: number;
  locked: number;
  full: number;
  reserved: number;
  capacity: number;
}

export function summarizeDates(rows: readonly DeliveryDateAdmin[]): DatesDigest {
  const digest: DatesDigest = { total: rows.length, open: 0, closed: 0, locked: 0, full: 0, reserved: 0, capacity: 0 };
  for (const r of rows) {
    if (r.status === 'OPEN') digest.open += 1;
    else if (r.status === 'CLOSED') digest.closed += 1;
    else if (r.status === 'LOCKED') digest.locked += 1;
    const o = occupancyOf(r);
    if (o.full) digest.full += 1;
    digest.reserved += o.reserved;
    digest.capacity += o.capacity;
  }
  return digest;
}
