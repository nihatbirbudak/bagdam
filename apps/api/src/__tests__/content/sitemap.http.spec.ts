// F5 — sitemap.xml / robots.txt HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, DB bagdam_dev).
// Global prefix dışı: testte `setGlobalPrefix('api/v1', { exclude: SITEMAP_ROUTES_EXCLUDED_FROM_PREFIX })` (main.ts'te
// aynı liste exclude'a eklenmeli). Doğrulanır: XML başlığı/urlset, 10 sayfa (index `/`), yayındaki yazı `gunluk.html#slug`,
// taslak yazı yok, kaçışsız & yok, <url> sayısı = sayfa + yayındaki yazı sayısı; robots Allow / + Sitemap satırı.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { ContentModule } from '../../modules/content/content.module';
import { buildSitemapXml, resolveWebUrl, SITEMAP_ROUTES_EXCLUDED_FROM_PREFIX } from '../../modules/content/sitemap.controller';
import { WEB_PAGES } from '../../web/web.routes';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PUBLISHED_SLUG = `test-sitemap-pub-${RUN}`;
const DRAFT_SLUG = `test-sitemap-draft-${RUN}`;

describe('Sitemap HTTP — /sitemap.xml · /robots.txt', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let webUrl: string;

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, ContentModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: SITEMAP_ROUTES_EXCLUDED_FROM_PREFIX });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    webUrl = resolveWebUrl();

    await prisma.post.createMany({
      data: [
        { slug: PUBLISHED_SLUG, kind: 'Test', titleHtml: 'yayında', bodyHtml: '<p>x</p>', status: 'PUBLISHED', publishedAt: new Date() },
        { slug: DRAFT_SLUG, kind: 'Test', titleHtml: 'taslak', bodyHtml: '<p>y</p>', status: 'DRAFT' },
      ],
    });
  });

  afterAll(async () => {
    try {
      await prisma.post.deleteMany({ where: { slug: { in: [PUBLISHED_SLUG, DRAFT_SLUG] } } });
    } finally {
      await app?.close();
    }
  });

  it('buildSitemapXml: XML kaçışı (& → &amp;) ve isteğe bağlı lastmod', () => {
    const xml = buildSitemapXml([
      { loc: 'https://x.test/a?b=1&c=2', changefreq: 'weekly', priority: '0.5' },
      { loc: 'https://x.test/b', changefreq: 'monthly', priority: '0.3', lastmod: '2026-08-20' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml).toContain('<loc>https://x.test/a?b=1&amp;c=2</loc>');
    expect(xml).toContain('<lastmod>2026-08-20</lastmod>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('GET /sitemap.xml → 200 text/xml; 10 sayfa + yayındaki yazılar; taslak yok; geçerli XML iskeleti', async () => {
    const res = await fetch(`${baseUrl}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/xml/);
    expect(res.headers.get('cache-control')).toMatch(/max-age=3600/);
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);

    // sayfalar
    expect(xml).toContain(`<loc>${webUrl}/</loc>`);
    for (const page of WEB_PAGES) {
      if (page === 'index') continue;
      expect(xml).toContain(`<loc>${webUrl}/${page}.html</loc>`);
    }
    // yazılar
    expect(xml).toContain(`<loc>${webUrl}/gunluk.html#${PUBLISHED_SLUG}</loc>`);
    expect(xml).not.toContain(DRAFT_SLUG);

    // sayım + iyi biçimlilik
    const opens = (xml.match(/<url>/g) ?? []).length;
    const closes = (xml.match(/<\/url>/g) ?? []).length;
    const published = await prisma.post.count({ where: { status: 'PUBLISHED' } });
    expect(opens).toBe(closes);
    expect(opens).toBe(WEB_PAGES.size + published);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(opens);
  });

  it('GET /robots.txt → Allow / + Sitemap satırı (WEB_URL)', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain(`Sitemap: ${webUrl}/sitemap.xml`);
  });

  it('prefix dışı: /api/v1/sitemap.xml → 404 (JSON zarfı)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sitemap.xml`);
    expect(res.status).toBe(404);
  });
});
