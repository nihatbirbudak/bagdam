// tools/e2e-admin/run-f5.mjs — F5 admin uçtan uca doğrulama (Playwright + gerçek API + gerçek DB).
//
// F4 run.mjs ile aynı kalıp: admin panelinde (Vite preview/dev, API'ye proxy'li) seed admin ile giriş yapar, F5 ekranlarında
// gerçek değişiklikler yapıp her birini PUBLIC yüzeyden (render edilen .hbs sayfaları, /api/v1/* uçları, bootstrap) ve
// audit-logs'tan doğrular; sonunda TÜMÜNÜ geri alır (API + psql temizliği) ve içeriğin başlangıçla aynı olduğunu doğrular:
//   (a) giriş · (b) Site Blokları: home.hero.title → `/` HTML'inde · (c) Promo/Footer: promoBar metni → `/index.html`
//   (d) Günlük: yeni yazı taslak → `/gunluk.html`'de YOK → yayınla → VAR → sil → YOK
//   (e) Yasal: KVKK yeni taslak sürüm → düzenle → yayınla → `/politikalar.html` + `/api/v1/legal/kvkk` version+1 → PUT current 409
//       → eski sürüm yeniden yayınla (geri alma)
//   (f) Toptan: `/toptan.html` formu → 201 → admin listesinde → durum CONTACTED → 4. istek 429 (3/dk/IP)
//   (g) Ayarlar › Bölgeler: Urla fee 49→55 → bootstrap/`/index.html` DELIVERY_FEE 55 → 49
//   (h) Ayarlar › Genel: commerce.freeShippingRule gte→gt → GET /admin/settings/commerce · bootstrap commerce → gte
//   (i) E-posta: SMTP parolası yaz → GET maskeli + hasValue · DB'de `enc:v1:` şifreli (düz metin YOK) · test düğmesi 501→bilgi
//   (j) audit-logs: content/settings/delivery/wholesale satırları · (k) çıkış
//   (z) geri alma + psql temizliği (toptan talepleri, KVKK v2 taslağı, mail.pass satırı) → içerik ≡ baseline
// Kullanım (repo kökünden; API ve admin önceden ayağa kaldırılmış olmalı; psql PATH'te ya da PSQL env):
//   node tools/e2e-admin/run-f5.mjs [--api=http://127.0.0.1:4043] [--admin=http://127.0.0.1:4044] [--headed] [--keep] [--timeout=20000]
// Çıktı: tools/e2e-admin/out/f5-*.png, tools/e2e-admin/report-f5.md. Çıkış kodu: hata varsa 1. Sırlar (SEED_ADMIN_*, DATABASE_URL)
// yalnız env'den okunur; çıktıya yazılmaz.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report-f5.md');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4043').replace(/\/$/, '');
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://127.0.0.1:4044').replace(/\/$/, '');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 20_000);
const PSQL = process.env.PSQL || 'psql';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
/** psql için bağlantı dizesi: Prisma'ya özgü sorgu parametreleri (schema, connection_limit…) libpq'da geçersiz → atılır. */
const DATABASE_URL = (() => {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    for (const p of ['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'pgbouncer']) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return raw;
  }
})();
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil (apps/api/.env).');
  process.exit(2);
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL tanımlı değil (apps/api/.env) — psql doğrulama/temizlik için gerekli.');
  process.exit(2);
}
const RUN = Date.now().toString(36);
const HERO_TITLE = `e2e hero ${RUN}.<br><em>seçiciyiz.</em>`;
const PROMO_HTML = `E2E promo ${RUN} — <b>ilk 2 kutu %50</b>`;
const POST_SLUG = `e2e-yazi-${RUN}`;
const POST_TITLE = `e2e yazısı ${RUN}, <em>deneme</em>`;
const POST_BODY = `<p>E2E gövde ${RUN}: bu yazı otomatik testten geldi ve silinecek.</p>`;
const LEGAL_SLUG = 'kvkk';
const LEGAL_MARK = `E2E-KVKK-${RUN}`;
const LEAD_EMAIL = `e2e-toptan-${RUN}@example.com`;
const NEW_FEE = 55;
const MAIL_PASS = `e2e-smtp-secret-${RUN}`;

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f5] ${msg}`);
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
/** psql -tAc (tek sütun/satır metin). Bağlantı dizesi (parola) hata mesajına/çıktıya YAZILMAZ — yalnız psql stderr'i. */
function sql(query) {
  try {
    return execFileSync(PSQL, [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr).trim() : '';
    throw new Error(`psql hatası: ${stderr || 'komut başarısız'} — sorgu: ${query.slice(0, 80)}`);
  }
}
function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
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

async function getText(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.text();
}
async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
/** Sayfadaki gömülü bootstrap JSON'u (partials/bootstrap.hbs). */
async function getPageBootstrap(path) {
  const html = await getText(path);
  const m = html.match(/window\.__BAGDAM__ = (.*?); var PRODUCTS = /s);
  if (!m) throw new Error(`${path}: gömülü bootstrap bulunamadı`);
  return { html, payload: JSON.parse(m[1]) };
}

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function waitToast(page, text) {
  const loc = page.getByRole('status').filter({ hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `f5-${name}.png`), fullPage: false });
}
function dialog(page, titleText) {
  return page.getByRole('dialog').filter({ hasText: titleText });
}
/** RichTextLite: "HTML" düğmesiyle ham kaynak moduna geç ve textarea'yı doldur (contenteditable normalizasyonuna takılma). */
async function fillRichText(scope, ariaLabel, html) {
  const editor = scope.getByRole('textbox', { name: ariaLabel, exact: true });
  await editor.waitFor();
  // contenteditable HTML moduna geçince DOM'dan kalkar → kapsayıcı ve textarea id üzerinden bulunur (textarea id = `<editorId>-html`).
  const id = await editor.getAttribute('id');
  assert(id, `editör id yok (${ariaLabel})`);
  const container = scope.locator(`[id="${id}"]`).locator('..');
  await container.getByRole('button', { name: 'HTML', exact: true }).click();
  const source = scope.locator(`[id="${id}-html"]`);
  await source.waitFor();
  await source.fill(html);
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const api = new ApiClient(API);
  const state = {
    hero: null, // AdminSiteContentItem.value (başlangıç)
    promo: null,
    siteMapBaseline: null, // GET /site-content (key→value)
    legalBaseline: null, // GET /api/v1/legal/kvkk (version, id)
    legalV1Id: null,
    legalNewId: null,
    postId: null,
    leadIds: [],
    zone: null, // urla AdminDeliveryZone
    commerceRule: null,
    mailHadPass: null,
    bootstrapBaseline: null,
    postsTotal: null,
    legalCount: null,
  };
  let browser;
  let failed = false;

  try {
    await step('0 hazırlık: API girişi + başlangıç anlık görüntüleri (site-content, legal, posts, zones, settings, bootstrap)', async () => {
      const me = await api.login();
      assert(me && me.role === 'ADMIN', 'seed admin ADMIN rolünde olmalı');
      state.siteMapBaseline = await getJson('/api/v1/site-content');
      const hero = await api.must('GET', '/api/v1/admin/site-content/home.hero');
      const promo = await api.must('GET', '/api/v1/admin/site-content/promoBar');
      state.hero = hero.value;
      state.promo = promo.value;
      assert(typeof state.hero?.title === 'string' && state.hero.title.length > 0, 'home.hero.title boş');
      assert(typeof state.promo?.html === 'string' && state.promo.enabled === true, 'promoBar beklenen şekilde değil (enabled=true, html)');
      const kvkk = await getJson(`/api/v1/legal/${LEGAL_SLUG}`);
      state.legalBaseline = { version: kvkk.version, id: kvkk.id, title: kvkk.title };
      state.legalV1Id = kvkk.id;
      state.legalCount = (await getJson('/api/v1/legal')).length;
      const posts = await getJson('/api/v1/posts?limit=50');
      state.postsTotal = posts.total;
      const zones = await api.must('GET', '/api/v1/admin/delivery/zones');
      state.zone = zones.find((z) => z.slug === 'urla');
      assert(state.zone, 'urla bölgesi yok');
      const commerce = await api.must('GET', '/api/v1/admin/settings/commerce');
      state.commerceRule = commerce.fields.find((f) => f.key === 'freeShippingRule')?.value;
      assert(state.commerceRule === 'gte' || state.commerceRule === 'gt', `freeShippingRule=${state.commerceRule}`);
      const mail = await api.must('GET', '/api/v1/admin/settings/mail');
      state.mailHadPass = Boolean(mail.fields.find((f) => f.key === 'pass')?.hasValue);
      state.bootstrapBaseline = await getJson('/api/v1/bootstrap');
      const leads = await api.must('GET', '/api/v1/admin/wholesale-leads?limit=1');
      return `site-content ${Object.keys(state.siteMapBaseline).length} anahtar · kvkk v${state.legalBaseline.version} · legal ${state.legalCount} · posts ${state.postsTotal} · urla fee=${state.zone.fee} · freeShippingRule=${state.commerceRule} · mail.pass hasValue=${state.mailHadPass} · leads ${leads.total} · DELIVERY_FEE=${state.bootstrapBaseline.deliveryFee}`;
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
      const names = (await context.cookies(ADMIN)).map((c) => c.name);
      assert(names.includes('access_token') && names.includes('csrf_token'), 'oturum çerezleri yok');
      return `çerezler: ${names.sort().join(', ')}`;
    });

    // (b) Site Blokları — home.hero.title
    await step('b Site Blokları: home.hero başlığı değiştir → Kaydet → `/` HTML yeni başlık → geri al (API) → eski başlık', async () => {
      await page.goto(`${ADMIN}/icerik/site?key=home.hero`);
      await page.getByRole('heading', { name: 'Site İçerikleri' }).waitFor();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { level: 2, name: /Ana sayfa — hero/ }) });
      await form.waitFor();
      await fillRichText(form, 'Başlık (HTML)', HERO_TITLE);
      await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'kaydedildi');
      await shot(page, 'b-hero-saved');
      const html = await getText('/');
      assert(html.includes(HERO_TITLE), '`/` yeni hero başlığını içermiyor (cache düşmedi?)');
      assert(!html.includes(state.hero.title) || state.hero.title === HERO_TITLE, '`/` eski başlığı hâlâ içeriyor');
      const admin = await api.must('GET', '/api/v1/admin/site-content/home.hero');
      assert(admin.value.title === HERO_TITLE, `admin value.title=${admin.value.title}`);
      assert(admin.updatedBy, 'updatedBy boş (oturum kullanıcısı yazılmalı)');
      // geri al (API) — aynı nesne, yalnız title eski
      await api.must('PUT', '/api/v1/admin/site-content/home.hero', { value: state.hero });
      const back = await getText('/');
      assert(back.includes(state.hero.title) && !back.includes(HERO_TITLE), '`/` geri alma sonrası eski başlık yok');
      return `yeni başlık /'de görüldü ve geri alındı (updatedBy=${admin.updatedBy})`;
    });

    // (c) Promo / Footer — promoBar
    await step('c Promo/Footer: promoBar metni değiştir → `/index.html` → geri al', async () => {
      await page.goto(`${ADMIN}/icerik/promo-footer?key=promoBar`);
      await page.getByRole('heading', { name: 'Promo / Footer / İletişim' }).waitFor();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { level: 2, name: /Promosyon şeridi/ }) });
      await form.waitFor();
      await fillRichText(form, 'Metin (HTML)', PROMO_HTML);
      await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'kaydedildi');
      await shot(page, 'c-promo-saved');
      const html = await getText('/index.html');
      assert(html.includes(PROMO_HTML), '/index.html yeni promo metnini içermiyor');
      const urunler = await getText('/urunler.html');
      assert(urunler.includes(PROMO_HTML), '/urunler.html (ortak partial) yeni promo metnini içermiyor');
      await api.must('PUT', '/api/v1/admin/site-content/promoBar', { value: state.promo });
      const back = await getText('/index.html');
      assert(back.includes(state.promo.html) && !back.includes(PROMO_HTML), 'promo geri alınmadı');
      return 'promo metni index+urunler\'de görüldü ve geri alındı';
    });

    // (d) Günlük — yeni yazı: taslak → yayınla → sil
    await step('d Günlük: yeni yazı (taslak) → /gunluk.html\'de yok → Şimdi yayınla → var (+ /api/v1/posts) → Sil → yok', async () => {
      await page.goto(`${ADMIN}/icerik/gunluk/yeni`);
      await page.getByRole('heading', { name: /Yeni yazı/ }).waitFor();
      await page.getByLabel(/^Başlık \(HTML\)/).fill(POST_TITLE);
      await page.getByLabel(/^Slug/).fill(POST_SLUG);
      await page.getByLabel(/^Tür \(rozet\)/).fill('Not');
      await page.getByLabel(/^Okuma \(dk\)/).fill('3');
      await fillRichText(page, 'Gövde', POST_BODY);
      await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'Yazı oluşturuldu');
      await page.waitForURL((u) => /\/icerik\/gunluk\/[^/]+$/.test(new URL(u).pathname) && !new URL(u).pathname.endsWith('/yeni'));
      state.postId = new URL(page.url()).pathname.split('/').pop();
      const draft = await api.must('GET', `/api/v1/admin/posts/${state.postId}`);
      assert(draft.status === 'DRAFT' && draft.slug === POST_SLUG, `taslak beklenirdi: ${draft.status} ${draft.slug}`);
      const before = await getText('/gunluk.html');
      assert(!before.includes(`id="${POST_SLUG}"`), 'taslak yazı /gunluk.html\'de görünmemeli');
      await page.getByRole('button', { name: 'Şimdi yayınla' }).click();
      await waitToast(page, 'Yazı yayınlandı');
      await shot(page, 'd-post-published');
      const after = await getText('/gunluk.html');
      assert(after.includes(`id="${POST_SLUG}"`) && after.includes(`E2E gövde ${RUN}`), 'yayınlanan yazı /gunluk.html\'de yok');
      const pub = await getJson('/api/v1/posts?limit=50');
      assert(pub.items.some((p) => p.slug === POST_SLUG && p.status === 'PUBLISHED'), '/api/v1/posts yeni yazıyı içermiyor');
      assert(pub.total === state.postsTotal + 1, `posts total ${pub.total} (beklenen ${state.postsTotal + 1})`);
      const home = await getText('/');
      assert(home.includes(`gunluk.html#${POST_SLUG}`), 'ana sayfa "son yazılar" yeni yazıyı göstermiyor');
      const sitemap = await getText('/sitemap.xml');
      assert(sitemap.includes(`gunluk.html#${POST_SLUG}`), 'sitemap.xml yeni yazıyı içermiyor');
      // Sil (form sayfasındaki Sil → onay)
      await page.getByRole('button', { name: 'Sil', exact: true }).click();
      const dlg = dialog(page, 'Yazıyı sil');
      await dlg.getByRole('button', { name: 'Sil', exact: true }).click();
      await waitToast(page, 'Yazı silindi');
      await page.waitForURL((u) => new URL(u).pathname === '/icerik/gunluk');
      const gone = await getText('/gunluk.html');
      assert(!gone.includes(`id="${POST_SLUG}"`), 'silinen yazı hâlâ /gunluk.html\'de');
      const r = await api.req('GET', `/api/v1/admin/posts/${state.postId}`);
      assert(r.status === 404, `silinen yazı admin GET → ${r.status}`);
      state.postId = null;
      return `slug=${POST_SLUG}: taslak→yayın→sil; posts total ${state.postsTotal}→${state.postsTotal + 1}→${(await getJson('/api/v1/posts?limit=1')).total}`;
    });

    // (e) Yasal — KVKK yeni sürüm
    await step('e Yasal: KVKK yeni taslak sürüm → düzenle → Yayınla → /politikalar.html + /api/v1/legal/kvkk v+1 → current PUT 409 → eski sürümü yeniden yayınla', async () => {
      await page.goto(`${ADMIN}/icerik/yasal-metinler`);
      await page.getByRole('heading', { name: 'Yasal Metinler' }).waitFor();
      const section = page.locator('section').filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${LEGAL_SLUG}$`) }) });
      await section.waitFor();
      await section.getByRole('button', { name: 'Yeni taslak sürüm' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/icerik/yasal-metinler/yeni');
      await page.getByRole('heading', { name: /Yeni taslak sürüm/ }).waitFor();
      const body = page.getByRole('textbox', { name: 'Gövde', exact: true });
      await body.waitFor();
      const baseHtml = await body.evaluate((el) => el.innerHTML);
      assert(baseHtml.length > 200, 'yeni sürüm formu mevcut gövdeyle dolu gelmeli (from=current)');
      await fillRichText(page, 'Gövde', `${baseHtml}<p>${LEGAL_MARK}</p>`);
      await page.getByRole('button', { name: 'Taslağı oluştur', exact: true }).click();
      await waitToast(page, 'Taslak sürüm oluşturuldu');
      await page.waitForURL((u) => /\/icerik\/yasal-metinler\/[^/]+$/.test(new URL(u).pathname) && !new URL(u).pathname.endsWith('/yeni'));
      state.legalNewId = new URL(page.url()).pathname.split('/').pop();
      const draft = await api.must('GET', `/api/v1/admin/legal/${state.legalNewId}`);
      assert(draft.slug === LEGAL_SLUG && draft.version === state.legalBaseline.version + 1 && draft.isCurrent === false, `taslak: v${draft.version} current=${draft.isCurrent}`);
      assert(draft.bodyHtml.includes(LEGAL_MARK), 'taslak gövdesi işareti içermiyor');
      // Yayında olmayan taslakta düzenleme (PUT) serbest; politikalar henüz eski metin
      const before = await getText('/politikalar.html');
      assert(!before.includes(LEGAL_MARK), 'taslak yayına çıkmadan politikalar\'da görünmemeli');
      // Yayınla (form sayfası → PublishModal)
      await page.getByRole('button', { name: 'Yayınla', exact: true }).click();
      const pub = dialog(page, /Yayınla — /);
      await pub.getByRole('button', { name: 'Yayınla', exact: true }).click();
      await waitToast(page, 'yayınlandı');
      await shot(page, 'e-legal-published');
      const current = await getJson(`/api/v1/legal/${LEGAL_SLUG}`);
      assert(current.version === state.legalBaseline.version + 1 && current.id === state.legalNewId, `yayındaki sürüm v${current.version}`);
      const html = await getText('/politikalar.html');
      assert(html.includes(LEGAL_MARK), '/politikalar.html yeni metni içermiyor');
      const list = await getJson('/api/v1/legal');
      assert(list.filter((d) => d.slug === LEGAL_SLUG).length === 1, 'slug başına tek yayındaki sürüm olmalı');
      // Yayındaki sürümde gövde düzenleme 409
      const locked = await api.req('PUT', `/api/v1/admin/legal/${state.legalNewId}`, { bodyHtml: '<p>x</p>' });
      assert(locked.status === 409 && locked.data?.error === 'LEGAL_CURRENT_LOCKED', `current PUT → ${locked.status} ${JSON.stringify(locked.data).slice(0, 120)}`);
      // Sürüm arşivi: eski sürüm /legal/:slug/v/:version ile okunur
      const old = await getJson(`/api/v1/legal/${LEGAL_SLUG}/v/${state.legalBaseline.version}`);
      assert(old.id === state.legalV1Id && old.isCurrent === false, 'eski sürüm arşivden okunamadı ya da hâlâ current');
      // Geri alma: eski sürümü yeniden yayınla (API)
      await api.must('POST', `/api/v1/admin/legal/${state.legalV1Id}/publish`, {});
      const back = await getJson(`/api/v1/legal/${LEGAL_SLUG}`);
      assert(back.version === state.legalBaseline.version && back.id === state.legalV1Id, `geri alma sonrası v${back.version}`);
      const backHtml = await getText('/politikalar.html');
      assert(!backHtml.includes(LEGAL_MARK), 'geri alma sonrası politikalar hâlâ yeni metni içeriyor');
      return `kvkk v${state.legalBaseline.version} → v${state.legalBaseline.version + 1} yayınlandı (politikalar + API), 409 doğru, v${state.legalBaseline.version} yeniden yayınlandı`;
    });

    // (f) Toptan — site formu → admin
    await step('f Toptan: /toptan.html formu → 201 → admin Toptan Talepleri → durum CONTACTED → 3/dk/IP (4. istek 429)', async () => {
      // Ayrı (anonim) tarayıcı bağlamı: admin oturum çerezleri host bazlı (127.0.0.1) — aynı hostun başka portundaki
      // siteye de gider ve CsrfGuard access çerezi görünce X-CSRF-Token ister (403). Gerçek ziyaretçi anonimdir;
      // oturumlu müşteri F6'da BahcedenCart.api() ile CSRF başlığı ekler.
      const siteCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
      siteCtx.setDefaultTimeout(TIMEOUT);
      const site = await siteCtx.newPage();
      await site.goto(`${API}/toptan.html`, { waitUntil: 'networkidle' });
      const form = site.locator('#notifyForm');
      await form.locator('input[type="email"]').fill(LEAD_EMAIL);
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/wholesale-leads') && r.request().method() === 'POST'),
        form.locator('button[type="submit"]').click(),
      ]);
      assert(res.status() === 201, `site formu POST → ${res.status()}`);
      const created = await res.json();
      assert(created && created.id, '201 gövdesinde id yok');
      state.leadIds.push(created.id);
      await site.locator('#notifyMsg').waitFor({ state: 'visible' });
      const msgText = (await site.locator('#notifyMsg').textContent())?.trim();
      assert(await form.isHidden(), 'başarıda form gizlenmeli');
      assert(msgText && /Teşekkürler/.test(msgText), `başarı mesajı: ${msgText}`);
      await site.screenshot({ path: join(OUT_DIR, 'f5-f-toptan-site.png') });
      await siteCtx.close();
      // Admin listesi
      await page.goto(`${ADMIN}/toptan-talepleri`);
      await page.getByRole('heading', { name: 'Toptan Talepleri' }).waitFor();
      const row = page.locator('tbody tr').filter({ hasText: LEAD_EMAIL });
      await row.waitFor();
      await row.getByRole('combobox', { name: `${LEAD_EMAIL} durumu` }).selectOption('CONTACTED');
      await waitToast(page, 'Durum:');
      await shot(page, 'f-lead-contacted');
      const lead = await api.must('GET', `/api/v1/admin/wholesale-leads/${created.id}`);
      assert(lead.status === 'CONTACTED' && lead.email === LEAD_EMAIL, `admin API lead: ${lead.status}`);
      // Hız sınırı: aynı IP'den 3/dk (ThrottlerGuard en önde; önceki koşuların istekleri de pencerede sayılabilir) →
      // tarayıcı 1 + buradakiler: toplam 201 sayısı ≤ 3 ve dizi 429 ile biter.
      const more = [];
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${API}/api/v1/wholesale-leads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: LEAD_EMAIL, businessName: `E2E ${RUN} #${i + 2}` }),
        });
        more.push(r.status);
        if (r.status === 201) state.leadIds.push((await r.json()).id);
      }
      const okCount = 1 + more.filter((s) => s === 201).length;
      assert(more.every((s) => s === 201 || s === 429), `beklenmeyen durum kodu: ${more.join(',')}`);
      assert(okCount <= 3 && more[more.length - 1] === 429, `throttle dizisi: 201,${more.join(',')} (3/dk/IP: en çok 3×201, sonra 429)`);
      return `lead=${created.id} CONTACTED; throttle 201,${more.join(',')}`;
    });

    // (g) Bölgeler — Urla fee
    await step(`g Ayarlar › Bölgeler: Urla ücreti ${state.zone.fee}→${NEW_FEE} → bootstrap + /index.html DELIVERY_FEE → geri ${state.zone.fee}`, async () => {
      await page.goto(`${ADMIN}/ayarlar/bolgeler`);
      await page.getByRole('heading', { name: 'Bölgeler' }).waitFor();
      await page.getByRole('button', { name: `${state.zone.name} düzenle` }).click();
      const dlg = dialog(page, `Bölge düzenle — ${state.zone.name}`);
      await dlg.getByLabel(/^Kargo ücreti/).fill(String(NEW_FEE));
      await dlg.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'Bölge güncellendi');
      await shot(page, 'g-zone-fee');
      const b = await getJson('/api/v1/bootstrap');
      assert(b.deliveryFee === NEW_FEE, `bootstrap deliveryFee=${b.deliveryFee}`);
      const { payload } = await getPageBootstrap('/index.html');
      assert(payload.deliveryFee === NEW_FEE, `/index.html gömülü deliveryFee=${payload.deliveryFee}`);
      const zones = await getJson('/api/v1/delivery/zones');
      assert(zones.find((z) => z.slug === 'urla')?.fee === NEW_FEE, 'public /delivery/zones ücreti güncel değil');
      // Teslimat tarihleri önizleme (salt-okunur) ve üretim idempotent
      const gen = await api.must('POST', '/api/v1/admin/delivery/dates/generate', { weeks: 2 });
      assert(gen.zones >= 1 && gen.created === 0, `generate: ${JSON.stringify(gen)} (seed tarihleri varken yeni satır beklenmez)`);
      // geri al (API)
      await api.must('PUT', `/api/v1/admin/delivery/zones/${state.zone.id}`, { fee: state.zone.fee });
      const back = await getJson('/api/v1/bootstrap');
      assert(back.deliveryFee === state.zone.fee, `geri alma sonrası deliveryFee=${back.deliveryFee}`);
      return `DELIVERY_FEE ${state.zone.fee}→${NEW_FEE}→${back.deliveryFee}; dates/generate weeks=2 → created ${gen.created}, updated ${gen.updated}`;
    });

    // (h) Genel ayarlar — commerce.freeShippingRule
    await step('h Ayarlar › Genel: commerce.freeShippingRule gte→gt → GET /admin/settings/commerce + bootstrap commerce → geri', async () => {
      const next = state.commerceRule === 'gte' ? 'gt' : 'gte';
      await page.goto(`${ADMIN}/ayarlar`);
      await page.getByRole('heading', { name: 'Genel Ayarlar' }).waitFor();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { level: 2, name: /Kampanya ve teslimat kuralları/ }) });
      await form.waitFor();
      await form.getByLabel(/^Ücretsiz kargo eşiği karşılaştırması/).selectOption(next);
      await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'ayarları kaydedildi');
      await shot(page, 'h-commerce-rule');
      const g = await api.must('GET', '/api/v1/admin/settings/commerce');
      assert(g.fields.find((f) => f.key === 'freeShippingRule')?.value === next, 'GET /admin/settings/commerce yeni kuralı göstermiyor');
      const b = await getJson('/api/v1/bootstrap');
      const inBootstrap = b.commerce && (b.commerce.freeShippingRule === next || b.commerce.rules?.freeShippingRule === next);
      await api.must('PUT', '/api/v1/admin/settings/commerce', { freeShippingRule: state.commerceRule });
      const back = await api.must('GET', '/api/v1/admin/settings/commerce');
      assert(back.fields.find((f) => f.key === 'freeShippingRule')?.value === state.commerceRule, 'geri alma başarısız');
      return `${state.commerceRule}→${next}→${state.commerceRule}; bootstrap.commerce'te ${inBootstrap ? 'yansıdı' : 'alan yok/yansımadı (bootstrap commerce kuralı taşımıyor olabilir)'}`;
    });

    // (i) E-posta — secret
    await step('i E-posta: SMTP parolası yaz → GET maskeli+hasValue → DB şifreli (enc:v1, düz metin yok) → test düğmesi 501 → bilgi', async () => {
      await page.goto(`${ADMIN}/ayarlar/e-posta`);
      await page.getByRole('heading', { name: 'E-posta / SMS' }).waitFor();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { level: 2, name: /^E-posta$/ }) });
      await form.waitFor();
      if (state.mailHadPass) {
        // Kayıtlı değer varsa önce "Değiştir"
        await form.getByRole('button', { name: 'Değiştir' }).click();
      }
      await form.getByLabel(/^SMTP parolası/).fill(MAIL_PASS);
      await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'ayarları kaydedildi');
      await shot(page, 'i-mail-secret');
      const g = await api.must('GET', '/api/v1/admin/settings/mail');
      const pass = g.fields.find((f) => f.key === 'pass');
      assert(pass && pass.hasValue === true && pass.value === '••••••', `pass alanı: ${JSON.stringify(pass)}`);
      assert(!JSON.stringify(g).includes(MAIL_PASS), 'GET yanıtı sırrı düz metin içeriyor!');
      const raw = sql(`SELECT value::text FROM settings WHERE key = 'mail.pass'`);
      assert(raw.startsWith('"enc:v1:'), `DB değeri şifreli değil: ${raw.slice(0, 12)}…`);
      assert(!raw.includes(MAIL_PASS), 'DB değeri sırrı düz metin içeriyor!');
      const isSecret = sql(`SELECT "isSecret" FROM settings WHERE key = 'mail.pass'`);
      assert(isSecret === 't', `isSecret=${isSecret}`);
      // Maske/boş ile PUT → değişmez
      await api.must('PUT', '/api/v1/admin/settings/mail', { pass: '••••••' });
      const raw2 = sql(`SELECT value::text FROM settings WHERE key = 'mail.pass'`);
      assert(raw2 === raw, 'maske ile PUT şifreli değeri değiştirdi');
      // Test düğmesi → 501 → bilgi toast'ı
      await page.getByRole('button', { name: 'Test e-postası gönder' }).click();
      await waitToast(page, 'F6');
      return 'maskeli + hasValue; DB enc:v1 (düz metin yok); maske PUT değişmedi; test → F6 bilgisi';
    });

    // (j) Audit
    await step('j audit-logs: content / settings / delivery / wholesale satırları (actorEmail, redaksiyon)', async () => {
      const res = await api.must('GET', '/api/v1/admin/audit-logs?limit=100');
      const since = startedAt.getTime() - 5_000;
      const mine = res.items.filter((i) => new Date(i.createdAt).getTime() >= since && i.actorEmail === ADMIN_EMAIL);
      const has = (mod, action, pred = () => true) => mine.some((i) => i.module === mod && i.action === action && pred(i));
      assert(has('content', 'UPDATE', (i) => i.entityId === 'home.hero'), 'content UPDATE home.hero yok');
      assert(has('content', 'UPDATE', (i) => i.entityId === 'promoBar'), 'content UPDATE promoBar yok');
      assert(has('content', 'CREATE'), 'content CREATE (yazı/sürüm) yok');
      assert(has('content', 'PUBLISH'), 'content PUBLISH yok');
      assert(has('content', 'DELETE'), 'content DELETE (yazı) yok');
      assert(has('settings', 'UPDATE', (i) => i.entityId === 'commerce'), 'settings UPDATE commerce yok');
      assert(has('settings', 'UPDATE', (i) => i.entityId === 'mail'), 'settings UPDATE mail yok');
      assert(has('delivery', 'UPDATE'), 'delivery UPDATE (bölge) yok');
      assert(has('wholesale', 'UPDATE'), 'wholesale UPDATE (durum) yok');
      const mailRows = mine.filter((i) => i.module === 'settings' && i.entityId === 'mail');
      assert(mailRows.every((i) => !JSON.stringify(i.newValues ?? {}).includes(MAIL_PASS)), 'audit newValues SMTP parolasını içeriyor!');
      assert(mailRows.some((i) => JSON.stringify(i.newValues ?? {}).includes('[redacted]')), 'audit mail satırında [redacted] yok');
      assert(mine.every((i) => JSON.stringify(i).indexOf(ADMIN_PASSWORD) === -1), 'audit parola içeriyor');
      return `${mine.length} satır: ${[...new Set(mine.map((i) => `${i.module}:${i.action}`))].sort().join(', ')}`;
    });

    // (k) Çıkış
    await step('k çıkış → /admin/site-content 401', async () => {
      await page.goto(`${ADMIN}/`);
      await page.getByRole('button', { name: 'Çıkış' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/login');
      const r = await page.request.get(`${ADMIN}/api/v1/admin/site-content`);
      assert(r.status() === 401, `çıkış sonrası /admin/site-content → ${r.status()}`);
      return '401 doğru';
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
    await step('z geri alma + temizlik: hero/promo · yazı · KVKK (eski sürüm yayında, v2 taslağı silinir) · toptan talepleri · bölge · commerce · mail.pass → içerik ≡ baseline', async () => {
      const problems = [];
      const tryDo = async (label, fn) => {
        try {
          await fn();
        } catch (e) {
          problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      if (api.cookies.size === 0) await api.login();
      if (state.hero) await tryDo('home.hero', () => api.must('PUT', '/api/v1/admin/site-content/home.hero', { value: state.hero }));
      if (state.promo) await tryDo('promoBar', () => api.must('PUT', '/api/v1/admin/site-content/promoBar', { value: state.promo }));
      await tryDo('yazı', async () => {
        const list = await api.must('GET', `/api/v1/admin/posts?q=${encodeURIComponent(POST_SLUG)}&limit=5`);
        for (const p of list.items.filter((x) => x.slug === POST_SLUG)) await api.must('DELETE', `/api/v1/admin/posts/${p.id}`);
      });
      await tryDo('kvkk', async () => {
        if (state.legalV1Id) {
          const cur = await getJson(`/api/v1/legal/${LEGAL_SLUG}`);
          if (cur.id !== state.legalV1Id) await api.must('POST', `/api/v1/admin/legal/${state.legalV1Id}/publish`, {});
        }
        // Admin'in açtığı taslak sürüm için API'de silme yok → psql (yalnız bu koşunun, yayında olmayan satırı)
        const n = sql(`DELETE FROM legal_documents WHERE slug = ${sqlLiteral(LEGAL_SLUG)} AND "isCurrent" = false AND "bodyHtml" LIKE ${sqlLiteral(`%${LEGAL_MARK}%`)} RETURNING id`).split('\n').filter(Boolean).length;
        if (state.legalNewId && n === 0) throw new Error('KVKK taslağı silinemedi');
      });
      await tryDo('toptan', () => {
        sql(`DELETE FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`);
      });
      if (state.zone) await tryDo('bölge', () => api.must('PUT', `/api/v1/admin/delivery/zones/${state.zone.id}`, { fee: state.zone.fee }));
      if (state.commerceRule) await tryDo('commerce', () => api.must('PUT', '/api/v1/admin/settings/commerce', { freeShippingRule: state.commerceRule }));
      await tryDo('mail.pass', () => {
        // Sır yalnız bu koşuda yazıldıysa satırı kaldır (API'de "sırrı sil" yok; boş/maske = değiştirme). Önceden değer varsa dokunma (üzerine yazılmıştı — not düşülür).
        if (!state.mailHadPass) sql(`DELETE FROM settings WHERE key = 'mail.pass'`);
      });
      if (problems.length) throw new Error(`geri alma sorunları: ${problems.join(' · ')}`);

      // Doğrulama
      const siteMap = await getJson('/api/v1/site-content');
      assert(deepEqual(siteMap, state.siteMapBaseline), 'site-content baseline\'dan farklı');
      const kvkk = await getJson(`/api/v1/legal/${LEGAL_SLUG}`);
      assert(kvkk.version === state.legalBaseline.version && kvkk.id === state.legalV1Id, `kvkk v${kvkk.version}`);
      assert((await getJson('/api/v1/legal')).length === state.legalCount, 'legal sayısı değişti');
      const legalRows = Number(sql(`SELECT count(*) FROM legal_documents WHERE slug = ${sqlLiteral(LEGAL_SLUG)}`));
      assert(legalRows === 1, `kvkk satır sayısı ${legalRows} (beklenen 1)`);
      assert((await getJson('/api/v1/posts?limit=1')).total === state.postsTotal, 'posts total değişti');
      const leads = Number(sql(`SELECT count(*) FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`));
      assert(leads === 0, `toptan talepleri kaldı: ${leads}`);
      const b = await getJson('/api/v1/bootstrap');
      assert(b.deliveryFee === state.bootstrapBaseline.deliveryFee, `deliveryFee ${b.deliveryFee}`);
      const stable = (x) => ({ products: x.products, tiers: x.tiers, templates: x.templates, pool: x.pool, pairIds: x.pairIds, recommendedTier: x.recommendedTier, deliveryFee: x.deliveryFee, commerce: x.commerce });
      assert(deepEqual(stable(b), stable(state.bootstrapBaseline)), 'bootstrap (sabit kısım) baseline\'dan farklı');
      const commerce = await api.must('GET', '/api/v1/admin/settings/commerce');
      assert(commerce.fields.find((f) => f.key === 'freeShippingRule')?.value === state.commerceRule, 'freeShippingRule geri alınmadı');
      const mailRow = sql(`SELECT count(*) FROM settings WHERE key = 'mail.pass'`);
      return `site-content ≡, kvkk v${kvkk.version} (1 satır), posts ${state.postsTotal}, leads 0, DELIVERY_FEE ${b.deliveryFee}, freeShippingRule ${state.commerceRule}, mail.pass satırı ${mailRow}${state.mailHadPass ? ' (önceden değer vardı — üzerine yazıldı, not)' : ''}`;
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
    '# e2e-admin F5 raporu',
    '',
    `- Tarih: ${startedAt.toISOString()} · API: ${API} · Admin: ${ADMIN} · run: ${RUN}`,
    `- Sonuç: ${failed ? 'HATA' : 'TÜM ADIMLAR OK'} (${results.filter((r) => r.ok).length}/${results.length})`,
    '',
    '| Adım | Durum | Süre | Not |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|')} |`),
    '',
    'Ekran görüntüleri: `tools/e2e-admin/out/f5-*.png`. Sırlar çıktıya yazılmaz; admin kimliği ve DB bağlantısı apps/api/.env (SEED_ADMIN_*, DATABASE_URL).',
    '',
  ];
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[e2e-f5] beklenmeyen hata:', err);
  process.exit(1);
});
