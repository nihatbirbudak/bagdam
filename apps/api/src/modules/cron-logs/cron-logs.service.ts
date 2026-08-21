import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CronLogItem, CronLogList } from '@bagdam/shared';
import { toCronLogItem } from './cron-log.mapper';
import { CronLogsRepository } from './cron-logs.repository';
import type { CronLogQueryDto } from './dto/cron-log-query.dto';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Sağlık kartında "job adı → son koşu" için taranacak en yeni satır sayısı. */
const LATEST_SCAN_ROWS = 200;

/**
 * CronLogsService — `cron_logs` listesi (ekran 22 › Cron günlüğü) + sağlık kartı özetleri.
 * Yazma tarafı JobsModule'dedir (her koşu RUNNING → SUCCESS|FAILED satırı yazar).
 */
@Injectable()
export class CronLogsService {
  constructor(private readonly repo: CronLogsRepository) {}

  async list(query: CronLogQueryDto): Promise<CronLogList> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const where: Prisma.CronLogWhereInput = {};
    if (query.name) where.name = query.name;
    if (query.status) where.status = query.status;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const { items, total } = await this.repo.list({ where, skip: (page - 1) * limit, take: limit });
    return { items: items.map(toCronLogItem), total, page, limit };
  }

  /** Job adı başına en son koşu (en yeni `LATEST_SCAN_ROWS` satır taranır). */
  async latestPerName(): Promise<CronLogItem[]> {
    const rows = await this.repo.latestPerName(LATEST_SCAN_ROWS);
    const seen = new Map<string, CronLogItem>();
    for (const row of rows) {
      if (!seen.has(row.name)) seen.set(row.name, toCronLogItem(row));
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }

  countFailedSince(since: Date): Promise<number> {
    return this.repo.countFailedSince(since);
  }
}
