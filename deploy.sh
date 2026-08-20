#!/bin/bash
# =============================================================================
# Bağdam — deploy betiği (sunucuda çalışır; repo'dan gelir, elle kopyalanmaz)
#
#   Kullanım:  bash /opt/bagdam/deploy.sh [bagdam|bagdam-staging]
#     bagdam          → /opt/bagdam          (branch main,    pm2 bagdam-api,         :5010)
#     bagdam-staging  → /opt/bagdam-staging  (branch staging, pm2 bagdam-api-staging, :5011)
#
#   Akış (BACKEND-PLANI §7 / YOL-HARITASI F1):
#     flock → git fetch + reset --hard → pnpm install --frozen-lockfile → prisma generate (koşullu)
#     → build shared + api + admin → psql citext → pre-migrate pg_dump (14 gün) → prisma migrate deploy (koşullu)
#     → pm2 reload --only <ad> --update-env → health bekle (30 s) → pm2 save → .last-deploy-sha
#
#   Kurallar: idempotent (CI tekrar deneyebilir); echo'larda sır yok (DATABASE_URL hiç yazılmaz);
#   dosya LF satır sonlu olmalı (.gitattributes *.sh eol=lf). GitHub Actions bu betiği
#   /opt/birbudak/scripts/deploy-dispatch.sh üzerinden, kısıtlı SSH anahtarıyla çağırır (ADR-0015).
# =============================================================================
set -euo pipefail

APP="${1:-bagdam}"
case "$APP" in
  bagdam)
    APP_DIR="/opt/bagdam";          BRANCH="main";    PM2_NAME="bagdam-api";         PORT=5010 ;;
  bagdam-staging)
    APP_DIR="/opt/bagdam-staging";  BRANCH="staging"; PM2_NAME="bagdam-api-staging"; PORT=5011 ;;
  *)
    echo "Kullanım: $0 [bagdam|bagdam-staging]" >&2; exit 1 ;;
esac

LOCK_FILE="/var/lock/bagdam-deploy-${APP}.lock"
BACKUP_DIR="/opt/birbudak/backups/${APP}/pre-migrate"
ENV_FILE="${APP_DIR}/apps/api/.env"
HEALTH_URL="http://127.0.0.1:${PORT}/api/v1/health"
HEALTH_WAIT_SECONDS=30
PRE_MIGRATE_RETENTION_DAYS=14
STEP="başlangıç"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
trap 'echo "!!! [$(ts)] Deploy BAŞARISIZ ($APP) — adım: $STEP"' ERR

# --- Deploy günlüğü: stdout (CI) + dosya ---------------------------------------------------
mkdir -p "${APP_DIR}/logs"
exec > >(tee -a "${APP_DIR}/logs/deploy.log") 2>&1

echo "=== [$(ts)] Deploy başlıyor: ${APP} (${BRANCH} → ${APP_DIR}) ==="

# --- Kilit: aynı uygulama için eşzamanlı iki deploy çalışmasın (en fazla 15 dk bekle) ---------
STEP="kilit"
exec 9>"${LOCK_FILE}"
if ! flock -w 900 9; then
  echo "HATA: başka bir deploy hâlâ çalışıyor (${LOCK_FILE})"; exit 1
fi

# --- Node 22 (proje bazlı ikili; global Node 20 diğer projeler için değişmez — ADR-0001) --------
# F1 sunucu adımında kurulur; yoksa PATH'teki node ile (20) devam edilir. PM2 tarafı ecosystem.config.js'te.
NODE22_BIN="${BAGDAM_NODE:-/usr/local/n/versions/node/22/bin/node}"
if [ -x "${NODE22_BIN}" ]; then
  export PATH="$(dirname "${NODE22_BIN}"):${PATH}"
fi
echo "node: $(node -v) · pnpm: $(pnpm -v)"

# --- DATABASE_URL'i .env'den oku (değer hiçbir zaman ekrana yazılmaz) ------------------------
STEP="env"
[ -f "${ENV_FILE}" ] || { echo "HATA: ${ENV_FILE} yok (sunucuda elle oluşturulur, 600)"; exit 1; }
DATABASE_URL="$( (grep -E '^DATABASE_URL=' "${ENV_FILE}" || true) | head -n1 | cut -d= -f2-)"
DATABASE_URL="${DATABASE_URL%$'\r'}"
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"
[ -n "${DATABASE_URL}" ] || { echo "HATA: ${ENV_FILE} içinde DATABASE_URL boş"; exit 1; }
export DATABASE_URL
# libpq (psql/pg_dump) Prisma'nın ?connection_limit=…&pool_timeout=… parametrelerini tanımaz → sorgu dizesini at
PG_URL="${DATABASE_URL%%\?*}"

cd "${APP_DIR}"

# --- 1) Kod: sunucu her zaman origin/<branch> ile birebir ------------------------------------
STEP="git"
echo "[1/9] git fetch + reset --hard origin/${BRANCH}"
git fetch --prune origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"
SHA="$(git rev-parse HEAD)"
echo "      commit: $(git log -1 --format='%h %ad %s' --date=short)"

