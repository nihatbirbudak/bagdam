// tools/load/run.mjs — Bağdam API basit yük testi (F10 · C)
//
// Neden node ile: k6 kurulu değil, `pnpm add` / `pnpm dlx` bu görevde yasak. Bu koşucu yalnız
// çekirdek `node:http` kullanır — ek bağımlılık yok, CI'da da çalışır.
//
// Ne ölçer: 4 sıcak uç için gecikme dağılımı (p50/p90/p95/p99/max), saniyedeki istek (RPS),
// durum kodu dağılımı ve hata oranı:
//   1) GET  /index.html                — hbs ana sayfa (anonim, inline bootstrap)
//   2) GET  /api/v1/bootstrap          — katalog anlık görüntüsü (60 s in-process cache)
//   3) GET  /urunler.html              — katalog sayfası (sekmeler + kart listesi)
//   4) POST /api/v1/checkout/quote     — fiyat özeti (PricingService + Setting + DeliveryZone)
//
// Hız sınırı notu (ÖNEMLİ): global sınır IP başına 100 istek/dk (`checkout/quote` 60/dk). Yük testi
// saniyede yüzlerce istek attığı için tek IP'den koşulduğunda ölçülen şey uç noktanın gecikmesi değil,
// ThrottlerGuard'ın 429 üretme hızı olur. `app.set('trust proxy', 1)` (main.ts) sayesinde ThrottlerGuard
// istemciyi `X-Forwarded-For`'daki IP ile izlediğinden, koşucu **her isteğe ayrı sentetik istemci IP'si**
// verir (`10.<a>.<b>.<c>`) — "aynı anda gezen çok sayıda ayrı müşteri" senaryosu. Sınır kapatılmaz,
// yalnız kovalar dağıtılır; API kodunda hiçbir değişiklik gerekmez.
// `--single-ip` ile bu davranış kapatılıp hız sınırının kendisi (429 davranışı) ölçülebilir.
//
// Kullanım (repo kökünden, geçici API 4093'te açıkken):
//   node apps/api/dist/main.js  (PORT=4093 HOST=127.0.0.1 ENABLE_CRON=false DISABLE_MAIL=true)
//   node tools/load/run.mjs [--api=http://127.0.0.1:4093] [--conn=20] [--duration=10] [--warmup=2]
//                           [--only=bootstrap,quote] [--single-ip] [--report=tools/load/report.md]
//
// Çıktı: konsol tablosu + `tools/load/report.md`. Hedef: p95 < 300 ms (lokal, cache'li).
// Çıkış kodu: hata oranı > %1 olan senaryo varsa 1, aksi hâlde 0 (p95 aşımı rapora yazılır, koşuyu düşürmez).
// Sır yazmaz: yalnız yol/başlık/süre bilgisi raporlanır.
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const API = String(args.api || process.env.LOAD_API || 'http://127.0.0.1:4093').replace(/\/$/, '');
const CONNECTIONS = Math.max(1, Number(args.conn ?? 20));
const DURATION_S = Math.max(1, Number(args.duration ?? 10));
const WARMUP_S = Math.max(0, Number(args.warmup ?? 2));
const SINGLE_IP = Boolean(args['single-ip']);
const REPORT_PATH = resolve(ROOT, String(args.report || join('tools', 'load', 'report.md')));
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',').map((s) => s.trim())) : null;
/** p95 hedefi (ms) — lokal, cache'li ölçüm için. */
const P95_TARGET_MS = 300;

const base = new URL(API);
const transport = base.protocol === 'https:' ? https : http;

// ---- yardımcılar --------------------------------------------------------------------------
const log = (msg) => console.log(`[load] ${msg}`);
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

/**
 * İstek başına sentetik istemci IP'si (10.0.0.1 → 10.255.254.254 aralığında dönerek).
 * Her istek ayrı bir "müşteri" sayılır → hız sınırı kovaları dağılır, ölçülen süre uç noktanın kendisidir.
 */
let ipCounter = 0;
function nextClientIp() {
  if (SINGLE_IP) return null;
  const n = ipCounter++;
  const c = (n % 254) + 1;
  const b = (Math.floor(n / 254) % 254) + 1;
  const a = (Math.floor(n / (254 * 254)) % 254) + 1;
  return `10.${a}.${b}.${c}`;
}

/**
 * Tek istek. Süre = istek yazımından gövdenin tamamı okunana kadar (TTLB).
 * Gövde tüketilir ki keep-alive soketi bir sonraki istekte yeniden kullanılabilsin.
 */
