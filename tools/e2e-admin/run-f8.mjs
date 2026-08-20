// tools/e2e-admin/run-f8.mjs — F8 checkout + ödeme + kupon + admin siparişler uçtan uca doğrulama
// (Playwright + gerçek API + gerçek DB; PayTR'ye GERÇEK istek atılmaz — yalnız bildirim ucu sahte imzalı gövdeyle sürülür).
//
// F4/F5/F6/F7 kalıbı: geçici API (:4074, PAYMENT_PROVIDER=manual · ENABLE_CRON=false · DISABLE_MAIL=true · WEB_URL/ADMIN_URL
// geçici portlara) + admin preview (:4075, proxy'li) ÖNCEDEN ayağa kaldırılır. Müşteri akışı SİTE sayfalarında (sepet.hbs +
// cart.js), yönetim akışı admin panelinde koşar; her adım public yüzey, API ve psql ile doğrulanır:
//   a  hazırlık: admin girişi · başlangıç sayımları · delivery_dates.reserved anlık görüntüsü · payment.* ayar satırları saklanır
//   b  admin panelinde kupon oluştur (%10, SINGLE, E2EF8-<run>) → GET /admin/coupons
//   c  müşteri kaydı (POST /auth/register) + adres (PUT /me/address, urla)
//   d  tarayıcı (anonim): /urun.html?id=ekmek → sepete ekle → /sepet.html giriş kapısı → giriş → adımlar açılır
//   e  teslimat günü seç (GET /delivery/dates) · yasal onay kutuları (GET /legal requiresAck) · kupon kodu → özet API'den (indirim satırı)
//   f  "siparişi tamamla" → manual sağlayıcı → Order PAID · başarı görünümü · sepet/taslak temizlendi
//   g  /sepet.html?siparis=<no>&odeme=ok dönüş dalı (PayTR merchant_ok_url) → teşekkür + adres çubuğundan temizlenir
//   h  /uyelik.html "önceki siparişler" listesinde sipariş · GET /me/orders · mail.order-paid SKIPPED + önizleme
//   i  admin Siparişler: arama #no → PAID · detay (satırlar/ödeme/teslimat/adres) · CouponRedemption + usedCount
//   i2 admin Ayarlar › Ödeme (PayTR alanları registry'den + uyarı şeridi, sırlar maskeli) · Özet "Bugün — sipariş ve ciro" kartı
//   j  durum geçişleri panelden: Hazırlanıyor → Yolda → Teslim edildi (shared makine düğmeleri)
//   k  CSV dışa aktar (GET /admin/orders/export.csv) satırı içerir
//   l  iade (ManualProvider; POST /admin/payments/:id/refund) → Payment REFUNDED + Order REFUNDED + kupon kullanımı geri
//   m  abonelik: /kutu.html?tier=sezon taslağı → /sepet.html → SUBSCRIPTION_CONTRACT_ACK → Subscription ACTIVE + cycle#1
//      prepaidAmount (kutu+ekstra−indirim, KARGO HARİÇ; kargo Order.shippingFee) · /uyelik.html abonelik görünümü
//   n  iptal akışı (API): cancel → retention teklifi → ikinci talep → confirm → CANCELLED
//   o  PayTR bildirimi: Setting payment.* test değerleri → PENDING PAYTR ödemesi (psql) → geçerli hash → PAID (Order PAID),
//      ikinci teslim IGNORED, geçersiz hash 400, IP allowlist 403
//   z  temizlik: kupon/sipariş/ödeme/abonelik/kullanıcı/consent/mail/webhook satırları silinir, delivery_dates.reserved geri,
//      payment.* ayarları geri → sayımlar ≡ başlangıç
// Kullanım (repo kökünden):
//   node tools/e2e-admin/run-f8.mjs [--api=http://127.0.0.1:4074] [--admin=http://127.0.0.1:4075] [--headed] [--keep] [--timeout=20000]
// Not: temizlik `payment.*` ayar SATIRLARINI psql ile geri koyar; çalışan API süreci SettingsService önbelleği (60 s) nedeniyle
// kısa süre eski değerleri bellekte tutabilir — koşudan hemen sonra paneli denetleyeceksen API'yi yeniden başlat.
// Çıktı: tools/e2e-admin/out/f8-*.png, tools/e2e-admin/report-f8.md. Çıkış kodu: hata varsa 1.
// Sırlar (SEED_ADMIN_*, DATABASE_URL) yalnız env'den okunur; çıktıya yazılmaz.
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report-f8.md');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4074').replace(/\/$/, '');
const ADMIN = String(args.admin || process.env.E2E_ADMIN || 'http://127.0.0.1:4075').replace(/\/$/, '');
const HEADED = Boolean(args.headed);
const KEEP = Boolean(args.keep);
const TIMEOUT = Number(args.timeout ?? 20_000);
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
const EMAIL = `e2e-f8-${RUN}@example.com`;
const PASSWORD = `E2e-Parola-${RUN}`;
const CUSTOMER_NAME = `E2E F8 ${RUN}`;
const PHONE = '0530 000 00 08';
const COUPON_CODE = `E2EF8${RUN}`.toUpperCase();
// PayTR sahte mağaza bilgileri — yalnız bildirim ucunun hash/IP doğrulaması için (dışarıya istek yok).
const PAYTR = { merchantId: '123456', key: `e2ekey-${RUN}`, salt: `e2esalt-${RUN}` };
const PAYMENT_SETTING_KEYS = [
  'payment.provider',
  'payment.paytrMerchantId',
  'payment.paytrMerchantKey',
  'payment.paytrMerchantSalt',
  'payment.paytrTestMode',
  'payment.paytrCallbackAllowedIps',
];

mkdirSync(OUT_DIR, { recursive: true });

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f8] ${msg}`);
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

/** PayTR bildirim hash'i (paytr.hash.ts#callbackHash ile aynı dizilim). */
function callbackHash(merchantOid, status, totalAmount, callbackId) {
  const prefix = callbackId ? callbackId : '';
  return createHmac('sha256', PAYTR.key).update(prefix + merchantOid + PAYTR.salt + status + totalAmount, 'utf8').digest('base64');
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
    if (!expected.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  }
}

/** PayTR bildirimi (form-urlencoded; oturumsuz). */
async function postCallback(form, headers = {}) {
  const res = await fetch(`${API}/api/v1/payments/paytr/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, text: (await res.text()).trim() };
}

