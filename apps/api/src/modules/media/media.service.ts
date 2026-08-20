import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdminMediaFile, AdminMediaList } from '@bagdam/shared';
import { randomBytes } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { basename, extname, join, resolve, sep } from 'path';
import { processImage } from './media-image';
import {
  MEDIA_ALLOWED_MIME_TYPES,
  MEDIA_DEFAULT_FOLDER,
  MEDIA_FOLDER_RE,
  MEDIA_MAX_UPLOAD_BYTES,
  resolveUploadsDir,
} from './media.constants';
import { isUploadedPath, toAdminMediaFile } from './media.mapper';
import { MediaRepository } from './media.repository';
import type { MediaPatchDto } from './dto/media-patch.dto';
import type { MediaQueryDto } from './dto/media-query.dto';
import type { UploadMediaDto } from './dto/upload-media.dto';

/** multer MemoryStorage dosyası — @types/multer'a bağımlı olmadan ihtiyacımız olan alanlar. */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 40;

/** Türkçe karakter duyarlı slug (klasör ve dosya adları için; seeds/lib/slug.ts ile aynı kural). */
const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};
/**
 * multer/busboy çok parçalı dosya adını varsayılan olarak latin1 çözer; tarayıcılar (ve Node FormData) adı UTF-8
 * baytlarıyla gönderir → "çiğ domates.png" "Ã§iÄ domates.png" olur. Baytları UTF-8 olarak yeniden yorumla;
 * geçersiz dizi (U+FFFD) çıkarsa ad zaten doğru demektir, dokunma. Yalnız ASCII dışı karakter içeren adlarda çalışır.
 */
