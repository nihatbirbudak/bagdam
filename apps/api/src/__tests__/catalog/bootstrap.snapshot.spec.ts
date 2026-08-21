// F3 snapshot testi — CatalogService.getBootstrap() çıktısı ile website/assets/products.js ALAN ALAN karşılaştırılır.
// products.js DOĞRULUK KAYNAĞIDIR (YOL-HARITASI F3, BACKEND-PLANI §1.2 [B6][B21]); fark çıkarsa mapper/veri düzeltilir.
// Gerçek (seed'li) DB gerekir: DATABASE_URL yoksa test FAIL eder (skip değil).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  COMMERCE_SETTINGS_DEFAULTS,
  DEFAULT_TZ,
  DELIVERY_DAY_META,
  addCalendarDays,
  calendarDateIn,
  deliveryDayFromSlug,
  weekdayOf,
  type BootstrapCommerce,
  type BootstrapMe,
  type BootstrapPayload,
  type BootstrapProduct,
  type BootstrapSub,
} from '@bagdam/shared';
import { PrismaModule } from '../../common/prisma.module';
import { BOOTSTRAP_DELIVERY_WEEKS } from '../../modules/catalog/catalog.constants';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CatalogService } from '../../modules/catalog/catalog.service';
import { requireDatabaseUrl } from '../helpers/env';
import { loadPrototype } from '../helpers/prototype';

jest.setTimeout(60_000);

// Prototip verisi senkron okunur (describe.each tabloları tanım anında gerekir); dosya yoksa test dosyası FAIL.
const proto = loadPrototype();
const EXPECTED_PRODUCT_COUNT = 22;

