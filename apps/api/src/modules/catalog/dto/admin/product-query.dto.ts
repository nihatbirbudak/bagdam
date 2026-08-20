import { PRODUCT_STATUS_VALUES, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { ID_RE, ToOptionalBoolean, TrimString } from './transforms';

/** `GET /admin/products?page&limit&q&categoryId&status&stockStatus&isFresh` */
export class AdminProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Matches(ID_RE, { message: 'categoryId geçersiz' })
  categoryId?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUS_VALUES)
  status?: ProductStatus;

  @IsOptional()
  @IsIn(STOCK_STATUS_VALUES)
  stockStatus?: StockStatus;

  @IsOptional()
  @ToOptionalBoolean()
  @IsBoolean()
  isFresh?: boolean;
}
