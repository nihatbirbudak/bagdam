import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { EmptyToNull, TrimString } from '../../catalog/dto/admin/transforms';

/** `PATCH /admin/orders/:id/invoice {invoiceNo, invoicePdfPath?}` — manuel GİB e-Arşiv (ADR-0010); invoiceNo null/'' → temizler. */
export class OrderInvoicePatchDto {
  @EmptyToNull()
  @ValidateIf((o: OrderInvoicePatchDto) => o.invoiceNo !== null)
  @TrimString()
  @IsString()
  @MaxLength(40)
  invoiceNo!: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: OrderInvoicePatchDto) => o.invoicePdfPath !== null)
  @TrimString()
  @IsString()
  @MaxLength(255)
  invoicePdfPath?: string | null;
}
