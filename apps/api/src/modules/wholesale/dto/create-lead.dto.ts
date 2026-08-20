import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Metni kırpar; boş kalırsa alan yok sayılır (undefined). Diğer tipler dokunulmaz (→ @IsString 400). */
function trimOrUndefined({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value === null ? undefined : value;
  const t = value.trim();
  return t === '' ? undefined : t;
}
const OptionalTrimmed = () => Transform(trimOrUndefined);

/**
 * `POST /wholesale-leads {email, businessName?, phone?, note?}` — toptan.html formu (MVP'de yalnız e-posta;
 * diğer alanlar şema-var/UI-yok [ADR-0016 "toptan form alanları" lansman sonrası]). Boş metin → yok sayılır.
 */
export class CreateWholesaleLeadDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @OptionalTrimmed()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @IsOptional()
  @OptionalTrimmed()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9+() .-]{6,30}$/, { message: 'Telefon yalnız rakam, +, boşluk, parantez ve tire içerebilir' })
  phone?: string;

  @IsOptional()
  @OptionalTrimmed()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
