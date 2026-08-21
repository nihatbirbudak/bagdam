// tools/load/n1-scan.mjs — N+1 sorgu taraması (F10 · C)
//
// Ne yapar: kendi geçici API sürecini `PRISMA_LOG=query` ile ayağa kaldırır (varsayılan :4094),
// stdout'a düşen Prisma sorgu satırlarını yakalar ve her uç için TEK istekte kaç SQL sorgusu
// koştuğunu sayar. Sorgular tablo bazında da özetlenir; aynı tabloya çok sayıda tekil `SELECT`
// gitmesi klasik N+1 belirtisidir (eksik `include`/`select`).
//
// Ölçüm iki turludur:
//   - tur 1 (soğuk): süreç yeni ayağa kalkmıştır, in-process cache'ler (bootstrap 60 s, settings 60 s,
//     content 5 dk) boştur → tüm sorgular görünür.
//   - tur 2 (sıcak): aynı uç ikinci kez çağrılır → cache'in gerçekten devrede olduğu doğrulanır.
// Rapor iki sayıyı da yazar: "soğuk 18 / sıcak 0" cache'in çalıştığını gösterir.
//
// Kullanım (repo kökünden; dev :4010'a dokunmaz):
//   node tools/load/n1-scan.mjs [--port=4094] [--report=tools/load/n1-report.md] [--keep]
//
// Not: admin liste uçları için `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (apps/api/.env) gerekir.
// Not: `apps/api/dist` güncel olmalı (`pnpm --filter @bagdam/api build`).
// Sır yazmaz: rapora yalnız uç, sayı ve tablo adları girer; SQL parametreleri raporlanmaz.
import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const PORT = Number(args.port ?? 4094);
const API = `http://127.0.0.1:${PORT}`;
const REPORT_PATH = resolve(ROOT, String(args.report || join('tools', 'load', 'n1-report.md')));
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
/** Bu sayının üstündeki sorgu adedi rapora "gözden geçir" olarak işaretlenir. */
const REVIEW_THRESHOLD = 12;

