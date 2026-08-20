// tools/e2e-admin/run-f7.mjs — F7 abonelik motoru uçtan uca doğrulama (API düzeyi: fetch + psql; Playwright yok).
//
// Geçici API önceden ayağa kaldırılır (önerilen: apps/api içinde `PORT=4064 ENABLE_CRON=false DISABLE_MAIL=true WEB_URL=http://127.0.0.1:4064 node dist/main.js`).
// Zaman sahte saatle değil, job'lara verilen `now` ile ilerletilir (`POST /admin/jobs/:name/run {now}` — yalnız geliştirme/test;
// JobsService.runOnce(name, now)); müşteri uçları gerçek saatle çalışır (kesimler gelecekte olduğundan açık cycle düzenlenebilir).
// Senaryo (tek monoton simülasyon saati; T0 = kesimi geçmemiş ilk Salı, R0 = aynı haftanın Perşembesi):
//   0  hazırlık: admin girişi · sayımlar · Setting commerce.dunning → [2,12], paymentLinkHours → 1 (sonda geri) · bölge/tier/ürün ·
//      haftanın kutusu şablonları (11 hafta, yoksa oluştur+yayınla; sonda silinir)
//   a  3 müşteri kaydı (POST /auth/register + PUT /me/address) + saklı kart (psql; ManualProvider `ok:`/`fail:` token'ı)
//   b  admin POST /admin/subscriptions: (1) haftalık Salı MIT (2) haftalık Salı PAYMENT_LINK (kartsız) (3) tek seferlik Perşembe →
//      Order PAID (MANUAL CHECKOUT ödeme) · cycle#1 SCHEDULED · ACTIVE · GET /me/subscription · GET /me/orders
//   c  cycles:ensure (ufuk 8 hafta) · delivery-dates:generate · reminders:cutoff
//   d  T0 kesimi: lock-and-charge → cycle#1'ler CHARGED (peşin, 0 TL) · pick/packing listeleri · ops PREPARING → OUT → DELIVERED
//   e  R0 kesimi: tek seferlik → CHARGED → teslim → Subscription COMPLETED, /me/subscription null
//   f  müşteri 1: cycle#2 atla → geri al (hak iade, DD rezerv) · T1 kesimi: MIT tahsilat → CHARGED + Order PAID + Payment CYCLE_CHARGE
//   g  müşteri 2: T1'de AWAITING_PAYMENT + GET /pay/:token → süre dolunca UNPAID (+ link EXPIRED) → retry yeni link → 08:00 sınırı →
//      SKIPPED(UNPAID), Order CANCELLED · iptal akışı: teklif → kabul → ikinci talep teklifsiz → onay → CANCELLED
//   h  müşteri 1: kart `fail:` → T2 UNPAID (+2 s, +12 s denemeler) → SKIPPED(UNPAID) · T3 aynı → PAST_DUE · kart düzelt → T4 CHARGED → ACTIVE
//   i  müşteri 1 iptal (teklif → onay) → CANCELLED, SCHEDULED cycle'lar iptal + DD iade · CronLog satırları · admin listeleri
//   z  temizlik: kullanıcılar/abonelikler/cycle'lar/siparişler/ödemeler/kartlar/adresler/consent/mail_logs/audit/cron_logs/system_logs/
//      şablonlar silinir; delivery_dates.reserved başlangıca döner; ayarlar geri → sayımlar ≡ başlangıç
// Kullanım (repo kökünden): node tools/e2e-admin/run-f7.mjs [--api=http://127.0.0.1:4064] [--keep]
// Çıktı: tools/e2e-admin/report-f7.md. Çıkış kodu: hata varsa 1. Sırlar (SEED_ADMIN_*, DATABASE_URL) yalnız env'den okunur; çıktıya yazılmaz.
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const REPORT_PATH = join(HERE, 'report-f7.md');

loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.E2E_API || 'http://127.0.0.1:4064').replace(/\/$/, '');
const KEEP = Boolean(args.keep);
const PSQL = process.env.PSQL || 'psql';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
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
const ZONE_SLUG = 'urla';
const TEMPLATE_WEEKS = 11;