// ---- Playwright yardımcıları -----------------------------------------------------------------
async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `f8-${name}.png`), fullPage: false }).catch(() => {});
}
async function siteLogin(page, email, password) {
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginSubmit').click();
}
/** Sayfadaki metni sadeleştir (boşluk/NBSP). */
const flat = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
/** "1.099,50 TL" / "134,5 TL" / "Dahil" -> sayı (site money(): binlik nokta, ondalık virgül; sondaki sıfır atılır). */
function parseTry(text) {
  const t = flat(text);
  if (/dahil/i.test(t)) return 0;
  const m = t.match(/[\d.]+(?:,\d+)?/);
  if (!m) return NaN;
  return Number(m[0].replace(/\./g, '').replace(',', '.'));
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const admin = new ApiClient(API);
  const customer = new ApiClient(API);
  const state = {
    counts: null,
    ddBaseline: new Map(),
    ddAllBefore: new Set(),
    settingRows: [],
    couponId: null,
    userId: null,
    addressId: null,
    order: null, // {orderNo, id, grandTotal, discountTotal}
    paymentId: null,
    subOrder: null,
    subscriptionId: null,
    paytr: { orderId: null, paymentId: null, oid: null },
    entityIds: new Set(),
  };
  let failed = false;

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
    await step('a hazırlık: admin girişi · başlangıç sayımları · delivery_dates.reserved · payment.* ayarları saklandı', async () => {
      await admin.loginAdmin();
      state.counts = {
        users: num(sql('SELECT count(*) FROM users')),
        orders: num(sql('SELECT count(*) FROM orders')),
        orderLines: num(sql('SELECT count(*) FROM order_lines')),
        payments: num(sql('SELECT count(*) FROM payments')),
        refunds: num(sql('SELECT count(*) FROM refunds')),
        subscriptions: num(sql('SELECT count(*) FROM subscriptions')),
        cycles: num(sql('SELECT count(*) FROM subscription_cycles')),
        cycleItems: num(sql('SELECT count(*) FROM cycle_items')),
        consents: num(sql('SELECT count(*) FROM consents')),
        coupons: num(sql('SELECT count(*) FROM coupons')),
        redemptions: num(sql('SELECT count(*) FROM coupon_redemptions')),
        webhookEvents: num(sql('SELECT count(*) FROM webhook_events')),
        mailLogs: num(sql('SELECT count(*) FROM mail_logs')),
        paymentMethods: num(sql('SELECT count(*) FROM payment_methods')),
        deliveryDates: num(sql('SELECT count(*) FROM delivery_dates')),
        settings: num(sql('SELECT count(*) FROM settings')),
      };
      for (const row of sqlLines('SELECT id || E\'\\t\' || reserved FROM delivery_dates')) {
        const [id, reserved] = row.split('\t');
        state.ddBaseline.set(id, num(reserved));
        state.ddAllBefore.add(id);
      }
      state.settingRows = sqlLines(
        `SELECT key || E'\\t' || "group" || E'\\t' || "isSecret" || E'\\t' || value::text FROM settings WHERE key IN (${inList(PAYMENT_SETTING_KEYS)})`,
      ).map((r) => {
        const [key, group, isSecret, ...rest] = r.split('\t');
        return { key, group, isSecret: isSecret === 't' || isSecret === 'true', value: rest.join('\t') };
      });
      const health = await admin.must('GET', '/api/v1/health');
      assert(health && health.status !== 'down', `health: ${JSON.stringify(health).slice(0, 120)}`);
      return `orders=${state.counts.orders} payments=${state.counts.payments} coupons=${state.counts.coupons} dd=${state.counts.deliveryDates}`;
    });

    // ═══ b — kupon (admin paneli) ═════════════════════════════════════════════════════════════
    await step(`b admin paneli › Kuponlar: ${COUPON_CODE} (%10, SINGLE) oluşturuldu → GET /admin/coupons`, async () => {
      await panel.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
      await panel.locator('#login-email').fill(ADMIN_EMAIL);
      await panel.locator('#login-password').fill(ADMIN_PASSWORD);
      await panel.getByRole('button', { name: 'Giriş Yap' }).click();
      await panel.waitForURL((u) => new URL(u).pathname === '/', { timeout: TIMEOUT });
      await panel.goto(`${ADMIN}/kuponlar`, { waitUntil: 'domcontentloaded' });
      await panel.getByRole('button', { name: 'Yeni kupon' }).first().click();
      const dlg = panel.getByRole('dialog').first();
      await dlg.waitFor({ state: 'visible' });
      await dlg.getByLabel('Kod').fill(COUPON_CODE);
      await dlg.getByLabel('Yüzde (%)').fill('10');
      await dlg.getByLabel('Kapsam').selectOption('SINGLE');
      await Promise.all([
        panel.waitForResponse((r) => r.url().endsWith('/api/v1/admin/coupons') && r.request().method() === 'POST' && r.status() < 400),
        dlg.getByRole('button', { name: 'Oluştur' }).click(),
      ]);
      await dlg.waitFor({ state: 'detached', timeout: TIMEOUT });
      await shot(panel, 'b-kuponlar');
      const list = await admin.must('GET', `/api/v1/admin/coupons?q=${encodeURIComponent(COUPON_CODE)}`);
      const c = (list.items || []).find((x) => x.code === COUPON_CODE);
      assert(c, `kupon listede yok: ${JSON.stringify(list).slice(0, 200)}`);
      assert(c.kind === 'PERCENT' && Number(c.value) === 10 && c.appliesTo === 'SINGLE' && c.isActive === true, `kupon alanları: ${JSON.stringify(c).slice(0, 200)}`);
      assert(Number(c.usedCount ?? 0) === 0, `usedCount ${c.usedCount}`);
      state.couponId = c.id;
      state.entityIds.add(c.id);
      return `id=${c.id} usedCount=0`;
    });

    // ═══ c — müşteri kaydı + adres ════════════════════════════════════════════════════════════
    await step('c müşteri kaydı (POST /auth/register, KVKK) + adres (PUT /me/address, urla)', async () => {
      await customer.req('GET', '/api/v1/auth/csrf');
      const reg = await customer.req('POST', '/api/v1/auth/register', {
        email: EMAIL,
        password: PASSWORD,
        name: CUSTOMER_NAME,
        phone: PHONE,
        consents: [{ kind: 'KVKK_ACK', granted: true }],
      });
      assert(reg.status === 201, `register → ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
      state.userId = sql(`SELECT id FROM users WHERE email = ${lit(EMAIL)}`);
      assert(state.userId, 'kullanıcı satırı yok');
      state.entityIds.add(state.userId);
      const addr = await customer.must('PUT', '/api/v1/me/address', {
        fullName: CUSTOMER_NAME,
        phone: PHONE,
        line: `E2E F8 Mah. ${RUN} Sk. No:8`,
        zoneSlug: ZONE_SLUG,
        zip: '35430',
      });
      assert(addr && addr.id && addr.zoneSlug === ZONE_SLUG, `adres: ${JSON.stringify(addr).slice(0, 160)}`);
      state.addressId = addr.id;
      return `user=${state.userId.slice(0, 8)}… adres=${addr.id.slice(0, 8)}…`;
    });

    // ═══ d — sepete ekle + giriş kapısı ═══════════════════════════════════════════════════════
    await step('d tarayıcı: /urun.html?id=ekmek → sepete ekle → /sepet.html giriş kapısı → giriş → adımlar açılır', async () => {
      await site.goto(`${API}/urun.html?id=ekmek`, { waitUntil: 'networkidle' });
      await site.locator('[data-add-to-cart] .qty-stepper-add, [data-add-to-cart] .qty-stepper-inc').first().click();
      await site.waitForFunction(() => JSON.parse(localStorage.getItem('bahceden_cart') || '[]').length > 0, null, { timeout: TIMEOUT });
      await site.goto(`${API}/sepet.html`, { waitUntil: 'networkidle' });
      await site.locator('#checkoutAuth').waitFor({ state: 'visible' });
      assert(await site.locator('#checkoutSections').isHidden(), 'anonim: sipariş adımları görünür olmamalı');
      await shot(site, 'd-giris-kapisi');
      await siteLogin(site, EMAIL, PASSWORD);
      await site.locator('#checkoutSections').waitFor({ state: 'visible', timeout: TIMEOUT });
      await site.waitForFunction(() => document.querySelector('#custName')?.value?.length > 0, null, { timeout: TIMEOUT });
      const name = await site.locator('#custName').inputValue();
      const district = await site.locator('#custDistrict').inputValue(); // select değeri bölge ADI ("Urla")
      assert(name === CUSTOMER_NAME, `ad formda dolu değil: ${name}`);
      assert(district === 'Urla', `ilçe: ${district}`);
      return `sepet 1 satır · form dolu (${district})`;
    });

    // ═══ e — teslimat günü + yasal onaylar + kupon + özet ═════════════════════════════════════
    await step('e teslimat günü (GET /delivery/dates) · yasal onay kutuları (requiresAck) · kupon → özet API\'den (indirim satırı)', async () => {
      const dayBtn = site.locator('#checkoutDeliveryDay .toggle:not([disabled])').first();
      await dayBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      const dayLabel = flat(await dayBtn.textContent());
      await dayBtn.click();
      await site.locator('#checkoutDayNote').waitFor({ state: 'visible', timeout: TIMEOUT });
      const dayNote = flat(await site.locator('#checkoutDayNote').textContent());
      assert(/Teslimat:/.test(dayNote), `gün notu: ${dayNote}`);

      const boxes = site.locator('#checkoutLegal input[data-legal-slug]');
      const legalCount = await boxes.count();
      assert(legalCount >= 2, `yasal onay kutusu sayısı ${legalCount} (PREINFO + DISTANCE_SALES beklenir)`);
      const legalSlugs = [];
      for (let i = 0; i < legalCount; i++) {
        const cb = boxes.nth(i);
        legalSlugs.push(await cb.getAttribute('data-legal-slug'));
        await cb.check();
      }
      assert(legalSlugs.includes('on-bilgilendirme') && legalSlugs.includes('mesafeli-satis'), `belgeler: ${legalSlugs.join(',')}`);
      assert(!legalSlugs.includes('abonelik-sozlesmesi'), 'tekil siparişte abonelik sözleşmesi istenmemeli');
      const btnText = flat(await site.locator('#checkoutComplete').textContent());
      assert(/ödeme yükümlülüğü doğurur/i.test(btnText), `buton metni: ${btnText}`);

      // Kupon uygula
      await site.locator('#couponInput').fill(COUPON_CODE);
      await site.locator('#couponApply').click();
      const couponRow = site.locator('#cartWrap .cart-summary .cart-vat-row').filter({ hasText: `Kupon ${COUPON_CODE}` });
      await couponRow.waitFor({ state: 'visible', timeout: TIMEOUT });
      const summary = flat(await site.locator('#cartWrap .cart-summary').textContent());
      const shownTotal = parseTry(await site.locator('#cartWrap .cart-total .mono').textContent());
      const shownDiscount = parseTry((await couponRow.locator('.mono').textContent()) ?? '');
      const shownShipping = parseTry((await site.locator('#cartWrap .cart-summary .cart-vat-row').filter({ hasText: 'Kargo' }).locator('.mono').textContent()) ?? '');
      await shot(site, 'e-ozet-kupon');

      // Özet ≡ POST /checkout/quote (istemci hesaplamaz)
      const quote = await customer.must('POST', '/api/v1/checkout/quote', { lines: [{ id: 'ekmek', qty: 1 }], zoneSlug: ZONE_SLUG, couponCode: COUPON_CODE });
      assert(quote.couponStatus && quote.couponStatus.valid === true && Number(quote.couponStatus.discount) > 0, `couponStatus: ${JSON.stringify(quote.couponStatus)}`);
      assert(shownTotal === Number(quote.grandTotal), `özet toplamı API ile uyuşmuyor: ${shownTotal} vs ${quote.grandTotal} ("${summary}")`);
      assert(shownDiscount === Number(quote.couponStatus.discount), `kupon indirimi ${shownDiscount} ≠ ${quote.couponStatus.discount}`);
      assert(shownShipping === Number(quote.shippingFee), `kargo ${shownShipping} ≠ ${quote.shippingFee}`);
      assert(Array.isArray(quote.requiredConsents) && quote.requiredConsents.length === legalCount, `requiredConsents ${quote.requiredConsents?.length} ≠ ${legalCount}`);
      state.expected = { grandTotal: Number(quote.grandTotal), discount: Number(quote.couponStatus.discount), shippingFee: Number(quote.shippingFee) };
      return `gün=${dayLabel} · belge ${legalSlugs.join('+')} · toplam ${money(quote.grandTotal)} TL (kupon −${money(quote.couponStatus.discount)})`;
    });

    // ═══ f — siparişi tamamla (manual sağlayıcı) ══════════════════════════════════════════════
    await step('f "siparişi tamamla" → manual sağlayıcı → Order PAID · başarı görünümü · sepet + kutu taslağı temizlendi', async () => {
      await site.locator('#checkoutComplete').click();
      await site.locator('#checkoutSuccess').waitFor({ state: 'visible', timeout: TIMEOUT });
      const successText = flat(await site.locator('#checkoutSuccess').textContent());
      const m = successText.match(/#(\d+)/);
      assert(m, `başarı metninde sipariş no yok: ${successText}`);
      const orderNo = Number(m[1]);
      assert(/Test ödeme onaylandı/i.test(successText), `manuel sağlayıcı notu yok: ${successText}`);
      assert(await site.locator('body.order-done').count(), 'body.order-done sınıfı yok');
      await shot(site, 'f-basari');
      const cartLen = await site.evaluate(() => JSON.parse(localStorage.getItem('bahceden_cart') || '[]').length);
      assert(cartLen === 0, `sepet temizlenmedi (${cartLen})`);
      assert(pageErrors.length === 0, `sayfa hatası: ${pageErrors.slice(0, 3).join(' | ')}`);

      const row = sql(
        `SELECT o.id || E'\\t' || o.status || E'\\t' || o.kind || E'\\t' || o."grandTotal" || E'\\t' || o."discountTotal" || E'\\t' || o."shippingFee" || E'\\t' || o."couponCode" FROM orders o WHERE o."orderNo" = ${orderNo}`,
      );
      const [orderId, status, kind, grandTotal, discountTotal, shippingFee, couponCode] = row.split('\t');
      assert(status === 'PAID', `Order ${orderNo} durumu ${status}`);
      assert(kind === 'SINGLE', `Order türü ${kind}`);
      assert(couponCode === COUPON_CODE, `Order.couponCode ${couponCode}`);
      assert(Number(grandTotal) === state.expected.grandTotal, `grandTotal ${grandTotal} ≠ ${state.expected.grandTotal}`);
      assert(Number(discountTotal) >= state.expected.discount, `discountTotal ${discountTotal} < kupon ${state.expected.discount}`);
      state.order = { orderNo, id: orderId, grandTotal: Number(grandTotal), shippingFee: Number(shippingFee) };
      state.entityIds.add(orderId);
      const pay = sql(`SELECT id || E'\\t' || status || E'\\t' || provider || E'\\t' || kind || E'\\t' || "conversationId" FROM payments WHERE "orderId" = ${lit(orderId)}`);
      const [paymentId, payStatus, provider, payKind, conversationId] = pay.split('\t');
      assert(payStatus === 'SUCCEEDED' && provider === 'MANUAL' && payKind === 'CHECKOUT', `ödeme: ${pay}`);
      assert(new RegExp(`^ord${orderNo}[A-Za-z0-9]{4}$`).test(conversationId), `conversationId biçimi: ${conversationId}`);
      state.paymentId = paymentId;
      return `#${orderNo} PAID · ${money(grandTotal)} TL (kargo ${money(shippingFee)}) · ödeme ${conversationId}`;
    });

    // ═══ g — PayTR dönüş dalı ═════════════════════════════════════════════════════════════════
    await step('g /sepet.html?siparis=<no>&odeme=ok (PayTR merchant_ok_url dönüşü) → teşekkür + adres çubuğu temizlenir', async () => {
      await site.goto(`${API}/sepet.html?siparis=${state.order.orderNo}&odeme=ok`, { waitUntil: 'networkidle' });
      await site.locator('#checkoutSuccess').waitFor({ state: 'visible', timeout: TIMEOUT });
      const text = flat(await site.locator('#checkoutSuccess').textContent());
      assert(text.includes(`#${state.order.orderNo}`), `dönüş teşekkürü: ${text}`);
      await site.waitForFunction(() => !/[?&]siparis=/.test(location.search), null, { timeout: TIMEOUT });
      await shot(site, 'g-donus');
      return `?siparis=${state.order.orderNo}&odeme=ok → teşekkür, sorgu temizlendi`;
    });

    // ═══ h — üyelik siparişleri + order.paid maili ════════════════════════════════════════════
    await step('h /uyelik.html "önceki siparişler" + GET /me/orders · mail.order-paid SKIPPED + önizleme', async () => {
      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      await site.locator('button[data-panel="orders"]').click(); // "önceki siparişler" sekmesi
      const orderCard = site.locator(`#ordersList [data-order-no="${state.order.orderNo}"]`);
      await orderCard.waitFor({ state: 'visible', timeout: TIMEOUT });
      assert(flat(await orderCard.textContent()).includes(`SİPARİŞ #${state.order.orderNo}`), 'sipariş satırı metni beklenen biçimde değil');
      await shot(site, 'h-uyelik-siparisler');
      const mine = await customer.must('GET', '/api/v1/me/orders');
      const o = (mine.items || []).find((x) => x.orderNo === state.order.orderNo);
      assert(o, `/me/orders içinde #${state.order.orderNo} yok`);
      assert(o.status === 'PAID', `/me/orders durum ${o.status}`);
      const detail = await customer.must('GET', `/api/v1/me/orders/${state.order.orderNo}`);
      assert(Array.isArray(detail.lines) && detail.lines.length > 0, 'sipariş satırları yok');
      const st = await customer.must('GET', `/api/v1/orders/${state.order.orderNo}/status`);
      assert(st.status === 'PAID' && st.paymentStatus === 'SUCCEEDED' && st.paidAt, `status ucu: ${JSON.stringify(st)}`);
      const mailRow = sql(`SELECT status || E'\\t' || coalesce(error,'') FROM mail_logs WHERE "templateSlug" = 'order-paid' AND "entityId" = ${lit(state.order.id)}`);
      assert(mailRow, 'mail.order-paid MailLog satırı yok');
      const [mailStatus, mailError] = mailRow.split('\t');
      assert(mailStatus === 'SKIPPED', `MailLog durumu ${mailStatus} (DISABLE_MAIL → SKIPPED)`);
      assert(mailError.startsWith(PREVIEW_PREFIX), `önizleme yolu yok: ${mailError.slice(0, 60)}`);
      const previewPath = mailError.slice(PREVIEW_PREFIX.length).trim();
      assert(existsSync(previewPath), `önizleme dosyası yok: ${previewPath}`);
      const html = readFileSync(previewPath, 'utf8');
      assert(html.includes(String(state.order.orderNo)), 'önizlemede sipariş no yok');
      assert(/mesafeli-satis|on-bilgilendirme|politikalar/.test(html), 'önizlemede yasal belge bağlantısı yok');
      return `#${state.order.orderNo} üyelikte · order-paid SKIPPED (önizleme)`;
    });

    // ═══ i — admin siparişler ═════════════════════════════════════════════════════════════════
    await step('i admin Siparişler: arama #no → PAID · detay · CouponRedemption + usedCount 1', async () => {
      await panel.goto(`${ADMIN}/siparisler`, { waitUntil: 'domcontentloaded' });
      const search = panel.locator('input[type="search"], input[placeholder*="Sipariş no"]').first();
      await search.fill(`#${state.order.orderNo}`);
      const link = panel.getByRole('link', { name: new RegExp(`#${state.order.orderNo} detay`) }).first();
      await link.waitFor({ state: 'visible', timeout: TIMEOUT });
      const listText = flat(await panel.locator('table').first().textContent());
      assert(listText.includes('Ödendi'), `listede durum rozeti yok: ${listText.slice(0, 200)}`);
      await link.click();
      await panel.waitForURL(/\/siparisler\/[^/]+$/, { timeout: TIMEOUT });
      await panel.getByText('Satırlar', { exact: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await panel.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const detail = flat(await panel.locator('body').textContent());
      assert(detail.includes(`#${state.order.orderNo}`), 'detayda sipariş no yok');
      assert(detail.includes(CUSTOMER_NAME), 'detayda müşteri adı yok');
      assert(/Ekmek/i.test(detail), `detayda ürün satırı yok: ${detail.slice(0, 400)}`);
      assert(detail.includes(COUPON_CODE), 'detayda kupon kodu yok');
      await shot(panel, 'i-siparis-detay');

      const red = sql(`SELECT count(*) FROM coupon_redemptions WHERE "couponId" = ${lit(state.couponId)} AND "orderId" = ${lit(state.order.id)}`);
      assert(num(red) === 1, `CouponRedemption ${red}`);
      const used = sql(`SELECT "usedCount" FROM coupons WHERE id = ${lit(state.couponId)}`);
      assert(num(used) === 1, `coupons.usedCount ${used}`);
      return `panel detay OK · redemption 1 · usedCount 1`;
    });

    // ═══ i2 — admin Ayarlar › Ödeme + Özet kartı ══════════════════════════════════════════════
    await step(`i2 admin Ayarlar › Ödeme (PayTR alanları registry'den + uyarı şeridi) · Özet "Bugün — sipariş ve ciro" kartı`, async () => {
      await panel.goto(`${ADMIN}/ayarlar/odeme`, { waitUntil: 'domcontentloaded' });
      for (const label of ['PayTR mağaza no (merchant_id)', 'PayTR merchant_key', 'PayTR merchant_salt', 'PayTR test modu', 'PayTR bildirim IP allowlist', 'Azami taksit']) {
        await panel.getByText(label, { exact: false }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      }
      const settingsText = flat(await panel.locator('body').textContent());
      // Bu koşuda sağlayıcı "manual" (env) → manuel sağlayıcı uyarısı beklenir; secret alanlar maskeli döner (düz sır ekranda yok)
      assert(/Sağlayıcı "manuel"/.test(settingsText), 'manuel sağlayıcı uyarı şeridi yok');
      assert(!settingsText.includes(PAYTR.key) && !settingsText.includes(PAYTR.salt), 'sır düz metin olarak ekranda');
      await shot(panel, 'i2-ayarlar-odeme');

      await panel.goto(`${ADMIN}/`, { waitUntil: 'domcontentloaded' });
      const card = panel.locator('section, div').filter({ hasText: 'Bugün — sipariş ve ciro' }).first();
      await card.waitFor({ state: 'visible', timeout: TIMEOUT });
      await panel.waitForFunction(() => /Bugünkü ciro/.test(document.body.textContent ?? ''), null, { timeout: TIMEOUT });
      const dash = flat(await panel.locator('body').textContent());
      assert(/Bugünkü sipariş/.test(dash) && /Bugünkü ciro/.test(dash), `Özet kartı alanları eksik: ${dash.slice(0, 200)}`);
      await shot(panel, 'i2-ozet');
      return 'PayTR alanları + manuel sağlayıcı uyarısı · Özet bugünkü sipariş/ciro kartı';
    });

    // ═══ j — durum geçişleri ══════════════════════════════════════════════════════════════════
    await step('j panelden durum geçişleri: Hazırlanıyor → Yolda → Teslim edildi (shared makine düğmeleri)', async () => {
      // i2 adımı panelden ayrılmıştı → sipariş detayına geri dön
      await panel.goto(`${ADMIN}/siparisler/${state.order.id}`, { waitUntil: 'domcontentloaded' });
      await panel.getByText('Satırlar', { exact: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const flow = [
        ['Hazırlanıyor', 'PREPARING'],
        ['Yolda', 'OUT_FOR_DELIVERY'],
        ['Teslim edildi', 'DELIVERED'],
      ];
      for (const [label, expected] of flow) {
        await panel.getByRole('button', { name: label, exact: true }).first().click();
        // AdminConfirmModal: başlık `Durumu "<etiket>" yap`, onay düğmesinin metni de etiket
        const confirm = panel.getByRole('dialog').filter({ hasText: `Durumu "${label}" yap` });
        await confirm.waitFor({ state: 'visible', timeout: TIMEOUT });
        await Promise.all([
          panel.waitForResponse((r) => /\/api\/v1\/admin\/orders\/[^/]+\/status$/.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400),
          confirm.getByRole('button', { name: label, exact: true }).click(),
        ]);
        await confirm.waitFor({ state: 'detached', timeout: TIMEOUT });
        const status = sql(`SELECT status FROM orders WHERE id = ${lit(state.order.id)}`);
        assert(status === expected, `geçiş sonrası durum ${status} ≠ ${expected}`);
      }
      await shot(panel, 'j-durum-delivered');
      return 'PAID → PREPARING → OUT_FOR_DELIVERY → DELIVERED';
    });

    // ═══ k — CSV ══════════════════════════════════════════════════════════════════════════════
    await step('k CSV dışa aktar (GET /admin/orders/export.csv) siparişi içerir', async () => {
      const res = await admin.req('GET', `/api/v1/admin/orders/export.csv?q=${encodeURIComponent(String(state.order.orderNo))}`);
      assert(res.status === 200, `csv → ${res.status}`);
      const csv = String(res.text ?? res.data ?? '');
      assert(csv.split(/\r?\n/).length >= 2, 'CSV satırı yok');
      assert(csv.includes(String(state.order.orderNo)), 'CSV sipariş no içermiyor');
      assert(csv.includes(EMAIL), 'CSV müşteri e-postası içermiyor');
      return `${csv.split(/\r?\n/).filter(Boolean).length} satır`;
    });

    // ═══ l — iade ═════════════════════════════════════════════════════════════════════════════
    await step('l iade (ManualProvider · POST /admin/payments/:id/refund) → Payment REFUNDED + Order REFUNDED + kupon kullanımı geri', async () => {
      const res = await admin.must('POST', `/api/v1/admin/payments/${state.paymentId}/refund`, { amount: state.order.grandTotal, reason: 'E2E F8 iade' });
      assert(res.ok === true, `iade ok değil: ${JSON.stringify(res).slice(0, 200)}`);
      assert(res.payment.status === 'REFUNDED', `Payment durumu ${res.payment.status}`);
      assert(res.orderStatus === 'REFUNDED' && res.orderTransitioned === true, `Order geçişi: ${res.orderStatus}/${res.orderTransitioned}`);
      const status = sql(`SELECT status FROM orders WHERE id = ${lit(state.order.id)}`);
      assert(status === 'REFUNDED', `Order ${status}`);
      const red = num(sql(`SELECT count(*) FROM coupon_redemptions WHERE "orderId" = ${lit(state.order.id)}`));
      const used = num(sql(`SELECT "usedCount" FROM coupons WHERE id = ${lit(state.couponId)}`));
      assert(red === 0 && used === 0, `iade sonrası kupon: redemption ${red}, usedCount ${used}`);
      await panel.reload({ waitUntil: 'domcontentloaded' });
      await panel.waitForFunction(() => !!document.querySelector('main')?.textContent?.includes('İade edildi'), null, { timeout: TIMEOUT });
      await shot(panel, 'l-iade');
      return `iade ${money(state.order.grandTotal)} TL · Order REFUNDED · kupon serbest`;
    });

    // ═══ m — abonelik checkout'u ══════════════════════════════════════════════════════════════
    await step('m /kutu.html?tier=sezon taslağı → /sepet.html abonelik checkout (SUBSCRIPTION_CONTRACT_ACK) → ACTIVE + cycle#1 prepaid (kargo hariç)', async () => {
      await site.goto(`${API}/kutu.html?tier=sezon`, { waitUntil: 'networkidle' });
      await site.waitForFunction(() => (JSON.parse(localStorage.getItem('bahceden_sub') || '{}').items || []).length > 0, null, { timeout: TIMEOUT });
      // Abonelik türü + teslimat günü seçilmeden "aboneliği başlat" pasif kalır (isConfirmValid)
      await site.locator('#deliveryDayToggle .toggle:not([disabled])').first().click();
      const startBtn = site.locator('#confirmBtn');
      await startBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      const startLabel = flat(await startBtn.textContent());
      assert(/aboneliği başlat/i.test(startLabel), `kutu düğmesi: ${startLabel}`);
      assert(!(await startBtn.isDisabled()), 'aboneliği başlat pasif');
      await startBtn.click();
      await site.waitForURL(/sepet\.html/, { timeout: TIMEOUT });
      await site.waitForLoadState('networkidle');
      await site.locator('#checkoutSections').waitFor({ state: 'visible', timeout: TIMEOUT });

      const dayBtn = site.locator('#checkoutDeliveryDay .toggle:not([disabled])').first();
      await dayBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await dayBtn.click();
      const boxes = site.locator('#checkoutLegal input[data-legal-slug]');
      await site.waitForFunction(() => document.querySelectorAll('#checkoutLegal input[data-legal-slug]').length >= 3, null, { timeout: TIMEOUT });
      const slugs = [];
      const n = await boxes.count();
      for (let i = 0; i < n; i++) {
        slugs.push(await boxes.nth(i).getAttribute('data-legal-slug'));
        await boxes.nth(i).check();
      }
      assert(slugs.includes('abonelik-sozlesmesi'), `abonelik sözleşmesi onay kutusu yok: ${slugs.join(',')}`);
      await shot(site, 'm-abonelik-onaylar');
      await site.locator('#checkoutComplete').click();
      await site.locator('#checkoutSuccess').waitFor({ state: 'visible', timeout: 60_000 });
      const text = flat(await site.locator('#checkoutSuccess').textContent());
      const m = text.match(/#(\d+)/);
      assert(m, `abonelik başarı metni: ${text}`);
      assert(/üyelik sayfandan/i.test(text), `abonelik teşekkürü üyelik yönlendirmesi içermeli: ${text}`);
      const orderNo = Number(m[1]);
      const subDraft = await site.evaluate(() => localStorage.getItem('bahceden_sub'));
      assert(!subDraft || !(JSON.parse(subDraft).active), 'kutu taslağı temizlenmedi');

      const orderRow = sql(
        `SELECT id || E'\\t' || status || E'\\t' || kind || E'\\t' || "grandTotal" || E'\\t' || "shippingFee" || E'\\t' || coalesce("subscriptionId",'') FROM orders WHERE "orderNo" = ${orderNo}`,
      );
      const [subOrderId, oStatus, oKind, oGrand, oShip, subId] = orderRow.split('\t');
      assert(oStatus === 'PAID' && oKind === 'SUBSCRIPTION', `abonelik siparişi: ${orderRow}`);
      assert(subId, 'Order.subscriptionId boş');
      state.subOrder = { orderNo, id: subOrderId, grandTotal: Number(oGrand), shippingFee: Number(oShip) };
      state.subscriptionId = subId;
      state.entityIds.add(subOrderId);
      state.entityIds.add(subId);
      const subStatus = sql(`SELECT status FROM subscriptions WHERE id = ${lit(subId)}`);
      assert(subStatus === 'ACTIVE', `Subscription ${subStatus}`);
      const cycleRow = sql(
        `SELECT "cycleNo" || E'\\t' || status || E'\\t' || "prepaidAmount" || E'\\t' || coalesce("orderId",'') FROM subscription_cycles WHERE "subscriptionId" = ${lit(subId)} AND "cycleNo" = 1`,
      );
      const [cycleNo, cStatus, prepaid, cOrderId] = cycleRow.split('\t');
      assert(num(cycleNo) === 1 && cOrderId === subOrderId, `cycle#1 siparişe bağlı değil: ${cycleRow}`);
      assert(['CHARGED', 'SCHEDULED', 'LOCKED'].includes(cStatus), `cycle#1 durumu ${cStatus}`);
      // KARAR (F8): prepaidAmount = kutu + ekstralar − indirim, KARGO HARİÇ (kargo Order.shippingFee'de)
      assert(Number(prepaid) === Number(oGrand) - Number(oShip), `prepaidAmount ${prepaid} ≠ grandTotal ${oGrand} − kargo ${oShip}`);

      await site.goto(`${API}/uyelik.html`, { waitUntil: 'networkidle' });
      const subView = flat(await site.locator('main').textContent());
      assert(/abonelik/i.test(subView), 'üyelik sayfasında abonelik görünümü yok');
      await shot(site, 'm-uyelik-abonelik');
      const meSub = await customer.must('GET', '/api/v1/me/subscription');
      assert(meSub && meSub.status === 'ACTIVE', `/me/subscription: ${JSON.stringify(meSub).slice(0, 160)}`);
      return `#${orderNo} SUBSCRIPTION PAID · sub ACTIVE · cycle#1 ${cStatus} prepaid ${money(prepaid)} (kargo ${money(oShip)} siparişte)`;
    });

    // ═══ n — iptal akışı ══════════════════════════════════════════════════════════════════════
    await step('n iptal akışı (API): cancel → retention teklifi → ikinci talep → confirm → CANCELLED', async () => {
      const first = await customer.must('POST', '/api/v1/me/subscription/cancel', { reason: 'PRICE', note: 'e2e f8' });
      assert(first.cancellationId, `1. talep: ${JSON.stringify(first).slice(0, 200)}`);
      const offered = !!first.offer;
      const mid = await customer.must('GET', '/api/v1/me/subscription');
      assert(mid.status === 'CANCEL_REQUESTED', `talep sonrası abonelik durumu ${mid.status}`);
      if (offered) {
        // Kalma teklifi kabul → ACTIVE'e döner; ikinci talepte teklif tekrar sunulmaz (üye başına 1)
        const accepted = await customer.must('POST', '/api/v1/me/subscription/retention/accept');
        assert(accepted.status === 'ACTIVE', `teklif kabul sonrası ${accepted.status}`);
        const second = await customer.must('POST', '/api/v1/me/subscription/cancel', { reason: 'OTHER' });
        assert(second.cancellationId && second.offer === null, `2. talep: ${JSON.stringify(second).slice(0, 200)}`);
      }
      const confirmed = await customer.must('POST', '/api/v1/me/subscription/cancel/confirm');
      assert(confirmed.status === 'CANCELLED' && confirmed.cancellation && confirmed.cancellation.outcome === 'CANCELLED', `confirm: ${JSON.stringify(confirmed).slice(0, 200)}`);
      const dbStatus = sql(`SELECT status FROM subscriptions WHERE id = ${lit(state.subscriptionId)}`);
      assert(dbStatus === 'CANCELLED', `Subscription ${dbStatus}`);
      const after = await customer.req('GET', '/api/v1/me/subscription');
      assert(after.status === 200 && after.data === null, `iptal sonrası /me/subscription: ${JSON.stringify(after.data).slice(0, 120)}`);
      return `CANCELLED (kalma teklifi ${offered ? `%${first.offer.pct} × ${first.offer.boxes}` : 'yok'})`;
    });

    // ═══ o — PayTR bildirimi ══════════════════════════════════════════════════════════════════
    await step('o PayTR bildirimi: geçerli hash → PAID · ikinci teslim IGNORED · geçersiz hash 400 · IP allowlist 403', async () => {
      await admin.must('PUT', '/api/v1/admin/settings/payment', {
        paytrMerchantId: PAYTR.merchantId,
        paytrMerchantKey: PAYTR.key,
        paytrMerchantSalt: PAYTR.salt,
        paytrTestMode: true,
        paytrCallbackAllowedIps: '',
      });
      // PENDING PayTR ödemesi olan sipariş (psql; PayTR'ye istek atılmaz)
      const orderId = genId('e2eord');
      const paymentId = genId('e2epay');
      const oid = `ordE2E${RUN}`.replace(/[^A-Za-z0-9]/g, '');
      const amount = 123.45;
      const dd = sqlLines(
        `SELECT d.id || E'\\t' || d.day || E'\\t' || to_char(d.date,'YYYY-MM-DD') FROM delivery_dates d JOIN delivery_zones z ON z.id = d."zoneId" WHERE z.slug = ${lit(ZONE_SLUG)} AND d.status = 'OPEN' ORDER BY d.date LIMIT 1`,
      );
      assert(dd.length === 1, 'açık teslimat günü bulunamadı');
      const [ddId, ddDay, ddDate] = dd[0].split('\t');
      const zoneId = sql(`SELECT id FROM delivery_zones WHERE slug = ${lit(ZONE_SLUG)}`);
      const nowIso = new Date().toISOString();
      const snapshot = JSON.stringify({ fullName: CUSTOMER_NAME, phone: PHONE, line: 'E2E PayTR', zoneId, zoneName: 'Urla', zip: null });
      sql(
        `INSERT INTO orders (id, kind, status, "userId", "customerName", "customerEmail", "customerPhone", "zoneId", "deliveryDateId", "deliveryDay", "deliveryOn", "addressSnapshot", subtotal, "discountTotal", "shippingFee", "vatTotal", "grandTotal", "createdAt", "updatedAt") ` +
          `VALUES (${lit(orderId)}, 'SINGLE', 'PENDING_PAYMENT', ${lit(state.userId)}, ${lit(CUSTOMER_NAME)}, ${lit(EMAIL)}, ${lit(PHONE)}, ${lit(zoneId)}, ${lit(ddId)}, ${lit(ddDay)}, ${lit(ddDate)}::date, ${lit(snapshot)}::jsonb, ${amount}, 0, 0, 0, ${amount}, ${lit(nowIso)}, ${lit(nowIso)})`,
      );
      sql(
        `INSERT INTO payments (id, "orderId", provider, kind, status, "conversationId", amount, "is3ds", "isMerchantInitiated", "attemptNo", "createdAt") ` +
          `VALUES (${lit(paymentId)}, ${lit(orderId)}, 'PAYTR', 'CHECKOUT', 'PENDING', ${lit(oid)}, ${amount}, true, false, 1, ${lit(nowIso)})`,
      );
      state.paytr = { orderId, paymentId, oid };
      state.entityIds.add(orderId);

      const totalAmount = String(Math.round(amount * 100));
      const base = { merchant_oid: oid, status: 'success', total_amount: totalAmount, payment_amount: totalAmount, payment_type: 'card', currency: 'TL', test_mode: '1' };

      // 1) geçersiz hash → 400 (WebhookEvent yazılmaz)
      const badHashEvents = num(sql(`SELECT count(*) FROM webhook_events WHERE "providerRef" LIKE ${lit(oid + '%')}`));
      const bad = await postCallback({ ...base, hash: 'GECERSIZ' });
      assert(bad.status === 400 && /bad hash/i.test(bad.text), `geçersiz hash → ${bad.status} "${bad.text}"`);
      assert(num(sql(`SELECT count(*) FROM webhook_events WHERE "providerRef" LIKE ${lit(oid + '%')}`)) === badHashEvents, 'geçersiz hash WebhookEvent yazdı');

      // 2) IP allowlist dışı → 403
      await admin.must('PUT', '/api/v1/admin/settings/payment', { paytrCallbackAllowedIps: '203.0.113.10' });
      const blocked = await postCallback({ ...base, hash: callbackHash(oid, 'success', totalAmount) });
      assert(blocked.status === 403, `IP reddi → ${blocked.status} "${blocked.text}"`);
      assert(sql(`SELECT status FROM payments WHERE id = ${lit(paymentId)}`) === 'PENDING', 'IP reddinde ödeme değişti');
      await admin.must('PUT', '/api/v1/admin/settings/payment', { paytrCallbackAllowedIps: '' });

      // 3) geçerli hash → OK + Payment SUCCEEDED + Order PAID
      const ok = await postCallback({ ...base, hash: callbackHash(oid, 'success', totalAmount) });
      assert(ok.status === 200 && ok.text === 'OK', `geçerli bildirim → ${ok.status} "${ok.text}"`);
      assert(sql(`SELECT status FROM payments WHERE id = ${lit(paymentId)}`) === 'SUCCEEDED', 'Payment SUCCEEDED değil');
      assert(sql(`SELECT status FROM orders WHERE id = ${lit(orderId)}`) === 'PAID', 'Order PAID değil');
      const ev = sql(`SELECT status FROM webhook_events WHERE provider = 'PAYTR' AND "providerRef" = ${lit(oid + ':success')}`);
      assert(ev === 'PROCESSED', `WebhookEvent ${ev}`);

      // 4) ikinci teslim → OK, tek WebhookEvent (idempotent)
      const again = await postCallback({ ...base, hash: callbackHash(oid, 'success', totalAmount) });
      assert(again.status === 200 && again.text === 'OK', `ikinci teslim → ${again.status}`);
      const evCount = num(sql(`SELECT count(*) FROM webhook_events WHERE provider = 'PAYTR' AND "providerRef" = ${lit(oid + ':success')}`));
      assert(evCount === 1, `WebhookEvent ${evCount} satır (idempotent olmalı)`);
      return `oid=${oid} · 400 bad hash · 403 IP · OK → PAID · ikinci teslim IGNORED`;
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
      await step('z temizlik: kupon/sipariş/ödeme/abonelik/kullanıcı/consent/mail/webhook silindi · reserved geri · payment.* geri → sayımlar ≡ başlangıç', async () => {
        const problems = [];
        const tryDo = (label, fn) => {
          try {
            fn();
          } catch (e) {
            problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        };
        // Ayarlar: koşuda yazılan payment.* satırları silinir, öncekiler geri konur
        tryDo('settings(payment)', () => sql(`DELETE FROM settings WHERE key IN (${inList(PAYMENT_SETTING_KEYS)})`));
        for (const row of state.settingRows) {
          tryDo(`setting ${row.key}`, () =>
            sql(
              `INSERT INTO settings (key, "group", value, "isSecret", "updatedAt") VALUES (${lit(row.key)}, ${lit(row.group)}, ${lit(row.value)}::jsonb, ${row.isSecret}, now()) ` +
                `ON CONFLICT (key) DO UPDATE SET "group" = EXCLUDED."group", value = EXCLUDED.value, "isSecret" = EXCLUDED."isSecret"`,
            ),
          );
        }
        const userIds = state.userId ? [state.userId] : sqlLines(`SELECT id FROM users WHERE email = ${lit(EMAIL)}`);
        if (userIds.length) {
          const U = inList(userIds);
          const subIds = sqlLines(`SELECT id FROM subscriptions WHERE "userId" IN (${U})`);
          const S = inList(subIds);
          const orderIds = sqlLines(`SELECT id FROM orders WHERE "userId" IN (${U}) OR "subscriptionId" IN (${S})`);
          const O = inList(orderIds);
          // Mail önizleme dosyaları
          for (const e of sqlLines(
            `SELECT error FROM mail_logs WHERE ("entityId" IN (${U}) OR "entityId" IN (${O}) OR "to" = ${lit(EMAIL)}) AND error LIKE 'preview:%'`,
          )) {
            const f = e.slice(PREVIEW_PREFIX.length).trim();
            tryDo(`dosya ${f}`, () => {
              if (f && existsSync(f)) unlinkSync(f);
            });
          }
          tryDo('webhook_events', () => sql(`DELETE FROM webhook_events WHERE provider = 'PAYTR' AND "providerRef" LIKE ${lit('ordE2E' + RUN + '%')}`));
          tryDo('coupon_redemptions', () => sql(`DELETE FROM coupon_redemptions WHERE "orderId" IN (${O}) OR "userId" IN (${U})`));
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
          tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "entityId" IN (${U}) OR "entityId" IN (${O}) OR "to" = ${lit(EMAIL)}`));
          tryDo('users', () => sql(`DELETE FROM users WHERE id IN (${U})`));
        }
        tryDo('coupons', () => sql(`DELETE FROM coupon_redemptions WHERE "couponId" IN (SELECT id FROM coupons WHERE code = ${lit(COUPON_CODE)})`));
        tryDo('coupons(row)', () => sql(`DELETE FROM coupons WHERE code = ${lit(COUPON_CODE)}`));
        // Audit (bu koşu): aktör müşteri/admin, varlık bizim satırlarımız
        const since = lit(new Date(startedAt.getTime() - 5_000).toISOString());
        const ids = [...state.entityIds];
        tryDo('audit_logs', () =>
          sql(
            `DELETE FROM audit_logs WHERE "createdAt" >= ${since} AND (${userIds.length ? `"actorId" IN (${inList(userIds)}) OR ` : ''}"entityId" IN (${inList(ids)}) OR module IN ('checkout','coupons','payments') OR (module = 'settings' AND "entityId" = 'payment') OR (module = 'orders' AND "createdAt" >= ${since}))`,
          ),
        );
        // DeliveryDate: rezerv geri + koşuda üretilen referanssız tarihler silinir
        for (const [id, reserved] of state.ddBaseline) tryDo(`dd ${id}`, () => sql(`UPDATE delivery_dates SET reserved = ${reserved} WHERE id = ${lit(id)} AND reserved <> ${reserved}`));
        tryDo('delivery_dates(new)', () =>
          sql(
            `DELETE FROM delivery_dates d WHERE d.id NOT IN (${inList([...state.ddAllBefore])}) AND NOT EXISTS (SELECT 1 FROM subscription_cycles c WHERE c."deliveryDateId" = d.id) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."deliveryDateId" = d.id)`,
          ),
        );
        if (problems.length) throw new Error(`temizlik sorunları: ${problems.join(' · ')}`);
        const after = {
          users: num(sql('SELECT count(*) FROM users')),
          orders: num(sql('SELECT count(*) FROM orders')),
          orderLines: num(sql('SELECT count(*) FROM order_lines')),
          payments: num(sql('SELECT count(*) FROM payments')),
          refunds: num(sql('SELECT count(*) FROM refunds')),
          subscriptions: num(sql('SELECT count(*) FROM subscriptions')),
          cycles: num(sql('SELECT count(*) FROM subscription_cycles')),
          cycleItems: num(sql('SELECT count(*) FROM cycle_items')),
          consents: num(sql('SELECT count(*) FROM consents')),
          coupons: num(sql('SELECT count(*) FROM coupons')),
          redemptions: num(sql('SELECT count(*) FROM coupon_redemptions')),
          webhookEvents: num(sql('SELECT count(*) FROM webhook_events')),
          mailLogs: num(sql('SELECT count(*) FROM mail_logs')),
          paymentMethods: num(sql('SELECT count(*) FROM payment_methods')),
          deliveryDates: num(sql('SELECT count(*) FROM delivery_dates')),
          settings: num(sql('SELECT count(*) FROM settings')),
        };
        const diffs = Object.keys(state.counts ?? {}).filter((k) => state.counts[k] !== after[k]).map((k) => `${k} ${state.counts[k]}→${after[k]}`);
        assert(diffs.length === 0, `sayımlar başlangıçtan farklı: ${diffs.join(', ')}`);
        const reservedDiff = sqlLines('SELECT id || E\'\\t\' || reserved FROM delivery_dates').filter((r) => {
          const [id, reserved] = r.split('\t');
          return state.ddBaseline.has(id) && state.ddBaseline.get(id) !== num(reserved);
        });
        assert(reservedDiff.length === 0, `delivery_dates.reserved geri alınmadı: ${reservedDiff.join(', ')}`);
        return `sayımlar ≡ başlangıç (${Object.keys(after).length} tablo) · reserved geri`;
      });
    } catch {
      failed = true;
    }
  }

  await browser.close();

  // ---- rapor ---------------------------------------------------------------------------------
  const okCount = results.filter((r) => r.ok).length;
  const lines = [
    '# e2e F8 — checkout + ödeme + kupon + admin siparişler (site + panel + API + psql)',
    '',
    `- Tarih: ${startedAt.toISOString()} · Süre: ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)} s`,
    `- API: \`${API}\` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: \`${ADMIN}\` (vite preview, proxy)`,
    `- Kupon: \`${COUPON_CODE}\` (%10, SINGLE) · Müşteri: \`${EMAIL}\` · PayTR: sahte mağaza bilgileri (dışarıya istek YOK)`,
    `- Sonuç: **${okCount}/${results.length}**${failed ? ' — HATA' : ' — tümü OK'}`,
    '',
    '| # | Adım | Sonuç | Süre | Not |',
    '|---|---|---|---|---|',
    ...results.map((r, i) => `| ${i + 1} | ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|').slice(0, 300)} |`),
    '',
    '## Ekran görüntüleri',
    '',
    '`tools/e2e-admin/out/f8-*.png` (gitignore).',
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
