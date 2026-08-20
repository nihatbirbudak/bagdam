import { ORDER_KIND_VALUES, ORDER_STATUS_VALUES, type OrderKind, type OrderStatus } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ISO_DATE_RE, TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `GET /admin/orders?status&kind&from&to&deliveryOn&q&page&limit` ve `GET /admin/orders/export.csv` (aynı filtre, sayfasız).
 * from/to: createdAt için Europe/Istanbul takvim günü aralığı (her ikisi dahil); deliveryOn: teslimat günü (ops).
 * q: `1001` / `#1001` → orderNo; değilse ad/e-posta/telefon içerir.
 */
export class AdminOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUS_VALUES, { message: 'status geçersiz' })
  status?: OrderStatus;

  @IsOptional()
  @IsIn(ORDER_KIND_VALUES, { message: 'kind geçersiz' })
  kind?: OrderKind;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'from YYYY-MM-DD olmalı' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'to YYYY-MM-DD olmalı' })
  to?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'deliveryOn YYYY-MM-DD olmalı' })
  deliveryOn?: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(160)
  q?: string;
}
