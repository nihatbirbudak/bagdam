// F5 — Yasal metin sürümleri + onay kaydı HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, DB bagdam_dev).
// Guard'lar test modülünde YOK — iş kuralları: yeni slug'da kind zorunlu · sürüm = max+1 taslak · publish → slug'ta tek
// isCurrent · yayındaki sürüm düzenlenemez (409) · taslak düzenlenir (hash yenilenir) · PATCH nav slug'ın tüm sürümlerine
// · public /legal yalnız isCurrent, /legal/:slug/v/:version taslağa da erişir · getLegalNav cache düşer ·
// POST /consents 201 + ip/ua + documentId (sürümlü/yayındaki). Test slug'ı `test-legal-<run>`, sonda silinir.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminLegalGroup, ConsentCreated, LegalDocument } from '@bagdam/shared';
import cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { ContentModule } from '../../modules/content/content.module';
import { ContentService } from '../../modules/content/content.service';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const SLUG = `test-legal-${RUN}`;
const GUEST = `test-guest-${RUN}`;
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Legal + Consents HTTP — /api/v1/legal · /api/v1/admin/legal · /api/v1/consents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let content: ContentService;
  let baseUrl: string;
  let v1: LegalDocument;
  let v2: LegalDocument;
  const consentIds: string[] = [];

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
    content = app.get(ContentService);
  });

  afterAll(async () => {
    try {
      await prisma.consent.deleteMany({ where: { OR: [{ id: { in: consentIds } }, { guestKey: GUEST }] } });
      await prisma.legalDocument.deleteMany({ where: { slug: SLUG } });
    } finally {
      await app?.close();
    }
  });

  // ── Yasal sürümler ─────────────────────────────────────────────────────────

  it('POST /admin/legal/:slug/versions yeni slug kind\'sız → 400; kind ile → 201 v1 taslak (hash sha256)', async () => {
    const noKind = await api('POST', `/admin/legal/${SLUG}/versions`, { title: 'Test Sözleşme', bodyHtml: '<p>v1</p>' });
    expect(noKind.status).toBe(400);
    expect((noKind.body as ErrorBody).message).toMatch(/kind/);

    const res = await api('POST', `/admin/legal/${SLUG}/versions`, { title: 'Test Sözleşme', bodyHtml: '<p>v1</p>', kind: 'TERMS', showInNav: false, sortOrder: 900 });
    expect(res.status).toBe(201);
    v1 = res.body as LegalDocument;
    expect(v1).toMatchObject({ slug: SLUG, kind: 'TERMS', version: 1, isCurrent: false, showInNav: false, requiresAck: false, sortOrder: 900, leadHtml: null });
    expect(v1.contentHash).toBe(sha256('<p>v1</p>'));
  });

  it('yayın yokken public GET /legal/:slug → 404; /legal listesinde slug yok', async () => {
    expect((await api('GET', `/legal/${SLUG}`)).status).toBe(404);
    const list = (await api('GET', '/legal')).body as LegalDocument[];
    expect(list.some((d) => d.slug === SLUG)).toBe(false);
  });

  it('POST /admin/legal/:id/publish → isCurrent; public GET /legal/:slug → v1 (bodyHtml dahil); GET /legal listesinde', async () => {
    const res = await api('POST', `/admin/legal/${v1.id}/publish`, {});
    expect(res.status).toBe(200);
    expect((res.body as LegalDocument).isCurrent).toBe(true);
    const pub = await api('GET', `/legal/${SLUG}`);
    expect(pub.status).toBe(200);
    expect((pub.body as LegalDocument)).toMatchObject({ version: 1, bodyHtml: '<p>v1</p>', isCurrent: true });
    const list = (await api('GET', '/legal')).body as LegalDocument[];
    const row = list.find((d) => d.slug === SLUG)!;
    expect(row.version).toBe(1);
    expect(row.showInNav).toBe(false);
  });

  it('PUT /admin/legal/:id yayındaki sürüm → 409 (LEGAL_CURRENT_LOCKED)', async () => {
    const res = await api('PUT', `/admin/legal/${v1.id}`, { bodyHtml: '<p>değişiklik</p>' });
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error).toBe('LEGAL_CURRENT_LOCKED');
  });

  it('ikinci sürüm: kind miras, version 2, taslak; PUT taslak → 200 hash yenilenir; /legal/:slug/v/2 taslağa erişir', async () => {
    const res = await api('POST', `/admin/legal/${SLUG}/versions`, { title: 'Test Sözleşme v2', bodyHtml: '<p>v2</p>', leadHtml: '<p>giriş</p>' });
    expect(res.status).toBe(201);
    v2 = res.body as LegalDocument;
    expect(v2).toMatchObject({ version: 2, kind: 'TERMS', isCurrent: false, sortOrder: 900, leadHtml: '<p>giriş</p>' });

    const upd = await api('PUT', `/admin/legal/${v2.id}`, { bodyHtml: '<p>v2 güncel</p>', title: 'Test Sözleşme v2 (güncel)' });
    expect(upd.status).toBe(200);
    v2 = upd.body as LegalDocument;
    expect(v2.contentHash).toBe(sha256('<p>v2 güncel</p>'));
    expect(v2.title).toBe('Test Sözleşme v2 (güncel)');

    const byVersion = await api('GET', `/legal/${SLUG}/v/2`);
    expect(byVersion.status).toBe(200);
    expect((byVersion.body as LegalDocument).bodyHtml).toBe('<p>v2 güncel</p>');
    expect((await api('GET', `/legal/${SLUG}/v/9`)).status).toBe(404);
    expect((await api('GET', `/legal/${SLUG}/v/x`)).status).toBe(400);
    // yayındaki hâlâ v1
    expect(((await api('GET', `/legal/${SLUG}`)).body as LegalDocument).version).toBe(1);
  });

  it('v2 publish (effectiveFrom ile) → slug\'ta tek isCurrent (v2); v1 düşer; public /legal/:slug → v2', async () => {
    const res = await api('POST', `/admin/legal/${v2.id}/publish`, { effectiveFrom: '2026-09-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body as LegalDocument).toMatchObject({ isCurrent: true, effectiveFrom: '2026-09-01T00:00:00.000Z' });
    const rows = await prisma.legalDocument.findMany({ where: { slug: SLUG } });
    expect(rows.filter((r) => r.isCurrent).map((r) => r.version)).toEqual([2]);
    expect(((await api('GET', `/legal/${SLUG}`)).body as LegalDocument).version).toBe(2);
    expect((await api('POST', `/admin/legal/${v2.id}/publish`, { effectiveFrom: 'dün' })).status).toBe(400);
  });

  it('PATCH /admin/legal/:id/nav → slug\'ın tüm sürümleri; getLegalNav (cache düşmüş) slug\'ı içerir', async () => {
    const before = await content.getLegalNav();
    expect(before.some((n) => n.slug === SLUG)).toBe(false);

    expect((await api('PATCH', `/admin/legal/${v2.id}/nav`, {})).status).toBe(400);
    const res = await api('PATCH', `/admin/legal/${v2.id}/nav`, { showInNav: true, sortOrder: 950, requiresAck: true });
    expect(res.status).toBe(200);
    expect(res.body as LegalDocument).toMatchObject({ id: v2.id, showInNav: true, sortOrder: 950, requiresAck: true });
    const rows = await prisma.legalDocument.findMany({ where: { slug: SLUG } });
    for (const r of rows) expect({ showInNav: r.showInNav, sortOrder: r.sortOrder, requiresAck: r.requiresAck }).toEqual({ showInNav: true, sortOrder: 950, requiresAck: true });

    const nav = await content.getLegalNav();
    const item = nav.find((n) => n.slug === SLUG)!;
    expect(item).toEqual({ slug: SLUG, title: 'Test Sözleşme v2 (güncel)', kind: 'TERMS', version: 2, sortOrder: 950, requiresAck: true });
    // sıra: sortOrder artan
    const orders = nav.map((n) => n.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('GET /admin/legal → slug grubu (currentVersion 2, sürümler azalan); GET /admin/legal/:id → tam belge', async () => {
    const res = await api('GET', '/admin/legal');
    expect(res.status).toBe(200);
    const group = (res.body as AdminLegalGroup[]).find((g) => g.slug === SLUG)!;
    expect(group).toMatchObject({ kind: 'TERMS', currentVersion: 2, title: 'Test Sözleşme v2 (güncel)', showInNav: true, sortOrder: 950 });
    expect(group.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(group.versions[0]).toMatchObject({ id: v2.id, isCurrent: true });
    const detail = await api('GET', `/admin/legal/${v1.id}`);
    expect(detail.status).toBe(200);
    expect((detail.body as LegalDocument).bodyHtml).toBe('<p>v1</p>');
  });

  // ── Onaylar ────────────────────────────────────────────────────────────────

  it('POST /consents → 201 {id}; ip/ua kaydı; documentSlug → yayındaki sürüm (v2)', async () => {
    const res = await api('POST', '/consents', { kind: 'KVKK_ACK', documentSlug: SLUG });
    expect(res.status).toBe(201);
    const { id } = res.body as ConsentCreated;
    consentIds.push(id);
    const row = await prisma.consent.findUniqueOrThrow({ where: { id } });
    expect(row.kind).toBe('KVKK_ACK');
    expect(row.documentId).toBe(v2.id);
    expect(row.granted).toBe(true);
    expect(row.source).toBe('HS_WEB');
    expect(row.userId).toBeNull();
    expect(row.ipAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(row.userAgent).toBeTruthy();
  });

  it('POST /consents sürümlü belge (v1), granted:false + guestKey + source → 201', async () => {
    const res = await api('POST', '/consents', { kind: 'COOKIE_ANALYTICS', documentSlug: SLUG, documentVersion: 1, granted: false, guestKey: GUEST, source: 'HS_BANNER' });
    expect(res.status).toBe(201);
    const { id } = res.body as ConsentCreated;
    consentIds.push(id);
    const row = await prisma.consent.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ documentId: v1.id, granted: false, guestKey: GUEST, source: 'HS_BANNER' });
  });

  it('POST /consents geçersiz kind → 400; olmayan belge → 404; bilinmeyen alan → 400', async () => {
    expect((await api('POST', '/consents', { kind: 'NOPE' })).status).toBe(400);
    expect((await api('POST', '/consents', { kind: 'KVKK_ACK', documentSlug: `yok-${RUN}` })).status).toBe(404);
    expect((await api('POST', '/consents', { kind: 'KVKK_ACK', extra: 1 })).status).toBe(400);
    expect((await api('POST', '/consents', { kind: 'KVKK_ACK', source: 'küçük harf' })).status).toBe(400);
  });
});
