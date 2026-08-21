import { Injectable } from '@nestjs/common';
import type { Prisma, SystemLog } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface SystemLogListArgs {
  where: Prisma.SystemLogWhereInput;
  skip: number;
  take: number;
}

/** SystemLogRepository — `system_logs` tablosu (Prisma yalnız burada, ADR-0002). */
@Injectable()
export class SystemLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Aynı parmak izine sahip, `since`'dan sonra son görülmüş satır (tekilleştirme penceresi). */
  findRecentByFingerprint(fingerprint: string, since: Date): Promise<SystemLog | null> {
    return this.prisma.systemLog.findFirst({
      where: { fingerprint, lastSeenAt: { gte: since } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  create(data: Prisma.SystemLogUncheckedCreateInput): Promise<SystemLog> {
    return this.prisma.systemLog.create({ data });
  }

  /** Tekrarlanan hata: sayaç + son görülme (ADR-0004: `now()` yasak, bağlı Date). */
  bumpOccurrence(id: string, lastSeenAt: Date): Promise<SystemLog> {
    return this.prisma.systemLog.update({
      where: { id },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt },
    });
  }

  async list(args: SystemLogListArgs): Promise<{ items: SystemLog[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.systemLog.findMany({
        where: args.where,
        orderBy: { lastSeenAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      this.prisma.systemLog.count({ where: args.where }),
    ]);
    return { items, total };
  }

  /** Sağlık kartı: seviye başına son `since` penceresindeki satır sayısı. */
  async countByLevelSince(since: Date): Promise<Array<{ level: string; count: number }>> {
    const rows = await this.prisma.systemLog.groupBy({
      by: ['level'],
      where: { lastSeenAt: { gte: since } },
      _count: { _all: true },
    });
    return rows.map((row) => ({ level: row.level, count: row._count._all }));
  }
}
