// tools/e2e-admin/run-f6.mjs — F6 üyelik + hesap + adres + e-posta çekirdeği uçtan uca doğrulama
// (Playwright + gerçek API + gerçek DB + DISABLE_MAIL önizleme dosyaları).
//
// F4/F5 kalıbı: geçici API (:4053, WEB_URL/ADMIN_URL geçici portlara ayarlı) + admin preview (:4054, proxy'li) önceden
// ayağa kaldırılır. Müşteri akışı SİTE sayfalarında (uyelik.hbs / sepet.hbs + cart.js `BahcedenCart.api()`), yönetim
// akışı admin panelinde koşar; her adım public yüzey, API, MailLog (+ önizleme dosyası) ve psql ile doğrulanır:
//   (a) /uyelik.html → Üye ol (KVKK işaretli, pazarlama işaretsiz) → 201 + çerezler → sayfa yenilenir → bootstrap `me` dolu,
//       hesap görünümü; çerezli HTML `private, no-store`; Consent satırları (KVKK granted / MARKETING_EMAIL false, İYS PENDING)
//   (b) MailLog welcome + verify SKIPPED + önizleme dosyası var → verify bağlantısı önizlemeden → GET → 302 ?dogrulandi=1
//       → emailVerifiedAt dolu → sayfada bilgi notu
//   (c) çıkış (POST /auth/logout) → giriş formu geri, çerez yok · (d) yanlış parola → mesaj; "parolamı unuttum" → 200 + not;
//       doğru parola → hesap görünümü · (e) çıkış → reset önizlemesinden ?sifirla=<token> → yeni parola → anında giriş + flash
//   (f) API: eski parola 401, yeni parola 200; MailLog password-changed · (g) adres formu (ilçe select: /delivery/zones)
//       → PUT /me/address 200 → özet → GET /me/address (zoneSlug urla) · (h) sepet.html: giriş kapısı açık, formlar
//       oturum/adresten dolu, teslimat adımı açılıyor
//   (i) admin: Müşteriler listesi (arama) → detay (onaylar, adres, audit) → ad PATCH → Anonimleştir → e-posta anon, adres
//       silindi, oturum düştü (müşteri API 401) · (j) Sistem › E-posta günlüğü satırları · (k) Ayarlar › E-posta test gönder
//       → SKIPPED + önizleme · (l) audit-logs · (m) çıkış 401
//   (z) temizlik: test kullanıcısı (consents/addresses/mail_logs/audit/users), test e-postası satırları, önizleme dosyaları
// Kullanım (repo kökünden):
//   node tools/e2e-admin/run-f6.mjs [--api=http://127.0.0.1:4053] [--admin=http://127.0.0.1:4054] [--headed] [--keep] [--timeout=20000]
// Çıktı: tools/e2e-admin/out/f6-*.png, tools/e2e-admin/report-f6.md. Çıkış kodu: hata varsa 1. Sırlar (SEED_ADMIN_*,
// DATABASE_URL) yalnız env'den okunur; çıktıya yazılmaz.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report-f6.md');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4053').replace(/\/$/, '');
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://127.0.0.1:4054').replace(/\/$/, '');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 20_000);
const PSQL = process.env.PSQL || 'psql';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
/** psql için bağlantı dizesi: Prisma'ya özgü sorgu parametreleri libpq'da geçersiz → atılır. */
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
const EMAIL = `e2e-f6-${RUN}@example.com`;
const PASSWORD = `E2e-Parola-${RUN}`;
const NEW_PASSWORD = `E2e-Yeni-${RUN}`;
const ADDRESS = { name: `E2E Üye ${RUN}`, phone: '0530 000 00 00', line: `E2E Mahallesi ${RUN} Sokak No:1 D:2`, zone: 'urla', zoneName: 'Urla', zip: '35430' };
const PATCHED_NAME = `E2E Müşteri ${RUN}`;
const LEAD_EMAIL = `e2e-f6-toptan-${RUN}@example.com`;

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f6] ${msg}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`DOĞRULAMA: ${msg}`);
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
/** psql -tAc. Bağlantı dizesi (parola) hata mesajına/çıktıya YAZILMAZ — yalnız psql stderr'i. */
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
function sqlLines(query) {
  const out = sql(query);
  // Windows psql satır sonları CRLF olabilir → her satır kırpılır.
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}
const PREVIEW_PREFIX = 'preview:';
/** MailLog satırı (templateSlug + entityId ya da alıcı) → {id,status,path,html}. Önizleme dosyası DISABLE_MAIL=true iken yazılır. */
function readPreview(templateSlug, entityId) {
  const rows = sqlLines(
    `SELECT id || E'\\t' || status || E'\\t' || coalesce(error,'') FROM mail_logs WHERE "templateSlug" = ${sqlLiteral(templateSlug)} AND "entityId" = ${sqlLiteral(entityId)}`,
  );
  assert(rows.length === 1, `MailLog ${templateSlug}/${entityId} beklenen 1 satır, ${rows.length} bulundu`);
  const [id, status, error] = rows[0].split('\t');
  assert(status === 'SKIPPED', `MailLog ${templateSlug} status=${status} (DISABLE_MAIL → SKIPPED beklenir)`);
  assert(error.startsWith(PREVIEW_PREFIX), `MailLog ${templateSlug} error önizleme yolu değil: ${error.slice(0, 60)}`);
  const path = error.slice(PREVIEW_PREFIX.length).trim();
  assert(existsSync(path), `önizleme dosyası yok: ${path}`);
  return { id, status, path, html: readFileSync(path, 'utf8') };
}
/** HTML içindeki ilk `href` — verilen parçayı içeren bağlantı (HTML varlıkları çözülür). */
function linkFrom(html, includes) {
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].replace(/&amp;/g, '&').replace(/&#x3D;/g, '=').replace(/&#x2F;/g, '/').replace(/&#x3F;/g, '?');
    if (href.includes(includes)) return href;
  }
  throw new Error(`önizlemede bağlantı yok: *${includes}*`);
}

