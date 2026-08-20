// F3 — public katalog uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch).
// /api/v1 öneki + ValidationPipe + AllExceptionsFilter main.ts ile aynı; DB gerçek (seed'li) bagdam_dev.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { BootstrapPayload, BoxTemplate, BoxTier, Producer, Product } from '@bagdam/shared';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(60_000);

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
}

describe('Catalog HTTP — /api/v1/bootstrap · products · tiers · producers', () => {
  let app: INestApplication;
  let baseUrl: string;

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${path}`, { headers });

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /bootstrap → 200 JSON, Cache-Control public max-age=60, products.js sabitleri + me/sub null', async () => {
    const res = await get('/api/v1/bootstrap');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await res.json()) as BootstrapPayload;
    expect(body.products).toHaveLength(22);
    expect(body.tiers.map((t) => t.id)).toEqual(['small', 'sezon']);
    expect(body.freqOptions).toHaveLength(3);
    expect(body.deliveryDays.map((d) => d.id)).toEqual(['sali', 'persembe', 'cumartesi']);
    expect(body.deliveryFee).toBe(49);
    expect(body.me).toBeNull();
    expect(body.sub).toBeNull();
    expect(Array.isArray(body.deliveryDates)).toBe(true);
    expect(typeof body.templates).toBe('object');
    expect(body.pool.length).toBeGreaterThan(0);
    expect(body.recommendedTier).toBe('sezon');
  });

  it('GET /bootstrap (oturum çerezi) → Cache-Control private, no-store (me/sub F6’ya kadar null)', async () => {
    const res = await get('/api/v1/bootstrap', { cookie: 'access_token=x' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as BootstrapPayload;
    expect(body.me).toBeNull();
  });

  it('GET /products → yayındaki ürünler (Product DTO; price number, currentLot, images)', async () => {
    const res = await get('/api/v1/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Product[];
    expect(body.length).toBeGreaterThanOrEqual(22);
    for (const p of body) {
      expect(typeof p.slug).toBe('string');
      expect(typeof p.price).toBe('number');
      expect(p.status).toBe('ACTIVE');
      expect(Array.isArray(p.images)).toBe(true);
      expect(Array.isArray(p.prefOptions)).toBe(true);
    }
  });

  it('GET /products/incir → 200 (slug, lot K14-03, 2 görsel, kategori/üretici özeti)', async () => {
    const res = await get('/api/v1/products/incir');
    expect(res.status).toBe(200);
    const p = (await res.json()) as Product;
    expect(p.slug).toBe('incir');
    expect(p.currentLot?.lotCode).toBe('K14-03');
    expect(p.images).toHaveLength(2);
    expect(p.images[0]?.isCover).toBe(true);
    expect(p.category?.slug).toBe('boxes');
    expect(p.producer?.name).toBe('Hüseyin Dağ');
    expect(p.isFresh).toBe(true);
  });

  it('GET /products/:slug (yok) → 404 JSON zarfı', async () => {
    const res = await get('/api/v1/products/boyle-bir-urun-yok');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as ErrorBody;
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.path).toBe('/api/v1/products/boyle-bir-urun-yok');
  });

  it('GET /products/:slug (geçersiz slug) → 400', async () => {
    const res = await get('/api/v1/products/Ge%C3%A7ersiz%20SLUG');
    expect(res.status).toBe(400);
  });

  it('GET /tiers → aktif tier’lar (BoxTier DTO)', async () => {
    const res = await get('/api/v1/tiers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoxTier[];
    expect(body.map((t) => t.slug)).toEqual(['small', 'sezon']);
    const sezon = body.find((t) => t.slug === 'sezon');
    expect(sezon?.isRecommended).toBe(true);
    expect(sezon?.itemCount).toBe(10);
    expect(typeof sezon?.price).toBe('number');
    expect(sezon?.imageUrl).toBe('assets/images/urunler/sezon.jpg');
  });

  it('GET /tiers/sezon/template → bu haftanın yayınlanmış şablonu (BoxTemplate DTO)', async () => {
    const res = await get('/api/v1/tiers/sezon/template');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoxTemplate;
    expect(body.tierSlug).toBe('sezon');
    expect(body.status).toBe('PUBLISHED');
    expect(body.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(10);
    for (const item of body.items) {
      expect(typeof item.product?.slug).toBe('string');
      expect(typeof item.qtyLabel).toBe('string');
    }
  });

  it('GET /tiers/sezon/template?week=1999-01-05 → 404 (o haftaya kadar şablon yok)', async () => {
    const res = await get('/api/v1/tiers/sezon/template?week=1999-01-05');
    expect(res.status).toBe(404);
  });

  it('GET /tiers/sezon/template?week=2026-8-1 → 400 (biçim)', async () => {
    const res = await get('/api/v1/tiers/sezon/template?week=2026-8-1');
    expect(res.status).toBe(400);
  });

  it('GET /tiers/sezon/template?week=2026-02-30 → 400 (takvimde yok)', async () => {
    const res = await get('/api/v1/tiers/sezon/template?week=2026-02-30');
    expect(res.status).toBe(400);
  });

  it('GET /tiers/yok/template → 404', async () => {
    const res = await get('/api/v1/tiers/yok/template');
    expect(res.status).toBe(404);
  });

  it('GET /producers → aktif üreticiler (Producer DTO + productCount)', async () => {
    const res = await get('/api/v1/producers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Producer[];
    expect(body.length).toBeGreaterThanOrEqual(15);
    const bagdam = body.find((p) => p.slug === 'bagdam-ciftlik');
    expect(bagdam?.name).toBe('Bağdam Çiftlik');
    expect(bagdam?.village).toBe('Kuşçular');
    expect(bagdam?.district).toBe('Urla');
    expect(typeof bagdam?.productCount).toBe('number');
    expect(bagdam?.productCount).toBeGreaterThanOrEqual(5);
  });
});