// ---- küçük yardımcılar ------------------------------------------------------------------------
const results = [];
const startedAt = new Date();
function log(msg) {
  console.log(`[e2e-f7] ${msg}`);
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
/** psql -tAc. Bağlantı dizesi (parola) hata mesajına/çıktıya YAZILMAZ. */
function sql(query) {
  try {
    return execFileSync(PSQL, [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr).trim() : '';
    throw new Error(`psql hatası: ${stderr || 'komut başarısız'} — sorgu: ${query.slice(0, 100)}`);
  }
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const inList = (ids) => ids.map(lit).join(',');
function sqlLines(query) {
  const out = sql(query);
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}
const num = (v) => Number(String(v ?? '0'));
/** cuid benzeri kimlik (ID_RE ^[A-Za-z0-9_-]{1,64}$). */
const genId = (prefix) => `${prefix}${RUN}${randomBytes(6).toString('hex')}`;

// ---- takvim (Europe/Istanbul kalıcı +03; kesim = teslimattan 1 gün önce 12:00) -----------------
const TZ_OFFSET = '+03:00';
function istanbulToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Pazar … 2 Salı … 4 Perşembe
const cutoffOf = (deliveryOn) => new Date(`${addDays(deliveryOn, -1)}T12:00:00${TZ_OFFSET}`);
const at = (deliveryOn, hhmm) => new Date(`${deliveryOn}T${hhmm}:00${TZ_OFFSET}`);
const plusMin = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const isoOf = (d) => d.toISOString();
function firstDeliverable(dayOfWeek, now = new Date()) {
  const today = istanbulToday(now);
  for (let i = 0; i < 21; i++) {
    const date = addDays(today, i);
    if (dow(date) === dayOfWeek && cutoffOf(date).getTime() > now.getTime() + 5 * 60_000) return date;
  }
  throw new Error('teslimat günü bulunamadı');
}
const mondayOf = (iso) => addDays(iso, -((dow(iso) + 6) % 7));

/** Çerez kavanozlu API istemcisi. */
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
    if (!expected.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
    return r.data;
  }
}

// ---- ana akış -------------------------------------------------------------------------------
async function main() {
  const admin = new ApiClient(API);
  const customers = [new ApiClient(API), new ApiClient(API), new ApiClient(API)];
  const state = {
    counts: null,
    settings: { dunning: null, paymentLinkHours: null, changed: false },
    zoneId: null,
    tierSlug: null,
    tierId: null,
    tierPrice: 0,
    freshProductIds: [],
    extraProduct: null,
    templateIds: [],
    ddBaseline: new Map(), // id → reserved (urla)
    ddAllBefore: new Set(), // tüm delivery_dates id'leri (yeni üretilenleri ayırt etmek için)
    users: [], // {email, id, addressId, pmOk, pmFail, subId, cycles}
    cronLogIds: [],
    entityIds: new Set(),
    T: [], // Salı teslimat günleri T0..T6
    R0: null,
  };
  let failed = false;

  const job = async (name, now) => {
    const body = now ? { now: isoOf(now) } : {};
    const r = await admin.must('POST', `/api/v1/admin/jobs/${name}/run`, body);
    assert(r.status === 'SUCCESS', `${name} → ${r.status} ${JSON.stringify(r.details).slice(0, 200)}`);
    assert(r.errors === 0, `${name} errors=${r.errors} ${JSON.stringify(r.details).slice(0, 300)}`);
    if (r.cronLogId) state.cronLogIds.push(r.cronLogId);
    return r;
  };
  const subDetail = async (id) => {
    const d = await admin.must('GET', `/api/v1/admin/subscriptions/${id}`);
    d.cycles = [...(d.cycles ?? [])].sort((a, b) => a.cycleNo - b.cycleNo);
    return d;
  };
  const cycleByNo = (detail, no) => {
    const c = detail.cycles.find((x) => x.cycleNo === no);
    assert(c, `cycle#${no} yok (${detail.cycles.map((x) => x.cycleNo).join(',')})`);
    return c;
  };
  const orderStatus = (id) => sql(`SELECT status FROM orders WHERE id = ${lit(id)}`);
  const paymentsOf = (orderId) => sqlLines(`SELECT kind || ':' || status FROM payments WHERE "orderId" = ${lit(orderId)} ORDER BY "createdAt", id`);
  const reservedOf = (ddId) => num(sql(`SELECT reserved FROM delivery_dates WHERE id = ${lit(ddId)}`));
  const setStatus = (cycleId, status, note) => admin.must('PATCH', `/api/v1/admin/cycles/${cycleId}/status`, note ? { status, note } : { status });
  const deliver = async (cycleId) => {
    for (const st of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) await setStatus(cycleId, st);
  };

  try {
    await step('0 hazırlık: admin girişi · sayımlar · ayarlar (dunning [2,12], paymentLinkHours 1) · bölge/tier/ürünler · şablonlar', async () => {
      const me = await admin.loginAdmin();
      assert(me && me.role === 'ADMIN', 'seed admin ADMIN rolünde olmalı');
      state.counts = {
        users: num(sql('SELECT count(*) FROM users')),
        subscriptions: num(sql('SELECT count(*) FROM subscriptions')),
        cycles: num(sql('SELECT count(*) FROM subscription_cycles')),
        orders: num(sql('SELECT count(*) FROM orders')),
        payments: num(sql('SELECT count(*) FROM payments')),
        paymentMethods: num(sql('SELECT count(*) FROM payment_methods')),
        cronLogs: num(sql('SELECT count(*) FROM cron_logs')),
        templates: num(sql('SELECT count(*) FROM box_templates')),
        deliveryDates: num(sql('SELECT count(*) FROM delivery_dates')),
        reservedUrla: num(sql(`SELECT coalesce(sum(reserved),0) FROM delivery_dates d JOIN delivery_zones z ON z.id = d."zoneId" WHERE z.slug = ${lit(ZONE_SLUG)}`)),
      };
      // Ayarlar: dunning + paymentLinkHours (sonda geri)
      const commerce = await admin.must('GET', '/api/v1/admin/settings/commerce');
      const field = (k) => commerce.fields.find((f) => f.key === k);
      state.settings.dunning = field('dunning')?.value ?? null;
      state.settings.paymentLinkHours = field('paymentLinkHours')?.value ?? null;
      assert(state.settings.dunning && state.settings.paymentLinkHours !== null, 'commerce.dunning / paymentLinkHours okunamadı');
      await admin.must('PUT', '/api/v1/admin/settings/commerce', { dunning: { retryHours: [2, 12], pastDueAfterUnpaid: 2 }, paymentLinkHours: 1 });
      state.settings.changed = true;
      const after = await admin.must('GET', '/api/v1/admin/settings/commerce');
      assert(JSON.stringify(after.fields.find((f) => f.key === 'dunning').value.retryHours) === '[2,12]', 'dunning güncellenmedi');
      // Bölge / tier / ürünler
      state.zoneId = sql(`SELECT id FROM delivery_zones WHERE slug = ${lit(ZONE_SLUG)} AND "isActive"`);
      assert(state.zoneId, `bölge yok: ${ZONE_SLUG}`);
      const tierRow = sql(`SELECT id || E'\\t' || slug || E'\\t' || price FROM box_tiers WHERE "isActive" ORDER BY "sortOrder" DESC LIMIT 1`);
      assert(tierRow, 'aktif tier yok');
      [state.tierId, state.tierSlug, state.tierPrice] = tierRow.split('\t');
      state.tierPrice = num(state.tierPrice);
      state.freshProductIds = sqlLines(`SELECT id FROM products WHERE "isFresh" AND status = 'ACTIVE' AND "stockStatus" IN ('IN_STOCK','LOW') AND "deletedAt" IS NULL ORDER BY "sortOrder" LIMIT 3`);
      assert(state.freshProductIds.length === 3, `fresh ürün < 3 (${state.freshProductIds.length}) — pnpm db:seed`);
      const extra = sql(`SELECT slug || E'\\t' || unit || E'\\t' || price FROM products WHERE NOT "isFresh" AND status = 'ACTIVE' AND "stockStatus" IN ('IN_STOCK','LOW') AND "deletedAt" IS NULL ORDER BY "sortOrder" LIMIT 1`);
      assert(extra, 'fresh olmayan aktif ürün yok');
      const [slug, unit, price] = extra.split('\t');
      state.extraProduct = { slug, unit, price: num(price) };
      // Takvim
      const T0 = firstDeliverable(2);
      state.T = Array.from({ length: 7 }, (_, i) => addDays(T0, i * 7));
      state.R0 = addDays(T0, 2); // aynı haftanın Perşembesi (kesim Çarşamba 12:00 > Salı kesimi → saat monoton)
      // DeliveryDate başlangıç durumu
      for (const row of sqlLines(`SELECT id || ':' || reserved FROM delivery_dates WHERE "zoneId" = ${lit(state.zoneId)}`)) {
        const [id, reserved] = row.split(':');
        state.ddBaseline.set(id, num(reserved));
      }
      for (const id of sqlLines('SELECT id FROM delivery_dates')) state.ddAllBefore.add(id);
      // Şablonlar: T0 haftasından itibaren TEMPLATE_WEEKS hafta (yoksa oluştur + yayınla)
      const weekStarts = Array.from({ length: TEMPLATE_WEEKS }, (_, i) => addDays(mondayOf(T0), i * 7));
      const existing = await admin.must('GET', `/api/v1/admin/box-templates?tierId=${state.tierId}&from=${weekStarts[0]}&to=${weekStarts[weekStarts.length - 1]}`);
      const have = new Map(existing.map((t) => [String(t.weekStart).slice(0, 10), t]));
      let created = 0;
      let published = 0;
      for (const ws of weekStarts) {
        let tpl = have.get(ws);
        if (!tpl) {
          tpl = await admin.must('POST', '/api/v1/admin/box-templates', { tierId: state.tierId, weekStart: ws, curatorName: 'E2E Küratör', items: state.freshProductIds.map((productId) => ({ productId, qtyLabel: '1 adet', isSwappable: true })) }, [200, 201]);
          state.templateIds.push(tpl.id);
          created++;
        }
        if (tpl.status !== 'PUBLISHED') {
          await admin.must('POST', `/api/v1/admin/box-templates/${tpl.id}/publish`, undefined, [200, 201]);
          if (!state.templateIds.includes(tpl.id)) state.entityIds.add(tpl.id);
          published++;
        }
      }
      return `users=${state.counts.users} subs=${state.counts.subscriptions} cycles=${state.counts.cycles} orders=${state.counts.orders} payments=${state.counts.payments} cron=${state.counts.cronLogs} · tier ${state.tierSlug} (${state.tierPrice} TL) · T0=${state.T[0]} R0=${state.R0} · şablon +${created} (yayın ${published})`;
    });

    await step('a 3 müşteri: POST /auth/register (KVKK) → PUT /me/address (urla) · saklı kartlar (ok: / fail:, psql)', async () => {
      for (let i = 0; i < 3; i++) {
        const email = `e2e-f7-${RUN}-${i + 1}@example.com`;
        const c = customers[i];
        await c.req('GET', '/api/v1/auth/csrf');
        const reg = await c.req('POST', '/api/v1/auth/register', { email, password: PASSWORD, name: `E2E Abone ${i + 1}`, phone: '0530 000 00 0' + (i + 1), consents: [{ kind: 'KVKK_ACK', granted: true }] });
        assert(reg.status === 201, `register ${i + 1} → ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
        const id = sql(`SELECT id FROM users WHERE email = ${lit(email)}`);
        assert(id, 'kullanıcı satırı yok');
        const addr = await c.must('PUT', '/api/v1/me/address', { fullName: `E2E Abone ${i + 1}`, phone: '0530 000 00 0' + (i + 1), line: `E2E Mah. ${RUN} Sk. No:${i + 1}`, zoneSlug: ZONE_SLUG, zip: '35430' });
        assert(addr && addr.id && addr.zoneSlug === ZONE_SLUG, `adres: ${JSON.stringify(addr).slice(0, 120)}`);
        const pmOk = genId('e2epm');
        const pmFail = genId('e2epf');
        const nowIso = new Date().toISOString();
        sql(`INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") VALUES (${lit(pmOk)}, ${lit(id)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('ok:' + RUN)}, '0001', 'TEST', true, true, ${lit(nowIso)})`);
        sql(`INSERT INTO payment_methods (id, "userId", provider, "providerCustomerKey", "providerCardToken", last4, brand, "isDefault", "isActive", "createdAt") VALUES (${lit(pmFail)}, ${lit(id)}, 'MANUAL', ${lit('cus_' + RUN)}, ${lit('fail:' + RUN)}, '0002', 'TEST', false, true, ${lit(nowIso)})`);
        state.users.push({ email, id, addressId: addr.id, pmOk, pmFail, subId: null });
        state.entityIds.add(id);
      }
      return state.users.map((u) => u.id).join(', ');
    });

    await step('b admin POST /admin/subscriptions ×3 (MIT haftalık Salı · PAYMENT_LINK haftalık Salı · tek seferlik Perşembe) → Order PAID (MANUAL) · cycle#1 · ACTIVE · /me/subscription · /me/orders', async () => {
      const [u1, u2, u3] = state.users;
      const opt = (() => {
        // Ekstra: ürünün birimine göre varsayılan çarpan listesinin ilk değeri (Setting extraAmountOptions: kg [0.25,…], "500 g" [1,…], default [1,…])
        const unit = state.extraProduct.unit;
        if (unit === 'kg') return 0.25;
        return 1;
      })();
      const r1 = await admin.must('POST', '/api/v1/admin/subscriptions', { userId: u1.id, tierSlug: state.tierSlug, frequencyWeeks: 1, deliveryDay: 'SALI', deliveryOn: state.T[0], paymentMethodId: u1.pmOk, chargeStrategy: 'MERCHANT_INITIATED', extras: [{ id: state.extraProduct.slug, factor: opt }], note: `e2e ${RUN} MIT` }, [201]);
      assert(r1.subscription.status === 'ACTIVE' && r1.subscription.isOneTime === false && r1.cycle.cycleNo === 1 && r1.cycle.status === 'SCHEDULED', `sub1: ${JSON.stringify({ s: r1.subscription.status, c: r1.cycle.status })}`);
      assert(r1.order.status === 'PAID' && r1.order.orderNo >= 1001 && r1.payment.status === 'SUCCEEDED', `sub1 order/payment: ${JSON.stringify(r1.order)} ${JSON.stringify(r1.payment)}`);
      assert(r1.subscription.discountBoxesLeft === 1, `discountBoxesLeft ${r1.subscription.discountBoxesLeft} (2 → cycle#1'de 1)`);
      u1.subId = r1.subscription.id;
      u1.orderId = r1.order.id;
      u1.orderNo = r1.order.orderNo;
      assert(orderStatus(u1.orderId) === 'PAID', 'sub1 order DB PAID değil');
      assert(paymentsOf(u1.orderId).join(',') === 'CHECKOUT:SUCCEEDED', `sub1 ödemeler: ${paymentsOf(u1.orderId).join(',')}`);
      // Fiyat: ilk kutu %50 + ekstra; kargo 0 (abonelik)
      const extraTotal = Math.round(state.extraProduct.price * opt);
      assert(Math.abs(r1.order.grandTotal - (state.tierPrice / 2 + extraTotal)) < 0.011, `sub1 grandTotal ${r1.order.grandTotal} ≠ ${state.tierPrice / 2 + extraTotal}`);
      // Aynı anda tek abonelik → 409
      const dup = await admin.req('POST', '/api/v1/admin/subscriptions', { userId: u1.id, tierSlug: state.tierSlug, deliveryDay: 'SALI' });
      assert(dup.status === 409 && dup.data?.error === 'SUBSCRIPTION_EXISTS', `ikinci abonelik → ${dup.status} ${JSON.stringify(dup.data).slice(0, 120)}`);

      const r2 = await admin.must('POST', '/api/v1/admin/subscriptions', { userId: u2.id, tierSlug: state.tierSlug, frequencyWeeks: 1, deliveryDay: 'SALI', deliveryOn: state.T[0], chargeStrategy: 'PAYMENT_LINK', note: `e2e ${RUN} LINK` }, [201]);
      assert(r2.subscription.status === 'ACTIVE' && r2.subscription.chargeStrategy === 'PAYMENT_LINK' && r2.subscription.paymentMethodId === null, 'sub2 PAYMENT_LINK/kartsız olmalı');
      u2.subId = r2.subscription.id;
      u2.orderId = r2.order.id;

      const r3 = await admin.must('POST', '/api/v1/admin/subscriptions', { userId: u3.id, tierSlug: state.tierSlug, isOneTime: true, deliveryDay: 'PERSEMBE', deliveryOn: state.R0, paymentMethodId: u3.pmOk, note: `e2e ${RUN} tek seferlik` }, [201]);
      assert(r3.subscription.isOneTime === true && r3.subscription.status === 'ACTIVE' && r3.cycle.status === 'SCHEDULED', 'sub3 tek seferlik ACTIVE olmalı');
      const fee = num(sql(`SELECT fee FROM delivery_zones WHERE id = ${lit(state.zoneId)}`));
      const threshold = sql(`SELECT coalesce("freeThreshold"::text,'') FROM delivery_zones WHERE id = ${lit(state.zoneId)}`);
      const expectedShipping = threshold && state.tierPrice >= num(threshold) ? 0 : fee;
      assert(Math.abs(r3.order.grandTotal - (state.tierPrice + expectedShipping)) < 0.011, `tek seferlik grandTotal ${r3.order.grandTotal} ≠ ${state.tierPrice + expectedShipping} (indirim yok, kargo bölge kuralı)`);
      u3.subId = r3.subscription.id;
      u3.orderId = r3.order.id;
      for (const u of state.users) state.entityIds.add(u.subId);
      const oneTimeCycles = (await subDetail(u3.subId)).cycles;
      assert(oneTimeCycles.length === 1, `tek seferlik cycle sayısı ${oneTimeCycles.length}`);

      // Müşteri görünümü
      const me1 = await customers[0].must('GET', '/api/v1/me/subscription');
      assert(me1 && me1.id === u1.subId && me1.status === 'ACTIVE' && me1.purchased === true && me1.type === 'subscription' && me1.freq === '1hafta' && me1.deliveryDay === 'sali', `me1: ${JSON.stringify(me1).slice(0, 200)}`);
      assert(me1.currentCycle && me1.currentCycle.cycleNo === 1 && me1.currentCycle.deliveryOn === state.T[0] && me1.currentCycle.locked === false, `me1.currentCycle: ${JSON.stringify(me1.currentCycle)}`);
      assert(me1.card && me1.card.last4 === '0001', 'me1.card last4 0001');
      assert(Array.isArray(me1.items) && me1.items.length === 3, `me1.items ${JSON.stringify(me1.items)}`);
      assert(me1.extras.length === 1 && me1.extras[0].id === state.extraProduct.slug, `me1.extras ${JSON.stringify(me1.extras)}`);
      const orders1 = await customers[0].must('GET', '/api/v1/me/orders');
      assert(orders1.total === 1 && orders1.items[0].orderNo === u1.orderNo && orders1.items[0].status === 'PAID' && orders1.items[0].kind === 'SUBSCRIPTION', `me1 orders: ${JSON.stringify(orders1).slice(0, 200)}`);
      const order1 = await customers[0].must('GET', `/api/v1/me/orders/${u1.orderNo}`);
      assert(order1.lines.some((l) => l.kind === 'BOX') && order1.lines.some((l) => l.kind === 'EXTRA'), 'sipariş satırları BOX + EXTRA');
      const me3 = await customers[2].must('GET', '/api/v1/me/subscription');
      assert(me3 && me3.type === 'onetime' && me3.isOneTime === true, `me3 onetime: ${JSON.stringify(me3).slice(0, 120)}`);
      // Admin liste
      const list = await admin.must('GET', `/api/v1/admin/subscriptions?q=${encodeURIComponent(u1.email)}`);
      assert(list.total === 1 && list.items[0].id === u1.subId && list.items[0].status === 'ACTIVE', 'admin liste');
      const adminOrders = await admin.must('GET', `/api/v1/admin/orders?q=${encodeURIComponent(u1.email)}`);
      assert(adminOrders.total >= 1, 'admin orders listesi');
      return `sub1 #${u1.orderNo} ${r1.order.grandTotal} TL · sub2 LINK · sub3 tek seferlik ${r3.order.grandTotal} TL`;
    });

    await step('c job: cycles:ensure (ufuk 8 hafta, idempotent) · delivery-dates:generate · reminders:cutoff (T1 kesiminden 24 s önce)', async () => {
      const ensure = await job('cycles:ensure');
      const d1 = await subDetail(state.users[0].subId);
      assert(d1.cycles.length >= 6, `ensure sonrası cycle sayısı ${d1.cycles.length} (ufuk 8 hafta)`);
      assert(d1.cycles.every((c, i) => c.cycleNo === i + 1), 'cycleNo ardışık');
      assert(d1.cycles.every((c) => c.status === 'SCHEDULED'), 'hepsi SCHEDULED');
      assert(d1.cycles[1].deliveryOn === state.T[1] && d1.cycles[2].deliveryOn === state.T[2], `teslimat günleri ${d1.cycles.map((c) => c.deliveryOn).join(',')}`);
      assert(d1.cycles.every((c) => c.items.filter((i) => i.source === 'TEMPLATE').length === 3), 'her cycle 3 TEMPLATE öğesi');
      const again = await job('cycles:ensure');
      assert((again.details?.created ?? 0) === 0, `ikinci ensure created=${again.details?.created}`);
      const gen = await job('delivery-dates:generate');
      const remind = await job('reminders:cutoff', new Date(cutoffOf(state.T[1]).getTime() - 23.5 * 3_600_000));
      assert(remind.itemsProcessed >= 2, `reminders:cutoff itemsProcessed ${remind.itemsProcessed} (≥2: müşteri 1 ve 2)`);
      const d3 = await subDetail(state.users[2].subId);
      assert(d3.cycles.length === 1, 'tek seferlik: ensure yeni cycle üretmez');
      return `ensure created=${ensure.details?.created ?? 0} (toplam ${d1.cycles.length}) · generate ${JSON.stringify(gen.details).slice(0, 80)} · remind ${remind.itemsProcessed}`;
    });

    await step('d T0 kesimi: lock-and-charge → cycle#1 CHARGED (peşin 0 TL) · /admin/cycles · pick/packing listeleri · ops PREPARING → OUT_FOR_DELIVERY → DELIVERED (Order aynı)', async () => {
      const [u1, u2] = state.users;
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.T[0]), 1));
      assert((r.details?.chargedZero ?? 0) >= 2, `chargedZero ${r.details?.chargedZero}`);
      const d1 = await subDetail(u1.subId);
      const c1 = cycleByNo(d1, 1);
      assert(c1.status === 'CHARGED' && c1.prepaidAmount > 0 && c1.deltaOrderId === null, `c1 ${c1.status} delta=${c1.deltaOrderId}`);
      assert(Math.abs(num(c1.total) - c1.prepaidAmount) < 0.011, `c1 total ${c1.total} ≠ prepaid ${c1.prepaidAmount}`);
      assert(orderStatus(u1.orderId) === 'PAID', 'checkout Order değişmez (PAID)');
      const d2 = await subDetail(u2.subId);
      assert(cycleByNo(d2, 1).status === 'CHARGED', 'sub2 c1 CHARGED');
      const list = await admin.must('GET', `/api/v1/admin/cycles?date=${state.T[0]}&zone=${ZONE_SLUG}`);
      assert(list.some((c) => c.id === c1.id && c.userEmail === u1.email), 'admin/cycles listesi c1');
      const pick = await admin.must('GET', `/api/v1/admin/ops/pick-list?date=${state.T[0]}&zone=${ZONE_SLUG}`);
      assert(Array.isArray(pick) && pick.length >= 3 && pick.every((p) => p.totalQty > 0), `pick-list ${pick.length} satır`);
      assert(pick.some((p) => p.productSlug === state.extraProduct.slug && p.extraCount >= 1), 'pick-list ekstra satırı');
      const packing = await admin.must('GET', `/api/v1/admin/ops/packing-list?date=${state.T[0]}&zone=${ZONE_SLUG}`);
      assert(packing.some((p) => p.cycleId === c1.id && p.orderNo === u1.orderNo), 'packing-list c1 fişi');
      // Ops akışı (sub1 + sub2 cycle#1)
      await deliver(c1.id);
      await deliver(cycleByNo(d2, 1).id);
      assert(cycleByNo(await subDetail(u1.subId), 1).status === 'DELIVERED', 'c1 DELIVERED');
      assert(orderStatus(u1.orderId) === 'DELIVERED', 'Order DELIVERED');
      const me1 = await customers[0].must('GET', '/api/v1/me/subscription');
      assert(me1.currentCycle?.cycleNo === 2 && me1.inFlightCycle === null, `me1 açık cycle #2: ${JSON.stringify({ cur: me1.currentCycle?.cycleNo, inflight: me1.inFlightCycle })}`);
      return `lock ${JSON.stringify(r.details)} · pick ${pick.length} satır · packing ${packing.length} fiş`;
    });

    await step('e R0 kesimi: tek seferlik → CHARGED (0 TL, DELTA yok) → teslim → Subscription COMPLETED → /me/subscription null', async () => {
      const u3 = state.users[2];
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.R0), 1));
      assert((r.details?.chargedZero ?? 0) >= 1, `chargedZero ${r.details?.chargedZero}`);
      const d3 = await subDetail(u3.subId);
      const c = cycleByNo(d3, 1);
      assert(c.status === 'CHARGED' && num(c.shippingFee) >= 0 && c.deltaOrderId === null, `tek seferlik c1 ${c.status}`);
      await deliver(c.id);
      const after = await subDetail(u3.subId);
      assert(after.status === 'COMPLETED' && after.completedAt, `sub3 ${after.status}`);
      assert(orderStatus(u3.orderId) === 'DELIVERED', 'tek seferlik Order DELIVERED');
      const me3 = await customers[2].req('GET', '/api/v1/me/subscription');
      assert(me3.status === 200 && me3.data === null, `me3 → ${me3.status} ${JSON.stringify(me3.data)}`);
      assert(after.events.some((e) => e.type === 'COMPLETED'), 'COMPLETED olayı');
      return `sub3 COMPLETED · events ${after.events.map((e) => e.type).join(',')}`;
    });

    await step('f müşteri 1: cycle#2 atla (USER, DD −1) → geri al (hak iade, DD +1) · T1 kesimi: MIT → CHARGED + Order PAID + Payment CYCLE_CHARGE', async () => {
      const u1 = state.users[0];
      const c = customers[0];
      const before = await subDetail(u1.subId);
      const c2 = cycleByNo(before, 2);
      const reservedBefore = reservedOf(c2.deliveryDateId);
      const skipped = await c.must('POST', '/api/v1/me/subscription/cycles/current/skip');
      assert(skipped.skipThisWeek === true && skipped.skipUsed === true && skipped.currentCycle?.cycleNo === 2 && skipped.currentCycle?.status === 'SKIPPED', `skip: ${JSON.stringify(skipped.currentCycle)}`);
      assert(reservedOf(c2.deliveryDateId) === reservedBefore - 1, 'atlamada DD rezervi iade edilmeli');
      const again = await c.req('POST', '/api/v1/me/subscription/cycles/current/skip');
      assert(again.status === 409 && again.data?.error === 'CYCLE_NOT_EDITABLE', `ikinci skip → ${again.status} ${again.data?.error}`);
      const restored = await c.must('DELETE', '/api/v1/me/subscription/cycles/current/skip');
      assert(restored.skipThisWeek === false && restored.skipUsed === false, 'unskip hak iade');
      assert(reservedOf(c2.deliveryDateId) === reservedBefore, 'geri almada DD yeniden rezerv');
      // T1 kesimi
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.T[1]), 1));
      assert((r.details?.charged ?? 0) >= 1, `charged ${r.details?.charged}`);
      const d1 = await subDetail(u1.subId);
      const c2b = cycleByNo(d1, 2);
      assert(c2b.status === 'CHARGED' && c2b.orderId && num(c2b.discount) === state.tierPrice / 2, `c2 ${c2b.status} discount ${c2b.discount} (ilk 2 kutu %50)`);
      assert(orderStatus(c2b.orderId) === 'PAID', 'c2 Order PAID');
      assert(paymentsOf(c2b.orderId).join(',') === 'CYCLE_CHARGE:SUCCEEDED', `c2 ödemeler ${paymentsOf(c2b.orderId).join(',')}`);
      assert(d1.discountBoxesLeft === 0, `discountBoxesLeft ${d1.discountBoxesLeft}`);
      const orders = await c.must('GET', '/api/v1/me/orders');
      assert(orders.total === 2, `me orders ${orders.total}`);
      const me = await c.must('GET', '/api/v1/me/subscription');
      assert(me.inFlightCycle?.cycleNo === 2 && me.inFlightCycle?.status === 'CHARGED' && me.currentCycle?.cycleNo === 3, `me1 inFlight/current: ${JSON.stringify({ i: me.inFlightCycle?.cycleNo, c: me.currentCycle?.cycleNo })}`);
      return `c2 CHARGED ${c2b.total} TL (indirim ${c2b.discount}) · sipariş #${sql(`SELECT "orderNo" FROM orders WHERE id = ${lit(c2b.orderId)}`)}`;
    });

    await step('g müşteri 2 (PAYMENT_LINK): T1 AWAITING_PAYMENT + GET /pay/:token → expire → UNPAID (link EXPIRED) → retry yeni link → 08:00 sınırı → SKIPPED(UNPAID) · iptal: teklif → kabul → teklifsiz talep → onay → CANCELLED', async () => {
      const u2 = state.users[1];
      const c = customers[1];
      let d2 = await subDetail(u2.subId);
      let c2 = cycleByNo(d2, 2);
      assert(c2.status === 'AWAITING_PAYMENT' && c2.paymentDueAt, `sub2 c2 ${c2.status}`);
      const lockedAt = new Date(c2.lockedAt);
      const tokenRow = sql(`SELECT "linkToken" || E'\\t' || status || E'\\t' || kind FROM payments WHERE "orderId" = ${lit(c2.orderId)} ORDER BY "createdAt" LIMIT 1`);
      const [token, pStatus, pKind] = tokenRow.split('\t');
      assert(/^[0-9a-f]{32}$/.test(token) && pStatus === 'PENDING' && pKind === 'LINK', `link ödemesi: ${tokenRow}`);
      const pay = await fetch(`${API}/api/v1/pay/${token}`);
      assert(pay.status === 200, `GET /pay → ${pay.status}`);
      const payBody = await pay.json();
      assert(payBody.status === 'PENDING' && payBody.expired === false && payBody.amount === num(c2.total), `pay: ${JSON.stringify(payBody)}`);
      const me = await c.must('GET', '/api/v1/me/subscription');
      assert(me.inFlightCycle?.status === 'AWAITING_PAYMENT' && String(me.inFlightCycle?.paymentLinkUrl).includes(`/api/v1/pay/${token}`), `me2 inFlight: ${JSON.stringify(me.inFlightCycle)}`);
      // Link süresi 1 saat → expire
      const exp0 = await job('cycles:expire-payment-links', plusMin(lockedAt, 30));
      assert((exp0.details?.expired ?? 0) === 0, 'süresi dolmadan expire etmemeli');
      const exp = await job('cycles:expire-payment-links', plusMin(lockedAt, 62));
      assert((exp.details?.expired ?? 0) >= 1, `expired ${exp.details?.expired}`);
      d2 = await subDetail(u2.subId);
      c2 = cycleByNo(d2, 2);
      assert(c2.status === 'UNPAID' && c2.retryCount === 0 && c2.nextRetryAt, `c2 ${c2.status} retry=${c2.retryCount}`);
      assert(orderStatus(c2.orderId) === 'PAYMENT_FAILED', 'Order PAYMENT_FAILED');
      assert(sql(`SELECT status FROM payments WHERE "linkToken" = ${lit(token)}`) === 'EXPIRED', 'link ödemesi EXPIRED');
      const payAfter = await (await fetch(`${API}/api/v1/pay/${token}`)).json();
      assert(payAfter.expired === true, 'pay expired=true');
      // Dunning (LINK): +2 s → yeni link
      const retry1 = await job('payments:retry', plusMin(lockedAt, 122));
      assert((retry1.details?.linksIssued ?? 0) >= 1, `linksIssued ${retry1.details?.linksIssued}`);
      d2 = await subDetail(u2.subId);
      c2 = cycleByNo(d2, 2);
      assert(c2.status === 'UNPAID' && c2.retryCount === 1, `retry sonrası ${c2.status} retry=${c2.retryCount}`);
      assert(num(sql(`SELECT count(*) FROM payments WHERE "orderId" = ${lit(c2.orderId)} AND kind = 'LINK' AND status = 'PENDING'`)) === 1, 'yeni açık link 1');
      // Admin yeniden link gönderir (yeni deneme numarası, çakışma yok)
      const sent = await admin.must('POST', `/api/v1/admin/cycles/${c2.id}/send-payment-link`, undefined, [200]);
      assert(/^[0-9a-f]{32}$/.test(sent.linkToken), 'admin link token');
      assert(num(sql(`SELECT count(*) FROM payments WHERE "orderId" = ${lit(c2.orderId)} AND kind = 'LINK'`)) === 3, '3 link ödemesi (ilk + retry + admin)');
      // 08:00 sınırı (teslimat günü) → SKIPPED(UNPAID), Order CANCELLED, failedCycles 1
      const retry2 = await job('payments:retry', plusMin(at(state.T[1], '08:00'), 5));
      assert((retry2.details?.skippedUnpaid ?? 0) >= 1, `skippedUnpaid ${retry2.details?.skippedUnpaid} ${JSON.stringify(retry2.details)}`);
      d2 = await subDetail(u2.subId);
      c2 = cycleByNo(d2, 2);
      assert(c2.status === 'SKIPPED' && c2.skipSource === 'UNPAID', `c2 ${c2.status}/${c2.skipSource}`);
      assert(orderStatus(c2.orderId) === 'CANCELLED', 'Order CANCELLED');
      assert(d2.failedCycles === 1 && d2.status === 'ACTIVE', `sub2 failedCycles ${d2.failedCycles} ${d2.status}`);
      assert(num(sql(`SELECT count(*) FROM payments WHERE "orderId" = ${lit(c2.orderId)} AND status IN ('PENDING','REQUIRES_3DS')`)) === 0, 'açık link kalmadı');
      // İptal akışı
      const req1 = await c.must('POST', '/api/v1/me/subscription/cancel', { reason: 'PRICE', note: 'e2e' });
      assert(req1.offer && req1.offer.pct === 50 && req1.offer.boxes === 1, `teklif ${JSON.stringify(req1)}`);
      let me2 = await c.must('GET', '/api/v1/me/subscription');
      assert(me2.status === 'CANCEL_REQUESTED' && me2.cancellation?.retentionOffered === true, `me2 ${me2.status}`);
      const accepted = await c.must('POST', '/api/v1/me/subscription/retention/accept');
      assert(accepted.status === 'ACTIVE' && accepted.nextBoxDiscount === true, `kabul: ${accepted.status} ${accepted.nextBoxDiscount}`);
      const req2 = await c.must('POST', '/api/v1/me/subscription/cancel', { reason: 'OTHER' });
      assert(req2.offer === null, 'ikinci talepte teklif yok (üye başına 1)');
      const scheduledBefore = (await subDetail(u2.subId)).cycles.filter((x) => x.status === 'SCHEDULED');
      assert(scheduledBefore.length >= 1, 'iptal öncesi SCHEDULED cycle var');
      const ddReserved = reservedOf(scheduledBefore[0].deliveryDateId);
      const confirmed = await c.must('POST', '/api/v1/me/subscription/cancel/confirm');
      assert(confirmed.status === 'CANCELLED' && confirmed.cancellation.outcome === 'CANCELLED' && confirmed.cancellation.effectiveAt, `confirm: ${JSON.stringify(confirmed).slice(0, 200)}`);
      me2 = await c.req('GET', '/api/v1/me/subscription');
      assert(me2.status === 200 && me2.data === null, 'iptal sonrası me2 null');
      d2 = await subDetail(u2.subId);
      assert(d2.status === 'CANCELLED' && d2.cycles.filter((x) => x.cycleNo > 2).every((x) => x.status === 'CANCELLED'), `sub2 ${d2.status}; cycles ${d2.cycles.map((x) => x.cycleNo + ':' + x.status).join(' ')}`);
      assert(reservedOf(scheduledBefore[0].deliveryDateId) === ddReserved - 1, 'iptalde SCHEDULED cycle DD iadesi');
      assert(d2.cancellations.length === 2 && d2.cancellations.some((x) => x.outcome === 'RETENTION_ACCEPTED') && d2.cancellations.some((x) => x.outcome === 'CANCELLED'), `cancellations ${d2.cancellations.map((x) => x.outcome).join(',')}`);
      return `c2 SKIPPED(UNPAID) · sub2 CANCELLED effectiveAt=${confirmed.cancellation.effectiveAt}`;
    });

    await step('h müşteri 1: kart fail: → T2 UNPAID (+2 s fail, +12 s fail → SKIPPED(UNPAID)) · T3 aynı → PAST_DUE · kart düzelt → T4 CHARGED → ACTIVE (failedCycles 0)', async () => {
      const u1 = state.users[0];
      const c = customers[0];
      const patched = await c.must('PATCH', '/api/v1/me/subscription', { paymentMethodId: u1.pmFail });
      assert(patched.card?.last4 === '0002', `kart ${JSON.stringify(patched.card)}`);
      const failWeek = async (T, cycleNo) => {
        const lockAt = plusMin(cutoffOf(T), 1);
        const r = await job('cycles:lock-and-charge', lockAt);
        assert((r.details?.unpaid ?? 0) >= 1, `T${cycleNo} unpaid ${JSON.stringify(r.details)}`);
        let d = await subDetail(u1.subId);
        let cyc = cycleByNo(d, cycleNo);
        assert(cyc.status === 'UNPAID' && cyc.retryCount === 0 && new Date(cyc.nextRetryAt).getTime() === plusMin(lockAt, 120).getTime(), `c${cycleNo} ${cyc.status} retry=${cyc.retryCount} next=${cyc.nextRetryAt}`);
        assert(orderStatus(cyc.orderId) === 'PAYMENT_FAILED', `c${cycleNo} Order PAYMENT_FAILED`);
        const me = await c.must('GET', '/api/v1/me/subscription');
        assert(me.dunning?.active === true, `dunning bayrağı ${JSON.stringify(me.dunning)}`);
        const early = await job('payments:retry', plusMin(lockAt, 60));
        assert(early.itemsProcessed === 0, 'erken retry işlemez');
        const r1 = await job('payments:retry', plusMin(lockAt, 122));
        assert((r1.details?.failed ?? 0) >= 1, `retry1 ${JSON.stringify(r1.details)}`);
        d = await subDetail(u1.subId);
        cyc = cycleByNo(d, cycleNo);
        assert(cyc.status === 'UNPAID' && cyc.retryCount === 1, `retry1 sonrası ${cyc.status}/${cyc.retryCount}`);
        const r2 = await job('payments:retry', plusMin(lockAt, 12 * 60 + 2));
        assert((r2.details?.skippedUnpaid ?? 0) >= 1, `retry2 ${JSON.stringify(r2.details)}`);
        d = await subDetail(u1.subId);
        cyc = cycleByNo(d, cycleNo);
        assert(cyc.status === 'SKIPPED' && cyc.skipSource === 'UNPAID', `c${cycleNo} ${cyc.status}/${cyc.skipSource}`);
        assert(orderStatus(cyc.orderId) === 'CANCELLED', `c${cycleNo} Order CANCELLED`);
        assert(paymentsOf(cyc.orderId).join(',') === 'CYCLE_CHARGE:FAILED,RETRY:FAILED,RETRY:FAILED', `c${cycleNo} ödemeler ${paymentsOf(cyc.orderId).join(',')}`);
        return d;
      };
      let d = await failWeek(state.T[2], 3);
      assert(d.failedCycles === 1 && d.status === 'ACTIVE', `T2 sonrası failedCycles ${d.failedCycles} ${d.status}`);
      d = await failWeek(state.T[3], 4);
      assert(d.failedCycles === 2 && d.status === 'PAST_DUE', `T3 sonrası failedCycles ${d.failedCycles} ${d.status}`);
      let me = await c.must('GET', '/api/v1/me/subscription');
      assert(me.status === 'PAST_DUE' && me.dunning?.active === true, `me1 ${me.status}`);
      assert(d.cycles.some((x) => x.cycleNo === 5 && x.status === 'SCHEDULED'), 'motor PAST_DUE\'de durmaz: cycle#5 SCHEDULED');
      // Kart düzelt → T4 tahsilat → ACTIVE
      const fixed = await c.must('PATCH', '/api/v1/me/subscription', { paymentMethodId: u1.pmOk });
      assert(fixed.card?.last4 === '0001', 'kart geri');
      const r = await job('cycles:lock-and-charge', plusMin(cutoffOf(state.T[4]), 1));
      assert((r.details?.charged ?? 0) >= 1, `T4 charged ${JSON.stringify(r.details)}`);
      d = await subDetail(u1.subId);
      const c5 = cycleByNo(d, 5);
      assert(c5.status === 'CHARGED' && orderStatus(c5.orderId) === 'PAID', `c5 ${c5.status}`);
      assert(d.status === 'ACTIVE' && d.failedCycles === 0, `sub1 ${d.status} failedCycles ${d.failedCycles}`);
      me = await c.must('GET', '/api/v1/me/subscription');
      assert(me.status === 'ACTIVE' && me.dunning === null, `me1 ${me.status} dunning ${JSON.stringify(me.dunning)}`);
      const unpaidEvents = d.events.filter((e) => e.type === 'UNPAID');
      assert(unpaidEvents.length === 2 && unpaidEvents.some((e) => e.data?.pastDue === true), `UNPAID olayları ${unpaidEvents.length}`);
      return `c3/c4 SKIPPED(UNPAID) → PAST_DUE → c5 CHARGED → ACTIVE`;
    });

    await step('i müşteri 1 iptal: teklif (ilk kez) → onay → CANCELLED; SCHEDULED cycle\'lar iptal + DD iade; kilitli/teslim edilmiş cycle\'lar korunur · CronLog · admin jobs listesi', async () => {
      const u1 = state.users[0];
      const c = customers[0];
      const before = await subDetail(u1.subId);
      const scheduled = before.cycles.filter((x) => x.status === 'SCHEDULED');
      assert(scheduled.length >= 1, 'SCHEDULED cycle var');
      const reservedBefore = scheduled.map((x) => [x.deliveryDateId, reservedOf(x.deliveryDateId)]);
      const req = await c.must('POST', '/api/v1/me/subscription/cancel', { reason: 'DELIVERY_DAYS' });
      assert(req.offer && req.offer.pct === 50, 'ilk talepte teklif');
      const confirmed = await c.must('POST', '/api/v1/me/subscription/cancel/confirm');
      assert(confirmed.status === 'CANCELLED' && confirmed.cancellation.refundAmount === 0, `confirm ${JSON.stringify(confirmed.cancellation).slice(0, 200)}`);
      const after = await subDetail(u1.subId);
      assert(after.status === 'CANCELLED' && after.cancelledAt && after.nextDeliveryOn === null, `sub1 ${after.status}`);
      assert(after.cycles.filter((x) => x.status === 'SCHEDULED').length === 0, 'SCHEDULED kalmadı');
      assert(cycleByNo(after, 1).status === 'DELIVERED' && cycleByNo(after, 2).status === 'CHARGED' && cycleByNo(after, 5).status === 'CHARGED', 'teslim edilmiş/kilitli cycle\'lar korunur');
      for (const [ddId, r0] of reservedBefore) assert(reservedOf(ddId) === r0 - 1, `DD ${ddId} iade`);
      const me = await c.req('GET', '/api/v1/me/subscription');
      assert(me.status === 200 && me.data === null, 'me1 null');
      // CronLog + jobs listesi
      const runs = await admin.must('GET', '/api/v1/admin/jobs/runs?limit=200');
      const ours = runs.filter((r) => state.cronLogIds.includes(r.cronLogId));
      assert(ours.length === state.cronLogIds.length && ours.every((r) => r.status === 'SUCCESS'), `CronLog ${ours.length}/${state.cronLogIds.length}`);
      const jobs = await admin.must('GET', '/api/v1/admin/jobs');
      assert(jobs.length === 6 && jobs.every((j) => j.lastRun), 'jobs listesi son koşular');
      // Üretim dışı `now` ezmesi: biçimsiz → 400
      const bad = await admin.req('POST', '/api/v1/admin/jobs/cycles:ensure/run', { now: 'dün' });
      assert(bad.status === 400, `biçimsiz now → ${bad.status}`);
      // Audit: subscriptions/jobs modülleri
      const auditN = num(sql(`SELECT count(*) FROM audit_logs WHERE module IN ('subscriptions','jobs') AND "createdAt" >= ${lit(startedAt.toISOString())}`));
      assert(auditN >= 10, `audit satırları ${auditN}`);
      return `sub1 CANCELLED · CronLog ${ours.length} koşu SUCCESS · audit ${auditN}`;
    });
  } catch (err) {
    failed = true;
    log(`HATA: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  }

  // ---- temizlik ------------------------------------------------------------------------------
  if (!KEEP) {
    await step('z temizlik: test verisi (kullanıcı/abonelik/cycle/sipariş/ödeme/kart/adres/consent/mail/audit/cron/system_logs/şablon) · delivery_dates.reserved geri · ayarlar geri → sayımlar ≡ başlangıç', async () => {
      const problems = [];
      const tryDo = (label, fn) => {
        try {
          fn();
        } catch (e) {
          problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      if (admin.cookies.size === 0) await admin.loginAdmin();
      // Ayarlar geri
      if (state.settings.changed) {
        try {
          await admin.must('PUT', '/api/v1/admin/settings/commerce', { dunning: state.settings.dunning, paymentLinkHours: state.settings.paymentLinkHours });
        } catch (e) {
          problems.push(`ayarlar: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const emails = [0, 1, 2].map((i) => `e2e-f7-${RUN}-${i + 1}@example.com`);
      const userIds = sqlLines(`SELECT id FROM users WHERE email IN (${inList(emails)})`);
      if (userIds.length) {
        const U = inList(userIds);
        const subIds = sqlLines(`SELECT id FROM subscriptions WHERE "userId" IN (${U})`);
        const S = subIds.length ? inList(subIds) : "''";
        const orderIds = sqlLines(`SELECT id FROM orders WHERE "userId" IN (${U}) OR "subscriptionId" IN (${S})`);
        const O = orderIds.length ? inList(orderIds) : "''";
        const cycleIds = sqlLines(`SELECT id FROM subscription_cycles WHERE "subscriptionId" IN (${S})`);
        for (const id of [...subIds, ...orderIds, ...cycleIds]) state.entityIds.add(id);
        // Önizleme dosyaları (register mailleri)
        for (const e of sqlLines(`SELECT error FROM mail_logs WHERE ("entityId" IN (${U}) OR "to" IN (${inList(emails)})) AND error LIKE 'preview:%'`)) {
          const f = e.slice('preview:'.length).trim();
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
        tryDo('mail_logs', () => sql(`DELETE FROM mail_logs WHERE "entityId" IN (${U}) OR "to" IN (${inList(emails)})`));
        tryDo('users', () => sql(`DELETE FROM users WHERE id IN (${U})`));
      }
      // Audit (bu koşu): aktör müşteri ya da varlık bizim; admin'in bu koşudaki subscriptions/jobs/settings/catalog(şablon) kayıtları
      const since = lit(new Date(startedAt.getTime() - 5_000).toISOString());
      const ids = [...state.entityIds, ...state.cronLogIds, ...state.templateIds];
      tryDo('audit_logs', () => sql(`DELETE FROM audit_logs WHERE "createdAt" >= ${since} AND (${userIds.length ? `"actorId" IN (${inList(userIds)}) OR ` : ''}"entityId" IN (${ids.length ? inList(ids) : "''"}) OR module IN ('subscriptions','jobs') OR (module = 'settings' AND "entityId" = 'commerce') OR (module = 'catalog' AND "createdAt" >= ${since} AND "entityId" IN (${state.templateIds.length ? inList(state.templateIds) : "''"})))`));
      // CronLog + SystemLog (motor uyarıları)
      if (state.cronLogIds.length) tryDo('cron_logs', () => sql(`DELETE FROM cron_logs WHERE id IN (${inList(state.cronLogIds)})`));
      tryDo('system_logs', () => sql(`DELETE FROM system_logs WHERE module = 'subscriptions' AND "lastSeenAt" >= ${since} AND (fingerprint LIKE ${lit(`ensure:no-template:${state.tierId}:%`)} OR fingerprint LIKE 'ensure:day-full:%')`));
      // Şablonlar (bizim oluşturduklarımız)
      if (state.templateIds.length) {
        tryDo('box_template_items', () => sql(`DELETE FROM box_template_items WHERE "templateId" IN (${inList(state.templateIds)})`));
        tryDo('box_templates', () => sql(`DELETE FROM box_templates WHERE id IN (${inList(state.templateIds)})`));
      }
      // DeliveryDate: rezerv geri + koşuda üretilen referanssız tarihler silinir
      for (const [id, reserved] of state.ddBaseline) tryDo(`dd ${id}`, () => sql(`UPDATE delivery_dates SET reserved = ${reserved} WHERE id = ${lit(id)} AND reserved <> ${reserved}`));
      tryDo('delivery_dates(new)', () =>
        sql(
          `DELETE FROM delivery_dates d WHERE ${state.ddAllBefore.size ? `d.id NOT IN (${inList([...state.ddAllBefore])})` : 'true'} AND NOT EXISTS (SELECT 1 FROM subscription_cycles c WHERE c."deliveryDateId" = d.id) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."deliveryDateId" = d.id)`,
        ),
      );
      if (problems.length) throw new Error(`temizlik sorunları: ${problems.join(' · ')}`);
      const after = {
        users: num(sql('SELECT count(*) FROM users')),
        subscriptions: num(sql('SELECT count(*) FROM subscriptions')),
        cycles: num(sql('SELECT count(*) FROM subscription_cycles')),
        orders: num(sql('SELECT count(*) FROM orders')),
        payments: num(sql('SELECT count(*) FROM payments')),
        paymentMethods: num(sql('SELECT count(*) FROM payment_methods')),
        cronLogs: num(sql('SELECT count(*) FROM cron_logs')),
        templates: num(sql('SELECT count(*) FROM box_templates')),
        deliveryDates: num(sql('SELECT count(*) FROM delivery_dates')),
        reservedUrla: num(sql(`SELECT coalesce(sum(reserved),0) FROM delivery_dates d JOIN delivery_zones z ON z.id = d."zoneId" WHERE z.slug = ${lit(ZONE_SLUG)}`)),
      };
      const diffs = Object.keys(state.counts ?? {}).filter((k) => state.counts[k] !== after[k]).map((k) => `${k} ${state.counts[k]}→${after[k]}`);
      assert(diffs.length === 0, `sayımlar başlangıçtan farklı: ${diffs.join(', ')}`);
      const commerce = await admin.must('GET', '/api/v1/admin/settings/commerce');
      const dunning = commerce.fields.find((f) => f.key === 'dunning')?.value;
      assert(JSON.stringify(dunning) === JSON.stringify(state.settings.dunning), `dunning geri alınmadı: ${JSON.stringify(dunning)}`);
      return `users=${after.users} subs=${after.subscriptions} cycles=${after.cycles} orders=${after.orders} payments=${after.payments} cron=${after.cronLogs} templates=${after.templates} dd=${after.deliveryDates} reservedUrla=${after.reservedUrla} · ayarlar geri`;
    }).catch(() => {
      failed = true;
    });
    try {
      await admin.req('POST', '/api/v1/auth/logout');
    } catch {
      /* önemsiz */
    }
  } else {
    log('--keep: test verisi silinmedi, ayarlar geri alınmadı');
  }

  // ---- rapor --------------------------------------------------------------------------------
  const lines = [
    '# e2e F7 raporu — abonelik motoru (API düzeyi simülasyon)',
    '',
    `- Tarih: ${startedAt.toISOString()} · API: ${API} · run: ${RUN} · takvim: T0=${state.T[0] ?? '-'} … T4=${state.T[4] ?? '-'} · R0=${state.R0 ?? '-'}`,
    `- Sonuç: ${failed ? 'HATA' : 'TÜM ADIMLAR OK'} (${results.filter((r) => r.ok).length}/${results.length})`,
    '',
    '| Adım | Durum | Süre | Not |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? 'OK' : 'FAIL'} | ${r.ms} ms | ${String(r.note).replace(/\|/g, '\\|')} |`),
    '',
    'Zaman job\'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — yalnız geliştirme/test; üretimde 403). Müşteri uçları gerçek saatle; kesimler gelecekte. Ayarlar (commerce.dunning [2,12], paymentLinkHours 1) koşu süresince değiştirildi ve geri alındı. Sırlar çıktıya yazılmaz (SEED_ADMIN_*, DATABASE_URL apps/api/.env).',
    '',
  ];
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[e2e-f7] beklenmeyen hata:', err);
  process.exit(1);
});
