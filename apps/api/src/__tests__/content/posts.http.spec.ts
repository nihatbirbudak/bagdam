// F5 — Günlük (Post) uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK — iş kuralları doğrulanır: admin CRUD · slug 409 · kapak medyası 404 · publish → publishedAt
// · public liste/tekil yalnız PUBLISHED (cache düşürme dahil) · coverUrl: admin mutlak (/assets|/uploads), public site-göreli.
// Test verisi `test-post-<run>` önekli ve sonda silinir.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminPostList, Post, PublicPost, PublicPostList } from '@bagdam/shared';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { ContentModule } from '../../modules/content/content.module';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const SLUG_A = `test-post-a-${RUN}`;
const SLUG_B = `test-post-b-${RUN}`;

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Posts HTTP — /api/v1/posts · /api/v1/admin/posts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let mediaId: string;
  let postA: Post;
  let postB: Post;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, body: json };
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, ContentModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    const media = await prisma.mediaFile.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    mediaId = media.id;
  });

  afterAll(async () => {
    try {
      await prisma.post.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
    } finally {
      await app?.close();
    }
  });

  it('POST /admin/posts → 201 (DRAFT, publishedAt null, coverUrl null, varsayılan readMinutes 4)', async () => {
    const res = await api('POST', '/admin/posts', {
      slug: SLUG_A,
      kind: 'Söyleşi',
      titleHtml: 'bir annenin ekmeği, <em>iki sofrada</em>',
      excerpt: '',
      bodyHtml: '<p>Test gövdesi</p>',
      relatedSlugs: ['sadeekmek'],
      status: 'DRAFT',
    });
    expect(res.status).toBe(201);
    postA = res.body as Post;
    expect(postA).toMatchObject({ slug: SLUG_A, kind: 'Söyleşi', status: 'DRAFT', publishedAt: null, coverUrl: null, coverMediaId: null, readMinutes: 4, excerpt: null });
    expect(postA.relatedSlugs).toEqual(['sadeekmek']);
  });

  it('POST /admin/posts aynı slug → 409; gövde eksik → 400; olmayan kapak medyası → 404', async () => {
    const dup = await api('POST', '/admin/posts', { slug: SLUG_A, kind: 'x', titleHtml: 'x', bodyHtml: 'x' });
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).message).toMatch(/slug/i);
    expect((await api('POST', '/admin/posts', { slug: SLUG_B, kind: 'x', titleHtml: 'x' })).status).toBe(400);
    expect((await api('POST', '/admin/posts', { slug: 'Büyük Harf', kind: 'x', titleHtml: 'x', bodyHtml: 'x' })).status).toBe(400);
    expect((await api('POST', '/admin/posts', { slug: SLUG_B, kind: 'x', titleHtml: 'x', bodyHtml: 'x', coverMediaId: 'ckolmayan0000000000000000' })).status).toBe(404);
  });

  it('POST /admin/posts PUBLISHED + kapak → 201 publishedAt dolu, coverUrl mutlak (/assets|/uploads)', async () => {
    const res = await api('POST', '/admin/posts', {
      slug: SLUG_B,
      kind: 'Mevsim',
      readMinutes: 6,
      titleHtml: 'bardacık inciri',
      bodyHtml: '<p>B</p>',
      coverMediaId: mediaId,
      status: 'PUBLISHED',
    });
    expect(res.status).toBe(201);
    postB = res.body as Post;
    expect(postB.status).toBe('PUBLISHED');
    expect(typeof postB.publishedAt).toBe('string');
    expect(postB.coverMediaId).toBe(mediaId);
    expect(postB.coverUrl).toMatch(/^\/(assets|uploads)\//);
  });

  it('GET /admin/posts?q=&status= → sayfalı liste; GET /admin/posts/:id → detay; geçersiz id → 400, olmayan → 404', async () => {
    const list = await api('GET', `/admin/posts?q=test-post-&status=DRAFT&page=1&limit=10`);
    expect(list.status).toBe(200);
    const page = list.body as AdminPostList;
    expect(page.page).toBe(1);
    expect(page.limit).toBe(10);
    expect(page.items.map((p) => p.slug)).toContain(SLUG_A);
    expect(page.items.map((p) => p.slug)).not.toContain(SLUG_B);

    const detail = await api('GET', `/admin/posts/${postA.id}`);
    expect(detail.status).toBe(200);
    expect((detail.body as Post).id).toBe(postA.id);
    expect((await api('GET', '/admin/posts/bad id')).status).toBe(400);
    expect((await api('GET', '/admin/posts/ckolmayan0000000000000000')).status).toBe(404);
  });

  it('public GET /posts yalnız PUBLISHED (taslak yok); GET /posts/:slug taslak → 404, yayındaki → 200 (coverUrl site-göreli, tarih etiketi)', async () => {
    const list = await api('GET', '/posts?limit=50&page=1');
    expect(list.status).toBe(200);
    const body = list.body as PublicPostList;
    const slugs = body.items.map((p) => p.slug);
    expect(slugs).toContain(SLUG_B);
    expect(slugs).not.toContain(SLUG_A);
    expect(body.total).toBeGreaterThanOrEqual(1);
    for (const p of body.items) expect(p.status).toBe('PUBLISHED');

    expect((await api('GET', `/posts/${SLUG_A}`)).status).toBe(404);
    const one = await api('GET', `/posts/${SLUG_B}`);
    expect(one.status).toBe(200);
    const pub = one.body as PublicPost;
    expect(pub.coverUrl).toMatch(/^(assets|uploads)\//);
    expect(pub.publishedDateLabel).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect((await api('GET', '/posts?limit=0')).status).toBe(400);
  });

  it('POST /admin/posts/:id/publish → 200 PUBLISHED + publishedAt; public liste güncellenir (cache düştü)', async () => {
    const res = await api('POST', `/admin/posts/${postA.id}/publish`);
    expect(res.status).toBe(200);
    const pub = res.body as Post;
    expect(pub.status).toBe('PUBLISHED');
    expect(typeof pub.publishedAt).toBe('string');
    const list = (await api('GET', '/posts?limit=50')).body as PublicPostList;
    expect(list.items.map((p) => p.slug)).toContain(SLUG_A);
    // ikinci publish tarihi değiştirmez
    const again = (await api('POST', `/admin/posts/${postA.id}/publish`)).body as Post;
    expect(again.publishedAt).toBe(pub.publishedAt);
  });

  it('PUT /admin/posts/:id kısmi (DRAFT\'a geri) → 200; public tekil 404 olur; publishedAt:null temizler', async () => {
    const res = await api('PUT', `/admin/posts/${postA.id}`, { titleHtml: 'güncel başlık', status: 'DRAFT', publishedAt: null });
    expect(res.status).toBe(200);
    const upd = res.body as Post;
    expect(upd.titleHtml).toBe('güncel başlık');
    expect(upd.status).toBe('DRAFT');
    expect(upd.publishedAt).toBeNull();
    expect(upd.kind).toBe('Söyleşi'); // korunur
    expect((await api('GET', `/posts/${SLUG_A}`)).status).toBe(404);
    // slug çakışması güncellemede de 409
    expect((await api('PUT', `/admin/posts/${postA.id}`, { slug: SLUG_B })).status).toBe(409);
  });

  it('DELETE /admin/posts/:id → 204 (hard delete); sonra 404', async () => {
    expect((await api('DELETE', `/admin/posts/${postA.id}`)).status).toBe(204);
    expect((await api('GET', `/admin/posts/${postA.id}`)).status).toBe(404);
    expect(await prisma.post.findUnique({ where: { id: postA.id } })).toBeNull();
  });
});
