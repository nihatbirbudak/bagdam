# Bağdam — F1 sunucu kurulum runbook'u (deploy/ops)

> Bu klasördeki dosyalar **sunucuya kopyalanacak** yapılandırmalardır; repo'da tutulur, sunucuda elle uygulanır.
> Kaynak kararlar: [ADR-0001](../docs/adr/0001-yigin.md) (yığın, Node 22, PM2), [ADR-0011](../docs/adr/0011-ortamlar-ve-gelistirme-db.md) (staging), [ADR-0012](../docs/adr/0012-yayin-stratejisi.md) (coming-soon, Cloudflare/SSL), [ADR-0015](../docs/adr/0015-guvenlik-ve-repo.md) (kısıtlı CI anahtarı, yedek), [BACKEND-PLANI §7](../docs/BACKEND-PLANI.md), [YOL-HARITASI F1](../docs/YOL-HARITASI.md).
> Sunucu adresi/portu repo'da **yazılmaz** — `<SUNUCU_IP>` ve `<SSH_PORT>` yer tutucudur (gerçek değerler gitignore'lu `docs/sunucu-baglanti.md`'de). Ortak sunucudur: `/opt/uyanisakademi`, `/opt/floovent`, diğer vhost'lar ve PG veritabanlarına **dokunulmaz**.

## Dosya haritası

| Repo | Sunucu | Ne |
|---|---|---|
| `deploy.sh` (kök) | `/opt/bagdam/deploy.sh`, `/opt/bagdam-staging/deploy.sh` (git ile gelir) | deploy akışı: flock → fetch/reset → install → generate → build → citext → pre-migrate dump → migrate → reload → health → pm2 save |
| `ecosystem.config.js` (kök) | `/opt/bagdam/ecosystem.config.js` (git ile gelir) | PM2: `bagdam-api` :5010, `bagdam-api-staging` :5011 |
| `.github/workflows/deploy.yml`, `deploy-staging.yml` | GitHub Actions | main → `bagdam`, staging → `bagdam-staging` (kısıtlı SSH anahtarı) |
| `deploy/scripts/deploy-dispatch.sh` | `/opt/birbudak/scripts/deploy-dispatch.sh` | SSH forced-command: yalnız `bagdam` / `bagdam-staging` |
| `deploy/scripts/backup-bagdam.sh` | `/opt/birbudak/scripts/backup-bagdam.sh` | 03:30 yedek (DB + uploads; 7 gün yerel; rclone/age off-site) |
| `deploy/scripts/health-check-snippet.md` | `health-check.sh`, `error-watcher.sh`, `daily-error-digest.sh`, `daily-report.sh` yamaları | izleme satırları |
| `deploy/scripts/logrotate-birbudak` | `/etc/logrotate.d/birbudak` | ops log rotasyonu |
| `deploy/nginx/conf.d/02-bagdam-cache.conf` | `/etc/nginx/conf.d/` | proxy_cache_path `bagdam_html` + gzip_types |
| `deploy/nginx/snippets/*.conf` | `/etc/nginx/snippets/` | güvenlik header'ları, proxy parametreleri |
| `deploy/nginx/{bagdam.com,admin.bagdam.com,staging.bagdam.com,admin-staging.bagdam.com}.conf` | `/etc/nginx/sites-available/` + `sites-enabled/` symlink | vhost'lar |
| `deploy/maintenance/bakim.html` | `/var/www/maintenance/bagdam/bakim.html` | 502/503/504 bakım sayfası |

Sırayla uygulanır; her adımın sonunda "Doğrula" komutu çalıştırılır. Tahmini süre: 2–3 saat (Cloudflare yayılımı hariç).

---

## 0. Ön koşullar (lokal)

- SSH erişimi: `ssh bagdam` alias'ı (`~/.ssh/config`; key auth). Aşağıdaki komutlar aksi belirtilmedikçe **sunucuda root** olarak çalışır.
- Repo GitHub'da public; `main` ve `staging` branch'leri var; secret scanning + push protection açık (F0).
- Cloudflare panelinde `bagdam.com` zone'u ve API/token erişimi (F0'da teyit edildi); Bot Fight Mode **kapalı**.

## 1. Sunucu envanteri (salt-okunur kontrol)

