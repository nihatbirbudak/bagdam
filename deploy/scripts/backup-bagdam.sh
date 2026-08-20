#!/bin/bash
# =============================================================================
# birbudak.com — Bağdam günlük yedek (backup-uyanis.sh'tan türetildi)
#
#   Kopyala:  /opt/birbudak/scripts/backup-bagdam.sh   (chmod 700)
#   Cron (root):  30 3 * * *  RCLONE_REMOTE=r2:bagdam-backups /opt/birbudak/scripts/backup-bagdam.sh
#                 (off-site istenmiyorsa RCLONE_REMOTE= verilmez → yalnız yerel yedek)
#
#   Yapar:
#     1) bagdam_db → pg_dump -Fc (custom, sıkıştırılmış) + pg_restore --list ile bütünlük kontrolü
#     2) /opt/bagdam/apps/api/uploads → tar.gz (1 KB altı tar şüpheli sayılır — UA'daki bozuk script dersi)
#     3) Ayın 1'i → monthly/ kopyası (365 gün)
#     4) Yerel retention: 7 gün (günlük), 14 gün (pre-migrate/, deploy.sh üretir), 365 gün (monthly/)
#     5) Off-site (isteğe bağlı): RCLONE_REMOTE tanımlı ve rclone kuruluysa daily/ + monthly/ kopyası,
#        off-site retention 30 gün (OFFSITE_RETENTION_DAYS) / monthly 400 gün
#        — age şifreleme: AGE_RECIPIENT tanımlı ve `age` kuruluysa .age şifreli gönderilir (aşağıda)
#     6) Telegram: yalnız hata durumunda (başarı daily-report'ta özetlenir)
#     7) /var/lib/birbudak-monitor/backup-bagdam.last → daily-report için özet satırı
#
#   ADR-0015: yerel 7 gün + şifreli off-site 30 gün; aylık restore provası (F10).
#   Staging DB (bagdam_staging) yedeklenmez — migrate deploy ile yeniden kurulabilir.
# =============================================================================
set -uo pipefail

NOTIFY="/opt/birbudak/scripts/notify-telegram.sh"
APP_DIR="/opt/bagdam"
DB_NAME="bagdam_db"
BACKUP_DIR="/opt/birbudak/backups/bagdam"
STATE_FILE="/var/lib/birbudak-monitor/backup-bagdam.last"
LOG="/var/log/birbudak-backup.log"

RCLONE_REMOTE="${RCLONE_REMOTE:-}"                       # örn. r2:bagdam-backups  (boş → off-site yok)
OFFSITE_RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"
OFFSITE_MONTHLY_RETENTION_DAYS="${OFFSITE_MONTHLY_RETENTION_DAYS:-400}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"                       # örn. age1…  (boş → şifresiz kopya; bkz. not)
LOCAL_RETENTION_DAYS=7
MONTHLY_RETENTION_DAYS=365
PRE_MIGRATE_RETENTION_DAYS=14

DATE="$(date +%Y-%m-%d_%H%M)"
DAY_OF_MONTH="$(date +%d)"
mkdir -p "$BACKUP_DIR" "$BACKUP_DIR/monthly" "$(dirname "$STATE_FILE")"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] [bagdam-backup] $*" >> "$LOG"; }

ERRORS=()
DB_SIZE="-"; UP_SIZE="-"; OFFSITE="kapalı"

# ─── 1) DB dump + doğrulama ───
DB_FILE="$BACKUP_DIR/db_${DATE}.dump"
if sudo -u postgres pg_dump -Fc -d "$DB_NAME" > "$DB_FILE" 2>>"$LOG"; then
  DB_SIZE="$(du -h "$DB_FILE" | awk '{print $1}')"
  if pg_restore --list "$DB_FILE" >/dev/null 2>>"$LOG"; then
    log "DB dump OK: $DB_FILE ($DB_SIZE) — pg_restore --list doğrulandı"
  else
    ERRORS+=("DB dump BOZUK (pg_restore --list başarısız): $DB_FILE")
    log "DB dump pg_restore --list FAILED"
  fi
else
  ERRORS+=("DB dump FAILED ($DB_NAME)")
  log "DB dump FAILED"
  rm -f "$DB_FILE"
fi

# ─── 2) Uploads tar ───
UPLOADS_FILE="$BACKUP_DIR/uploads_${DATE}.tar.gz"
if [ -d "$APP_DIR/apps/api/uploads" ]; then
  if tar czf "$UPLOADS_FILE" -C "$APP_DIR/apps/api" uploads/ 2>>"$LOG"; then
    UP_SIZE="$(du -h "$UPLOADS_FILE" | awk '{print $1}')"
    UP_COUNT="$(tar tzf "$UPLOADS_FILE" | wc -l)"
    UP_BYTES="$(stat -c%s "$UPLOADS_FILE")"
    log "Uploads OK: $UPLOADS_FILE ($UP_SIZE, $UP_COUNT entry)"
    if [ "$UP_BYTES" -lt 1024 ] && [ "$UP_COUNT" -gt 1 ]; then
      ERRORS+=("Uploads tar ŞÜPHELİ (sadece $UP_BYTES byte) — kontrol et")
    fi
  else
    ERRORS+=("Uploads tar FAILED")
    log "Uploads tar FAILED"
  fi
