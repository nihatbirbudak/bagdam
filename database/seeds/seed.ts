// database/seeds/seed.ts — F2 katalog + ayar + admin seed'i (docs/BACKEND-PLANI.md §5 F2, YOL-HARITASI F2)
//
// Çalıştır: pnpm db:seed   (= tsx database/seeds/seed.ts; prisma migrate reset de çağırır)
// Girdi:   database/data/catalog.json + producers.json (convert-products-js.ts üretir — önce onu çalıştırın)
// Ortam:   apps/api/.env → kök .env (DATABASE_URL zorunlu; SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD isteğe bağlı)
//
// İDEMPOTENT — tekrar çalıştırınca kayıt çoğaltmaz (slug/key/unique ile upsert). Politika:
//   - Katalog (Category, Producer, Product, ProductImage, ProductLot, MediaFile, BoxTier, BoxTemplate):
//     seed'in sahip olduğu alanlar her çalıştırmada seed değerine çekilir (F3 bootstrap paritesi için products.js
//     tek kaynak); admin'in eklediği BAŞKA satırlar dokunulmaz. id'ler korunur.
//   - DeliveryZone: yoksa oluşturulur; varsa yalnız name/sortOrder eşitlenir (fee/freeThreshold/capacity admin'in).
//   - DeliveryDate: (zone, date) yoksa oluşturulur; varsa yalnız day/cutoffAt tazelenir (reserved/capacity/status korunur).
//   - Setting / SiteContent: yalnız yoksa oluşturulur (panelden yapılan değişiklikler ezilmez);
//     SEED_OVERWRITE_SETTINGS=true ile seed değerlerine zorla çekilir (yalnız lokal/CI için).
//   - Admin User: yoksa oluşturulur; varsa rol/aktiflik/doğrulama eşitlenir, parola env'dekine göre gerekiyorsa güncellenir.
//
// Gizli anahtar (mail.smtp, sms.netgsm, iyzico anahtarları) SEED'E KONMAZ [B33]; LegalDocument/Post/diğer
// SiteContent blokları F5 içerik seed'inde; görsellerin tamamı (58) F4 media:import'ta.
import './lib/load-env';

import {
  ContentStatus,
  DeliveryDateStatus,
  DeliveryDay,
  Prisma,
  PrismaClient,
  ProductStatus,
  StockStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, readFileSync } from 'fs';
import { relative } from 'path';
import {
  COMMERCE_SETTINGS_DEFAULTS,
  DEFAULT_TZ,
  DeliveryDay as SharedDeliveryDay,
  addCalendarDays,
  calendarDateIn,
  isoDateToUtc,
  nextDeliveryDates,
  weekdayOf,
} from '../../packages/shared/src/index';
import { assertDatabaseUrl } from './lib/load-env';
import { imageFileInfo } from './lib/media';
import { CATALOG_JSON, PRODUCERS_JSON, REPO_ROOT } from './lib/paths';
import type { CatalogJson, CatalogProduct, ProducerJson } from './lib/types';

const prisma = new PrismaClient();

// ── Sabitler (kaynakları yorumda) ────────────────────────────────────────────

/** Ücretsiz kargo eşiği — ADR-0005, sepet.html:573, politikalar.html:117 (yalnız DeliveryZone'da tutulur [B11]). */
const FREE_SHIPPING_THRESHOLD = 1000;
/** DeliveryZone varsayılan günlük kapasite — fiilen sınırsız [B9]. */
const DEFAULT_CAPACITY_PER_DAY = 999;
/** urunler.html:208 RECOMMENDED_TIER = "sezon" ("en çok tercih edilen" rozeti). */
const RECOMMENDED_TIER_SLUG = 'sezon';
/** Teslimat bölgeleri — ADR-0005 (Urla, Çeşme; kendi kurye). */
const ZONES = [
  { slug: 'urla', name: 'Urla', sortOrder: 0 },
  { slug: 'cesme', name: 'Çeşme', sortOrder: 1 },
] as const;
const ALL_DELIVERY_DAYS = Object.values(SharedDeliveryDay);
/** bcrypt maliyeti (apps/api AuthModule ile aynı). */
const BCRYPT_ROUNDS = 12;
/** true → Setting/SiteContent satırları seed değerine zorla çekilir (panel değişiklikleri ezilir; yalnız lokal/CI). */
const OVERWRITE_SETTINGS = process.env.SEED_OVERWRITE_SETTINGS === 'true';

