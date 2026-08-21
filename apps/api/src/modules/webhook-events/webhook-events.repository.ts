import { Injectable } from '@nestjs/common';
import type { Prisma, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface WebhookEventListArgs {
  where: Prisma.WebhookEventWhereInput;
  skip: number;
  take: number;
}

/** WebhookEventsRepository — `webhook_events` okuma (yazan taraf PaymentsRepository). */
@Injectable()
export class WebhookEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: WebhookEventListArgs): Promise<{ items: WebhookEvent[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where: args.where,
        orderBy: { receivedAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      this.prisma.webhookEvent.count({ where: args.where }),
    ]);
    return { items, total };
  }

  /** Sağlık kartı: `since`'dan beri toplam / imzası geçersiz / hatalı bildirim sayıları. */
  async statsSince(since: Date): Promise<{ total: number; invalidSignature: number; failed: number }> {
    const [total, invalidSignature, failed] = await Promise.all([
      this.prisma.webhookEvent.count({ where: { receivedAt: { gte: since } } }),
      this.prisma.webhookEvent.count({ where: { receivedAt: { gte: since }, signatureValid: false } }),
      this.prisma.webhookEvent.count({ where: { receivedAt: { gte: since }, status: 'FAILED' } }),
    ]);
    return { total, invalidSignature, failed };
  }
}
