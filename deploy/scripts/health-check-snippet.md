# Bağdam — mevcut izleme betiklerine eklenecek satırlar

Sunucudaki `/opt/birbudak/scripts/*.sh` betikleri ortaktır (Uyanış + Floovent + Bağdam); bu dosya
**elle uygulanacak** küçük yamaları içerir. Uygulamadan önce betiği `cp x.sh x.sh.bak` ile yedekleyin.
Tüm betikler `set -uo pipefail` ile çalışır; bash dizileri aynen kullanılır.

## 1. `health-check.sh` — ENDPOINTS haritası (her 5 dk, PM2 + HTTP)

`declare -A ENDPOINTS=(` bloğuna iki satır eklenir (5010 prod, 5011 staging; yalnız 127.0.0.1 — nginx/Cloudflare üzerinden değil):

```bash
declare -A ENDPOINTS=(
  ["uyanisakademi-api"]="http://127.0.0.1:5000/api/health"
  ["floovent-backend"]="http://127.0.0.1:3001/health"
  ["floovent-web"]="http://127.0.0.1:3000/"
  ["floovent-admin"]="http://127.0.0.1:3002/"
  ["bagdam-api"]="http://127.0.0.1:5010/api/v1/health"          # Bağdam prod  (pm2 bagdam-api)
  ["bagdam-api-staging"]="http://127.0.0.1:5011/api/v1/health"  # Bağdam staging (pm2 bagdam-api-staging)
)
```

Not: PM2 bölümü `pm2 jlist` ile tüm süreçleri otomatik tarar; `bagdam-api` / `bagdam-api-staging`
için `/var/lib/birbudak-monitor/<ad>.restarts` dosyaları ilk çalışmada kendiliğinden oluşur.

## 2. `error-watcher.sh` — tek DB → DBS döngüsü (her 2 dk)

Bağdam `system_logs` tablosu F2'de gelir (`SystemLog`: `level, fingerprint, module, action, message, createdAt`
sütunları Uyanış ile aynı adda olmalı — F2 şema yazarı için not). Tablo yokken sorgu `2>/dev/null` ile
sessizce boş döner; zarar vermez.

```bash
# ESKİ
DB="uyanisakademi_db"
# YENİ
DBS=(uyanisakademi_db bagdam_db)
```

Sorgu + gönderim bloğu (`NEW_ERRORS=$(sudo -u postgres psql -d "$DB" …` satırından `done <<< "$NEW_ERRORS"` satırına
kadar) `for DB in "${DBS[@]}"; do … done` içine alınır; dedup anahtarı ve mesaj başlığı DB adını da taşır:

```bash
for DB in "${DBS[@]}"; do
  NEW_ERRORS=$(sudo -u postgres psql -d "$DB" -tAc "
  SELECT … (sorgu değişmez) …
  " 2>/dev/null)
  [ -z "$NEW_ERRORS" ] && { log "[$DB] no new errors since $SINCE"; continue; }

  while IFS='|' read -r level fp module action time_t snippet; do
    [ -z "$level" ] && continue
    fp_safe=$(echo "${DB}_${fp}" | tr -c 'a-zA-Z0-9' '_' | head -c 64)   # DB ön-ekli dedup
    dedup_file="$DEDUP_DIR/$fp_safe"
    …
    msg="$icon *$level* — $time_t  [${DB%_db}]"$'\n'                         # başlıkta kaynak DB
    …
  done <<< "$NEW_ERRORS"
done
```

`LAST_SEEN` penceresi (SINCE/NOW) döngünün dışında kalır — tek pencere, iki DB.

## 3. `daily-error-digest.sh` — DBS döngüsü (09:00)

```bash
# ESKİ
DB="uyanisakademi_db"
# YENİ
DBS=(uyanisakademi_db bagdam_db)
```

`TOTAL=…` satırından `"$NOTIFY" "$msg"` satırına kadar olan gövde `for DB in "${DBS[@]}"; do … done` içine
alınır; başlık `msg="📋 *$(echo "${DB%_db}" | tr a-z A-Z) GUNLUK HATA RAPORU*"` olur ve `incidents` sorgusu
yalnız `uyanisakademi_db` için anlamlıdır (Bağdam'da tablo yok → `2>/dev/null` ile 0 döner). Her DB için ayrı
Telegram mesajı gider.

## 4. `daily-report.sh` — backup satırı (07:00)

`BK_FLO=…` satırının altına:

```bash
# Bağdam: backup 03:30'da çalışır → dosya adı BUGÜNÜN tarihini taşır
BK_BAG=$(ls -lh /opt/birbudak/backups/bagdam/db_$(date '+%Y-%m-%d')*.dump 2>/dev/null | tail -1 | awk '{print $5}' || echo "YOK")
BK_BAG_STATE=$(cat /var/lib/birbudak-monitor/backup-bagdam.last 2>/dev/null || echo "durum yok")
```

Mesaj bloğunda `📦 Floovent DB:` satırının altına:

```bash
msg+="📦 Bagdam DB: $BK_BAG"$'\n'
msg+="☁️  Bagdam off-site: ${BK_BAG_STATE}"$'\n'
```

## 5. Cron satırları (root crontab — `crontab -e`)

```cron
# === bagdam ===
30 3 * * *   RCLONE_REMOTE=r2:bagdam-backups AGE_RECIPIENT=age1CHANGE_ME /opt/birbudak/scripts/backup-bagdam.sh
```

(Off-site kurulana kadar `RCLONE_REMOTE`/`AGE_RECIPIENT` verilmeden yalnız yerel yedek alınır.)
`health-check`, `error-watcher`, `daily-error-digest`, `daily-report` için yeni cron satırı **gerekmez** —
mevcut satırlar yukarıdaki yamalarla Bağdam'ı da kapsar.

## 6. Doğrulama

```bash
bash -n /opt/birbudak/scripts/health-check.sh /opt/birbudak/scripts/error-watcher.sh /opt/birbudak/scripts/daily-error-digest.sh /opt/birbudak/scripts/daily-report.sh
/opt/birbudak/scripts/health-check.sh && tail -3 /var/log/birbudak-health.log       # "OK" satırı; Bağdam 5010/5011 200 dönmeli
/opt/birbudak/scripts/backup-bagdam.sh && tail -5 /var/log/birbudak-backup.log        # "OK - DB:…"
ls -la /opt/birbudak/backups/bagdam/ && cat /var/lib/birbudak-monitor/backup-bagdam.last
```
