import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CRON_LOG_STATUS_VALUES, type CronLogStatus } from '@bagdam/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /admin/cron-logs?page&limit&name&status&search` */
export class CronLogQueryDto extends PaginationQueryDto {
  /** Job adı (`cycles:ensure` …) — serbest metin: kayıt defterinden kalkan eski adlar da listelenebilsin. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(CRON_LOG_STATUS_VALUES)
  status?: CronLogStatus;
}
