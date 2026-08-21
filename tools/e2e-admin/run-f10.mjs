// tools/e2e-admin/run-f10.mjs — F10 uçtan uca: bildirimler + çerez onayı + KVKK + Sistem ekranı + güvenlik
//
// F4–F9 kalıbı: geçici API (:4094, PAYMENT_PROVIDER=manual · ENABLE_CRON=false · DISABLE_MAIL=true ·
// WEB_URL/ADMIN_URL geçici portlara) + admin preview (:4095, ADMIN_API_PROXY=http://127.0.0.1:4094) ÖNCEDEN
// ayağa kaldırılır. Adımlar site (Playwright), panel (Playwright), API (fetch) ve psql ile doğrulanır:
//   a  hazırlık: admin girişi (API + panel) · 17 tablo sayımı · privacy/cookies ayarları saklanır ·
//      çerez kategorileri açılır (analytics + marketing; sonda geri) · tier + delivery_dates.reserved anlık görüntüsü
//   b  çerez şeridi HTML paritesi: 10 sayfada `#cookieConsent` SUNUCUDA `display:none` ile basılır (JS gösterir)
//   c  çerez şeridi "Reddet": şerit JS ile görünür → reddet → Consent COOKIE_ANALYTICS/COOKIE_MARKETING granted=false
//      · localStorage `bagdam_cookie_consent` · yeniden yüklemede şerit YOK
//   d  çerez şeridi "Yönet": analitik işaretli / pazarlama işaretsiz → "Seçimimi kaydet" → analytics true, marketing false
//   e  çerez şeridi "Kabul Et" + kapalı kategori: pazarlama ayarı kapatılınca şeritte hiç basılmaz, onayı da sorulmaz
//   f  abone kurulumu: müşteri A kaydı + adres + `ok:` kart → admin manuel checkout (MIT) → ACTIVE + cycle#1 → cycles:ensure
//   g  reminders:cutoff: kesimden ~23,5 s önce → MailLog `cutoff-reminder` (entityId = cycleId) + önizlemede kutu
//      içeriği ve teslimat günü · ikinci koşu YENİ satır üretmez (cycle başına bir kez)
//   h  cycles:lock-and-charge: cycle#2 CHARGED → MailLog `cycle-charged` (tutar + sipariş no)
//   i  müşteri B (`fail:` kart): kesim → cycle UNPAID → MailLog `cycle-payment-failed` (kart güncelle linki + yeniden deneme)
//   j  teslimat durum mailleri: panelden PREPARING → OUT_FOR_DELIVERY (`order-shipped`) → DELIVERED (`order-delivered`);
//      B siparişi DELIVERY_FAILED (`order-delivery-failed`, gerekçe metni)
//   k  iptal teyidi: müşteri A `/me/subscription/cancel` → confirm → MailLog `subscription-cancelled`
//   l  kvkk:purge: yapay ESKİ MailLog (+ önizleme dosyası) / SystemLog / CronLog / PII'li AuditLog satırları →
//      job → eskiler silinir, AuditLog PII'si `[silindi]` olur (satır durur), taze satırlar etkilenmez
//   m  Sistem ekranı (22): altı sekme — Sağlık (GET /admin/health/detailed ile birebir) · Denetim · Sistem · Cron ·
//      E-posta · Webhook listeleri dolu; "İşleri çalıştır" yalnız dev/staging'de görünür
//   n  güvenlik: oturumsuz admin ucu 401 · müşteri IDOR (başkasının siparişi/aboneliği) 403/404 · CSRF'siz mutasyon 403 ·
//      CSP başlıkları (web/admin/api) + PayTR frame-src · HSTS dev'de yok · X-Powered-By yok · hata zarfında `code`
//   z  temizlik: koşunun ürettiği satırlar silinir, ayarlar geri → 17 tablo sayımı ≡ başlangıç
//
// Kullanım (repo kökünden):
//   node tools/e2e-admin/run-f10.mjs [--api=http://127.0.0.1:4094] [--admin=http://localhost:4095] [--headed] [--keep] [--timeout=25000]
// Not: zaman yalnız job'lara verilen `now` ile ilerletilir (`POST /admin/jobs/:name/run {now}` — üretimde 403).
// Not: jest suite'leri ile aynı anda KOŞMAZ (ikisi de `bagdam_dev`'e yazar — F7/F8/F9 notuyla aynı kural).
// Çıktı: tools/e2e-admin/out/f10-*.png, tools/e2e-admin/report-f10.md. Çıkış kodu: hata varsa 1.
// Sırlar (SEED_ADMIN_*, DATABASE_URL) yalnız env'den okunur; çıktıya yazılmaz.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report-f10.md');
const MAIL_PREVIEW_DIR = join(ROOT, 'logs', 'mail');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4094').replace(/\/$/, '');
// vite preview IPv6 (::1) dinler → panel adresi `localhost` olmalı (F9 notu).
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://localhost:4095').replace(/\/$/, '');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 25_000);
const PSQL = process.env.PSQL || 'psql';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ZONE_SLUG = 'urla';
const PREVIEW_PREFIX = 'preview:';
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
const PASSWORD = `E2e-Parola-${RUN}`;
const A = { email: `e2e-f10a-${RUN}@example.com`, name: `E2E F10 Abone ${RUN}`, phone: '0530 000 01 00' };
const B = { email: `e2e-f10b-${RUN}@example.com`, name: `E2E F10 Teslimat ${RUN}`, phone: '0530 000 01 10' };
const COMMERCE_KEYS = ['dunning', 'deliveryDatesHorizonWeeks'];
const WEB_PAGES = [
  '/index.html', '/urunler.html', '/urun.html', '/kutu.html?tier=sezon', '/sepet.html',
  '/uyelik.html', '/gunluk.html', '/toptan.html', '/politikalar.html', '/nasil-seciyoruz.html',
];

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f10] ${msg}`);
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
/**
 * psql -tA. Bağlantı dizesi (parola) hata mesajına YAZILMAZ.
 * ASCII dışı karakter içeren sorgular (Türkçe metin, repo yolundaki `ı`) komut satırından geçirilemez:
 * Windows argümanları ANSI kod sayfasıyla kodlar → "invalid byte sequence for encoding UTF8".
 * Bu durumda sorgu UTF-8 geçici dosyaya yazılır ve `-f` ile çalıştırılır.
 */
const SQL_TMP = join(OUT_DIR, `.f10-${RUN}.sql`);
function sql(query) {
  const ascii = /^[\x00-\x7F]*$/.test(query);
  const argv = ascii
    ? [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', query]
    : [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', SQL_TMP];
  if (!ascii) writeFileSync(SQL_TMP, query, 'utf8');
  try {
    return execFileSync(PSQL, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    }).trim();
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr).trim() : '';
    throw new Error(`psql hatası: ${stderr || 'komut başarısız'} — sorgu: ${query.slice(0, 90)}`);
  } finally {
    if (!ascii && existsSync(SQL_TMP)) unlinkSync(SQL_TMP);
  }
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const inList = (ids) => (ids.length ? ids.map(lit).join(',') : "''");
function sqlLines(query) {
  const out = sql(query);
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}
const num = (v) => Number(String(v ?? '0'));
/** cuid benzeri kimlik (ID_RE ^[A-Za-z0-9_-]{1,64}$). */
const genId = (prefix) => `${prefix}${RUN}${randomBytes(6).toString('hex')}`;
const flat = (s) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const stripTags = (s) => flat(String(s ?? '').replace(/<[^>]*>/g, ' '));

// ---- takvim (Europe/Istanbul kalıcı +03; kesim = teslimattan 1 gün önce 12:00) -----------------
const TZ_OFFSET = '+03:00';
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const istanbulToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const mondayOf = (iso) => addDays(iso, -((dow(iso) + 6) % 7));
const cutoffOf = (deliveryOn) => new Date(`${addDays(deliveryOn, -1)}T12:00:00${TZ_OFFSET}`);
const plusMin = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const daysAgo = (days) => new Date(Date.now() - days * 24 * 3_600_000);
const DAY_ENUM = { sali: 'SALI', persembe: 'PERSEMBE', cumartesi: 'CUMARTESI' };

const SNAP_TABLES = [
  'users', 'addresses', 'consents', 'subscriptions', 'subscription_cycles', 'cycle_items', 'subscription_events',
  'subscription_cancellations', 'orders', 'order_lines', 'payments', 'payment_methods', 'mail_logs', 'box_templates',
  'box_template_items', 'delivery_dates', 'webhook_events',
];
function snapshot() {
  const out = {};
  for (const t of SNAP_TABLES) out[t] = num(sql(`SELECT count(*) FROM ${t}`));
  return out;
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
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
        break;
      } catch (err) {
        if (attempt >= 2) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    this.storeCookies(res);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: res.status, data, text, headers: res.headers };
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
    if (!expected.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 320)}`);
    return r.data;
  }
}

