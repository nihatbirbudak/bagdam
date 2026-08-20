// F5 — SiteContent uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK (JwtAuth/Roles/Csrf A'da; burada uçlar açık) — iş kuralları doğrulanır:
// PUT şema doğrulaması (bilinmeyen alan 400 · zorunlu eksik 400 · tip 400) · upsert + cache düşürme · noktalı anahtar
// rotası · registry şeması · eski (F3) şema biçiminin normalize edilmesi. Test satırları `test.` önekli, sonda silinir;
// registry anahtarı (promoBar) yalnız aynı değerle yazılır ya da yoktu ise silinir (seed içeriği bozulmaz).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminSiteContentItem } from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { ContentModule } from '../../modules/content/content.module';
import { SITE_CONTENT_REGISTRY } from '../../modules/content/site-content.registry';
import { escapeContentValue, toSiteContentTree, validateContentValue } from '../../modules/content/site-content.schema';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const KEY = `test.block-${RUN}`;
const LEGACY_KEY = `test.legacy-${RUN}`;

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

const messages = (body: unknown): string[] => {
  const m = (body as ErrorBody).message;
  return Array.isArray(m) ? m : [m];
};

describe('SiteContent HTTP — /api/v1/site-content · /api/v1/admin/site-content', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let promoBefore: { label: string; schema: Prisma.JsonValue; value: Prisma.JsonValue; updatedBy: string | null } | null = null;

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

    const promo = await prisma.siteContent.findUnique({ where: { key: 'promoBar' } });
    promoBefore = promo ? { label: promo.label, schema: promo.schema, value: promo.value, updatedBy: promo.updatedBy } : null;

    await prisma.siteContent.create({
      data: {
        key: KEY,
        label: 'Test bloğu',
        schema: {
          fields: [
            { name: 'title', label: 'Başlık', type: 'text', required: true },
            { name: 'count', label: 'Sayı', type: 'number', min: 0, max: 10 },
            { name: 'flag', label: 'Bayrak', type: 'boolean' },
            { name: 'mode', label: 'Mod', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
            { name: 'items', label: 'Öğeler', type: 'list', itemFields: [{ name: 'q', label: 'Soru', type: 'text', required: true }, { name: 'a', label: 'Cevap', type: 'richtext' }] },
          ],
        },
        value: { title: 'ilk' },
      },
    });
    // F3 seed biçimi (key/item/html) — normalize edilmeli
    await prisma.siteContent.create({
      data: {
        key: LEGACY_KEY,
        label: 'Eski şema',
        schema: { fields: [{ key: 'html', label: 'Metin', type: 'html', required: true }, { key: 'items', label: 'Liste', type: 'list', item: [{ key: 'label', type: 'text' }] }] },
        value: { html: '<b>x</b>', items: [{ label: 'a' }] },
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.siteContent.deleteMany({ where: { key: { in: [KEY, LEGACY_KEY] } } });
      if (promoBefore) {
        await prisma.siteContent.update({ where: { key: 'promoBar' }, data: { label: promoBefore.label, schema: promoBefore.schema as Prisma.InputJsonValue, value: promoBefore.value as Prisma.InputJsonValue, updatedBy: promoBefore.updatedBy } });
      } else {
        await prisma.siteContent.deleteMany({ where: { key: 'promoBar' } });
      }
    } finally {
      await app?.close();
    }
  });

  // ── Saf yardımcılar ─────────────────────────────────────────────────────────

  it('registry: anahtarlar tekil, her alan adı tekil, liste alanlarının itemFields var', () => {
    const keys = SITE_CONTENT_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of SITE_CONTENT_REGISTRY) {
      const names = entry.schema.fields.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
      for (const f of entry.schema.fields) {
        if (f.type === 'list') expect(f.itemFields && f.itemFields.length > 0).toBe(true);
        if (f.type === 'select') expect(f.options && f.options.length > 0).toBe(true);
      }
    }
    expect(keys).toEqual(expect.arrayContaining(['promoBar', 'footer', 'home.hero', 'home.featured', 'home.faq', 'urunler.trust', 'kutu.notes', 'toptan.form', 'gunluk.hero']));
  });

  it('escapeContentValue: richtext ham, metinler kaçışlı; toSiteContentTree noktalı anahtarları açar', () => {
    const schema = SITE_CONTENT_REGISTRY.find((e) => e.key === 'home.hero')!.schema;
    const escaped = escapeContentValue(schema, { title: 'a <em>b</em>', sub: 'Urla\'nın "x" & <y>', ctaHref: 'urunler.html' }) as Record<string, unknown>;
    expect(escaped.title).toBe('a <em>b</em>');
    expect(escaped.sub).toBe('Urla\'nın &quot;x&quot; &amp; &lt;y&gt;'); // ' kaçışlanmaz (parite)
    const tree = toSiteContentTree({ 'home.hero': { title: 't' }, 'home.faq': { items: [] }, promoBar: { enabled: true } });
    expect(tree).toEqual({ home: { hero: { title: 't' }, faq: { items: [] } }, promoBar: { enabled: true } });
  });

  it('validateContentValue: 400 mesajları alan yollarıyla (bilinmeyen, zorunlu, tip, seçenek, iç içe liste)', () => {
    const schema = SITE_CONTENT_REGISTRY.find((e) => e.key === 'home.featured')!.schema;
    let caught: unknown;
    try {
      validateContentValue(schema, { items: [{ type: 'nope', ref: 'x', order: 1 }], extra: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as { message: string[]; error: string };
    expect(body.error).toBe('CONTENT_VALIDATION');
    expect(body.message.join(' | ')).toMatch(/items\[0\]\.type/);
    expect(body.message.join(' | ')).toMatch(/extra: bilinmeyen alan/);
    const ok = validateContentValue(schema, { items: [{ type: 'product', ref: 'zeytin', order: 1 }] });
    expect(ok).toEqual({ items: [{ type: 'product', ref: 'zeytin', order: 1 }] });
  });

  // ── Public ─────────────────────────────────────────────────────────────────

  it('GET /site-content → {key:value} haritası; test anahtarı DB değeriyle', async () => {
    const res = await api('GET', '/site-content');
    expect(res.status).toBe(200);
    const map = res.body as Record<string, unknown>;
    expect(map[KEY]).toEqual({ title: 'ilk' });
  });

  it('GET /site-content/:key (noktalı anahtar) → değer; bilinmeyen → 404', async () => {
    const ok = await api('GET', `/site-content/${KEY}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ title: 'ilk' });
    const missing = await api('GET', `/site-content/test.yok-${RUN}`);
    expect(missing.status).toBe(404);
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  it('GET /admin/site-content → registry sırası + DB-only anahtarlar; promoBar registry şeması (html richtext, enabled boolean)', async () => {
    const res = await api('GET', '/admin/site-content');
    expect(res.status).toBe(200);
    const items = res.body as AdminSiteContentItem[];
    expect(items[0]!.key).toBe(SITE_CONTENT_REGISTRY[0]!.key);
    const promo = items.find((i) => i.key === 'promoBar')!;
    expect(promo.page).toBe('global');
    expect(promo.schema.fields.map((f) => [f.name, f.type])).toEqual([
      ['enabled', 'boolean'],
      ['html', 'richtext'],
    ]);
    const test = items.find((i) => i.key === KEY)!;
    expect(test.label).toBe('Test bloğu');
    expect(test.value).toEqual({ title: 'ilk' });
    expect(typeof test.updatedAt).toBe('string');
  });

  it('GET /admin/site-content/:key eski (F3) şema → normalize (key→name, html→richtext, item→itemFields)', async () => {
    const res = await api('GET', `/admin/site-content/${LEGACY_KEY}`);
    expect(res.status).toBe(200);
    const item = res.body as AdminSiteContentItem;
    expect(item.schema.fields[0]).toMatchObject({ name: 'html', type: 'richtext', required: true });
    expect(item.schema.fields[1]).toMatchObject({ name: 'items', type: 'list' });
    expect(item.schema.fields[1]!.itemFields?.[0]).toMatchObject({ name: 'label', type: 'text' });
  });

  it('PUT /admin/site-content/:key bilinmeyen alan → 400 (alan adı mesajda)', async () => {
    const res = await api('PUT', `/admin/site-content/${KEY}`, { value: { title: 'y', bogus: 1 } });
    expect(res.status).toBe(400);
    expect(messages(res.body).join(' ')).toMatch(/bogus/);
  });

  it('PUT /admin/site-content/:key zorunlu eksik → 400', async () => {
    const res = await api('PUT', `/admin/site-content/${KEY}`, { value: { count: 2 } });
    expect(res.status).toBe(400);
    expect(messages(res.body).join(' ')).toMatch(/title/);
  });

  it('PUT /admin/site-content/:key tip/seçenek/iç liste hataları → 400 (hepsi tek yanıtta)', async () => {
    const res = await api('PUT', `/admin/site-content/${KEY}`, {
      value: { title: 'y', count: 'iki', flag: 'evet', mode: 'z', items: [{ q: 'a' }, { q: '' }, { q: 'c', x: 1 }] },
    });
    expect(res.status).toBe(400);
    const joined = messages(res.body).join(' | ');
    expect(joined).toMatch(/count/);
    expect(joined).toMatch(/flag/);
    expect(joined).toMatch(/mode/);
    expect(joined).toMatch(/items\[1\]\.q/);
    expect(joined).toMatch(/items\[2\]\.x/);
  });

  it('PUT /admin/site-content/:key gövdesiz value → 400; bilinmeyen anahtar → 404', async () => {
    expect((await api('PUT', `/admin/site-content/${KEY}`, { nope: 1 })).status).toBe(400);
    expect((await api('PUT', `/admin/site-content/test.yok-${RUN}`, { value: { a: 1 } })).status).toBe(404);
  });

  it('PUT /admin/site-content/:key geçerli → 200; public harita güncel (cache düştü)', async () => {
    const value = { title: 'güncel', count: 3, flag: true, mode: 'b', items: [{ q: 'Soru?', a: '<b>Cevap</b>' }] };
    const res = await api('PUT', `/admin/site-content/${KEY}`, { value });
    expect(res.status).toBe(200);
    const item = res.body as AdminSiteContentItem;
    expect(item.value).toEqual(value);
    expect(item.key).toBe(KEY);
    const pub = await api('GET', `/site-content/${KEY}`);
    expect(pub.body).toEqual(value);
    const map = (await api('GET', '/site-content')).body as Record<string, unknown>;
    expect(map[KEY]).toEqual(value);
  });

  it('registry anahtarı (promoBar): zorunlu html eksik → 400; bilinmeyen alan → 400; geçerli → 200 ve şema DB\'ye yazılır', async () => {
    expect((await api('PUT', '/admin/site-content/promoBar', { value: { enabled: true } })).status).toBe(400);
    expect((await api('PUT', '/admin/site-content/promoBar', { value: { enabled: true, html: 'x', text: 'y' } })).status).toBe(400);

    const value = (promoBefore?.value as Record<string, unknown> | null) ?? { enabled: false, html: `test ${RUN}` };
    const res = await api('PUT', '/admin/site-content/promoBar', { value });
    expect(res.status).toBe(200);
    const item = res.body as AdminSiteContentItem;
    expect(item.value).toEqual(value);
    expect(item.schema.fields.map((f) => f.name)).toEqual(['enabled', 'html']);
    const row = await prisma.siteContent.findUniqueOrThrow({ where: { key: 'promoBar' } });
    const stored = row.schema as { fields: Array<{ name: string; type: string }> };
    expect(stored.fields.map((f) => f.name)).toEqual(['enabled', 'html']);
    expect((await api('GET', '/site-content/promoBar')).body).toEqual(value);
  });
});