/** Sayfa başlıkları — apps/api/views/*.hbs <title> (Setting seo.<sayfa> = {title}). */
const SEO_TITLES: Record<string, string> = {
  index: "Bağdam — Urla'dan sofrana",
  urunler: 'Bağdam — ürünler',
  kutu: 'Bağdam — kutu',
  urun: 'Bağdam — ürün',
  sepet: 'Bağdam — sepet',
  uyelik: 'Bağdam — üyelik',
  gunluk: 'Bağdam — günlük',
  'nasil-seciyoruz': 'Bağdam — nasıl seçiyoruz',
  politikalar: 'Bağdam — politikalar',
  toptan: 'Bağdam — toptan',
  '404': 'Bağdam — sayfa bulunamadı',
  'coming-soon': "Bağdam — Urla'dan sofrana, yakında",
};

// ── Yardımcılar ──────────────────────────────────────────────────────────────

function rel(p: string): string {
  return relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function readJson<T>(file: string): T {
  if (!existsSync(file)) {
    throw new Error(`${rel(file)} yok — önce "pnpm tsx database/seeds/convert-products-js.ts" çalıştırın`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** urun.html:124-130 — saklama / alerjen / tazelik metinleri koddan alana (Product.storageText vb.). */
function productTexts(p: CatalogProduct): { storageText: string; allergenText: string; freshnessNote: string | null } {
  const storageText = p.fresh
    ? 'Yıkayıp tüket. Serin yerde, tercihen buzdolabında sakla.'
    : p.tab === 'dairy'
      ? 'Buzdolabında, +4°C altında sakla.'
      : p.tab === 'firin'
        ? 'Oda sıcaklığında, kese kağıdında 2–3 gün tazeliğini korur; dilimleyip dondurabilirsin.'
        : 'Açılmadan serin ve kuru yerde, açıldıktan sonra buzdolabında sakla.';
  const allergenText = p.tab === 'dairy' ? 'Süt' : 'Yok';
  const freshnessNote = p.tab === 'firin' ? 'Her sabah taze gelir.' : p.id === 'yumurta' ? 'Her sabah taze toplanır.' : null;
  return { storageText, allergenText, freshnessNote };
}

/** Ürünün görsel yolları: img önce (kapak), sonra images — tekilleştirilmiş. */
function productImagePaths(p: CatalogProduct): string[] {
  const out: string[] = [];
  for (const path of [p.img, ...(p.images ?? [])]) {
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** cart.js defaultFill(count): tercih sinyali yokken fresh havuzunun ilk `count` ürünü (products.js sırası). */
function defaultFill(products: CatalogProduct[], count: number): CatalogProduct[] {
  const pool = products.filter((p) => p.fresh).sort((a, b) => a.sortOrder - b.sortOrder);
  return pool.slice(0, count);
}

/** Bu haftanın Pazartesi'si (Europe/Istanbul takvimine göre), YYYY-MM-DD. */
function thisWeekMonday(now: Date): string {
  const today = calendarDateIn(now, DEFAULT_TZ);
  const dow = weekdayOf(today); // 0 Pazar … 6 Cumartesi
  return addCalendarDays(today, -((dow + 6) % 7));
}

// ── Adımlar ──────────────────────────────────────────────────────────────────

async function seedCategories(catalog: CatalogJson): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const c of catalog.categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, legacyTab: c.legacyTab, label: c.label, panelNote: c.panelNote, sortOrder: c.sortOrder, isActive: true },
      update: { legacyTab: c.legacyTab, label: c.label, panelNote: c.panelNote, sortOrder: c.sortOrder, isActive: true },
    });
    ids.set(c.slug, row.id);
  }
  console.log(`  Category: ${ids.size}`);
  return ids;
}

async function seedProducers(producers: ProducerJson[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of producers) {
    const row = await prisma.producer.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, name: p.name, village: p.village, district: p.district, sortOrder: p.sortOrder, isActive: true },
      update: { name: p.name, village: p.village, district: p.district, sortOrder: p.sortOrder, isActive: true },
    });
    ids.set(p.slug, row.id);
  }
  console.log(`  Producer: ${ids.size}`);
  return ids;
}

