import { Injectable } from '@nestjs/common';
import { MailStatus, Prisma, type MailLog } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type MailLogRecord = MailLog;

export interface MailLogOpenInput {
  to: string;
  subject: string;
  templateSlug: string;
  entityId: string | null;
}

export interface MailLogFinishInput {
  status: MailStatus;
  error?: string | null;
  messageId?: string | null;
  sentAt?: Date | null;
}

export interface MailLogFilter {
  status?: MailStatus;
  to?: string;
}

/**
 * MailRepository — MailLog tablosu; Prisma YALNIZ burada (ADR-0002). Zaman parametreyle gelir (ADR-0004).
 * `open`: (templateSlug, entityId) tekil → entityId varsa upsert (yeniden gönderim satırı günceller, createdAt tazelenir);
 * entityId yoksa her gönderim yeni satır. `finish`: durum/hata/messageId/sentAt.
 */
@Injectable()
export class MailRepository {
  constructor(private readonly prisma: PrismaService) {}

  async open(input: MailLogOpenInput, now: Date): Promise<MailLogRecord> {
    const base = { to: input.to, subject: input.subject, templateSlug: input.templateSlug, status: MailStatus.QUEUED, error: null, messageId: null, sentAt: null };
    if (!input.entityId) {
      return this.prisma.mailLog.create({ data: { ...base, entityId: null, createdAt: now } });
    }
    return this.prisma.mailLog.upsert({
      where: { templateSlug_entityId: { templateSlug: input.templateSlug, entityId: input.entityId } },
      create: { ...base, entityId: input.entityId, createdAt: now },
      update: { ...base, createdAt: now },
    });
  }

  finish(id: string, input: MailLogFinishInput): Promise<MailLogRecord> {
    return this.prisma.mailLog.update({
      where: { id },
      data: {
        status: input.status,
        error: input.error ?? null,
        messageId: input.messageId ?? null,
        sentAt: input.sentAt ?? null,
      },
    });
  }

  /** F10: (templateSlug, entityId) satırı — `MailService.sendOnce` aynı varlığa ikinci kez göndermesin diye. */
  findByEntity(templateSlug: string, entityId: string): Promise<MailLogRecord | null> {
    return this.prisma.mailLog.findUnique({ where: { templateSlug_entityId: { templateSlug, entityId } } });
  }

  /** F10 kvkk:purge: verilen andan eski satırlar (önizleme dosyaları çağıran tarafından silinir). */
  findOlderThan(before: Date, take: number): Promise<MailLogRecord[]> {
    return this.prisma.mailLog.findMany({ where: { createdAt: { lt: before } }, orderBy: { createdAt: 'asc' }, take });
  }

  async deleteByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await this.prisma.mailLog.deleteMany({ where: { id: { in: [...ids] } } });
    return r.count;
  }

  findById(id: string): Promise<MailLogRecord | null> {
    return this.prisma.mailLog.findUnique({ where: { id } });
  }

  async list(filter: MailLogFilter, skip: number, take: number): Promise<{ rows: MailLogRecord[]; total: number }> {
    const where: Prisma.MailLogWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.to ? { to: { contains: filter.to, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mailLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.mailLog.count({ where }),
    ]);
    return { rows, total };
  }
}
