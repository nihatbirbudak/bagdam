/**
 * Ekran 22 (Sistem) saf yardımcıları — test edilir.
 *
 * Veri kaynakları: `GET /admin/{audit-logs,system-logs,cron-logs,mail-logs,webhook-events}` +
 * `GET /admin/health/detailed` + `GET /admin/jobs`. Burada yalnız etiket/rozet/biçim türevleri var;
 * karar ve iş mantığı API'de (ince istemci — ADR-0002).
 */
import {
  CRON_LOG_STATUS_LABELS,
  SYSTEM_LOG_LEVEL_LABELS,
  WEBHOOK_STATUS_LABELS,
  type CronLogStatus,
  type SystemLogLevel,
  type WebhookStatus,
} from '@bagdam/shared';
import type { AdminHealthDetailed, CronLogItem, JobInfo } from '../../lib/apiTypes';

/* ── Sekmeler ───────────────────────────────────────────────────────────── */

export const SYSTEM_TABS = [
  { key: 'saglik', label: 'Sağlık' },
  { key: 'denetim', label: 'Denetim' },
  { key: 'sistem', label: 'Sistem' },
  { key: 'cron', label: 'Cron' },
  { key: 'eposta', label: 'E-posta' },
  { key: 'webhook', label: 'Webhook' },
] as const;

export type SystemTabKey = (typeof SYSTEM_TABS)[number]['key'];

const TAB_KEYS: readonly string[] = SYSTEM_TABS.map((t) => t.key);

/** URL'den gelen `?sekme=` değeri; tanınmıyorsa "saglik". */
export function normalizeTab(raw: string | null | undefined): SystemTabKey {
  return (raw && TAB_KEYS.includes(raw) ? raw : 'saglik') as SystemTabKey;
}

/* ── Etiketler ───────────────────────────────────────────────────────────── */

export function systemLevelLabel(level: string | null | undefined): string {
  if (!level) return '—';
  return (SYSTEM_LOG_LEVEL_LABELS as Record<string, string>)[level as SystemLogLevel] ?? level;
}

export function cronStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return (CRON_LOG_STATUS_LABELS as Record<string, string>)[status as CronLogStatus] ?? status;
}

export function webhookStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return (WEBHOOK_STATUS_LABELS as Record<string, string>)[status as WebhookStatus] ?? status;
}

/* ── Rozet tonları ───────────────────────────────────────────────────────── */

export type Tone = 'good' | 'bad' | 'warn' | 'neutral';

export function systemLevelTone(level: string | null | undefined): Tone {
  switch ((level ?? '').toLowerCase()) {
    case 'fatal':
    case 'error':
      return 'bad';
    case 'warn':
      return 'warn';
    case 'info':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function cronStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'SUCCESS':
      return 'good';
    case 'FAILED':
      return 'bad';
    case 'RUNNING':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function webhookStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'PROCESSED':
      return 'good';
    case 'FAILED':
      return 'bad';
    case 'IGNORED':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** Sağlık kartı üst rozeti. */
export function healthTone(health: AdminHealthDetailed | null): Tone {
  if (!health) return 'neutral';
  if (health.status !== 'ok') return 'bad';
  return health.warnings.length > 0 ? 'warn' : 'good';
}

/* ── Türevler ────────────────────────────────────────────────────────────── */

/** `durationMs` → "1,2 s" / "340 ms" / "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} s`;
}

/** Saniye → "3 g 4 sa" / "5 sa 12 dk" / "42 dk" (süreç çalışma süresi). */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} g ${h} sa`;
  if (h > 0) return `${h} sa ${m} dk`;
  return `${m} dk`;
}

/** Seviye→sayı haritasını "hata 2 · uyarı 5" gibi tek satıra indirger; boşsa "kayıt yok". */
export function summarizeLevels(counts: Record<string, number> | null | undefined): string {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return 'kayıt yok';
  const order = ['fatal', 'error', 'warn', 'info'];
  entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return entries.map(([level, n]) => `${systemLevelLabel(level).toLowerCase()} ${n}`).join(' · ');
}

/** MailLog durum sayımlarını "gönderildi 4 · atlandı 2" biçiminde özetler. */
export function summarizeMail(counts: Record<string, number> | null | undefined): string {
  const map: Record<string, string> = { SENT: 'gönderildi', FAILED: 'başarısız', SKIPPED: 'atlandı', QUEUED: 'kuyrukta' };
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return 'kayıt yok';
  return entries.map(([status, n]) => `${map[status] ?? status.toLowerCase()} ${n}`).join(' · ');
}

/**
 * Kayıt defterindeki job'ları son koşularıyla eşler (sağlık kartı tablosu).
 * `GET /admin/jobs` zaten `lastRun` verir; sağlık kartındaki `scheduler.jobs` daha tazedir —
 * ikisi birleştirilir, `GET /admin/jobs` erişilemezse yalnız sağlık kartı satırları kalır.
 */
export interface JobRow {
  name: string;
  cron: string | null;
  description: string | null;
  lastRun: { status: string; startedAt: string; durationMs: number | null; itemsProcessed: number; errors: number } | null;
}

export function mergeJobRows(jobs: readonly JobInfo[] | null, latest: readonly CronLogItem[] | null): JobRow[] {
  const byName = new Map<string, JobRow>();
  for (const job of jobs ?? []) {
    byName.set(job.name, {
      name: job.name,
      cron: job.cron ?? null,
      description: job.description ?? null,
      lastRun: job.lastRun
        ? {
            status: job.lastRun.status,
            startedAt: job.lastRun.startedAt,
            durationMs: job.lastRun.durationMs ?? null,
            itemsProcessed: job.lastRun.itemsProcessed,
            errors: job.lastRun.errors,
          }
        : null,
    });
  }
  for (const run of latest ?? []) {
    const existing = byName.get(run.name);
    const lastRun = {
      status: run.status,
      startedAt: run.startedAt,
      durationMs: run.durationMs ?? null,
      itemsProcessed: run.itemsProcessed,
      errors: run.errors,
    };
    if (existing) {
      // Daha yeni koşu varsa onu göster (kayıt defteri önbelleği eskimiş olabilir)
      if (!existing.lastRun || existing.lastRun.startedAt < run.startedAt) existing.lastRun = lastRun;
    } else {
      byName.set(run.name, { name: run.name, cron: null, description: null, lastRun });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Detay panelinde gösterilecek JSON metni (null/boş → null). */
export function prettyJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