else
  UP_SIZE="yok"
  log "Uploads dizini yok: $APP_DIR/apps/api/uploads (F4'e kadar normal)"
fi

# ─── 3) Aylık kopya (ayın 1'i) ───
if [ "$DAY_OF_MONTH" = "01" ] && [ -f "$DB_FILE" ]; then
  cp -f "$DB_FILE" "$BACKUP_DIR/monthly/" && log "Aylık kopya: monthly/$(basename "$DB_FILE")"
  [ -f "$UPLOADS_FILE" ] && cp -f "$UPLOADS_FILE" "$BACKUP_DIR/monthly/"
fi

# ─── 4) Yerel retention ───
DEL_DAILY="$(find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete -print | wc -l)"
DEL_MONTHLY="$(find "$BACKUP_DIR/monthly" -type f -mtime +"$MONTHLY_RETENTION_DAYS" -delete -print 2>/dev/null | wc -l)"
DEL_PREMIG="$(find "$BACKUP_DIR/pre-migrate" -type f -mtime +"$PRE_MIGRATE_RETENTION_DAYS" -delete -print 2>/dev/null | wc -l)"
log "Retention: günlük $DEL_DAILY, aylık $DEL_MONTHLY, pre-migrate $DEL_PREMIG dosya silindi"

# ─── 5) Off-site (isteğe bağlı, rclone) ───
# Kurulum: curl https://rclone.org/install.sh | bash ; rclone config (R2 / Hetzner Storage Box / B2 …)
# Şifreleme (ADR-0015): AGE_RECIPIENT tanımlıysa age ile şifrelenir; anahtar üretimi:
#   age-keygen -o /root/.config/age/bagdam-backup.key   (AGE-SECRET-KEY-… → şifre kasasında da sakla!)
#   public key satırı → cron'da AGE_RECIPIENT=age1…   ; çözme: age -d -i bagdam-backup.key db.dump.age > db.dump
# Alternatif: rclone "crypt" remote'u (RCLONE_REMOTE=r2crypt:…) — o zaman AGE_RECIPIENT boş bırakılır.
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    OFFSITE="açık"
    upload_file() {  # $1 = yerel dosya, $2 = uzak alt klasör
      local src="$1" sub="$2" obj="$1"
      [ -f "$src" ] || return 0
      if [ -n "$AGE_RECIPIENT" ]; then
        if command -v age >/dev/null 2>&1; then
          if age -r "$AGE_RECIPIENT" -o "${src}.age" "$src" 2>>"$LOG"; then
            obj="${src}.age"
          else
            ERRORS+=("age şifreleme FAILED: $(basename "$src")"); log "age FAILED: $src"; return 0
          fi
        else
          ERRORS+=("AGE_RECIPIENT tanımlı ama 'age' kurulu değil — off-site ŞİFRESİZ gönderilmedi")
          log "age kurulu değil; $src gönderilmedi"; return 0
        fi
      fi
      if rclone copy --no-traverse "$obj" "$RCLONE_REMOTE/$sub/" 2>>"$LOG"; then
        log "Off-site OK: $(basename "$obj") → $RCLONE_REMOTE/$sub/"
      else
        ERRORS+=("Off-site rclone copy FAILED: $(basename "$obj")"); log "rclone copy FAILED: $obj"
      fi
      [ "$obj" != "$src" ] && rm -f "$obj"
    }
    upload_file "$DB_FILE" daily
    upload_file "$UPLOADS_FILE" daily
    if [ "$DAY_OF_MONTH" = "01" ]; then
      upload_file "$DB_FILE" monthly
      upload_file "$UPLOADS_FILE" monthly
    fi
    rclone delete --min-age "${OFFSITE_RETENTION_DAYS}d" "$RCLONE_REMOTE/daily/" 2>>"$LOG" \
      || log "Off-site retention (daily) uyarı"
    rclone delete --min-age "${OFFSITE_MONTHLY_RETENTION_DAYS}d" "$RCLONE_REMOTE/monthly/" 2>>"$LOG" \
      || log "Off-site retention (monthly) uyarı"
  else
    ERRORS+=("RCLONE_REMOTE tanımlı ama rclone kurulu değil")
    log "rclone yok"
  fi
fi

# ─── 6) Özet + Telegram ───
TOTAL_SIZE="$(du -sh "$BACKUP_DIR" | awk '{print $1}')"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "HATA $(date +%Y-%m-%d) DB:$DB_SIZE Uploads:$UP_SIZE Offsite:$OFFSITE — ${ERRORS[*]}" > "$STATE_FILE"
  msg="🔴 BAGDAM BACKUP HATA ($(date +%Y-%m-%d))"$'\n\n'
  for e in "${ERRORS[@]}"; do msg+="• $e"$'\n'; done
  msg+=$'\n'"Backup dizini: $TOTAL_SIZE"
  "$NOTIFY" "$msg" || log "Telegram bildirim FAILED"
  log "ERRORS: ${ERRORS[*]}"
  exit 1
else
  echo "OK $(date +%Y-%m-%d) DB:$DB_SIZE Uploads:$UP_SIZE Offsite:$OFFSITE Total:$TOTAL_SIZE" > "$STATE_FILE"
  log "OK - DB:$DB_SIZE Uploads:$UP_SIZE Offsite:$OFFSITE Total:$TOTAL_SIZE"
  exit 0
fi
