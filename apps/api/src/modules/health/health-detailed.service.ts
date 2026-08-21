import { Injectable, Logger } from '@nestjs/common';
import type { AdminHealthDetailed } from '@bagdam/shared';
import { CronLogsService } from '../cron-logs/cron-logs.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { WebhookEventsService } from '../webhook-events/webhook-events.service';
import { APP_VERSION } from '../../config/app-info';
import { getSiteMode } from '../../config/site.config';
import { HealthRepository } from './health.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

/** DB kontrolü üst sınırı — bağlantı koptuğunda istek asılı kalmasın. */
const DB_CHECK_TIMEOUT_MS = 3_000;

/** Bu sayıdan çok başarısız cron koşusu varsa sağlık kartı uyarı gösterir. */
const CRON_FAIL_WARN = 1;
/** Son 24 saatte bu sayıdan çok başarısız e-posta varsa uyarı. */
const MAIL_FAIL_WARN = 3;

function isSchedulerInstance(env: NodeJS.ProcessEnv = process.env): boolean {
  const instance = env.NODE_APP_INSTANCE;
  return (!instance || instance === '0') && env.ENABLE_CRON !== 'false';
}

/**
 * HealthDetailedService — `GET /admin/health/detailed` (ekran 22 sağlık kartı).
 *
 * Tek çağrıda: DB gecikmesi, süreç/sürüm bilgisi, zamanlayıcı durumu + job'ların son koşusu,
 * son 24 saatin SystemLog / MailLog / WebhookEvent sayımları, açık ödeme problemleri ve
 * bunlardan türetilen Türkçe uyarı listesi. Salt okunur; sır döndürmez.
 */
@Injectable()
export class HealthDetailedService {
  private readonly logger = new Logger(HealthDetailedService.name);

  constructor(
    private readonly repo: HealthRepository,
    private readonly cronLogs: CronLogsService,
    private readonly systemLogs: SystemLogsService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  async detailed(): Promise<AdminHealthDetailed> {
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);

    const db = await this.checkDb();
    const [jobs, cronFailed24h, systemByLevel, mail, webhookStats, paymentIssues] = await Promise.all([
      this.safe(() => this.cronLogs.latestPerName(), []),
      this.safe(() => this.cronLogs.countFailedSince(since), 0),
      this.safe(() => this.systemLogs.countsByLevelSince(since), {} as Record<string, number>),
      this.safe(() => this.repo.mailCountsSince(since), {} as Record<string, number>),
      this.safe(() => this.webhooks.statsSince(since), { total: 0, invalidSignature: 0, failed: 0 }),
      this.safe(() => this.repo.openPaymentIssues(), { unpaidCycles: 0, failedOrders: 0 }),
    ]);

    const memory = process.memoryUsage();
    const warnings: string[] = [];
    if (db.status === 'down') warnings.push('Veritabanına erişilemiyor (SELECT 1 başarısız).');
    if (cronFailed24h >= CRON_FAIL_WARN) warnings.push(`Son 24 saatte ${cronFailed24h} cron koşusu başarısız.`);
    if ((systemByLevel.error ?? 0) + (systemByLevel.fatal ?? 0) > 0) {
      warnings.push(`Son 24 saatte ${(systemByLevel.error ?? 0) + (systemByLevel.fatal ?? 0)} sistem hatası kaydı.`);
    }
    if ((mail.FAILED ?? 0) >= MAIL_FAIL_WARN) warnings.push(`Son 24 saatte ${mail.FAILED} e-posta gönderilemedi.`);
    if (webhookStats.invalidSignature > 0) warnings.push(`Son 24 saatte ${webhookStats.invalidSignature} geçersiz imzalı ödeme bildirimi.`);
    if (paymentIssues.unpaidCycles + paymentIssues.failedOrders > 0) {
      warnings.push(`Açık ödeme problemi: ${paymentIssues.unpaidCycles} kutu, ${paymentIssues.failedOrders} sipariş.`);
    }
    if (!isSchedulerInstance()) warnings.push('Zamanlayıcı bu süreçte kapalı (ENABLE_CRON=false ya da ikincil instance).');

    return {
      status: db.status === 'up' ? 'ok' : 'degraded',
      checkedAt: now.toISOString(),
      version: APP_VERSION,
      env: process.env.NODE_ENV ?? 'development',
      siteMode: getSiteMode(),
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      timezone: {
        env: process.env.TZ ?? null,
        resolved: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      memory: {
        rssMb: Math.round((memory.rss / MB) * 10) / 10,
        heapUsedMb: Math.round((memory.heapUsed / MB) * 10) / 10,
      },
      db,
      scheduler: {
        enabled: isSchedulerInstance(),
        instance: process.env.NODE_APP_INSTANCE ?? null,
        jobs,
        failedRuns24h: cronFailed24h,
      },
      systemLogs24h: systemByLevel,
      mail24h: mail,
      mailDisabled: process.env.DISABLE_MAIL === 'true',
      webhooks24h: webhookStats,
      paymentIssues,
      /** `POST /admin/jobs/:name/run` yalnız üretim dışı ortamda gösterilmeli (panel bu bayrağa bakar). */
      jobRunAllowed: process.env.NODE_ENV !== 'production',
      warnings,
    };
  }

  private async checkDb(): Promise<{ status: 'up' | 'down'; latencyMs: number | null }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('db health timeout')), DB_CHECK_TIMEOUT_MS);
    });
    try {
      const latencyMs = await Promise.race([this.repo.pingMs(), timeout]);
      return { status: 'up', latencyMs };
    } catch {
      return { status: 'down', latencyMs: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Alt sorgu patlarsa sağlık kartı komple 500 vermesin — varsayılana düş, logla. */
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Sağlık kartı alt sorgusu başarısız: ${(err as Error).message}`);
      return fallback;
    }
  }
}
