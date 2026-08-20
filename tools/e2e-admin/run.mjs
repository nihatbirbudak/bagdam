// tools/e2e-admin/run.mjs — F4 admin uçtan uca doğrulama (Playwright + gerçek API + gerçek DB).
//
// Admin panelinde (Vite preview/dev, API'ye proxy'li) seed admin ile giriş yapar ve F4 ekranlarında gerçek
// değişiklikler yapıp her birini PUBLIC yüzeyden (GET /api/v1/bootstrap, /urun.html) ve audit-logs'tan doğrular:
//   (a) giriş → Özet · (b) ürün fiyatı 480→485 · (c) bootstrap + urun.html'de 485 (cache invalidation)
//   (d) yeni parti ZY-12 + "neden seçtik" → güncel yap → bootstrap batch/why · (e) medya yükle → ürüne ekle → kapak → bootstrap img
//   (f) Haftanın Kutusu (sezon): bir ürün çıkar, havuzdan ekle → Yayınla → bootstrap templates.sezon
//   (g) kategori panel notu (yalnız admin API'de görünür; F5'e kadar HTML'e gitmez — not düşülür)
//   (h) audit-logs: actorEmail / module / action · (i) çıkış → /admin/products 401; CSRF'siz POST 403
// Sonunda TÜM değişiklikler API üzerinden geri alınır ve bootstrap başlangıç anlık görüntüsüyle karşılaştırılır
// (--keep ile geri alma atlanır). Sırlar yalnız env'den okunur (SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD, apps/api/.env);
// çıktıya yazılmaz.
//
// Kullanım (repo kökünden; API ve admin önceden ayağa kaldırılmış olmalı):
//   node tools/e2e-admin/run.mjs [--api=http://127.0.0.1:4033] [--admin=http://127.0.0.1:4034]
//        [--slug=zeytinyagi] [--headed] [--keep] [--timeout=20000]
// Çıktı: tools/e2e-admin/out/*.png (ekran görüntüleri), tools/e2e-admin/report.md. Çıkış kodu: hata varsa 1.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report.md');

