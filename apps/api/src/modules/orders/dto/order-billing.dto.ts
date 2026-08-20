import { BILLING_PARTY_VALUES, type BillingParty } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { EmptyToNull, TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `PATCH /admin/orders/:id/billing {billingParty, billingName?, billingTaxNo?, billingTaxOffice?}` — kurumsal fatura talebi
 * admin'den girilir (şema-var/UI-yok [B20]). CORPORATE → billingName + billingTaxNo (10 VKN / 11 TCKN) zorunlu (400).
 */
export class OrderBillingPatchDto {
  @IsIn(BILLING_PARTY_VALUES, { message: 'billingParty geçersiz' })
  billingParty!: BillingParty;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: OrderBillingPatchDto) => o.billingName !== null)
  @TrimString()
  @IsString()
  @MaxLength(200)
  billingName?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: OrderBillingPatchDto) => o.billingTaxNo !== null)
  @TrimString()
  @Matches(/^\d{10,11}$/, { message: 'Vergi/TC kimlik no 10 ya da 11 rakam olmalı' })
  billingTaxNo?: string | null;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((o: OrderBillingPatchDto) => o.billingTaxOffice !== null)
  @TrimString()
  @IsString()
  @MaxLength(100)
  billingTaxOffice?: string | null;
}
