import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { SystemLogList } from '@bagdam/shared';
import type { SystemLogSink } from '../../common/filters/all-exceptions.filter';
import { redactObject } from '../../common/security/redaction';
import type { SystemLogQueryDto } from './dto/system-log-query.dto';
import { toSystemLogItem } from './system-log.mapper';
import { SystemLogsRepository } from './system-logs.repository';

export interface SystemLogInput {
  level: 'error' | 'fatal' | 'warn' | 'info';
  module: string;
  action?: string | null;
  message: string;
  requestId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Aynı parmak izi bu pencerede tekrar ederse yeni satır açılmaz, sayaç artar. */
export const FINGERPRINT_WINDOW_MS = 60 * 60 * 1000;

/** VarChar kolonlarına sığdır. */
function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Parmak izi: seviye + modül + eylem + mesajın "değişken kısımları temizlenmiş" hâli
 * (cuid/uuid/sayı/tarih → yer tutucu) → aynı hata bir satırda toplanır.
 */
export function fingerprintOf(input: Pick<SystemLogInput, 'level' | 'module' | 'action' | 'message'>): string {
  const normalized = input.message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\bc[a-z0-9]{20,}\b/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 300);
  return createHash('sha256')
    .update(`${input.level}|${input.module}|${input.action ?? '-'}|${normalized}`)
    .digest('hex')
    .slice(0, 64);
}

/**
 * SystemLogsService — `system_logs` yazma (AllExceptionsFilter 5xx, servisler) + admin listesi (ekran 22).
 *
 * `recordError` ateşle-unut: log yazılamadı diye iş isteği 500'e dönmemeli (AuditService.record ile aynı kural).
 * Saklama: 30 gün (`kvkk:purge` / `logs:cleanup` — ADR-0015).
 */
@Injectable()
export class SystemLogsService implements SystemLogSink {
  private readonly logger = new Logger(SystemLogsService.name);

  constructor(private readonly repo: SystemLogsRepository) {}

  /** Ateşle-unut sarmalayıcı (AllExceptionsFilter arayüzü). */
  recordError(input: SystemLogInput): void {
    void this.record(input);
  }

  async record(input: SystemLogInput): Promise<void> {
    try {
      const now = new Date();
      const fingerprint = fingerprintOf(input);
      const existing = await this.repo.findRecentByFingerprint(fingerprint, new Date(now.getTime() - FINGERPRINT_WINDOW_MS));
      if (existing) {
        await this.repo.bumpOccurrence(existing.id, now);
        return;
      }
      await this.repo.create({
        level: clip(input.level, 10) ?? 'error',
        module: clip(input.module, 40) ?? 'unknown',
        action: clip(input.action, 40),
        message: input.message.slice(0, 4000),
        requestId: clip(input.requestId, 60),
        userId: input.userId ?? null,
        metadata: (redactObject(input.metadata ?? null) as Prisma.InputJsonValue) ?? undefined,
        fingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    } catch (err) {
      this.logger.error(`SystemLog yazılamadı (${input.module} ${input.level}): ${(err as Error).message}`);
    }
  }

  async list(query: SystemLogQueryDto): Promise<SystemLogList> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const where: Prisma.SystemLogWhereInput = {};
    if (query.level) where.level = query.level;
    if (query.module) where.module = query.module;
    if (query.requestId) where.requestId = query.requestId;
    if (query.search) {
      where.OR = [
        { message: { contains: query.search, mode: 'insensitive' } },
        { module: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const { items, total } = await this.repo.list({ where, skip: (page - 1) * limit, take: limit });
    return { items: items.map(toSystemLogItem), total, page, limit };
  }

  /** Sağlık kartı: son 24 saatte seviye başına satır sayısı. */
  async countsByLevelSince(since: Date): Promise<Record<string, number>> {
    const rows = await this.repo.countByLevelSince(since);
    const out: Record<string, number> = {};
    for (const row of rows) out[row.level] = row.count;
    return out;
  }
}
