// apps/api/scripts/media-import.ts — mevcut görselleri MediaFile tablosuna alır (F4, BACKEND-PLANI §3 media CLI).
// Çalıştırma: `pnpm --filter @bagdam/api media:import` (= tsx scripts/media-import.ts). İDEMPOTENT.
//
// Kaynak: apps/api/public/assets/images/** · assets/logo/** · assets/icons/** (fonts/ ve cart.js hariç).
// Kural seed ile AYNI (database/seeds/lib/media.ts): path = public/ altındaki göreli yol ("assets/images/…"),
// YENİDEN KODLAMA YOK, mimeType/size/width/height gerçek dosyadan; klasör eşlemesi `mediaFolderFor`
// (scene-originals/steps → sahne · diğer images → urunler · logo → logo · icons → ikonlar).
// Upsert: path'e göre findFirst (MediaFile.path unique değil — SISTEM-DURUMU notu) → değiştiyse update, yoksa create;
// `alt` kullanıcının alanıdır: create'te null, update'te DOKUNULMAZ. Sonda özet basılır (tarandı/eklendi/güncellendi/aynı).
import { config as loadEnv } from 'dotenv';
import { readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { imageFileInfo, type ImageFileInfo } from '../../../database/seeds/lib/media';

// .env sırası main.ts ile aynı: apps/api/.env → kök .env (değerler hiçbir yere yazılmaz).
const API_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(API_ROOT, '..', '..');
loadEnv({ path: resolve(API_ROOT, '.env'), quiet: true });
loadEnv({ path: resolve(REPO_ROOT, '.env'), quiet: true });

const PUBLIC_DIR = resolve(API_ROOT, 'public');
/** Taranacak kökler (public/ altına göre). */
const SOURCE_DIRS = ['assets/images', 'assets/logo', 'assets/icons'] as const;
/** Görsel uzantıları — diğer dosyalar (manifest.json vb.) atlanır. */
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|avif)$/i;

interface Summary {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: string[];
}

/** Dizini özyinelemeli tarar; public/ altına göre ileri eğik çizgili göreli yollar döner (sıralı, deterministik). */
function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (IMAGE_EXT.test(name)) out.push(relative(PUBLIC_DIR, abs).replace(/\\/g, '/'));
  }
  return out;
}

function sameRecord(
  existing: { originalName: string; mimeType: string; size: number; width: number | null; height: number | null; folder: string; thumbPath: string | null },
  info: ImageFileInfo,
): boolean {
  return (
    existing.originalName === info.originalName &&
    existing.mimeType === info.mimeType &&
    existing.size === info.size &&
    existing.width === info.width &&
    existing.height === info.height &&
    existing.folder === info.folder
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil — apps/api/.env ya da kök .env gerekli.');
  const prisma = new PrismaClient();
  const summary: Summary = { scanned: 0, created: 0, updated: 0, unchanged: 0, skipped: [] };
  const before = await prisma.mediaFile.count();

  try {
    const files: string[] = [];
    for (const dir of SOURCE_DIRS) {
      const abs = resolve(PUBLIC_DIR, dir);
      try {
        statSync(abs);
      } catch {
        console.warn(`  UYARI: dizin yok, atlandı: ${dir}`);
        continue;
      }
      files.push(...walk(abs));
    }
    summary.scanned = files.length;

    for (const relPath of files) {
      let info: ImageFileInfo;
      try {
        info = imageFileInfo(relPath);
      } catch (err) {
        summary.skipped.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // Seed ile aynı upsert kuralı: path'e göre en eski kayıt esas alınır (çoğaltma yok).
      const existing = await prisma.mediaFile.findFirst({ where: { path: info.path }, orderBy: { createdAt: 'asc' } });
      if (!existing) {
        await prisma.mediaFile.create({
          data: {
            path: info.path,
            thumbPath: null,
            originalName: info.originalName,
            mimeType: info.mimeType,
            size: info.size,
            width: info.width,
            height: info.height,
            alt: null,
            folder: info.folder,
          },
        });
        summary.created++;
      } else if (sameRecord(existing, info)) {
        summary.unchanged++;
      } else {
        await prisma.mediaFile.update({
          where: { id: existing.id },
          data: {
            originalName: info.originalName,
            mimeType: info.mimeType,
            size: info.size,
            width: info.width,
            height: info.height,
            folder: info.folder,
          },
        });
        summary.updated++;
      }
    }

    const after = await prisma.mediaFile.count();
    const byFolder = await prisma.mediaFile.groupBy({ by: ['folder'], _count: { _all: true }, orderBy: { folder: 'asc' } });
    console.log('media:import özeti');
    console.log(`  tarandı: ${summary.scanned} · eklendi: ${summary.created} · güncellendi: ${summary.updated} · aynı: ${summary.unchanged} · atlandı: ${summary.skipped.length}`);
    console.log(`  media_files: ${before} → ${after}`);
    console.log(`  klasörler: ${byFolder.map((f) => `${f.folder}=${f._count._all}`).join(' · ')}`);
    for (const s of summary.skipped) console.warn(`  atlandı: ${s}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[media:import] hata:', err instanceof Error ? err.message : err);
  process.exit(1);
});