/** Tüm görsel yolları → MediaFile (path'e göre tekil; gerçek dosyadan mimeType/size/boyut). */
async function seedMedia(paths: string[], altByPath: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const path of paths) {
    const info = imageFileInfo(path);
    const data = {
      path: info.path,
      originalName: info.originalName,
      mimeType: info.mimeType,
      size: info.size,
      width: info.width,
      height: info.height,
      folder: info.folder,
    };
    const existing = await prisma.mediaFile.findFirst({ where: { path: info.path }, orderBy: { createdAt: 'asc' } });
    const row = existing
      ? await prisma.mediaFile.update({ where: { id: existing.id }, data })
      : await prisma.mediaFile.create({ data: { ...data, alt: altByPath.get(path) ?? null } });
    ids.set(path, row.id);
  }
  console.log(`  MediaFile: ${ids.size}`);
  return ids;
}

async function seedProducts(
  catalog: CatalogJson,
  categoryIds: Map<string, string>,
  producerIds: Map<string, string>,
  mediaIds: Map<string, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let images = 0;
  let lots = 0;
  for (const p of catalog.products) {
    const categoryId = categoryIds.get(p.categorySlug);
    if (!categoryId) throw new Error(`${p.slug}: kategori bulunamadı (${p.categorySlug})`);
    const producerId = producerIds.get(p.producerSlug) ?? null;
    if (!producerId) throw new Error(`${p.slug}: üretici bulunamadı (${p.producerSlug})`);
    const texts = productTexts(p);

    const fields = {
      name: p.name,
      categoryId,
      group: p.group,
      producerId,
      metaNote: p.metaNote,
      price: p.price,
      unit: p.unit,
      boxAmount: p.boxAmount ?? null,
      description: p.desc,
      storageText: texts.storageText,
      allergenText: texts.allergenText,
      freshnessNote: texts.freshnessNote,
      prefLabel: p.pref?.label ?? null,
      prefOptions: p.pref?.options ?? [],
      prefDefault: p.pref?.def ?? null,
      isFresh: p.fresh,
      season: p.season ?? null,
      pairWithBox: p.pairWithBox,
      pairOrder: p.pairOrder,
      sortOrder: p.sortOrder,
      deletedAt: null,
    };
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...fields, vatRate: COMMERCE_SETTINGS_DEFAULTS.vatRate, status: ProductStatus.ACTIVE, stockStatus: StockStatus.IN_STOCK },
      // status/stockStatus/vatRate/extraOptions admin'in alanı — yeniden çalıştırmada ezilmez
      update: fields,
    });
    ids.set(p.slug, product.id);

    // Görseller: img kapak (sortOrder 0), ardından images; listede olmayan eski seed görselleri kaldırılır
    const paths = productImagePaths(p);
    const wantedMediaIds: string[] = [];
    const existingImages = await prisma.productImage.findMany({ where: { productId: product.id } });
    for (let i = 0; i < paths.length; i++) {
      const mediaId = mediaIds.get(paths[i] as string);
      if (!mediaId) throw new Error(`${p.slug}: MediaFile yok (${paths[i]})`);
      wantedMediaIds.push(mediaId);
      const found = existingImages.find((img) => img.mediaId === mediaId);
      const data = { alt: p.name, isCover: i === 0, sortOrder: i };
      if (found) await prisma.productImage.update({ where: { id: found.id }, data });
      else await prisma.productImage.create({ data: { productId: product.id, mediaId, ...data } });
      images++;
    }
    await prisma.productImage.deleteMany({ where: { productId: product.id, mediaId: { notIn: wantedMediaIds } } });

    // Parti: batch → lotCode, why → tastingNote; seed lot'u güncel, diğerleri değil (why = lots(isCurrent).tastingNote [B11])
    await prisma.productLot.upsert({
      where: { productId_lotCode: { productId: product.id, lotCode: p.batch } },
      create: { productId: product.id, producerId, lotCode: p.batch, tastingNote: p.why, isCurrent: true },
      update: { producerId, tastingNote: p.why, isCurrent: true },
    });
    await prisma.productLot.updateMany({
      where: { productId: product.id, lotCode: { not: p.batch }, isCurrent: true },
      data: { isCurrent: false },
    });
    lots++;
  }
  console.log(`  Product: ${ids.size} · ProductImage: ${images} · ProductLot: ${lots}`);
  return ids;
}

