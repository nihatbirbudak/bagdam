import { Controller, Get, HttpStatus, Inject, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { BootstrapMe, BootstrapPayload } from '@bagdam/shared';
import type { Request, Response } from 'express';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTimeout } from '../common/decorators/skip-timeout.decorator';
import { APP_VERSION } from '../config/app-info';
import { getSiteMode } from '../config/site.config';
import { CatalogService } from '../modules/catalog/catalog.service';
import { toBootstrapJson, toScriptJson } from './bootstrap-json';
import {
  buildCategoryTabs,
  buildLegalArticles,
  buildLegalNav,
  buildPanelNotes,
  buildSiteTree,
  resolveFeaturedItems,
  toPostView,
  type CategoryTabView,
  type LegalArticleView,
  type LegalNavView,
  type PostView,
} from './content-view';
import { buildFeaturedViews, DEFAULT_FEATURED, FeaturedView } from './featured';
import { WEB_CONTENT_SOURCE, type WebContentSource } from './web-content.source';
import { COMING_SOON_VIEW, HOME_VIEW, WEB_PAGES } from './web.routes';

/** Anonim HTML: nginx micro-cache 10 s (ADR-0003); tarayıcıda her seferinde doğrula. */
const CACHE_ANONYMOUS = 'public, max-age=0, s-maxage=10';
/** Çerezli (oturumlu) HTML: kişiselleşebilir → hiçbir ara katman saklamasın. */
const CACHE_PRIVATE = 'private, no-store';

/** Oturum çerezi (ADR-0009: access_token path=/). F6'da cookie gelince devreye girer. */
const SESSION_COOKIE = 'access_token';

/** index.hbs "son yazılar" kart sayısı (website/index.html: 3 kart). */
const HOME_POST_COUNT = 3;

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

/** JwtAuthGuard @Public uçta geçerli çerez varsa `req.user`'ı doldurur (F6: bootstrap `me` buradan). */
type RequestWithCookies = Request & { cookies?: Record<string, unknown>; requestId?: string; user?: SessionUser };

/** `__BAGDAM__.me` — oturum varsa {loggedIn:true,id,email,name}; yoksa null (cart.js `isLoggedIn()`). */
function toBootstrapMe(user: SessionUser | undefined): BootstrapMe | null {
  return user ? { loggedIn: true, id: user.id, email: user.email, name: user.name } : null;
}

/** toptan.hbs form script'ine gömülen metinler (SiteContent toptan.form; JS-string olarak JSON ile). */
interface ToptanTexts {
  success: string;
  error: string;
  invalid: string;
}

/** toptan.form seed değerleri ile aynı (SiteContent yoksa/eksikse yedek). */
const TOPTAN_TEXT_DEFAULTS: ToptanTexts = {
  success: 'Teşekkürler — toptan hattı açıldığında ilk sana haber vereceğiz.',
  error: 'Şu an kaydedemedik — lütfen birkaç saniye sonra yeniden dene.',
  invalid: 'Lütfen geçerli bir e-posta adresi yaz.',
};

/**
 * Şablonlara giden veri: `{{> bootstrap}}` partial'ı `bootstrapJson` + `assetVersion` okur (F3);
 * F5: `site` (SiteContent ağacı, kaçışlı), `legal`/`legalDocs` (politikalar), `posts` (gunluk tümü / index ilk 3),
 * `categories` + `panelNotes` (index/urunler sekmeleri, panel notları), `featured` (index kartları), `toptanTextsJson`.
 * coming-soon/404 yalnız `assetVersion`.
 */
interface ViewData {
  assetVersion: string;
  /** `window.__BAGDAM__` JSON metni (toBootstrapJson) — 10 sayfada dolu. */
  bootstrapJson?: string;
  /** SiteContent ağacı: `{{{site.home.hero.title}}}` (richtext ham, diğer metinler kaçışlı). */
  site?: Record<string, unknown>;
  /** Kategori sekmeleri (index vitrin + mobil, urunler sekmeleri). */
  categories?: CategoryTabView[];
  /** urunler.hbs panel notları: `{{{panelNotes.dairy}}}` (Category.panelNote). */
  panelNotes?: Record<string, string>;
  /** Yalnız index: ürün/tier kartları (partials/featured-product.hbs · featured-tier.hbs). */
  featured?: FeaturedView[];
  /** gunluk: yayındaki tüm yazılar; index: son 3. */
  posts?: PostView[];
  /** politikalar: nav (showInNav) ve tüm yayındaki makaleler (nav'sızlar hidden). */
  legal?: LegalNavView[];
  legalDocs?: LegalArticleView[];
  /** toptan: form mesajları (script içi JSON). */
  toptanTextsJson?: string;
}

