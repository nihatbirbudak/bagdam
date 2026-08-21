/**
 * İçerik Güvenlik Politikası (CSP) — F10 sertleştirme.
 *
 * Üç ayrı politika, tek yerde (ADR-0015 "helmet, CSP frame-src PSP"):
 *  - **web** (`.hbs` sayfaları, statik dosyalar): inline bootstrap script'i ve inline `<style>` blokları
 *    ADR-0003 gereği ŞABLONDA duruyor → `'unsafe-inline'` zorunlu. PayTR ödeme iFrame'i ve resmî
 *    `iframeResizer.min.js` (sepet.hbs) için `https://www.paytr.com` script/frame kaynağı açılır.
 *  - **admin** (panel same-origin'den servis edilirse): iFrame yok, PSP yok; yalnız kendi kaynakları.
 *  - **api** (`/api/v1/**` JSON): tarayıcı hiçbir kaynak yüklemez → `default-src 'none'`.
 *
 * Google Fonts vb. dış kaynak YOK (fontlar `public/assets/fonts`), medya `/uploads` same-origin.
 * `frame-ancestors 'none'`: site de panel de hiçbir yerde çerçevelenemez (X-Frame-Options'ın modern karşılığı).
 *
 * Not (piksel parite): CSP yalnız yanıt BAŞLIĞIDIR; HTML gövdesini değiştirmez → parite koşusu etkilenmez.
 * Ama 'unsafe-inline' düşerse inline bootstrap çalışmaz ve sayfa boş veriyle basılır — bu yüzden burada kalır.
 */

/** PayTR ödeme alanı — iFrame (`frame-src`) + resmî yükseklik script'i (`script-src`). */
export const PAYTR_ORIGIN = 'https://www.paytr.com';

export type CspDirectives = Record<string, readonly string[]>;

/** Web sayfaları (10 `.hbs` + 404 + coming-soon) ve statik dosyalar. */
export const WEB_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  // Inline bootstrap (`{{> bootstrap}}`) + sayfa betikleri ADR-0003 gereği inline; PayTR iframeResizer dış script.
  'script-src': ["'self'", "'unsafe-inline'", PAYTR_ORIGIN],
  'script-src-attr': ["'none'"],
  // `<style>` blokları ve `style="…"` nitelikleri şablonlarda (parite) → unsafe-inline.
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  // Fontlar `public/styles.css` içinde base64 gömülü (`@font-face { src: url(data:font/woff2;…) }`) —
  // dış font sağlayıcısı YOK ama `data:` olmadan tipografi düşer ve PİKSEL PARİTE bozulur.
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'frame-src': [PAYTR_ORIGIN],
  'form-action': ["'self'", PAYTR_ORIGIN],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
};

/** Admin paneli (Vite SPA). Prod'da nginx servis eder; API aynı origin'den servis ederse de geçerli olsun. */
export const ADMIN_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  // Panel de aynı gömülü fontları kullanır (index.css → styles.css paleti).
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'frame-src': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
};

/** JSON uçları — tarayıcı bu yanıttan hiçbir alt kaynak yüklemez. */
export const API_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/** Direktif haritasını `Content-Security-Policy` başlık değerine çevirir (deterministik sıra). */
export function buildCspHeaderValue(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

export const WEB_CSP_HEADER = buildCspHeaderValue(WEB_CSP_DIRECTIVES);
export const ADMIN_CSP_HEADER = buildCspHeaderValue(ADMIN_CSP_DIRECTIVES);
export const API_CSP_HEADER = buildCspHeaderValue(API_CSP_DIRECTIVES);

export type CspScope = 'web' | 'admin' | 'api';

/** Admin SPA'nın API tarafından servis edildiği yollar (F4: Vite çıktısı `dist/app/*`). */
const ADMIN_PATH_RE = /^\/(app|admin)(\/|$)/;

/** İstek yoluna göre hangi politika uygulanır. */
export function resolveCspScope(path: string): CspScope {
  const clean = path.split('?')[0] ?? path;
  if (clean === '/api' || clean.startsWith('/api/')) return 'api';
  if (ADMIN_PATH_RE.test(clean)) return 'admin';
  return 'web';
}

/** Yol → hazır başlık değeri. */
export function cspHeaderForPath(path: string): string {
  switch (resolveCspScope(path)) {
    case 'api':
      return API_CSP_HEADER;
    case 'admin':
      return ADMIN_CSP_HEADER;
    default:
      return WEB_CSP_HEADER;
  }
}