/** Çerez kavanozlu API istemcisi (kurulum / doğrulama / temizlik için; tarayıcıdan bağımsız oturum). */
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
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
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
  async login(email, password) {
    await this.req('GET', '/api/v1/auth/csrf');
    return this.req('POST', '/api/v1/auth/login', { email, password });
  }
  async loginAdmin() {
    const r = await this.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (r.status !== 200) throw new Error(`API admin girişi başarısız: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.user;
  }
  async must(method, path, body, expected = [200, 201, 204]) {
    const r = await this.req(method, path, body);
    if (!expected.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  }
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
/** Sayfadaki gömülü bootstrap JSON'u (partials/bootstrap.hbs) + yanıt başlıkları; çerez verilirse oturumlu istek. */
async function getPage(path, cookie) {
  const res = await fetch(`${API}${path}`, { headers: cookie ? { cookie } : {} });
  const html = await res.text();
  const m = html.match(/window\.__BAGDAM__ = (.*?); var PRODUCTS = /s);
  return { status: res.status, html, cacheControl: res.headers.get('cache-control'), payload: m ? JSON.parse(m[1]) : null };
}

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function waitToast(page, text) {
  const loc = page.getByRole('status').filter({ hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `f6-${name}.png`), fullPage: false }).catch(() => {});
}
function dialog(page, titleText) {
  return page.getByRole('dialog').filter({ hasText: titleText });
}
async function cookieNames(ctx, url) {
  return (await ctx.cookies(url)).map((c) => c.name).sort();
}
/** Sitedeki giriş formu (uyelik/sepet ortak kimlikler): e-posta + parola → giriş yap. */
async function siteLogin(page, email, password) {
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginSubmit').click();
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const admin = new ApiClient(API);
  const customer = new ApiClient(API);
  const state = {
    userId: null,
    usersBefore: null,
    mailLogsBefore: null,
    addressesBefore: null,
    customersTotalBefore: null,
    previewPaths: [],
    testMailLogIds: [],
    verifyUrl: null,
    resetUrl: null,
  };
  let browser;
  let failed = false;

  try {
    await step('0 hazırlık: admin API girişi · başlangıç sayımları · anonim /uyelik.html me:null + public cache', async () => {
      const me = await admin.loginAdmin();
      assert(me && me.role === 'ADMIN', 'seed admin ADMIN rolünde olmalı');
      state.usersBefore = Number(sql('SELECT count(*) FROM users'));
      state.mailLogsBefore = Number(sql('SELECT count(*) FROM mail_logs'));
      state.addressesBefore = Number(sql('SELECT count(*) FROM addresses'));
      const list = await admin.must('GET', '/api/v1/admin/customers?limit=1');
      state.customersTotalBefore = list.total;
      const anon = await getPage('/uyelik.html');
      assert(anon.status === 200 && anon.payload && anon.payload.me === null, 'anonim /uyelik.html bootstrap me null olmalı');
      assert(/public/.test(anon.cacheControl || ''), `anonim Cache-Control: ${anon.cacheControl}`);
      const zones = await getJson('/api/v1/delivery/zones');
      assert(zones.some((z) => z.slug === ADDRESS.zone), 'public /delivery/zones urla içermiyor');
      assert(Number(sql(`SELECT count(*) FROM users WHERE email = ${sqlLiteral(EMAIL)}`)) === 0, 'test e-postası zaten kayıtlı');
      return `users=${state.usersBefore} mail_logs=${state.mailLogsBefore} addresses=${state.addressesBefore} customers.total=${state.customersTotalBefore} · anonim Cache-Control "${anon.cacheControl}" · zones ${zones.map((z) => z.slug).join(',')}`;
    });

    browser = await chromium.launch({ headless: !HEADED });
    // Site ve admin AYRI bağlam: çerezler host bazlı (127.0.0.1) — aynı hostun farklı portlarında paylaşılır.
    const siteCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    siteCtx.setDefaultTimeout(TIMEOUT);
    const site = await siteCtx.newPage();
    const siteErrors = [];
    site.on('pageerror', (e) => siteErrors.push(`pageerror: ${e.message}`));
    site.on('console', (m) => {
      if (m.type() === 'error') siteErrors.push(`console: ${m.text().slice(0, 200)}`);
    });

    // (a) Üye ol
    await step('a site /uyelik.html → Üye ol (KVKK işaretli, pazarlama işaretsiz) → anında giriş: bootstrap me, hesap görünümü, çerezler, no-store, Consent satırları', async () => {
      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      assert(await site.locator('#checkoutAuth').isVisible(), 'anonim sayfada giriş kutusu görünmeli');
      assert(await site.locator('#accountGrid').isHidden(), 'anonim sayfada hesap görünümü gizli olmalı');
      await site.locator('.checkout-auth-tab[data-mode="signup"]').click();
      await site.locator('#authFormSignup').waitFor({ state: 'visible' });
      // İstisna 2 blokları: KVKK (zorunlu) + pazarlama (isteğe bağlı)
      assert(await site.locator('#signupKvkk').isVisible() && (await site.locator('#signupMarketing').isVisible()), 'KVKK/pazarlama kutucukları görünmeli');
      await site.locator('#signupEmail').fill(EMAIL);
      await site.locator('#signupEmailConfirm').fill(EMAIL);
      await site.locator('#signupPassword').fill(PASSWORD);
      await site.locator('#signupPasswordConfirm').fill(PASSWORD);
      // KVKK işaretsiz → istemci tarafı engel (API'ye gitmez)
      await site.locator('#signupSubmit').click();
      await site.locator('#signupMsg').waitFor({ state: 'visible' });
      const kvkkMsg = (await site.locator('#signupMsg').textContent())?.trim();
      assert(/KVKK/.test(kvkkMsg || ''), `KVKK işaretsiz mesajı: ${kvkkMsg}`);
      await site.locator('#signupKvkk').check();
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/register') && r.request().method() === 'POST'),
        site.locator('#signupSubmit').click(),
      ]);
      assert(res.status() === 201, `POST /auth/register → ${res.status()}`);
      // Gövde okunmaz: cart.js 201'den hemen sonra sayfayı yeniler (yanıt gövdesi gezinmeyle düşer) — kullanıcı DB'den.
      // Sayfa yenilenir → bootstrap me dolu → hesap görünümü
      await site.locator('#accountGrid').waitFor({ state: 'visible' });
      const userRow = sql(`SELECT id || ':' || role || ':' || "isActive" FROM users WHERE email = ${sqlLiteral(EMAIL)}`);
      assert(/^[a-z0-9]+:CUSTOMER:true$/.test(userRow), `kullanıcı satırı: ${userRow}`);
      state.userId = userRow.split(':')[0];
      assert(await site.locator('#checkoutAuth').isHidden(), 'giriş sonrası giriş kutusu gizlenmeli');
      assert(await site.locator('#logoutNote').isVisible(), '"çıkış yap" bağlantısı görünmeli');
      const me = await site.evaluate(() => (window.__BAGDAM__ && window.__BAGDAM__.me) || null);
      assert(me && me.loggedIn === true && me.email === EMAIL && me.id === state.userId, `bootstrap me: ${JSON.stringify(me)}`);
      assert(await site.evaluate(() => document.body.classList.contains('is-logged-in')), 'body.is-logged-in yok');
      const names = await cookieNames(siteCtx, API);
      const authNames = await cookieNames(siteCtx, `${API}/api/v1/auth/refresh`); // refresh çerezi path=/api/v1/auth
      assert(names.includes('access_token') && names.includes('csrf_token') && authNames.includes('refresh_token'), `çerezler: ${names.join(',')} · auth yolu: ${authNames.join(',')}`);
      // Eski prototip yerel kayıtları yazılmıyor
      const ls = await site.evaluate(() => ['bahceden_member', 'bahceden_session', 'bahceden_address'].map((k) => localStorage.getItem(k)));
      assert(ls.every((v) => v === null), `localStorage üyelik izleri: ${JSON.stringify(ls)}`);
      // Çerezli HTML private, no-store
      const access = (await siteCtx.cookies(API)).find((c) => c.name === 'access_token');
      const withCookie = await getPage('/uyelik.html', `access_token=${access.value}`);
      assert(withCookie.payload && withCookie.payload.me && withCookie.payload.me.loggedIn === true, 'çerezli HTML bootstrap me dolu olmalı');
      assert(/private/.test(withCookie.cacheControl || '') && /no-store/.test(withCookie.cacheControl || ''), `çerezli Cache-Control: ${withCookie.cacheControl}`);
      // Consent satırları
      const consents = sqlLines(`SELECT kind || ':' || granted || ':' || "iysStatus" || ':' || source FROM consents WHERE "userId" = ${sqlLiteral(state.userId)} ORDER BY kind`);
      assert(consents.includes('KVKK_ACK:true:NOT_APPLICABLE:HS_WEB'), `KVKK onayı satırı yok: ${consents.join(' | ')}`);
      assert(consents.includes('MARKETING_EMAIL:false:PENDING:HS_WEB'), `pazarlama izni (false) satırı yok: ${consents.join(' | ')}`);
      const docs = Number(sql(`SELECT count(*) FROM consents c JOIN legal_documents d ON d.id = c."documentId" WHERE c."userId" = ${sqlLiteral(state.userId)} AND d."isCurrent"`));
      assert(docs === 2, `onaylar yayındaki yasal belgeye bağlı olmalı (2), ${docs}`);
      const opt = sql(`SELECT "marketingOptIn"::text || ':' || coalesce("emailVerifiedAt"::text,'null') FROM users WHERE id = ${sqlLiteral(state.userId)}`);
      assert(opt === 'false:null', `users.marketingOptIn/emailVerifiedAt: ${opt}`);
      await shot(site, 'a-uyelik-registered');
      return `uid=${state.userId}; çerezler ${names.join(',')}; Cache-Control "${withCookie.cacheControl}"; consents ${consents.join(' | ')}`;
    });

    // (b) MailLog + verify
    await step('b MailLog welcome+verify SKIPPED + önizleme dosyası → verify bağlantısı → 302 ?dogrulandi=1 → emailVerifiedAt dolu → sayfada bilgi notu', async () => {
      const welcome = readPreview('welcome', state.userId);
      const verify = readPreview('verify', state.userId);
      state.previewPaths.push(welcome.path, verify.path);
      assert(welcome.html.includes(EMAIL), 'hoş geldin önizlemesi alıcı e-postasını içermiyor');
      const verifyUrl = linkFrom(verify.html, '/api/v1/auth/verify?token=');
      state.verifyUrl = verifyUrl;
      assert(verifyUrl.startsWith(API), `verify bağlantısı WEB_URL'e gitmeli (${API}): ${verifyUrl.slice(0, 60)}`);
      const res = await fetch(verifyUrl, { redirect: 'manual' });
      assert(res.status === 302, `GET verify → ${res.status}`);
      const location = res.headers.get('location') || '';
      assert(location === `${API}/uyelik.html?dogrulandi=1`, `verify Location: ${location}`);
      const verifiedAt = sql(`SELECT coalesce("emailVerifiedAt"::text,'null') FROM users WHERE id = ${sqlLiteral(state.userId)}`);
      assert(verifiedAt !== 'null', 'emailVerifiedAt dolmadı');
      // İkinci tıklama idempotent (yine 1)
      const again = await fetch(verifyUrl, { redirect: 'manual' });
      assert((again.headers.get('location') || '').endsWith('?dogrulandi=1'), 'ikinci verify de başarı sayfasına gitmeli');
      // Geçersiz (imzası tutmayan) token → ?dogrulandi=0; biçimsiz token (DTO) → 400 JSON
      const bad = await fetch(`${API}/api/v1/auth/verify?token=${'x'.repeat(24)}.${'y'.repeat(32)}.${'z'.repeat(24)}`, { redirect: 'manual' });
      assert((bad.headers.get('location') || '').endsWith('?dogrulandi=0'), `geçersiz token Location: ${bad.headers.get('location')}`);
      const malformed = await fetch(`${API}/api/v1/auth/verify?token=bozuk`, { redirect: 'manual' });
      assert(malformed.status === 400, `biçimsiz token → ${malformed.status}`);
      // Sayfa: bilgi notu (mevcut kalıp: #authInfo)
      await site.goto(location, { waitUntil: 'networkidle' });
      await site.locator('#authInfo').waitFor({ state: 'visible' });
      const info = (await site.locator('#authInfo').textContent())?.trim();
      assert(/doğrulandı/i.test(info || ''), `bilgi notu: ${info}`);
      assert(!site.url().includes('dogrulandi'), 'adres çubuğundan ?dogrulandi silinmeli');
      await shot(site, 'b-verified');
      return `welcome ${welcome.id} · verify ${verify.id} → 302 ${location.replace(API, '')} · emailVerifiedAt ${verifiedAt.slice(0, 19)} · not "${info}"`;
    });

    // (c) Çıkış
    await step('c çıkış (POST /auth/logout 204) → giriş formu geri, çerezler silindi, yenilemede anonim', async () => {
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/logout') && r.request().method() === 'POST'),
        site.locator('#logoutLink').click(),
      ]);
      assert(res.status() === 204, `POST /auth/logout → ${res.status()}`);
      await site.locator('#checkoutAuth').waitFor({ state: 'visible' });
      assert(await site.locator('#accountGrid').isHidden(), 'çıkış sonrası hesap görünümü gizlenmeli');
      const names = await cookieNames(siteCtx, API);
      assert(!names.includes('access_token') && !names.includes('csrf_token'), `çıkış sonrası çerezler: ${names.join(',')}`);
      await site.reload({ waitUntil: 'networkidle' });
      const me = await site.evaluate(() => (window.__BAGDAM__ && window.__BAGDAM__.me) || null);
      assert(me === null, `yenileme sonrası me: ${JSON.stringify(me)}`);
      assert(sql(`SELECT coalesce("refreshTokenHash",'') FROM users WHERE id = ${sqlLiteral(state.userId)}`) === '', 'refreshTokenHash temizlenmeli');
      return 'logout 204; çerez yok; me null; refreshTokenHash null';
    });

    // (d) Giriş: yanlış → mesaj; parolamı unuttum; doğru → hesap
    await step('d giriş: yanlış parola → mesaj · "parolamı unuttum" → POST /auth/forgot 200 + not · doğru parola → hesap görünümü', async () => {
      const [bad] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST'),
        siteLogin(site, EMAIL, 'yanlis-parola-123'),
      ]);
      assert(bad.status() === 401, `yanlış parola → ${bad.status()}`);
      await site.locator('#loginMsg').waitFor({ state: 'visible' });
      const msg = (await site.locator('#loginMsg').textContent())?.trim();
      assert(/parola hatalı/i.test(msg || ''), `yanlış parola mesajı: ${msg}`);
      assert(await site.locator('#accountGrid').isHidden(), 'yanlış parola ile giriş olmamalı');
      // İstisna 4: parolamı unuttum
      assert(await site.locator('#forgotNote').isVisible(), '"parolamı unuttum" bağlantısı görünmeli');
      const [forgot] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/forgot') && r.request().method() === 'POST'),
        site.locator('#forgotLink').click(),
      ]);
      assert(forgot.status() === 200, `POST /auth/forgot → ${forgot.status()}`);
      await site.locator('#loginMsg').filter({ hasText: /sıfırlama bağlantısını gönderdik/ }).waitFor({ state: 'visible' });
      const token = sql(`SELECT coalesce("passwordResetToken",'') || ':' || coalesce("passwordResetExpires"::text,'') FROM users WHERE id = ${sqlLiteral(state.userId)}`);
      assert(/^[0-9a-f]{64}:/.test(token), 'passwordResetToken sha256 + süre yazılmalı');
      // Bilinmeyen e-posta da 200 (keşif yok) — 3/dk/IP sınırı: art arda koşularda 429 gelebilir (pencere), o zaman yalnız not düşülür.
      const unknown = await fetch(`${API}/api/v1/auth/forgot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `yok-${RUN}@example.com` }) });
      assert(unknown.status === 200 || unknown.status === 429, `bilinmeyen e-posta forgot → ${unknown.status}`);
      const unknownNote = unknown.status === 200 ? 'bilinmeyen e-posta da 200' : 'bilinmeyen e-posta 429 (3/dk/IP penceresi — önceki koşu)';
      // Doğru parola
      await site.locator('#loginPassword').fill(PASSWORD);
      const [ok] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST'),
        site.locator('#loginSubmit').click(),
      ]);
      assert(ok.status() === 200, `doğru parola → ${ok.status()}`);
      await site.locator('#accountGrid').waitFor({ state: 'visible' });
      const me = await site.evaluate(() => (window.__BAGDAM__ && window.__BAGDAM__.me) || null);
      assert(me && me.email === EMAIL, `giriş sonrası me: ${JSON.stringify(me)}`);
      await shot(site, 'd-logged-in');
      return `401 "${msg}"; forgot 200 (token sha256 DB'de; ${unknownNote}); login 200 → hesap`;
    });

    // (e) Sıfırlama bağlantısı
    await step('e çıkış → reset önizlemesinden ?sifirla=<token> → sıfırlama dalı → yeni parola → 200 + anında giriş + flash notu', async () => {
      await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/logout')),
        site.locator('#logoutLink').click(),
      ]);
      await site.locator('#checkoutAuth').waitFor({ state: 'visible' });
      const reset = readPreview('reset', state.userId);
      state.previewPaths.push(reset.path);
      const resetUrl = linkFrom(reset.html, 'uyelik.html?sifirla=');
      state.resetUrl = resetUrl;
      assert(resetUrl.startsWith(`${API}/uyelik.html?sifirla=`), `reset bağlantısı: ${resetUrl.slice(0, 60)}`);
      assert(/60 dakika/.test(reset.html), 'reset önizlemesi süre metnini (60 dakika) içermeli');
      await site.goto(resetUrl, { waitUntil: 'networkidle' });
      assert(!site.url().includes('sifirla'), 'token adres çubuğundan silinmeli');
      await site.locator('#resetPassword').waitFor({ state: 'visible' });
      assert(await site.locator('#resetSubmit').isVisible(), '"parolamı yenile" düğmesi görünmeli');
      assert(await site.locator('#loginSubmit').isHidden() && (await site.locator('#loginEmail').isHidden()), 'sıfırlama dalında giriş alanları gizli olmalı');
      const hint = (await site.locator('#loginMsg').textContent())?.trim();
      assert(/yeni parolanı belirle/i.test(hint || ''), `sıfırlama ipucu: ${hint}`);
      await shot(site, 'e-reset-form');
      // Kısa parola → istemci engeli
      await site.locator('#resetPassword').fill('kisa');
      await site.locator('#resetSubmit').click();
      await site.locator('#loginMsg').filter({ hasText: /en az 8 karakter/ }).waitFor({ state: 'visible' });
      await site.locator('#resetPassword').fill(NEW_PASSWORD);
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/auth/reset') && r.request().method() === 'POST'),
        site.locator('#resetSubmit').click(),
      ]);
      assert(res.status() === 200, `POST /auth/reset → ${res.status()}`);
      await site.locator('#accountGrid').waitFor({ state: 'visible' });
      const me = await site.evaluate(() => (window.__BAGDAM__ && window.__BAGDAM__.me) || null);
      assert(me && me.email === EMAIL, `sıfırlama sonrası me: ${JSON.stringify(me)}`);
      await site.locator('#authInfo').waitFor({ state: 'visible' });
      const flash = (await site.locator('#authInfo').textContent())?.trim();
      assert(/Parolan güncellendi/.test(flash || ''), `flash notu: ${flash}`);
      assert(sql(`SELECT coalesce("passwordResetToken",'') FROM users WHERE id = ${sqlLiteral(state.userId)}`) === '', 'reset token temizlenmeli');
      // Aynı token ikinci kez → 400 RESET_TOKEN_INVALID
      const tokenValue = new URL(resetUrl).searchParams.get('sifirla');
      const reuse = await fetch(`${API}/api/v1/auth/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenValue, password: NEW_PASSWORD }) });
      assert(reuse.status === 400 && (await reuse.json()).error === 'RESET_TOKEN_INVALID', `token yeniden kullanım → ${reuse.status}`);
      const changed = readPreview('password-changed', state.userId);
      state.previewPaths.push(changed.path);
      await shot(site, 'e-reset-done');
      return `reset 200 → hesap görünümü; flash "${flash}"; token tek kullanımlık (400); password-changed ${changed.id}`;
    });

    // (f) API: eski/yeni parola
    await step('f API: eski parola → 401, yeni parola → 200 (çerezler) · GET /auth/me · CSRF\'siz PUT /me/address 403', async () => {
      const old = await customer.login(EMAIL, PASSWORD);
      assert(old.status === 401, `eski parola → ${old.status}`);
      const fresh = await customer.login(EMAIL, NEW_PASSWORD);
      assert(fresh.status === 200 && fresh.data.user.id === state.userId, `yeni parola → ${fresh.status}`);
      const me = await customer.must('GET', '/api/v1/auth/me');
      assert(me.email === EMAIL && me.role === 'CUSTOMER', `GET /auth/me: ${JSON.stringify(me).slice(0, 120)}`);
      const noCsrf = await customer.req('PUT', '/api/v1/me/address', { fullName: 'x', phone: '05300000000', line: 'abcdef', zoneSlug: 'urla' }, { csrf: false });
      assert(noCsrf.status === 403, `CSRF'siz PUT /me/address → ${noCsrf.status}`);
      const addr = await customer.req('GET', '/api/v1/me/address');
      assert(addr.status === 200 && addr.data === null, `henüz adres yokken GET /me/address: ${addr.status} ${JSON.stringify(addr.data)}`);
      const consents = await customer.must('GET', '/api/v1/me/consents');
      assert(consents.some((c) => c.kind === 'KVKK_ACK' && c.granted === true) && consents.some((c) => c.kind === 'MARKETING_EMAIL' && c.granted === false), `GET /me/consents: ${JSON.stringify(consents)}`);
      return `401/200; /auth/me ok; CSRF'siz PUT 403; adres null; consents ${consents.map((c) => `${c.kind}=${c.granted}`).join(',')}`;
    });

    // (g) Adres formu
    await step('g uyelik adres formu (ilçe select: /delivery/zones, Urla) → PUT /me/address 200 → özet → GET /me/address zoneSlug urla', async () => {
      await site.locator('#addressForm').waitFor({ state: 'visible' });
      const options = await site.locator('#addrDistrict option').allTextContents();
      assert(options.map((o) => o.trim()).includes('Urla') && options.map((o) => o.trim()).includes('Çeşme'), `ilçe seçenekleri: ${options.join(',')}`);
      assert((await site.locator('#addrDistrict').evaluate((el) => el.tagName)) === 'SELECT', '#addrDistrict select olmalı (istisna 5)');
      await site.locator('#addrName').fill(ADDRESS.name);
      await site.locator('#addrPhone').fill(ADDRESS.phone);
      await site.locator('#addrLine').fill(ADDRESS.line);
      await site.locator('#addrDistrict').selectOption(ADDRESS.zone);
      await site.locator('#addrZip').fill(ADDRESS.zip);
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/me/address') && r.request().method() === 'PUT'),
        site.locator('#addrSubmit').click(),
      ]);
      assert(res.status() === 200, `PUT /me/address → ${res.status()}`);
      const saved = await res.json();
      assert(saved.zoneSlug === ADDRESS.zone && saved.fullName === ADDRESS.name && saved.isDefault === true, `PUT yanıtı: ${JSON.stringify(saved)}`);
      await site.locator('#editAddrBtn').waitFor({ state: 'visible' });
      const summary = (await site.locator('#addressCard .account-empty').textContent())?.trim();
      assert(summary && summary.includes(ADDRESS.name) && summary.includes(ADDRESS.zoneName) && summary.includes(ADDRESS.zip), `adres özeti: ${summary}`);
      const addr = await customer.must('GET', '/api/v1/me/address');
      assert(addr && addr.fullName === ADDRESS.name && addr.phone === ADDRESS.phone && addr.line === ADDRESS.line && addr.zoneSlug === ADDRESS.zone && addr.zip === ADDRESS.zip, `GET /me/address: ${JSON.stringify(addr)}`);
      assert(Number(sql(`SELECT count(*) FROM addresses WHERE "userId" = ${sqlLiteral(state.userId)} AND "isDefault"`)) === 1, 'tek varsayılan adres satırı olmalı');
      // Yenilemede adres sunucudan yüklenir (özet)
      await site.reload({ waitUntil: 'networkidle' });
      await site.locator('#editAddrBtn').waitFor({ state: 'visible' });
      // Düzenle → telefon değiştir + posta kodunu boşalt → aynı satır güncellenir (upsert), zip null
      await site.locator('#editAddrBtn').click();
      await site.locator('#addrPhone').fill('0530 111 22 33');
      await site.locator('#addrZip').fill('');
      const [res2] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/me/address') && r.request().method() === 'PUT'),
        site.locator('#addrSubmit').click(),
      ]);
      assert(res2.status() === 200, `ikinci PUT → ${res2.status()}`);
      assert(Number(sql(`SELECT count(*) FROM addresses WHERE "userId" = ${sqlLiteral(state.userId)}`)) === 1, 'upsert: hâlâ tek satır olmalı');
      const after = await customer.must('GET', '/api/v1/me/address');
      assert(after.phone === '0530 111 22 33' && after.id === addr.id && after.zip === null, `güncelleme: ${JSON.stringify(after)}`);
      await shot(site, 'g-address-saved');
      return `id=${addr.id} zone=${addr.zoneSlug} zip=${addr.zip}; düzenleme aynı satırı güncelledi (zip boşaltıldı → null)`;
    });

    // (h) sepet
    await step('h sepet.html (oturumlu + sepette ürün): giriş kapısı açık, müşteri formu oturum/adresten dolu, teslimat adımı açılıyor', async () => {
      await site.evaluate(() => localStorage.setItem('bahceden_cart', JSON.stringify([{ id: 'ekmek', qty: 1, pref: null }])));
      await site.goto(`${API}/sepet.html`, { waitUntil: 'networkidle' });
      assert(await site.evaluate(() => document.body.classList.contains('is-logged-in')), 'sepet body.is-logged-in yok');
      assert(await site.locator('#checkoutAuth').isHidden(), 'sepette giriş kutusu gizli olmalı');
      await site.locator('#checkoutSections').waitFor({ state: 'visible' });
      await site.waitForFunction((email) => document.getElementById('custEmail')?.value === email, EMAIL);
      await site.waitForFunction((name) => document.getElementById('custName')?.value === name, ADDRESS.name);
      const form = await site.evaluate(() => ({
        phone: document.getElementById('custPhone').value,
        line: document.getElementById('custAddress').value,
        district: document.getElementById('custDistrict').value,
        zip: document.getElementById('custZip').value,
      }));
      assert(form.phone === '0530 111 22 33' && form.line === ADDRESS.line && form.district === ADDRESS.zoneName && form.zip === '', `sepet müşteri formu: ${JSON.stringify(form)}`);
      // Müşteri bilgileri tam → teslimat adımı (form) açılır
      await site.waitForFunction(() => { const el = document.getElementById('deliveryForm'); return el && !el.hidden; });
      assert(await site.locator('#checkoutDeliveryDay .toggle').first().isVisible(), 'teslimat günü seçenekleri görünmeli');
      const cartCount = (await site.locator('.floating-cart-count').first().textContent().catch(() => ''))?.trim();
      await shot(site, 'h-sepet-logged-in');
      return `formlar dolu (${ADDRESS.zoneName}); teslimat adımı açık; sepet sayacı "${cartCount}"`;
    });

    // (h2) Oturumlu müşteri toptan formu — CsrfGuard access çerezi görünce X-CSRF-Token ister (F5 açık notu):
    // toptan.hbs formu BahcedenCart.api() ile gönderir → 201 (anonim akış F5 e2e'de).
    await step('h2 toptan.html (oturumlu müşteri): form → BahcedenCart.api → X-CSRF-Token → 201 (CSRF 403 yok)', async () => {
      await site.goto(`${API}/toptan.html`, { waitUntil: 'networkidle' });
      const form = site.locator('#notifyForm');
      await form.locator('input[type="email"]').fill(LEAD_EMAIL);
      const [res] = await Promise.all([
        site.waitForResponse((r) => r.url().endsWith('/api/v1/wholesale-leads') && r.request().method() === 'POST'),
        form.locator('button[type="submit"]').click(),
      ]);
      assert(res.status() === 201, `oturumlu toptan formu POST → ${res.status()} (CSRF başlığı eksik mi?)`);
      assert(res.request().headers()['x-csrf-token'], 'istekte X-CSRF-Token başlığı yok');
      await site.locator('#notifyMsg').waitFor({ state: 'visible' });
      assert(await form.isHidden(), 'başarıda form gizlenmeli');
      const lead = sql(`SELECT count(*) FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`);
      assert(Number(lead) === 1, `wholesale_leads satırı: ${lead}`);
      // Yöneticiye bildirim (Notifier wholesale.new-lead → mail.wholesale-lead; site.contactEmail/SMTP_FROM yoksa atlanır + log)
      const leadId = sql(`SELECT id FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`);
      const notify = sqlLines(`SELECT status || ':' || coalesce(error,'') FROM mail_logs WHERE "templateSlug" = 'wholesale-lead' AND "entityId" = ${sqlLiteral(leadId)}`);
      if (notify.length) {
        const p = notify[0].startsWith('SKIPPED:preview:') ? notify[0].slice('SKIPPED:preview:'.length).trim() : null;
        if (p) state.previewPaths.push(p);
      }
      return `201 + CSRF başlığı; lead ${leadId}; yönetici bildirimi ${notify.length ? notify[0].split(':')[0] : 'yok (contactEmail/SMTP_FROM tanımsız)'}`;
    });

    // ---- Admin ------------------------------------------------------------------------------
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    adminCtx.setDefaultTimeout(TIMEOUT);
    const page = await adminCtx.newPage();
    const adminErrors = [];
    page.on('pageerror', (e) => adminErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') adminErrors.push(`console: ${m.text().slice(0, 200)}`);
    });

    await step('i1 admin giriş → Müşteriler listesi: yeni kullanıcı (arama, rol rozeti, doğrulama "Doğrulandı", son giriş)', async () => {
      await page.goto(`${ADMIN}/login`);
      await page.locator('#login-email').fill(ADMIN_EMAIL);
      await page.locator('#login-password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Giriş Yap' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: TIMEOUT });
      await page.goto(`${ADMIN}/musteriler?q=${encodeURIComponent(EMAIL)}`);
      await page.getByRole('heading', { name: 'Müşteriler' }).waitFor();
      const row = page.locator('tbody tr').filter({ hasText: EMAIL });
      await row.waitFor();
      const rowText = (await row.textContent()) || '';
      assert(/Müşteri/.test(rowText), `rol rozeti yok: ${rowText.slice(0, 120)}`);
      assert(/Doğrulandı/.test(rowText), `doğrulama rozeti "Doğrulandı" değil: ${rowText.slice(0, 160)}`);
      assert(/Aktif/.test(rowText), `durum "Aktif" değil: ${rowText.slice(0, 160)}`);
      const list = await admin.must('GET', `/api/v1/admin/customers?q=${encodeURIComponent(EMAIL)}`);
      assert(list.total === 1 && list.items[0].id === state.userId && list.items[0].emailVerifiedAt && list.items[0].lastLoginAt, `API liste: ${JSON.stringify(list).slice(0, 200)}`);
      const roleFiltered = await admin.must('GET', `/api/v1/admin/customers?role=ADMIN&q=${encodeURIComponent(EMAIL)}`);
      assert(roleFiltered.total === 0, 'rol filtresi (ADMIN) müşteriyi dışlamalı');
      await shot(page, 'i1-customers-list');
      await row.getByRole('link', { name: `${EMAIL} detay` }).click();
      await page.waitForURL((u) => new URL(u).pathname === `/musteriler/${state.userId}`);
      return `liste satırı: Müşteri · Aktif · Doğrulandı; API total=1, lastLoginAt dolu`;
    });

    await step('i2 müşteri detayı: profil + onaylar (KVKK Verildi / pazarlama Reddedildi) + adres + audit özeti · ad PATCH → API', async () => {
      await page.getByRole('heading', { name: 'Onaylar' }).waitFor();
      const consentsCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Onaylar' }) });
      const kvkkRow = consentsCard.locator('tbody tr').filter({ hasText: 'KVKK aydınlatma metni onayı' });
      const mktRow = consentsCard.locator('tbody tr').filter({ hasText: 'E-posta ile ticari ileti izni' });
      await kvkkRow.waitFor();
      assert(/Verildi/.test((await kvkkRow.textContent()) || ''), 'KVKK satırı "Verildi" olmalı');
      assert(/Reddedildi/.test((await mktRow.textContent()) || ''), 'pazarlama satırı "Reddedildi" olmalı');
      assert(/kvkk v1/.test((await kvkkRow.textContent()) || ''), 'KVKK satırı belge slug + sürüm göstermeli');
      const addressCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Adres' }) });
      const addressText = (await addressCard.textContent()) || '';
      assert(addressText.includes(ADDRESS.line) && addressText.includes('0530 111 22 33'), `adres kartı: ${addressText.slice(0, 160)}`);
      const auditCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Audit özeti' }) });
      const auditText = (await auditCard.textContent()) || '';
      assert(/auth:REGISTER/.test(auditText) && /auth:PASSWORD_RESET/.test(auditText) && /me:UPDATE/.test(auditText), `audit özeti: ${auditText.slice(0, 200)}`);
      const meta = (await page.locator('dl').first().textContent()) || '';
      assert(/Doğrulandı/.test(meta), 'detayda e-posta doğrulama rozeti yok');
      // Ad PATCH
      await page.getByLabel('Ad Soyad').fill(PATCHED_NAME);
      await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitToast(page, 'Müşteri kaydedildi');
      const detail = await admin.must('GET', `/api/v1/admin/customers/${state.userId}`);
      assert(detail.name === PATCHED_NAME && detail.address && detail.address.zoneSlug === ADDRESS.zone && detail.consents.length === 2, `API detay: name=${detail.name} address=${JSON.stringify(detail.address)} consents=${detail.consents.length}`);
      assert(detail.orders.length === 0 && detail.subscription === null, 'F8 öncesi sipariş/abonelik boş olmalı');
      // Kendi hesabını kapatma/yetki kuralı: STAFF değil ADMIN; kendi id'siyle isActive=false → 400
      const self = await admin.req('GET', '/api/v1/auth/me');
      const selfPatch = await admin.req('PATCH', `/api/v1/admin/customers/${self.data.id}`, { isActive: false });
      assert(selfPatch.status === 400 && selfPatch.data.error === 'SELF_DEACTIVATE', `kendi hesabını kapatma → ${selfPatch.status}`);
      await shot(page, 'i2-customer-detail');
      return `onaylar KVKK Verildi / pazarlama Reddedildi; adres + audit görünür; PATCH name="${PATCHED_NAME}"; self-deactivate 400`;
    });

    await step('i3 Anonimleştir (onay) → e-posta anon+id@anon.local, ad/telefon/adres silindi, isActive false, müşteri oturumu düştü (401)', async () => {
      await page.getByRole('button', { name: 'Anonimleştir' }).click();
      const dlg = dialog(page, 'Müşteriyi anonimleştir');
      await dlg.getByRole('button', { name: 'Anonimleştir', exact: true }).click();
      await waitToast(page, 'Müşteri anonimleştirildi');
      await page.getByText(/KVKK kapsamında anonimleştirildi/).waitFor();
      await shot(page, 'i3-anonymized');
      const detail = await admin.must('GET', `/api/v1/admin/customers/${state.userId}`);
      assert(detail.email === `anon+${state.userId}@anon.local`, `anon e-posta: ${detail.email}`);
      assert(detail.name === null && detail.phone === null && detail.address === null && detail.isActive === false && detail.anonymizedAt, `anon detay: ${JSON.stringify({ name: detail.name, phone: detail.phone, address: detail.address, isActive: detail.isActive, anonymizedAt: detail.anonymizedAt })}`);
      assert(detail.consents.length === 2, 'onay satırları (hukuki kanıt) korunmalı');
      assert(Number(sql(`SELECT count(*) FROM addresses WHERE "userId" = ${sqlLiteral(state.userId)}`)) === 0, 'adres satırları silinmeli');
      assert(sql(`SELECT coalesce("refreshTokenHash",'') FROM users WHERE id = ${sqlLiteral(state.userId)}`) === '', 'refreshTokenHash null olmalı');
      // Müşteri oturumu düştü: access (aktif değil) 401, refresh 401, giriş 401
      const meAfter = await customer.req('GET', '/api/v1/auth/me');
      assert(meAfter.status === 401, `anonim kullanıcı /auth/me → ${meAfter.status}`);
      const refresh = await customer.req('POST', '/api/v1/auth/refresh', {});
      assert(refresh.status === 401, `anonim kullanıcı refresh → ${refresh.status}`);
      const login = await new ApiClient(API).login(EMAIL, NEW_PASSWORD);
      assert(login.status === 401, `anon sonrası eski e-posta ile giriş → ${login.status}`);
      // İkinci anonimleştirme 409, PATCH 409
      const again = await admin.req('POST', `/api/v1/admin/customers/${state.userId}/anonymize`, {});
      assert(again.status === 409 && again.data.error === 'ALREADY_ANONYMIZED', `ikinci anonimleştirme → ${again.status}`);
      const patch = await admin.req('PATCH', `/api/v1/admin/customers/${state.userId}`, { name: 'Anonim Deneme' });
      assert(patch.status === 409 && patch.data.error === 'ALREADY_ANONYMIZED', `anonim hesap PATCH → ${patch.status} ${JSON.stringify(patch.data).slice(0, 120)}`);
      // Sayfada form kilidi
      assert(await page.getByLabel('Ad Soyad').isDisabled(), 'anonim detayda ad alanı kilitli olmalı');
      return `email=${detail.email}; adres 0; isActive=false; müşteri 401/401/401; tekrar 409`;
    });

    // (j) E-posta günlüğü
    await step('j Sistem › E-posta günlüğü: test kullanıcısının 4 satırı (welcome/verify/reset/password-changed, Atlandı) · durum filtresi · API previewPath', async () => {
      await page.goto(`${ADMIN}/sistem/e-posta-gunlugu?to=${encodeURIComponent(EMAIL)}`);
      await page.getByRole('heading', { name: 'E-posta Günlüğü' }).waitFor();
      const rows = page.locator('tbody tr').filter({ hasText: EMAIL });
      await rows.first().waitFor();
      assert((await rows.count()) === 4, `günlükte ${await rows.count()} satır (beklenen 4)`);
      const text = (await page.locator('tbody').textContent()) || '';
      for (const slug of ['welcome', 'verify', 'reset', 'password-changed']) assert(text.includes(slug), `şablon ${slug} satırı yok`);
      assert((text.match(/Atlandı \(DISABLE_MAIL\)/g) || []).length >= 4, 'durum rozetleri "Atlandı (DISABLE_MAIL)" olmalı');
      await shot(page, 'j-mail-logs');
      const api = await admin.must('GET', `/api/v1/admin/mail-logs?to=${encodeURIComponent(EMAIL)}&status=SKIPPED`);
      assert(api.total === 4 && api.items.every((i) => i.status === 'SKIPPED' && i.previewPath && i.entityId === state.userId), `API mail-logs: ${JSON.stringify(api).slice(0, 200)}`);
      const sent = await admin.must('GET', `/api/v1/admin/mail-logs?to=${encodeURIComponent(EMAIL)}&status=SENT`);
      assert(sent.total === 0, 'SENT filtresi 0 olmalı (DISABLE_MAIL)');
      return `4 satır SKIPPED (entityId=uid, previewPath dolu); SENT 0`;
    });

    // (k) Test e-postası
    await step('k Ayarlar › E-posta › "Test e-postası gönder" → SKIPPED + önizleme dosyası (MailLog mail.test)', async () => {
      await page.goto(`${ADMIN}/ayarlar/e-posta`);
      await page.getByRole('heading', { name: 'E-posta / SMS' }).waitFor();
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/settings/mail/test') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Test e-postası gönder' }).click(),
      ]);
      assert(res.status() === 200, `POST /admin/settings/mail/test → ${res.status()}`);
      const body = await res.json();
      assert(body.status === 'SKIPPED' && body.logId && body.previewPath && existsSync(body.previewPath), `test yanıtı: ${JSON.stringify(body)}`);
      state.testMailLogIds.push(body.logId);
      state.previewPaths.push(body.previewPath);
      await waitToast(page, 'Gönderim atlandı (DISABLE_MAIL)');
      await shot(page, 'k-mail-test');
      const row = sql(`SELECT "templateSlug" || ':' || status || ':' || "to" FROM mail_logs WHERE id = ${sqlLiteral(body.logId)}`);
      assert(row === `test:SKIPPED:${ADMIN_EMAIL}`, `MailLog test satırı: ${row}`);
      const html = readFileSync(body.previewPath, 'utf8');
      assert(/test e-postası/i.test(html), 'test önizlemesi şablon metnini içermiyor');
      return `logId=${body.logId} SKIPPED → ${body.previewPath.split(/[\\/]/).pop()}`;
    });

    // (l) audit
    await step('l audit-logs: auth:REGISTER/PASSWORD_RESET (müşteri aktör), me:UPDATE (adres), customers:UPDATE/ANONYMIZE, settings (mail test); e-posta/parola sızmaz', async () => {
      const res = await admin.must('GET', '/api/v1/admin/audit-logs?limit=100');
      const since = startedAt.getTime() - 5_000;
      const mine = res.items.filter((i) => new Date(i.createdAt).getTime() >= since);
      const has = (mod, action, pred = () => true) => mine.some((i) => i.module === mod && i.action === action && pred(i));
      assert(has('auth', 'REGISTER', (i) => i.entityId === state.userId && i.actorId === state.userId), 'auth:REGISTER yok');
      assert(has('auth', 'PASSWORD_RESET', (i) => i.entityId === state.userId), 'auth:PASSWORD_RESET yok');
      assert(has('auth', 'LOGIN', (i) => i.entityId === state.userId), 'auth:LOGIN (müşteri) yok');
      assert(has('me', 'UPDATE', (i) => i.actorId === state.userId), 'me:UPDATE (adres) yok');
      assert(has('customers', 'UPDATE', (i) => i.entityId === state.userId && i.actorEmail === ADMIN_EMAIL), 'customers:UPDATE yok');
      assert(has('customers', 'ANONYMIZE', (i) => i.entityId === state.userId && i.actorEmail === ADMIN_EMAIL), 'customers:ANONYMIZE yok');
      assert(mine.some((i) => i.module === 'settings' && state.testMailLogIds.includes(i.entityId)), 'settings (mail test) audit satırı yok');
      const dump = JSON.stringify(mine.filter((i) => i.entityId === state.userId || i.actorId === state.userId));
      assert(!dump.includes(PASSWORD) && !dump.includes(NEW_PASSWORD), 'audit parola içeriyor!');
      const reg = mine.find((i) => i.module === 'auth' && i.action === 'REGISTER' && i.entityId === state.userId);
      assert(reg && JSON.stringify(reg.newValues ?? {}).includes('[redacted]'), 'REGISTER satırında e-posta redakte değil');
      return `${mine.length} satır: ${[...new Set(mine.map((i) => `${i.module}:${i.action}`))].sort().join(', ')}`;
    });

    await step('m admin çıkış → /admin/customers 401', async () => {
      await page.goto(`${ADMIN}/`);
      await page.getByRole('button', { name: 'Çıkış' }).click();
      await page.waitForURL((u) => new URL(u).pathname === '/login');
      const r = await page.request.get(`${ADMIN}/api/v1/admin/customers`);
      assert(r.status() === 401, `çıkış sonrası /admin/customers → ${r.status()}`);
      return '401 doğru';
    });

    if (siteErrors.length) log(`site konsol hataları (${siteErrors.length}): ${siteErrors.slice(0, 5).join(' | ')}`);
    if (adminErrors.length) log(`admin konsol hataları (${adminErrors.length}): ${adminErrors.slice(0, 5).join(' | ')}`);
    results.push({ name: 'tarayıcı konsolu (site/admin)', ok: true, ms: 0, note: `site ${siteErrors.length} · admin ${adminErrors.length} hata${siteErrors.length + adminErrors.length ? `: ${[...siteErrors, ...adminErrors].slice(0, 3).join(' | ')}` : ''}` });
  } catch (err) {
    failed = true;
    log(`HATA: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    if (browser) await browser.close();
  }

  // ---- temizlik ------------------------------------------------------------------------------
  if (!KEEP) {
    await step('z temizlik: test kullanıcısı (consents/addresses/mail_logs/audit/users) · test e-postası satırları · önizleme dosyaları → sayımlar ≡ başlangıç', async () => {
      const problems = [];
      const tryDo = (label, fn) => {
        try {
          fn();
        } catch (e) {
          problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      // Kullanıcı id'si (kayıt başarısız olduysa e-postadan bul)
      if (!state.userId) {
        const id = sql(`SELECT id FROM users WHERE email = ${sqlLiteral(EMAIL)}`);
        if (id) state.userId = id;
      }
      // Önizleme dosyaları: MailLog satırlarından (kullanıcı + test e-postaları + e-posta alıcısı)
      const previewRows = [
        ...(state.userId ? sqlLines(`SELECT error FROM mail_logs WHERE "entityId" = ${sqlLiteral(state.userId)} AND error LIKE 'preview:%'`) : []),
        ...sqlLines(`SELECT error FROM mail_logs WHERE "to" = ${sqlLiteral(EMAIL)} AND error LIKE 'preview:%'`),
        ...(state.testMailLogIds.length ? sqlLines(`SELECT error FROM mail_logs WHERE id IN (${state.testMailLogIds.map(sqlLiteral).join(',')}) AND error LIKE 'preview:%'`) : []),
      ];
      const files = new Set([...state.previewPaths, ...previewRows.map((e) => e.slice(PREVIEW_PREFIX.length).trim())].filter(Boolean));
      let removed = 0;
      for (const f of files) {
        tryDo(`dosya ${f}`, () => {
          if (existsSync(f)) {
            unlinkSync(f);
            removed++;
          }
        });
      }
      if (state.userId) {
        const uid = sqlLiteral(state.userId);
        tryDo('consents', () => sql(`DELETE FROM consents WHERE "userId" = ${uid}`));
        tryDo('addresses', () => sql(`DELETE FROM addresses WHERE "userId" = ${uid}`));
        tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "entityId" = ${uid} OR "to" = ${sqlLiteral(EMAIL)}`));
        tryDo('audit_logs', () => sql(`DELETE FROM audit_logs WHERE ("actorId" = ${uid} OR "entityId" = ${uid}) AND "createdAt" >= ${sqlLiteral(new Date(startedAt.getTime() - 5_000).toISOString())}`));
        tryDo('users', () => sql(`DELETE FROM users WHERE id = ${uid}`));
      } else {
        tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "to" = ${sqlLiteral(EMAIL)}`));
      }
      if (state.testMailLogIds.length) {
        const ids = state.testMailLogIds.map(sqlLiteral).join(',');
        tryDo('test mail_logs', () => sql(`DELETE FROM mail_logs WHERE id IN (${ids})`));
        tryDo('test audit', () => sql(`DELETE FROM audit_logs WHERE module = 'settings' AND "entityId" IN (${ids})`));
      }
      // Toptan talebi (h2) + varsa yönetici bildirimi satırı/önizlemesi
      tryDo('toptan', () => {
        const leadIds = sqlLines(`SELECT id FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`);
        if (leadIds.length) {
          const inList = leadIds.map(sqlLiteral).join(',');
          for (const e of sqlLines(`SELECT error FROM mail_logs WHERE "templateSlug" = 'wholesale-lead' AND "entityId" IN (${inList}) AND error LIKE 'preview:%'`)) {
            const f = e.slice(PREVIEW_PREFIX.length).trim();
            if (f && existsSync(f)) unlinkSync(f);
          }
          sql(`DELETE FROM mail_logs WHERE "templateSlug" = 'wholesale-lead' AND "entityId" IN (${inList})`);
          sql(`DELETE FROM wholesale_leads WHERE id IN (${inList})`);
        }
      });
      if (problems.length) throw new Error(`temizlik sorunları: ${problems.join(' · ')}`);
      const users = Number(sql('SELECT count(*) FROM users'));
      const mailLogs = Number(sql('SELECT count(*) FROM mail_logs'));
      const addresses = Number(sql('SELECT count(*) FROM addresses'));
      assert(users === state.usersBefore, `users ${users} (başlangıç ${state.usersBefore})`);
      assert(mailLogs === state.mailLogsBefore, `mail_logs ${mailLogs} (başlangıç ${state.mailLogsBefore})`);
      assert(addresses === state.addressesBefore, `addresses ${addresses} (başlangıç ${state.addressesBefore})`);
      assert(Number(sql(`SELECT count(*) FROM users WHERE email = ${sqlLiteral(EMAIL)} OR email = ${sqlLiteral(`anon+${state.userId}@anon.local`)}`)) === 0, 'test kullanıcısı silinmedi');
      const leftover = [...files].filter((f) => existsSync(f));
      assert(leftover.length === 0, `önizleme dosyaları kaldı: ${leftover.join(', ')}`);
      assert(Number(sql(`SELECT count(*) FROM wholesale_leads WHERE email = ${sqlLiteral(LEAD_EMAIL)}`)) === 0, 'toptan talebi silinmedi');
      if (admin.cookies.size === 0) await admin.loginAdmin();
      const customers = await admin.must('GET', '/api/v1/admin/customers?limit=1');
      assert(customers.total === state.customersTotalBefore, `customers.total ${customers.total} (başlangıç ${state.customersTotalBefore})`);
      return `users=${users} mail_logs=${mailLogs} addresses=${addresses} customers.total=${customers.total}; ${removed} önizleme dosyası silindi`;
    }).catch(() => {
      failed = true;
    });
    try {
      await admin.req('POST', '/api/v1/auth/logout');
    } catch {
      /* önemsiz */
    }
  } else {
    log('--keep: test verisi silinmedi');
  }

  // ---- rapor --------------------------------------------------------------------------------
  const lines = [
    '# e2e F6 raporu — üyelik + hesap + adres + e-posta çekirdeği',
    '',
    `- Tarih: ${startedAt.toISOString()} · API: ${API} · Admin: ${ADMIN} · run: ${RUN}`,
    `- Sonuç: ${failed ? 'HATA' : 'TÜM ADIMLAR OK'} (${results.filter((r) => r.ok).length}/${results.length})`,
    '',
    '| Adım | Durum | Süre | Not |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|')} |`),
    '',
    'Ekran görüntüleri: `tools/e2e-admin/out/f6-*.png`. DISABLE_MAIL=true: e-postalar gönderilmez, MailLog SKIPPED + `apps/api/logs/mail/<id>.html` önizlemesi (bağlantılar buradan okundu; temizlikte silindi). Sırlar çıktıya yazılmaz; admin kimliği ve DB bağlantısı apps/api/.env (SEED_ADMIN_*, DATABASE_URL).',
    '',
  ];
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[e2e-f6] beklenmeyen hata:', err);
  process.exit(1);
});
