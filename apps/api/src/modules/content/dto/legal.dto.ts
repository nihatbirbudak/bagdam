import { LEGAL_KIND_VALUES, type LegalKind } from '@bagdam/shared';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { EmptyToNull, TrimString } from '../../catalog/dto/admin/transforms';

/**
 * `POST /admin/legal/:slug/versions` — yeni TASLAK sürüm (version = max+1, isCurrent=false).
 * `kind` yalnız yeni slug'da zorunlu (var olan slug'da mevcut tür korunur); nav/sıra/onay verilmezse yayındaki
 * (yoksa en son) sürümden miras alınır.
 */
export class CreateLegalVersionDto {
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(20_000)
  leadHtml?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  bodyHtml!: string;

  @IsOptional()
  @IsIn(LEGAL_KIND_VALUES)
  kind?: LegalKind;

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  @IsOptional()
  @IsBoolean()
  showInNav?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

/** `PUT /admin/legal/:id` — yalnız taslak (isCurrent=false) sürümde; yayındakinde 409. */
export class UpdateLegalDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(20_000)
  leadHtml?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  bodyHtml?: string;
}

/** `POST /admin/legal/:id/publish` — effectiveFrom verilmezse şimdi. */
export class PublishLegalDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;
}

/** `PATCH /admin/legal/:id/nav` — slug'ın tüm sürümlerine uygulanır. */
export class LegalNavPatchDto {
  @IsOptional()
  @IsBoolean()
  showInNav?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;
}