# --- 2) Bağımlılıklar ------------------------------------------------------------------------
STEP="pnpm install"
echo "[2/9] pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# --- 3) Prisma client (F2'den sonra; şema yoksa atlanır) ---------------------------------------
STEP="prisma generate"
HAS_SCHEMA=0
[ -f database/schema.prisma ] && HAS_SCHEMA=1
if [ "${HAS_SCHEMA}" = "1" ]; then
  echo "[3/9] prisma generate"
  # pnpm hoisted .prisma önbelleğini temizle (stale type hatalarını önler — UA deploy.sh kalıbı)
  rm -rf node_modules/.prisma
  find node_modules/.pnpm -path "*/.prisma/client" -type d -prune -exec rm -rf {} + 2>/dev/null || true
  pnpm exec prisma generate --schema=database/schema.prisma
  PNPM_PRISMA="$(find node_modules/.pnpm -maxdepth 1 -name '@prisma+client@*' -type d 2>/dev/null | head -n1 || true)"
  if [ -n "${PNPM_PRISMA}" ] && [ -d node_modules/.prisma/client ]; then
    mkdir -p "${PNPM_PRISMA}/node_modules/.prisma/client"
    cp -r node_modules/.prisma/client/. "${PNPM_PRISMA}/node_modules/.prisma/client/"
  fi
else
  echo "[3/9] prisma generate — database/schema.prisma yok, atlandı (F2'de gelir)"
fi

# --- 4) Build: shared → api (nest) → admin (vite, dist.next → dist) -----------------------------
# Build migrate'ten ÖNCE: build patlarsa DB eski kodun önüne geçmiş olmaz.
STEP="build"
echo "[4/9] build"
rm -f apps/api/tsconfig.tsbuildinfo
pnpm --filter @bagdam/shared run --if-present build
NODE_OPTIONS="--max-old-space-size=2048" pnpm --filter @bagdam/api build
rm -rf apps/admin/dist.next
pnpm --filter @bagdam/admin run --if-present build --outDir dist.next
if [ -d apps/admin/dist.next ]; then
  rm -rf apps/admin/dist && mv apps/admin/dist.next apps/admin/dist
fi
[ -f apps/api/dist/main.js ] || { echo "HATA: apps/api/dist/main.js üretilmedi"; exit 1; }

# --- 5) citext (trusted extension; DB sahibi 'bagdam' rolü oluşturabilir) ---------------------
STEP="citext"
echo "[5/9] psql CREATE EXTENSION IF NOT EXISTS citext"
psql "${PG_URL}" -v ON_ERROR_STOP=1 -qc 'CREATE EXTENSION IF NOT EXISTS citext;'

# --- 6) Pre-migrate yedek + 7) migrate deploy (migration klasörü doluysa) ---------------------
if [ "${HAS_SCHEMA}" = "1" ] && [ -d database/migrations ] && [ -n "$(ls -A database/migrations 2>/dev/null)" ]; then
  STEP="pre-migrate pg_dump"
  mkdir -p "${BACKUP_DIR}"
  DUMP_FILE="${BACKUP_DIR}/db_${APP}_pre-migrate_$(date +%Y-%m-%d_%H%M)_${SHA:0:8}.dump"
  echo "[6/9] pg_dump → ${DUMP_FILE}"
  pg_dump -Fc --no-owner --no-acl "${PG_URL}" -f "${DUMP_FILE}"
  find "${BACKUP_DIR}" -type f -name '*.dump' -mtime +"${PRE_MIGRATE_RETENTION_DAYS}" -delete
  echo "      boyut: $(du -h "${DUMP_FILE}" | awk '{print $1}') · ${PRE_MIGRATE_RETENTION_DAYS} günden eski dump'lar silindi"

  STEP="prisma migrate deploy"
  echo "[7/9] prisma migrate deploy"
  pnpm exec prisma migrate deploy --schema=database/schema.prisma
else
  echo "[6/9] pre-migrate pg_dump — migration yok, atlandı"
  echo "[7/9] prisma migrate deploy — migration yok, atlandı"
fi

# --- 8) PM2 reload (cluster: yeni worker dinlemeye başlayınca eski kapanır) -------------------
STEP="pm2 reload"
echo "[8/9] pm2 reload ${PM2_NAME}"
ECOSYSTEM="${APP_DIR}/ecosystem.config.js"
if pm2 describe "${PM2_NAME}" >/dev/null 2>&1; then
  pm2 reload "${ECOSYSTEM}" --only "${PM2_NAME}" --update-env
else
  echo "      ${PM2_NAME} ilk kez başlatılıyor"
  pm2 start "${ECOSYSTEM}" --only "${PM2_NAME}"
fi

# --- Health: en fazla 30 s ---------------------------------------------------------------------
STEP="health"
HEALTHY=0
for _ in $(seq 1 "${HEALTH_WAIT_SECONDS}"); do
  if curl -fsS -m 3 "${HEALTH_URL}" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 1
done
if [ "${HEALTHY}" != "1" ]; then
  echo "HATA: ${HEALTH_URL} ${HEALTH_WAIT_SECONDS} s içinde 200 dönmedi"
  pm2 describe "${PM2_NAME}" 2>/dev/null | grep -E 'status|restarts|uptime|node.js version|interpreter' || true
  echo "--- son hata satırları (${APP_DIR}/logs/api-error.log) ---"
  tail -n 30 "${APP_DIR}/logs/api-error.log" 2>/dev/null | sed -E 's#postgres(ql)?://[^ ]*#postgresql://<gizli>#g' || true
  exit 1
fi
echo "      health OK: ${HEALTH_URL}"

# --- 9) Kalıcılaştır -----------------------------------------------------------------------------
STEP="pm2 save"
echo "[9/9] pm2 save + .last-deploy-sha"
pm2 save >/dev/null
echo "${SHA}" > "${APP_DIR}/.last-deploy-sha"

echo "=== [$(ts)] Deploy tamamlandı: ${APP} @ ${SHA:0:8} ==="
