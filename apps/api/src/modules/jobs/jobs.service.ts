import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JOB_NAME_VALUES, type JobInfo, type JobName, type JobRunResult } from '@bagdam/shared';
import { randomUUID } from 'crypto';
import { RequestContext } from '../../common/request-context';
import { CheckoutCompletionService } from '../checkout/checkout-completion.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CyclesService } from '../subscriptions/services/cycles.service';
import { JobsRepository, type CronLogRecord } from './jobs.repository';
import { KvkkPurgeService } from './kvkk-purge.service';

/** `now` ezmesi (simülasyon) izinli mi: üretim dışı her zaman; üretimde yalnız ALLOW_JOB_TIME_OVERRIDE=true. */
export function jobTimeOverrideAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_JOB_TIME_OVERRIDE === 'true';
}

/** Admin `POST /admin/jobs/:name/run {now?}` → job'ın 'şimdi' anı; ezme izinsizse 403, biçimsizse 400. */
export function resolveJobNow(override: string | undefined): Date {
  if (override === undefined || override === '') return new Date();
  if (!jobTimeOverrideAllowed()) {
    throw new ForbiddenException({ message: 'Job zamanı yalnız geliştirme/test ortamında ezilebilir', error: 'JOB_NOW_OVERRIDE_FORBIDDEN' });
  }
  const now = new Date(override);
  if (Number.isNaN(now.getTime())) throw new BadRequestException({ message: 'now geçerli bir ISO 8601 anı olmalı', error: 'JOB_NOW_INVALID' });
  return now;
}

/** Bir job koşusunun ham sonucu (CronLog alanları). */
export interface JobOutcome {
  itemsProcessed: number;
  errors?: number;
  details?: Record<string, unknown>;
}

interface JobDefinition {
  name: JobName;
  /** Cron ifadesi (Europe/Istanbul) — JobsScheduler'daki @Cron ile aynı; admin listesinde gösterilir. */
  cron: string;
  description: string;
  run(now: Date): Promise<JobOutcome>;
}

