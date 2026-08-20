// database/seeds/convert-products-js.ts — website/assets/products.js (+ kutu.html, urunler.html) → database/data/*.json
//
// Çalıştır: pnpm tsx database/seeds/convert-products-js.ts
// Deterministik ve yeniden çalıştırılabilir: aynı kaynaklardan her zaman bayt-bayt aynı JSON üretir
// (zaman damgası yok; değişiklik olmayınca dosya "değişmedi" diye raporlanır).
//
// Kaynaklar (F3'e kadar tek doğruluk kaynağı olan statik prototip):
//   - products.js → PRODUCTS, SUB_TIERS, FREQ_OPTIONS, DELIVERY_DAYS, DELIVERY_FEE  (vm ile çalıştırılır)
//     (sabitler products.js'te yoksa cart.js'ten regex+vm ile aranır)
//   - kutu.html   → pairIds (kutuya eşlik eden ürünler, sıralı)
//   - urunler.html → sekmeler (data-tab, etiket, ikon) + panel notları (satır 86/92/98)
//
// Eşlemeler (docs/BACKEND-PLANI.md [B6]):
//   products.js tab  pantry → Category cellar · dairy → dairy · firin → firin ; fresh:true ürünlerde tab YOK → boxes
//   Category.legacyTab = bu eşlemenin tersi (cellar→"pantry", dairy, firin, boxes→null)
//   Product.group = products.js category (meyve|sebze|bakliyat|süt ürünleri|fırın) · Product.slug = products.js id
//   meta "Üretici · Köy · Urla[ — not]" → Producer(name, village, district) + Product.metaNote
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { relative } from 'path';
import * as vm from 'vm';
import { parseMeta } from './lib/meta';
import { CART_JS, CATALOG_JSON, DATA_DIR, KUTU_HTML, PRODUCERS_JSON, PRODUCTS_JS, REPO_ROOT, URUNLER_HTML } from './lib/paths';
import { slugify } from './lib/slug';
import type {
  CatalogCategory,
  CatalogJson,
  CatalogProduct,
  ProducerJson,
  RawDeliveryDay,
  RawFreqOption,
  RawProduct,
  RawTier,
} from './lib/types';

// ── Sabit eşlemeler ──────────────────────────────────────────────────────────

/** Category.slug → bootstrap product.tab (legacyTab). Yeni bir sekme eklenirse burada karar gerekir. */
const CATEGORY_LEGACY_TAB: Record<string, 'pantry' | 'dairy' | 'firin' | null> = {
  boxes: null,
  dairy: 'dairy',
  firin: 'firin',
  cellar: 'pantry',
};
/** products.js tab → Category.slug (yukarıdakinin tersi). */
const TAB_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_LEGACY_TAB)
    .filter(([, tab]) => tab !== null)
    .map(([slug, tab]) => [tab as string, slug]),
);
/** Fresh (kutu havuzu) ürünlerin kategorisi. */
const FRESH_CATEGORY = 'boxes';
/** kutu.html'de pairIds bulunamazsa kullanılacak yedek (kutu.html:469). */
const PAIR_IDS_FALLBACK = ['ekmek', 'zeytinyagi', 'beyazpeynir', 'tereyagi'];

const CONST_NAMES = ['PRODUCTS', 'SUB_TIERS', 'FREQ_OPTIONS', 'DELIVERY_DAYS', 'DELIVERY_FEE'] as const;
type ConstName = (typeof CONST_NAMES)[number];

// ── Yardımcılar ──────────────────────────────────────────────────────────────

function rel(p: string): string {
  return relative(REPO_ROOT, p).replace(/\\/g, '/');
}

