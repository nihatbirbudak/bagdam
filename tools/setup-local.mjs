#!/usr/bin/env node
/**
 * Bağdam — tek komutluk yerel kurulum.
 *
 *   node tools/setup-local.mjs
 *
 * Yaptıkları (hepsi idempotent — tekrar çalıştırmak zararsız):
 *   1. Ön koşulları denetler (Node, pnpm, PostgreSQL istemcisi)
 *   2. PostgreSQL'de `bagdam` rolünü ve `bagdam_dev` / `bagdam_test` veritabanlarını oluşturur
 *   3. `.env` ve `apps/api/.env` dosyalarını rastgele gizli anahtarlarla üretir (varsa dokunmaz)
 *   4. Bağımlılıkları kurar, Prisma istemcisini üretir, migration'ları uygular, örnek veriyi yükler
 *   5. Yönetici giriş bilgilerini ekrana yazar
 *
 * Süper kullanıcı parolası: PGPASSWORD ortam değişkeni ya da --su-pass=... ile verilir.
 * Verilmezse `postgres` kullanıcısı için parolasız (peer/trust) bağlantı denenir.
 */
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const SU_USER = String(args["su-user"] || "postgres");
const SU_PASS = String(args["su-pass"] || process.env.PGPASSWORD || "");
const PGHOST = String(args["pg-host"] || process.env.PGHOST || "127.0.0.1");
const PGPORT = String(args["pg-port"] || process.env.PGPORT || "5432");
const DB_USER = "bagdam";
const DB_MAIN = "bagdam_dev";
const DB_TEST = "bagdam_test";

