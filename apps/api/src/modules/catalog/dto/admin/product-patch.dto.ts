import { PRODUCT_STATUS_VALUES, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** `PATCH /admin/products/:id/status {status}` */
export class ProductStatusDto {
  @IsIn(PRODUCT_STATUS_VALUES)
  status!: ProductStatus;
}

/** `PATCH /admin/products/:id/stock {stockStatus}` */
export class ProductStockDto {
  @IsIn(STOCK_STATUS_VALUES)
  stockStatus!: StockStatus;
}

/** `PATCH /admin/products/:id/pair {pairWithBox, pairOrder?}` (kutu.html pairIds) */
export class ProductPairDto {
  @IsBoolean()
  pairWithBox!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  pairOrder?: number;
}
