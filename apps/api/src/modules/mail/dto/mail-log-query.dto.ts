import { MAIL_STATUS_VALUES, type MailStatus } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** `GET /admin/mail-logs?page&limit&status&to` */
export class MailLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(MAIL_STATUS_VALUES)
  status?: MailStatus;

  /** Alıcı e-postasında içerir (büyük/küçük harf duyarsız). */
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(160)
  to?: string;
}