/**
 * JobsService — cron job kayıt defteri + `runOnce(name, now)` (BACKEND-PLANI §3 jobs satırı; docs/state-machines.md §7–§9).
 *  - Her koşu CronLog satırı (RUNNING → SUCCESS|FAILED, itemsProcessed/errors/details/durationMs).
 *  - Aynı job çakışmaz (in-process kilit; tek instance — app.module ScheduleModule yalnız instance 0 + ENABLE_CRON).
 *  - `now` parametre: cron `new Date()`, testler/admin elle verir (ADR-0004: SQL'de `now()` yok).
 *  - F10: `kvkk:purge` (KVKK saklama matrisi; eski `logs:cleanup` bunun içinde) — KvkkPurgeService.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly running = new Set<JobName>();
  private readonly registry: ReadonlyMap<JobName, JobDefinition>;

  constructor(
    private readonly repo: JobsRepository,
    private readonly delivery: DeliveryService,
    private readonly cycles: CyclesService,
    private readonly checkout: CheckoutCompletionService,
    private readonly kvkk: KvkkPurgeService,
  ) {
    const defs: JobDefinition[] = [
      {
        name: 'delivery-dates:generate',
        cron: '30 0 * * *',
        description: 'Aktif bölgeler × teslimat günleri → ufuk (Setting deliveryDatesHorizonWeeks) kadar DeliveryDate üretir (idempotent).',
        run: async (now) => {
          const r = await this.delivery.generateDates(undefined, now);
          return { itemsProcessed: r.created + r.updated, details: { ...r } };
        },
      },
      {
        name: 'cycles:ensure',
        cron: '0 * * * *',
        description: 'Canlı aboneliklerin önünde ufuk içi haftalar için SCHEDULED cycle bulunsun (yayınlanmış şablon + DD rezerv).',
        run: async (now) => {
          const r = await this.cycles.ensure(now);
          return { itemsProcessed: r.itemsProcessed, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'cycles:lock-and-charge',
        cron: '*/5 * * * *',
        description: 'Kesimi geçmiş SCHEDULED cycle → snapshot/LOCKED → Order → tahsilat (MIT) ya da ödeme linki.',
        run: async (now) => {
          const r = await this.cycles.lockAndCharge(now);
          return { itemsProcessed: r.itemsProcessed, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'cycles:expire-payment-links',
        cron: '*/10 * * * *',
        description: 'Süresi dolan ödeme linkleri: AWAITING_PAYMENT → UNPAID (+ dunning).',
        run: async (now) => {
          const r = await this.cycles.expirePaymentLinks(now);
          return { itemsProcessed: r.itemsProcessed, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'payments:retry',
        cron: '*/15 * * * *',
        description: 'Dunning: UNPAID cycle yeniden deneme (retryHours; teslimat günü 08:00 sınırı) → CHARGED | SKIPPED(UNPAID) → PAST_DUE.',
        run: async (now) => {
          const r = await this.cycles.retryPayments(now);
          return { itemsProcessed: r.itemsProcessed, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'reminders:cutoff',
        cron: '0 * * * *',
        description: 'Kesimden ~24 s önce kesim hatırlatması e-postası (mail.cutoff-reminder; cycle başına bir kez — MailLog tekilliği).',
        run: async (now) => {
          const r = await this.cycles.remindCutoffs(now);
          return { itemsProcessed: r.itemsProcessed, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'payments:reconcile',
        cron: '*/15 * * * *',
        description: 'F8: açık kalmış checkout ödemeleri — 30 dk sonra sağlayıcı sorgusu (SUCCEEDED/FAILED), 24 s sonra EXPIRED + Order CANCELLED + DD iade (+ abonelik PENDING→CANCELLED); ödemesiz eski siparişler iptal.',
        run: async (now) => {
          const r = await this.checkout.reconcile(now);
          return { itemsProcessed: r.checked + r.staleOrdersCancelled, errors: r.errors, details: { ...r } };
        },
      },
      {
        name: 'kvkk:purge',
        cron: '15 3 * * *',
        description:
          'KVKK saklama matrisi (ADR-0015): MailLog/SystemLog/CronLog yaş bazlı silme (logs:cleanup dahil) + AuditLog PII maskeleme + (açıksa) pasif müşteri anonimleştirme. Süreler Setting privacy.*.',
        run: async (now) => {
          const r = await this.kvkk.run(now);
          return { itemsProcessed: KvkkPurgeService.itemsProcessed(r), errors: r.errors, details: { ...r } };
        },
      },
    ];
    this.registry = new Map(defs.map((d) => [d.name, d]));
  }

  names(): JobName[] {
    return [...this.registry.keys()];
  }

  isJobName(name: string): name is JobName {
    return (JOB_NAME_VALUES as readonly string[]).includes(name) && this.registry.has(name as JobName);
  }

  /** Job'ı bir kez çalıştırır (cron / admin / test). Çakışan koşu → SKIPPED ayrıntısıyla başarıyla döner, iş yapmaz. */
  async runOnce(name: string, now: Date = new Date()): Promise<JobRunResult> {
    if (!this.isJobName(name)) throw new NotFoundException(`Bilinmeyen job: ${name}`);
    const def = this.registry.get(name)!;
    if (this.running.has(name)) {
      this.logger.warn(`${name}: önceki koşu sürüyor — atlandı`);
      const iso = now.toISOString();
      return { name, status: 'SUCCESS', itemsProcessed: 0, errors: 0, details: { skipped: 'already-running' }, startedAt: iso, finishedAt: iso, durationMs: 0, cronLogId: null };
    }
    this.running.add(name);
    const traceId = `cron:${name}:${randomUUID().slice(0, 8)}`;
    try {
      return await RequestContext.run({ requestId: traceId, source: 'cron', actorType: 'system' }, async () => {
        const log = await this.repo.start(name, now);
        const startedMs = Date.now();
        try {
          const outcome = await def.run(now);
          const finishedAt = new Date(now.getTime() + (Date.now() - startedMs));
          const row = await this.repo.finish(log.id, { status: 'SUCCESS', itemsProcessed: outcome.itemsProcessed, errors: outcome.errors ?? 0, details: outcome.details ?? null, finishedAt });
          if (outcome.itemsProcessed > 0 || (outcome.errors ?? 0) > 0) this.logger.log(`${name}: ${outcome.itemsProcessed} işlendi, ${outcome.errors ?? 0} hata (${row.durationMs ?? 0} ms)`);
          return this.toResult(row);
        } catch (err) {
          const finishedAt = new Date(now.getTime() + (Date.now() - startedMs));
          const message = (err as Error).message;
          this.logger.error(`${name} başarısız: ${message}`, (err as Error).stack);
          const row = await this.repo.finish(log.id, { status: 'FAILED', itemsProcessed: 0, errors: 1, details: { error: message }, finishedAt });
          return this.toResult(row);
        }
      });
    } finally {
      this.running.delete(name);
    }
  }

  async list(): Promise<JobInfo[]> {
    const out: JobInfo[] = [];
    for (const def of this.registry.values()) {
      const last = await this.repo.findLastRun(def.name);
      out.push({ name: def.name, cron: def.cron, description: def.description, lastRun: last ? this.toResult(last) : null });
    }
    return out;
  }

  async recentRuns(name: string | undefined, take = 50): Promise<JobRunResult[]> {
    if (name !== undefined && !this.isJobName(name)) throw new NotFoundException(`Bilinmeyen job: ${name}`);
    const rows = await this.repo.findRecent(name, Math.min(Math.max(take, 1), 200));
    return rows.map((r) => this.toResult(r));
  }

  private toResult(row: CronLogRecord): JobRunResult {
    return {
      name: row.name as JobName,
      status: row.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      itemsProcessed: row.itemsProcessed,
      errors: row.errors,
      details: (row.details as Record<string, unknown> | null) ?? null,
      startedAt: row.startedAt.toISOString(),
      finishedAt: (row.finishedAt ?? row.startedAt).toISOString(),
      durationMs: row.durationMs ?? 0,
      cronLogId: row.id,
    };
  }
}
