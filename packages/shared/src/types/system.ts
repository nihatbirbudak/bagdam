// ── Sistem günlükleri + sağlık (F10, ekran 22 "Sistem") ──────────────────────
// Kaynak tablolar: system_logs (30 g) · cron_logs (90 g) · webhook_events · audit_logs (kalıcı)
// Saklama süreleri ADR-0015 + docs/kvkk-veri-saklama.md; temizlik `kvkk:purge` job'unda.
import type { PaymentProvider, WebhookStatus } from '../enums';
import type { Id, IsoDateTime } from './common';

/* ── SystemLog ─────────────────────────────────────────────────────────────── */

/** `SystemLog.level` — kolon VarChar(10); Prisma enum'u yok, izinli değerler burada. */
export const SYSTEM_LOG_LEVEL_VALUES = ['fatal', 'error', 'warn', 'info'] as const;
export type SystemLogLevel = (typeof SYSTEM_LOG_LEVEL_VALUES)[number];

export const SYSTEM_LOG_LEVEL_LABELS: Readonly<Record<SystemLogLevel, string>> = {
  fatal: 'Ölümcül',
  error: 'Hata',
  warn: 'Uyarı',
  info: 'Bilgi',
};

/** `GET /admin/system-logs` satırı — `metadata` redakte edilmiş olarak döner. */
export interface SystemLogItem {
  id: Id;
  level: string;
  module: string;
  action: string | null;
  message: string;
  requestId: string | null;
  userId: string | null;
  metadata: Record<string, unknown> | null;
  /** Aynı hatanın tekilleştirme anahtarı (sha256 kısaltması). */
  fingerprint: string | null;
  /** Bu parmak izi kaç kez görüldü. */
  occurrenceCount: number;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface SystemLogListQuery {
  page?: number;
  limit?: number;
  level?: SystemLogLevel;
  module?: string;
  requestId?: string;
  search?: string;
}

export interface SystemLogList {
  items: SystemLogItem[];
  total: number;
  page: number;
  limit: number;
}

/* ── CronLog ───────────────────────────────────────────────────────────────── */

/** `CronLog.status` — VarChar(10): koşu başlarken RUNNING, bitince SUCCESS/FAILED. */
export const CRON_LOG_STATUS_VALUES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type CronLogStatus = (typeof CRON_LOG_STATUS_VALUES)[number];

export const CRON_LOG_STATUS_LABELS: Readonly<Record<CronLogStatus, string>> = {
  RUNNING: 'Çalışıyor',
  SUCCESS: 'Başarılı',
  FAILED: 'Başarısız',
};

/** `GET /admin/cron-logs` satırı (CronLog kolonlarıyla birebir). */
export interface CronLogItem {
  id: Id;
  name: string;
  status: string;
  itemsProcessed: number;
  errors: number;
  details: Record<string, unknown> | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  durationMs: number | null;
}

export interface CronLogListQuery {
  page?: number;
  limit?: number;
  name?: string;
  status?: CronLogStatus;
  search?: string;
}

export interface CronLogList {
  items: CronLogItem[];
  total: number;
  page: number;
  limit: number;
}

/* ── WebhookEvent ──────────────────────────────────────────────────────────── */

/** `GET /admin/webhook-events` satırı — `payload` redakte edilir (imza/hash + PII görünmez). */
export interface WebhookEventItem {
  id: Id;
  provider: PaymentProvider;
  eventType: string;
  providerRef: string;
  payload: Record<string, unknown> | null;
  signatureValid: boolean;
  status: WebhookStatus;
  error: string | null;
  receivedAt: IsoDateTime;
  processedAt: IsoDateTime | null;
}

export interface WebhookEventListQuery {
  page?: number;
  limit?: number;
  provider?: PaymentProvider;
  status?: WebhookStatus;
  search?: string;
}

export interface WebhookEventList {
  items: WebhookEventItem[];
  total: number;
  page: number;
  limit: number;
}

/* ── Sağlık kartı ──────────────────────────────────────────────────────────── */

export interface AdminHealthDb {
  status: 'up' | 'down';
  /** `SELECT 1` gidiş-dönüş süresi (ms); `down` iken null. */
  latencyMs: number | null;
}

export interface AdminHealthScheduler {
  /** Bu süreçte cron açık mı (instance 0 + ENABLE_CRON !== 'false'). */
  enabled: boolean;
  /** PM2 `NODE_APP_INSTANCE` (tek süreçte null). */
  instance: string | null;
  /** Job adı başına son koşu. */
  jobs: CronLogItem[];
  /** Son 24 saatte başarısız koşu sayısı. */
  failedRuns24h: number;
}

/** `GET /admin/health/detailed` — ekran 22 sağlık kartı. Sır içermez. */
export interface AdminHealthDetailed {
  status: 'ok' | 'degraded';
  checkedAt: IsoDateTime;
  version: string;
  env: string;
  siteMode: string;
  nodeVersion: string;
  uptimeSeconds: number;
  timezone: { env: string | null; resolved: string };
  memory: { rssMb: number; heapUsedMb: number };
  db: AdminHealthDb;
  scheduler: AdminHealthScheduler;
  /** Son 24 saatte seviye başına SystemLog sayısı. */
  systemLogs24h: Record<string, number>;
  /** Son 24 saatte durum başına MailLog sayısı (SENT / FAILED / SKIPPED / QUEUED). */
  mail24h: Record<string, number>;
  /** `DISABLE_MAIL=true` (lokal/staging): gönderim yapılmaz, yalnız önizleme. */
  mailDisabled: boolean;
  webhooks24h: { total: number; invalidSignature: number; failed: number };
  paymentIssues: { unpaidCycles: number; failedOrders: number };
  /** `POST /admin/jobs/:name/run` bu ortamda gösterilsin mi (üretimde false). */
  jobRunAllowed: boolean;
  /** Panelde gösterilecek Türkçe uyarılar (boşsa her şey yolunda). */
  warnings: string[];
}
