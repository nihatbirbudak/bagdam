import { Injectable } from '@nestjs/common';
import { Prisma, type CronLog } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type CronLogRecord = CronLog;

export interface CronLogFinishInput {
  status: 'SUCCESS' | 'FAILED';
  itemsProcessed: number;
  errors: number;
  details: Record<string, unknown> | null;
  finishedAt: Date;
}

/** JobsRepository — CronLog satırları; Prisma YALNIZ burada (ADR-0002). Zaman parametreyle (ADR-0004). */
@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  start(name: string, startedAt: Date): Promise<CronLogRecord> {
    return this.prisma.cronLog.create({ data: { name, status: 'RUNNING', startedAt } });
  }

  async finish(id: string, input: CronLogFinishInput): Promise<CronLogRecord> {
    const row = await this.prisma.cronLog.findUnique({ where: { id } });
    const durationMs = row ? Math.max(0, input.finishedAt.getTime() - row.startedAt.getTime()) : null;
    return this.prisma.cronLog.update({
      where: { id },
      data: {
        status: input.status,
        itemsProcessed: input.itemsProcessed,
        errors: input.errors,
        details: input.details ? (input.details as Prisma.InputJsonValue) : Prisma.JsonNull,
        finishedAt: input.finishedAt,
        durationMs,
      },
    });
  }

  findLastRun(name: string): Promise<CronLogRecord | null> {
    return this.prisma.cronLog.findFirst({ where: { name, status: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } });
  }

  findRecent(name: string | undefined, take: number): Promise<CronLogRecord[]> {
    return this.prisma.cronLog.findMany({ where: name ? { name } : {}, orderBy: { startedAt: 'desc' }, take });
  }
}
