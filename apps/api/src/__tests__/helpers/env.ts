// Test ortamı — apps/api/.env → kök .env (main.ts ile aynı sıra; mevcut env değişkenleri ezilmez).
// DB gerektiren testler DATABASE_URL yoksa SKIP değil FAIL (görev kuralı): requireDatabaseUrl() fırlatır.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

/** apps/api kökü: src/__tests__/helpers → ../../.. */
export const API_ROOT = resolve(__dirname, '..', '..', '..');
/** Depo kökü (website/ prototipi buradan okunur). */
export const REPO_ROOT = resolve(API_ROOT, '..', '..');

loadEnv({ path: resolve(API_ROOT, '.env'), quiet: true });
loadEnv({ path: resolve(REPO_ROOT, '.env'), quiet: true });

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL tanımlı değil — katalog testleri seed’li gerçek DB ister (apps/api/.env ya da kök .env).');
  }
  return url;
}
