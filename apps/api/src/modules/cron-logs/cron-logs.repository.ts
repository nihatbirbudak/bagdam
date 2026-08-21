import { Injectable } from '@nestjs/common';
import type { CronLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface CronLogListArgs {
  where: Prisma.CronLogWhereInput;
  skip: number;
  take: number;
}

/** CronLogsRepository — `cron_logs` tablosu okuma (yazan taraf JobsRepository; Prisma yalnız repository'de). */
@Injectable()
export class CronLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: CronLogListArgs): Promise<{ items: CronLog[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.cronLog.findMany({
        where: args.where,
        orderBy: { startedAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      this.prisma.cronLog.count({ where: args.where }),
    ]);
    return { items, total };
  }

  /** Sağlık kartı: job adı başına en son koşu (küçük tablo — tek sorgu + JS tarafında ilkini al). */
  async latestPerName(limit: number): Promise<CronLog[]> {
    return this.prisma.cronLog.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
  }

  countFailedSince(since: Date): Promise<number> {
    return this.prisma.cronLog.count({ where: { status: 'FAILED', startedAt: { gte: since } } });
  }
}
