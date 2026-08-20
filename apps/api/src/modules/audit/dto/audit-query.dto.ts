import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /admin/audit-logs?page&limit&module&action&actorId&entityId&search` */
export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityId?: string;
}
