import { Controller, Get, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SkipTimeout } from '../common/decorators/skip-timeout.decorator';
import { APP_VERSION } from '../config/app-info';
import { getSiteMode } from '../config/site.config';
import { COMING_SOON_VIEW, HOME_VIEW, WEB_PAGES } from './web.routes';

/** Anonim HTML: nginx micro-cache 10 s (ADR-0003); tarayıcıda her seferinde doğrula. */
const CACHE_ANONYMOUS = 'public, max-age=0, s-maxage=10';
/** Çerezli (oturumlu) HTML: kişiselleşebilir → hiçbir ara katman saklamasın. */
const CACHE_PRIVATE = 'private, no-store';

/** Oturum çerezi (ADR-0009: access_token path=/). F6'da cookie gelince devreye girer. */
const SESSION_COOKIE = 'access_token';

type RequestWithCookies = Request & { cookies?: Record<string, unknown>; requestId?: string };

/** Şablonlara giden veri — F1'de yalnız sürüm; F3'te bootstrap partial'ı (me/sub/katalog) eklenir. */
interface ViewData {
  assetVersion: string;
}

/**
 * WebController — views/*.hbs sayfalarını render eder (ADR-0002 §5, ADR-0003).
 * Rotalar /api/v1 öneki dışında (bkz. web.routes.ts → setGlobalPrefix exclude).
 * - Throttle yok: sayfalar anonim ve nginx cache'li; sınırlama API uçları için.
 * - Timeout yok: render senkron, @Res() ile yanıt Express'e bırakılır.
 */
@Controller()
@SkipThrottle()
@SkipTimeout()
export class WebController {
  private readonly logger = new Logger(WebController.name);

  /** `/` → index (SITE_MODE=coming-soon ise coming-soon; ADR-0012) */
  @Get()
  home(@Req() req: RequestWithCookies, @Res() res: Response): void {
    this.renderPage(req, res, getSiteMode() === 'coming-soon' ? COMING_SOON_VIEW : HOME_VIEW);
  }

  /** `/coming-soon` → her modda coming-soon.hbs (nginx apex `/` buraya yönlendirir). */
  @Get('coming-soon')
  comingSoon(@Req() req: RequestWithCookies, @Res() res: Response): void {
    this.renderPage(req, res, COMING_SOON_VIEW);
  }

  /** `/<page>.html` → views/<page>.hbs (10 sayfa). Bilinmeyen sayfa → 404.hbs (AllExceptionsFilter). */
  @Get(':page.html')
  page(@Param('page') page: string, @Req() req: RequestWithCookies, @Res() res: Response): void {
    if (!WEB_PAGES.has(page)) {
      throw new NotFoundException(`Sayfa bulunamadı: /${page}.html`);
    }
    if (getSiteMode() === 'coming-soon') {
      // Apex lansmana kadar yalnız coming-soon gösterir; prototip sayfaları apex'te açılmaz (ADR-0012).
      if (page === HOME_VIEW) {
        this.renderPage(req, res, COMING_SOON_VIEW);
        return;
      }
      throw new NotFoundException(`Sayfa henüz yayında değil: /${page}.html`);
    }
    this.renderPage(req, res, page);
  }

  /** Cache-Control başlığını koyar ve şablonu render eder; render hatası → 500 düz metin. */
  private renderPage(req: RequestWithCookies, res: Response, view: string): void {
    const hasSession = Boolean(req.cookies?.[SESSION_COOKIE]);
    res.setHeader('Cache-Control', hasSession ? CACHE_PRIVATE : CACHE_ANONYMOUS);

    const data: ViewData = { assetVersion: APP_VERSION };
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
}
