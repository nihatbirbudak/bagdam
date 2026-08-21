import { IsIn, IsOptional } from 'class-validator';
import {
  PAYMENT_PROVIDER_VALUES,
  WEBHOOK_STATUS_VALUES,
  type PaymentProvider,
  type WebhookStatus,
} from '@bagdam/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /admin/webhook-events?page&limit&provider&status&search` (search: providerRef / eventType). */
export class WebhookEventQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PAYMENT_PROVIDER_VALUES)
  provider?: PaymentProvider;

  @IsOptional()
  @IsIn(WEBHOOK_STATUS_VALUES)
  status?: WebhookStatus;
}
