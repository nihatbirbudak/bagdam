import { LEAD_STATUS_VALUES, type LeadStatus } from '@bagdam/shared';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /admin/wholesale-leads?status&page&limit` */
export class WholesaleLeadQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(LEAD_STATUS_VALUES)
  status?: LeadStatus;
}