```bash
node -v && pnpm -v && pm2 -v && nginx -v && psql --version          # Node 20.x, pnpm 9.15.x, PM2 6, nginx 1.18, PG 14
pm2 ls                                                                # uyanisakademi-api, floovent-*, pm2-logrotate — dokunma
ls /opt /opt/birbudak/scripts /etc/nginx/conf.d /etc/nginx/sites-enabled
free -h && df -h /                                                    # RAM ≥ 2 GB boş, disk ≥ 10 GB boş
```

## 2. Node 22 (proje bazlı; global Node 20 değişmez — ADR-0001)

`n` ile yalnız indirme (`-d` = etkinleştirme YOK; `/usr/local/bin/node` 20 kalır):

```bash
npm i -g n                                   # n yoksa (global npm paketi; başka projeyi etkilemez)
n -d 22                                      # indirir, etkinleştirmez → /usr/local/n/versions/node/22.x.y/
N22="$(ls -d /usr/local/n/versions/node/22.* | sort -V | tail -1)"
ln -sfn "$N22" /usr/local/n/versions/node/22 # ecosystem.config.js'in beklediği sabit yol
/usr/local/n/versions/node/22/bin/node -v    # v22.x.y
node -v                                      # hâlâ v20.x (global değişmedi) ✓
```

Alternatif (n istenmiyorsa): `https://nodejs.org/dist/latest-v22.x/` tarball'ını `/usr/local/n/versions/node/22.x.y/` altına açıp aynı symlink'i verin. Başka bir yol kullanılacaksa PM2 başlatılırken `BAGDAM_NODE=/yol/bin/node` verilir (bkz. `ecosystem.config.js`).

> Not: PM2 **cluster** modunda worker'lar PM2 daemon'unun Node'u ile açılabilir (`interpreter` yok sayılabilir). Adım 13'te `pm2 show bagdam-api` → "node.js version" satırı 22 değilse `BAGDAM_EXEC_MODE=fork` ile başlatın (reload = restart; kesinti nginx bakım sayfasıyla örtülür) ve `docs/SISTEM-DURUMU.md`'ye not düşün.

## 3. Dizinler + repo klonu

```bash
mkdir -p /opt/bagdam /opt/bagdam-staging /opt/birbudak/backups/bagdam/{pre-migrate,monthly} /opt/birbudak/backups/bagdam-staging/pre-migrate
git clone --branch main    https://github.com/<ORG>/<REPO>.git /opt/bagdam
git clone --branch staging https://github.com/<ORG>/<REPO>.git /opt/bagdam-staging
mkdir -p /opt/bagdam/logs /opt/bagdam-staging/logs /opt/bagdam/apps/api/uploads /opt/bagdam-staging/apps/api/uploads
chmod +x /opt/bagdam/deploy.sh /opt/bagdam-staging/deploy.sh
```