/** Bir script dosyasını boş bir vm bağlamında çalıştırıp üst düzey const'ları döndürür (tanımsızlar undefined). */
function evalTopLevelConsts(src: string, filename: string): Partial<Record<ConstName, unknown>> {
  const tail =
    '\n;({' + CONST_NAMES.map((n) => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(', ') + '})';
  const ctx = vm.createContext({});
  const out = vm.runInContext(src + tail, ctx, { filename, timeout: 5000 }) as Partial<Record<ConstName, unknown>>;
  // vm bağlamındaki nesneleri ana bağlama kopyala (JSON round-trip; products.js saf veri içerir)
  return JSON.parse(JSON.stringify(out ?? {})) as Partial<Record<ConstName, unknown>>;
}

/**
 * Tarayıcıya bağımlı bir dosyadan (cart.js) tek bir `const NAME = <ifade>;` bloğunu regex ile kesip
 * vm'de değerlendirir. Dizi/sayı ifadeleri için yeterli; yoksa undefined.
 */
function evalConstByRegex(src: string, name: ConstName, filename: string): unknown {
  const re = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([\\s\\S]*?);[ \\t]*(?:\\/\\/[^\\n]*)?\\n`);
  const m = re.exec(src);
  if (!m || !m[1]) return undefined;
  const value = vm.runInNewContext('(' + m[1] + ')', {}, { filename: `${filename}#${name}`, timeout: 2000 });
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** JSON'u yalnız içerik değiştiyse yazar; durum mesajı döner. */
function writeJsonIfChanged(file: string, data: unknown): 'yazıldı' | 'değişmedi' {
  const next = JSON.stringify(data, null, 2) + '\n';
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (prev === next) return 'değişmedi';
  writeFileSync(file, next, 'utf8');
  return 'yazıldı';
}

// ── Kaynak okuma ─────────────────────────────────────────────────────────────

function loadConstants(): {
  products: RawProduct[];
  tiers: RawTier[];
  freqOptions: RawFreqOption[];
  deliveryDays: RawDeliveryDay[];
  deliveryFee: number;
  origin: Record<ConstName, string>;
} {
  const productsSrc = readFileSync(PRODUCTS_JS, 'utf8');
  const fromProducts = evalTopLevelConsts(productsSrc, PRODUCTS_JS);
  const origin = {} as Record<ConstName, string>;
  const values: Partial<Record<ConstName, unknown>> = {};
  let cartSrc: string | null = null;

  for (const name of CONST_NAMES) {
    if (fromProducts[name] !== undefined) {
      values[name] = fromProducts[name];
      origin[name] = rel(PRODUCTS_JS);
      continue;
    }
    // Yedek: cart.js'ten regex+vm (tarayıcı API'si gerektirdiği için dosya bütün olarak çalıştırılamaz)
    cartSrc ??= readFileSync(CART_JS, 'utf8');
    const v = evalConstByRegex(cartSrc, name, CART_JS);
    assert(v !== undefined, `${name} ne products.js'te ne cart.js'te bulundu`);
    values[name] = v;
    origin[name] = rel(CART_JS);
  }

  const products = values.PRODUCTS as RawProduct[];
  const tiers = values.SUB_TIERS as RawTier[];
  const freqOptions = values.FREQ_OPTIONS as RawFreqOption[];
  const deliveryDays = values.DELIVERY_DAYS as RawDeliveryDay[];
  const deliveryFee = values.DELIVERY_FEE as number;
  assert(Array.isArray(products) && products.length > 0, 'PRODUCTS boş');
  assert(Array.isArray(tiers) && tiers.length > 0, 'SUB_TIERS boş');
  assert(Array.isArray(freqOptions) && freqOptions.length > 0, 'FREQ_OPTIONS boş');
  assert(Array.isArray(deliveryDays) && deliveryDays.length > 0, 'DELIVERY_DAYS boş');
  assert(typeof deliveryFee === 'number' && Number.isFinite(deliveryFee), 'DELIVERY_FEE sayı değil');
  return { products, tiers, freqOptions, deliveryDays, deliveryFee, origin };
}

function loadPairIds(): string[] {
  const html = readFileSync(KUTU_HTML, 'utf8');
  const m = /const\s+pairIds\s*=\s*(\[[^\]]*\])/.exec(html);
  if (!m || !m[1]) {
    console.warn('  UYARI: kutu.html içinde pairIds bulunamadı — yedek liste kullanılıyor');
    return [...PAIR_IDS_FALLBACK];
  }
  const ids = vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 1000 }) as unknown;
  assert(Array.isArray(ids) && ids.every((x) => typeof x === 'string'), 'kutu.html pairIds dizi değil');
  return [...(ids as string[])];
}

