import { RequestMethod } from '@nestjs/common';

/** setGlobalPrefix exclude girdisi (Nest'in RouteInfo'su ile yapısal olarak uyumlu; RouteInfo dışa açılmamış). */
export interface ExcludedRoute {
  path: string;
  method: RequestMethod;
}

/**
 * Web (HTML) rotaları — ADR-0003: `.html` URL'ler korunur, her sayfa aynı adlı .hbs'i render eder.
 * Sayfa adı = view adı (views/<page>.hbs). Bilinmeyen sayfa → 404.hbs.
 */
export const WEB_PAGES: ReadonlySet<string> = new Set([
  'index',
  'urunler',
  'urun',
  'kutu',
  'sepet',
  'uyelik',
  'gunluk',
  'toptan',
  'politikalar',
  'nasil-seciyoruz',
]);

/** Ana sayfa view'ı */
export const HOME_VIEW = 'index';

/** ADR-0012: F1'de apex bu sayfayı gösterir (nginx `/` → bu route; ya da SITE_MODE=coming-soon). */
export const COMING_SOON_VIEW = 'coming-soon';

/**
 * `app.setGlobalPrefix('api/v1', { exclude })` listesi — WebController rotaları öneki almaz.
 * Nest 11 / path-to-regexp v8: eşleşme, controller'da BİLDİRİLEN yol metnine yapılır
 * (`/`, `/coming-soon`, `/:page.html`); bu yüzden desenler controller ile birebir aynı olmalı.
 * Statik dosyalar (styles.css, assets/**) express.static ile servis edilir; prefix'ten etkilenmez.
 */
export const WEB_ROUTES_EXCLUDED_FROM_PREFIX: ExcludedRoute[] = [
  { path: '/', method: RequestMethod.GET },
  { path: 'coming-soon', method: RequestMethod.GET },
  { path: ':page.html', method: RequestMethod.GET },
];