Repo public olduğu için clone anahtarsız HTTPS ile yapılır (deploy.sh `git fetch origin` aynı remote'u kullanır).

## 4. PostgreSQL: roller + veritabanları + citext

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE bagdam    LOGIN PASSWORD 'CHANGE_ME_bagdam';      -- uygulama (DDL + DML)
CREATE ROLE bagdam_ro LOGIN PASSWORD 'CHANGE_ME_bagdam_ro';   -- salt-okunur tünel (ADR-0011)
CREATE DATABASE bagdam_db      OWNER bagdam ENCODING 'UTF8' LC_COLLATE 'tr_TR.UTF-8' LC_CTYPE 'tr_TR.UTF-8' TEMPLATE template0;
CREATE DATABASE bagdam_staging OWNER bagdam ENCODING 'UTF8' LC_COLLATE 'tr_TR.UTF-8' LC_CTYPE 'tr_TR.UTF-8' TEMPLATE template0;
SQL
# tr_TR locale sunucuda yoksa (locale -a | grep tr_TR) LC_* satırlarını kaldırın (en_US.UTF-8 kalır; sıralama uygulama tarafında).
for db in bagdam_db bagdam_staging; do
  sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE $db TO bagdam_ro;
GRANT USAGE ON SCHEMA public TO bagdam_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE bagdam IN SCHEMA public GRANT SELECT ON TABLES TO bagdam_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE bagdam IN SCHEMA public GRANT SELECT ON SEQUENCES TO bagdam_ro;
SQL
done
```

> `ALTER DEFAULT PRIVILEGES FOR ROLE bagdam` → `bagdam` rolünün (migrate deploy) ileride oluşturacağı tablolar otomatik `bagdam_ro`'ya SELECT verir; mevcut tablolar için ayrıca `GRANT SELECT ON ALL TABLES IN SCHEMA public TO bagdam_ro;`.
> Parolalar şifre kasasına; repo'ya ve bu dosyaya **asla**. Prod DB'ye dışarıdan yalnız `bagdam_ro` ile SSH tüneli (`docs/sunucu-baglanti.md`).

Doğrula: `sudo -u postgres psql -tAc "select datname from pg_database" | grep bagdam` → iki satır; `sudo -u postgres psql -d bagdam_db -tAc "select extname from pg_extension" | grep citext`.

## 5. `.env` dosyaları (600; sır yalnız burada)

Şablon: repo kökü `.env.example` (başka görevde üretilir). Asgari anahtarlar (BACKEND-PLANI §7):

```bash
install -m 600 /dev/null /opt/bagdam/apps/api/.env
cat > /opt/bagdam/apps/api/.env <<'ENV'
NODE_ENV=production
PORT=5010
HOST=127.0.0.1
TZ=Europe/Istanbul
DATABASE_URL=postgresql://bagdam:CHANGE_ME_bagdam@127.0.0.1:5432/bagdam_db?schema=public&connection_limit=5&pool_timeout=20
JWT_SECRET=CHANGE_ME_64_hex
JWT_REFRESH_SECRET=CHANGE_ME_64_hex
SETTINGS_ENCRYPTION_KEY=CHANGE_ME_32_byte_hex
WEB_URL=https://bagdam.com
ADMIN_URL=https://admin.bagdam.com
ENABLE_CRON=true
SITE_MODE=coming-soon
PAYMENT_PROVIDER=manual
DISABLE_MAIL=true
UPLOADS_DIR=/opt/bagdam/apps/api/uploads
SEED_ADMIN_EMAIL=CHANGE_ME
SEED_ADMIN_PASSWORD=CHANGE_ME
ENV
# Sırlar: openssl rand -hex 32  (JWT_SECRET, JWT_REFRESH_SECRET, SETTINGS_ENCRYPTION_KEY için ayrı ayrı)
```

Staging için `/opt/bagdam-staging/apps/api/.env`: `PORT=5011`, `DATABASE_URL=…/bagdam_staging…`, `WEB_URL=https://staging.bagdam.com`, `ADMIN_URL=https://admin-staging.bagdam.com`, `ENABLE_CRON=false`, `SITE_MODE=full`, `UPLOADS_DIR=/opt/bagdam-staging/apps/api/uploads`; JWT/şifreleme anahtarları **prod'dan farklı**. `PORT/HOST/TZ/ENABLE_CRON/SITE_MODE` değerleri `ecosystem.config.js` ile aynı tutulur (çakışma yok).

Doğrula: `ls -l /opt/bagdam*/apps/api/.env` → `-rw-------`; env-validator eksik anahtarda fail-fast verir (ilk deploy'da görülür).

## 6. Cloudflare Origin CA (SSL; yenileme yok)

Cloudflare panel → bagdam.com → **SSL/TLS → Origin Server → Create Certificate**: "Generate private key and CSR with Cloudflare", RSA 2048, hostnames `*.bagdam.com` ve `bagdam.com`, geçerlilik 15 yıl. Çıkan PEM'leri sunucuya:

```bash
mkdir -p /etc/ssl/bagdam && chmod 755 /etc/ssl/bagdam
cat > /etc/ssl/bagdam/origin.pem   # "Origin Certificate" içeriğini yapıştır, Ctrl-D
cat > /etc/ssl/bagdam/origin.key   # "Private Key" içeriğini yapıştır, Ctrl-D
chmod 644 /etc/ssl/bagdam/origin.pem && chmod 600 /etc/ssl/bagdam/origin.key
openssl x509 -in /etc/ssl/bagdam/origin.pem -noout -subject -dates -ext subjectAltName
```

Origin CA yalnız Cloudflare proxy arkasında güvenilirdir; yerel testlerde `curl -k` veya `http://127.0.0.1:5010` kullanılır. Aynı panelde **SSL/TLS → Overview → Full (strict)**, **Edge Certificates → Always Use HTTPS: On**, **HSTS: On** (max-age 6 ay, includeSubDomains, preload kapalı), **Minimum TLS 1.2**.

## 7. nginx

> ⚠️ **2026-08-20 itibarıyla sunucuda geçici bir `sites-available/bagdam.com.conf` VAR** (statik coming-soon, Let's Encrypt sertifikalı — bkz. [deploy/coming-soon/README.md](coming-soon/README.md)). Aşağıdaki döngü bu dosyanın **üzerine yazar**; önce `/etc/ssl/bagdam/origin.pem` hazır olmalı (§6), aksi hâlde `nginx -t` düşer. `/var/www/bagdam-comingsoon` ve LE sertifikası (`/etc/letsencrypt/live/bagdam.com`) zararsız, silinmeyebilir.

```bash
cd /opt/bagdam/deploy/nginx
mkdir -p /var/cache/nginx/bagdam && chown www-data:www-data /var/cache/nginx/bagdam
mkdir -p /var/www/maintenance/bagdam && install -m 644 ../maintenance/bakim.html /var/www/maintenance/bagdam/bakim.html
install -m 644 conf.d/02-bagdam-cache.conf /etc/nginx/conf.d/
install -m 644 snippets/bagdam-security-headers.conf snippets/bagdam-proxy-params.conf /etc/nginx/snippets/
for f in bagdam.com admin.bagdam.com staging.bagdam.com admin-staging.bagdam.com; do
  install -m 644 "$f.conf" /etc/nginx/sites-available/"$f.conf"
  ln -sfn /etc/nginx/sites-available/"$f.conf" /etc/nginx/sites-enabled/"$f.conf"
done
# staging basic auth (kullanıcı: bagdam; parola sorulur)
printf 'bagdam:%s\n' "$(openssl passwd -apr1)" > /etc/nginx/.htpasswd-bagdam
chown root:www-data /etc/nginx/.htpasswd-bagdam && chmod 640 /etc/nginx/.htpasswd-bagdam
nginx -t && systemctl reload nginx
```

Doğrula (yerelden, Cloudflare olmadan):

```bash
curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: bagdam.com' https://127.0.0.1/                # 502 + bakim.html (API henüz yok) → normal
curl -sk -H 'Host: bagdam.com' https://127.0.0.1/ | grep -c 'bakımdayız'                           # 1
curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: staging.bagdam.com' https://127.0.0.1/         # 401 (basic auth)
curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: staging.bagdam.com' -u bagdam https://127.0.0.1/api/v1/health   # 502 (API yok) → sonra 200
```

Kurallar: vhost'lar yalnız `sites-available/bagdam*.conf` ve `admin*.bagdam.com.conf`; diğer projelerin dosyalarına dokunulmaz. `nginx -t` hata verirse reload YAPMAYIN — düzeltin.

## 8. Cloudflare DNS + kurallar

DNS (proxied = turuncu bulut):

| Tür | Ad | Hedef | Proxy |
|---|---|---|---|
| A | `@` | `<SUNUCU_IP>` | proxied |
| CNAME | `www` | `bagdam.com` | proxied |
| CNAME | `admin` | `bagdam.com` | proxied |
| CNAME | `staging` | `bagdam.com` | proxied |
| CNAME | `admin-staging` | `bagdam.com` | proxied |
| MX / TXT (SPF) / CNAME (DKIM) / TXT `_dmarc` | e-posta sağlayıcısı (Resend/SES) verir | — | **DNS only** |

Kurallar:
- **Security → WAF → Custom rules**: "Skip" kuralı — `(http.host eq "bagdam.com" or http.host eq "staging.bagdam.com") and (starts_with(http.request.uri.path, "/api/v1/webhooks") or http.request.uri.path matches "^/api/v1/payments/.+/callback$" or starts_with(http.request.uri.path, "/api/v1/pay/"))` → Skip: all remaining custom rules, rate limiting, managed rules, Bot Fight Mode.
- **Security → Bots**: Bot Fight Mode **Off** (F0; webhook/callback'i bozar).
- **Caching → Cache Rules**: (1) `URI Path starts with "/api/"` → Bypass cache; (2) `URI Path starts with "/assets/"` or `equals "/styles.css"` → Eligible for cache, Edge TTL 1 ay, Browser TTL: origin header'ına uy. HTML için Cloudflare varsayılanı (cache yok) kalır; 10 s micro-cache origin'de.
- **Rules → Settings**: Rocket Loader **Off**, Auto Minify **Off** (piksel parite ve cart.js yamaları; ADR-0003).
- **Speed**: Brotli On (gzip_types origin'de; CF yeniden sıkıştırır).

Doğrula (yayılım sonrası): `dig +short bagdam.com` Cloudflare IP'leri; `curl -sI https://bagdam.com | grep -i 'server: cloudflare'`.

## 9. GitHub Actions: kısıtlı deploy anahtarı + dispatcher + secrets (ADR-0015)

```bash
# Dispatcher
install -m 750 -o root -g root /opt/bagdam/deploy/scripts/deploy-dispatch.sh /opt/birbudak/scripts/deploy-dispatch.sh
# Bağdam'a özel anahtar (UA'nın github-actions-deploy anahtarı KULLANILMAZ)
ssh-keygen -t ed25519 -C bagdam-github-actions -f /root/.ssh/bagdam_github_actions -N ""
PUB="$(cat /root/.ssh/bagdam_github_actions.pub)"
echo "command=\"/opt/birbudak/scripts/deploy-dispatch.sh\",restrict $PUB" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
cat /root/.ssh/bagdam_github_actions        # → GitHub secret SERVER_SSH_KEY (sonra sunucudan silin: shred -u)
```

GitHub → repo → **Settings → Secrets and variables → Actions**: `SERVER_HOST=<SUNUCU_IP>`, `SERVER_PORT=<SSH_PORT>`, `SERVER_SSH_KEY=<özel anahtar>`. **Settings → Environments**: `production` (required reviewer: siz; branch: main) ve `staging` (branch: staging) ortamları oluşturun — workflow'lar `environment:` ile bunlara bağlıdır.

Doğrula (lokalden, `shred` etmeden önce özel anahtarla):
```bash
ssh -i bagdam_github_actions -p <SSH_PORT> root@<SUNUCU_IP> bagdam-staging     # deploy akışı başlar (adım 12 sonrası)
ssh -i bagdam_github_actions -p <SSH_PORT> root@<SUNUCU_IP> 'ls /'              # "deploy-dispatch: reddedildi" + exit 1 ✓
ssh -i bagdam_github_actions -p <SSH_PORT> root@<SUNUCU_IP>                     # pty yok, boş komut → reddedilir ✓
tail -5 /var/log/birbudak-deploy-dispatch.log
```

## 10. Yedek + izleme + logrotate

```bash
install -m 700 /opt/bagdam/deploy/scripts/backup-bagdam.sh /opt/birbudak/scripts/backup-bagdam.sh
install -m 644 /opt/bagdam/deploy/scripts/logrotate-birbudak /etc/logrotate.d/birbudak && logrotate -d /etc/logrotate.d/birbudak
# Off-site (ADR-0015): rclone + age
curl -fsSL https://rclone.org/install.sh | bash && rclone config          # remote adı: r2 (Cloudflare R2) / hetzner (Storage Box) …
apt-get install -y age && age-keygen -o /root/.config/age/bagdam-backup.key   # "public key: age1…" satırını not edin; özel anahtar şifre kasasına
crontab -e
```

Cron satırı (root):
```cron
30 3 * * *   RCLONE_REMOTE=r2:bagdam-backups AGE_RECIPIENT=age1CHANGE_ME /opt/birbudak/scripts/backup-bagdam.sh
```

İzleme betiklerine satır ekleme: [`scripts/health-check-snippet.md`](scripts/health-check-snippet.md) (health-check ENDPOINTS 5010/5011, error-watcher/daily-error-digest `DBS`, daily-report backup satırı).

Doğrula: `/opt/birbudak/scripts/backup-bagdam.sh; tail -3 /var/log/birbudak-backup.log; ls -la /opt/birbudak/backups/bagdam/` (boş DB dump ~1–3 KB normal) · `rclone ls r2:bagdam-backups/daily` · `/opt/birbudak/scripts/health-check.sh; tail -2 /var/log/birbudak-health.log`.

## 11. İlk deploy (staging → prod sırası)

PM2 ilk başlatmayı deploy.sh yapar (`pm2 describe` yoksa `pm2 start … --only`). Build Node 22 PATH'iyle çalışır.

```bash
bash /opt/bagdam-staging/deploy.sh bagdam-staging      # 1) staging
curl -fs http://127.0.0.1:5011/api/v1/health; echo
bash /opt/bagdam/deploy.sh bagdam                      # 2) prod
curl -fs http://127.0.0.1:5010/api/v1/health; echo
pm2 save && pm2 startup                                # startup zaten UA için kurulu; komut idempotent
```

Deploy günlüğü: `/opt/bagdam*/logs/deploy.log`; son SHA: `cat /opt/bagdam/.last-deploy-sha`.

## 12. CI'dan deploy

- `staging` branch'ine push → **Deploy to Staging** yeşil → `https://staging.bagdam.com` (basic auth) bugünkü statik site.
- `main`'e PR merge → **Deploy to Production** (environment onayı) → `https://bagdam.com` coming-soon.
- Concurrency: workflow'da `deploy-production` / `deploy-staging` grupları + sunucuda flock; ikinci push kuyruğa girer.

## 13. Doğrulama (F1 "bitti sayılır")

```bash
# API
curl -fs http://127.0.0.1:5010/api/v1/health && curl -fs http://127.0.0.1:5011/api/v1/health
pm2 show bagdam-api | grep -E 'node.js version|exec mode|status|interpreter'     # Node 22 beklenir (bkz. §2 notu)
# Site (Cloudflare üzerinden)
curl -sI https://bagdam.com | grep -iE '^(HTTP|server|strict-transport|x-cache-status|x-frame)'
curl -s https://bagdam.com | grep -c 'application/ld+json'                          # coming-soon JSON-LD ≥ 1
curl -s -o /dev/null -w '%{http_code}\n' https://www.bagdam.com/                    # 301 → apex
curl -s -o /dev/null -w '%{http_code}\n' https://staging.bagdam.com/                 # 401
curl -s -o /dev/null -w '%{http_code}\n' -u bagdam https://staging.bagdam.com/       # 200
curl -s -o /dev/null -w '%{http_code}\n' https://staging.bagdam.com/api/v1/webhooks/x   # 404 (auth yok → app'e ulaştı) — 401 değil
curl -sI https://bagdam.com/assets/logo/logo-icon.svg | grep -i 'cache-control'      # immutable
# Bakım sayfası
pm2 stop bagdam-api-staging && curl -s -u bagdam -o /dev/null -w '%{http_code}\n' https://staging.bagdam.com/   # 502 + bakim.html
pm2 start bagdam-api-staging
# Yedek + izleme
ls /opt/birbudak/backups/bagdam/ && cat /var/lib/birbudak-monitor/backup-bagdam.last
tail -3 /var/log/birbudak-health.log
```

## 14. Bakım modu (basit)

- Kısa kesinti: `pm2 stop bagdam-api` → nginx otomatik `bakim.html` (502) verir; `pm2 start bagdam-api` ile döner.
- Planlı uzun bakım için UA'daki `maintenance-toggle.sh` kalıbı Bağdam için parametrik hâle getirilebilir (ayrı vhost + 503, `Retry-After`): F1 sonrası ops işi.

## 15. Geri alma

deploy.sh her zaman `origin/<branch>`'i uygular; kod geri alma = branch'i geri almak:

```bash
# Lokalde: git revert <kötü-sha> → PR → main (CI deploy) — veya acilde doğrudan:
git revert --no-edit <kötü-sha> && git push origin main        # → Deploy to Production tetiklenir
cat /opt/bagdam/.last-deploy-sha                                 # sunucudaki son başarılı SHA
```

DB geri alma yalnız bilinçli ve pre-migrate dump ile (`/opt/birbudak/backups/bagdam/pre-migrate/`, 14 gün):

```bash
ls -lt /opt/birbudak/backups/bagdam/pre-migrate/ | head
pg_restore --list /opt/birbudak/backups/bagdam/pre-migrate/<dosya>.dump | head          # içerik kontrolü
pm2 stop bagdam-api
sudo -u postgres pg_restore --clean --if-exists --no-owner --no-acl -d bagdam_db /opt/birbudak/backups/bagdam/pre-migrate/<dosya>.dump
pm2 start bagdam-api
```

Restore provası (F10'dan itibaren aylık): aynı dump'ı geçici `bagdam_restore_test` DB'sine açıp satır sayılarını karşılaştırın, sonra DB'yi silin.
