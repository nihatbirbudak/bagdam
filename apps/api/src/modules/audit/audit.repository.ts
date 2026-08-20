import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface AuditLogListArgs {
  where: Prisma.AuditLogWhereInput;
  skip: number;
  take: number;
}

/** AuditRepository — audit_logs tablosu (Prisma yalnız burada, ADR-0002). Satırlar asla güncellenmez/silinmez. */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuditLogUncheckedCreateInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data });
  }

  async list(args: AuditLogListArgs): Promise<{ items: AuditLog[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: args.where,
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      this.prisma.auditLog.count({ where: args.where }),
    ]);
    return { items, total };
  }
}
