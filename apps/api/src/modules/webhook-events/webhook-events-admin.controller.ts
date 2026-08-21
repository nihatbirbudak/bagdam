import { Controller, Get, Query } from '@nestjs/common';
import type { WebhookEventList } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebhookEventQueryDto } from './dto/webhook-event-query.dto';
import { WebhookEventsService } from './webhook-events.service';

/**
 * `GET /api/v1/admin/webhook-events?page&limit&provider&status&search` — ekran 22 › Webhook olayları.
 * Salt okunur; `payload` redakte edilerek döner (imza/hash ve PII panelde de görünmez).
 */
@Controller('admin/webhook-events')
@Roles('ADMIN', 'STAFF')
export class WebhookEventsAdminController {
  constructor(private readonly events: WebhookEventsService) {}

  @Get()
  list(@Query() query: WebhookEventQueryDto): Promise<WebhookEventList> {
    return this.events.list(query);
  }
}