async function seedTiers(catalog: CatalogJson, mediaIds: Map<string, string>): Promise<Map<string, { id: string; count: number }>> {
  const out = new Map<string, { id: string; count: number }>();
  for (let i = 0; i < catalog.tiers.length; i++) {
    const t = catalog.tiers[i] as CatalogJson['tiers'][number];
    const imageMediaId = t.img ? (mediaIds.get(t.img) ?? null) : null;
    const fields = {
      label: t.label,
      itemCount: t.count,
      price: t.price,
      note: t.note,
      imageMediaId,
      isRecommended: t.id === RECOMMENDED_TIER_SLUG,
      isActive: true,
      sortOrder: i,
    };
    const row = await prisma.boxTier.upsert({ where: { slug: t.id }, create: { slug: t.id, ...fields }, update: fields });
    out.set(t.id, { id: row.id, count: t.count });
  }
  console.log(`  BoxTier: ${out.size} (önerilen: ${RECOMMENDED_TIER_SLUG})`);
  return out;
}

/** Bu haftanın BoxTemplate'i — tier başına, weekStart = bu haftanın Pazartesi'si, PUBLISHED; items = defaultFill. */
async function seedTemplates(
  catalog: CatalogJson,
  tiers: Map<string, { id: string; count: number }>,
  productIds: Map<string, string>,
  now: Date,
): Promise<{ templates: number; items: number; weekStart: string }> {
  const weekStart = thisWeekMonday(now);
  const weekStartDate = isoDateToUtc(weekStart);
  let templates = 0;
  let items = 0;
  for (const [tierSlug, tier] of tiers) {
    const picks = defaultFill(catalog.products, tier.count);
    if (picks.length < tier.count) {
      console.warn(`  UYARI: ${tierSlug} için fresh havuzu yetersiz (${picks.length}/${tier.count}) — şablon eksik doldu`);
    }
    const template = await prisma.boxTemplate.upsert({
      where: { tierId_weekStart: { tierId: tier.id, weekStart: weekStartDate } },
      create: { tierId: tier.id, weekStart: weekStartDate, status: ContentStatus.PUBLISHED },
      update: { status: ContentStatus.PUBLISHED },
    });
    templates++;
    const wantedProductIds: string[] = [];
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i] as CatalogProduct;
      const productId = productIds.get(p.slug);
      if (!productId) throw new Error(`şablon: ürün yok (${p.slug})`);
      wantedProductIds.push(productId);
      const qtyLabel = p.boxAmount ?? p.unit;
      await prisma.boxTemplateItem.upsert({
        where: { templateId_productId: { templateId: template.id, productId } },
        create: { templateId: template.id, productId, qtyLabel, isSwappable: true, sortOrder: i },
        update: { qtyLabel, isSwappable: true, sortOrder: i },
      });
      items++;
    }
    await prisma.boxTemplateItem.deleteMany({ where: { templateId: template.id, productId: { notIn: wantedProductIds } } });
  }
  console.log(`  BoxTemplate: ${templates} (weekStart ${weekStart}, PUBLISHED) · BoxTemplateItem: ${items}`);
  return { templates, items, weekStart };
}

async function seedZones(deliveryFee: number): Promise<Array<{ id: string; slug: string; capacityPerDay: number }>> {
  const rows: Array<{ id: string; slug: string; capacityPerDay: number }> = [];
  for (const z of ZONES) {
    const row = await prisma.deliveryZone.upsert({
      where: { slug: z.slug },
      create: {
        slug: z.slug,
        name: z.name,
        fee: deliveryFee,
        freeThreshold: FREE_SHIPPING_THRESHOLD,
        capacityPerDay: DEFAULT_CAPACITY_PER_DAY,
        isActive: true,
        sortOrder: z.sortOrder,
      },
      // fee/freeThreshold/capacityPerDay/isActive admin'in alanı — ezilmez
      update: { name: z.name, sortOrder: z.sortOrder },
    });
    rows.push({ id: row.id, slug: row.slug, capacityPerDay: row.capacityPerDay });
  }
  console.log(`  DeliveryZone: ${rows.length} (fee ${deliveryFee}, eşik ${FREE_SHIPPING_THRESHOLD}, kapasite ${DEFAULT_CAPACITY_PER_DAY})`);
  return rows;
}

