import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SYSTEM_LOG_LEVEL_VALUES, type SystemLogLevel } from '@bagdam/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /admin/system-logs?page&limit&level&module&requestId&search` */
export class SystemLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SYSTEM_LOG_LEVEL_VALUES)
  level?: SystemLogLevel;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  requestId?: string;
}
