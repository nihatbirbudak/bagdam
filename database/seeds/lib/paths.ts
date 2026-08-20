// database/seeds/lib/paths.ts — seed/convert script'lerinin kullandığı mutlak yollar (cwd'den bağımsız)
import { resolve } from 'path';

/** Depo kökü: database/seeds/lib → ../../.. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const DATA_DIR = resolve(REPO_ROOT, 'database', 'data');
export const CATALOG_JSON = resolve(DATA_DIR, 'catalog.json');
export const PRODUCERS_JSON = resolve(DATA_DIR, 'producers.json');

/** Orijinal statik prototip (parite referansı) — F3'e kadar tek veri kaynağı. */
export const WEBSITE_DIR = resolve(REPO_ROOT, 'website');
export const PRODUCTS_JS = resolve(WEBSITE_DIR, 'assets', 'products.js');
export const CART_JS = resolve(WEBSITE_DIR, 'assets', 'cart.js');
export const KUTU_HTML = resolve(WEBSITE_DIR, 'kutu.html');
export const URUNLER_HTML = resolve(WEBSITE_DIR, 'urunler.html');

/** Görsellerin gerçek dosyaları (MediaFile.size/mimeType buradan stat edilir). */
export const API_PUBLIC_DIR = resolve(REPO_ROOT, 'apps', 'api', 'public');
export const API_ENV = resolve(REPO_ROOT, 'apps', 'api', '.env');
export const ROOT_ENV = resolve(REPO_ROOT, '.env');

/** F5 içerik seed'i: site-content.json, legal.json + legal/*.html, posts.json + posts/*.html. */
export const CONTENT_DIR = resolve(REPO_ROOT, 'database', 'seeds', 'content');
