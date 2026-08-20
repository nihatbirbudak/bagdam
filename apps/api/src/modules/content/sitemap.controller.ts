import { Controller, Get, Header, RequestMethod } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTimeout } from '../../common/decorators/skip-timeout.decorator';
import type { ExcludedRoute } from '../../web/web.routes';
import { HOME_VIEW, WEB_PAGES } from '../../web/web.routes';
import { DEFAULT_WEB_URL } from './content.constants';
import { ContentService } from './content.service';

/**
 * Nest global prefix (`/api/v1`) dışında kalması gereken rotalar — main.ts `setGlobalPrefix(..., { exclude })` listesine
 * (web/web.routes.ts `WEB_ROUTES_EXCLUDED_FROM_PREFIX` ile birlikte) eklenir. Eklenmeden bu uçlar `/api/v1/sitemap.xml`
 * altında yanıt verir.
 */
export const SITEMAP_ROUTES_EXCLUDED_FROM_PREFIX: ExcludedRoute[] = [
  { path: 'sitemap.xml', method: RequestMethod.GET },
  { path: 'robots.txt', method: RequestMethod.GET },
];

interface SitemapEntry {
  loc: string;
  changefreq: string;
  priority: string;
  lastmod?: string;
}

/** Sayfa başına changefreq/priority — web.routes WEB_PAGES'teki 10 sayfa (index `/` olarak). */
const PAGE_META: Readonly<Record<string, { changefreq: string; priority: string }>> = {
  index: { changefreq: 'weekly', priority: '1.0' },
  urunler: { changefreq: 'weekly', priority: '0.9' },
  kutu: { changefreq: 'weekly', priority: '0.8' },
  gunluk: { changefreq: 'weekly', priority: '0.7' },
  'nasil-seciyoruz': { changefreq: 'monthly', priority: '0.6' },
  toptan: { changefreq: 'monthly', priority: '0.5' },
  urun: { changefreq: 'weekly', priority: '0.4' },
  politikalar: { changefreq: 'yearly', priority: '0.3' },
  sepet: { changefreq: 'monthly', priority: '0.1' },
  uyelik: { changefreq: 'monthly', priority: '0.1' },
};
const DEFAULT_PAGE_META = { changefreq: 'monthly', priority: '0.5' } as const;

/** WEB_URL (sonundaki / atılır); yoksa üretim alan adı. Çağrı anında okunur (testlerde değiştirilebilsin). */
export function resolveWebUrl(): string {
  const raw = process.env.WEB_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_WEB_URL).replace(/\/+$/, '');
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      let url = `  <url>\n    <loc>${escapeXml(e.loc)}</loc>`;
      if (e.lastmod) url += `\n    <lastmod>${e.lastmod}</lastmod>`;
      url += `\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`;
      return url;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * SitemapController — `GET /sitemap.xml` (10 sayfa + yayındaki günlük yazıları `gunluk.html#slug`) ve `GET /robots.txt`
 * (Allow / + Sitemap satırı; /api/ taranmaz). WebController dışı ayrı @Public controller (BACKEND-PLANI §3 web satırı);
 * yazılar ContentService cache'inden. Throttle/timeout yok: anonim, ucuz, nginx cache'lenebilir (1 saat).
 */
@Controller()
@Public()
@SkipThrottle()
@SkipTimeout()
export class SitemapController {
  constructor(private readonly content: ContentService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'text/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap(): Promise<string> {
    const base = resolveWebUrl();
    const entries: SitemapEntry[] = [];
    for (const page of WEB_PAGES) {
      const meta = PAGE_META[page] ?? DEFAULT_PAGE_META;
      entries.push({ loc: page === HOME_VIEW ? `${base}/` : `${base}/${page}.html`, ...meta });
    }
    for (const post of await this.content.getSitemapPosts()) {
      entries.push({ loc: `${base}/gunluk.html#${post.slug}`, changefreq: 'monthly', priority: '0.6', lastmod: toIsoDate(post.lastmod) });
    }
    return buildSitemapXml(entries);
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  robots(): string {
    const base = resolveWebUrl();
    return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
  }
}
