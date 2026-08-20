import { isAbsolute, resolve } from 'path';
import { APP_ROOT } from '../../config/paths';

/** multer bellek sınırı — BACKEND-PLANI §3 media: 20 MB. */
export const MEDIA_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** sharp giriş piksel sınırı (image bomb koruması): 50 MP. */
export const MEDIA_LIMIT_INPUT_PIXELS = 50_000_000;

/** Ana görsel en uzun kenar (px) — webp'ye dönüştürülür. */
export const MEDIA_MAX_DIMENSION = 2000;

/** Küçük görsel (thumb) genişliği (px). */
export const MEDIA_THUMB_WIDTH = 400;

/** webp kalite ayarları. */
export const MEDIA_WEBP_QUALITY = 82;
export const MEDIA_THUMB_WEBP_QUALITY = 70;

/** Kabul edilen giriş türleri (hepsi webp'ye dönüştürülür; SVG/PDF/video yok). */
export const MEDIA_ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
];

/** Varsayılan klasör (MediaFile.folder @default("genel")). */
export const MEDIA_DEFAULT_FOLDER = 'genel';

/** Klasör adı kuralı (slug'lanmış): küçük harf, rakam, tire; 1–40. */
export const MEDIA_FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Yükleme kök dizini: `UPLOADS_DIR` (göreliyse apps/api köküne göre) ya da `apps/api/uploads`.
 * Çağrı anında okunur (testler env ile geçici dizine yönlendirebilir). Statik servis (`/uploads/*`) main.ts'te (D).
 */
export function resolveUploadsDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.UPLOADS_DIR?.trim();
  if (!raw) return resolve(APP_ROOT, 'uploads');
  return isAbsolute(raw) ? raw : resolve(APP_ROOT, raw);
}
