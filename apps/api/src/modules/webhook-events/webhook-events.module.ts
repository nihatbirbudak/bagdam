import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { WebhookEventsAdminController } from './webhook-events-admin.controller';
import { WebhookEventsRepository } from './webhook-events.repository';
import { WebhookEventsService } from './webhook-events.service';

/**
 * WebhookEventsModule (F10) — `webhook_events` okuma: ekran 22 › Webhook olayları + sağlık kartı.
 * Yazma tarafı PaymentsModule'de (PayTR bildirimi); burada yalnız salt okunur admin görünümü.
 */
@Module({
  imports: [PrismaModule],
  controllers: [WebhookEventsAdminController],
  providers: [WebhookEventsRepository, WebhookEventsService],
  exports: [WebhookEventsService],
})
export class WebhookEventsModule {}