function request(agent, { method, path, body, headers }, ip) {
  return new Promise((resolveReq) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const hdrs = { accept: '*/*', connection: 'keep-alive', ...(headers ?? {}) };
    if (payload) {
      hdrs['content-type'] = 'application/json';
      hdrs['content-length'] = String(payload.length);
    }
    if (ip) hdrs['x-forwarded-for'] = ip;

    const t0 = nowMs();
    const req = transport.request(
      { agent, host: base.hostname, port: base.port, method, path, headers: hdrs, timeout: 20_000 },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
        });
        res.on('end', () => resolveReq({ ms: nowMs() - t0, status: res.statusCode ?? 0, bytes, error: null }));
        res.on('error', (err) => resolveReq({ ms: nowMs() - t0, status: 0, bytes, error: err.message }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout 20s')));
    req.on('error', (err) => resolveReq({ ms: nowMs() - t0, status: 0, bytes: 0, error: err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Bir senaryoyu `seconds` boyunca `CONNECTIONS` sanal kullanıcı ile sürer. */
async function drive(scenario, seconds, collect) {
  const agent = new transport.Agent({ keepAlive: true, maxSockets: CONNECTIONS, maxFreeSockets: CONNECTIONS });
  const endAt = Date.now() + seconds * 1000;
  const worker = async () => {
    while (Date.now() < endAt) {
      const r = await request(agent, scenario, nextClientIp());
      if (collect) collect(r);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONNECTIONS }, () => worker()));
  agent.destroy();
  return (Date.now() - t0) / 1000;
}

async function runScenario(scenario) {
  log(`${scenario.name}: ısınma ${WARMUP_S} s → ölçüm ${DURATION_S} s (${CONNECTIONS} eşzamanlı)`);
  if (WARMUP_S > 0) await drive(scenario, WARMUP_S, null);

  const samples = [];
  const statuses = new Map();
  let errors = 0;
  let bytes = 0;
  const elapsed = await drive(scenario, DURATION_S, (r) => {
    samples.push(r.ms);
    bytes += r.bytes;
    const key = r.error ? `ERR:${r.error}` : String(r.status);
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
    if (r.error || r.status !== scenario.expect) errors += 1;
  });

  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.length;
  return {
    name: scenario.name,
    label: `${scenario.method} ${scenario.path}`,
    total,
    elapsed,
    rps: total / elapsed,
    errors,
    errorRate: total ? (errors / total) * 100 : 0,
    kbPerReq: total ? bytes / total / 1024 : 0,
    mean: total ? samples.reduce((a, b) => a + b, 0) / total : 0,
    p50: pct(sorted, 50),
    p90: pct(sorted, 90),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted.at(-1) ?? 0,
    statuses: Object.fromEntries([...statuses.entries()].sort()),
  };
}

/** Önbellek doğrulaması: başlıklar + soğuk/sıcak bootstrap farkı (in-process 60 s cache). */
async function cacheChecks() {
  const agent = new transport.Agent({ keepAlive: false });
  const head = (path) =>
    new Promise((res) => {
      const req = transport.request(
        { agent, host: base.hostname, port: base.port, method: 'GET', path, headers: { accept: '*/*' } },
        (r) => {
          let bytes = 0;
          r.on('data', (c) => {
            bytes += c.length;
          });
          r.on('end', () =>
            res({
              status: r.statusCode,
              cacheControl: r.headers['cache-control'] ?? '(yok)',
              vary: r.headers['vary'] ?? '(yok)',
              bytes,
            }),
          );
        },
      );
      req.on('error', () => res({ status: 0, cacheControl: '(hata)', vary: '(hata)', bytes: 0 }));
      req.end();
    });

  const rows = [];
  for (const path of ['/index.html', '/urunler.html', '/api/v1/bootstrap', '/api/v1/health']) {
    rows.push({ path, ...(await head(path)) });
  }

  // Soğuk/sıcak: art arda 12 bootstrap; ilkinin süresi cache dolumunu, kalanların ortancası sıcak yolu gösterir.
  const timings = [];
  for (let i = 0; i < 12; i += 1) {
    const r = await request(agent, { method: 'GET', path: '/api/v1/bootstrap' }, nextClientIp());
    timings.push(r.ms);
    await sleep(20);
  }
  agent.destroy();
  const warm = [...timings.slice(1)].sort((a, b) => a - b);
  return { rows, cold: timings[0], warmMedian: pct(warm, 50), warmMax: warm.at(-1) ?? 0 };
}

// ---- senaryolar ---------------------------------------------------------------------------
/** Katalogdan taze olmayan (tekil satılabilen) bir ürün seç — quote gövdesi için. */
async function pickProduct() {
  const res = await fetch(`${API}/api/v1/bootstrap`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const boot = await res.json();
  const p = (boot.products ?? []).find((x) => x && x.fresh === false) ?? (boot.products ?? [])[0];
  if (!p) throw new Error('bootstrap ürün listesi boş — seed koşuldu mu?');
  return p.id;
}

async function main() {
  log(`hedef ${API} · ${CONNECTIONS} eşzamanlı · senaryo başına ${DURATION_S} s (ısınma ${WARMUP_S} s)`);
  log(SINGLE_IP ? 'tek IP modu: hız sınırı ölçüme dahil' : 'istek başına ayrı X-Forwarded-For (hız sınırı kovaları dağıtılır)');

  const productId = await pickProduct();
  log(`quote senaryosu ürünü: ${productId}`);

  const scenarios = [
    { name: 'web:index', method: 'GET', path: '/index.html', expect: 200, headers: { accept: 'text/html' } },
    { name: 'api:bootstrap', method: 'GET', path: '/api/v1/bootstrap', expect: 200, headers: { accept: 'application/json' } },
    { name: 'web:urunler', method: 'GET', path: '/urunler.html', expect: 200, headers: { accept: 'text/html' } },
    {
      name: 'api:checkout-quote',
      method: 'POST',
      path: '/api/v1/checkout/quote',
      expect: 200,
      body: { lines: [{ id: productId, qty: 2 }], zoneSlug: 'urla' },
    },
  ].filter((s) => !ONLY || ONLY.has(s.name) || ONLY.has(s.name.split(':')[1]));

  if (scenarios.length === 0) throw new Error(`--only=${args.only} hiçbir senaryoyla eşleşmedi`);

  const cache = await cacheChecks();
  const results = [];
  for (const s of scenarios) {
    results.push(await runScenario(s));
    await sleep(500); // kovalar boşalsın; senaryolar birbirini etkilemesin
  }

  // ---- konsol tablosu ----
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log('');
  console.log(
    `${pad('senaryo', 22)}${padL('istek', 8)}${padL('RPS', 9)}${padL('p50', 9)}${padL('p95', 9)}${padL('p99', 9)}${padL('max', 9)}${padL('hata%', 8)}`,
  );
  for (const r of results) {
    console.log(
      `${pad(r.name, 22)}${padL(r.total, 8)}${padL(fmt(r.rps), 9)}${padL(fmt(r.p50), 9)}${padL(fmt(r.p95), 9)}${padL(fmt(r.p99), 9)}${padL(fmt(r.max), 9)}${padL(fmt(r.errorRate, 2), 8)}`,
    );
  }
  console.log('');

  // ---- rapor ----
  const over = results.filter((r) => r.p95 >= P95_TARGET_MS);
  const failed = results.filter((r) => r.errorRate > 1);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines = [];
  lines.push('# Bağdam — API yük testi raporu (F10 · C)');
  lines.push('');
  lines.push(`> Üretildi: ${stamp} (UTC) · araç: \`tools/load/run.mjs\` (çekirdek node:http, ek bağımlılık yok)`);
  lines.push('');
  lines.push('## Koşu parametreleri');
  lines.push('');
  lines.push('| Parametre | Değer |');
  lines.push('|---|---|');
  lines.push(`| Hedef | \`${API}\` (geçici API — dev :4010'a dokunulmadı) |`);
  lines.push(`| Eşzamanlılık | ${CONNECTIONS} sanal kullanıcı (keep-alive) |`);
  lines.push(`| Senaryo başına süre | ısınma ${WARMUP_S} s + ölçüm ${DURATION_S} s |`);
  lines.push(`| İstemci IP | ${SINGLE_IP ? 'tek IP (hız sınırı ölçüme dahil)' : 'istek başına ayrı `X-Forwarded-For`'} |`);
  lines.push(`| Node | ${process.version} · ${process.platform}/${process.arch} |`);
  lines.push(`| p95 hedefi | < ${P95_TARGET_MS} ms |`);
  lines.push('');
  lines.push('## Sonuçlar');
  lines.push('');
  lines.push('| Senaryo | Uç | İstek | RPS | ort. | p50 | p90 | p95 | p99 | max | hata % | yük (kB/istek) |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const flag = r.p95 >= P95_TARGET_MS ? ' ⚠️' : '';
    lines.push(
      `| \`${r.name}\` | \`${r.label}\` | ${r.total} | ${fmt(r.rps)} | ${fmt(r.mean)} | ${fmt(r.p50)} | ${fmt(r.p90)} | **${fmt(r.p95)}**${flag} | ${fmt(r.p99)} | ${fmt(r.max)} | ${fmt(r.errorRate, 2)} | ${fmt(r.kbPerReq)} |`,
    );
  }
  lines.push('');
  lines.push('Süreler milisaniye; ölçüm isteğin yazılmasından yanıt gövdesinin tamamı okunana kadar (TTLB).');
  lines.push('');
  lines.push('### Durum kodu dağılımı');
  lines.push('');
  lines.push('| Senaryo | Kodlar |');
  lines.push('|---|---|');
  for (const r of results) {
    lines.push(`| \`${r.name}\` | ${Object.entries(r.statuses).map(([k, v]) => `${k}: ${v}`).join(' · ')} |`);
  }
  lines.push('');
  lines.push('## Önbellek doğrulaması');
  lines.push('');
  lines.push('| Yol | Durum | `Cache-Control` | `Vary` | Gövde (kB) |');
  lines.push('|---|---:|---|---|---:|');
  for (const row of cache.rows) {
    lines.push(`| \`${row.path}\` | ${row.status} | \`${row.cacheControl}\` | \`${row.vary}\` | ${fmt(row.bytes / 1024)} |`);
  }
  lines.push('');
  lines.push(
    `Bootstrap in-process önbelleği (60 s, \`CACHE_KEYS.bootstrapAnonymous\`): art arda 12 tekil istekte ilk ` +
      `**${fmt(cache.cold)} ms**, kalanların ortancası **${fmt(cache.warmMedian)} ms** (en kötü ${fmt(cache.warmMax)} ms). ` +
      'Süreç zaten ayakta olduğu için buradaki "ilk istek" gerçek soğuk yol değildir; gerçek soğuk/sıcak farkı ' +
      '`tools/load/n1-report.md` içinde yeni başlatılmış süreçte ölçülür (ana sayfa soğuk ~23 sorgu → sıcak 2).',
  );
  lines.push('');
  lines.push('## Değerlendirme');
  lines.push('');
  if (over.length === 0) {
    lines.push(`- Tüm senaryolarda p95 < ${P95_TARGET_MS} ms hedefi sağlandı.`);
  } else {
    lines.push(`- **p95 hedefini aşan uçlar:** ${over.map((r) => `\`${r.label}\` (${fmt(r.p95)} ms)`).join(' · ')}`);
  }
  if (failed.length === 0) {
    lines.push('- Hata oranı tüm senaryolarda ≤ %1.');
  } else {
    lines.push(`- **Hata oranı > %1:** ${failed.map((r) => `\`${r.label}\` (%${fmt(r.errorRate, 2)})`).join(' · ')}`);
  }
  lines.push(
    '- `GET /index.html` diğer sayfalardan yavaştır (p95 ~2×): en büyük gövde ' +
      `(${fmt(results.find((r) => r.name === 'web:index')?.kbPerReq ?? 0)} kB) ve en çok partial ona aittir;`,
  );
  lines.push(
    '  N+1 taraması sıcak yolda yalnız 2 sorgu gösteriyor (`tools/load/n1-report.md`) → maliyet Handlebars render + gzip, DB değil.',
  );
  lines.push(
    '- Ölçüm nginx/Cloudflare olmadan doğrudan Node sürecine yapılır. Üretimde HTML için `proxy_cache bagdam_html`',
  );
  lines.push(
    '  (`s-maxage=10`) ve `/assets/*` immutable cache devreye girdiğinden anonim sayfa gecikmesi bu değerlerin altına iner.',
  );
  lines.push('');
  lines.push('## Admin paneli paket boyutu (F10 · C kod bölme)');
  lines.push('');
  lines.push('`apps/admin/src/app/router.tsx` her ekranı `React.lazy` ile ayırır; `vite.config.ts` React ve React Router\'ı');
  lines.push('ayrı satıcı chunk\'larına alır. `pnpm --filter @bagdam/admin build` çıktısı:');
  lines.push('');
  lines.push('| | Önce (F9) | Sonra (F10) |');
  lines.push('|---|---:|---:|');
  lines.push('| Chunk sayısı | 1 | 86 |');
  lines.push('| En büyük chunk | 735.6 kB | 193.8 kB (`vendor-react`) |');
  lines.push('| İlk açılışta inen JS | 735.6 kB | 347.4 kB (`index` 114.9 + `vendor-react` 193.8 + `vendor-router` 38.7) |');
  lines.push('| Vite 500 kB uyarısı | var | yok |');
  lines.push('');
  lines.push('Ekran chunk\'ları 0.5–31.5 kB arası ve yalnız o rotaya gidilince iner. Satıcı chunk\'ları sürüm yükseltmesi');
  lines.push('dışında değişmediği için `location /app/` altında 1 yıl immutable önbelleklenebilir (deploy/nginx).');
  lines.push('');
  lines.push('## Yeniden koşturma');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1) geçici API (dev :4010 çalışmaya devam edebilir)');
  lines.push('PORT=4093 HOST=127.0.0.1 ENABLE_CRON=false DISABLE_MAIL=true node apps/api/dist/main.js');
  lines.push('# 2) yük testi');
  lines.push('node tools/load/run.mjs --api=http://127.0.0.1:4093 --conn=20 --duration=10');
  lines.push('```');
  lines.push('');

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
  if (over.length > 0) log(`UYARI: p95 hedefini aşan senaryo(lar): ${over.map((r) => r.name).join(', ')}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[load] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