export function decodeMultipartFileName(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

export function slugifyName(input: string, maxLength: number): string {
  const mapped = Array.from(input.trim())
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return mapped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * MediaService — medya kütüphanesi (BACKEND-PLANI §3 media, §4 ekran 8).
 * - Yükleme: multer bellek (≤20 MB, yalnız raster görsel) → sharp webp (≤2000 px, EXIF temiz) + thumb (400 px)
 *   → `<uploads>/<klasör>/<ad>-<damga>.webp` (+ `-thumb.webp`) → MediaFile {path:"<klasör>/<ad>.webp"}.
 * - URL türetme tek yerde (media.mapper#toPublicUrl): `assets/...` seed görselleri `/assets/...`, diğerleri `/uploads/...`.
 * - Silme: referans (ProductImage/BoxTier/Producer/Post) varsa 409; yoksa kayıt + (yüklenmişse) dosyalar silinir.
 *   `assets/` altındaki seed görselleri repo dosyasıdır → yalnız kayıt silinir, dosyaya dokunulmaz.
 * - folder mantıksal gruplamadır; PATCH ile değişince dosya taşınmaz (path sabit kalır).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly repo: MediaRepository) {}

  async upload(file: UploadedFileLike | undefined, dto: UploadMediaDto): Promise<AdminMediaFile> {
    if (!file || !file.buffer || file.size === 0) throw new BadRequestException('Dosya gerekli (multipart alanı: file)');
    if (file.size > MEDIA_MAX_UPLOAD_BYTES) throw new BadRequestException('Dosya 20 MB sınırını aşıyor');
    if (!MEDIA_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Desteklenmeyen dosya türü: ${file.mimetype} (jpeg/png/webp/gif/avif/tiff)`);
    }
    const folder = this.normalizeFolder(dto.folder);
    const originalName = decodeMultipartFileName(file.originalname);
    const baseName = slugifyName(basename(originalName, extname(originalName)), 40) || 'gorsel';
    const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const fileName = `${baseName}-${stamp}.webp`;
    const thumbName = `${baseName}-${stamp}-thumb.webp`;
    const relPath = `${folder}/${fileName}`;
    const relThumb = `${folder}/${thumbName}`;

    let processed;
    try {
      processed = await processImage(file.buffer);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Görsel işlenemedi (${file.originalname}): ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('Görsel işlenemedi: dosya bozuk ya da desteklenmiyor');
    }

    const dir = join(resolveUploadsDir(), folder);
    await mkdir(dir, { recursive: true });
    const absMain = join(dir, fileName);
    const absThumb = join(dir, thumbName);
    await writeFile(absMain, processed.main);
    await writeFile(absThumb, processed.thumb);

    try {
      const row = await this.repo.create({
        path: relPath,
        thumbPath: relThumb,
        originalName: originalName.slice(0, 255),
        mimeType: 'image/webp',
        size: processed.main.byteLength,
        width: processed.width,
        height: processed.height,
        alt: dto.alt ?? null,
        folder,
      });
      this.logger.log(`Medya yüklendi: ${relPath} (${processed.width}x${processed.height}, ${processed.main.byteLength} B)`);
      return toAdminMediaFile(row);
    } catch (err) {
      // DB yazılamadıysa diskte yetim dosya bırakma
      await Promise.all([rm(absMain, { force: true }), rm(absThumb, { force: true })]);
      throw err;
    }
  }

  async list(query: MediaQueryDto): Promise<AdminMediaList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [{ rows, total }, folders] = await Promise.all([
      this.repo.findMany({ folder: query.folder || undefined, q: query.q || undefined }, page, limit),
      this.repo.findFolders(),
    ]);
    return { items: rows.map(toAdminMediaFile), total, page, limit, folders };
  }

  async get(id: string): Promise<AdminMediaFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Medya dosyası bulunamadı');
    return toAdminMediaFile(row);
  }

  async patch(id: string, dto: MediaPatchDto): Promise<AdminMediaFile> {
    if (!(await this.repo.findById(id))) throw new NotFoundException('Medya dosyası bulunamadı');
    const row = await this.repo.update(id, {
      ...(dto.alt !== undefined ? { alt: dto.alt } : {}),
      ...(dto.folder !== undefined ? { folder: this.normalizeFolder(dto.folder) } : {}),
    });
    return toAdminMediaFile(row);
  }

  /** Referans varsa 409 {message}; yoksa kayıt silinir, yüklenmiş dosyalar diskten kaldırılır. */
  async remove(id: string): Promise<void> {
    const row = await this.repo.findByIdWithRefs(id);
    if (!row) throw new NotFoundException('Medya dosyası bulunamadı');
    const refs: string[] = [];
    if (row._count.productImages > 0) refs.push(`${row._count.productImages} ürün görseli`);
    if (row._count.tiers > 0) refs.push(`${row._count.tiers} kutu boyu`);
    if (row._count.producers > 0) refs.push(`${row._count.producers} üretici`);
    if (row._count.posts > 0) refs.push(`${row._count.posts} günlük yazısı`);
    if (refs.length > 0) {
      throw new ConflictException(`Bu dosya kullanımda (${refs.join(', ')}); önce bağlantıları kaldırın.`);
    }
    await this.repo.delete(id);
    if (isUploadedPath(row.path)) {
      await this.removeFiles([row.path, row.thumbPath]);
    } else {
      this.logger.warn(`Seed görseli kaydı silindi, repo dosyasına dokunulmadı: ${row.path}`);
    }
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  /** Klasör adı: slug'lanır; boş → "genel"; kurala uymuyorsa 400. */
  private normalizeFolder(input: string | undefined): string {
    if (input === undefined || input.trim() === '') return MEDIA_DEFAULT_FOLDER;
    const slug = slugifyName(input, 40);
    if (!MEDIA_FOLDER_RE.test(slug)) throw new BadRequestException('Klasör adı geçersiz (harf/rakam/tire, en çok 40 karakter)');
    return slug;
  }

  /** uploads/ altındaki dosyaları siler; dizin dışına çıkan yolları reddeder (path traversal koruması). */
  private async removeFiles(paths: Array<string | null>): Promise<void> {
    const root = resolve(resolveUploadsDir());
    for (const p of paths) {
      if (!p) continue;
      const abs = resolve(root, p);
      if (!abs.startsWith(root + sep)) {
        this.logger.warn(`uploads dışı yol silinmedi: ${p}`);
        continue;
      }
      try {
        await rm(abs, { force: true });
      } catch (err) {
        this.logger.warn(`Dosya silinemedi (${p}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
