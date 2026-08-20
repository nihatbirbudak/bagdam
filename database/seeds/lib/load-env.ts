// database/seeds/lib/load-env.ts — .env yükleme (yan etkili modül; seed.ts'in İLK import'u olmalı)
// Sıra apps/api/src/main.ts ile aynı: önce apps/api/.env, sonra kök .env (eksik değişkenler için).
// Değerler hiçbir yere yazılmaz; DATABASE_URL'yi PrismaClient kendisi okur.
import { config as loadEnv } from 'dotenv';
import { API_ENV, ROOT_ENV } from './paths';

loadEnv({ path: API_ENV, quiet: true });
loadEnv({ path: ROOT_ENV, quiet: true });

/** Seed'in çalışması için zorunlu olan tek değişken. */
export function assertDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tanımlı değil — apps/api/.env ya da kök .env dosyasına ekleyin.');
  }
}