// .env sırası main.ts ile aynı: apps/api/.env → kök .env (mevcut env ezilmez).
loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4033').replace(/\/$/, '');
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://127.0.0.1:4034').replace(/\/$/, '');
const SLUG = String(args.slug || 'zeytinyagi');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 20_000);
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil (apps/api/.env).');
  process.exit(2);
}
const RUN = Date.now().toString(36);
const NEW_PRICE = 485;
const NEW_LOT_CODE = 'ZY-12';
const NEW_WHY = `E2E ${RUN}: yeni sıkımın tadım notu — meyvemsi, dengeli acılık.`;
const UPLOAD_NAME = `e2e-cig-domates-${RUN}.png`;
const NEW_PANEL_NOTE = `E2E panel notu ${RUN}`;

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-admin] ${msg}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`DOĞRULAMA: ${msg}`);
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note: note ?? '' });
    log(`OK   ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: err instanceof Error ? err.message : String(err) });
    log(`FAIL ${name} — ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/** CRC32 (PNG chunk'ları için) — bağımlılık yok. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
/** Geçerli küçük PNG (w×h RGBA düz renk). */
function makePng(width, height, rgba = [200, 60, 40, 255]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Çerez kavanozlu API istemcisi (kurulum / doğrulama / geri alma için; tarayıcıdan bağımsız oturum). */
class ApiClient {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }
  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0$/i.test(a) || /^\s*expires=thu, 01 jan 1970/i.test(a));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method, path, body, opts = {}) {
    const headers = { accept: 'application/json' };
    const cookie = this.cookieHeader();
    if (cookie && opts.cookies !== false) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const csrf = this.cookies.get('csrf_token');
    if (opts.csrf !== false && method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.storeCookies(res);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  async login() {
    await this.req('GET', '/api/v1/auth/csrf');
    const r = await this.req('POST', '/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 200) throw new Error(`API login başarısız: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.user;
  }
  async must(method, path, body, expected = [200, 201, 204]) {
    const r = await this.req(method, path, body);
    if (!expected.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  }
}

async function getBootstrap() {
  const res = await fetch(`${API}/api/v1/bootstrap`);
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  return res.json();
}
/** /urun.html içindeki gömülü bootstrap JSON'u (partials/bootstrap.hbs) */
async function getPageBootstrap(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const html = await res.text();
  const m = html.match(/window\.__BAGDAM__ = (.*?); var PRODUCTS = /s);
  if (!m) throw new Error(`${path}: gömülü bootstrap bulunamadı`);
  return { html, payload: JSON.parse(m[1]) };
}
const productOf = (payload, slug) => payload.products.find((p) => p.id === slug);
/** Bootstrap'ın zamana bağlı olmayan kısmı (deliveryDates/commerce hariç) */
const stablePart = (b) => ({ products: b.products, tiers: b.tiers, templates: b.templates, pool: b.pool, pairIds: b.pairIds, recommendedTier: b.recommendedTier });

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function waitToast(page, text) {
  const loc = page.getByRole('status').filter({ hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
}
function confirmDialog(page, titleText) {
  return page.getByRole('dialog').filter({ hasText: titleText });
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const api = new ApiClient(API);
  const state = {
    product: null, // AdminProductDetail (başlangıç)
    origPrice: null,
    origCurrentLotId: null,
    newLotId: null,
    uploadedMedia: null,
    addedImageId: null,
    origCoverImageId: null,
    weekStart: null,
    templates: {}, // tier slug → AdminBoxTemplate (başlangıç)
    category: null,
    baseline: null,
  };
  let browser;
  let failed = false;

  try {
    // 0) Başlangıç anlık görüntüsü + hedef ürün
    await step('0 hazırlık: API girişi, bootstrap baseline, hedef ürün', async () => {
      const me = await api.login();
      assert(me && me.role === 'ADMIN', 'seed admin ADMIN rolünde olmalı');
      state.baseline = await getBootstrap();
      const page = await api.must('GET', `/api/v1/admin/products?q=${encodeURIComponent(SLUG)}&limit=5`);
      const row = page.items.find((p) => p.slug === SLUG);
      assert(row, `ürün bulunamadı: ${SLUG}`);
      state.product = await api.must('GET', `/api/v1/admin/products/${row.id}`);
      state.origPrice = state.product.price;
      state.origCurrentLotId = state.product.currentLot?.id ?? null;
      state.origCoverImageId = state.product.images.find((i) => i.isCover)?.id ?? state.product.images[0]?.id ?? null;
      const wk = await api.must('GET', '/api/v1/admin/box-week');
      state.weekStart = wk.weekStart;
      for (const slug of ['sezon', 'small']) {
        const t = wk.tiers.find((x) => x.tier.slug === slug);
        assert(t && t.template && t.template.status === 'PUBLISHED', `${slug} tier için bu haftanın yayınlanmış şablonu seed ile var olmalı`);
        state.templates[slug] = t.template;
      }
      const cats = await api.must('GET', '/api/v1/admin/categories');
      state.category = cats[0];
      assert(state.category, 'en az bir kategori olmalı');
      const b0 = productOf(state.baseline, SLUG);
      return `${state.product.name} fiyat=${state.origPrice} batch=${b0.batch} img=${b0.img}; hafta=${state.weekStart} sezon.items=${state.templates.sezon.items.length} small.items=${state.templates.small.items.length}`;
    });

    browser = await chromium.launch({ headless: !HEADED });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    context.setDefaultTimeout(TIMEOUT);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`);
    });

    // (a) Giriş
    await step('a giriş → Özet (cookie oturumu)', async () => {
      await page.goto(`${ADMIN}/login`);
      await page.locator('#login-email').fill(ADMIN_EMAIL);
      await page.locator('#login-password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Giriş Yap' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: TIMEOUT });
      await page.getByRole('heading', { name: 'Özet' }).waitFor();
      const cookies = await context.cookies(ADMIN);
      const names = cookies.map((c) => c.name);
      assert(names.includes('access_token'), 'access_token çerezi yok');
      assert(names.includes('csrf_token'), 'csrf_token çerezi yok');
      const access = cookies.find((c) => c.name === 'access_token');
      assert(access.httpOnly && access.path === '/', 'access_token httpOnly/path=/ olmalı');
      await shot(page, 'a-dashboard');
      return `çerezler: ${names.sort().join(', ')}`;
    });

    // (b) Ürün fiyatı 480 → 485
    await step(`b ürün formu: fiyat ${state.origPrice} → ${NEW_PRICE} → Kaydet → toast`, async () => {
      await page.goto(`${ADMIN}/katalog/urunler?q=${encodeURIComponent(SLUG)}`);
      await page.getByRole('link', { name: state.product.name, exact: true }).first().click();
      await page.waitForURL((u) => new URL(u).pathname === `/katalog/urunler/${state.product.id}`);
      await page.getByRole('heading', { level: 1 }).filter({ hasText: state.product.name }).waitFor();
      await page.getByRole('tab', { name: 'Fiyat / KDV' }).click();
      const price = page.getByLabel(/Fiyat \(₺, KDV dahil\)/);
      await price.fill(String(NEW_PRICE));
      await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'Ürün kaydedildi');
      await shot(page, 'b-price-saved');
    });

    // (c) bootstrap + urun.html
    await step('c bootstrap ve /urun.html gömülü yükte yeni fiyat (cache invalidation)', async () => {
      const b = await getBootstrap();
      const p = productOf(b, SLUG);
      assert(p.price === NEW_PRICE, `bootstrap price=${p.price}`);
      const { html, payload } = await getPageBootstrap(`/urun.html?id=${SLUG}`);
      const pp = productOf(payload, SLUG);
      assert(pp.price === NEW_PRICE, `urun.html gömülü price=${pp.price}`);
      assert(html.includes(`"id":"${SLUG}"`), 'urun.html ürün kaydını içermiyor');
      const admin = await api.must('GET', `/api/v1/admin/products/${state.product.id}`);
      assert(admin.price === NEW_PRICE, `admin detail price=${admin.price}`);
      return `bootstrap.price=${p.price}, urun.html price=${pp.price}`;
    });

    // (d) Partiler: yeni lot + güncel yap
    await step(`d Partiler: yeni parti ${NEW_LOT_CODE} + neden seçtik → Güncel yap → bootstrap batch/why`, async () => {
      await page.getByRole('tab', { name: 'Partiler' }).click();
      await page.getByRole('button', { name: 'Yeni parti' }).click();
      const dlg = confirmDialog(page, 'Yeni parti');
      await dlg.getByLabel(/^Parti kodu/).fill(NEW_LOT_CODE);
      await dlg.getByLabel(/^Neden seçtik/).fill(NEW_WHY);
      const current = dlg.getByLabel(/Güncel parti yap/);
      if (await current.isChecked()) await current.uncheck(); // önce güncel olmayan parti olarak ekle, sonra "Güncel yap" ile PATCH
      await dlg.getByRole('button', { name: 'Kaydet' }).click();
      await waitToast(page, 'Parti eklendi');
      const row = page.locator('tbody tr').filter({ hasText: NEW_LOT_CODE });
      await row.getByRole('button', { name: 'Güncel yap' }).click();
      await waitToast(page, `Güncel parti: ${NEW_LOT_CODE}`);
      await shot(page, 'd-lot-current');
      const b = await getBootstrap();
      const p = productOf(b, SLUG);
      assert(p.batch === NEW_LOT_CODE, `bootstrap batch=${p.batch}`);
      assert(p.why === NEW_WHY, `bootstrap why=${p.why}`);
      const admin = await api.must('GET', `/api/v1/admin/products/${state.product.id}`);
      const lot = admin.lots.find((l) => l.lotCode === NEW_LOT_CODE);
      assert(lot && lot.isCurrent, 'yeni lot admin detayında güncel değil');
      assert(admin.lots.filter((l) => l.isCurrent).length === 1, 'birden fazla güncel parti');
      state.newLotId = lot.id;
      return `batch=${p.batch}`;
    });

    // (e) Medya yükle → ürün görseli → kapak
    await step('e Medya: PNG yükle → listede → ürün Görseller picker → Kapak → bootstrap img', async () => {
      await page.goto(`${ADMIN}/medya`);
      await page.getByRole('heading', { name: 'Medya', exact: true }).waitFor();
      await page.locator('#upload-folder').selectOption('urunler');
      await page.locator('input[type="file"]').first().setInputFiles({ name: UPLOAD_NAME, mimeType: 'image/png', buffer: makePng(64, 48) });
      await waitToast(page, 'Görsel yüklendi');
      await page.getByTitle(UPLOAD_NAME).first().waitFor();
      await shot(page, 'e1-media-uploaded');
      const list = await api.must('GET', `/api/v1/admin/media?q=${encodeURIComponent(UPLOAD_NAME)}&limit=5`);
      const media = list.items.find((m) => m.originalName === UPLOAD_NAME);
      assert(media, 'yüklenen medya API listesinde yok');
      assert(/^\/uploads\/urunler\/.+\.webp$/.test(media.url), `medya url=${media.url}`);
      assert(media.thumbUrl && media.thumbUrl.endsWith('-thumb.webp'), 'thumbUrl yok');
      assert(media.mimeType === 'image/webp' && media.width === 64 && media.height === 48, `webp/boyut: ${media.mimeType} ${media.width}x${media.height}`);
      state.uploadedMedia = media;
      const file = await fetch(`${API}${media.url}`);
      assert(file.status === 200 && (file.headers.get('content-type') || '').includes('image/webp'), `/uploads statik servis: ${file.status} ${file.headers.get('content-type')}`);
      const thumb = await fetch(`${API}${media.thumbUrl}`);
      assert(thumb.status === 200, `thumb statik servis: ${thumb.status}`);
      // aynı dosya admin preview/dev proxy'sinden de gelmeli (C notu: /uploads + /assets proxy)
      const viaAdmin = await page.request.get(`${ADMIN}${media.thumbUrl}`);
      assert(viaAdmin.status() === 200, `admin proxy /uploads: ${viaAdmin.status()}`);
      const seedThumb = await page.request.get(`${ADMIN}${state.product.images[0]?.url ?? '/assets/images/urunler/zeytinyagi.jpg'}`);
      assert(seedThumb.status() === 200, `admin proxy /assets: ${seedThumb.status()}`);

      // Ürün → Görseller → Medyadan ekle
      await page.goto(`${ADMIN}/katalog/urunler/${state.product.id}`);
      await page.getByRole('heading', { level: 1 }).filter({ hasText: state.product.name }).waitFor();
      await page.getByRole('tab', { name: 'Görseller' }).click();
      await page.getByRole('button', { name: 'Medyadan ekle' }).click();
      const picker = confirmDialog(page, 'Ürün görseli seç');
      await picker.getByLabel('Medya ara').fill(`e2e-cig-domates-${RUN}`);
      const option = picker.getByRole('option').filter({ hasText: UPLOAD_NAME }).first();
      await option.click();
      await picker.getByRole('button', { name: 'Seç' }).click();
      await waitToast(page, 'Görsel eklendi');
      const card = page.locator('li').filter({ has: page.locator(`p[title="${media.url}"]`) });
      await card.getByRole('button', { name: 'Kapak' }).click();
      await waitToast(page, 'Kapak görseli güncellendi');
      await shot(page, 'e2-cover');
      const admin = await api.must('GET', `/api/v1/admin/products/${state.product.id}`);
      const img = admin.images.find((i) => i.mediaId === media.id);
      assert(img && img.isCover, 'eklenen görsel admin detayında kapak değil');
      assert(admin.images.filter((i) => i.isCover).length === 1, 'birden fazla kapak');
      state.addedImageId = img.id;
      const b = await getBootstrap();
      const p = productOf(b, SLUG);
      const expectedImg = media.url.replace(/^\//, '');
      assert(p.img === expectedImg, `bootstrap img=${p.img} (beklenen ${expectedImg})`);
      assert(Array.isArray(p.images) && p.images[0] === expectedImg, 'bootstrap images[0] kapak değil');
      const siteImg = await fetch(`${API}/${p.img}`);
      assert(siteImg.status === 200, `site img ${p.img} → ${siteImg.status}`);
      const { payload } = await getPageBootstrap(`/urun.html?id=${SLUG}`);
      assert(productOf(payload, SLUG).img === expectedImg, 'urun.html gömülü img güncellenmedi');
      return `img=${p.img}`;
    });

    // (f) Haftanın Kutusu — tier başına: bir ürün çıkar, havuzdan ekle, Yayınla, bootstrap templates.<tier> doğrula
    async function boxWeekFlow(tierSlug) {
      const orig = state.templates[tierSlug];
      assert(orig, `${tierSlug} için başlangıç şablonu yok`);
      await page.goto(`${ADMIN}/katalog/haftanin-kutusu`);
      const sec = page.locator('section').filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${tierSlug}$`) }) });
      await sec.waitFor();
      await sec.locator('header').click();
      const rows = sec.locator('tbody tr');
      // 2. sütun: ürün adı (span.font-medium) + slug (span.font-mono); 4. sütundaki Checkbox etiketi de font-medium → sütuna daralt
      const slugCells = () => rows.locator('td:nth-child(2) span.font-mono');
      const before = await slugCells().allInnerTexts();
      assert(before.length > 0, `${tierSlug} şablonu boş`);
      const removedName = await rows.first().locator('td:nth-child(2) span.font-medium').innerText();
      const removedSlug = before[0];
      await sec.getByRole('button', { name: `${removedName} çıkar` }).click();
      // Havuzdan şablonda olmayan ilk ürünü ekle; yoksa (seed: 10 taze ürünün 10'u sezonda) çıkarılanı sona ekle.
      const poolButtons = page.locator('aside ul button');
      const count = await poolButtons.count();
      let addedName = null;
      for (let i = 0; i < count; i++) {
        const btn = poolButtons.nth(i);
        if (await btn.isDisabled()) continue;
        const name = await btn.locator('span.font-medium').innerText();
        if (name === removedName) continue;
        await btn.click();
        addedName = name;
        break;
      }
      if (!addedName) {
        await poolButtons.filter({ hasText: removedName }).first().click();
        addedName = removedName;
      }
      const after = await slugCells().allInnerTexts();
      const addedSlug = after[after.length - 1];
      assert(after.length === before.length, `satır sayısı ${before.length} → ${after.length}`);
      assert(!deepEqual(after, before), 'şablon sırası değişmedi');
      await sec.getByRole('button', { name: 'Yayınla', exact: true }).click();
      // Yayındaki şablon + kaydedilmemiş değişiklik → önce kaydet onayı
      const saveDlg = confirmDialog(page, 'Yayınlanmış şablon değişecek');
      await saveDlg.getByRole('button', { name: 'Kaydet' }).click();
      await waitToast(page, 'şablon kaydedildi');
      const pubDlg = confirmDialog(page, 'Şablonu yayınla');
      await pubDlg.getByRole('button', { name: 'Yayınla' }).click();
      await waitToast(page, 'şablon yayınlandı');
      await shot(page, `f-box-week-${tierSlug}-published`);
      const b = await getBootstrap();
      assert(deepEqual(b.templates[tierSlug], after), `bootstrap templates.${tierSlug}=${JSON.stringify(b.templates[tierSlug])} beklenen ${JSON.stringify(after)}`);
      const { payload } = await getPageBootstrap('/kutu.html?tier=' + tierSlug);
      assert(deepEqual(payload.templates[tierSlug], after), 'kutu.html gömülü şablon güncellenmedi');
      const wk = await api.must('GET', `/api/v1/admin/box-week?week=${state.weekStart}`);
      const t = wk.tiers.find((x) => x.tier.slug === tierSlug);
      assert(t.template && t.template.status === 'PUBLISHED', 'şablon PUBLISHED değil');
      assert(t.template.id === orig.id, 'şablon id değişti (yeni satır açılmamalı)');
      return `çıkarıldı=${removedSlug}, eklendi=${addedSlug}${addedName === removedName ? ' (havuzda başka taze ürün yoktu → aynı ürün sona eklendi)' : ''}`;
    }
    await step('f1 Haftanın Kutusu (sezon): ürün çıkar + havuzdan ekle → Yayınla → bootstrap/kutu.html templates.sezon', () => boxWeekFlow('sezon'));
    await step('f2 Haftanın Kutusu (small): ürün çıkar + BAŞKA taze ürün ekle → Yayınla → bootstrap/kutu.html templates.small', () => boxWeekFlow('small'));

    // (g) Kategori panel notu
    await step('g Kategoriler: panelNote düzenle → admin API yansır (HTML F5: CMS — atlandı)', async () => {
      await page.goto(`${ADMIN}/katalog/kategoriler`);
      await page.getByRole('heading', { name: 'Kategoriler' }).waitFor();
      await page.getByRole('button', { name: `${state.category.label} düzenle` }).click();
      const dlg = confirmDialog(page, 'Kategori düzenle');
      await dlg.getByLabel(/^Panel notu/).fill(NEW_PANEL_NOTE);
      await dlg.getByRole('button', { name: 'Kaydet' }).click();
      await waitToast(page, 'Kategori güncellendi');
      await shot(page, 'g-category');
      const cats = await api.must('GET', '/api/v1/admin/categories');
      const c = cats.find((x) => x.id === state.category.id);
      assert(c && c.panelNote === NEW_PANEL_NOTE, `panelNote=${c?.panelNote}`);
      const res = await fetch(`${API}/urunler.html`);
      const html = await res.text();
      const inHtml = html.includes(NEW_PANEL_NOTE);
      return `admin API'de güncel; /urunler.html'de ${inHtml ? 'GÖRÜNÜYOR' : 'yok (F3: panel metinleri statik, F5 CMS ile gelecek — beklenen)'}`;
    });

    // (h) Audit
    await step('h audit-logs: bu oturumun işlemleri (actorEmail/module/action)', async () => {
      const res = await api.must('GET', '/api/v1/admin/audit-logs?limit=100');
      const since = startedAt.getTime() - 5_000;
      const mine = res.items.filter((i) => new Date(i.createdAt).getTime() >= since && i.actorEmail === ADMIN_EMAIL);
      const has = (mod, action, pred = () => true) => mine.some((i) => i.module === mod && i.action === action && pred(i));
      assert(has('auth', 'LOGIN'), 'auth LOGIN yok');
      assert(has('catalog', 'UPDATE', (i) => i.entityId === state.product.id), 'catalog UPDATE (ürün) yok');
      assert(has('catalog', 'CREATE', (i) => i.summary?.includes(NEW_LOT_CODE) || i.entityId === state.newLotId), 'catalog CREATE (parti) yok');
      assert(has('catalog', 'PUBLISH'), 'catalog PUBLISH yok');
      assert(has('media', 'UPLOAD', (i) => i.entityId === state.uploadedMedia.id), 'media UPLOAD yok');
      const redacted = mine.every((i) => JSON.stringify(i.newValues ?? {}).indexOf(ADMIN_PASSWORD) === -1);
      assert(redacted, 'audit newValues parola içeriyor');
      return `${mine.length} satır: ${[...new Set(mine.map((i) => `${i.module}:${i.action}`))].join(', ')}`;
    });

    // (i) Çıkış + yetkisiz/CSRF'siz
    await step('i çıkış → /admin/products 401; CSRF’siz POST 403', async () => {
      await page.goto(`${ADMIN}/`);
      await page.getByRole('button', { name: 'Çıkış' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/login');
      const after = await context.cookies(ADMIN);
      assert(!after.some((c) => c.name === 'access_token'), 'access_token çerezi çıkıştan sonra duruyor');
      const r = await page.request.get(`${ADMIN}/api/v1/admin/products`);
      assert(r.status() === 401, `çıkış sonrası /admin/products → ${r.status()}`);
      const anon = await fetch(`${API}/api/v1/admin/products`);
      assert(anon.status === 401, `anonim /admin/products → ${anon.status}`);
      // Oturumlu ama X-CSRF-Token'sız mutasyon → 403 CSRF_INVALID (ApiClient oturumu hâlâ açık)
      const noCsrf = await api.req('POST', '/api/v1/admin/products/reorder', { ids: [state.product.id] }, { csrf: false });
      assert(noCsrf.status === 403 && noCsrf.data?.error === 'CSRF_INVALID', `CSRF'siz POST → ${noCsrf.status} ${JSON.stringify(noCsrf.data)}`);
      await shot(page, 'i-logged-out');
      return 'çerezler temizlendi; 401/403 doğru';
    });

    if (consoleErrors.length) log(`tarayıcı konsol hataları (${consoleErrors.length}): ${consoleErrors.slice(0, 5).join(' | ')}`);
  } catch (err) {
    failed = true;
    log(`HATA: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    if (browser) await browser.close();
  }

  // ---- geri alma ----------------------------------------------------------------------------
  if (!KEEP) {
    await step('z geri alma: fiyat · parti · görsel/medya · şablon · kategori → bootstrap ≡ baseline', async () => {
      const problems = [];
      const tryDo = async (label, fn) => {
        try {
          await fn();
        } catch (e) {
          problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      if (api.cookies.size === 0) await api.login();
      const pid = state.product?.id;
      if (pid && state.origPrice !== null) await tryDo('fiyat', () => api.must('PUT', `/api/v1/admin/products/${pid}`, { price: state.origPrice }));
      if (pid) {
        await tryDo('parti', async () => {
          const d = await api.must('GET', `/api/v1/admin/products/${pid}`);
          const newLot = d.lots.find((l) => l.lotCode === NEW_LOT_CODE);
          if (state.origCurrentLotId) await api.must('PATCH', `/api/v1/admin/products/${pid}/lots/${state.origCurrentLotId}`, { isCurrent: true });
          if (newLot) await api.must('DELETE', `/api/v1/admin/products/${pid}/lots/${newLot.id}`);
        });
        await tryDo('görsel', async () => {
          const d = await api.must('GET', `/api/v1/admin/products/${pid}`);
          const mediaId = state.uploadedMedia?.id;
          const img = mediaId ? d.images.find((i) => i.mediaId === mediaId) : null;
          if (img) await api.must('DELETE', `/api/v1/admin/products/${pid}/images/${img.id}`);
          if (state.origCoverImageId) await api.must('PATCH', `/api/v1/admin/products/${pid}/images/${state.origCoverImageId}`, { isCover: true });
        });
      }
      await tryDo('medya', async () => {
        let mediaId = state.uploadedMedia?.id;
        if (!mediaId) {
          const list = await api.must('GET', `/api/v1/admin/media?q=${encodeURIComponent(UPLOAD_NAME)}&limit=5`);
          mediaId = list.items.find((m) => m.originalName === UPLOAD_NAME)?.id;
        }
        if (mediaId) await api.must('DELETE', `/api/v1/admin/media/${mediaId}`);
      });
      for (const [slug, tpl] of Object.entries(state.templates)) {
        await tryDo(`şablon ${slug}`, () =>
          api.must('PUT', `/api/v1/admin/box-templates/${tpl.id}`, {
            curatorName: tpl.curatorName,
            items: [...tpl.items]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((i) => ({ productId: i.productId, qtyLabel: i.qtyLabel, isSwappable: i.isSwappable })),
          }),
        );
      }
      if (state.category) {
        const c = state.category;
        await tryDo('kategori', () =>
          api.must('PUT', `/api/v1/admin/categories/${c.id}`, { label: c.label, panelNote: c.panelNote, sortOrder: c.sortOrder, isActive: c.isActive, legacyTab: c.legacyTab }),
        );
      }
      if (problems.length) throw new Error(`geri alma sorunları: ${problems.join(' · ')}`);
      const now = await getBootstrap();
      const same = deepEqual(stablePart(now), stablePart(state.baseline));
      if (!same) {
        const diffs = [];
        for (const key of Object.keys(stablePart(now))) {
          if (!deepEqual(now[key], state.baseline[key])) diffs.push(key);
        }
        throw new Error(`bootstrap baseline'dan farklı: ${diffs.join(', ')}`);
      }
      return 'bootstrap (products/tiers/templates/pool/pairIds) baseline ile aynı';
    }).catch(() => {
      failed = true;
    });
    try {
      await api.req('POST', '/api/v1/auth/logout');
    } catch {
      /* önemsiz */
    }
  } else {
    log('--keep: değişiklikler geri alınmadı');
  }

  // ---- rapor --------------------------------------------------------------------------------
  const lines = [
    '# e2e-admin raporu',
    '',
    `- Tarih: ${startedAt.toISOString()} · API: ${API} · Admin: ${ADMIN} · ürün: ${SLUG} · run: ${RUN}`,
    `- Sonuç: ${failed ? 'HATA' : 'TÜM ADIMLAR OK'} (${results.filter((r) => r.ok).length}/${results.length})`,
    '',
    '| Adım | Durum | Süre | Not |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|')} |`),
    '',
    `Ekran görüntüleri: \`tools/e2e-admin/out/\`. Sırlar çıktıya yazılmaz; admin kimliği apps/api/.env (SEED_ADMIN_*).`,
    '',
  ];
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[e2e-admin] beklenmeyen hata:', err);
  process.exit(1);
});
