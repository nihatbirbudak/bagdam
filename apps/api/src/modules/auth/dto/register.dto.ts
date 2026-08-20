import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LEGAL_SLUG_RE } from '../../content/dto/content-params.dto';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** Kayıtta verilebilen onay türleri (ADR-0003 istisna 2: KVKK aydınlatma + pazarlama kutucukları). */
export const REGISTER_CONSENT_KINDS = ['KVKK_ACK', 'MARKETING_EMAIL', 'MARKETING_SMS'] as const;
export type RegisterConsentKind = (typeof REGISTER_CONSENT_KINDS)[number];

export class RegisterConsentDto {
  @IsIn(REGISTER_CONSENT_KINDS, { message: 'consents[].kind KVKK_ACK | MARKETING_EMAIL | MARKETING_SMS olmalı' })
  kind!: RegisterConsentKind;

  @IsBoolean({ message: 'consents[].granted true/false olmalı' })
  granted!: boolean;

  /** Onaylanan LegalDocument.slug (yayındaki sürüm bağlanır); verilmezse türün varsayılan belgesi. */
  @IsOptional()
  @TrimString()
  @Matches(LEGAL_SLUG_RE, { message: 'consents[].documentSlug geçersiz' })
  documentSlug?: string;
}

/**
 * `POST /auth/register {email, password(min 8), name?, phone?, consents:[{kind,granted,documentSlug?}]}` — KVKK_ACK
 * granted zorunlu (yoksa 400 KVKK_REQUIRED — serviste). Boş metin ad/telefon yok sayılır.
 */
export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Parola en az 8 karakter olmalı' })
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: RegisterDto) => o.name !== undefined)
  @TrimString()
  @IsString()
  @MinLength(2, { message: 'Ad en az 2 karakter olmalı' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @ValidateIf((o: RegisterDto) => o.phone !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{7,30}$/, { message: 'Geçerli bir telefon numarası girin' })
  phone?: string;

  @IsArray({ message: 'consents listesi gerekli' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RegisterConsentDto)
  consents!: RegisterConsentDto[];
}
