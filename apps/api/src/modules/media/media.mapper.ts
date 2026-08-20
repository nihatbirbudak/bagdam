import type { AdminMediaFile } from '@bagdam/shared';
import type { MediaFile } from '@prisma/client';

/** Seed/import ile gelen görseller `public/` altında: path `assets/...` → URL `/assets/...`. */
const PUBLIC_ASSET_PREFIX = 'assets/';
/** Admin yüklemeleri `apps/api/uploads/<klasör>/<dosya>.webp` → URL `/uploads/<klasör>/<dosya>.webp`. */
const UPLOADS_URL_PREFIX = '/uploads/';

/**
 * MediaFile.path → genel URL. TEK YER (BACKEND-PLANI §3 media): catalog admin mapper'ı da bunu kullanır.
 * - `assets/images/x.jpg` (public/ altındaki seed görselleri) → `/assets/images/x.jpg`
 * - `urunler/x.webp` (uploads/ altındaki yeni yüklemeler) → `/uploads/urunler/x.webp`
 * - null/boş → null
 */
export function toPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.startsWith(PUBLIC_ASSET_PREFIX)) return `/${clean}`;
  return `${UPLOADS_URL_PREFIX}${clean}`;
}

/**
 * MediaFile.path → SİTE-GÖRELİ kaynak yolu (bootstrap `img`/`images`, tier `img`, public katalog DTO'ları).
 * Sayfalar kökte (`/urun.html`) olduğundan ve products.js paritesi (snapshot testi) gerektirdiğinden baştaki eğik
 * çizgi YOK: seed `assets/images/x.jpg` aynen; yüklemeler `uploads/urunler/x.webp` (statik servis: main.ts `/uploads/`).
 * `toPublicUrl` (admin; `/...` mutlak yol) ile aynı dosyada durur: URL türetme kuralı tek yerde.
 */
export function toSiteMediaPath(path: string | null | undefined): string | null {
  const url = toPublicUrl(path);
  return url === null ? null : url.slice(1);
}

/** Yüklenen dosya path'i mi (uploads/ altında, silinebilir) yoksa public/ seed görseli mi (asla silinmez)? */
export function isUploadedPath(path: string): boolean {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return !clean.startsWith(PUBLIC_ASSET_PREFIX);
}

/** DB kaydı → AdminMediaFile (POST/GET /admin/media). */
export function toAdminMediaFile(row: MediaFile): AdminMediaFile {
  return {
    id: row.id,
    url: toPublicUrl(row.path) ?? '',
    thumbUrl: toPublicUrl(row.thumbPath),
    path: row.path,
    thumbPath: row.thumbPath,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    alt: row.alt,
    folder: row.folder,
    createdAt: row.createdAt.toISOString(),
  };
}