// ---- MailLog / önizleme yardımcıları ----------------------------------------------------------
/** MailLog satırı (templateSlug, entityId) — DISABLE_MAIL'de `error` alanı `preview:<yol>` taşır. */
function mailRow(slug, entityId) {
  const row = sql(
    `SELECT id || E'\\t' || status || E'\\t' || subject || E'\\t' || coalesce(error,'') FROM mail_logs ` +
      `WHERE "templateSlug" = ${lit(slug)} AND "entityId" = ${lit(entityId)}`,
  );
  if (!row) return null;
  const [id, status, subject, error] = row.split('\t');
  return { id, status, subject, error: error ?? '' };
}
/** MailLog satırı gelene kadar bekler (bildirimler transaction dışında, 250 ms gecikmeyle koşar). */
async function waitMail(slug, entityId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = mailRow(slug, entityId);
    if (row && row.status !== 'QUEUED') return row;
    if (Date.now() > deadline) throw new Error(`MailLog gelmedi: ${slug}/${entityId}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
/** MailLog satırının DISABLE_MAIL önizleme HTML'i (dosyadan). */
function previewHtml(row) {
  assert(row.error.startsWith(PREVIEW_PREFIX), `önizleme yok (${row.id}): ${row.error.slice(0, 120)}`);
  const path = row.error.slice(PREVIEW_PREFIX.length).trim();
  assert(existsSync(path), `önizleme dosyası yok: ${path}`);
  return { path, html: readFileSync(path, 'utf8') };
}

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `f10-${name}.png`), fullPage: false }).catch(() => {});
}
/**
 * Sipariş detayında durum geçişi: birincil düğme → onay kutusu (ConfirmDialog, onay düğmesi aynı etiketi taşır)
 * → durum rozetinin güncellenmesini bekle.
 */
async function transition(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.getByRole('button', { name: label, exact: true }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT });
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
  // Geçişten sonra o etiketli düğme kalkar (yeni durum artık geçerli hedef değil).
  await page.waitForFunction(
    (text) => ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === text),
    label,
    { timeout: TIMEOUT },
  );
}

async function adminLogin(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: TIMEOUT });
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const admin = new ApiClient(API);
  const custA = new ApiClient(API);
  const custB = new ApiClient(API);
  const state = {
    counts: null,
    ddBaseline: new Map(),
    ddAllBefore: new Set(),
    commerce: {},
    cookiesBefore: null,
    cookiesChanged: false,
    privacyBefore: null,
    tier: null,
    a: { userId: null, subId: null, orderId: null, cycle1Id: null, cycle2Id: null, cycle2On: null, pmOk: null },
    b: { userId: null, subId: null, orderId: null, cycleId: null, cycleOn: null, pmFail: null },
    guestKeys: [],
    templateIds: [],
    cronLogIds: [],
    fakeIds: { mail: null, system: null, cron: null, audit: null, webhook: null, mailPreview: null },
    entityIds: new Set(),
    previewPaths: new Set(),
  };
  let failed = false;

  const job = async (name, now, opts = {}) => {
    const body = now ? { now: now.toISOString() } : {};
    const r = await admin.must('POST', `/api/v1/admin/jobs/${name}/run`, body);
    assert(r.status === 'SUCCESS', `${name} → ${r.status} ${JSON.stringify(r.details).slice(0, 200)}`);
    if (!opts.allowErrors) assert(r.errors === 0, `${name} errors=${r.errors} ${JSON.stringify(r.details).slice(0, 300)}`);
    if (r.cronLogId) state.cronLogIds.push(r.cronLogId);
    return r;
  };
  const subDetail = async (id) => {
    const d = await admin.must('GET', `/api/v1/admin/subscriptions/${id}`);
    d.cycles = [...(d.cycles ?? [])].sort((x, y) => x.cycleNo - y.cycleNo);
    return d;
  };
  const cycleOf = (detail, no) => {
    const c = detail.cycles.find((x) => x.cycleNo === no);
    assert(c, `cycle#${no} yok (${detail.cycles.map((x) => x.cycleNo).join(',')})`);
    return c;
  };
  const setCookieSettings = async (analytics, marketing) => {
    await admin.must('PUT', '/api/v1/admin/settings/cookies', { analyticsEnabled: analytics, marketingEnabled: marketing });
    state.cookiesChanged = true;
  };

  const browser = await chromium.launch({ headless: !HEADED });
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  adminCtx.setDefaultTimeout(TIMEOUT);
  const panel = await adminCtx.newPage();
  const pageErrors = [];
  panel.on('pageerror', (e) => pageErrors.push(`admin: ${e.message}`));

  /** Her çerez senaryosu TEMİZ bir tarayıcı bağlamında koşar (localStorage boş = ilk ziyaret). */
  const freshSite = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    ctx.setDefaultTimeout(TIMEOUT);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(`site: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(`site console: ${flat(m.text()).slice(0, 200)}`);
    });
    return { ctx, page };
  };
  /** Şeridin JS ile görünür olmasını bekler ve karar düğmelerini döndürür. */
  const openBanner = async (page, url = '/index.html') => {
    await page.goto(`${API}${url}`, { waitUntil: 'domcontentloaded' });
    const banner = page.locator('#cookieConsent');
    await banner.waitFor({ state: 'visible', timeout: TIMEOUT });
    return banner;
  };
  const consentRows = (guestKey) =>
    sqlLines(`SELECT kind || E'\\t' || granted::text FROM consents WHERE "guestKey" = ${lit(guestKey)} ORDER BY kind`).map((r) => {
      const [kind, granted] = r.split('\t');
      return { kind, granted: granted === 't' || granted === 'true' };
    });
  const guestKeyOf = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('bagdam_cookie_consent') || 'null') || {}).gk || null);

  try {
    // ═══ a — hazırlık ═════════════════════════════════════════════════════════════════════════
    await step('a hazırlık: admin girişi (API + panel) · sayımlar · ayar anlık görüntüsü · çerez kategorileri açılır', async () => {
      await admin.loginAdmin();
      await adminLogin(panel);
      state.counts = snapshot();
      for (const line of sqlLines("SELECT id || E'\\t' || reserved FROM delivery_dates")) {
        const [id, reserved] = line.split('\t');
        state.ddBaseline.set(id, num(reserved));
        state.ddAllBefore.add(id);
      }
      const commerce = await admin.must('GET', '/api/v1/admin/settings/commerce');
      for (const key of COMMERCE_KEYS) state.commerce[key] = commerce.fields.find((f) => f.key === key)?.value;
      const cookies = await admin.must('GET', '/api/v1/admin/settings/cookies');
      state.cookiesBefore = Object.fromEntries(cookies.fields.map((f) => [f.key, f.value]));
      const privacy = await admin.must('GET', '/api/v1/admin/settings/privacy');
      state.privacyBefore = Object.fromEntries(privacy.fields.map((f) => [f.key, f.value]));
      assert(privacy.group === 'privacy' && privacy.fields.length === 6, `privacy grubu: ${JSON.stringify(privacy).slice(0, 200)}`);
      await setCookieSettings(true, true);
      const tiers = await admin.must('GET', '/api/v1/admin/tiers');
      state.tier = (Array.isArray(tiers) ? tiers : (tiers.items ?? [])).find((t) => t.isActive) ?? null;
      assert(state.tier, 'aktif kutu boyu yok');
      return `${SNAP_TABLES.length} tablo · privacy ${JSON.stringify(state.privacyBefore)} · cookies ${JSON.stringify(state.cookiesBefore)} → ikisi de açık`;
    });

    // ═══ b — parite sözleşmesi ════════════════════════════════════════════════════════════════
    await step('b çerez şeridi 10 sayfada SUNUCUDA GİZLİ basılır (display:none + position:fixed) — parite bozulmaz', async () => {
      const missing = [];
      for (const path of WEB_PAGES) {
        const res = await fetch(`${API}${path}`);
        const html = await res.text();
        const idx = html.indexOf('id="cookieConsent"');
        if (idx < 0) {
          missing.push(`${path}: şerit yok`);
          continue;
        }
        const tag = html.slice(idx, html.indexOf('>', idx));
        if (!/display:\s*none/.test(tag) || !/position:\s*fixed/.test(tag)) missing.push(`${path}: gizli değil`);
        if (html.indexOf('id="cookieConsent"') > html.indexOf('site-footer')) {
          /* footer'dan sonra basılması sorun değil; yalnız varlık ve gizlilik aranır */
        }
      }
      assert(missing.length === 0, missing.join(' · '));
      return `${WEB_PAGES.length}/${WEB_PAGES.length} sayfa · şerit varsayılan gizli`;
    });

    // ═══ c — Reddet ═══════════════════════════════════════════════════════════════════════════
    await step('c çerez şeridi "Reddet": JS ile görünür → reddet → Consent ×2 granted=false · yeniden yüklemede yok', async () => {
      const { ctx, page } = await freshSite();
      try {
        const banner = await openBanner(page);
        const text = flat(await banner.textContent());
        assert(/Çerez tercihleri/.test(text), `başlık yok: ${text.slice(0, 160)}`);
        assert(/Reddet/.test(text) && /Yönet/.test(text) && /Kabul Et/.test(text), `3 düğme yok: ${text.slice(0, 200)}`);
        await shot(page, 'c-cerez-serit');
        await page.locator('#cookieConsentReject').click();
        await banner.waitFor({ state: 'hidden', timeout: TIMEOUT });
        const gk = await page.waitForFunction(() => {
          const v = JSON.parse(localStorage.getItem('bagdam_cookie_consent') || 'null');
          return v && v.gk ? v.gk : null;
        }).then((h) => h.jsonValue());
        state.guestKeys.push(gk);
        // Consent satırları fire-and-forget POST edilir → kısa bekleme
        let rows = [];
        for (let i = 0; i < 40 && rows.length < 2; i++) {
          rows = consentRows(gk);
          if (rows.length < 2) await new Promise((r) => setTimeout(r, 250));
        }
        assert(rows.length === 2, `Consent satırı ${rows.length} (2 beklenir): ${JSON.stringify(rows)}`);
        assert(rows.every((r) => r.granted === false), `reddedilen onaylar granted=false olmalı: ${JSON.stringify(rows)}`);
        assert(rows.map((r) => r.kind).sort().join(',') === 'COOKIE_ANALYTICS,COOKIE_MARKETING', `kind'lar: ${JSON.stringify(rows)}`);
        // İkinci ziyaret: karar verilmiş → şerit hiç görünmez
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        assert(!(await page.locator('#cookieConsent').isVisible()), 'karardan sonra şerit yine göründü');
        return `guestKey ${gk.slice(0, 10)}… · COOKIE_ANALYTICS=false · COOKIE_MARKETING=false`;
      } finally {
        await ctx.close();
      }
    });

    // ═══ d — Yönet ════════════════════════════════════════════════════════════════════════════
    await step('d çerez şeridi "Yönet": analitik açık / pazarlama kapalı → "Seçimimi kaydet" → Consent true/false', async () => {
      const { ctx, page } = await freshSite();
      try {
        const banner = await openBanner(page, '/politikalar.html');
        await page.locator('#cookieConsentManageBtn').click();
        await page.locator('#cookieConsentAnalytics').waitFor({ state: 'visible', timeout: TIMEOUT });
        await page.locator('#cookieConsentAnalytics').check();
        const acceptLabel = flat(await page.locator('#cookieConsentAccept').textContent());
        assert(acceptLabel === 'Seçimimi kaydet', `yönet modunda düğme metni: "${acceptLabel}"`);
        await shot(page, 'd-cerez-yonet');
        await page.locator('#cookieConsentAccept').click();
        await banner.waitFor({ state: 'hidden', timeout: TIMEOUT });
        const gk = await guestKeyOf(page);
        state.guestKeys.push(gk);
        let rows = [];
        for (let i = 0; i < 40 && rows.length < 2; i++) {
          rows = consentRows(gk);
          if (rows.length < 2) await new Promise((r) => setTimeout(r, 250));
        }
        const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.granted]));
        assert(byKind.COOKIE_ANALYTICS === true, `analitik onayı: ${JSON.stringify(byKind)}`);
        assert(byKind.COOKIE_MARKETING === false, `pazarlama onayı: ${JSON.stringify(byKind)}`);
        return `COOKIE_ANALYTICS=true · COOKIE_MARKETING=false`;
      } finally {
        await ctx.close();
      }
    });

    // ═══ e — Kabul Et + kapalı kategori ═══════════════════════════════════════════════════════
    await step('e çerez şeridi "Kabul Et" (ikisi de true) · pazarlama ayarı kapalıyken şeritte hiç basılmaz', async () => {
      const first = await freshSite();
      let note = '';
      try {
        const banner = await openBanner(first.page);
        await first.page.locator('#cookieConsentAccept').click();
        await banner.waitFor({ state: 'hidden', timeout: TIMEOUT });
        const gk = await guestKeyOf(first.page);
        state.guestKeys.push(gk);
        let rows = [];
        for (let i = 0; i < 40 && rows.length < 2; i++) {
          rows = consentRows(gk);
          if (rows.length < 2) await new Promise((r) => setTimeout(r, 250));
        }
        assert(rows.length === 2 && rows.every((r) => r.granted === true), `kabul: ${JSON.stringify(rows)}`);
        note = 'Kabul Et → 2 onay true';
      } finally {
        await first.ctx.close();
      }
      // Pazarlama kapatılır: markup'ta kutucuk yok, karar verilince onayı da sorulmaz
      await setCookieSettings(true, false);
      const second = await freshSite();
      try {
        const banner = await openBanner(second.page);
        await second.page.locator('#cookieConsentManageBtn').click();
        await second.page.locator('#cookieConsentAnalytics').waitFor({ state: 'visible', timeout: TIMEOUT });
        assert((await second.page.locator('#cookieConsentMarketing').count()) === 0, 'kapalı pazarlama kategorisi şeritte basılmış');
        assert((await banner.getAttribute('data-marketing')) === '0', 'data-marketing bayrağı 0 değil');
        // Yönet panelini kapat → "Kabul Et" (sunulan TÜM kategoriler = yalnız analitik)
        await second.page.locator('#cookieConsentManageBtn').click();
        await second.page.locator('#cookieConsentAccept').click();
        await banner.waitFor({ state: 'hidden', timeout: TIMEOUT });
        const gk = await guestKeyOf(second.page);
        state.guestKeys.push(gk);
        await new Promise((r) => setTimeout(r, 1500));
        const rows = consentRows(gk);
        assert(rows.length === 1 && rows[0].kind === 'COOKIE_ANALYTICS' && rows[0].granted === true, `kapalı kategori onayı yazılmamalı: ${JSON.stringify(rows)}`);
        note += ' · kapalı pazarlama: markup yok, Consent yok';
      } finally {
        await second.ctx.close();
      }
      await setCookieSettings(true, true);
      return note;
    });

    // ═══ f0 — haftanın kutusu şablonları ══════════════════════════════════════════════════════
    await step('f0 haftanın kutusu: sonraki 4 hafta için şablon kopyası + yayın (cycles:ensure şablonsuz hafta görmemeli)', async () => {
      const base = mondayOf(istanbulToday());
      const weeks = [base, addDays(base, 7), addDays(base, 14), addDays(base, 21)];
      const srcItems = sqlLines(
        `SELECT i."productId" || E'\t' || i."qtyLabel" || E'\t' || i."isSwappable" FROM box_template_items i
         JOIN box_templates t ON t.id = i."templateId"
         WHERE t."tierId" = ${lit(state.tier.id)} AND t.status = 'PUBLISHED' ORDER BY t."weekStart" DESC, i."sortOrder" LIMIT 30`,
      ).map((r) => {
        const [productId, qtyLabel, isSwappable] = r.split('\t');
        return { productId, qtyLabel: qtyLabel || '1 adet', isSwappable: isSwappable === 't' || isSwappable === 'true' };
      });
      assert(srcItems.length > 0, 'kaynak şablon öğesi yok — pnpm db:seed');
      const existing = await admin.must('GET', `/api/v1/admin/box-templates?tierId=${state.tier.id}&from=${weeks[0]}&to=${weeks[weeks.length - 1]}`);
      const have = new Map((Array.isArray(existing) ? existing : (existing.items ?? [])).map((t) => [String(t.weekStart).slice(0, 10), t]));
      let created = 0;
      let published = 0;
      for (const ws of weeks) {
        let tpl = have.get(ws);
        if (!tpl) {
          tpl = await admin.must('POST', '/api/v1/admin/box-templates', { tierId: state.tier.id, weekStart: ws, curatorName: `E2E F10 ${RUN}`, items: srcItems }, [200, 201]);
          state.templateIds.push(tpl.id);
          created++;
        }
        if (tpl.status !== 'PUBLISHED') {
          await admin.must('POST', `/api/v1/admin/box-templates/${tpl.id}/publish`, undefined, [200, 201]);
          published++;
        }
      }
      return `hafta ${weeks[0]}…${weeks[weeks.length - 1]} · +${created} şablon (yayın ${published}) · ${srcItems.length} öğe`;
    });

    // ═══ f — abone kurulumu ═══════════════════════════════════════════════════════════════════
    await step('f müşteri A: kayıt + adres + `ok:` kart → admin manuel checkout (MIT) → ACTIVE + cycle#1 → cycles:ensure', async () => {
      await custA.req('GET', '/api/v1/auth/csrf');
      const reg = await custA.req('POST', '/api/v1/auth/register', {
        email: A.email, password: PASSWORD, name: A.name, phone: A.phone, consents: [{ kind: 'KVKK_ACK', granted: true }],
      });
      assert(reg.status === 201, `A register → ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
      state.a.userId = sql(`SELECT id FROM users WHERE email = ${lit(A.email)}`);
      state.entityIds.add(state.a.userId);
      await custA.must('PUT', '/api/v1/me/address', { fullName: A.name, phone: A.phone, line: `E2E F10 Mah. ${RUN} Sk. No:1`, zoneSlug: ZONE_SLUG, zip: '35430' });
      state.a.pmOk = genId('e2ef10a');
      sql(
        `INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") ` +
          `VALUES (${lit(state.a.pmOk)}, ${lit(state.a.userId)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('ok:' + RUN)}, '0009', 'TEST', true, true, ${lit(new Date().toISOString())})`,
      );
      const dates = await custA.must('GET', `/api/v1/delivery/dates?zone=${ZONE_SLUG}`);
      const safe = (Array.isArray(dates) ? dates : [])
        .filter((d) => !d.locked && !d.full)
        .sort((x, y) => x.date.localeCompare(y.date))
        .find((d) => new Date(d.cutoffAtIso).getTime() > Date.now() + 24 * 3_600_000);
      assert(safe, 'A için uygun teslimat günü yok');
      const created = await admin.must(
        'POST', '/api/v1/admin/subscriptions',
        {
          userId: state.a.userId, tierSlug: state.tier.slug, frequencyWeeks: 1,
          deliveryDay: DAY_ENUM[safe.day], deliveryOn: safe.date,
          paymentMethodId: state.a.pmOk, chargeStrategy: 'MERCHANT_INITIATED', note: `e2e f10 ${RUN} bildirim`,
        },
        [201],
      );
      state.a.subId = created.subscription.id;
      state.a.orderId = created.order.id;
      state.entityIds.add(state.a.subId);
      state.entityIds.add(state.a.orderId);
      assert(created.subscription.status === 'ACTIVE' && created.order.status === 'PAID', `A abonelik/sipariş: ${created.subscription.status}/${created.order.status}`);
      await job('cycles:ensure');
      const d = await subDetail(state.a.subId);
      assert(d.cycles.length >= 2, `A cycle sayısı ${d.cycles.length} (cycle#2 gerekli)`);
      state.a.cycle1Id = cycleOf(d, 1).id;
      const c2 = cycleOf(d, 2);
      state.a.cycle2Id = c2.id;
      state.a.cycle2On = c2.deliveryOn;
      return `sub ${state.a.subId.slice(0, 8)}… · cycle#1 ${cycleOf(d, 1).deliveryOn} · cycle#2 ${c2.deliveryOn}`;
    });

    // ═══ g — kesim hatırlatması ═══════════════════════════════════════════════════════════════
    await step('g reminders:cutoff → MailLog `cutoff-reminder` (kutu içeriği + teslimat günü) · ikinci koşu tekrar göndermez', async () => {
      const cutoff = cutoffOf(state.a.cycle2On);
      const r1 = await job('reminders:cutoff', new Date(cutoff.getTime() - 23.5 * 3_600_000));
      const row = await waitMail('cutoff-reminder', state.a.cycle2Id);
      const { path, html } = previewHtml(row);
      state.previewPaths.add(path);
      const text = stripTags(html);
      const items = sqlLines(
        // Şablon/e-posta ürün adı: cycle_items.label varsa o, yoksa ürün adı (SubscriptionNotifier ile aynı kural).
        `SELECT coalesce(ci.label, p.name) FROM cycle_items ci JOIN products p ON p.id = ci."productId" ` +
          `WHERE ci."cycleId" = ${lit(state.a.cycle2Id)} AND ci.source IN ('TEMPLATE','SWAP')`,
      );
      assert(items.length > 0, 'cycle#2 kutu içeriği boş');
      const missing = items.filter((n) => !text.includes(n));
      assert(missing.length === 0, `önizlemede olmayan ürünler: ${missing.slice(0, 4).join(', ')}`);
      const dd = trLabelOf(state.a.cycle2On);
      assert(text.includes(dd), `teslimat günü metni yok (${dd}): ${text.slice(0, 240)}`);
      assert(/atla/i.test(text), 'atlama bağlantısı/metni yok');
      assert(row.status === 'SKIPPED', `DISABLE_MAIL'de status SKIPPED beklenir: ${row.status}`);
      // İkinci koşu: MailLog tekilliği (templateSlug, entityId) → yeni satır YOK
      const before = num(sql(`SELECT count(*) FROM mail_logs WHERE "templateSlug" = 'cutoff-reminder'`));
      const r2 = await job('reminders:cutoff', new Date(cutoff.getTime() - 23.4 * 3_600_000));
      const after = num(sql(`SELECT count(*) FROM mail_logs WHERE "templateSlug" = 'cutoff-reminder'`));
      assert(before === after, `ikinci koşu yeni cutoff-reminder üretti: ${before} → ${after}`);
      return `${items.length} ürün + teslimat günü önizlemede · koşu1 sent=${r1.details?.sent ?? '-'} · koşu2 yeni satır yok (${after})`;
    });

    // ═══ h — tahsilat başarılı ════════════════════════════════════════════════════════════════
    await step('h cycles:lock-and-charge → cycle#2 CHARGED → MailLog `cycle-charged` (tutar + sipariş no)', async () => {
      await job('cycles:lock-and-charge', plusMin(cutoffOf(state.a.cycle2On), 1));
      const d = await subDetail(state.a.subId);
      const c2 = cycleOf(d, 2);
      assert(c2.status === 'CHARGED', `cycle#2 ${c2.status}`);
      const row = await waitMail('cycle-charged', state.a.cycle2Id);
      const { path, html } = previewHtml(row);
      state.previewPaths.add(path);
      const text = stripTags(html);
      assert(/TL/.test(text), `tutar yok: ${text.slice(0, 200)}`);
      const orderNo = sql(`SELECT o."orderNo"::text FROM orders o JOIN subscription_cycles c ON c."orderId" = o.id WHERE c.id = ${lit(state.a.cycle2Id)}`);
      if (orderNo) assert(text.includes(orderNo), `sipariş no (#${orderNo}) yok: ${text.slice(0, 200)}`);
      return `cycle#2 CHARGED · konu "${row.subject.slice(0, 60)}" · sipariş #${orderNo || '-'}`;
    });

    // ═══ i — tahsilat başarısız ═══════════════════════════════════════════════════════════════
    await step('i müşteri B (`fail:` kart): kesim → cycle UNPAID → MailLog `cycle-payment-failed` (kart linki + yeniden deneme)', async () => {
      await custB.req('GET', '/api/v1/auth/csrf');
      const reg = await custB.req('POST', '/api/v1/auth/register', {
        email: B.email, password: PASSWORD, name: B.name, phone: B.phone, consents: [{ kind: 'KVKK_ACK', granted: true }],
      });
      assert(reg.status === 201, `B register → ${reg.status}`);
      state.b.userId = sql(`SELECT id FROM users WHERE email = ${lit(B.email)}`);
      state.entityIds.add(state.b.userId);
      await custB.must('PUT', '/api/v1/me/address', { fullName: B.name, phone: B.phone, line: `E2E F10 Teslimat Mah. ${RUN} Sk. No:2`, zoneSlug: ZONE_SLUG, zip: '35430' });
      state.b.pmFail = genId('e2ef10b');
      sql(
        `INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") ` +
          `VALUES (${lit(state.b.pmFail)}, ${lit(state.b.userId)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('fail:' + RUN)}, '0002', 'TEST', true, true, ${lit(new Date().toISOString())})`,
      );
      const dates = await custB.must('GET', `/api/v1/delivery/dates?zone=${ZONE_SLUG}`);
      const safe = (Array.isArray(dates) ? dates : [])
        .filter((d) => !d.locked && !d.full)
        .sort((x, y) => x.date.localeCompare(y.date))
        .find((d) => new Date(d.cutoffAtIso).getTime() > Date.now() + 24 * 3_600_000);
      assert(safe, 'B için uygun teslimat günü yok');
      const created = await admin.must(
        'POST', '/api/v1/admin/subscriptions',
        {
          userId: state.b.userId, tierSlug: state.tier.slug, frequencyWeeks: 1,
          deliveryDay: DAY_ENUM[safe.day], deliveryOn: safe.date,
          paymentMethodId: state.b.pmFail, chargeStrategy: 'MERCHANT_INITIATED', note: `e2e f10 ${RUN} teslimat`,
        },
        [201],
      );
      state.b.subId = created.subscription.id;
      state.b.orderId = created.order.id;
      state.entityIds.add(state.b.subId);
      state.entityIds.add(state.b.orderId);
      await job('cycles:ensure');
      const d = await subDetail(state.b.subId);
      const c2 = cycleOf(d, 2);
      state.b.cycleId = c2.id;
      state.b.cycleOn = c2.deliveryOn;
      await job('cycles:lock-and-charge', plusMin(cutoffOf(c2.deliveryOn), 1));
      const after = await subDetail(state.b.subId);
      const failed2 = cycleOf(after, 2);
      assert(failed2.status === 'UNPAID', `B cycle#2 ${failed2.status} (UNPAID beklenir)`);
      const row = await waitMail('cycle-payment-failed', `${state.b.cycleId}:1`);
      const { path, html } = previewHtml(row);
      state.previewPaths.add(path);
      const text = stripTags(html);
      assert(html.includes('/uyelik.html'), 'kart güncelleme bağlantısı yok');
      assert(/TL/.test(text), `tutar yok: ${text.slice(0, 160)}`);
      return `B cycle#2 UNPAID · deneme 1 maili · kart linki /uyelik.html · konu "${row.subject.slice(0, 50)}"`;
    });

    // ═══ j — teslimat durum mailleri ══════════════════════════════════════════════════════════
    await step('j teslimat durum mailleri: panelden OUT_FOR_DELIVERY → `order-shipped`, DELIVERED → `order-delivered`; B → `order-delivery-failed`', async () => {
      const orderId = sql(`SELECT "orderId" FROM subscription_cycles WHERE id = ${lit(state.a.cycle2Id)}`);
      assert(orderId, 'cycle#2 siparişi yok (DELTA/peşin farkı)');
      state.entityIds.add(orderId);
      const orderNo = sql(`SELECT "orderNo"::text FROM orders WHERE id = ${lit(orderId)}`);

      // PAID → PREPARING (bildirim yok) · panelden sürülür
      await panel.goto(`${ADMIN}/siparisler/${orderId}`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('heading', { name: new RegExp(`#${orderNo}`) }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await transition(panel, 'Hazırlanıyor');
      await transition(panel, 'Yolda');
      const shipped = await waitMail('order-shipped', orderId);
      const shippedPreview = previewHtml(shipped);
      state.previewPaths.add(shippedPreview.path);
      assert(stripTags(shippedPreview.html).includes(`#${orderNo}`), `order-shipped içinde sipariş no yok`);
      await shot(panel, 'j-siparis-yola-cikti');

      await transition(panel, 'Teslim edildi');
      const delivered = await waitMail('order-delivered', orderId);
      const deliveredPreview = previewHtml(delivered);
      state.previewPaths.add(deliveredPreview.path);
      assert(sql(`SELECT status FROM orders WHERE id = ${lit(orderId)}`) === 'DELIVERED', 'sipariş DELIVERED olmadı');

      // B'nin AÇILIŞ siparişi (PAID): PREPARING → OUT_FOR_DELIVERY → DELIVERY_FAILED (gerekçeli, API üzerinden).
      // cycle#2'nin siparişi tahsilat başarısız olduğu için PAYMENT_FAILED durumundadır — ops akışına giremez.
      const bOrderId = state.b.orderId;
      state.entityIds.add(bOrderId);
      await admin.must('PATCH', `/api/v1/admin/orders/${bOrderId}/status`, { status: 'PREPARING' });
      await admin.must('PATCH', `/api/v1/admin/orders/${bOrderId}/status`, { status: 'OUT_FOR_DELIVERY' });
      const reason = 'Adreste bulunulamadı (e2e)';
      await admin.must('PATCH', `/api/v1/admin/orders/${bOrderId}/status`, { status: 'DELIVERY_FAILED', reason });
      const failedMail = await waitMail('order-delivery-failed', bOrderId);
      const failedPreview = previewHtml(failedMail);
      state.previewPaths.add(failedPreview.path);
      assert(stripTags(failedPreview.html).includes(reason), `gerekçe metni yok: ${stripTags(failedPreview.html).slice(0, 200)}`);
      return `#${orderNo}: shipped + delivered · B siparişi delivery-failed (gerekçe önizlemede)`;
    });

    // ═══ k — iptal teyidi ═════════════════════════════════════════════════════════════════════
    await step('k iptal teyidi: /me/subscription/cancel → confirm → MailLog `subscription-cancelled` (son kutu)', async () => {
      const req = await custA.must('POST', '/api/v1/me/subscription/cancel', { reason: 'PRICE', note: `e2e f10 ${RUN}` });
      state.entityIds.add(req.cancellationId);
      // Kalma teklifi çıksa da çıkmasa da onay aynı uçtan (ADR-0007: teklif reddi = doğrudan onay).
      await custA.must('POST', '/api/v1/me/subscription/cancel/confirm', {});
      const status = sql(`SELECT status FROM subscriptions WHERE id = ${lit(state.a.subId)}`);
      assert(status === 'CANCELLED', `abonelik ${status}`);
      const row = await waitMail('subscription-cancelled', state.a.subId);
      const { path, html } = previewHtml(row);
      state.previewPaths.add(path);
      const text = stripTags(html);
      assert(text.includes(state.tier.name) || /kutu/i.test(text), `kutu adı/son kutu bilgisi yok: ${text.slice(0, 200)}`);
      assert(html.includes('/uyelik.html'), 'hesap bağlantısı yok');
      return `abonelik CANCELLED · konu "${row.subject.slice(0, 60)}"`;
    });

    // ═══ l — kvkk:purge ═══════════════════════════════════════════════════════════════════════
    await step('l kvkk:purge: eski MailLog/SystemLog/CronLog silinir (+ önizleme dosyası) · eski AuditLog PII `[silindi]` · taze satır durur', async () => {
      const old = {
        mail: daysAgo(120).toISOString(),
        system: daysAgo(60).toISOString(),
        cron: daysAgo(200).toISOString(),
        audit: new Date(Date.now() - 400 * 24 * 3_600_000).toISOString(),
      };
      state.fakeIds.mail = genId('e2eml');
      state.fakeIds.system = genId('e2esl');
      state.fakeIds.cron = genId('e2ecl');
      state.fakeIds.audit = genId('e2eal');
      state.fakeIds.mailPreview = join(MAIL_PREVIEW_DIR, `${state.fakeIds.mail}.html`);
      mkdirSync(MAIL_PREVIEW_DIR, { recursive: true });
      writeFileSync(state.fakeIds.mailPreview, '<p>e2e f10 eski önizleme</p>', 'utf8');
      sql(
        `INSERT INTO mail_logs (id, "to", subject, "templateSlug", "entityId", status, error, "createdAt") VALUES (` +
          `${lit(state.fakeIds.mail)}, ${lit(A.email)}, 'e2e eski', 'test', ${lit('e2e-old-' + RUN)}, 'SKIPPED', ${lit(PREVIEW_PREFIX + state.fakeIds.mailPreview)}, ${lit(old.mail)})`,
      );
      sql(
        `INSERT INTO system_logs (id, level, module, message, "occurrenceCount", "firstSeenAt", "lastSeenAt", "createdAt") VALUES (` +
          `${lit(state.fakeIds.system)}, 'ERROR', 'e2e-f10', 'e2e eski sistem kaydı', 1, ${lit(old.system)}, ${lit(old.system)}, ${lit(old.system)})`,
      );
      sql(
        `INSERT INTO cron_logs (id, name, status, "itemsProcessed", errors, "startedAt", "finishedAt", "durationMs") VALUES (` +
          `${lit(state.fakeIds.cron)}, 'cycles:ensure', 'SUCCESS', 0, 0, ${lit(old.cron)}, ${lit(old.cron)}, 5)`,
      );
      sql(
        `INSERT INTO audit_logs (id, "actorId", "actorEmail", action, module, "entityId", summary, "newValues", "ipAddress", "createdAt") VALUES (` +
          `${lit(state.fakeIds.audit)}, NULL, ${lit(A.email)}, 'UPDATE', 'e2e-f10', ${lit('e2e-old-' + RUN)}, ` +
          `${lit(`Eski kayıt ${A.email} / 0530 111 22 33`)}, ${lit(JSON.stringify({ email: A.email, phone: '0530 111 22 33', note: 'kalsın' }))}::jsonb, '203.0.113.9', ${lit(old.audit)})`,
      );
      const freshMail = num(sql(`SELECT count(*) FROM mail_logs WHERE "createdAt" >= ${lit(startedAt.toISOString())}`));

      const r = await job('kvkk:purge');
      const d = r.details ?? {};
      assert(num(sql(`SELECT count(*) FROM mail_logs WHERE id = ${lit(state.fakeIds.mail)}`)) === 0, 'eski MailLog silinmedi');
      assert(!existsSync(state.fakeIds.mailPreview), 'eski MailLog önizleme dosyası silinmedi');
      assert(num(sql(`SELECT count(*) FROM system_logs WHERE id = ${lit(state.fakeIds.system)}`)) === 0, 'eski SystemLog silinmedi');
      assert(num(sql(`SELECT count(*) FROM cron_logs WHERE id = ${lit(state.fakeIds.cron)}`)) === 0, 'eski CronLog silinmedi');
      const audit = sql(
        `SELECT coalesce("actorEmail",'-') || E'\\t' || coalesce("ipAddress",'-') || E'\\t' || coalesce(summary,'-') || E'\\t' || coalesce("newValues"::text,'-') FROM audit_logs WHERE id = ${lit(state.fakeIds.audit)}`,
      );
      assert(audit, 'eski AuditLog satırı SİLİNMİŞ (maskelenmeliydi)');
      const [actorEmail, ip, summary, newValues] = audit.split('\t');
      assert(actorEmail === '[silindi]', `actorEmail maskelenmedi: ${actorEmail}`);
      assert(ip === '[silindi]', `ipAddress maskelenmedi: ${ip}`);
      assert(!summary.includes(A.email) && summary.includes('[silindi]'), `summary maskelenmedi: ${summary}`);
      assert(!newValues.includes(A.email) && newValues.includes('kalsın'), `newValues: PII gitmeli, PII olmayan alan kalmalı → ${newValues.slice(0, 160)}`);
      const freshMailAfter = num(sql(`SELECT count(*) FROM mail_logs WHERE "createdAt" >= ${lit(startedAt.toISOString())}`));
      assert(freshMail === freshMailAfter, `taze MailLog satırları silindi: ${freshMail} → ${freshMailAfter}`);
      state.fakeIds.mail = null;
      state.fakeIds.system = null;
      state.fakeIds.cron = null;
      return `mail ${d.mailLogsDeleted ?? '?'} (+${d.mailPreviewsDeleted ?? '?'} önizleme) · system ${d.systemLogsDeleted ?? '?'} · cron ${d.cronLogsDeleted ?? '?'} · audit ${d.auditMasked ?? '?'}/${d.auditScanned ?? '?'} maskelendi · kapalı: ${(d.disabled ?? []).join(',') || '-'}`;
    });

    // ═══ m — Sistem ekranı (22) ═══════════════════════════════════════════════════════════════
    await step('m ekran 22 Sistem: Sağlık kartı (health/detailed) + Denetim/Sistem/Cron/E-posta/Webhook sekmeleri dolu', async () => {
      // Webhook sekmesi için bir kayıt (F8 bildirimi lokal koşuda üretilmiyor)
      state.fakeIds.webhook = genId('e2ewh');
      sql(
        `INSERT INTO webhook_events (id, provider, "eventType", "providerRef", payload, "signatureValid", status, "receivedAt") VALUES (` +
          `${lit(state.fakeIds.webhook)}, 'PAYTR', 'payment', ${lit('e2e-f10-' + RUN)}, ${lit(JSON.stringify({ merchant_oid: `e2e${RUN}`, status: 'success' }))}::jsonb, true, 'PROCESSED', ${lit(new Date().toISOString())})`,
      );
      // Sistem günlüğü sekmesi için: 5xx üretmeden doğrudan bir satır (RequestLoggerInterceptor yalnız hata yazar)
      state.fakeIds.system = genId('e2esl2');
      const nowIso = new Date().toISOString();
      sql(
        `INSERT INTO system_logs (id, level, module, action, message, "occurrenceCount", "firstSeenAt", "lastSeenAt", "createdAt") VALUES (` +
          `${lit(state.fakeIds.system)}, 'WARN', 'e2e-f10', 'SISTEM_EKRANI', 'e2e f10 sistem sekmesi kaydı', 1, ${lit(nowIso)}, ${lit(nowIso)}, ${lit(nowIso)})`,
      );

      const health = await admin.must('GET', '/api/v1/admin/health/detailed');
      assert(health.db.status === 'up', `health db: ${JSON.stringify(health.db)}`);
      assert(health.mailDisabled === true, 'DISABLE_MAIL=true beklenirken mailDisabled false');
      assert(health.jobRunAllowed === true, 'dev ortamında jobRunAllowed true olmalı');
      assert(JSON.stringify(health).toLowerCase().indexOf('password') === -1, 'sağlık yanıtında sır alanı');

      await panel.goto(`${ADMIN}/sistem`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('heading', { name: 'Sistem' }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await panel.waitForFunction(() => document.body.textContent.includes('Veritabanı'), null, { timeout: TIMEOUT });
      const healthText = flat(await panel.locator('main').first().textContent());
      assert(/Veritabanı/.test(healthText), `sağlık kartı yok: ${healthText.slice(0, 200)}`);
      assert(/İşleri çalıştır|Çalıştır/.test(healthText), 'dev ortamında "işleri çalıştır" görünmeli');
      await shot(panel, 'm-sistem-saglik');

      const tabCounts = {};
      for (const [key, label] of [['denetim', 'Denetim'], ['sistem', 'Sistem'], ['cron', 'Cron'], ['eposta', 'E-posta'], ['webhook', 'Webhook']]) {
        await panel.goto(`${ADMIN}/sistem?sekme=${key}`, { waitUntil: 'domcontentloaded' });
        await panel.locator('table.admin-table tbody tr').first().waitFor({ state: 'visible', timeout: TIMEOUT });
        const rows = await panel.locator('table.admin-table tbody tr').count();
        assert(rows > 0, `${label} sekmesi boş`);
        tabCounts[label] = rows;
        await shot(panel, `m-sistem-${key}`);
      }
      // API sayıları da dolu olmalı (panel filtreleriyle aynı uçlar)
      const audit = await admin.must('GET', '/api/v1/admin/audit-logs?limit=5');
      const sysLogs = await admin.must('GET', '/api/v1/admin/system-logs?limit=5');
      const cronLogs = await admin.must('GET', '/api/v1/admin/cron-logs?limit=5');
      const mailLogs = await admin.must('GET', '/api/v1/admin/mail-logs?limit=5');
      const hooks = await admin.must('GET', '/api/v1/admin/webhook-events?limit=5');
      for (const [name, list] of [['audit-logs', audit], ['system-logs', sysLogs], ['cron-logs', cronLogs], ['mail-logs', mailLogs], ['webhook-events', hooks]]) {
        assert((list.items ?? []).length > 0, `${name} listesi boş`);
      }
      const hookItem = (hooks.items ?? []).find((h) => h.id === state.fakeIds.webhook);
      assert(hookItem, 'eklenen webhook kaydı listede yok');
      return `sağlık ${health.status} · sekme satırları ${Object.entries(tabCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`;
    });

    // ═══ n — güvenlik ═════════════════════════════════════════════════════════════════════════
    await step('n güvenlik: oturumsuz admin 401 · IDOR 403/404 · CSRF\'siz mutasyon 403 · CSP (web/admin/api) + PayTR frame-src', async () => {
      const anon = new ApiClient(API);
      const notes = [];

      // 1) Oturumsuz admin uçları
      for (const path of ['/api/v1/admin/audit-logs', '/api/v1/admin/system-logs', '/api/v1/admin/cron-logs', '/api/v1/admin/webhook-events', '/api/v1/admin/health/detailed', '/api/v1/admin/settings/privacy']) {
        const r = await anon.req('GET', path);
        assert(r.status === 401, `${path} oturumsuz → ${r.status} (401 beklenir)`);
      }
      notes.push('6 admin ucu oturumsuz 401');

      // 2) IDOR: müşteri B, A'nın siparişini/aboneliğini göremez
      const aOrderNo = sql(`SELECT "orderNo"::text FROM orders WHERE id = ${lit(state.a.orderId)}`);
      const idorOrder = await custB.req('GET', `/api/v1/me/orders/${aOrderNo}`);
      assert([403, 404].includes(idorOrder.status), `IDOR sipariş → ${idorOrder.status}`);
      const idorAdmin = await custB.req('GET', `/api/v1/admin/subscriptions/${state.a.subId}`);
      assert(idorAdmin.status === 403, `müşteri admin abonelik ucu → ${idorAdmin.status} (403 beklenir)`);
      const idorCycle = await custB.req('PATCH', `/api/v1/admin/cycles/${state.a.cycle2Id}/status`, { status: 'DELIVERED' });
      assert(idorCycle.status === 403, `müşteri admin cycle ucu → ${idorCycle.status}`);
      notes.push(`IDOR: sipariş ${idorOrder.status} · admin uçları 403`);

      // 3) CSRF: oturum çerezi var, X-CSRF-Token yok → 403
      const noCsrf = await admin.req('PATCH', `/api/v1/admin/subscriptions/${state.b.subId}`, { note: 'csrf denemesi' }, { csrf: false });
      assert(noCsrf.status === 403, `CSRF'siz mutasyon → ${noCsrf.status} (403 beklenir)`);
      assert(noCsrf.data?.code, `hata zarfında code alanı yok: ${JSON.stringify(noCsrf.data).slice(0, 200)}`);
      notes.push(`CSRF'siz PATCH 403 (code=${noCsrf.data.code})`);

      // 4) CSP + başlıklar: web / admin / api
      const web = await fetch(`${API}/index.html`);
      const webCsp = web.headers.get('content-security-policy') ?? '';
      assert(/frame-src https:\/\/www\.paytr\.com/.test(webCsp), `web CSP frame-src PayTR yok: ${webCsp.slice(0, 200)}`);
      assert(/script-src [^;]*'unsafe-inline'/.test(webCsp), 'web CSP inline bootstrap için unsafe-inline içermiyor');
      assert(/frame-ancestors 'none'/.test(webCsp), 'web CSP frame-ancestors none yok');
      assert(/img-src [^;]*data:/.test(webCsp), 'web CSP img-src data: yok');
      assert(/font-src [^;]*data:/.test(webCsp), 'web CSP font-src data: yok (styles.css gömülü woff2)');
      const apiRes = await fetch(`${API}/api/v1/health`);
      const apiCsp = apiRes.headers.get('content-security-policy') ?? '';
      assert(/default-src 'none'/.test(apiCsp), `api CSP: ${apiCsp.slice(0, 160)}`);
      assert(!web.headers.get('x-powered-by') && !apiRes.headers.get('x-powered-by'), 'X-Powered-By açık');
      assert(!web.headers.get('strict-transport-security'), 'HSTS geliştirme ortamında gönderiliyor');
      assert(web.headers.get('x-frame-options') === 'DENY', `X-Frame-Options: ${web.headers.get('x-frame-options')}`);
      assert(apiRes.headers.get('x-content-type-options') === 'nosniff', 'nosniff yok');
      notes.push('CSP web/api ayrı · PayTR frame-src · HSTS yok (dev) · X-Powered-By yok');

      // 5) Sır sızıntısı: sır alanı yazılır → GET maskeli döner, şifreli değer (`enc:v1:`) yanıta hiç girmez
      const secretKey = `e2e-merchant-key-${RUN}`;
      const before = sql(`SELECT coalesce((SELECT value::text FROM settings WHERE key = 'payment.paytrMerchantKey'), 'YOK')`);
      await admin.must('PUT', '/api/v1/admin/settings/payment', { paytrMerchantKey: secretKey });
      const payment = await admin.must('GET', '/api/v1/admin/settings/payment');
      const raw = JSON.stringify(payment);
      assert(!raw.includes(secretKey), 'sır alanı ham değeriyle döndü');
      assert(!raw.includes('enc:v1:'), 'şifreli değer (enc:v1:) yanıta sızdı');
      const field = payment.fields.find((f) => f.key === 'paytrMerchantKey');
      assert(field?.isSecret === true && field.hasValue === true && field.value !== secretKey, `sır alanı: ${JSON.stringify(field)}`);
      assert(sql(`SELECT value::text FROM settings WHERE key = 'payment.paytrMerchantKey'`).includes('enc:v1:'), 'sır DB\'de şifresiz duruyor');
      // Geri al: satır yoksa sil, varsa eski değerine döndür
      if (before === 'YOK') sql(`DELETE FROM settings WHERE key = 'payment.paytrMerchantKey'`);
      else sql(`UPDATE settings SET value = ${lit(before)}::jsonb WHERE key = 'payment.paytrMerchantKey'`);
      // Ayar önbelleği (60 s) düşsün diye zararsız bir PUT: sağlayıcı alanı aynı değerle yazılır.
      const providerValue = payment.fields.find((f) => f.key === 'provider')?.value ?? 'manual';
      await admin.must('PUT', '/api/v1/admin/settings/payment', { provider: providerValue });
      notes.push('sır: GET maskeli · yanıtta enc:v1: yok · DB\'de şifreli');
      return notes.join(' · ');
    });

  } catch {
    failed = true;
  }

  // ═══ z — temizlik (adımlardan biri patlasa da koşar) ════════════════════════════════════════
  if (!KEEP) {
    try {
      await step('z temizlik: koşunun ürettiği satırlar silinir, ayarlar geri → 17 tablo ≡ başlangıç', async () => {
        const problems = [];
        const tryDo = (label, fn) => {
          try {
            fn();
          } catch (err) {
            problems.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        const userIds = [state.a.userId, state.b.userId].filter(Boolean);
        const U = inList(userIds);
        const subIds = [state.a.subId, state.b.subId].filter(Boolean);
        const S = inList(subIds);

        // Önizleme dosyaları (koşuda üretilen MailLog satırlarınınki dahil)
        for (const line of sqlLines(`SELECT error FROM mail_logs WHERE "to" IN (${inList([A.email, B.email])}) AND error LIKE 'preview:%'`)) {
          state.previewPaths.add(line.slice(PREVIEW_PREFIX.length).trim());
        }
        for (const p of state.previewPaths) {
          if (p && existsSync(p)) tryDo(`önizleme ${p.slice(-24)}`, () => unlinkSync(p));
        }
        if (state.fakeIds.mailPreview && existsSync(state.fakeIds.mailPreview)) tryDo('yapay önizleme', () => unlinkSync(state.fakeIds.mailPreview));

        if (subIds.length) {
          const O = `SELECT id FROM orders WHERE "subscriptionId" IN (${S}) OR "userId" IN (${U})`;
          tryDo('cycle_items', () => sql(`DELETE FROM cycle_items WHERE "cycleId" IN (SELECT id FROM subscription_cycles WHERE "subscriptionId" IN (${S}))`));
          tryDo('subscription_events', () => sql(`DELETE FROM subscription_events WHERE "subscriptionId" IN (${S})`));
          tryDo('subscription_cancellations', () => sql(`DELETE FROM subscription_cancellations WHERE "subscriptionId" IN (${S})`));
          tryDo('refunds', () => sql(`DELETE FROM refunds WHERE "paymentId" IN (SELECT id FROM payments WHERE "orderId" IN (${O}))`));
          tryDo('payments', () => sql(`DELETE FROM payments WHERE "orderId" IN (${O})`));
          tryDo('subscription_cycles', () => sql(`UPDATE subscription_cycles SET "orderId" = NULL WHERE "subscriptionId" IN (${S})`));
          tryDo('order_lines', () => sql(`DELETE FROM order_lines WHERE "orderId" IN (${O})`));
          tryDo('consents(order)', () => sql(`UPDATE consents SET "orderId" = NULL WHERE "orderId" IN (${O})`));
          tryDo('orders', () => sql(`DELETE FROM orders WHERE "subscriptionId" IN (${S}) OR "userId" IN (${U})`));
          tryDo('subscription_cycles(del)', () => sql(`DELETE FROM subscription_cycles WHERE "subscriptionId" IN (${S})`));
          tryDo('subscriptions', () => sql(`DELETE FROM subscriptions WHERE id IN (${S})`));
        }
        if (userIds.length) {
          tryDo('payment_methods', () => sql(`DELETE FROM payment_methods WHERE "userId" IN (${U})`));
          tryDo('addresses', () => sql(`DELETE FROM addresses WHERE "userId" IN (${U})`));
          tryDo('consents(user)', () => sql(`DELETE FROM consents WHERE "userId" IN (${U})`));
          tryDo('carts', () => sql(`DELETE FROM carts WHERE "userId" IN (${U})`));
          tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "to" IN (${inList([A.email, B.email])})`));
          tryDo('users', () => sql(`DELETE FROM users WHERE id IN (${U})`));
        }
        if (state.guestKeys.length) tryDo('consents(guest)', () => sql(`DELETE FROM consents WHERE "guestKey" IN (${inList(state.guestKeys)})`));
        if (state.templateIds.length) {
          tryDo('box_template_items', () => sql(`DELETE FROM box_template_items WHERE "templateId" IN (${inList(state.templateIds)})`));
          tryDo('box_templates', () => sql(`DELETE FROM box_templates WHERE id IN (${inList(state.templateIds)})`));
        }
        if (state.fakeIds.webhook) tryDo('webhook_events', () => sql(`DELETE FROM webhook_events WHERE id = ${lit(state.fakeIds.webhook)}`));
        if (state.fakeIds.audit) tryDo('audit_logs(yapay)', () => sql(`DELETE FROM audit_logs WHERE id = ${lit(state.fakeIds.audit)}`));
        if (state.fakeIds.system) tryDo('system_logs(yapay)', () => sql(`DELETE FROM system_logs WHERE id = ${lit(state.fakeIds.system)}`));
        tryDo('system_logs(e2e)', () => sql(`DELETE FROM system_logs WHERE module = 'e2e-f10'`));
        if (state.cronLogIds.length) tryDo('cron_logs', () => sql(`DELETE FROM cron_logs WHERE id IN (${inList(state.cronLogIds)})`));

        const since = lit(new Date(startedAt.getTime() - 5_000).toISOString());
        tryDo('audit_logs', () =>
          sql(
            `DELETE FROM audit_logs WHERE "createdAt" >= ${since} AND (${userIds.length ? `"actorId" IN (${inList(userIds)}) OR ` : ''}"entityId" IN (${inList([...state.entityIds])}) OR module IN ('subscriptions','orders','settings','jobs','payments','delivery'))`,
          ),
        );
        for (const [id, reserved] of state.ddBaseline) tryDo(`dd ${id}`, () => sql(`UPDATE delivery_dates SET reserved = ${reserved} WHERE id = ${lit(id)} AND reserved <> ${reserved}`));
        tryDo('delivery_dates(new)', () =>
          sql(
            `DELETE FROM delivery_dates d WHERE d.id NOT IN (${inList([...state.ddAllBefore])}) AND NOT EXISTS (SELECT 1 FROM subscription_cycles c WHERE c."deliveryDateId" = d.id) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."deliveryDateId" = d.id)`,
          ),
        );

        // Ayarlar geri
        if (state.cookiesChanged && state.cookiesBefore) {
          await admin.must('PUT', '/api/v1/admin/settings/cookies', state.cookiesBefore);
        }
        if (problems.length) throw new Error(`temizlik sorunları: ${problems.join(' · ')}`);

        const after = snapshot();
        const diffs = Object.keys(state.counts ?? {}).filter((k) => state.counts[k] !== after[k]).map((k) => `${k} ${state.counts[k]}→${after[k]}`);
        assert(diffs.length === 0, `sayımlar başlangıçtan farklı: ${diffs.join(', ')}`);
        const reservedDiff = sqlLines("SELECT id || E'\\t' || reserved FROM delivery_dates").filter((r) => {
          const [id, reserved] = r.split('\t');
          return state.ddBaseline.has(id) && state.ddBaseline.get(id) !== num(reserved);
        });
        assert(reservedDiff.length === 0, `delivery_dates.reserved geri alınmadı: ${reservedDiff.join(', ')}`);
        const cookies = await admin.must('GET', '/api/v1/admin/settings/cookies');
        const nowCookies = Object.fromEntries(cookies.fields.map((f) => [f.key, f.value]));
        assert(JSON.stringify(nowCookies) === JSON.stringify(state.cookiesBefore), `cookies ayarı geri alınmadı: ${JSON.stringify(nowCookies)}`);
        const privacy = await admin.must('GET', '/api/v1/admin/settings/privacy');
        const nowPrivacy = Object.fromEntries(privacy.fields.map((f) => [f.key, f.value]));
        assert(JSON.stringify(nowPrivacy) === JSON.stringify(state.privacyBefore), `privacy ayarı değişmiş: ${JSON.stringify(nowPrivacy)}`);
        return `${SNAP_TABLES.length} tablo ≡ başlangıç · reserved geri · cookies/privacy ayarları geri`;
      });
    } catch {
      failed = true;
    }
  }

  await browser.close();

  // ---- rapor ---------------------------------------------------------------------------------
  const okCount = results.filter((r) => r.ok).length;
  const lines = [
    '# e2e F10 — bildirimler + çerez onayı + KVKK + Sistem ekranı + güvenlik',
    '',
    `- Tarih: ${startedAt.toISOString()} · Süre: ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)} s`,
    `- API: \`${API}\` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: \`${ADMIN}\` (vite preview, proxy)`,
    `- Müşteriler: \`${A.email}\` (bildirim/iptal) · \`${B.email}\` (tahsilat hatası/teslimat) · sağlayıcı: ManualProvider (\`ok:\` / \`fail:\` kart)`,
    "- Zaman yalnız job'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — üretimde 403). `cookies.*` ayarları koşu süresince açıldı ve geri alındı.",
    '- E-postalar `DISABLE_MAIL=true` altında MailLog(SKIPPED) + `logs/mail/<id>.html` önizlemesi üretir; içerik oradan okundu.',
    `- Sonuç: **${okCount}/${results.length}**${failed ? ' — HATA' : ' — tümü OK'}`,
    '',
    '| # | Adım | Sonuç | Süre | Not |',
    '|---|---|---|---|---|',
    ...results.map((r, i) => `| ${i + 1} | ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|').slice(0, 320)} |`),
    '',
    '## Ekran görüntüleri',
    '',
    '`tools/e2e-admin/out/f10-*.png` (gitignore).',
    '',
  ];
  if (pageErrors.length) {
    lines.push('## Sayfa hataları (konsol/pageerror)', '', ...pageErrors.slice(0, 20).map((e) => `- ${e}`), '');
  }
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

/** "22.08.2026" (panel/e-posta biçimi) — kesim hatırlatmasında teslimat günü metni. */
function trLabelOf(iso) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
