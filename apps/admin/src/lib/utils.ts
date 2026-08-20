import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind sınıflarını çakışmasız birleştirir. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
  ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
};
const TR_RE = new RegExp(`[${Object.keys(TR_MAP).join('')}]`, 'g');

/** Türkçe karakterleri sadeleştirerek URL dostu slug üretir. */
export function slugify(text: string): string {
  return text
    .replace(TR_RE, (ch) => TR_MAP[ch] ?? ch)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Para: KDV dahil tutarları tr-TR biçiminde gösterir (Decimal(12,2) string ya da number). */
export function formatTry(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

/** Tarih-saat: Europe/Istanbul'da kısa biçim (ADR-0004). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Takvim günü (`YYYY-MM-DD` ya da ISO an) → `GG.AA.YYYY`; TZ kaymasız. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Bayt → okunur boyut (tr-TR). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Form girdisi → sayı; boş/geçersiz → null. tr-TR: virgül ondalık, nokta binlik ("1.250,75" → 1250.75);
 * virgül yoksa nokta ondalık kabul edilir ("7.5" → 7.5).
 */
export function parseDecimalInput(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Yerel (iyimser) kopya + sunucu yanıtı birleştirme: sunucu yanıtı varsa alanları ezer, yoksa yerel kalır.
 * (Object literal içinde `...(server ?? {})` TS2783 verir; bu yardımcı onu önler.)
 */
export function mergeFromServer<T extends object>(local: T, server: Partial<T> | T | null | undefined): T {
  return server ? { ...local, ...server } : local;
}

/** Bir diziyi `from` → `to` konumuna taşır (yeni dizi döner). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
