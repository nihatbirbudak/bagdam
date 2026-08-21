// tools/backup-restore-drill.mjs — yedek/restore provası (F10 · C)
//
// Neden: `deploy/scripts/backup-bagdam.sh` Linux sunucu script'i, lokalde koşturulamaz. Bu araç aynı
// zinciri Windows/lokal PostgreSQL üzerinde uçtan uca prova eder — yedeğin gerçekten geri yüklenebildiği
// ancak restore denenerek bilinir (ADR-0015: aylık restore provası).
//
// Adımlar:
//   1) `bagdam_dev` tablo sayımları (SALT OKUMA — kaynak DB'ye hiçbir şey yazılmaz)
//   2) `pg_dump -Fc` → `<tmp>/bagdam-drill-<damga>.dump`
//   3) `pg_restore --list` bütünlük kontrolü (üretim script'inin yaptığı kontrolün aynısı)
//   4) `bagdam_restore_test` veritabanı oluşturulur (varsa önce düşürülür)
//   5) `pg_restore --no-owner --no-privileges` ile geri yüklenir
//   6) Sayım karşılaştırması: 16 çekirdek tablo + tüm tablolar + `_prisma_migrations` + citext eklentisi
//   7) `bagdam_restore_test` düşürülür, dump dosyası silinir (`--keep` ile saklanır)
//   8) Rapor: `tools/backup-restore-report.md` (süreler + boyut → RTO tahmini)
//
// GÜVENLİK: hedef DB adı sabittir (`bagdam_restore_test`) ve `bagdam_dev`/`bagdam_db`/`bagdam_staging`
// olamaz; script bunu her adımda doğrular. Kaynak DB'ye yalnız `SELECT` gider.
//
// Kullanım (repo kökünden):
//   node tools/backup-restore-drill.mjs [--source=bagdam_dev] [--target=bagdam_restore_test]
//                                       [--pg-bin=C:/tools/pgsql/bin] [--keep] [--report=...]
//
// Gereksinim: `pg_dump` / `pg_restore` / `psql` (PATH'te ya da `--pg-bin` / `PG_BIN`; Windows'ta
// yaygın kurulum yolları otomatik taranır). Hedef DB `psql -c "CREATE|DROP DATABASE"` ile yönetilir.
// Sır yazmaz: parola yalnız `PGPASSWORD` env'i ile alt sürece geçer, rapora/konsola yazılmaz.
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
loadEnv({ path: join(ROOT, 'apps', 'api', '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const TARGET_DB = String(args.target || 'bagdam_restore_test');
const KEEP = Boolean(args.keep);
const REPORT_PATH = resolve(ROOT, String(args.report || join('tools', 'backup-restore-report.md')));

/** Asla restore hedefi olamayacak veritabanları — yanlışlıkla üzerine yazmayı imkânsız kıl. */
const FORBIDDEN_TARGETS = new Set(['bagdam_dev', 'bagdam_test', 'bagdam_db', 'bagdam_staging', 'postgres', 'template1']);
if (FORBIDDEN_TARGETS.has(TARGET_DB)) {
  console.error(`[drill] HEDEF YASAK: "${TARGET_DB}" restore hedefi olamaz (kaynak/üretim veritabanı).`);
  process.exit(2);
}

/** e2e koşularının kullandığı 16 çekirdek tablo (ticaret + abonelik + bildirim). */
const CORE_TABLES = [
  'users', 'addresses', 'consents', 'subscriptions', 'subscription_cycles', 'cycle_items', 'subscription_events',
  'subscription_cancellations', 'orders', 'order_lines', 'payments', 'payment_methods', 'mail_logs', 'box_templates',
  'box_template_items', 'delivery_dates',
];

// ---- bağlantı ----------------------------------------------------------------------------
/** DATABASE_URL'i libpq'nun anlayacağı parçalara ayır (Prisma'ya özgü sorgu parametreleri atılır). */
function parseDbUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL tanımlı değil (apps/api/.env)');
  const u = new URL(raw);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}
const conn = parseDbUrl(process.env.DATABASE_URL);
const SOURCE_DB = String(args.source || conn.database);
if (SOURCE_DB === TARGET_DB) throw new Error('kaynak ve hedef aynı olamaz');

// ---- PostgreSQL ikilileri ------------------------------------------------------------------
const PG_BIN = String(args['pg-bin'] || process.env.PG_BIN || '');
/** Windows'ta yaygın kurulum yolları — PATH'te yoksa buradan bulunur. */
const PG_BIN_CANDIDATES = [
  PG_BIN,
  'C:/tools/pgsql/bin',
  ...['18', '17', '16', '15', '14'].flatMap((v) => [
    `C:/Program Files/PostgreSQL/${v}/bin`,
    `C:/Program Files (x86)/PostgreSQL/${v}/bin`,
  ]),
].filter(Boolean);

function resolveBinary(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of PG_BIN_CANDIDATES) {
    const p = join(dir, exe);
    if (existsSync(p)) return p;
  }
  return name; // PATH'e bırak
}
// createdb/dropdb yerine `psql -c "CREATE|DROP DATABASE"` kullanılır: daha az ikili, Windows'ta
// spawn hatalarına daha dayanıklı ve hedef adı her seferinde aynı güvenlik kontrolünden geçer.
const BIN = {
  pg_dump: resolveBinary('pg_dump'),
  pg_restore: resolveBinary('pg_restore'),
  psql: resolveBinary('psql'),
};

const childEnv = { ...process.env, PGPASSWORD: conn.password, PGCLIENTENCODING: 'UTF8' };
const baseArgs = ['-h', conn.host, '-p', conn.port, '-U', conn.user];

const log = (m) => console.log(`[drill] ${m}`);
function run(bin, argv, opts = {}) {
  return execFileSync(bin, argv, {
    env: childEnv,
    encoding: opts.encoding ?? 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}
/** `psql -A -t` ile tek satırlık sonuç (SALT OKUMA sorguları için). */
function query(db, sql) {
  return run(BIN.psql, [...baseArgs, '-d', db, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', sql]).trim();
}

/** Tüm public tabloların gerçek satır sayısı (istatistik değil — `count(*)`). */
function tableCounts(db) {
  const sql = `
    select string_agg(format('select %L::text as t, count(*)::bigint as n from public.%I', tablename, tablename), ' union all ')
    from pg_tables where schemaname = 'public'`;
  const union = query(db, sql);
  if (!union) return {};
  const rows = run(BIN.psql, [...baseArgs, '-d', db, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-F', '|', '-c', union]);
  const out = {};
  for (const line of rows.split(/\r?\n/)) {
    const [t, n] = line.split('|');
    if (t) out[t.trim()] = Number(n);
  }
  return out;
}

function dbExists(name) {
  return query('postgres', `select 1 from pg_database where datname = '${name.replace(/'/g, "''")}'`) === '1';
}

function dropTargetIfExists() {
  if (FORBIDDEN_TARGETS.has(TARGET_DB)) throw new Error('güvenlik: yasak hedef');
  if (!dbExists(TARGET_DB)) return false;
  // Açık oturumları kes, sonra düşür (psql/pgAdmin bağlıysa DROP DATABASE takılır).
  query('postgres', `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${TARGET_DB}' and pid <> pg_backend_pid()`);
  query('postgres', `drop database if exists "${TARGET_DB}"`);
  return true;
}

function createTarget() {
  if (FORBIDDEN_TARGETS.has(TARGET_DB)) throw new Error('güvenlik: yasak hedef');
  query('postgres', `create database "${TARGET_DB}" owner "${conn.user}"`);
}

// ---- prova ---------------------------------------------------------------------------------
const steps = [];
function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = fn();
    steps.push({ name, ok: true, ms: Date.now() - t0, note: note ?? '' });
    log(`OK   ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`);
    return note;
  } catch (err) {
    const msg = err instanceof Error ? (err.stderr?.toString?.() || err.message) : String(err);
    steps.push({ name, ok: false, ms: Date.now() - t0, note: msg.slice(0, 500) });
    log(`FAIL ${name} — ${msg.slice(0, 500)}`);
    throw err;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DUMP_PATH = join(tmpdir(), `bagdam-drill-${stamp}.dump`);
let sourceCounts = {};
let restoredCounts = {};
let dumpBytes = 0;
let listEntries = 0;
let sourceVersion = '';
let mismatches = [];
let extensions = '';

function main() {
  log(`kaynak=${SOURCE_DB} · hedef=${TARGET_DB} · ${conn.host}:${conn.port} · pg_dump=${BIN.pg_dump}`);

  step('a) araçlar ve sürüm', () => {
    const dumpV = run(BIN.pg_dump, ['--version']).trim();
    sourceVersion = query(SOURCE_DB, 'select version()').split(' ').slice(0, 2).join(' ');
    return `${dumpV} · sunucu ${sourceVersion}`;
  });

  step('b) kaynak sayımları (salt okuma)', () => {
    sourceCounts = tableCounts(SOURCE_DB);
    extensions = query(SOURCE_DB, "select string_agg(extname, ', ' order by extname) from pg_extension");
    const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
    return `${Object.keys(sourceCounts).length} tablo · ${total} satır · eklentiler: ${extensions}`;
  });

  step('c) pg_dump -Fc', () => {
    run(BIN.pg_dump, [...baseArgs, '-d', SOURCE_DB, '-Fc', '-f', DUMP_PATH]);
    dumpBytes = statSync(DUMP_PATH).size;
    // Yalnız dosya adı raporlanır: mutlak yol kullanıcı adını taşır, rapora girmesine gerek yok.
    return `${(dumpBytes / 1024 / 1024).toFixed(2)} MB → <tmp>/${DUMP_PATH.split(/[\\/]/).pop()}`;
  });

  step('d) pg_restore --list (bütünlük)', () => {
    const list = run(BIN.pg_restore, ['--list', DUMP_PATH]);
    listEntries = list.split(/\r?\n/).filter((l) => l && !l.startsWith(';')).length;
    if (listEntries === 0) throw new Error('dump içeriği boş görünüyor');
    return `${listEntries} arşiv girdisi okundu`;
  });

  step('e) hedef veritabanı hazırlığı', () => {
    const dropped = dropTargetIfExists();
    createTarget();
    return dropped ? `${TARGET_DB} önce düşürüldü, yeniden oluşturuldu` : `${TARGET_DB} oluşturuldu`;
  });

  step('f) pg_restore', () => {
    // --no-owner/--no-privileges: lokal rol farkları restore'u düşürmesin (sunucuda da aynı bayraklar kullanılır).
    // pg_restore uyarıları (rol/GRANT) stderr'e düşer ama exit 0 verir; exit != 0 ise execFileSync fırlatır.
    run(BIN.pg_restore, [...baseArgs, '-d', TARGET_DB, '--no-owner', '--no-privileges', DUMP_PATH]);
    return 'geri yükleme tamam';
  });

  step('g) sayım karşılaştırması', () => {
    restoredCounts = tableCounts(TARGET_DB);
    const names = new Set([...Object.keys(sourceCounts), ...Object.keys(restoredCounts)]);
    mismatches = [...names]
      .filter((t) => (sourceCounts[t] ?? -1) !== (restoredCounts[t] ?? -1))
      .map((t) => ({ table: t, source: sourceCounts[t] ?? '(yok)', restored: restoredCounts[t] ?? '(yok)' }));
    if (mismatches.length > 0) throw new Error(`sayım farkı: ${mismatches.map((m) => `${m.table} ${m.source}≠${m.restored}`).join(', ')}`);
    const missingCore = CORE_TABLES.filter((t) => !(t in restoredCounts));
    if (missingCore.length > 0) throw new Error(`çekirdek tablo eksik: ${missingCore.join(', ')}`);
    return `${names.size} tablo birebir (16 çekirdek tablo dahil)`;
  });

  step('h) şema/eklenti doğrulaması', () => {
    const ext = query(TARGET_DB, "select string_agg(extname, ', ' order by extname) from pg_extension");
    if (!ext.includes('citext')) throw new Error('citext eklentisi restore edilen DB\'de yok');
    const migr = query(TARGET_DB, 'select count(*) from public._prisma_migrations where finished_at is not null');
    const srcMigr = query(SOURCE_DB, 'select count(*) from public._prisma_migrations where finished_at is not null');
    if (migr !== srcMigr) throw new Error(`migration sayısı farklı: kaynak ${srcMigr}, restore ${migr}`);
    const tz = query(TARGET_DB, "select count(*) from information_schema.columns where table_schema='public' and data_type='timestamp without time zone'");
    if (tz !== '0') throw new Error(`restore edilen DB'de ${tz} adet timestamptz OLMAYAN an kolonu var (ADR-0004)`);
    return `eklentiler: ${ext} · migration ${migr} · timestamp(without tz) 0`;
  });

  step('i) örnek veri doğrulaması', () => {
    // Sayı eşitliği yetmez: içerik de gelmiş mi? Birkaç anahtar satırı karşılaştır.
    const probes = [
      ['ürün slug listesi', "select md5(string_agg(slug, ',' order by slug)) from public.products"],
      ['ayar anahtarları', "select md5(string_agg(\"group\" || '.' || key, ',' order by \"group\", key)) from public.settings"],
      ['yasal belge sürümleri', "select md5(string_agg(slug || ':' || version, ',' order by slug, version)) from public.legal_documents"],
    ];
    for (const [label, sql] of probes) {
      const a = query(SOURCE_DB, sql);
      const b = query(TARGET_DB, sql);
      if (a !== b) throw new Error(`${label} özeti farklı`);
    }
    return `${probes.length} içerik özeti (md5) birebir`;
  });

  step('z) temizlik', () => {
    if (KEEP) return `--keep: ${TARGET_DB} ve dump dosyası bırakıldı`;
    dropTargetIfExists();
    rmSync(DUMP_PATH, { force: true });
    if (dbExists(TARGET_DB)) throw new Error(`${TARGET_DB} düşürülemedi`);
    return `${TARGET_DB} düşürüldü, dump dosyası silindi`;
  });
}

// ---- rapor -----------------------------------------------------------------------------------
function writeReport(failed) {
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const dumpMs = steps.find((s) => s.name.startsWith('c)'))?.ms ?? 0;
  const restoreMs = steps.find((s) => s.name.startsWith('f)'))?.ms ?? 0;
  const totalMs = steps.reduce((a, s) => a + s.ms, 0);
  const totalRows = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

  const out = [];
  out.push('# Bağdam — yedek/restore provası raporu (F10 · C)');
  out.push('');
  out.push(`> Üretildi: ${at} (UTC) · araç: \`tools/backup-restore-drill.mjs\``);
  out.push(`> Sonuç: **${failed ? 'BAŞARISIZ' : 'BAŞARILI'}** — ${steps.filter((s) => s.ok).length}/${steps.length} adım`);
  out.push('');
  out.push('## Ortam');
  out.push('');
  out.push('| Alan | Değer |');
  out.push('|---|---|');
  out.push(`| Kaynak veritabanı | \`${SOURCE_DB}\` (yalnız \`SELECT\` — prova sırasında yazılmadı) |`);
  out.push(`| Restore hedefi | \`${TARGET_DB}\` (prova sonunda düşürüldü${KEEP ? ' — `--keep` verildiği için BIRAKILDI' : ''}) |`);
  out.push(`| Sunucu | ${sourceVersion} · ${conn.host}:${conn.port} |`);
  out.push(`| Araçlar | \`${BIN.pg_dump}\` · \`${BIN.pg_restore}\` |`);
  out.push(`| Eklentiler | ${extensions || '—'} |`);
  out.push('');
  out.push('## Adımlar');
  out.push('');
  out.push('| # | Adım | Sonuç | Süre (ms) | Not |');
  out.push('|---|---|---|---:|---|');
  steps.forEach((s, i) => out.push(`| ${i + 1} | ${s.name} | ${s.ok ? '✅' : '❌'} | ${s.ms} | ${s.note.replace(/\|/g, '\\|')} |`));
  out.push('');
  out.push('## Ölçümler (RTO tahmini)');
  out.push('');
  out.push('| Ölçüm | Değer |');
  out.push('|---|---|');
  out.push(`| Dump boyutu | ${(dumpBytes / 1024 / 1024).toFixed(2)} MB (\`-Fc\`, sıkıştırılmış) |`);
  out.push(`| Arşiv girdisi | ${listEntries} |`);
  out.push(`| Kaynak satır toplamı | ${totalRows} (${Object.keys(sourceCounts).length} tablo) |`);
  out.push(`| \`pg_dump\` süresi | ${(dumpMs / 1000).toFixed(2)} s |`);
  out.push(`| \`pg_restore\` süresi | ${(restoreMs / 1000).toFixed(2)} s |`);
  out.push(`| Toplam prova süresi | ${(totalMs / 1000).toFixed(2)} s |`);
  out.push('');
  out.push('> Üretim verisi bu seed setinden büyük olacaktır; süreler satır sayısıyla kabaca doğrusal ölçeklenir.');
  out.push('> Lansman sonrası prova tekrarlanıp bu tablo güncellenmeli (`docs/RUNBOOK.md` → aylık restore provası).');
  out.push('');
  out.push('## Tablo sayımları (kaynak ↔ restore)');
  out.push('');
  out.push('16 çekirdek tablo kalın; tüm public tablolar listelenir.');
  out.push('');
  out.push('| Tablo | Kaynak | Restore | ✓ |');
  out.push('|---|---:|---:|:--:|');
  const names = [...new Set([...Object.keys(sourceCounts), ...Object.keys(restoredCounts)])].sort();
  for (const t of names) {
    const a = sourceCounts[t] ?? '(yok)';
    const b = restoredCounts[t] ?? '(yok)';
    const core = CORE_TABLES.includes(t);
    out.push(`| ${core ? `**${t}**` : t} | ${a} | ${b} | ${a === b ? '✅' : '❌'} |`);
  }
  out.push('');
  if (mismatches.length > 0) {
    out.push('### Farklar');
    out.push('');
    for (const m of mismatches) out.push(`- \`${m.table}\`: kaynak ${m.source}, restore ${m.restored}`);
    out.push('');
  }
  out.push('## Sunucudaki karşılığı');
  out.push('');
  out.push('Bu prova, `deploy/scripts/backup-bagdam.sh` zincirinin **geri yükleme** ayağını doğrular:');
  out.push('');
  out.push('```bash');
  out.push('# 1) En güncel yedeği seç (sunucu)');
  out.push('ls -lt /opt/birbudak/backups/bagdam/db_*.dump | head');
  out.push('# 2) Bütünlük (script gecelik olarak da yapar)');
  out.push('pg_restore --list /opt/birbudak/backups/bagdam/db_<damga>.dump | head');
  out.push('# 3) YAN veritabanına geri yükle — üretim DB\'sinin ÜZERİNE YAZMA');
  out.push('sudo -u postgres createdb -O bagdam bagdam_restore_test');
  out.push('sudo -u postgres pg_restore -d bagdam_restore_test --no-owner --no-privileges db_<damga>.dump');
  out.push('# 4) Sayım karşılaştır → 5) sudo -u postgres dropdb bagdam_restore_test');
  out.push('```');
  out.push('');
  out.push('Off-site kopya `age` ile şifreliyse önce çözülür: `age -d -i bagdam-backup.key db.dump.age > db.dump`.');
  out.push('Gerçek felaket senaryosunda üretim DB\'sine dönüş adımları `docs/RUNBOOK.md` → “Yedek ve geri yükleme”.');
  out.push('');

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, out.join('\n'), 'utf8');
  log(`rapor: ${REPORT_PATH}`);
}

let failed = false;
try {
  main();
} catch {
  failed = true;
  // Prova yarıda kaldıysa da hedef DB'yi bırakma (kaynak DB'ye zaten dokunulmadı).
  if (!KEEP) {
    try {
      dropTargetIfExists();
      rmSync(DUMP_PATH, { force: true });
      log('temizlik: yarım kalan hedef veritabanı ve dump silindi');
    } catch (cleanupErr) {
      log(`temizlik uyarısı: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }
  }
}
writeReport(failed);
process.exit(failed ? 1 : 0);
