import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WebhookEventList } from '@bagdam/shared';
import type { WebhookEventQueryDto } from './dto/webhook-event-query.dto';
import { toWebhookEventItem } from './webhook-event.mapper';
import { WebhookEventsRepository } from './webhook-events.repository';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** WebhookEventsService — ekran 22 › Webhook olayları (salt okunur; payload redakte edilir). */
@Injectable()
export class WebhookEventsService {
  constructor(private readonly repo: WebhookEventsRepository) {}

  async list(query: WebhookEventQueryDto): Promise<WebhookEventList> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

    const where: Prisma.WebhookEventWhereInput = {};
    if (query.provider) where.provider = query.provider;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { providerRef: { contains: query.search, mode: 'insensitive' } },
        { eventType: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const { items, total } = await this.repo.list({ where, skip: (page - 1) * limit, take: limit });
    return { items: items.map(toWebhookEventItem), total, page, limit };
  }

  statsSince(since: Date): Promise<{ total: number; invalidSignature: number; failed: number }> {
    return this.repo.statsSince(since);
  }
}
