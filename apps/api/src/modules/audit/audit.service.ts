import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditLogDto, toAuditLogDto } from './audit.mapper';
import { AuditRepository } from './audit.repository';
import type { AuditQueryDto } from './dto/audit-query.dto';

/** Interceptor'ın (ya da ileride cron/servislerin) yazdığı kayıt — kolon sınırları burada kırpılır. */
export interface AuditRecordInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  module: string;
  entityId?: string | null;
  summary?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  requestId?: string | null;
  ipAddress?: string | null;
}

export interface AuditLogListResponse {
  items: AuditLogDto[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** VarChar kolonlarına sığdır (null/undefined korunur). */
function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** JSON kolonuna yazılabilir hâle getir: undefined → kolon boş; nesne/dizi/ilkel → JSON round-trip (Date vb. serileşir). */
function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

/**
 * AuditService — audit satırı yazma (record) + admin listesi (list).
 * `record` hataları yutar ve loglar: denetim kaydı yazılamadı diye iş isteği 500'e dönmemeli.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.repo.create({
        actorId: input.actorId ?? null,
        actorEmail: clip(input.actorEmail, 160),
        action: clip(input.action, 20) ?? 'UNKNOWN',
        module: clip(input.module, 40) ?? 'unknown',
        entityId: clip(input.entityId, 60),
        summary: clip(input.summary, 255),
        oldValues: toJsonInput(input.oldValues),
        newValues: toJsonInput(input.newValues),
        requestId: clip(input.requestId, 60),
        ipAddress: clip(input.ipAddress, 64),
      });
    } catch (err) {
      this.logger.error(`Audit log yazılamadı (${input.module} ${input.action}): ${(err as Error).message}`);
    }
  }

  async list(query: AuditQueryDto): Promise<AuditLogListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const where: Prisma.AuditLogWhereInput = {};
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action.toUpperCase();
    if (query.actorId) where.actorId = query.actorId;
    if (query.entityId) where.entityId = query.entityId;
    if (query.search) {
      where.OR = [
        { summary: { contains: query.search, mode: 'insensitive' } },
        { actorEmail: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const { items, total } = await this.repo.list({ where, skip: (page - 1) * limit, take: limit });
    return { items: items.map(toAuditLogDto), total, page, limit };
  }
}
