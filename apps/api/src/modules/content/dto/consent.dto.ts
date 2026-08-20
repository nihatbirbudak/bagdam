import { CONSENT_KIND_VALUES, type ConsentKind } from '@bagdam/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, MaxLength, Min } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';
import { LEGAL_SLUG_RE } from './content-params.dto';

/**
 * `POST /consents` (public) — çerez banner'ı / pazarlama izni / KVKK onayı. ip/ua sunucuda, userId oturumdan.
 * `documentSlug` (+`documentVersion`, yoksa yayındaki sürüm) → Consent.documentId (hangi metne onay verildi).
 */
export class CreateConsentDto {
  @IsIn(CONSENT_KIND_VALUES)
  kind!: ConsentKind;

  @IsOptional()
  @TrimString()
  @Matches(LEGAL_SLUG_RE, { message: 'documentSlug geçersiz' })
  documentSlug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  documentVersion?: number;

  /** Varsayılan true (izin verildi); false → ret kaydı (çerez banner'ı "reddet"). */
  @IsOptional()
  @IsBoolean()
  granted?: boolean;

  /** Anonim ziyaretçi anahtarı (çerez değeri). */
  @IsOptional()
  @TrimString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'guestKey geçersiz' })
  guestKey?: string;

  /** HS_WEB (varsayılan) | HS_CHECKOUT | HS_SIGNUP … */
  @IsOptional()
  @TrimString()
  @Matches(/^[A-Z0-9_]{1,20}$/, { message: 'source A-Z0-9_ (≤20) olmalı' })
  source?: string;
}