function loadCategories(): CatalogCategory[] {
  const html = readFileSync(URUNLER_HTML, 'utf8');
  const tabRe = /<button[^>]*class="prod-tab[^"]*"[^>]*data-tab="([a-z]+)"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/button>/g;
  const noteRe = /<section class="prod-panel" id="panel-([a-z]+)"[^>]*>\s*<p class="prod-panel-note">([^<]+)<\/p>/g;

  const notes = new Map<string, string>();
  for (let m = noteRe.exec(html); m; m = noteRe.exec(html)) {
    notes.set(m[1] as string, decodeEntities(m[2] as string));
  }

  const categories: CatalogCategory[] = [];
  for (let m = tabRe.exec(html); m; m = tabRe.exec(html)) {
    const slug = m[1] as string;
    assert(slug in CATEGORY_LEGACY_TAB, `urunler.html'de bilinmeyen sekme: data-tab="${slug}" — CATEGORY_LEGACY_TAB'a karar ekleyin`);
    categories.push({
      slug,
      label: decodeEntities(m[3] as string),
      icon: (m[2] as string).trim(),
      panelNote: notes.get(slug) ?? null,
      legacyTab: CATEGORY_LEGACY_TAB[slug] ?? null,
      sortOrder: categories.length,
    });
  }
  assert(categories.length > 0, 'urunler.html içinde sekme (prod-tab) bulunamadı');
  for (const slug of Object.keys(CATEGORY_LEGACY_TAB)) {
    assert(categories.some((c) => c.slug === slug), `urunler.html'de beklenen sekme yok: ${slug}`);
  }
  return categories;
}

// ── Dönüşüm ──────────────────────────────────────────────────────────────────

