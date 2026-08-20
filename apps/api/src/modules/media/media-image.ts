import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  MEDIA_LIMIT_INPUT_PIXELS,
  MEDIA_MAX_DIMENSION,
  MEDIA_THUMB_WEBP_QUALITY,
  MEDIA_THUMB_WIDTH,
  MEDIA_WEBP_QUALITY,
} from './media.constants';

/**
 * sharp'ın kullandığımız alt kümesi — paket tipleri yerine yerel arayüz: `sharp` yalnız burada ve çalışma
 * anında (lazy require) yüklenir; kurulu değilse uygulama açılır, yalnız yükleme 503 döner (açık mesajla).
 * Kurulum: `pnpm --filter @bagdam/api add sharp`.
 */
interface SharpResizeOptions {
  width?: number;
  height?: number;
  fit?: 'inside' | 'cover' | 'contain';
  withoutEnlargement?: boolean;
}
interface SharpOutputInfo {
  width: number;
  height: number;
  size: number;
  format: string;
}
interface SharpInstance {
  /** EXIF yönünü piksellere uygular (ardından metadata yazılmadığından EXIF temizlenmiş olur). */
  rotate(): SharpInstance;
  resize(options: SharpResizeOptions): SharpInstance;
  webp(options: { quality?: number; effort?: number }): SharpInstance;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: SharpOutputInfo }>;
}
type SharpFactory = (input: Buffer, options?: { limitInputPixels?: number; failOn?: string }) => SharpInstance;

const logger = new Logger('MediaImage');
let cachedSharp: SharpFactory | null | undefined;

/** sharp modülünü bir kez yükler; yoksa null (uyarı bir kez loglanır). */
export function loadSharp(): SharpFactory | null {
  if (cachedSharp !== undefined) return cachedSharp;
  try {
    // Dinamik require: derleme `sharp` tiplerine bağımlı değil; paket yoksa MODULE_NOT_FOUND yakalanır.
    const mod = require('sharp') as SharpFactory | { default: SharpFactory };
    cachedSharp = typeof mod === 'function' ? mod : mod.default;
  } catch (err) {
    logger.warn(`sharp yüklenemedi — görsel yükleme devre dışı (pnpm --filter @bagdam/api add sharp): ${err instanceof Error ? err.message : String(err)}`);
    cachedSharp = null;
  }
  return cachedSharp;
}

export function isSharpAvailable(): boolean {
  return loadSharp() !== null;
}

export interface ProcessedImage {
  /** Ana görsel (webp, en uzun kenar ≤ 2000 px, EXIF temiz). */
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Giriş görseli → webp (max 2000 px) + thumb (400 px). `limitInputPixels` 50 MP; `rotate()` EXIF yönünü uygular,
 * çıktıya metadata yazılmadığı için EXIF/GPS temizlenir. Bozuk/desteklenmeyen giriş → Error (servis 400'e çevirir).
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const sharp = loadSharp();
  if (!sharp) {
    throw new ServiceUnavailableException('Görsel işleme kütüphanesi (sharp) kurulu değil — yükleme şu an yapılamıyor');
  }
  const base = () => sharp(input, { limitInputPixels: MEDIA_LIMIT_INPUT_PIXELS }).rotate();
  const main = await base()
    .resize({ width: MEDIA_MAX_DIMENSION, height: MEDIA_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: MEDIA_WEBP_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base()
    .resize({ width: MEDIA_THUMB_WIDTH, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: MEDIA_THUMB_WEBP_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { main: main.data, thumb: thumb.data, width: main.info.width, height: main.info.height };
}
