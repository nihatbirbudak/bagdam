import { Transform, type TransformFnParams } from 'class-transformer';

/**
 * Sorgu/gövde dönüşümleri (ValidationPipe `transform: true` ile çalışır).
 * Query string'de her şey metindir: "true"/"false"/"1"/"0" → boolean; boş metin → undefined.
 */
export function toOptionalBoolean({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value; // geçersiz → @IsBoolean 400 döndürür
}

/** Boş metni null'a çevirir (opsiyonel metin alanları: "" → null). Diğer değerler dokunulmaz. */
export function emptyToNull({ value }: TransformFnParams): unknown {
  return value === '' ? null : value;
}

/** Metin alanlarının baş/son boşluklarını kırpar. */
export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const ToOptionalBoolean = () => Transform(toOptionalBoolean);
export const EmptyToNull = () => Transform(emptyToNull);
export const TrimString = () => Transform(trimString);

/** Slug kuralı (Product/Producer/BoxTier/Category): küçük harf, rakam, tire/alt çizgi, 1–80 karakter. */
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
/** Takvim günü (YYYY-MM-DD); takvimde olup olmadığı serviste `isoDateToUtc` ile denetlenir. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** cuid / kimlik parametresi — yalnız güvenli karakterler. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