function buildCatalog(): { catalog: CatalogJson; producers: ProducerJson[] } {
  const { products, tiers, freqOptions, deliveryDays, deliveryFee, origin } = loadConstants();
  const categories = loadCategories();
  const pairIds = loadPairIds();
  const categorySlugs = new Set(categories.map((c) => c.slug));

  const producers: ProducerJson[] = [];
  const producerBySlug = new Map<string, ProducerJson>();
  const seenIds = new Set<string>();
  const catalogProducts: CatalogProduct[] = [];

  products.forEach((raw, index) => {
    // Temel doğrulamalar — products.js'teki bir bozulma sessizce DB'ye akmasın
    assert(typeof raw.id === 'string' && raw.id, `PRODUCTS[${index}].id yok`);
    assert(!seenIds.has(raw.id), `products.js id tekrarı: ${raw.id}`);
    seenIds.add(raw.id);
    assert(typeof raw.name === 'string' && raw.name, `${raw.id}: name yok`);
    assert(typeof raw.price === 'number' && Number.isFinite(raw.price), `${raw.id}: price sayı değil`);
    assert(typeof raw.unit === 'string' && raw.unit, `${raw.id}: unit yok`);
    assert(typeof raw.img === 'string' && raw.img, `${raw.id}: img yok`);
    assert(typeof raw.batch === 'string' && raw.batch, `${raw.id}: batch yok`);
    assert(typeof raw.fresh === 'boolean', `${raw.id}: fresh boolean değil`);
    assert(slugify(raw.id) === raw.id, `${raw.id}: id URL-güvenli slug değil`);

    let categorySlug: string;
    if (raw.fresh) {
      assert(raw.tab === undefined, `${raw.id}: fresh ürünün tab alanı olmamalı (${String(raw.tab)})`);
      categorySlug = FRESH_CATEGORY;
    } else {
      assert(raw.tab !== undefined, `${raw.id}: fresh olmayan ürünün tab alanı yok`);
      const mapped = TAB_TO_CATEGORY[raw.tab];
      assert(mapped, `${raw.id}: bilinmeyen tab "${raw.tab}"`);
      categorySlug = mapped;
    }
    assert(categorySlugs.has(categorySlug), `${raw.id}: kategori ${categorySlug} urunler.html'de yok`);

    const meta = parseMeta(raw.meta, raw.id);
    // Çapraz kontrol: location = "Köy · İlçe" ile tutarlı mı (yalnız uyarı)
    const expectedLocation = [meta.village, meta.district].filter(Boolean).join(' · ');
    if (raw.location && raw.location !== expectedLocation) {
      console.warn(`  UYARI: ${raw.id}: location "${raw.location}" ile meta "${expectedLocation}" uyuşmuyor`);
    }

    const producerSlug = slugify(meta.producerName);
    let producer = producerBySlug.get(producerSlug);
    if (!producer) {
      producer = {
        slug: producerSlug,
        name: meta.producerName,
        village: meta.village,
        district: meta.district,
        sortOrder: producers.length,
        productSlugs: [],
      };
      producers.push(producer);
      producerBySlug.set(producerSlug, producer);
    } else if (producer.village !== meta.village || producer.district !== meta.district) {
      console.warn(
        `  UYARI: üretici "${meta.producerName}" farklı köy/ilçe ile geçiyor (${producer.village ?? '-'} / ${producer.district} ≠ ${meta.village ?? '-'} / ${meta.district}); ilk görünüş korunuyor`,
      );
    }
    producer.productSlugs.push(raw.id);

    const pairOrder = pairIds.indexOf(raw.id);
    catalogProducts.push({
      ...raw,
      slug: raw.id,
      categorySlug,
      group: raw.category,
      producerSlug,
      village: meta.village,
      district: meta.district,
      metaNote: meta.metaNote,
      pairWithBox: pairOrder !== -1,
      pairOrder: pairOrder === -1 ? 0 : pairOrder,
      sortOrder: index,
    });
  });

  for (const id of pairIds) {
    assert(seenIds.has(id), `kutu.html pairIds içindeki "${id}" products.js'te yok`);
    const p = catalogProducts.find((x) => x.id === id);
    assert(p && !p.fresh, `pairIds "${id}" fresh ürün olamaz (fresh tekil satılmaz, ADR-0008)`);
  }

  const catalog: CatalogJson = {
    $comment:
      'ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: website/assets/products.js (+ kutu.html pairIds, urunler.html sekmeleri). ' +
      'Yeniden üret: pnpm tsx database/seeds/convert-products-js.ts. Ham products.js alanları birebir korunur; ' +
      'slug/categorySlug/group/producerSlug/village/district/metaNote/pairWithBox/pairOrder/sortOrder seed türetmeleridir.',
    source: {
      PRODUCTS: origin.PRODUCTS,
      SUB_TIERS: origin.SUB_TIERS,
      FREQ_OPTIONS: origin.FREQ_OPTIONS,
      DELIVERY_DAYS: origin.DELIVERY_DAYS,
      DELIVERY_FEE: origin.DELIVERY_FEE,
      pairIds: rel(KUTU_HTML),
      categories: rel(URUNLER_HTML),
    },
    categories,
    products: catalogProducts,
    tiers,
    freqOptions,
    deliveryDays,
    deliveryFee,
    pairIds,
  };
  return { catalog, producers };
}

// ── Giriş ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('convert-products-js: kaynaklar okunuyor…');
  const { catalog, producers } = buildCatalog();
  mkdirSync(DATA_DIR, { recursive: true });
  const r1 = writeJsonIfChanged(CATALOG_JSON, catalog);
  const r2 = writeJsonIfChanged(PRODUCERS_JSON, producers);
  const fresh = catalog.products.filter((p) => p.fresh).length;
  console.log(
    `  ${rel(CATALOG_JSON)} ${r1}: ${catalog.products.length} ürün (${fresh} fresh), ` +
      `${catalog.categories.length} kategori, ${catalog.tiers.length} tier, ${catalog.freqOptions.length} sıklık, ` +
      `${catalog.deliveryDays.length} teslimat günü, kargo ${catalog.deliveryFee}, pairIds ${catalog.pairIds.length}`,
  );
  console.log(`  ${rel(PRODUCERS_JSON)} ${r2}: ${producers.length} üretici`);
}

try {
  main();
} catch (err) {
  console.error('convert-products-js HATA:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
