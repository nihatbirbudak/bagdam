import { Controller, Get, HttpStatus, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { BootstrapPayload } from '@bagdam/shared';
import type { Request, Response } from 'express';
import { SkipTimeout } from '../common/decorators/skip-timeout.decorator';
import { APP_VERSION } from '../config/app-info';
import { getSiteMode } from '../config/site.config';
import { CatalogService } from '../modules/catalog/catalog.service';
import { toBootstrapJson } from './bootstrap-json';
import { buildFeaturedViews, DEFAULT_FEATURED, FeaturedView } from './featured';
import { COMING_SOON_VIEW, HOME_VIEW, WEB_PAGES } from './web.routes';

/** Anonim HTML: nginx micro-cache 10 s (ADR-0003); tarayıcıda her seferinde doğrula. */
const CACHE_ANONYMOUS = 'public, max-age=0, s-maxage=10';
/** Çerezli (oturumlu) HTML: kişiselleşebilir → hiçbir ara katman saklamasın. */
const CACHE_PRIVATE = 'private, no-store';

/** Oturum çerezi (ADR-0009: access_token path=/). F6'da cookie gelince devreye girer. */
const SESSION_COOKIE = 'access_token';

/**
 * Bootstrap üretilemezse (DB/servis hatası) sayfa BOŞ veri ile render EDİLMEZ — yanlış görünen
 * sayfa yerine kısa 503 (ADR-0003 istisna 6: bakım/hata sayfaları). nginx micro-cache 503'ü saklamaz.
 */
const UNAVAILABLE_HTML =
  '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bağdam — geçici olarak kullanılamıyor</title></head>' +
  '<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:36rem;padding:0 1rem;color:#222">' +
  '<h1 style="font-size:1.25rem">Şu an sayfayı hazırlayamıyoruz</h1>' +
  '<p>Kısa bir kesinti var; lütfen birkaç saniye sonra yeniden deneyin.</p></body></html>';

type RequestWithCookies = Request & { cookies?: Record<string, unknown>; requestId?: string };

/**
 * Şablonlara giden veri (F3): `{{> bootstrap}}` partial'ı `bootstrapJson` + `assetVersion` okur;
 * index.hbs öne çıkanlar `featured` dizisini `{{#each}}` ile basar. coming-soon/404 yalnız `assetVersion`.
 */
interface ViewData {
  assetVersion: string;
  /** `window.__BAGDAM__` JSON metni (toBootstrapJson) — 10 sayfada dolu. */
  bootstrapJson?: string;
  /** Yalnız index: ürün/tier kartları (partials/featured-product.hbs · featured-tier.hbs). */
  featured?: FeaturedView[];
}

/**
 * WebController — views/*.hbs sayfalarını aynı servislerle render eder (ADR-0002 §5, ADR-0003).
 * Rotalar /api/v1 öneki dışında (bkz. web.routes.ts → setGlobalPrefix exclude).
 * - Throttle yok: sayfalar anonim ve nginx cache'li; sınırlama API uçları için.
 * - Timeout yok: render senkron, @Res() ile yanıt Express'e bırakılır.
 * - F3: her sayfa CatalogService.getBootstrap → `{{> bootstrap}}` (me/sub şimdilik null; F6/F9'da çerezden).
 */
@Controller()
@SkipThrottle()
@SkipTimeout()
export class WebController {
  private readonly logger = new Logger(WebController.name);

  constructor(private readonly catalog: CatalogService) {}

  /** `/` → index (SITE_MODE=coming-soon ise coming-soon; ADR-0012) */
  @Get()
  home(@Req() req: RequestWithCookies, @Res() res: Response): Promise<void> {
    return this.renderPage(req, res, getSiteMode() === 'coming-soon' ? COMING_SOON_VIEW : HOME_VIEW);
  }

  /** `/coming-soon` → her modda coming-soon.hbs (nginx apex `/` buraya yönlendirir). */
  @Get('coming-soon')
  comingSoon(@Req() req: RequestWithCookies, @Res() res: Response): Promise<void> {
    return this.renderPage(req, res, COMING_SOON_VIEW);
  }

  /** `/<page>.html` → views/<page>.hbs (10 sayfa). Bilinmeyen sayfa → 404.hbs (AllExceptionsFilter). */
  @Get(':page.html')
  page(@Param('page') page: string, @Req() req: RequestWithCookies, @Res() res: Response): Promise<void> {
    if (!WEB_PAGES.has(page)) {
      throw new NotFoundException(`Sayfa bulunamadı: /${page}.html`);
    }
    if (getSiteMode() === 'coming-soon') {
      // Apex lansmana kadar yalnız coming-soon gösterir; prototip sayfaları apex'te açılmaz (ADR-0012).
      if (page === HOME_VIEW) {
        return this.renderPage(req, res, COMING_SOON_VIEW);
      }
      throw new NotFoundException(`Sayfa henüz yayında değil: /${page}.html`);
    }
    return this.renderPage(req, res, page);
  }

  /**
   * Cache-Control başlığını koyar, bootstrap verisini toplar ve şablonu render eder.
   * Bootstrap hatası → 503 (sayfa boş veri ile basılmaz); render hatası → 500 düz metin.
   */
  private async renderPage(req: RequestWithCookies, res: Response, view: string): Promise<void> {
    const hasSession = Boolean(req.cookies?.[SESSION_COOKIE]);
    res.setHeader('Cache-Control', hasSession ? CACHE_PRIVATE : CACHE_ANONYMOUS);

    const data: ViewData = { assetVersion: APP_VERSION };
    if (view !== COMING_SOON_VIEW) {
      const payload = await this.loadBootstrap(req, view);
      if (!payload) {
        this.sendUnavailable(res);
        return;
      }
      data.bootstrapJson = toBootstrapJson(payload);
      if (view === HOME_VIEW) {
        // SiteContent home.featured F5'te; şimdilik DEFAULT_FEATURED (website/index.html sırası).
        data.featured = buildFeaturedViews(DEFAULT_FEATURED, payload, (msg) => this.logger.warn(msg));
      }
    }

    res.render(view, data, (err: Error | null, html?: string) => {
      if (err) {
        this.logger.error(`"${view}" render edilemedi [rid:${req.requestId ?? '-'}]: ${err.message}`, err.stack);
        if (!res.headersSent) {
          res.status(500).type('text/plain; charset=utf-8').send('Sunucu hatası oluştu');
        }
        return;
      }
      res.send(html);
    });
  }

  /** Anonim bootstrap (me/sub null — F6/F9'da çerezden dolar). Hata → null (çağıran 503 verir). */
  private async loadBootstrap(req: RequestWithCookies, view: string): Promise<BootstrapPayload | null> {
    try {
      return await this.catalog.getBootstrap({ me: null, sub: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `"${view}" için bootstrap üretilemedi [rid:${req.requestId ?? '-'}]: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return null;
    }
  }

  /** Kısa 503 HTML — önbelleğe alınmaz, istemciye kısa süre sonra yeniden denemesi söylenir. */
  private sendUnavailable(res: Response): void {
    if (res.headersSent) return;
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '10');
    res.type('text/html; charset=utf-8').send(UNAVAILABLE_HTML);
  }
}