/** İleriye `horizonWeeks` hafta × zone × gün — cutoffAt = teslimattan 1 gün önce 12:00 Europe/Istanbul (shared cutoff). */
async function seedDeliveryDates(zones: Array<{ id: string; slug: string; capacityPerDay: number }>, now: Date): Promise<number> {
  const horizonWeeks = COMMERCE_SETTINGS_DEFAULTS.deliveryDatesHorizonWeeks;
  const slots = nextDeliveryDates(now, ALL_DELIVERY_DAYS, horizonWeeks, {
    tz: DEFAULT_TZ,
    rule: COMMERCE_SETTINGS_DEFAULTS.cutoff,
    includeLocked: true,
  });
  let n = 0;
  for (const zone of zones) {
    for (const slot of slots) {
      const date = isoDateToUtc(slot.date);
      const day = DeliveryDay[slot.day as keyof typeof DeliveryDay];
      await prisma.deliveryDate.upsert({
        where: { zoneId_date: { zoneId: zone.id, date } },
        create: { zoneId: zone.id, day, date, cutoffAt: slot.cutoffAt, capacity: zone.capacityPerDay, status: DeliveryDateStatus.OPEN },
        // reserved/capacity/status korunur; kesim anı kurala göre tazelenir
        update: { day, cutoffAt: slot.cutoffAt },
      });
      n++;
    }
  }
  const first = slots[0]?.date ?? '-';
  const last = slots[slots.length - 1]?.date ?? '-';
  console.log(`  DeliveryDate: ${n} (${zones.length} bölge × ${slots.length} tarih; ${first} → ${last}, ${horizonWeeks} hafta)`);
  return n;
}

/**
 * Setting: commerce.* (shared COMMERCE_SETTINGS_DEFAULTS tek kaynak — fiyatlama kuralları `freeShippingRule` / `discountRounding` /
 * `subscriberFreeShipping` dahil, ADR-0018) + cookies + payment bayrakları + seo başlıkları. Gizli anahtar YOK (hepsi isSecret false).
 * Create-only: mevcut DB'ye yeni eklenen anahtarlar (ör. ADR-0018'in üçü) SEED_OVERWRITE_SETTINGS olmadan da gelir.
 */
async function seedSettings(): Promise<{ created: number; kept: number }> {
  const rows: Array<{ key: string; group: string; value: Prisma.InputJsonValue }> = [];
  for (const [name, value] of Object.entries(COMMERCE_SETTINGS_DEFAULTS)) {
    rows.push({ key: `commerce.${name}`, group: 'commerce', value: value as Prisma.InputJsonValue });
  }
  rows.push({ key: 'cookies.analyticsEnabled', group: 'cookies', value: false });
  rows.push({ key: 'payment.iyzico', group: 'payment', value: { enabled: false, nonThreeDsGranted: false } });
  for (const [page, title] of Object.entries(SEO_TITLES)) {
    rows.push({ key: `seo.${page}`, group: 'seo', value: { title } });
  }

  let created = 0;
  let kept = 0;
  let overwritten = 0;
  for (const r of rows) {
    const existing = await prisma.setting.findUnique({ where: { key: r.key } });
    if (existing && !OVERWRITE_SETTINGS) {
      kept++;
      continue;
    }
    await prisma.setting.upsert({
      where: { key: r.key },
      create: { key: r.key, group: r.group, value: r.value, isSecret: false },
      update: { group: r.group, value: r.value, isSecret: false },
    });
    if (existing) overwritten++;
    else created++;
  }
  console.log(
    `  Setting: ${created} oluşturuldu, ${kept} korundu, ${overwritten} ezildi (toplam ${rows.length}; gruplar: commerce/cookies/payment/seo)`,
  );
  return { created, kept };
}

/**
 * SiteContent — F5 içerik seed'i tüm blokları (home.*, urunler.trust, kutu.notes, manifesto.*, toptan.*, gunluk.*, sepet/uyelik F9)
 * şemalarıyla dolduracak. Burada yalnız gerçek metinli 3 örnek anahtar (index.html / urunler.html'den):
 * promoBar, footer, urunler.trust. Şema biçimi: @bagdam/shared SiteContentSchema ({fields:[{key,label,type,…}]}).
 */