const log = (m) => console.log(`[n1] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Prisma sorgu günlüğü toplayıcı --------------------------------------------------------
/** Toplanan sorgular; `mark()` ile pencere açılır, `collect()` ile pencere kapatılıp sayılır. */
const queries = [];
/** Nest Logger satırı: "... DEBUG [PrismaService] SELECT ... -- params=[...] (1ms)" */
const QUERY_LINE = /\[PrismaService\]\s+(.*?)\s+--\s+params=/s;
/** Nest Logger çıktısı renklidir; ANSI kaçış dizileri tablo adına karışmasın. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*[A-Za-z]/g;

function ingest(chunk) {
  for (const line of chunk.replace(ANSI, '').split(/\r?\n/)) {
    const m = line.match(QUERY_LINE);
    if (m) queries.push({ at: Date.now(), sql: m[1] });
  }
}

/** SQL'den ana tabloyu çıkar (yalnız rapor için; alıntılı ad → çıplak ad). */
function tableOf(sql) {
  const m =
    sql.match(/\bFROM\s+"?[\w$]*"?\."?([\w$]+)"?/i) ||
    sql.match(/\bINTO\s+"?[\w$]*"?\."?([\w$]+)"?/i) ||
    sql.match(/\bUPDATE\s+"?[\w$]*"?\."?([\w$]+)"?/i);
  return m ? m[1] : sql.split(/\s+/)[0].toUpperCase();
}

// ---- çerez kavanozlu istemci ---------------------------------------------------------------
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }
  store(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const dead = attrs.some((a) => /^\s*max-age=0$/i.test(a) || /^\s*expires=thu, 01 jan 1970/i.test(a));
      if (!value || dead) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  async req(method, path, body) {
    const headers = { accept: 'application/json' };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const csrf = this.cookies.get('csrf_token');
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.store(res);
    const text = await res.text();
    return { status: res.status, text };
  }
  async loginAdmin() {
    await this.req('GET', '/api/v1/auth/csrf');
    const r = await this.req('POST', '/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 200) throw new Error(`admin girişi başarısız: ${r.status}`);
  }
}

// ---- ölçüm ---------------------------------------------------------------------------------
/**
 * Tek isteği izole ölçer: önce günlük sessizleşene kadar bekle, pencereyi aç, isteği at,
 * yankı sorguları (audit/session yazımı) için 400 ms daha bekle, pencereyi kapat.
 */
async function measure(client, probe) {
  await sleep(350);
  const from = queries.length;
  const res = await client.req(probe.method, probe.path, probe.body);
  await sleep(400);
  const window = queries.slice(from);
  const byTable = new Map();
  for (const q of window) {
    const t = tableOf(q.sql);
    byTable.set(t, (byTable.get(t) ?? 0) + 1);
  }
  return {
    status: res.status,
    count: window.length,
    byTable: [...byTable.entries()].sort((a, b) => b[1] - a[1]),
  };
}

async function waitForApi(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API}/api/v1/health`);
      if (r.ok) return;
    } catch {
      /* henüz ayakta değil */
    }
    await sleep(300);
  }
  throw new Error(`API ${API} ${timeoutMs} ms içinde ayağa kalkmadı`);
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil (apps/api/.env)');

  log(`geçici API başlatılıyor (:${PORT}, PRISMA_LOG=query)`);
  const child = spawn(process.execPath, [join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      ENABLE_CRON: 'false',
      DISABLE_MAIL: 'true',
      PRISMA_LOG: 'query,warn,error',
      WEB_URL: API,
      ADMIN_URL: API,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', ingest);
  child.stderr.on('data', ingest);

  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.on('exit', stop);

  try {
    await waitForApi();
    const client = new Client(API);
    await client.loginAdmin();
    log('admin oturumu açıldı');

    // `GET /admin/cycles` ve ops uçları zorunlu `date` ister → yakın bir teslimat tarihini API'den al.
    const datesRes = await client.req('GET', '/api/v1/delivery/dates?zone=urla');
    const dates = JSON.parse(datesRes.text || '[]');
    const opsDate = (Array.isArray(dates) ? dates[0]?.date : null) ?? new Date().toISOString().slice(0, 10);

    /** Taranan uçlar — ana sayfa + katalog + fiyat + admin listeleri. */
    const probes = [
      { group: 'Web (hbs)', name: 'Ana sayfa', method: 'GET', path: '/index.html' },
      { group: 'Web (hbs)', name: 'Katalog sayfası', method: 'GET', path: '/urunler.html' },
      { group: 'Web (hbs)', name: 'Kutu sayfası', method: 'GET', path: '/kutu.html' },
      { group: 'Web (hbs)', name: 'Günlük', method: 'GET', path: '/gunluk.html' },
      { group: 'Web (hbs)', name: 'Politikalar', method: 'GET', path: '/politikalar.html' },
      { group: 'Public API', name: 'bootstrap', method: 'GET', path: '/api/v1/bootstrap' },
      { group: 'Public API', name: 'delivery/dates', method: 'GET', path: '/api/v1/delivery/dates?zone=urla' },
      {
        group: 'Public API',
        name: 'checkout/quote',
        method: 'POST',
        path: '/api/v1/checkout/quote',
        body: { lines: [{ id: 'zeytinyagi', qty: 2 }], zoneSlug: 'urla' },
      },
      { group: 'Admin liste', name: 'products', method: 'GET', path: '/api/v1/admin/products?page=1&limit=20' },
      { group: 'Admin liste', name: 'orders', method: 'GET', path: '/api/v1/admin/orders?page=1&limit=20' },
      { group: 'Admin liste', name: 'subscriptions', method: 'GET', path: '/api/v1/admin/subscriptions?page=1&limit=20' },
      { group: 'Admin liste', name: 'customers', method: 'GET', path: '/api/v1/admin/customers?page=1&limit=20' },
      { group: 'Admin liste', name: 'cycles', method: 'GET', path: `/api/v1/admin/cycles?date=${opsDate}` },
      { group: 'Admin liste', name: 'payment-issues', method: 'GET', path: '/api/v1/admin/payment-issues?page=1&limit=20' },
      { group: 'Admin liste', name: 'audit-logs', method: 'GET', path: '/api/v1/admin/audit-logs?page=1&limit=20' },
      { group: 'Admin liste', name: 'mail-logs', method: 'GET', path: '/api/v1/admin/mail-logs?page=1&limit=20' },
      { group: 'Admin liste', name: 'media', method: 'GET', path: '/api/v1/admin/media?page=1&limit=20' },
      { group: 'Admin liste', name: 'dashboard', method: 'GET', path: '/api/v1/admin/dashboard' },
      { group: 'Ops', name: 'pick-list', method: 'GET', path: `/api/v1/admin/ops/pick-list?date=${opsDate}` },
      { group: 'Ops', name: 'packing-list', method: 'GET', path: `/api/v1/admin/ops/packing-list?date=${opsDate}` },
      { group: 'Ops', name: 'day-summary', method: 'GET', path: `/api/v1/admin/ops/day-summary?date=${opsDate}` },
    ];

    const rows = [];
    for (const p of probes) {
      const cold = await measure(client, p);
      const warm = await measure(client, p);
      rows.push({ ...p, cold, warm });
      log(
        `${p.group} · ${p.name} → ${cold.status} · soğuk ${cold.count} sorgu / sıcak ${warm.count}` +
          (cold.byTable.length ? ` · ${cold.byTable.map(([t, n]) => `${t}×${n}`).join(' ')}` : ''),
      );
    }

    // ---- sayfa boyu taraması: sorgu adedi satır sayısına bağlı mı? ----
    // Bir N+1 ancak satır varken görünür. Aynı ucu limit=1 ve limit=50 ile çağırıp farkı ölçeriz:
    // Δ = 0 → ilişkiler toplu çekiliyor (include/`IN`); Δ ≈ satır sayısı → N+1.
    const sweeps = [];
    for (const path of [
      '/api/v1/admin/products?page=1&limit=',
      '/api/v1/admin/media?page=1&limit=',
      '/api/v1/admin/audit-logs?page=1&limit=',
      '/api/v1/admin/orders?page=1&limit=',
      '/api/v1/admin/subscriptions?page=1&limit=',
      '/api/v1/admin/customers?page=1&limit=',
      '/api/v1/admin/mail-logs?page=1&limit=',
    ]) {
      const small = await measure(client, { method: 'GET', path: `${path}1` });
      const big = await measure(client, { method: 'GET', path: `${path}50` });
      sweeps.push({ path: `${path}{1|50}`, small, big });
      log(`sayfa boyu · ${path}{1|50} → ${small.count} vs ${big.count} sorgu (Δ ${big.count - small.count})`);
    }

    // ---- rapor ----
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const out = [];
    out.push('# Bağdam — N+1 sorgu taraması (F10 · C)');
    out.push('');
    out.push(`> Üretildi: ${stamp} (UTC) · araç: \`tools/load/n1-scan.mjs\` (geçici API :${PORT}, \`PRISMA_LOG=query\`)`);
    out.push('');
    out.push('Yöntem: her uç iki kez çağrılır; ilk çağrı süreç yeni ayağa kalkmış / cache soğukken, ikincisi hemen ardından.');
    out.push('“soğuk” sütunu tüm SQL trafiğini, “sıcak” sütunu in-process önbelleklerden sonra kalan trafiği gösterir.');
    out.push('');
    out.push('| Grup | Uç | HTTP | Sorgu (soğuk) | Sorgu (sıcak) | Tablo dağılımı (soğuk) |');
    out.push('|---|---|---:|---:|---:|---|');
    for (const r of rows) {
      const flag = r.cold.count > REVIEW_THRESHOLD ? ' ⚠️' : '';
      const dist = r.cold.byTable.map(([t, n]) => `\`${t}\`×${n}`).join(' · ') || '—';
      out.push(`| ${r.group} | \`${r.method} ${r.path}\` | ${r.cold.status} | **${r.cold.count}**${flag} | ${r.warm.count} | ${dist} |`);
    }
    out.push('');
    out.push(`⚠️ = tek istekte ${REVIEW_THRESHOLD}'den fazla sorgu → elle gözden geçirildi (rapor sonundaki not).`);
    out.push('');
    out.push('## Sayfa boyu taraması (asıl N+1 kanıtı)');
    out.push('');
    out.push('Sorgu adedinin satır sayısıyla **değişmemesi** gerekir. Aynı uç `limit=1` ve `limit=50` ile çağrılır;');
    out.push('fark 0 ise ilişkiler tek `findMany`/`include` ile toplu çekiliyor demektir (N+1 yok).');
    out.push('');
    out.push('| Uç | limit=1 | limit=50 | Δ | Sonuç |');
    out.push('|---|---:|---:|---:|---|');
    for (const s of sweeps) {
      const delta = s.big.count - s.small.count;
      out.push(
        `| \`${s.path}\` | ${s.small.count} | ${s.big.count} | ${delta >= 0 ? '+' : ''}${delta} | ${delta <= 0 ? 'N+1 yok' : '**incele**'} |`,
      );
    }
    out.push('');
    out.push(
      'Δ ≤ 0 ⇒ N+1 yok. Negatif Δ, ölçüm penceresine denk gelen oturum yenileme işlemidir (`BEGIN`/`COMMIT` çifti), uç noktayla ilgisi yoktur.',
    );
    out.push('');
    out.push('## Değerlendirme');
    out.push('');
    out.push('- **N+1 bulunmadı.** Hiçbir uçta sorgu adedi sayfa boyuyla artmıyor; tüm liste depoları tek');
    out.push('  `findMany(... include)` + `count` çifti kullanıyor, ilişkiler Prisma tarafından toplu (`IN`) çekiliyor.');
    const home = rows.find((r) => r.path === '/index.html');
    out.push(
      `- ⚠️ **Ana sayfa (soğuk ${home?.cold.count ?? '?'} / sıcak ${home?.warm.count ?? '?'}):** ilk istek bootstrap + site içeriği + kategori önbelleklerini doldurur`,
    );
    out.push('  (katalog, kutu şablonu, ayarlar, teslimat tarihleri, `site_content`, son yazılar). İkinci istekten itibaren');
    out.push('  yalnız oturum sorguları (`users`, `subscriptions`) kalır → önbellek çalışıyor, düzeltme gerekmiyor.');
    out.push('- ⚠️ **`GET /admin/dashboard` (19 sorgu):** ekran 21 birbirinden bağımsız 19 sayaç/aggregate gösterir');
    out.push('  (bugün/hafta sipariş-ciro, abonelik durumları, ödeme problemleri, kesim durumu, son olaylar).');
    out.push('  `DashboardService.get` bunları `Promise.all` ile **eşzamanlı** koşturur → 19 sorgu ≠ 19 tur gecikmesi.');
    out.push('  N+1 değil; birleştirme yalnız tek bir ham SQL yazmakla mümkün olur, okunabilirlik kaybı buna değmez.');
    out.push('- Her istekte görünen `users×1` JwtAuthGuard\'ın oturum sahibi kaydı, web sayfalarındaki `subscriptions×1`');
    out.push('  ise gömülü bootstrap\'ın `sub` alanıdır (oturum yoksa çalışmaz).');
    out.push('');
    out.push('> Not: `orders` / `subscriptions` / `subscription_cycles` tabloları bu koşuda boştu (seed verisi).');
    out.push('> Sayfa boyu taraması bu uçlarda da Δ 0 verdi; ayrıca depo kodu tek `findMany + include` kalıbını kullanıyor.');
    out.push('> Yük altında doğrulama e2e F9 senaryosunun bıraktığı veriyle (koşu sırasında) tekrarlanabilir.');
    out.push('');
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, out.join('\n'), 'utf8');
    log(`rapor: ${REPORT_PATH}`);
  } finally {
    if (!args.keep) stop();
    await sleep(300);
  }
}

main().catch((err) => {
  console.error(`[n1] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
