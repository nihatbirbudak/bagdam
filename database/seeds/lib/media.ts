// database/seeds/lib/media.ts — mevcut görsellerin MediaFile kaydı için dosya bilgisi
// Görseller YENİDEN KODLANMAZ [B22]: path = prototipteki göreli yol ("assets/images/…"), gerçek dosya
// apps/api/public/ altından stat edilir (mimeType uzantıdan, size bayt, width/height JPEG/PNG başlığından).
// F4 `media:import` aynı kuralları kullanmalı (path'e göre upsert + aynı klasör eşlemesi) ki kayıtlar çoğalmasın.
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { API_PUBLIC_DIR } from './paths';

export interface ImageFileInfo {
  /** MediaFile.path — prototipteki göreli yol, değiştirilmez. */
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  folder: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/**
 * MediaFile.folder eşlemesi (F4 media:import ile aynı):
 *   assets/images/scene-originals/* , assets/images/steps/* → "sahne"
 *   assets/images/urunler/* ve diğer assets/images/* (ürün/tier görselleri) → "urunler"
 *   assets/icons/* → "ikonlar" · assets/logo/* → "logo" · diğer → "genel"
 */
export function mediaFolderFor(relPath: string): string {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('assets/images/scene-originals/') || p.startsWith('assets/images/steps/')) return 'sahne';
  if (p.startsWith('assets/images/')) return 'urunler';
  if (p.startsWith('assets/icons/')) return 'ikonlar';
  if (p.startsWith('assets/logo/')) return 'logo';
  return 'genel';
}

/** JPEG SOFn başlığından boyut (baseline/progressive); bulunamazsa null. */
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1];
    if (marker === undefined) return null;
    // Dolgu 0xFF baytları
    if (marker === 0xff) {
      pos++;
      continue;
    }
    // SOF0–SOF15 (DHT C4, JPG C8, DAC CC hariç)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // SOI/EOI/RSTn gibi uzunluksuz işaretçiler
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(pos + 2);
    if (segLen < 2) return null;
    pos += 2 + segLen;
  }
  return null;
}

/** PNG IHDR'den boyut. */
function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Göreli görsel yolu → MediaFile alanları. Dosya apps/api/public altında yoksa HATA (seed verisi
 * gerçek dosyaya dayanmalı; görseller depoda olduğundan CI'da da mevcuttur).
 */
export function imageFileInfo(relPath: string): ImageFileInfo {
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = resolve(API_PUBLIC_DIR, clean);
  if (!existsSync(abs)) {
    throw new Error(`Görsel bulunamadı: ${clean} (beklenen: ${abs})`);
  }
  const st = statSync(abs);
  const ext = extname(clean).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  let dims: { width: number; height: number } | null = null;
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
    const buf = readFileSync(abs);
    dims = mimeType === 'image/jpeg' ? jpegDimensions(buf) : pngDimensions(buf);
  }
  return {
    path: clean,
    originalName: basename(clean),
    mimeType,
    size: st.size,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    folder: mediaFolderFor(clean),
  };
}
