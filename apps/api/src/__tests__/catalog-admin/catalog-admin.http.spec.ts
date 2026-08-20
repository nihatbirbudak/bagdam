// F4 — katalog admin CRUD uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK (JwtAuth/Roles/Csrf A'da; burada uçlar açık) — iş kuralları doğrulanır:
// ürün oluştur/güncelle/soft delete · slug 409 · parti isCurrent tekilliği · görsel kapak tekilliği · reorder ·
// kategori/üretici/tier · box-template publish tekilliği + clone + box-week. Test verisi `test-` önekli ve sonda temizlenir;
// ürünler DRAFT/HIDDEN ve şablonlar 2099 yılında → bootstrap/public testleri etkilenmez.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AdminBoxTemplate,
  AdminBoxTier,
  AdminBoxWeek,
  AdminCategory,
  AdminPage,
  AdminProducer,
  AdminProductDetail,
  AdminProductImage,
  AdminProductListItem,
  AdminProductLot,
} from '@bagdam/shared';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const SLUG_A = `test-admin-a-${RUN}`;
const SLUG_B = `test-admin-b-${RUN}`;
const TIER_SLUG_1 = `test-tier-1-${RUN}`;
const TIER_SLUG_2 = `test-tier-2-${RUN}`;
/** 2099-01-05 Pazartesi — bootstrap (weekStart ≤ bu hafta) bu şablonları asla basmaz. */
const FAR_WEEK = '2099-01-06'; // Salı → Pazartesi 2099-01-05'e yuvarlanmalı
const FAR_MONDAY = '2099-01-05';
const FAR_NEXT_MONDAY = '2099-01-12';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Catalog admin HTTP — /api/v1/admin/* (ürün · parti · görsel · kategori · üretici · tier · haftanın kutusu)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

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

  // Test verisi kimlikleri
  let categoryId: string;
  let producerId: string;
  let mediaIds: string[];
  let productA: AdminProductDetail;
  let productB: AdminProductDetail;
  let tier1Id: string;
  let tier2Id: string;
  let sezonTierId: string;
  let templateId: string;
  let clonedId: string;
  let testProducerId: string;

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
    prisma = app.get(PrismaService);

    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'boxes' } });
    categoryId = category.id;
    const producer = await prisma.producer.findFirstOrThrow({ where: { slug: 'bagdam-ciftlik' } });
    producerId = producer.id;
    const medias = await prisma.mediaFile.findMany({ where: { folder: 'urunler' }, orderBy: { createdAt: 'asc' }, take: 3 });
    mediaIds = medias.map((m) => m.id);
    expect(mediaIds.length).toBeGreaterThanOrEqual(2);
    const sezon = await prisma.boxTier.findFirstOrThrow({ where: { slug: 'sezon' } });
    sezonTierId = sezon.id;

    // Test tier'ları: pasif (bootstrap.tiers'a girmez), önerilmez
    const t1 = await prisma.boxTier.create({ data: { slug: TIER_SLUG_1, label: 'Test Tier 1', itemCount: 2, price: 100, isActive: false, sortOrder: 900 } });
    const t2 = await prisma.boxTier.create({ data: { slug: TIER_SLUG_2, label: 'Test Tier 2', itemCount: 3, price: 200, isActive: false, sortOrder: 901 } });
    tier1Id = t1.id;
    tier2Id = t2.id;
  });

  afterAll(async () => {
    // Temizlik (ters sıra): şablonlar → tier'lar → ürünler (görsel/parti cascade) → üretici; sezon yeniden önerilen
    try {
      await prisma.boxTemplate.deleteMany({ where: { tierId: { in: [tier1Id, tier2Id].filter(Boolean) } } });
      await prisma.boxTier.deleteMany({ where: { slug: { in: [TIER_SLUG_1, TIER_SLUG_2] } } });
      await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
      if (testProducerId) await prisma.producer.deleteMany({ where: { id: testProducerId } });
      await prisma.boxTier.update({ where: { id: sezonTierId }, data: { isRecommended: true } });
    } finally {
      await app?.close();
    }
  });

  // ── Ürün ────────────────────────────────────────────────────────────────────

  it('POST /admin/products → 201 AdminProductDetail (price number, category/producer özeti, boş images/lots)', async () => {
    const res = await api('POST', '/admin/products', {
      slug: SLUG_A,
      name: 'Test Ürün A',
      categoryId,
      producerId,
      price: 123.45,
      unit: '500 g',
      description: 'Test açıklaması',
      status: 'DRAFT',
      isFresh: false,
      prefOptions: ['az', 'çok'],
      prefLabel: 'Olgunluk',
      prefDefault: 1,
      extraOptions: [{ factor: 0.5, label: '250 g' }],
      group: '',
    });
    expect(res.status).toBe(201);
    productA = res.body as AdminProductDetail;
    expect(productA.slug).toBe(SLUG_A);
    expect(productA.price).toBe(123.45);
    expect(productA.category).toEqual({ id: categoryId, slug: 'boxes', label: expect.any(String) });
    expect(productA.producer).toEqual({ id: producerId, name: 'Bağdam Çiftlik' });
    expect(productA.images).toEqual([]);
    expect(productA.lots).toEqual([]);
    expect(productA.currentLot).toBeNull();
    expect(productA.group).toBeNull(); // "" → null
    expect(productA.extraOptions).toEqual([{ factor: 0.5, label: '250 g' }]);
    expect(productA.deletedAt).toBeNull();
  });

  it('POST /admin/products aynı slug → 409', async () => {
    const res = await api('POST', '/admin/products', {
      slug: SLUG_A,
      name: 'Kopya',
      categoryId,
      price: 1,
      unit: 'adet',
      description: 'x',
      status: 'DRAFT',
    });
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).message).toMatch(/slug/i);
  });

  it('POST /admin/products geçersiz gövde (categoryId yok, price negatif) → 400', async () => {
    const res = await api('POST', '/admin/products', { slug: 'test-x', name: 'x', price: -1, unit: 'adet', description: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /admin/products olmayan kategori → 404', async () => {
    const res = await api('POST', '/admin/products', {
      slug: `test-nocat-${RUN}`,
      name: 'x',
      categoryId: 'ckolmayan0000000000000000',
      price: 1,
      unit: 'adet',
      description: 'x',
    });
    expect(res.status).toBe(404);
  });

  it('GET /admin/products/:id → detay; GET /admin/products?q= → liste satırı (AdminProductListItem)', async () => {
    const detail = await api('GET', `/admin/products/${productA.id}`);
    expect(detail.status).toBe(200);
    expect((detail.body as AdminProductDetail).id).toBe(productA.id);

    const list = await api('GET', `/admin/products?q=${SLUG_A}&status=DRAFT&page=1&limit=10`);
    expect(list.status).toBe(200);
    const page = list.body as AdminPage<AdminProductListItem>;
    expect(page.page).toBe(1);
    expect(page.limit).toBe(10);
    expect(page.total).toBe(1);
    const row = page.items[0]!;
    expect(row).toMatchObject({ id: productA.id, slug: SLUG_A, categorySlug: 'boxes', producerName: 'Bağdam Çiftlik', price: 123.45, status: 'DRAFT', coverImageUrl: null });
    expect(typeof row.updatedAt).toBe('string');
  });

  it('GET /admin/products?isFresh=false&limit=5 → isFresh filtresi string→boolean', async () => {
    const res = await api('GET', '/admin/products?isFresh=false&limit=5');
    expect(res.status).toBe(200);
    const page = res.body as AdminPage<AdminProductListItem>;
    expect(page.items.length).toBeLessThanOrEqual(5);
    for (const item of page.items) expect(item.isFresh).toBe(false);
  });

  it('PUT /admin/products/:id kısmi güncelleme → 200 (ad/fiyat değişir, diğer alanlar korunur)', async () => {
    const res = await api('PUT', `/admin/products/${productA.id}`, { name: 'Test Ürün A (güncel)', price: 99 });
    expect(res.status).toBe(200);
    const body = res.body as AdminProductDetail;
    expect(body.name).toBe('Test Ürün A (güncel)');
    expect(body.price).toBe(99);
    expect(body.unit).toBe('500 g');
    expect(body.prefOptions).toEqual(['az', 'çok']);
  });

  it('PATCH status/stock/pair → 200', async () => {
    const s = await api('PATCH', `/admin/products/${productA.id}/status`, { status: 'HIDDEN' });
    expect(s.status).toBe(200);
    expect((s.body as AdminProductDetail).status).toBe('HIDDEN');
    const st = await api('PATCH', `/admin/products/${productA.id}/stock`, { stockStatus: 'LOW' });
    expect((st.body as AdminProductDetail).stockStatus).toBe('LOW');
    const p = await api('PATCH', `/admin/products/${productA.id}/pair`, { pairWithBox: true, pairOrder: 7 });
    expect((p.body as AdminProductDetail).pairWithBox).toBe(true);
    expect((p.body as AdminProductDetail).pairOrder).toBe(7);
    const bad = await api('PATCH', `/admin/products/${productA.id}/status`, { status: 'YOK' });
    expect(bad.status).toBe(400);
  });

  // ── Parti ───────────────────────────────────────────────────────────────────

  it('Lots: POST (varsayılan güncel) → ikinci POST güncel olur, ilki değil; PATCH isCurrent ile geri; aynı kod 409; DELETE', async () => {
    const l1 = await api('POST', `/admin/products/${productA.id}/lots`, { lotCode: 'T-01', tastingNote: 'ilk parti', harvestDate: '2026-08-01' });
    expect(l1.status).toBe(201);
    const lot1 = l1.body as AdminProductLot;
    expect(lot1.isCurrent).toBe(true);
    expect(lot1.harvestDate).toBe('2026-08-01');

    const l2 = await api('POST', `/admin/products/${productA.id}/lots`, { lotCode: 'T-02', tastingNote: 'ikinci parti' });
    expect(l2.status).toBe(201);
    const lot2 = l2.body as AdminProductLot;
    expect(lot2.isCurrent).toBe(true);

    let detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.lots.filter((l) => l.isCurrent)).toHaveLength(1);
    expect(detail.currentLot?.id).toBe(lot2.id);

    const dup = await api('POST', `/admin/products/${productA.id}/lots`, { lotCode: 'T-02' });
    expect(dup.status).toBe(409);

    const back = await api('PATCH', `/admin/products/${productA.id}/lots/${lot1.id}`, { isCurrent: true, tastingNote: 'ilk parti (güncel)' });
    expect(back.status).toBe(200);
    detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.currentLot?.id).toBe(lot1.id);
    expect(detail.lots.find((l) => l.id === lot2.id)?.isCurrent).toBe(false);

    const badDate = await api('POST', `/admin/products/${productA.id}/lots`, { lotCode: 'T-03', harvestDate: '2026-02-30' });
    expect(badDate.status).toBe(400);

    // Güncel partiyi silince kalan en yeni parti güncel olur
    const del = await api('DELETE', `/admin/products/${productA.id}/lots/${lot1.id}`);
    expect(del.status).toBe(204);
    detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.lots).toHaveLength(1);
    expect(detail.currentLot?.id).toBe(lot2.id);
  });

  // ── Görsel ──────────────────────────────────────────────────────────────────

  it('Images: ilk görsel otomatik kapak; isCover=true diğerini kaldırır; aynı media 409; reorder; DELETE (MediaFile kalır)', async () => {
    const i1 = await api('POST', `/admin/products/${productA.id}/images`, { mediaId: mediaIds[0], alt: 'birinci' });
    expect(i1.status).toBe(201);
    const img1 = i1.body as AdminProductImage;
    expect(img1.isCover).toBe(true);
    expect(img1.url).toMatch(/^\/(assets|uploads)\//);
    expect(img1.sortOrder).toBe(0);

    const i2 = await api('POST', `/admin/products/${productA.id}/images`, { mediaId: mediaIds[1], isCover: true });
    expect(i2.status).toBe(201);
    const img2 = i2.body as AdminProductImage;
    expect(img2.isCover).toBe(true);
    expect(img2.sortOrder).toBe(1);

    let detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.images.filter((i) => i.isCover)).toHaveLength(1);
    expect(detail.images[0]?.id).toBe(img2.id); // kapak önce

    const dup = await api('POST', `/admin/products/${productA.id}/images`, { mediaId: mediaIds[1] });
    expect(dup.status).toBe(409);
    const missing = await api('POST', `/admin/products/${productA.id}/images`, { mediaId: 'ckolmayan0000000000000000' });
    expect(missing.status).toBe(404);

    const patched = await api('PATCH', `/admin/products/${productA.id}/images/${img1.id}`, { isCover: true, alt: 'yeni alt' });
    expect(patched.status).toBe(200);
    detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.images.find((i) => i.id === img1.id)?.isCover).toBe(true);
    expect(detail.images.find((i) => i.id === img2.id)?.isCover).toBe(false);

    const list = await api('GET', `/admin/products?q=${SLUG_A}`);
    expect((list.body as AdminPage<AdminProductListItem>).items[0]?.coverImageUrl).toBe(img1.url);

    const re = await api('POST', `/admin/products/${productA.id}/images/reorder`, { ids: [img2.id, img1.id] });
    expect(re.status).toBe(200);
    expect(re.body).toEqual({ updated: 2 });
    detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.images.find((i) => i.id === img2.id)?.sortOrder).toBe(0);
    expect(detail.images.find((i) => i.id === img1.id)?.sortOrder).toBe(1);

    // Kapak silinince sıradaki ilk görsel kapak olur; MediaFile silinmez
    const del = await api('DELETE', `/admin/products/${productA.id}/images/${img1.id}`);
    expect(del.status).toBe(204);
    detail = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    expect(detail.images).toHaveLength(1);
    expect(detail.images[0]?.isCover).toBe(true);
    expect(await prisma.mediaFile.findUnique({ where: { id: mediaIds[0]! } })).not.toBeNull();
  });

  // ── Reorder + soft delete ───────────────────────────────────────────────────

  it('POST /admin/products/reorder → sortOrder dizideki sıra; DELETE → soft delete (liste/detayda yok, DB’de deletedAt)', async () => {
    const b = await api('POST', '/admin/products', { slug: SLUG_B, name: 'Test Ürün B', categoryId, price: 5, unit: 'adet', description: 'b', status: 'DRAFT' });
    expect(b.status).toBe(201);
    productB = b.body as AdminProductDetail;

    const re = await api('POST', '/admin/products/reorder', { ids: [productB.id, productA.id] });
    expect(re.status).toBe(200);
    expect(re.body).toEqual({ updated: 2 });
    const a = (await api('GET', `/admin/products/${productA.id}`)).body as AdminProductDetail;
    const bb = (await api('GET', `/admin/products/${productB.id}`)).body as AdminProductDetail;
    expect(bb.sortOrder).toBe(0);
    expect(a.sortOrder).toBe(1);

    const del = await api('DELETE', `/admin/products/${productB.id}`);
    expect(del.status).toBe(204);
    expect((await api('GET', `/admin/products/${productB.id}`)).status).toBe(404);
    const row = await prisma.product.findUnique({ where: { id: productB.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    const list = await api('GET', `/admin/products?q=${SLUG_B}`);
    expect((list.body as AdminPage<AdminProductListItem>).total).toBe(0);
    expect((await api('DELETE', `/admin/products/${productB.id}`)).status).toBe(404);
  });

  // ── Kategori ────────────────────────────────────────────────────────────────

  it('Categories: GET liste (productCount) · PUT (aynı değerlerle geri) · reorder (mevcut sıra)', async () => {
    const list = await api('GET', '/admin/categories');
    expect(list.status).toBe(200);
    const cats = list.body as AdminCategory[];
    expect(cats.length).toBeGreaterThanOrEqual(4);
    const boxes = cats.find((c) => c.slug === 'boxes')!;
    expect(typeof boxes.productCount).toBe('number');

    const put = await api('PUT', `/admin/categories/${boxes.id}`, { label: boxes.label, panelNote: boxes.panelNote, sortOrder: boxes.sortOrder, isActive: boxes.isActive, legacyTab: boxes.legacyTab });
    expect(put.status).toBe(200);
    expect((put.body as AdminCategory).label).toBe(boxes.label);

    const re = await api('POST', '/admin/categories/reorder', { ids: cats.map((c) => c.id) });
    expect(re.status).toBe(200);
    expect((re.body as { updated: number }).updated).toBe(cats.length);
    expect((await api('PUT', '/admin/categories/ckolmayan0000000000000000', { label: 'x' })).status).toBe(404);
  });

  // ── Üretici ─────────────────────────────────────────────────────────────────

  it('Producers: POST (slug addan, Türkçe) → PUT → DELETE (isActive=false) → GET liste', async () => {
    const created = await api('POST', '/admin/producers', { name: `Şükrü Çağlı ${RUN}`, village: 'Ovacık' });
    expect(created.status).toBe(201);
    const prod = created.body as AdminProducer;
    testProducerId = prod.id;
    expect(prod.slug).toBe(`sukru-cagli-${RUN}`);
    expect(prod.district).toBe('Urla');
    expect(prod.productCount).toBe(0);

    const dup = await api('POST', '/admin/producers', { name: 'Kopya', slug: prod.slug });
    expect(dup.status).toBe(409);

    const put = await api('PUT', `/admin/producers/${prod.id}`, { village: 'Kuşçular', story: 'Hikâye' });
    expect(put.status).toBe(200);
    expect((put.body as AdminProducer).village).toBe('Kuşçular');

    const del = await api('DELETE', `/admin/producers/${prod.id}`);
    expect(del.status).toBe(204);
    const got = await api('GET', `/admin/producers/${prod.id}`);
    expect((got.body as AdminProducer).isActive).toBe(false);

    const list = await api('GET', '/admin/producers');
    expect((list.body as AdminProducer[]).some((p) => p.id === prod.id)).toBe(true);
  });

  // ── Tier ────────────────────────────────────────────────────────────────────

  it('Tiers: GET liste · PUT isRecommended=true diğerlerini false yapar (sonra sezon geri alınır)', async () => {
    const list = await api('GET', '/admin/tiers');
    expect(list.status).toBe(200);
    const tiers = list.body as AdminBoxTier[];
    expect(tiers.some((t) => t.slug === TIER_SLUG_1)).toBe(true);
    expect(tiers.find((t) => t.slug === 'sezon')?.isRecommended).toBe(true);

    const put = await api('PUT', `/admin/tiers/${tier1Id}`, { label: 'Test Tier 1 (güncel)', price: 111.5, isRecommended: true });
    expect(put.status).toBe(200);
    expect((put.body as AdminBoxTier).isRecommended).toBe(true);
    expect((put.body as AdminBoxTier).price).toBe(111.5);
    const after = (await api('GET', '/admin/tiers')).body as AdminBoxTier[];
    expect(after.filter((t) => t.isRecommended)).toHaveLength(1);
    expect(after.find((t) => t.slug === 'sezon')?.isRecommended).toBe(false);

    // Seed durumuna geri: sezon önerilen (bootstrap.recommendedTier)
    const restore = await api('PUT', `/admin/tiers/${sezonTierId}`, { isRecommended: true });
    expect(restore.status).toBe(200);
    const final = (await api('GET', '/admin/tiers')).body as AdminBoxTier[];
    expect(final.find((t) => t.slug === 'sezon')?.isRecommended).toBe(true);
    expect(final.find((t) => t.slug === TIER_SLUG_1)?.isRecommended).toBe(false);
  });

  // ── Haftanın kutusu ─────────────────────────────────────────────────────────

  it('Box templates: POST (Salı → Pazartesi) 201 DRAFT · aynı tier+hafta 409 · PUT items · publish · clone-next-week · liste/box-week · DELETE kuralları', async () => {
    const fresh = await prisma.product.findMany({ where: { deletedAt: null, isFresh: true, status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' }, take: 3 });
    expect(fresh.length).toBeGreaterThanOrEqual(3);
    const [p1, p2, p3] = fresh as [typeof fresh[number], typeof fresh[number], typeof fresh[number]];

    const created = await api('POST', '/admin/box-templates', {
      tierId: tier1Id,
      weekStart: FAR_WEEK,
      curatorName: 'Test Küratör',
      items: [
        { productId: p1.id, qtyLabel: '1 kg' },
        { productId: p2.id, qtyLabel: '2 demet', isSwappable: false },
      ],
    });
    expect(created.status).toBe(201);
    const tpl = created.body as AdminBoxTemplate;
    templateId = tpl.id;
    expect(tpl.weekStart).toBe(FAR_MONDAY);
    expect(tpl.status).toBe('DRAFT');
    expect(tpl.tierSlug).toBe(TIER_SLUG_1);
    expect(tpl.itemCount).toBe(2);
    expect(tpl.items.map((i) => [i.productSlug, i.qtyLabel, i.isSwappable, i.sortOrder])).toEqual([
      [p1.slug, '1 kg', true, 0],
      [p2.slug, '2 demet', false, 1],
    ]);

    const dup = await api('POST', '/admin/box-templates', { tierId: tier1Id, weekStart: FAR_MONDAY, items: [] });
    expect(dup.status).toBe(409);

    const dupItem = await api('PUT', `/admin/box-templates/${tpl.id}`, { items: [{ productId: p1.id, qtyLabel: 'a' }, { productId: p1.id, qtyLabel: 'b' }] });
    expect(dupItem.status).toBe(400);

    const put = await api('PUT', `/admin/box-templates/${tpl.id}`, { curatorName: 'Küratör 2', items: [{ productId: p3.id, qtyLabel: '500 g' }, { productId: p1.id, qtyLabel: '1 kg' }] });
    expect(put.status).toBe(200);
    const updated = put.body as AdminBoxTemplate;
    expect(updated.curatorName).toBe('Küratör 2');
    expect(updated.items.map((i) => i.productSlug)).toEqual([p3.slug, p1.slug]);
    expect(updated.warning).toBeUndefined();

    const pub = await api('POST', `/admin/box-templates/${tpl.id}/publish`);
    expect(pub.status).toBe(200);
    expect((pub.body as AdminBoxTemplate).status).toBe('PUBLISHED');

    // Yayındayken öğe değişimi: izinli ama warning döner
    const putPub = await api('PUT', `/admin/box-templates/${tpl.id}`, { items: [{ productId: p2.id, qtyLabel: '1 demet' }] });
    expect(putPub.status).toBe(200);
    expect(typeof (putPub.body as AdminBoxTemplate).warning).toBe('string');

    // Yayındaki şablon silinemez
    expect((await api('DELETE', `/admin/box-templates/${tpl.id}`)).status).toBe(409);

    // Gelecek haftaya kopya → DRAFT, +7 gün, aynı öğeler
    const clone = await api('POST', `/admin/box-templates/${tpl.id}/clone-next-week`);
    expect(clone.status).toBe(201);
    const cloned = clone.body as AdminBoxTemplate;
    clonedId = cloned.id;
    expect(cloned.weekStart).toBe(FAR_NEXT_MONDAY);
    expect(cloned.status).toBe('DRAFT');
    expect(cloned.items.map((i) => i.productSlug)).toEqual([p2.slug]);
    expect((await api('POST', `/admin/box-templates/${tpl.id}/clone-next-week`)).status).toBe(409);

    // Publish tekilliği: aynı tier + hafta içinde (Çarşamba tarihli ikinci satır) yayınlanınca ilki DRAFT'a iner
    const wednesday = await prisma.boxTemplate.create({
      data: { tierId: tier1Id, weekStart: new Date('2099-01-07T00:00:00.000Z'), status: 'DRAFT', items: { create: [{ productId: p1.id, qtyLabel: '1 kg', sortOrder: 0 }] } },
    });
    const pub2 = await api('POST', `/admin/box-templates/${wednesday.id}/publish`);
    expect(pub2.status).toBe(200);
    const firstAgain = (await api('GET', `/admin/box-templates/${tpl.id}`)).body as AdminBoxTemplate;
    expect(firstAgain.status).toBe('DRAFT');
    const allWeek = await prisma.boxTemplate.findMany({ where: { tierId: tier1Id, status: 'PUBLISHED' } });
    expect(allWeek.map((t) => t.id)).toEqual([wednesday.id]);

    // Boş şablon yayınlanamaz
    const empty = await api('POST', '/admin/box-templates', { tierId: tier2Id, weekStart: FAR_MONDAY, items: [] });
    expect(empty.status).toBe(201);
    expect((await api('POST', `/admin/box-templates/${(empty.body as AdminBoxTemplate).id}/publish`)).status).toBe(400);

    // Liste filtreleri
    const list = await api('GET', `/admin/box-templates?tierId=${tier1Id}&from=${FAR_MONDAY}&to=${FAR_NEXT_MONDAY}`);
    expect(list.status).toBe(200);
    const rows = list.body as AdminBoxTemplate[];
    expect(rows.map((r) => r.id).sort()).toEqual([tpl.id, cloned.id, wednesday.id].sort());
    expect(rows.every((r) => r.tierId === tier1Id)).toBe(true);

    // box-week: tier başına o haftanın şablonu (yayındaki öncelikli) + fresh havuz
    const week = await api('GET', `/admin/box-week?week=${FAR_WEEK}`);
    expect(week.status).toBe(200);
    const bw = week.body as AdminBoxWeek;
    expect(bw.weekStart).toBe(FAR_MONDAY);
    const t1 = bw.tiers.find((t) => t.tier.id === tier1Id)!;
    expect(t1.template?.id).toBe(wednesday.id);
    const t2 = bw.tiers.find((t) => t.tier.id === tier2Id)!;
    expect(t2.template?.status).toBe('DRAFT');
    const sezon = bw.tiers.find((t) => t.tier.slug === 'sezon')!;
    expect(sezon.template).toBeNull();
    expect(bw.pool.length).toBeGreaterThan(0);
    expect(bw.pool.some((p) => p.slug === p1.slug)).toBe(true);
    expect((await api('GET', '/admin/box-week?week=2026-02-30')).status).toBe(400);

    // DRAFT silinir
    expect((await api('DELETE', `/admin/box-templates/${cloned.id}`)).status).toBe(204);
    expect((await api('GET', `/admin/box-templates/${cloned.id}`)).status).toBe(404);
  });

  it('Bootstrap cache mutasyon sonrası düşer (public tiers listesi DB’den okunur)', async () => {
    // Public katalog uçları DB'den doğrudan okur; bootstrap cache'i invalidate sonrası yeniden kurulur.
    const res = await fetch(`${baseUrl}/api/v1/bootstrap`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tiers: Array<{ id: string }>; recommendedTier: string };
    expect(body.tiers.map((t) => t.id)).toEqual(['small', 'sezon']); // test tier'ları pasif → yok
    expect(body.recommendedTier).toBe('sezon');
  });
});