const c = { ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", dim: "\x1b[2m", b: "\x1b[1m", off: "\x1b[0m" };
const say = (s) => console.log(s);
const step = (n, s) => console.log(`\n${c.b}[${n}]${c.off} ${s}`);
const ok = (s) => console.log(`  ${c.ok}✓${c.off} ${s}`);
const warn = (s) => console.log(`  ${c.warn}!${c.off} ${s}`);
const die = (s) => {
  console.error(`\n${c.err}✗ ${s}${c.off}\n`);
  process.exit(1);
};

const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts });

const tryRun = (cmd, opts = {}) => {
  try {
    return { ok: true, out: String(run(cmd, { quiet: true, ...opts }) || "") };
  } catch (e) {
    return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};

function psqlSu(sql, db = "postgres") {
  const env = { ...process.env };
  if (SU_PASS) env.PGPASSWORD = SU_PASS;
  try {
    const out = execFileSync("psql", ["-U", SU_USER, "-h", PGHOST, "-p", PGPORT, "-d", db, "-Atc", sql], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

const secret = () => crypto.randomBytes(32).toString("hex");
const password = () => crypto.randomBytes(15).toString("base64url").slice(0, 20);

// ─────────────────────────────────────────────────────────── 1. ön koşullar
step(1, "Ön koşullar");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) die(`Node 20 veya üzeri gerekli (bulunan: ${process.version}).`);
ok(`Node ${process.version}`);

let pnpmV = tryRun("pnpm --version");
if (!pnpmV.ok) {
  warn("pnpm bulunamadı, corepack ile etkinleştiriliyor…");
  tryRun("corepack enable");
  tryRun("corepack prepare pnpm@9.15.9 --activate");
  pnpmV = tryRun("pnpm --version");
  if (!pnpmV.ok) die("pnpm kurulamadı. Kurulum: npm i -g pnpm@9");
}
ok(`pnpm ${pnpmV.out.trim()}`);

const psqlV = tryRun("psql --version");
if (!psqlV.ok) {
  die(
    "PostgreSQL istemcisi (psql) bulunamadı.\n" +
      "  Windows: https://www.postgresql.org/download/windows/ (kurulumdaki bin klasörünü PATH'e ekleyin)\n" +
      "  macOS:   brew install postgresql@16\n" +
      "  Linux:   sudo apt install postgresql postgresql-client",
  );
}
ok(psqlV.out.trim());

// ─────────────────────────────────────────────────────── 2. veritabanı
step(2, "Veritabanı");

const ping = psqlSu("select 1");
if (!ping.ok) {
  die(
    `PostgreSQL sunucusuna bağlanılamadı (${SU_USER}@${PGHOST}:${PGPORT}).\n` +
      `  Sunucu çalışıyor mu? Parola gerekiyorsa:  node tools/setup-local.mjs --su-pass=PAROLA\n` +
      `  Hata: ${ping.out.split("\n")[0]}`,
  );
}
ok(`PostgreSQL erişimi (${SU_USER}@${PGHOST}:${PGPORT})`);

const envPathRoot = path.join(ROOT, ".env");
const envPathApi = path.join(ROOT, "apps/api/.env");
const existing = fs.existsSync(envPathApi) ? fs.readFileSync(envPathApi, "utf8") : "";
const existingUrl = existing.match(/^DATABASE_URL=(.*)$/m)?.[1];
let dbPass = existingUrl?.match(/postgresql:\/\/[^:]+:([^@]+)@/)?.[1];

if (dbPass) {
  ok("Mevcut .env dosyasındaki veritabanı parolası kullanılıyor");
} else {
  dbPass = password();
}

const roleSql = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${dbPass}' CREATEDB;
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${dbPass}' CREATEDB;
  END IF;
END $$;`;
const roleRes = psqlSu(roleSql);
if (!roleRes.ok) die(`'${DB_USER}' rolü oluşturulamadı: ${roleRes.out.split("\n")[0]}`);
ok(`'${DB_USER}' rolü hazır`);

for (const db of [DB_MAIN, DB_TEST]) {
  const exists = psqlSu(`SELECT 1 FROM pg_database WHERE datname='${db}'`).out === "1";
  if (!exists) {
    const cr = psqlSu(
      `CREATE DATABASE ${db} OWNER ${DB_USER} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
    );
    if (!cr.ok) die(`${db} oluşturulamadı: ${cr.out.split("\n")[0]}`);
    ok(`${db} oluşturuldu`);
  } else {
    ok(`${db} zaten var`);
  }
  psqlSu(`CREATE EXTENSION IF NOT EXISTS citext; ALTER DATABASE ${db} SET timezone TO 'Europe/Istanbul';`, db);
}

// ─────────────────────────────────────────────────────────── 3. .env
step(3, "Ortam dosyaları");

const dbUrl = (db) =>
  `postgresql://${DB_USER}:${dbPass}@${PGHOST}:${PGPORT}/${db}?schema=public&connection_limit=5&pool_timeout=20`;

let adminEmail = existing.match(/^SEED_ADMIN_EMAIL=(.*)$/m)?.[1] || "admin@bagdam.com";
let adminPass = existing.match(/^SEED_ADMIN_PASSWORD=(.*)$/m)?.[1] || password();

if (fs.existsSync(envPathApi)) {
  ok("apps/api/.env zaten var — dokunulmadı");
} else {
  fs.writeFileSync(
    envPathApi,
    [
      "# Yerel geliştirme — git dışı. tools/setup-local.mjs tarafından üretildi.",
      "NODE_ENV=development",
      "PORT=4010",
      "HOST=127.0.0.1",
      "TZ=Europe/Istanbul",
      "SITE_MODE=full",
      `DATABASE_URL=${dbUrl(DB_MAIN)}`,
      `TEST_DATABASE_URL=${dbUrl(DB_TEST)}`,
      `JWT_SECRET=${secret()}`,
      `JWT_REFRESH_SECRET=${secret()}`,
      `SETTINGS_ENCRYPTION_KEY=${secret()}`,
      "WEB_URL=http://localhost:4010",
      "ADMIN_URL=http://localhost:4011",
      "ENABLE_CRON=false",
      "DISABLE_MAIL=true",
      "PAYMENT_PROVIDER=manual",
      "UPLOADS_DIR=./uploads",
      `SEED_ADMIN_EMAIL=${adminEmail}`,
      `SEED_ADMIN_PASSWORD=${adminPass}`,
      "",
    ].join("\n"),
  );
  ok("apps/api/.env üretildi (rastgele gizli anahtarlarla)");
}

if (!fs.existsSync(envPathRoot)) {
  fs.writeFileSync(
    envPathRoot,
    [`DATABASE_URL=${dbUrl(DB_MAIN)}`, `TEST_DATABASE_URL=${dbUrl(DB_TEST)}`, "# Prisma CLI için (kök)", ""].join("\n"),
  );
  ok(".env üretildi (Prisma CLI için)");
} else {
  ok(".env zaten var — dokunulmadı");
}

const adminEnv = path.join(ROOT, "apps/admin/.env");
if (!fs.existsSync(adminEnv)) {
  fs.writeFileSync(adminEnv, "VITE_API_URL=/api/v1\n");
  ok("apps/admin/.env üretildi");
}

// ──────────────────────────────────────────────── 4. kurulum + veri
step(4, "Bağımlılıklar ve veritabanı şeması (birkaç dakika sürebilir)");
run("pnpm install --frozen-lockfile");
ok("Bağımlılıklar kuruldu");

// Windows'ta çalışan bir API süreci Prisma motor DLL'ini kilitleyebilir (EPERM).
// Birkaç kez dene; istemci zaten üretilmişse uyarıyla devam et.
{
  let generated = false;
  for (let attempt = 1; attempt <= 3 && !generated; attempt++) {
    const res = tryRun("pnpm db:generate");
    if (res.ok) {
      generated = true;
      break;
    }
    const locked = /EPERM|EBUSY|operation not permitted/i.test(res.out);
    if (!locked) die(`Prisma istemcisi üretilemedi:\n${res.out.split("\n").slice(-6).join("\n")}`);
    warn(`Prisma motor dosyası kilitli (deneme ${attempt}/3) — çalışan bir API süreci olabilir`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
  }
  if (generated) {
    ok("Prisma istemcisi üretildi");
  } else {
    const clientOk = tryRun(`node -e "require('@prisma/client').PrismaClient"`, { cwd: path.join(ROOT, "apps/api") }).ok;
    if (!clientOk) {
      die(
        "Prisma istemcisi üretilemedi (dosya kilitli) ve mevcut bir istemci de yok.\n" +
          "  Çalışan tüm `pnpm dev:api` / `node dist/main.js` süreçlerini kapatıp tekrar çalıştırın.",
      );
    }
    warn("Prisma istemcisi güncellenemedi ama mevcut istemci çalışıyor — devam ediliyor");
  }
}

run("pnpm db:deploy");
ok("Migration'lar uygulandı");

run("pnpm db:seed", { env: { ...process.env, SEED_OVERWRITE_CONTENT: "true" } });
ok("Örnek veri yüklendi (22 ürün, 15 üretici, içerik, yasal metinler, ayarlar)");

run("pnpm build");
ok("Projeler derlendi");

// ───────────────────────────────────────────────────────── 5. özet
const line = "─".repeat(64);
say(`\n${c.ok}${line}${c.off}`);
say(`${c.b}  Kurulum tamam.${c.off}`);
say(`${c.ok}${line}${c.off}\n`);
say(`  Başlatmak için ${c.b}iki ayrı terminal${c.off} açın:\n`);
say(`    ${c.dim}# 1. terminal — site + API${c.off}`);
say(`    pnpm dev:api\n`);
say(`    ${c.dim}# 2. terminal — yönetim paneli${c.off}`);
say(`    pnpm dev:admin\n`);
say(`  ${c.b}Site${c.off}    http://localhost:4010`);
say(`  ${c.b}Panel${c.off}   http://localhost:4011`);
say(`  ${c.b}Giriş${c.off}   ${adminEmail}  /  ${adminPass}\n`);
say(`  Ne test edileceği: ${c.b}docs/TEST-REHBERI.md${c.off}`);
say(`  Ekran turu:        ${c.b}docs/ekran-turu.html${c.off} (tarayıcıda açın)\n`);