async function seedSiteContent(): Promise<{ created: number; kept: number }> {
  const blocks: Array<{ key: string; label: string; schema: Prisma.InputJsonValue; value: Prisma.InputJsonValue }> = [
    {
      key: 'promoBar',
      label: 'Promosyon şeridi (üst bant)',
      schema: {
        fields: [
          { key: 'enabled', label: 'Göster', type: 'boolean' },
          { key: 'html', label: 'Metin (HTML)', type: 'html', required: true, help: 'index.html:101 — <b> ve <span class="mono"> serbest' },
        ],
      },
      value: {
        enabled: true,
        html: 'Abone ol, ilk <b>2 kutunda %50 indirim</b> kazan — kod: <span class="mono">BAGDAM050</span>',
      },
    },
    {
      key: 'footer',
      label: 'Alt bilgi (footer)',
      schema: {
        fields: [
          { key: 'phoneLabel', label: 'Telefon etiketi', type: 'text' },
          { key: 'phone', label: 'Telefon (görünen)', type: 'text' },
          { key: 'phoneHref', label: 'Telefon bağlantısı (tel:)', type: 'text' },
          { key: 'addressLabel', label: 'Adres etiketi', type: 'text' },
          { key: 'addressLine1', label: 'Adres 1. satır', type: 'text' },
          { key: 'addressLine2', label: 'Adres 2. satır', type: 'text' },
          { key: 'mapsUrl', label: 'Harita bağlantısı', type: 'text' },
          { key: 'instagramUrl', label: 'Instagram', type: 'text' },
          { key: 'youtubeUrl', label: 'YouTube', type: 'text' },
          { key: 'copyright', label: 'Telif satırı', type: 'text' },
          { key: 'policiesLabel', label: 'Politikalar bağlantı metni', type: 'text' },
          { key: 'creditText', label: 'İmza metni', type: 'text' },
          { key: 'creditUrl', label: 'İmza bağlantısı', type: 'text' },
        ],
      },
      value: {
        phoneLabel: 'mutlu müşteri hattı',
        phone: '+90 (530) 949 40 93',
        phoneHref: 'tel:+905309494093',
        addressLabel: 'bağdam',
        addressLine1: '8034 Sokak No:38,',
        addressLine2: 'Kuşçular — Urla / İzmir',
        mapsUrl:
          'https://www.google.com/maps/search/?api=1&query=8034%20Sokak%20No%3A38%20Ku%C5%9F%C3%A7ular%20Urla%20%C4%B0zmir',
        instagramUrl: '#',
        youtubeUrl: '#',
        copyright: '© 2026 — BAĞDAM. TÜM HAKLARI SAKLIDIR.',
        policiesLabel: 'Tüm Politikalar',
        creditText: 'designed and powered by',
        creditUrl: 'https://youmedya.com/iletisim/',
      },
    },
    {
      key: 'urunler.trust',
      label: 'Ürünler — güven satırı (Taze Kutular paneli)',
      schema: {
        fields: [
          {
            key: 'items',
            label: 'Öğeler',
            type: 'list',
            item: [
              { key: 'icon', label: 'İkon (assets/icons/…)', type: 'text' },
              { key: 'label', label: 'Başlık', type: 'text', required: true },
              { key: 'sub', label: 'Alt metin', type: 'text' },
            ],
          },
        ],
      },
      value: {
        items: [
          { icon: 'assets/icons/iptal.png', label: 'İstediğin zaman iptal', sub: 'Taahhüt yok, tek tıkla bitir.' },
          { icon: 'assets/icons/duzenleme.png', label: 'Her hafta düzenle', sub: 'Teslimattan 1 gün öncesine kadar kutunu değiştir.' },
          { icon: 'assets/icons/haftaatla.png', label: 'Sipariş atlama hakkı', sub: 'İptal etmeden bir sonraki siparişini atlayabilirsin.' },
          { icon: 'assets/icons/teslimat.png', label: 'Salı, Perşembe, Cumartesi', sub: "Urla ve Çeşme'ye, doğrudan üreticiden teslim." },
        ],
      },
    },
  ];

  let created = 0;
  let kept = 0;
  let overwritten = 0;
  for (const b of blocks) {
    const existing = await prisma.siteContent.findUnique({ where: { key: b.key } });
    if (existing && !OVERWRITE_SETTINGS) {
      kept++;
      continue;
    }
    await prisma.siteContent.upsert({
      where: { key: b.key },
      create: { key: b.key, label: b.label, schema: b.schema, value: b.value, updatedBy: null },
      update: { label: b.label, schema: b.schema, value: b.value, updatedBy: null },
    });
    if (existing) overwritten++;
    else created++;
  }
  console.log(
    `  SiteContent: ${created} oluşturuldu, ${kept} korundu, ${overwritten} ezildi (${blocks.map((b) => b.key).join(', ')}; kalanı F5)`,
  );
  return { created, kept };
}

