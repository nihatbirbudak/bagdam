import { resolve } from 'path';

/**
 * Uygulama kökü ve sabit dizinler — çalışma dizininden (cwd) bağımsız.
 * Derlenmiş dosya `dist/config/paths.js`, kaynak `src/config/paths.ts`;
 * her iki durumda da `../..` = apps/api (views/ ve public/ src dışında,
 * dist'e kopyalanmaz — nest-cli.json assets boş).
 */
export const APP_ROOT = resolve(__dirname, '..', '..');

/**
 * Handlebars şablonları (10 sayfa + 404 + coming-soon).
 * DİKKAT: bu dizine `layout.hbs` EKLENMEZ — hbs motoru varsa her sayfayı otomatik
 * o layout'a sarar ve byte-byte parite (ADR-0003) bozulur.
 */
export const VIEWS_DIR = resolve(APP_ROOT, 'views');

/** hbs partial'ları (F3: bootstrap partial'ı buraya gelir). */
export const PARTIALS_DIR = resolve(VIEWS_DIR, 'partials');

/** Statik dosyalar: styles.css, assets/** (prod'da nginx doğrudan servis eder). */
export const PUBLIC_DIR = resolve(APP_ROOT, 'public');