describe('CatalogService.getBootstrap — products.js snapshot paritesi (F3)', () => {
  let moduleRef: TestingModule;
  let service: CatalogService;
  let payload: BootstrapPayload;

  const findProduct = (id: string): BootstrapProduct => {
    const p = payload.products.find((x) => x.id === id);
    if (!p) throw new Error(`bootstrap.products içinde "${id}" yok`);
    return p;
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, CatalogModule],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(CatalogService);
    payload = await service.getBootstrap();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // ── PRODUCTS ───────────────────────────────────────────────────────────────

  it(`products: ${EXPECTED_PRODUCT_COUNT} ürün, products.js ile aynı id sırası`, () => {
    expect(proto.PRODUCTS).toHaveLength(EXPECTED_PRODUCT_COUNT);
    expect(payload.products).toHaveLength(EXPECTED_PRODUCT_COUNT);
    expect(payload.products.map((p) => p.id)).toEqual(proto.PRODUCTS.map((p) => p.id));
  });

  describe.each(proto.PRODUCTS.map((p) => [p.id, p] as const))('ürün "%s"', (id, expected) => {
    it('alan adları ve SIRASI products.js ile birebir (boş/ek alan yok)', () => {
      expect(Object.keys(findProduct(id))).toEqual(Object.keys(expected));
    });

    it('alan değerleri deepEqual (price number · pref nesne|null · fresh boolean · images/season/tab yalnız varsa)', () => {
      const actual = findProduct(id);
      expect(actual).toStrictEqual(expected);
      expect(typeof actual.price).toBe('number');
      expect(typeof actual.fresh).toBe('boolean');
      if (expected.pref === null) {
        expect(actual.pref).toBeNull();
      } else {
        expect(actual.pref).toEqual({ label: expect.any(String), options: expect.any(Array), def: expect.any(Number) });
      }
      if ('images' in expected) {
        expect(actual.images?.length).toBeGreaterThan(1);
        expect(actual.images?.[0]).toBe(actual.img);
      } else {
        expect('images' in actual).toBe(false);
      }
      if (expected.fresh) {
        expect('tab' in actual).toBe(false);
      } else {
        expect('season' in actual).toBe(false);
      }
    });
  });

  // ── SUB_TIERS / FREQ_OPTIONS / DELIVERY_DAYS / DELIVERY_FEE ────────────────

  it('tiers == SUB_TIERS (id/label/count/price/note/img)', () => {
    expect(payload.tiers).toStrictEqual(proto.SUB_TIERS);
  });

  it('freqOptions == FREQ_OPTIONS ({id,label,note:"seçtiğin gün",allDays:false})', () => {
    expect(payload.freqOptions).toStrictEqual(proto.FREQ_OPTIONS);
  });

  it('deliveryDays == DELIVERY_DAYS ({id,label})', () => {
    expect(payload.deliveryDays).toStrictEqual(proto.DELIVERY_DAYS);
  });

  it('deliveryFee == DELIVERY_FEE (number)', () => {
    expect(typeof payload.deliveryFee).toBe('number');
    expect(payload.deliveryFee).toBe(proto.DELIVERY_FEE);
  });

  // ── Bootstrap'a özgü alanlar ───────────────────────────────────────────────

  it('pool: fresh ürün id’leri products.js sırasıyla', () => {
    expect(payload.pool).toEqual(proto.PRODUCTS.filter((p) => p.fresh).map((p) => p.id));
  });

  it('pairIds == kutu.html pairIds (pairOrder sırası)', () => {
    expect(payload.pairIds).toEqual(proto.pairIds);
  });

  it('recommendedTier == urunler.html RECOMMENDED_TIER', () => {
    expect(payload.recommendedTier).toBe(proto.recommendedTier);
  });

  it('templates: yayınlanmış şablonlar tier id’siyle; öğeler pool içinde, tekil, tier.count’u aşmaz', () => {
    const tierIds = payload.tiers.map((t) => t.id);
    expect(Object.keys(payload.templates).sort()).toEqual([...tierIds].sort()); // seed: bu haftanın small+sezon şablonu PUBLISHED
    for (const [tierId, slugs] of Object.entries(payload.templates)) {
      const tier = payload.tiers.find((t) => t.id === tierId);
      expect(tier).toBeDefined();
      expect(slugs.length).toBeGreaterThan(0);
      expect(slugs.length).toBeLessThanOrEqual(tier?.count ?? 0);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(payload.pool).toContain(slug);
    }
  });

  it(`deliveryDates: varsayılan bölge, bugünden ${BOOTSTRAP_DELIVERY_WEEKS} hafta, {day,date,cutoffAtIso,locked,full} şekli, tarih sıralı`, () => {
    const now = new Date();
    const today = calendarDateIn(now, DEFAULT_TZ);
    const horizonEnd = addCalendarDays(today, BOOTSTRAP_DELIVERY_WEEKS * 7);
    expect(payload.deliveryDates.length).toBeGreaterThan(0);
    expect(payload.deliveryDates.length).toBeLessThanOrEqual(BOOTSTRAP_DELIVERY_WEEKS * proto.DELIVERY_DAYS.length);
    let prev = '';
    for (const d of payload.deliveryDates) {
      expect(Object.keys(d)).toEqual(['day', 'date', 'cutoffAtIso', 'locked', 'full']);
      const day = deliveryDayFromSlug(d.day);
      expect(day).not.toBeNull();
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(weekdayOf(d.date)).toBe(DELIVERY_DAY_META[day!].dow);
      expect(d.date >= today && d.date < horizonEnd).toBe(true);
      expect(new Date(d.cutoffAtIso).toISOString()).toBe(d.cutoffAtIso);
      expect(typeof d.locked).toBe('boolean');
      expect(typeof d.full).toBe('boolean');
      expect(d.date > prev).toBe(true);
      prev = d.date;
    }
  });

  it('commerce: CommerceSettings alanları + zone freeThreshold/deliveryFee; freq/day listeleri aynı kaynaktan', () => {
    const commerce = payload.commerce as BootstrapCommerce;
    for (const key of Object.keys(COMMERCE_SETTINGS_DEFAULTS)) expect(commerce).toHaveProperty(key);
    expect(commerce.deliveryFee).toBe(payload.deliveryFee);
    expect(commerce.freeThreshold === null || typeof commerce.freeThreshold === 'number').toBe(true);
    expect(payload.freqOptions.map((f) => f.id)).toEqual(commerce.frequencies.map((f) => f.id));
    expect(payload.deliveryDays.map((d) => d.id)).toEqual(commerce.deliveryDays.map((d) => d.id));
  });

  it('me/sub: anonimde null; parametre verilince geçer; cache’teki anonim yük değişmez', async () => {
    expect(payload.me).toBeNull();
    expect(payload.sub).toBeNull();
    const me: BootstrapMe = { loggedIn: true, id: 'u_test', email: 'test@example.com', name: null };
    const sub = { id: 'sub_test', purchased: true, active: false } as unknown as BootstrapSub;
    const personal = await service.getBootstrap({ me, sub });
    expect(personal.me).toEqual(me);
    expect(personal.sub).toBe(sub);
    expect(personal.products).toEqual(payload.products);
    const anonymous = await service.getBootstrap();
    expect(anonymous.me).toBeNull();
    expect(anonymous.sub).toBeNull();
    // F9 [B49]: serverNow cache'lenmez — her yanıtta taze mutlak ISO an
    expect(Number.isNaN(Date.parse(anonymous.serverNow))).toBe(false);
    expect(Date.parse(anonymous.serverNow)).toBeGreaterThanOrEqual(Date.parse(personal.serverNow));
  });

  it('buildBootstrap (cache’siz) katalog kısmı cache’li çıktıyla aynı', async () => {
    const fresh = await service.buildBootstrap();
    expect(fresh.products).toEqual(payload.products);
    expect(fresh.tiers).toEqual(payload.tiers);
    expect(fresh.templates).toEqual(payload.templates);
    expect(fresh.pool).toEqual(payload.pool);
    expect(fresh.pairIds).toEqual(payload.pairIds);
    expect(fresh.commerce).toEqual(payload.commerce);
  });
});