/** Admin kullanıcı — SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env'den; yoksa uyarı ve atla. */
async function seedAdmin(now: Date): Promise<'created' | 'updated' | 'skipped'> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('  UYARI: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil — admin kullanıcı oluşturulmadı');
    return 'skipped';
  }
  if (password.length < 8) {
    console.warn('  UYARI: SEED_ADMIN_PASSWORD 8 karakterden kısa — admin kullanıcı oluşturulmadı');
    return 'skipped';
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.user.create({
      data: { email, passwordHash, name: 'Bağdam Admin', role: UserRole.ADMIN, isActive: true, emailVerifiedAt: now },
    });
    console.log(`  User: admin oluşturuldu (${email})`);
    return 'created';
  }
  const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: UserRole.ADMIN,
      isActive: true,
      emailVerifiedAt: existing.emailVerifiedAt ?? now,
      deletedAt: null,
      ...(passwordMatches ? {} : { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) }),
    },
  });
  console.log(`  User: admin mevcut (${email})${passwordMatches ? '' : ' — parola env’e göre güncellendi'}`);
  return 'updated';
}

async function printSummary(): Promise<void> {
  const [
    categories,
    producers,
    products,
    productImages,
    productLots,
    mediaFiles,
    boxTiers,
    boxTemplates,
    boxTemplateItems,
    deliveryZones,
    deliveryDates,
    settings,
    siteContent,
    users,
  ] = await Promise.all([
    prisma.category.count(),
    prisma.producer.count(),
    prisma.product.count(),
    prisma.productImage.count(),
    prisma.productLot.count(),
    prisma.mediaFile.count(),
    prisma.boxTier.count(),
    prisma.boxTemplate.count(),
    prisma.boxTemplateItem.count(),
    prisma.deliveryZone.count(),
    prisma.deliveryDate.count(),
    prisma.setting.count(),
    prisma.siteContent.count(),
    prisma.user.count(),
  ]);
  console.log('Özet (DB sayımları):');
  console.log(
    `  categories=${categories} producers=${producers} products=${products} product_images=${productImages} product_lots=${productLots} media_files=${mediaFiles}`,
  );
  console.log(`  box_tiers=${boxTiers} box_templates=${boxTemplates} box_template_items=${boxTemplateItems}`);
  console.log(`  delivery_zones=${deliveryZones} delivery_dates=${deliveryDates} settings=${settings} site_content=${siteContent} users=${users}`);
}

// ── Giriş ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertDatabaseUrl();
  const now = new Date();
  const catalog = readJson<CatalogJson>(CATALOG_JSON);
  const producers = readJson<ProducerJson[]>(PRODUCERS_JSON);
  console.log(`seed: ${rel(CATALOG_JSON)} (${catalog.products.length} ürün) + ${rel(PRODUCERS_JSON)} (${producers.length} üretici)`);

  const categoryIds = await seedCategories(catalog);
  const producerIds = await seedProducers(producers);

  // Görseller: ürün img/images + tier img — path'e göre tekil
  const mediaPaths: string[] = [];
  const altByPath = new Map<string, string>();
  for (const p of catalog.products) {
    for (const path of productImagePaths(p)) {
      if (!mediaPaths.includes(path)) mediaPaths.push(path);
      if (!altByPath.has(path)) altByPath.set(path, p.name);
    }
  }
  for (const t of catalog.tiers) {
    if (t.img && !mediaPaths.includes(t.img)) mediaPaths.push(t.img);
    if (t.img && !altByPath.has(t.img)) altByPath.set(t.img, t.label);
  }
  const mediaIds = await seedMedia(mediaPaths, altByPath);

  const productIds = await seedProducts(catalog, categoryIds, producerIds, mediaIds);
  const tiers = await seedTiers(catalog, mediaIds);
  await seedTemplates(catalog, tiers, productIds, now);
  const zones = await seedZones(catalog.deliveryFee);
  await seedDeliveryDates(zones, now);
  await seedSettings();
  await seedSiteContent();
  await seedAdmin(now);
  await printSummary();
  console.log('seed: tamamlandı');
}

main()
  .catch((err) => {
    console.error('seed HATA:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
