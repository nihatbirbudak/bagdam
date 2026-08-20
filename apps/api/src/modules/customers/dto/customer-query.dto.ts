import { USER_ROLE_VALUES, type UserRole } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** `GET /admin/customers?q&role&page&limit` — q: e-posta/ad/telefon içerir (büyük/küçük harf duyarsız). */
export class CustomerQueryDto extends PaginationQueryDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsIn(USER_ROLE_VALUES)
  role?: UserRole;
}
