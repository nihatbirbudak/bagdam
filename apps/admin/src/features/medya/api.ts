/** Medya admin uçları (`/api/v1/admin/media`) — F4 sözleşmesi. */
import { api, buildQuery } from '../../lib/api';
import type { AdminMediaFile, AdminMediaList, AdminMediaPatchBody } from '../../lib/adminTypes';

export interface MediaListParams {
  page?: number;
  limit?: number;
  folder?: string;
  q?: string;
}

/** Önerilen klasörler (media:import kuralı + yeni yüklemeler). */
export const MEDIA_FOLDERS = ['urunler', 'sahne', 'kutular', 'ureticiler', 'logo', 'ikonlar', 'genel'] as const;

/** Dosya adı/alt metin için sunucu tarafı sınırları (MediaFile.alt VarChar(160)). */
export const MEDIA_ALT_MAX = 160;
/** multer bellek sınırı (20 MB). */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff';
/** Klasör adı kuralı (API MEDIA_FOLDER_RE ile aynı): küçük harf, rakam, tire; 1–40. */
export const MEDIA_FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const mediaApi = {
  list: (params: MediaListParams) => api.get<AdminMediaList>(`/admin/media${buildQuery(params)}`),
  upload: (file: File, opts?: { folder?: string; alt?: string; onProgress?: (pct: number) => void }) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.folder) form.append('folder', opts.folder);
    if (opts?.alt) form.append('alt', opts.alt);
    return api.upload<AdminMediaFile>('/admin/media', form, { onProgress: opts?.onProgress });
  },
  update: (id: string, body: AdminMediaPatchBody) => api.patch<AdminMediaFile>(`/admin/media/${id}`, body),
  /** 409 → referans var (ProductImage/BoxTier/Producer/Post); mesaj sunucudan. */
  remove: (id: string) => api.delete<void>(`/admin/media/${id}`),
};

/** Görsel mi? (picker filtreleri, küçük resim) */
export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith('image/');
}
