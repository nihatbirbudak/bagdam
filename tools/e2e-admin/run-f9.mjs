// tools/e2e-admin/run-f9.mjs — F9 uçtan uca: müşteri abonelik yönetimi (site) + ops ekranları (panel)
//
// F4/F5/F6/F7/F8 kalıbı: geçici API (:4088, PAYMENT_PROVIDER=manual · ENABLE_CRON=false · DISABLE_MAIL=true ·
// WEB_URL/ADMIN_URL geçici portlara) + admin preview (:4089, ADMIN_API_PROXY=4088) ÖNCEDEN ayağa kaldırılır.
// Müşteri akışı SİTE sayfalarında (uyelik.hbs · kutu.hbs · sepet.hbs + cart.js `BahcedenCart.remote`), yönetim
// akışı admin panelinde koşar; her adım public yüzey, API ve psql ile doğrulanır:
//   a  hazırlık: admin girişi · başlangıç sayımları (16 tablo) · delivery_dates.reserved anlık görüntüsü ·
//      commerce ayarları saklanır → dunning [2,12] · firstCycleSkippable true · deliveryDatesHorizonWeeks 2 (sonda geri)
//   b  şablonlar: sonraki haftalar için BoxTemplate (kopya + yayınla; koşuda üretilenler silinir)
//   c  müşteri A kaydı (POST /auth/register + KVKK) + adres (PUT /me/address, urla)
//   d  site: /kutu.html?tier= → "aboneliği başlat" → /sepet.html → gün + yasal onaylar (abonelik sözleşmesi dahil)
//      → "siparişi tamamla" → Order SUBSCRIPTION PAID · Subscription ACTIVE · cycle#1 SCHEDULED (peşin)
//   e  /uyelik.html: abonelik kartı · bu haftanın kutusu (ürün adları) · kesim geri sayımı · "Bu haftaki ödeme"
//   f  teslimat günü değiştir (kart içi gün düğmeleri → "değişiklikleri onayla" → PATCH /me/subscription)
//   g  /kutu.html canlı mod: tier/tür düğmeleri disabled (ADR-0008) · içerik değiştir (swap) + ürün tercihi +
//      ekstra ekle → onayla (PATCH …/cycles/current) · frekans 1hafta → 2hafta → 1hafta (PATCH /me/subscription)
//   h  /sepet.html: tekil ürün sepete → "bu haftaki kutuma ekle" (POST …/cycles/current/merge-cart) → sepet boşalır
//   i  /uyelik.html: haftayı atla (onay sorusu) → SKIPPED + rozet → geri al → SCHEDULED (DD rezervi −1/+1)
//   j  kesim: POST /admin/jobs/cycles:lock-and-charge/run {now} → cycle#1 CHARGED (peşin, 0 TL)
//   k  iptal akışı (site): talep → kalma teklifi → "iptalden vazgeç" → ACTIVE → tekrar talep (teklifsiz) → onayla →
//      CANCELLED görünümü (/me/subscription null; kilitli cycle ADR-0007 gereği CHARGED kalır)
//   l  admin ekran 19: Abonelikler listesi (arama) → detay (künye · kutu geçmişi · olay günlüğü · iptal kaydı)
//   m  admin ekran 20: Teslimat Günü — kutular · toplama listesi (ürün/tercih) · paketleme fişi (müşteri/adres/içerik)
//      · yazdırma görünümü (print medyası) · toplu durum PREPARING → OUT_FOR_DELIVERY → DELIVERED
//   n  müşteri B: kayıt + adres + saklı kartlar (ok:/fail:, psql) → admin manuel checkout (MIT) → cycles:ensure
//   o  kesim (B cycle#2): lock-and-charge → `fail:` kart reddedilir → cycle#2 UNPAID (dunning +2 s)
//   p  admin ekran 18: Ödeme Problemleri — satır listede · kart düzeltilir · "yeniden çek" → CHARGED
//   q  admin ekran 14b: Teslimat tarihleri — kapasite düzenle · günü kapat/aç · "Tarih üret" (idempotent)
//   r  admin ekran 21: Özet — kartlar GET /admin/dashboard ile birebir
//   z  temizlik: kullanıcı/abonelik/cycle/sipariş/ödeme/kart/consent/olay/şablon/cron/audit satırları silinir,
//      delivery_dates.reserved geri, commerce ayarları geri → 16 tablo sayımı ≡ başlangıç
//
// Kullanım (repo kökünden):
//   node tools/e2e-admin/run-f9.mjs [--api=http://127.0.0.1:4088] [--admin=http://127.0.0.1:4089] [--headed] [--keep] [--timeout=25000]
// Not: zaman yalnız job'lara verilen `now` ile ilerletilir (`POST /admin/jobs/:name/run {now}` — üretimde 403).
// Not: `SettingsService` grup satırlarını 60 s önbellekler; koşudan hemen sonra paneli denetleyeceksen API'yi yeniden başlat.
// Çıktı: tools/e2e-admin/out/f9-*.png, tools/e2e-admin/report-f9.md. Çıkış kodu: hata varsa 1.
// Sırlar (SEED_ADMIN_*, DATABASE_URL) yalnız env'den okunur; çıktıya yazılmaz.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report-f9.md');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4088').replace(/\/$/, '');
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://127.0.0.1:4089').replace(/\/$/, '');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 25_000);
const PSQL = process.env.PSQL || 'psql';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ZONE_SLUG = 'urla';
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
const A = { email: `e2e-f9a-${RUN}@example.com`, name: `E2E F9 Abone ${RUN}`, phone: '0530 000 00 09' };
const B = { email: `e2e-f9b-${RUN}@example.com`, name: `E2E F9 Ops ${RUN}`, phone: '0530 000 00 19' };
const COMMERCE_KEYS = ['dunning', 'firstCycleSkippable', 'deliveryDatesHorizonWeeks'];

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f9] ${msg}`);
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
/** psql -tAc. Bağlantı dizesi (parola) hata mesajına YAZILMAZ. */
function sql(query) {
  try {
    return execFileSync(PSQL, [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr).trim() : '';
    throw new Error(`psql hatası: ${stderr || 'komut başarısız'} — sorgu: ${query.slice(0, 90)}`);
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
const money = (n) => Number(n).toFixed(2);
const PREVIEW_PREFIX = 'preview:';
const flat = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// ---- takvim (Europe/Istanbul kalıcı +03; kesim = teslimattan 1 gün önce 12:00) -----------------
const TZ_OFFSET = '+03:00';
const istanbulToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const mondayOf = (iso) => addDays(iso, -((dow(iso) + 6) % 7));
const cutoffOf = (deliveryOn) => new Date(`${addDays(deliveryOn, -1)}T12:00:00${TZ_OFFSET}`);
const plusMin = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
/** Panelin gösterdiği biçim (admin lib/utils#formatDate). */
const trDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const DAY_OFFSET = { sali: 1, persembe: 3, cumartesi: 5 };
const DAY_ENUM = { sali: 'SALI', persembe: 'PERSEMBE', cumartesi: 'CUMARTESI' };

const SNAP_TABLES = [
  'users', 'addresses', 'consents', 'subscriptions', 'subscription_cycles', 'cycle_items', 'subscription_events',
  'subscription_cancellations', 'orders', 'order_lines', 'payments', 'payment_methods', 'mail_logs', 'box_templates',
  'box_template_items', 'delivery_dates',
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
    // Uzun psql aralarında keep-alive soketi düşebiliyor → ağ hatasında bir kez yeniden dene.
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

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `f9-${name}.png`), fullPage: false }).catch(() => {});
}
async function siteLogin(page, email, password) {
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginSubmit').click();
}
async function adminLogin(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: TIMEOUT });
}
/** Seçici DOM'a girene kadar bekle (görünürlük değil, varlık). */
async function waitFor(page, selector, label) {
  await page
    .waitForFunction((sel) => !!document.querySelector(sel), selector, { timeout: TIMEOUT })
    .catch(async () => {
      throw new Error(`${label}: "${selector}" oluşmadı → kart="${flat(await page.locator('#subCard').textContent().catch(() => ''))?.slice(0, 220)}"`);
    });
}
/** Seçici DOM'dan çıkana kadar bekle (istek başarıyla bittiğinde taslak/düğme kalkar). */
async function waitGone(page, selector, label) {
  await page
    .waitForFunction((sel) => !document.querySelector(sel), selector, { timeout: TIMEOUT })
    .catch(async () => {
      throw new Error(`${label}: "${selector}" kaybolmadı → kart="${flat(await page.locator('#subCard').textContent().catch(() => ''))?.slice(0, 220)}"`);
    });
}
const cardText = async (page) => flat(await page.locator('#subCard').textContent());

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
    commerceChanged: false,
    tier: null,
    templateIds: [],
    a: { userId: null, subId: null, orderId: null, orderNo: null, cycle1Id: null, deliveryOn: null, day: null, pmOk: null },
    b: { userId: null, subId: null, orderId: null, pmOk: null, pmFail: null, cycle2Id: null, cycle2DeliveryOn: null },
    cronLogIds: [],
    entityIds: new Set(),
  };
  let failed = false;

  const job = async (name, now) => {
    const body = now ? { now: now.toISOString() } : {};
    const r = await admin.must('POST', `/api/v1/admin/jobs/${name}/run`, body);
    assert(r.status === 'SUCCESS', `${name} → ${r.status} ${JSON.stringify(r.details).slice(0, 200)}`);
    assert(r.errors === 0, `${name} errors=${r.errors} ${JSON.stringify(r.details).slice(0, 300)}`);
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
  const reservedOf = (ddId) => num(sql(`SELECT reserved FROM delivery_dates WHERE id = ${lit(ddId)}`));
  const ddIdOf = (isoDate) => sql(`SELECT d.id FROM delivery_dates d JOIN delivery_zones z ON z.id = d."zoneId" WHERE z.slug = ${lit(ZONE_SLUG)} AND d.date = ${lit(isoDate)}::date`);
  const cycleStatus = (id) => sql(`SELECT status FROM subscription_cycles WHERE id = ${lit(id)}`);
  const subStatus = (id) => sql(`SELECT status FROM subscriptions WHERE id = ${lit(id)}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const siteCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  siteCtx.setDefaultTimeout(TIMEOUT);
  adminCtx.setDefaultTimeout(TIMEOUT);
  const site = await siteCtx.newPage();
  const panel = await adminCtx.newPage();
  const pageErrors = [];
  for (const [label, p] of [['site', site], ['admin', panel]]) {
    p.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
  }
  // Konsol hataları yalnız site tarafında toplanır: admin paneli giriş öncesi `/auth/me` 401'ini normal akışta üretir.
  site.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`site console: ${flat(m.text()).slice(0, 200)}`);
  });

  try {
    // ═══ a — hazırlık ═════════════════════════════════════════════════════════════════════════
    await step('a hazırlık: admin girişi · 16 tablo sayımı · delivery_dates.reserved · commerce ayarları (dunning [2,12] · ilk kutu atlanabilir · ufuk 2 hafta)', async () => {
      const me = await admin.loginAdmin();
      assert(me && me.role === 'ADMIN', 'seed admin ADMIN rolünde olmalı');
      const health = await admin.must('GET', '/api/v1/health');
      assert(health && health.status !== 'down', `health: ${JSON.stringify(health).slice(0, 120)}`);
      state.counts = snapshot();
      for (const row of sqlLines("SELECT id || E'\\t' || reserved FROM delivery_dates")) {
        const [id, reserved] = row.split('\t');
        state.ddBaseline.set(id, num(reserved));
        state.ddAllBefore.add(id);
      }
      const commerce = await admin.must('GET', '/api/v1/admin/settings/commerce');
      for (const key of COMMERCE_KEYS) {
        const f = commerce.fields.find((x) => x.key === key);
        assert(f !== undefined, `commerce.${key} okunamadı`);
        state.commerce[key] = f.value;
      }
      await admin.must('PUT', '/api/v1/admin/settings/commerce', {
        dunning: { retryHours: [2, 12], pastDueAfterUnpaid: 2 },
        firstCycleSkippable: true,
        deliveryDatesHorizonWeeks: 2,
      });
      state.commerceChanged = true;
      const after = await admin.must('GET', '/api/v1/admin/settings/commerce');
      const val = (k) => after.fields.find((f) => f.key === k)?.value;
      assert(val('firstCycleSkippable') === true && val('deliveryDatesHorizonWeeks') === 2, `ayarlar uygulanmadı: ${JSON.stringify({ s: val('firstCycleSkippable'), h: val('deliveryDatesHorizonWeeks') })}`);
      // En küçük tier: kutuda tüm taze ürünler bulunmaz → kutu.html'de değiştokuş (swap) seçeneği kalır
      const tierRow = sql('SELECT id || E\'\\t\' || slug || E\'\\t\' || price || E\'\\t\' || label FROM box_tiers WHERE "isActive" ORDER BY "sortOrder" ASC LIMIT 1');
      assert(tierRow, 'aktif tier yok');
      const [tierId, tierSlug, tierPrice, tierLabel] = tierRow.split('\t');
      state.tier = { id: tierId, slug: tierSlug, price: num(tierPrice), label: tierLabel };
      return `sayımlar users=${state.counts.users} subs=${state.counts.subscriptions} cycles=${state.counts.subscription_cycles} orders=${state.counts.orders} dd=${state.counts.delivery_dates} · tier ${tierSlug} (${state.tier.price} TL)`;
    });

    // ═══ b — şablonlar ════════════════════════════════════════════════════════════════════════
    await step('b haftanın kutusu şablonları: sonraki 4 hafta için kopya + yayınla (cycles:ensure şablonsuz hafta görmemeli)', async () => {
      const base = mondayOf(istanbulToday());
      const weeks = [base, addDays(base, 7), addDays(base, 14), addDays(base, 21)];
      const srcItems = sqlLines(
        `SELECT i."productId" || E'\\t' || i."qtyLabel" || E'\\t' || i."isSwappable" FROM box_template_items i
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
          tpl = await admin.must('POST', '/api/v1/admin/box-templates', { tierId: state.tier.id, weekStart: ws, curatorName: `E2E F9 ${RUN}`, items: srcItems }, [200, 201]);
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

    // ═══ c — müşteri A ════════════════════════════════════════════════════════════════════════
    await step('c müşteri A kaydı (POST /auth/register, KVKK) + adres (PUT /me/address, urla)', async () => {
      await custA.req('GET', '/api/v1/auth/csrf');
      const reg = await custA.req('POST', '/api/v1/auth/register', {
        email: A.email,
        password: PASSWORD,
        name: A.name,
        phone: A.phone,
        consents: [{ kind: 'KVKK_ACK', granted: true }],
      });
      assert(reg.status === 201, `register → ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
      state.a.userId = sql(`SELECT id FROM users WHERE email = ${lit(A.email)}`);
      assert(state.a.userId, 'kullanıcı satırı yok');
      state.entityIds.add(state.a.userId);
      const addr = await custA.must('PUT', '/api/v1/me/address', {
        fullName: A.name,
        phone: A.phone,
        line: `E2E F9 Mah. ${RUN} Sk. No:9`,
        zoneSlug: ZONE_SLUG,
        zip: '35430',
      });
      assert(addr && addr.id && addr.zoneSlug === ZONE_SLUG, `adres: ${JSON.stringify(addr).slice(0, 160)}`);
      // Saklı kart (ManualProvider `ok:` token): kesimde DELTA tahsilatı MIT ile yapılabilsin (PayTR'de kart
      // ilk ödemede saklanır — F8 notu; burada psql ile kurulur).
      state.a.pmOk = genId('e2epma');
      sql(
        `INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") ` +
          `VALUES (${lit(state.a.pmOk)}, ${lit(state.a.userId)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('ok:' + RUN)}, '0009', 'TEST', true, true, ${lit(new Date().toISOString())})`,
      );
      return `user=${state.a.userId.slice(0, 8)}… adres=${addr.id.slice(0, 8)}… kart 0009`;
    });

    // ═══ d — abonelik satın alma (site checkout) ══════════════════════════════════════════════
    await step('d site: /kutu.html → "aboneliği başlat" → /sepet.html (gün + SUBSCRIPTION_CONTRACT_ACK) → Order SUBSCRIPTION PAID · Subscription ACTIVE · cycle#1', async () => {
      const dates = await custA.must('GET', `/api/v1/delivery/dates?zone=${ZONE_SLUG}`);
      const open = (Array.isArray(dates) ? dates : []).filter((d) => !d.locked && !d.full).sort((x, y) => x.date.localeCompare(y.date));
      // Kesimi en az 24 saat uzakta olan gün: koşu sırasında kilitlenmesin
      const safe = open.find((d) => new Date(d.cutoffAtIso).getTime() > Date.now() + 24 * 3_600_000);
      assert(safe, `kesimi 24 s uzakta açık teslimat günü yok: ${JSON.stringify(open.slice(0, 4))}`);
      const firstOfDay = open.find((d) => d.day === safe.day);
      assert(firstOfDay && firstOfDay.date === safe.date, `gün ${safe.day} için ilk açık tarih ${firstOfDay?.date} ≠ ${safe.date}`);
      state.a.day = safe.day;
      state.a.deliveryOn = safe.date;

      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      await siteLogin(site, A.email, PASSWORD);
      await site.locator('#accountGrid').waitFor({ state: 'visible', timeout: TIMEOUT });
      await site.goto(`${API}/kutu.html?tier=${state.tier.slug}`, { waitUntil: 'networkidle' });
      // Kutu editöründe teslimat günü seçilmeden "aboneliği başlat" pasif kalır
      await site.locator(`#deliveryDayToggle .toggle[data-day="${state.a.day}"]`).click();
      const startBtn = site.locator('#confirmBtn');
      await startBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      assert(/aboneliği başlat/i.test(flat(await startBtn.textContent())), `kutu düğmesi: ${flat(await startBtn.textContent())}`);
      await startBtn.click();
      await site.waitForURL(/sepet\.html/, { timeout: TIMEOUT });
      await site.waitForLoadState('networkidle');
      await site.locator('#checkoutSections').waitFor({ state: 'visible', timeout: TIMEOUT });

      const dayBtn = site.locator(`#checkoutDeliveryDay .toggle[data-day="${state.a.day}"]:not([disabled])`);
      await dayBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await dayBtn.click();
      await site.waitForFunction(() => document.querySelectorAll('#checkoutLegal input[data-legal-slug]').length >= 3, null, { timeout: TIMEOUT });
      const boxes = site.locator('#checkoutLegal input[data-legal-slug]');
      const slugs = [];
      const n = await boxes.count();
      for (let i = 0; i < n; i++) {
        slugs.push(await boxes.nth(i).getAttribute('data-legal-slug'));
        await boxes.nth(i).check();
      }
      assert(slugs.includes('abonelik-sozlesmesi'), `abonelik sözleşmesi onay kutusu yok: ${slugs.join(',')}`);
      await shot(site, 'd-checkout');
      await site.locator('#checkoutComplete').click();
      await site.locator('#checkoutSuccess').waitFor({ state: 'visible', timeout: 60_000 });
      const text = flat(await site.locator('#checkoutSuccess').textContent());
      const m = text.match(/#(\d+)/);
      assert(m, `abonelik başarı metni: ${text}`);
      state.a.orderNo = Number(m[1]);

      const orderRow = sql(
        `SELECT id || E'\\t' || status || E'\\t' || kind || E'\\t' || coalesce("subscriptionId",'') FROM orders WHERE "orderNo" = ${state.a.orderNo}`,
      );
      const [orderId, oStatus, oKind, subId] = orderRow.split('\t');
      assert(oStatus === 'PAID' && oKind === 'SUBSCRIPTION' && subId, `abonelik siparişi: ${orderRow}`);
      state.a.orderId = orderId;
      state.a.subId = subId;
      state.entityIds.add(orderId);
      state.entityIds.add(subId);
      assert(subStatus(subId) === 'ACTIVE', 'Subscription ACTIVE değil');
      const d = await subDetail(subId);
      const c1 = cycleOf(d, 1);
      state.a.cycle1Id = c1.id;
      assert(c1.status === 'SCHEDULED' && c1.deliveryOn === state.a.deliveryOn, `cycle#1 ${c1.status} / ${c1.deliveryOn} (beklenen ${state.a.deliveryOn})`);
      // Kart bağla (PATCH /me/subscription {paymentMethodId}) — kesimde DELTA tahsilatı MIT ile geçsin
      const withCard = await custA.must('PATCH', '/api/v1/me/subscription', { paymentMethodId: state.a.pmOk });
      assert(withCard.card && withCard.card.last4 === '0009', `kart bağlanmadı: ${JSON.stringify(withCard.card)}`);
      return `#${state.a.orderNo} PAID · sub ACTIVE · cycle#1 ${c1.status} ${state.a.deliveryOn} (${state.a.day}) · toplam ${d.cycles.length} cycle · kart ****0009`;
    });

    // ═══ e — uyelik.html abonelik kartı ═══════════════════════════════════════════════════════
    await step('e /uyelik.html: abonelik kartı · bu haftanın kutusu (ürün adları) · kesim geri sayımı · "Bu haftaki ödeme"', async () => {
      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      await site.locator('#subCard').waitFor({ state: 'visible', timeout: TIMEOUT });
      await waitFor(site, '#subCard .account-pay', 'abonelik kartı');
      const card = await cardText(site);
      const meSub = await custA.must('GET', '/api/v1/me/subscription');
      assert(meSub && meSub.purchased === true && meSub.status === 'ACTIVE', `/me/subscription: ${JSON.stringify(meSub).slice(0, 200)}`);
      assert(Array.isArray(meSub.items) && meSub.items.length > 0, `kutu içeriği boş: ${JSON.stringify(meSub.items)}`);
      assert(card.includes('AKTİF ABONELİK'), `kartta "AKTİF ABONELİK" yok: ${card.slice(0, 200)}`);
      assert(card.includes(state.tier.label), `kartta kutu adı yok (${state.tier.label})`);
      const firstName = sql(`SELECT name FROM products WHERE slug = ${lit(meSub.items[0])}`);
      assert(firstName && card.includes(firstName), `kartta ürün adı yok (${firstName}): ${card.slice(0, 220)}`);
      assert(/DEĞİŞİKLİK İÇİN: .* SÜREN VAR/.test(card), `kesim geri sayımı yok: ${card.slice(0, 220)}`);
      assert(card.includes('Bu haftaki ödeme'), `"Bu haftaki ödeme" satırı yok: ${card.slice(0, 220)}`);
      assert(await site.locator('#subCard a.cta.olive').count(), 'kutu düzenleme bağlantısı yok (cycle düzenlenebilir olmalı)');
      assert(meSub.currentCycle && meSub.currentCycle.locked === false && meSub.currentCycle.cutoffAtIso, `currentCycle: ${JSON.stringify(meSub.currentCycle)}`);
      await shot(site, 'e-uyelik-kart');
      assert(pageErrors.length === 0, `sayfa hatası: ${pageErrors.slice(0, 3).join(' | ')}`);
      return `kutu ${meSub.items.length} ürün · kesim ${meSub.currentCycle.cutoffAtIso} · sonraki teslimat ${meSub.nextDeliveryOn ?? meSub.currentCycle.deliveryOn}`;
    });

    // ═══ f — teslimat günü değiştir ═══════════════════════════════════════════════════════════
    await step('f teslimat günü değiştir (kart içi gün düğmesi → "değişiklikleri onayla" → PATCH /me/subscription; cycle#1 aynı hafta taşınır)', async () => {
      const beforeDdId = ddIdOf(state.a.deliveryOn);
      const beforeReserved = reservedOf(beforeDdId);
      const weekStart = mondayOf(state.a.deliveryOn);
      const target = ['sali', 'persembe', 'cumartesi']
        .filter((d) => d !== state.a.day)
        .find((d) => cutoffOf(addDays(weekStart, DAY_OFFSET[d])).getTime() > Date.now() + 3_600_000);
      assert(target, `aynı hafta içinde taşınabilecek gün yok (mevcut ${state.a.day})`);
      const targetDate = addDays(weekStart, DAY_OFFSET[target]);

      await site.locator(`#accountDayToggle .toggle[data-day="${target}"]`).click();
      await waitFor(site, '#applyAccountChanges', 'gün taslağı');
      await site.locator('#applyAccountChanges').click();
      await waitGone(site, '#applyAccountChanges', 'gün değişikliği kaydı');
      const meSub = await custA.must('GET', '/api/v1/me/subscription');
      assert(meSub.deliveryDay === target, `/me/subscription.deliveryDay ${meSub.deliveryDay} ≠ ${target}`);
      const d = await subDetail(state.a.subId);
      const c1 = cycleOf(d, 1);
      assert(c1.deliveryOn === targetDate, `cycle#1 teslimat günü ${c1.deliveryOn} ≠ ${targetDate}`);
      assert(reservedOf(beforeDdId) === beforeReserved - 1, `eski gün rezervi iade edilmedi (${beforeDdId}: ${beforeReserved} → ${reservedOf(beforeDdId)})`);
      assert(reservedOf(ddIdOf(targetDate)) >= 1, 'yeni gün rezerve edilmedi');
      state.a.day = target;
      state.a.deliveryOn = targetDate;
      await shot(site, 'f-gun-degisti');
      return `${targetDate} (${target}) · cycle sayısı ${d.cycles.length}`;
    });

    // ═══ g — kutu.html: swap + tercih + ekstra + frekans ═══════════════════════════════════════
    await step('g /kutu.html canlı mod: tier/tür düğmeleri pasif (ADR-0008) · swap + ürün tercihi + ekstra → onayla · frekans 1hafta ↔ 2hafta', async () => {
      // ?tier= başka bir tier'ı işaret etse de canlı modda YOK SAYILIR (ADR-0008)
      const otherTier = sql(`SELECT slug FROM box_tiers WHERE "isActive" AND slug <> ${lit(state.tier.slug)} LIMIT 1`) || state.tier.slug;
      await site.goto(`${API}/kutu.html?tier=${otherTier}`, { waitUntil: 'networkidle' });
      await site.locator('#boxItems .box-item').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const shownTier = flat(await site.locator('#tierTitle').textContent());
      assert(shownTier === state.tier.label, `canlı modda tier değişti: "${shownTier}" ≠ "${state.tier.label}" (?tier=${otherTier} yok sayılmalı)`);
      const typeDisabled = await site.locator('.type-btn').evaluateAll((els) => els.length > 0 && els.every((e) => e.disabled === true));
      assert(typeDisabled, 'canlı modda sipariş türü düğmeleri disabled olmalı (ADR-0008)');

      const before = await custA.must('GET', '/api/v1/me/subscription');
      const swapSel = site.locator('#boxItems .swap-select').first();
      await swapSel.waitFor({ state: 'visible', timeout: TIMEOUT });
      const slot = await swapSel.getAttribute('data-slot');
      const options = await swapSel.locator('option').evaluateAll((els) => els.map((e) => e.value));
      const newSlug = options.find((v) => v && v !== slot && !before.items.includes(v));
      assert(newSlug, `değiştokuş için uygun seçenek yok (slot=${slot}, seçenekler=${options.slice(0, 6).join(',')})`);
      await swapSel.selectOption(newSlug);

      // Ürün tercihi (damak zevki) — ops toplama listesinde "tercihler" sütununu doldurur
      let prefValue = null;
      let prefItem = null;
      const prefWrap = site.locator('#boxItems .box-item-pref').first();
      if (await prefWrap.count()) {
        prefItem = await prefWrap.getAttribute('data-item');
        const chip = prefWrap.locator('.toggle').last();
        prefValue = await chip.getAttribute('data-value');
        await chip.click();
      }
      // Ekstra ekle
      const extraSelect = site.locator('#extraProduct');
      await extraSelect.waitFor({ state: 'visible', timeout: TIMEOUT });
      const extraSlug = await extraSelect.inputValue();
      await site.locator('#extraAddBtn').click();
      await waitFor(site, '#applyChangesBtn', 'kutu taslağı');
      await shot(site, 'g-kutu-taslak');
      await site.locator('#applyChangesBtn').click();
      await waitGone(site, '#applyChangesBtn', 'kutu değişikliği kaydı');

      const afterPatch = await custA.must('GET', '/api/v1/me/subscription');
      assert(afterPatch.items.includes(newSlug), `swap uygulanmadı: ${afterPatch.items.join(',')}`);
      assert(!afterPatch.items.includes(slot), `eski ürün hâlâ kutuda: ${slot}`);
      assert((afterPatch.extras || []).some((e) => e.id === extraSlug), `ekstra eklenmedi (${extraSlug}): ${JSON.stringify(afterPatch.extras)}`);
      if (prefItem && prefValue) assert((afterPatch.itemPrefs || {})[prefItem] === prefValue, `ürün tercihi kaydedilmedi (${prefItem}=${prefValue}): ${JSON.stringify(afterPatch.itemPrefs)}`);

      // Frekans 1hafta → 2hafta → 1hafta (PATCH /me/subscription; SCHEDULED cycle'lar yeniden üretilir)
      await site.locator('#freqToggle .toggle[data-freq="2hafta"]').click();
      await waitFor(site, '#applyChangesBtn', 'frekans taslağı (2hafta)');
      await site.locator('#applyChangesBtn').click();
      await waitGone(site, '#applyChangesBtn', 'frekans kaydı (2hafta)');
      assert((await custA.must('GET', '/api/v1/me/subscription')).freq === '2hafta', 'frekans 2hafta olmadı');
      await site.locator('#freqToggle .toggle[data-freq="1hafta"]').click();
      await waitFor(site, '#applyChangesBtn', 'frekans taslağı (1hafta)');
      await site.locator('#applyChangesBtn').click();
      await waitGone(site, '#applyChangesBtn', 'frekans kaydı (1hafta)');
      const finalSub = await custA.must('GET', '/api/v1/me/subscription');
      assert(finalSub.freq === '1hafta', `frekans geri alınmadı: ${finalSub.freq}`);
      assert(finalSub.items.includes(newSlug) && (finalSub.extras || []).length >= 1, 'frekans değişimi kutu içeriğini bozmamalı');
      assert(cycleStatus(state.a.cycle1Id) === 'SCHEDULED', 'cycle#1 hâlâ SCHEDULED olmalı');
      return `swap ${slot}→${newSlug} · ekstra ${extraSlug} · tercih ${prefItem ?? '-'}=${prefValue ?? '-'} · freq 1hafta↔2hafta`;
    });

    // ═══ h — sepetten kutuya ══════════════════════════════════════════════════════════════════
    await step('h /sepet.html: tekil ürün sepete → "bu haftaki kutuma ekle" (POST …/cycles/current/merge-cart) → sepet boşalır, satır kutuya geçer', async () => {
      const beforeItems = num(sql(`SELECT count(*) FROM cycle_items WHERE "cycleId" = ${lit(state.a.cycle1Id)}`));
      await site.goto(`${API}/urun.html?id=ekmek`, { waitUntil: 'networkidle' });
      await site.locator('[data-add-to-cart] .qty-stepper-add, [data-add-to-cart] .qty-stepper-inc').first().click();
      await site.waitForFunction(() => JSON.parse(localStorage.getItem('bahceden_cart') || '[]').length > 0, null, { timeout: TIMEOUT });
      await site.goto(`${API}/sepet.html`, { waitUntil: 'networkidle' });
      const addBtn = site.locator('#addToBoxBtn');
      await addBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await shot(site, 'h-kutuma-ekle');
      await addBtn.click();
      await site.waitForFunction(() => JSON.parse(localStorage.getItem('bahceden_cart') || '[]').length === 0, null, { timeout: TIMEOUT });
      const note = flat(await site.locator('#cartWrap').textContent());
      assert(/kutuna eklendi/i.test(note), `birleştirme notu yok: ${note.slice(0, 200)}`);
      const merged = sqlLines(`SELECT source || ':' || p.slug FROM cycle_items ci JOIN products p ON p.id = ci."productId" WHERE ci."cycleId" = ${lit(state.a.cycle1Id)} AND ci.source = 'CART_MERGE'`);
      assert(merged.length >= 1, `CART_MERGE satırı yok: ${merged.join(',')}`);
      const afterItems = num(sql(`SELECT count(*) FROM cycle_items WHERE "cycleId" = ${lit(state.a.cycle1Id)}`));
      assert(afterItems > beforeItems, `cycle satır sayısı artmadı (${beforeItems} → ${afterItems})`);
      return `${merged.join(', ')} · satır ${beforeItems} → ${afterItems}`;
    });

    // ═══ i — atla / geri al ═══════════════════════════════════════════════════════════════════
    await step('i /uyelik.html: haftayı atla (onay sorusu → evet) → SKIPPED + rozet · geri al → SCHEDULED (DD rezervi −1/+1)', async () => {
      const ddId = ddIdOf(state.a.deliveryOn);
      const before = reservedOf(ddId);
      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      await waitFor(site, '#skipWeekBtn', 'atlama düğmesi');
      await site.locator('#skipWeekBtn').click();
      await waitFor(site, '#skipYesBtn', 'atlama onayı');
      await site.locator('#skipYesBtn').click();
      await waitFor(site, '#subCard .sub-skip-note', 'atlandı rozeti');
      const skipped = await custA.must('GET', '/api/v1/me/subscription');
      assert(skipped.skipThisWeek === true, `skipThisWeek ${skipped.skipThisWeek}`);
      assert(cycleStatus(state.a.cycle1Id) === 'SKIPPED', 'cycle#1 SKIPPED değil');
      assert(reservedOf(ddId) === before - 1, `atlamada DD rezervi düşmedi (${before} → ${reservedOf(ddId)})`);
      await shot(site, 'i-atlandi');
      await site.locator('#skipWeekBtn').click();
      await waitGone(site, '#subCard .sub-skip-note', 'atlamayı geri alma');
      const back = await custA.must('GET', '/api/v1/me/subscription');
      assert(back.skipThisWeek === false, `geri alma sonrası skipThisWeek ${back.skipThisWeek}`);
      assert(cycleStatus(state.a.cycle1Id) === 'SCHEDULED', 'cycle#1 SCHEDULED değil');
      assert(reservedOf(ddId) === before, `geri almada DD rezervi iade edilmedi (${before} → ${reservedOf(ddId)})`);
      return `SKIPPED → SCHEDULED · reserved ${before} → ${before - 1} → ${reservedOf(ddId)}`;
    });

    // ═══ j — kesim (lock-and-charge) ══════════════════════════════════════════════════════════
    await step('j kesim: cycles:lock-and-charge {now = kesim +1 dk} → cycle#1 CHARGED (peşin, 0 TL) · müşteri DTO\'sunda kilitli kutu', async () => {
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.a.deliveryOn), 1));
      const d = await subDetail(state.a.subId);
      const c1 = cycleOf(d, 1);
      assert(c1.status === 'CHARGED', `cycle#1 ${c1.status} (CHARGED beklenir; job: ${JSON.stringify(r.details).slice(0, 200)})`);
      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      await waitFor(site, '#subCard', 'kesim sonrası kart');
      const meSub = await custA.must('GET', '/api/v1/me/subscription');
      assert(meSub.inFlightCycle && meSub.inFlightCycle.status === 'CHARGED', `inFlightCycle: ${JSON.stringify(meSub.inFlightCycle)}`);
      assert(!meSub.currentCycle || meSub.currentCycle.deliveryOn !== state.a.deliveryOn, `kilitlenen kutu hâlâ düzenlenebilir görünüyor: ${JSON.stringify(meSub.currentCycle)}`);
      await shot(site, 'j-kesim');
      return `cycle#1 CHARGED · chargedZero=${r.details?.chargedZero ?? '-'} locked=${r.details?.locked ?? '-'} · sıradaki kutu ${meSub.currentCycle?.deliveryOn ?? '-'}`;
    });

    // ═══ k — iptal akışı ══════════════════════════════════════════════════════════════════════
    await step('k iptal akışı (site): talep → kalma teklifi → "iptalden vazgeç" → ACTIVE → tekrar talep (teklifsiz) → onayla → CANCELLED', async () => {
      await waitFor(site, '#cancelSubLink', 'iptal bağlantısı');
      await site.locator('#cancelSubLink').click();
      await waitFor(site, '#cancelReasons', 'iptal akışı formu');
      await site.locator('#cancelReasons .toggle[data-reason="PRICE"]').click();
      await site.locator('#cancelReasonText').fill(`e2e f9 ${RUN}`);
      await site.locator('#requestCancelBtn').click();
      await waitFor(site, '#confirmCancelBtn', 'iptal talebi');
      assert(await site.locator('#useOfferBtn').count(), `kalma teklifi düğmesi yok: ${(await cardText(site)).slice(0, 260)}`);
      assert(await site.locator('#subCard .cancel-offer').count(), 'kalma teklifi metni yok');
      const offerText = flat(await site.locator('#subCard .cancel-offer').textContent());
      assert(!/\{boxes\}|\{pct\}/.test(offerText), `teklif yer tutucuları doldurulmadı: ${offerText}`);
      assert(subStatus(state.a.subId) === 'CANCEL_REQUESTED', 'CANCEL_REQUESTED değil');
      await shot(site, 'k-iptal-teklif');

      // "iptalden vazgeç" → ACTIVE
      await site.locator('#abandonCancelBtn').click();
      await waitGone(site, '#confirmCancelBtn', 'iptalden vazgeçme');
      await waitFor(site, '#cancelSubLink', 'vazgeçme sonrası kart');
      assert(subStatus(state.a.subId) === 'ACTIVE', 'vazgeçme sonrası ACTIVE değil');
      const abandoned = num(sql(`SELECT count(*) FROM subscription_cancellations WHERE "subscriptionId" = ${lit(state.a.subId)} AND outcome = 'ABANDONED'`));
      assert(abandoned === 1, `ABANDONED kaydı ${abandoned}`);

      // 2. talep — teklif tekrar sunulmaz (üye başına 1)
      await site.locator('#cancelSubLink').click();
      await waitFor(site, '#cancelReasons', '2. iptal akışı formu');
      await site.locator('#cancelReasons .toggle[data-reason="OTHER"]').click();
      await site.locator('#requestCancelBtn').click();
      await waitFor(site, '#confirmCancelBtn', '2. iptal talebi');
      assert((await site.locator('#useOfferBtn').count()) === 0, 'ikinci talepte kalma teklifi sunulmamalı (perUserOnce)');

      // onayla → CANCELLED
      await site.locator('#confirmCancelBtn').click();
      await waitGone(site, '#subCard .account-pay', 'iptal onayı');
      const finalCard = await cardText(site);
      assert(!finalCard.includes('AKTİF ABONELİK'), `iptal sonrası kart hâlâ aktif abonelik gösteriyor: ${finalCard.slice(0, 200)}`);
      assert(subStatus(state.a.subId) === 'CANCELLED', 'Subscription CANCELLED değil');
      const after = await custA.req('GET', '/api/v1/me/subscription');
      assert(after.status === 200 && after.data === null, `iptal sonrası /me/subscription: ${JSON.stringify(after.data).slice(0, 120)}`);
      // ADR-0007: kilitli (CHARGED) kutu teslim edilir
      assert(cycleStatus(state.a.cycle1Id) === 'CHARGED', 'kilitli cycle iptalde CHARGED kalmalı (ADR-0007)');
      await shot(site, 'k-iptal-tamam');
      assert(pageErrors.length === 0, `sayfa hatası: ${pageErrors.slice(0, 3).join(' | ')}`);
      return 'CANCEL_REQUESTED → ABANDONED → CANCEL_REQUESTED → CANCELLED · cycle#1 CHARGED korundu';
    });

    // ═══ l — admin ekran 19 ═══════════════════════════════════════════════════════════════════
    await step('l admin ekran 19 (Abonelikler): liste araması → detay (künye · kutu geçmişi · olay günlüğü · iptal kaydı)', async () => {
      await adminLogin(panel);
      await panel.goto(`${ADMIN}/abonelikler?q=${encodeURIComponent(A.email)}`, { waitUntil: 'domcontentloaded' });
      const row = panel.locator('table.admin-table tbody tr').filter({ hasText: A.email });
      await row.first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const rowText = flat(await row.first().textContent());
      assert(/ptal edildi/.test(rowText), `liste satırında iptal durumu yok: ${rowText.slice(0, 200)}`);
      await shot(panel, 'l-abonelikler');

      await panel.goto(`${ADMIN}/abonelikler/${state.a.subId}`, { waitUntil: 'domcontentloaded' });
      await panel.getByText('Künye', { exact: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const body = flat(await panel.locator('body').textContent());
      assert(body.includes(A.email), 'detayda müşteri e-postası yok');
      assert(/Kutu ge.mi.i \(\d+\)/.test(body), `kutu geçmişi kartı yok: ${body.slice(0, 240)}`);
      assert(/Olay g.nl... \(\d+\)/.test(body), 'olay günlüğü kartı yok');
      assert(/ptal kay.tlar. \(\d+\)/.test(body), 'iptal kayıtları kartı yok');
      const detail = await admin.must('GET', `/api/v1/admin/subscriptions/${state.a.subId}`);
      const types = (detail.events ?? []).map((e) => e.type);
      for (const t of ['ACTIVATED', 'SKIP', 'UNSKIP', 'CANCEL_REQUESTED', 'RETENTION_OFFERED', 'CANCELLED']) {
        assert(types.includes(t), `olay günlüğünde ${t} yok: ${[...new Set(types)].join(',')}`);
      }
      assert((detail.cancellations ?? []).length === 2, `iptal kaydı sayısı ${detail.cancellations?.length} (ABANDONED + CANCELLED)`);
      await shot(panel, 'l-abonelik-detay');
      return `cycle ${detail.cycles.length} · olay ${types.length} (${[...new Set(types)].length} tür) · iptal kaydı ${detail.cancellations.length}`;
    });

    // ═══ m — admin ekran 20 ═══════════════════════════════════════════════════════════════════
    await step('m admin ekran 20 (Teslimat Günü): kutular · toplama listesi (ürün/tercih) · paketleme fişi · yazdırma görünümü · toplu durum PREPARING → OUT_FOR_DELIVERY → DELIVERED', async () => {
      const date = state.a.deliveryOn;
      const pick = await admin.must('GET', `/api/v1/admin/ops/pick-list?date=${date}&zone=${ZONE_SLUG}`);
      const packing = await admin.must('GET', `/api/v1/admin/ops/packing-list?date=${date}&zone=${ZONE_SLUG}`);
      const summary = await admin.must('GET', `/api/v1/admin/ops/day-summary?date=${date}&zone=${ZONE_SLUG}`);
      assert(pick.length > 0, `toplama listesi boş (${date})`);
      const entry = packing.find((p) => p.customerEmail === A.email);
      assert(entry, `paketleme fişinde müşteri yok: ${packing.map((p) => p.customerEmail).join(',')}`);
      assert(entry.items.length > 0 && entry.extraItemCount >= 1, `fiş içeriği: kutu ${entry.boxItemCount} / ekstra ${entry.extraItemCount}`);
      assert(entry.addressLine && entry.customerPhone, 'fişte adres/telefon yok');
      assert(entry.customerName === A.name, `fişte müşteri adı ${entry.customerName}`);
      assert(summary.cycleCount >= 1, `gün özeti cycleCount ${summary.cycleCount}`);

      await panel.goto(`${ADMIN}/operasyon/teslimat-gunu?date=${date}&zone=${ZONE_SLUG}`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('heading', { name: 'Teslimat Günü' }).waitFor({ state: 'visible', timeout: TIMEOUT });
      await panel.locator('table.admin-table tbody tr').filter({ hasText: A.email }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await shot(panel, 'm-teslimat-gunu');

      // Toplama listesi: ürün adları + tercih sütunu
      await panel.goto(`${ADMIN}/operasyon/teslimat-gunu?date=${date}&zone=${ZONE_SLUG}&sekme=toplama`, { waitUntil: 'domcontentloaded' });
      await panel.locator('table.admin-table tbody tr').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const pickText = flat(await panel.locator('table.admin-table').first().textContent());
      for (const r of pick.slice(0, 3)) assert(pickText.includes(r.productName), `toplama listesinde ürün adı yok: ${r.productName}`);
      const anyPref = pick.find((r) => r.prefs && r.prefs.length > 0);
      assert(anyPref, 'toplama listesinde tercih dağılımı yok (g adımındaki ürün tercihi bekleniyordu)');
      assert(pickText.includes(anyPref.prefs[0].pref), `tercih sütunu boş: ${anyPref.prefs[0].pref}`);
      await shot(panel, 'm-toplama');

      // Paketleme listesi + yazdırma görünümü
      await panel.goto(`${ADMIN}/operasyon/teslimat-gunu?date=${date}&zone=${ZONE_SLUG}&sekme=paketleme`, { waitUntil: 'domcontentloaded' });
      const sheet = panel.locator('.print-sheet').filter({ hasText: A.name });
      await sheet.first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const sheetText = flat(await sheet.first().textContent());
      assert(sheetText.includes(entry.addressLine), 'fişte adres satırı yok');
      const missing = entry.items.filter((it) => !sheetText.includes(it.name));
      assert(missing.length === 0, `fişte eksik ürün: ${missing.map((i) => i.name).join(',')}`);
      await panel.emulateMedia({ media: 'print' });
      await panel.locator('h1.print-only').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const printTitle = flat(await panel.locator('h1.print-only').first().textContent());
      assert(/Paketleme/i.test(printTitle), `yazdırma başlığı: ${printTitle}`);
      const noPrintVisible = await panel.locator('.no-print').first().isVisible().catch(() => false);
      assert(!noPrintVisible, 'yazdırma görünümünde .no-print öğeleri gizlenmeli');
      await shot(panel, 'm-yazdirma');
      await panel.emulateMedia({ media: 'screen' });

      // Toplu durum: PREPARING → OUT_FOR_DELIVERY → DELIVERED
      await panel.goto(`${ADMIN}/operasyon/teslimat-gunu?date=${date}&zone=${ZONE_SLUG}`, { waitUntil: 'domcontentloaded' });
      await panel.locator('table.admin-table tbody tr').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      for (const [status, label] of [['PREPARING', 'Hazırlanıyor'], ['OUT_FOR_DELIVERY', 'Yolda'], ['DELIVERED', 'Teslim edildi']]) {
        await panel.getByLabel('Tümünü seç').check();
        const select = panel.getByLabel('Toplu durum hedefi');
        await select.waitFor({ state: 'visible', timeout: TIMEOUT });
        await select.selectOption(status);
        await panel.getByRole('button', { name: 'Uygula' }).click();
        await panel.waitForFunction(
          (want) => {
            const rows = [...document.querySelectorAll('table.admin-table tbody tr')];
            return rows.length > 0 && rows.every((r) => r.textContent.includes(want));
          },
          label,
          { timeout: TIMEOUT },
        );
        assert(cycleStatus(state.a.cycle1Id) === status, `cycle#1 ${status} olmadı (${cycleStatus(state.a.cycle1Id)})`);
      }
      await shot(panel, 'm-teslim-edildi');
      return `toplama ${pick.length} ürün · paketleme ${packing.length} fiş · özet kutu ${summary.cycleCount} · PREPARING → OUT_FOR_DELIVERY → DELIVERED`;
    });

    // ═══ n — müşteri B (ops/tahsilat) ═════════════════════════════════════════════════════════
    await step('n müşteri B: kayıt + adres + saklı kartlar (ok:/fail:, psql) → admin manuel checkout (MIT) → cycles:ensure (cycle#2)', async () => {
      await custB.req('GET', '/api/v1/auth/csrf');
      const reg = await custB.req('POST', '/api/v1/auth/register', {
        email: B.email,
        password: PASSWORD,
        name: B.name,
        phone: B.phone,
        consents: [{ kind: 'KVKK_ACK', granted: true }],
      });
      assert(reg.status === 201, `B register → ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
      state.b.userId = sql(`SELECT id FROM users WHERE email = ${lit(B.email)}`);
      state.entityIds.add(state.b.userId);
      await custB.must('PUT', '/api/v1/me/address', { fullName: B.name, phone: B.phone, line: `E2E F9 Ops Mah. ${RUN} Sk. No:19`, zoneSlug: ZONE_SLUG, zip: '35430' });
      state.b.pmOk = genId('e2epmok');
      state.b.pmFail = genId('e2epmfl');
      const nowIso = new Date().toISOString();
      sql(`INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") VALUES (${lit(state.b.pmOk)}, ${lit(state.b.userId)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('ok:' + RUN)}, '0001', 'TEST', true, true, ${lit(nowIso)})`);
      sql(`INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") VALUES (${lit(state.b.pmFail)}, ${lit(state.b.userId)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('fail:' + RUN)}, '0002', 'TEST', false, true, ${lit(nowIso)})`);

      const dates = await custB.must('GET', `/api/v1/delivery/dates?zone=${ZONE_SLUG}`);
      const safe = (Array.isArray(dates) ? dates : [])
        .filter((d) => !d.locked && !d.full)
        .sort((x, y) => x.date.localeCompare(y.date))
        .find((d) => new Date(d.cutoffAtIso).getTime() > Date.now() + 24 * 3_600_000);
      assert(safe, 'B için uygun teslimat günü yok');
      const created = await admin.must(
        'POST',
        '/api/v1/admin/subscriptions',
        {
          userId: state.b.userId,
          tierSlug: state.tier.slug,
          frequencyWeeks: 1,
          deliveryDay: DAY_ENUM[safe.day],
          deliveryOn: safe.date,
          paymentMethodId: state.b.pmFail,
          chargeStrategy: 'MERCHANT_INITIATED',
          note: `e2e f9 ${RUN} ops`,
        },
        [201],
      );
      state.b.subId = created.subscription.id;
      state.b.orderId = created.order.id;
      state.entityIds.add(state.b.subId);
      state.entityIds.add(state.b.orderId);
      assert(created.subscription.status === 'ACTIVE' && created.order.status === 'PAID', `B abonelik/sipariş: ${created.subscription.status}/${created.order.status}`);
      await job('cycles:ensure');
      const d = await subDetail(state.b.subId);
      assert(d.cycles.length >= 2, `B cycle sayısı ${d.cycles.length} (cycle#2 gerekli — şablon/ufuk)`);
      const c2 = cycleOf(d, 2);
      state.b.cycle2Id = c2.id;
      state.b.cycle2DeliveryOn = c2.deliveryOn;
      assert(c2.status === 'SCHEDULED', `B cycle#2 ${c2.status}`);
      return `B sub ${state.b.subId.slice(0, 8)}… · cycle#1 ${cycleOf(d, 1).deliveryOn} · cycle#2 ${c2.deliveryOn} (fail: kart)`;
    });

    // ═══ o — UNPAID üret ══════════════════════════════════════════════════════════════════════
    await step('o kesim (B cycle#2): cycles:lock-and-charge → `fail:` kart reddedilir → cycle#2 UNPAID (dunning +2 s)', async () => {
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.b.cycle2DeliveryOn), 1));
      const d = await subDetail(state.b.subId);
      const c1 = cycleOf(d, 1);
      const c2 = cycleOf(d, 2);
      assert(c1.status === 'CHARGED', `B cycle#1 ${c1.status} (peşin 0 TL → CHARGED)`);
      assert(c2.status === 'UNPAID', `B cycle#2 ${c2.status} (UNPAID beklenir; job ${JSON.stringify(r.details).slice(0, 220)})`);
      return `cycle#1 CHARGED · cycle#2 UNPAID · deneme ${c2.retryCount ?? '-'} · sıradaki ${c2.nextRetryAt ?? '-'}`;
    });

    // ═══ p — admin ekran 18 ═══════════════════════════════════════════════════════════════════
    await step('p admin ekran 18 (Ödeme Problemleri): UNPAID kutu listede → kart düzeltilir → "yeniden çek" → CHARGED', async () => {
      const issues = await admin.must('GET', `/api/v1/admin/payment-issues?q=${encodeURIComponent(B.email)}`);
      assert(issues.total >= 1, `ödeme problemi listesi boş: ${JSON.stringify(issues).slice(0, 200)}`);
      const item = issues.items.find((i) => i.cycleId === state.b.cycle2Id);
      assert(item, `UNPAID kutu listede yok: ${issues.items.map((i) => `${i.kind}:${i.status}`).join(',')}`);
      assert(item.kind === 'CYCLE' && item.status === 'UNPAID' && item.hasCard === true, `satır: ${JSON.stringify(item).slice(0, 220)}`);
      assert(issues.counts && issues.counts.unpaidCycles >= 1, `counts: ${JSON.stringify(issues.counts)}`);

      await panel.goto(`${ADMIN}/odeme-problemleri?q=${encodeURIComponent(B.email)}`, { waitUntil: 'domcontentloaded' });
      // Aynı sipariş hem CYCLE (UNPAID) hem ORDER (PAYMENT_FAILED) satırı üretir → kutu satırını seç
      const cycleRow = () => panel.locator('table.admin-table tbody tr').filter({ hasText: B.email }).filter({ hasText: 'Tahsil edilemedi' });
      await cycleRow().first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const rowText = flat(await cycleRow().first().textContent());
      assert(/Tahsil edilemedi/.test(rowText) && /MANUAL_DECLINED/.test(rowText), `satır: ${rowText.slice(0, 240)}`);
      await shot(panel, 'p-odeme-problemleri');

      // Kart düzeltilir (müşterinin "kartını güncelle" akışının sunucu karşılığı) → panelden yeniden çek
      await admin.must('PATCH', `/api/v1/admin/subscriptions/${state.b.subId}`, { paymentMethodId: state.b.pmOk });
      await panel.reload({ waitUntil: 'domcontentloaded' });
      await cycleRow().first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await cycleRow().first().getByRole('button', { name: 'Yeniden çek' }).click();
      const dlg = panel.getByRole('dialog').first();
      await dlg.waitFor({ state: 'visible', timeout: TIMEOUT });
      await dlg.getByRole('button', { name: 'Yeniden çek' }).click();
      await panel.waitForFunction(
        (email) => ![...document.querySelectorAll('table.admin-table tbody tr')].some((r) => r.textContent.includes(email)),
        B.email,
        { timeout: TIMEOUT },
      );
      const c2 = cycleOf(await subDetail(state.b.subId), 2);
      assert(c2.status === 'CHARGED', `yeniden çekim sonrası cycle#2 ${c2.status}`);
      const after = await admin.must('GET', `/api/v1/admin/payment-issues?q=${encodeURIComponent(B.email)}`);
      assert(after.total === 0, `çözülen satır listede kalmamalı: ${JSON.stringify(after.items).slice(0, 200)}`);
      await shot(panel, 'p-cozuldu');
      return `UNPAID → CHARGED · liste ${issues.total} → ${after.total}`;
    });

    // ═══ q — admin ekran 14b ══════════════════════════════════════════════════════════════════
    await step('q admin ekran 14b (Teslimat tarihleri): kapasite düzenle · günü kapat/aç · "Tarih üret" (idempotent)', async () => {
      const rowsApi = await admin.must('GET', `/api/v1/admin/delivery/dates?zone=${ZONE_SLUG}`);
      const list = Array.isArray(rowsApi) ? rowsApi : (rowsApi.items ?? []);
      const target = list.find((d) => d.status === 'OPEN' && d.reserved === 0 && new Date(d.cutoffAt).getTime() > Date.now() + 6 * 3_600_000);
      assert(target, 'düzenlenebilir (kesimi geçmemiş, rezervsiz) teslimat günü yok');
      const cap0 = target.capacity;
      const dateText = trDate(target.date);
      const weekOffset = Math.round(
        (new Date(`${mondayOf(target.date)}T00:00:00Z`).getTime() - new Date(`${mondayOf(istanbulToday())}T00:00:00Z`).getTime()) / (7 * 86_400_000),
      );
      await panel.goto(`${ADMIN}/ayarlar/teslimat-tarihleri?zone=${ZONE_SLUG}&week=${weekOffset}`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('heading', { name: 'Teslimat tarihleri' }).waitFor({ state: 'visible', timeout: TIMEOUT });
      const row = panel.locator('table.admin-table tbody tr').filter({ hasText: dateText }).first();
      await row.waitFor({ state: 'visible', timeout: TIMEOUT });

      // Kapasite: satır içi düzenleme
      await row.getByTitle('Kapasiteyi düzenle').click();
      const capInput = row.getByLabel(`${dateText} kapasitesi`);
      await capInput.waitFor({ state: 'visible', timeout: TIMEOUT });
      await capInput.fill(String(cap0 - 1));
      await row.getByLabel('Kapasiteyi kaydet').click();
      await panel.waitForTimeout(600);
      assert(num(sql(`SELECT capacity FROM delivery_dates WHERE id = ${lit(target.id)}`)) === cap0 - 1, 'kapasite güncellenmedi');

      // Günü kapat → aç
      await row.getByLabel(`${dateText} — Günü kapat`).click();
      await panel.waitForTimeout(600);
      assert(sql(`SELECT status FROM delivery_dates WHERE id = ${lit(target.id)}`) === 'CLOSED', 'gün kapatılamadı');
      await row.getByLabel(`${dateText} — Günü aç`).click();
      await panel.waitForTimeout(600);
      assert(sql(`SELECT status FROM delivery_dates WHERE id = ${lit(target.id)}`) === 'OPEN', 'gün yeniden açılamadı');

      // Kapasite geri
      await row.getByTitle('Kapasiteyi düzenle').click();
      const capInput2 = row.getByLabel(`${dateText} kapasitesi`);
      await capInput2.waitFor({ state: 'visible', timeout: TIMEOUT });
      await capInput2.fill(String(cap0));
      await row.getByLabel('Kapasiteyi kaydet').click();
      await panel.waitForTimeout(600);
      assert(num(sql(`SELECT capacity FROM delivery_dates WHERE id = ${lit(target.id)}`)) === cap0, 'kapasite geri alınamadı');

      // "Tarih üret" — idempotent
      const before = num(sql('SELECT count(*) FROM delivery_dates'));
      await panel.getByLabel('Hafta sayısı').fill('2');
      await panel.getByRole('button', { name: 'Tarih üret' }).click();
      await panel.waitForTimeout(1200);
      const afterCount = num(sql('SELECT count(*) FROM delivery_dates'));
      assert(afterCount === before, `generate idempotent değil (${before} → ${afterCount})`);
      await shot(panel, 'q-teslimat-tarihleri');
      return `${target.date}: kapasite ${cap0} → ${cap0 - 1} → ${cap0} · CLOSED → OPEN · generate +0 (${before} satır)`;
    });

    // ═══ r — admin ekran 21 ═══════════════════════════════════════════════════════════════════
    await step('r admin ekran 21 (Özet): kartlar GET /admin/dashboard ile birebir', async () => {
      const dash = await admin.must('GET', '/api/v1/admin/dashboard');
      assert(dash.today && dash.weekStart && dash.orders && dash.subscriptions, `dashboard alanları eksik: ${Object.keys(dash).join(',')}`);
      assert(dash.subscriptions.active >= 1, `aktif abonelik ${dash.subscriptions.active} (B aktif olmalı)`);
      assert(dash.orders.weekCount >= 2, `haftalık sipariş ${dash.orders.weekCount}`);
      assert(Array.isArray(dash.cutoffs), 'cutoffs listesi yok');
      assert(Array.isArray(dash.recentEvents) && dash.recentEvents.length > 0, 'son abonelik olayları boş');
      await panel.goto(`${ADMIN}/`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('heading', { name: 'Özet' }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await panel.getByText('Bugün ve bu hafta — sipariş, ciro').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      // Kartların tamamı `summary` geldikten sonra çizilir → son kartı bekle
      await panel.getByText('Bu haftanın kesim durumu').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const body = flat(await panel.locator('body').textContent());
      for (const label of ['Abonelikler', 'Ödeme problemleri', 'Bu haftanın kesim durumu', 'Son abonelik olayları', 'Bugünkü sipariş', 'Haftalık ciro']) {
        assert(body.includes(label), `özet kartı/etiketi yok: ${label}`);
      }
      assert(body.includes(String(dash.subscriptions.active)), `aktif abonelik sayısı panelde yok (${dash.subscriptions.active})`);
      await shot(panel, 'r-ozet');
      return `aktif ${dash.subscriptions.active} · haftalık sipariş ${dash.orders.weekCount} (${money(dash.orders.weekRevenue)} TL) · kesim satırı ${dash.cutoffs.length} · olay ${dash.recentEvents.length}`;
    });
  } catch (err) {
    failed = true;
    log(`HATA: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    await shot(site, 'hata-site');
    await shot(panel, 'hata-admin');
  }

  // ---- temizlik ------------------------------------------------------------------------------
  if (!KEEP) {
    try {
      await step('z temizlik: müşteri/abonelik/cycle/sipariş/ödeme/kart/olay/şablon/cron/audit satırları silindi · reserved geri · commerce ayarları geri → 16 tablo ≡ başlangıç', async () => {
        const problems = [];
        const tryDo = (label, fn) => {
          try {
            fn();
          } catch (e) {
            problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        };
        if (state.commerceChanged) {
          try {
            await admin.must('PUT', '/api/v1/admin/settings/commerce', {
              dunning: state.commerce.dunning,
              firstCycleSkippable: state.commerce.firstCycleSkippable,
              deliveryDatesHorizonWeeks: state.commerce.deliveryDatesHorizonWeeks,
            });
          } catch (e) {
            problems.push(`settings: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const userIds = sqlLines(`SELECT id FROM users WHERE email IN (${lit(A.email)}, ${lit(B.email)})`);
        if (userIds.length) {
          const U = inList(userIds);
          const subIds = sqlLines(`SELECT id FROM subscriptions WHERE "userId" IN (${U})`);
          const S = inList(subIds);
          const orderIds = sqlLines(`SELECT id FROM orders WHERE "userId" IN (${U})${subIds.length ? ` OR "subscriptionId" IN (${S})` : ''}`);
          const O = inList(orderIds);
          for (const e of sqlLines(
            `SELECT error FROM mail_logs WHERE ("entityId" IN (${U}) OR "entityId" IN (${O}) OR "to" IN (${lit(A.email)}, ${lit(B.email)})) AND error LIKE 'preview:%'`,
          )) {
            const f = e.slice(PREVIEW_PREFIX.length).trim();
            tryDo(`dosya ${f}`, () => {
              if (f && existsSync(f)) unlinkSync(f);
            });
          }
          tryDo('subscription_events', () => sql(`DELETE FROM subscription_events WHERE "subscriptionId" IN (${S})`));
          tryDo('subscription_cancellations', () => sql(`DELETE FROM subscription_cancellations WHERE "subscriptionId" IN (${S})`));
          tryDo('cycle_items', () => sql(`DELETE FROM cycle_items WHERE "cycleId" IN (SELECT id FROM subscription_cycles WHERE "subscriptionId" IN (${S}))`));
          tryDo('subscription_cycles', () => sql(`DELETE FROM subscription_cycles WHERE "subscriptionId" IN (${S})`));
          tryDo('refunds', () => sql(`DELETE FROM refunds WHERE "paymentId" IN (SELECT id FROM payments WHERE "orderId" IN (${O}))`));
          tryDo('payments', () => sql(`DELETE FROM payments WHERE "orderId" IN (${O})`));
          tryDo('consents(order)', () => sql(`DELETE FROM consents WHERE "orderId" IN (${O})`));
          tryDo('order_lines', () => sql(`DELETE FROM order_lines WHERE "orderId" IN (${O})`));
          tryDo('orders', () => sql(`DELETE FROM orders WHERE id IN (${O})`));
          tryDo('subscriptions', () => sql(`DELETE FROM subscriptions WHERE id IN (${S})`));
          tryDo('payment_methods', () => sql(`DELETE FROM payment_methods WHERE "userId" IN (${U})`));
          tryDo('consents', () => sql(`DELETE FROM consents WHERE "userId" IN (${U})`));
          tryDo('addresses', () => sql(`DELETE FROM addresses WHERE "userId" IN (${U})`));
          tryDo('carts', () => sql(`DELETE FROM carts WHERE "userId" IN (${U})`));
          tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "entityId" IN (${U}) OR "entityId" IN (${O}) OR "to" IN (${lit(A.email)}, ${lit(B.email)})`));
          tryDo('users', () => sql(`DELETE FROM users WHERE id IN (${U})`));
        }
        if (state.templateIds.length) {
          tryDo('box_template_items', () => sql(`DELETE FROM box_template_items WHERE "templateId" IN (${inList(state.templateIds)})`));
          tryDo('box_templates', () => sql(`DELETE FROM box_templates WHERE id IN (${inList(state.templateIds)})`));
        }
        const since = lit(new Date(startedAt.getTime() - 5_000).toISOString());
        if (state.cronLogIds.length) tryDo('cron_logs', () => sql(`DELETE FROM cron_logs WHERE id IN (${inList(state.cronLogIds)})`));
        tryDo('system_logs', () => sql(`DELETE FROM system_logs WHERE "createdAt" >= ${since} AND module = 'subscriptions'`));
        tryDo('audit_logs', () =>
          sql(
            `DELETE FROM audit_logs WHERE "createdAt" >= ${since} AND (${userIds.length ? `"actorId" IN (${inList(userIds)}) OR ` : ''}"entityId" IN (${inList([...state.entityIds])}) OR module IN ('subscriptions','checkout','payments','catalog','delivery','settings','orders'))`,
          ),
        );
        for (const [id, reserved] of state.ddBaseline) tryDo(`dd ${id}`, () => sql(`UPDATE delivery_dates SET reserved = ${reserved} WHERE id = ${lit(id)} AND reserved <> ${reserved}`));
        tryDo('delivery_dates(new)', () =>
          sql(
            `DELETE FROM delivery_dates d WHERE d.id NOT IN (${inList([...state.ddAllBefore])}) AND NOT EXISTS (SELECT 1 FROM subscription_cycles c WHERE c."deliveryDateId" = d.id) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."deliveryDateId" = d.id)`,
          ),
        );
        if (problems.length) throw new Error(`temizlik sorunları: ${problems.join(' · ')}`);
        const after = snapshot();
        const diffs = Object.keys(state.counts ?? {}).filter((k) => state.counts[k] !== after[k]).map((k) => `${k} ${state.counts[k]}→${after[k]}`);
        assert(diffs.length === 0, `sayımlar başlangıçtan farklı: ${diffs.join(', ')}`);
        const reservedDiff = sqlLines("SELECT id || E'\\t' || reserved FROM delivery_dates").filter((r) => {
          const [id, reserved] = r.split('\t');
          return state.ddBaseline.has(id) && state.ddBaseline.get(id) !== num(reserved);
        });
        assert(reservedDiff.length === 0, `delivery_dates.reserved geri alınmadı: ${reservedDiff.join(', ')}`);
        const commerce = await admin.must('GET', '/api/v1/admin/settings/commerce');
        for (const key of COMMERCE_KEYS) {
          const now = commerce.fields.find((f) => f.key === key)?.value;
          assert(JSON.stringify(now) === JSON.stringify(state.commerce[key]), `commerce.${key} geri alınmadı: ${JSON.stringify(now)}`);
        }
        return `${SNAP_TABLES.length} tablo ≡ başlangıç · reserved geri · commerce ayarları geri`;
      });
    } catch {
      failed = true;
    }
  }

  await browser.close();

  // ---- rapor ---------------------------------------------------------------------------------
  const okCount = results.filter((r) => r.ok).length;
  const lines = [
    '# e2e F9 — abonelik yönetimi (site) + ops ekranları (panel)',
    '',
    `- Tarih: ${startedAt.toISOString()} · Süre: ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)} s`,
    `- API: \`${API}\` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: \`${ADMIN}\` (vite preview, proxy)`,
    `- Müşteriler: \`${A.email}\` (site akışı) · \`${B.email}\` (ops/tahsilat) · sağlayıcı: ManualProvider (\`ok:\` / \`fail:\` kart)`,
    "- Zaman yalnız job'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — üretimde 403). Ayarlar (commerce.dunning [2,12], firstCycleSkippable, deliveryDatesHorizonWeeks 2) koşu süresince değiştirildi ve geri alındı.",
    `- Sonuç: **${okCount}/${results.length}**${failed ? ' — HATA' : ' — tümü OK'}`,
    '',
    '| # | Adım | Sonuç | Süre | Not |',
    '|---|---|---|---|---|',
    ...results.map((r, i) => `| ${i + 1} | ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|').slice(0, 320)} |`),
    '',
    '## Ekran görüntüleri',
    '',
    '`tools/e2e-admin/out/f9-*.png` (gitignore).',
    '',
  ];
  if (pageErrors.length) {
    lines.push('## Sayfa hataları (konsol/pageerror)', '', ...pageErrors.slice(0, 20).map((e) => `- ${e}`), '');
  }
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