/**
 * WebController — views/*.hbs sayfalarını aynı servislerle render eder (ADR-0002 §5, ADR-0003).
 * Rotalar /api/v1 öneki dışında (bkz. web.routes.ts → setGlobalPrefix exclude).
 * - Throttle yok: sayfalar anonim ve nginx cache'li; sınırlama API uçları için.
 * - Timeout yok: render senkron, @Res() ile yanıt Express'e bırakılır.
 * - F3: her sayfa CatalogService.getBootstrap → `{{> bootstrap}}` (me/sub şimdilik null; F6/F9'da çerezden).
 * - F4: @Public — JwtAuthGuard sayfaları anonim geçirir (geçerli çerez varsa req.user yine dolar; F6 `me` için).
 * - F5: sabit metinler SiteContent'ten (`site`), yasal metinler/günlük DB'den; değerler seed ile aynıyken render
 *   website/*.html ile piksel-piksel aynı (tools/visual-parity).
 */
@Controller()
@Public()
@SkipThrottle()
@SkipTimeout()
export class WebController {
  private readonly logger = new Logger(WebController.name);

  constructor(
    private readonly catalog: CatalogService,
    @Inject(WEB_CONTENT_SOURCE) private readonly content: WebContentSource,
  ) {}

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
   * Cache-Control başlığını koyar, bootstrap + içerik verisini toplar ve şablonu render eder.
   * Bootstrap/içerik hatası → 503 (sayfa boş veri ile basılmaz); render hatası → 500 düz metin.
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
      const ok = await this.loadContent(req, view, payload, data);
      if (!ok) {
        this.sendUnavailable(res);
        return;
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

  /** Bootstrap: `me` oturumdan (JwtAuthGuard req.user — F6), `sub` F9'a kadar null. Hata → null (çağıran 503 verir). */
  private async loadBootstrap(req: RequestWithCookies, view: string): Promise<BootstrapPayload | null> {
    try {
      return await this.catalog.getBootstrap({ me: toBootstrapMe(req.user), sub: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `"${view}" için bootstrap üretilemedi [rid:${req.requestId ?? '-'}]: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return null;
    }
  }

  /**
   * F5 içerik verisi: her sayfada `site` (footer/promo ortak); sayfaya göre kategori sekmeleri, öne çıkanlar,
   * yazılar, yasal belgeler, toptan metinleri. Hata → false (çağıran 503 verir: eksik metinli sayfa basılmaz).
   */
  private async loadContent(req: RequestWithCookies, view: string, payload: BootstrapPayload, data: ViewData): Promise<boolean> {
    try {
      const rows = await this.content.getSiteContentRows();
      const site = buildSiteTree(rows);
      data.site = site;

      if (view === HOME_VIEW || view === 'urunler') {
        const categories = await this.content.getCategories();
        data.categories = buildCategoryTabs(categories);
        if (view === 'urunler') data.panelNotes = buildPanelNotes(categories);
      }
      if (view === HOME_VIEW) {
        // SiteContent home.featured → kartlar; anahtar yoksa/boşsa DEFAULT_FEATURED (website/index.html sırası).
        const raw = rows.find((r) => r.key === 'home.featured')?.value;
        const items = resolveFeaturedItems(raw) ?? DEFAULT_FEATURED;
        data.featured = buildFeaturedViews(items, payload, (msg) => this.logger.warn(msg));
      }
      if (view === HOME_VIEW || view === 'gunluk') {
        const posts = (await this.content.getPublishedPosts()).map(toPostView);
        data.posts = view === HOME_VIEW ? posts.slice(0, HOME_POST_COUNT) : posts;
      }
      if (view === 'politikalar') {
        const docs = await this.content.getLegalCurrent();
        data.legal = buildLegalNav(docs);
        data.legalDocs = buildLegalArticles(docs);
      }
      if (view === 'toptan') {
        data.toptanTextsJson = toScriptJson(this.toptanTexts(site));
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `"${view}" için içerik okunamadı [rid:${req.requestId ?? '-'}]: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  /** SiteContent `toptan.form` → script metinleri (kaçışlı HTML değil, ham metin: ağaçtaki değerler kaçışlı olduğundan geri çözülür). */
  private toptanTexts(site: Record<string, unknown>): ToptanTexts {
    const toptan = site.toptan as Record<string, unknown> | undefined;
    const form = (toptan?.form ?? {}) as Record<string, unknown>;
    const pick = (name: string, fallback: string): string => {
      const v = form[name];
      return typeof v === 'string' && v.length > 0 ? unescapeHtml(v) : fallback;
    };
    return {
      success: pick('successMessage', TOPTAN_TEXT_DEFAULTS.success),
      error: pick('errorMessage', TOPTAN_TEXT_DEFAULTS.error),
      invalid: pick('invalidEmailMessage', TOPTAN_TEXT_DEFAULTS.invalid),
    };
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

/** content-view escapeHtml'in tersi (yalnız & < > " — JS metnine giden değerler için). */
function unescapeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
