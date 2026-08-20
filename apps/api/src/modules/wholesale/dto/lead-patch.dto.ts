import { LEAD_STATUS_VALUES, type LeadStatus } from '@bagdam/shared';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { EmptyToNull, TrimString } from '../../catalog/dto/admin/transforms';

/** `PATCH /admin/wholesale-leads/:id {status?, note?}` — en az biri zorunlu (serviste 400). note: "" → null (silinir). */
export class WholesaleLeadPatchDto {
  @IsOptional()
  @IsIn(LEAD_STATUS_VALUES)
  status?: LeadStatus;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
