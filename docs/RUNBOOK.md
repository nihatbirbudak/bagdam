# Bağdam — Operasyon Runbook'u

> Kapsam: **çalışan sistemi yönetmek.** Sunucunun ilk kurulumu `deploy/README.md`'de (F10b), mimari kararlar
> `docs/adr/`'de, akış diyagramları `docs/state-machines.md`'de. Bu belge "bugün ne oluyor, bozulursa ne yapılır"
> sorusunu cevaplar. Son güncelleme: 2026-08-21 (F10 sonu · entegrasyon doğrulaması D).
>
> Saat dilimi **her yerde Europe/Istanbul** (ADR-0004). Aşağıdaki tüm saatler yereldir.

## İçindekiler

1. [Sistem haritası](#1-sistem-haritası)
2. [Günlük operasyon](#2-günlük-operasyon)
3. [Zamanlanmış işler (cron)](#3-zamanlanmış-işler-cron)
4. [İzleme](#4-i̇zleme)
5. [Olay müdahale](#5-olay-müdahale)
6. [Yedek ve geri yükleme](#6-yedek-ve-geri-yükleme)
7. [Performans](#7-performans)
8. [Lansman kontrol listesi (F11)](#8-lansman-kontrol-listesi-f11)
9. [Kullanıcı aksiyonları (geliştirme dışı)](#9-kullanıcı-aksiyonları-geliştirme-dışı)
10. [F10 doğrulama sonuçları](#10-f10-doğrulama-sonuçları)

---

## 1. Sistem haritası

| Bileşen | Nerede | Nasıl bakılır |
|---|---|---|
| API + web sayfaları | PM2 `bagdam-api`, `127.0.0.1:5010` | `pm2 status bagdam-api` · `curl -s localhost:5010/api/v1/health` |
| Staging | PM2 `bagdam-api-staging`, `:5011` (`ENABLE_CRON=false`) | `staging.bagdam.com` (basic auth) |
| Admin paneli | `admin.bagdam.com` — statik SPA (`apps/admin/dist/app/*`) + `/api/` proxy | tarayıcı |
| Veritabanı | PostgreSQL `bagdam_db` (staging: `bagdam_staging`) | `sudo -u postgres psql -d bagdam_db` |
| Yüklemeler | `/opt/bagdam/apps/api/uploads` (nginx `/uploads/`) | `du -sh` |
| nginx | apex + `admin.` + `staging.` vhost'ları, HTML için `proxy_cache bagdam_html` (10 s) | `nginx -t` · `/var/log/nginx/` |
| Ödeme | PayTR (ADR-0019); callback `POST /api/v1/payments/paytr/callback` | admin › Sistem › Webhook olayları |
| E-posta | SMTP (Setting `mail.*` → `.env SMTP_*`); `DISABLE_MAIL=true` ise dosyaya önizleme | admin › Sistem › E-posta günlüğü |

**Kritik ayarlar** panelden (admin › Ayarlar) değiştirilir, dağıtım gerektirmez:
`commerce.cutoff` (varsayılan teslimattan 1 gün önce 12:00) · `commerce.deliveryDays` (Salı/Perşembe/Cumartesi) ·
`commerce.dunning.retryHours` (`[2, 12]`, ADR-0020) · `commerce.paymentLinkHours` (20) ·
`commerce.deliveryDatesHorizonWeeks` (8) · `payment.provider` · `privacy.*` (saklama süreleri).

> ⚠️ `SettingsService` grup satırlarını **60 s** önbellekler. Panelden yapılan ayar değişikliği en geç bir dakikada etkir;
> DB'ye elle `psql` ile yazılırsa süreç yeniden başlatılana kadar eski değeri kullanabilir.

---

## 2. Günlük operasyon

### 2.1 Haftalık ritim

| Ne zaman | Ne olur | Kim |
|---|---|---|
| Teslimattan **2 gün önce** | Haftanın kutusu (BoxTemplate) hazırlanır ve **yayınlanır** — yayınlanmamış şablon varsa `cycles:ensure` o hafta için cycle üretemez | içerik/ops |
| Teslimattan **1 gün önce 11:00** | `reminders:cutoff` maili müşterilere gitmiş olmalı (kesimden ~24 s önce) | otomatik |
| Teslimattan **1 gün önce 12:00** | **KESİM.** `cycles:lock-and-charge` cycle'ları kilitler, snapshot alır, tahsil eder | otomatik (5 dk'da bir) |
| Kesimden hemen sonra | admin › **Ödeme Problemleri** (ekran 18) kontrol edilir; UNPAID/AWAITING_PAYMENT satırlar telefonla/mailleyle takip | ops |
| Kesim + 2 s / + 12 s | `payments:retry` başarısız tahsilatları tekrar dener | otomatik |
| Teslimat günü **08:00** | Dunning penceresi kapanır; bu saatten sonra tahsil edilen kutu hazırlanamaz → `SKIPPED(UNPAID)` | otomatik (ADR-0020) |
| Teslimat günü sabah | admin › **Teslimat Günü** (ekran 20): toplama listesi → paketleme fişleri yazdırılır | ops |
| Teslimat günü | Kutular hazırlanır → toplu durum `PREPARING` → `OUT_FOR_DELIVERY` → `DELIVERED` | ops |
| Teslimat sonrası | Teslim edilemeyenler `DELIVERY_FAILED` işaretlenir + telafi (admin › Abonelikler › detay) | ops |

**Teslimat günü akışı, ekran ekran:**

1. admin › **Teslimat Günü** → tarih + bölge seç.
2. *Kutular* sekmesi: o günün cycle'ları. Ödemesi alınmamış olan (`AWAITING_PAYMENT` / `UNPAID`) listede **görünmez** — onlar Ödeme Problemleri ekranındadır.
3. *Toplama listesi* (pick): ürün bazında toplam miktar + müşteri tercihleri. Yazdır.
4. *Paketleme fişi* (packing): müşteri başına içerik + adres + telefon. Yazdır.
5. Kutular çıkarken: seç → **toplu durum** `OUT_FOR_DELIVERY`.
6. Gün sonunda: teslim edilenler `DELIVERED`, edilemeyenler `DELIVERY_FAILED`.

> `pick-list` / `packing-list` yalnız **CHARGED · PREPARING · OUT_FOR_DELIVERY** cycle'ları kapsar (ödemesi alınmış kutular).
> `day-summary` tüm durumları sayar — gün başında ikisini karşılaştırın: fark = tahsil edilememiş kutu sayısı.

### 2.2 Ödeme problemleri (ekran 18)

| Belirti | Anlamı | Aksiyon |
|---|---|---|
| Cycle `UNPAID` | Kart reddedildi, dunning denemeleri sürüyor ya da bitti | Müşteriyle iletişim → kart güncelletin → **"yeniden çek"** |
| Cycle `AWAITING_PAYMENT` | Saklı kart yok → ödeme linki gönderildi | **"ödeme linki gönder"** (yeni link, süresi `paymentLinkHours`) |
| Abonelik `PAST_DUE` | Üst üste 2 UNPAID | Müşteriye ulaşın; kart düzelince ilk başarılı tahsilatta `ACTIVE`'e döner |
| Sipariş `PAYMENT_FAILED` | Checkout ödemesi tamamlanmadı | 24 s içinde ödenmezse `payments:reconcile` iptal eder + teslimat günü rezervini iade eder |

> Aynı sorun listede **iki satır** üretebilir (cycle `UNPAID` + ilgili Order `PAYMENT_FAILED`). "Yeniden çek" yalnız cycle
> satırında çıkar; başarılı olunca iki satır da düşer.

### 2.3 Sık yapılan işler

```bash
# Bir job'u elle çalıştır (panelden: Sistem › İşleri çalıştır; API'den:)
curl -sX POST localhost:5010/api/v1/admin/jobs/cycles:ensure/run -H 'Cookie: …' -H 'X-CSRF-Token: …'

# Son cron koşuları
sudo -u postgres psql -d bagdam_db <<'SQL'
select name, status, "startedAt", "itemsProcessed", errors from cron_logs order by "startedAt" desc limit 20;
SQL

# Son hatalar
sudo -u postgres psql -d bagdam_db <<'SQL'
select "createdAt", module, action, message from system_logs where level='ERROR' order by "createdAt" desc limit 20;
SQL
```

> ⚠️ `POST /admin/jobs/:name/run` gövdesinde **`now` göndermeyin.** Üretimde zaten 403 (`JOB_NOW_OVERRIDE_FORBIDDEN`);
> `ALLOW_JOB_TIME_OVERRIDE=true` ile açılırsa ileri tarihli bir `now` **gerçek cycle'ları erken kilitler.**

---

## 3. Zamanlanmış işler (cron)

Yalnız PM2 instance 0'da ve `ENABLE_CRON=true` iken çalışır (staging'de kapalı). Her koşu `cron_logs`'a yazılır.

| Job | Sıklık | Ne yapar | Bozulursa belirti |
|---|---|---|---|
| `delivery-dates:generate` | Her gün 00:30 | Aktif bölge × teslimat günü için ufuk (8 hafta) kadar `DeliveryDate` üretir (idempotent) | Sepette gün seçilemez; `cycles:ensure` hata sayar |
| `cycles:ensure` | Saat başı | Canlı aboneliklerin önündeki haftalar için `SCHEDULED` cycle açar (yayınlanmış şablon + gün rezervi) | Hafta gelmesine rağmen müşteride kutu görünmez |
| `cycles:lock-and-charge` | 5 dk | **Kesim.** Kesimi geçmiş `SCHEDULED` → LOCKED → Order → tahsilat (MIT) ya da ödeme linki | Kesim geçti ama kutular hâlâ `SCHEDULED` |
| `cycles:expire-payment-links` | 10 dk | Süresi dolan link: `AWAITING_PAYMENT` → `UNPAID` (+ dunning) | Ödenmemiş kutular süresiz bekler |
| `payments:retry` | 15 dk | Dunning: `UNPAID` cycle yeniden dener (`retryHours`, teslimat günü 08:00 sınırı) | Reddedilen kartlar hiç tekrar denenmez |
| `reminders:cutoff` | Saat başı | Kesimden ~24 s önce hatırlatma maili (cycle başına bir kez) | Müşteri "haberim olmadı" der |
| `payments:reconcile` | 15 dk | Açık checkout ödemeleri: 30 dk sonra sağlayıcıya sorar, 24 s sonra `EXPIRED` + Order `CANCELLED` + gün rezervi iade | `PENDING_PAYMENT` siparişler birikir, teslimat kapasitesi boşa rezerve kalır |
| `kvkk:purge` | Her gün 03:15 | KVKK saklama matrisi: MailLog/SystemLog/CronLog yaş bazlı silme (+ mail önizleme dosyaları), AuditLog PII maskeleme, (açıksa) pasif müşteri anonimleştirme. Süreler Setting `privacy.*` | Günlük tabloları büyür; saklama taahhüdü ihlal edilir (`docs/kvkk-veri-saklama.md`) |

**Cron sağlığı:** `cron_logs`'ta aynı job için üst üste **2 `FAILED`** → Telegram uyarısı (`error-watcher`).
Elle kontrol: yukarıdaki `cron_logs` sorgusu; hiç satır yoksa `ENABLE_CRON` ya da PM2 instance sayısına bakın.

---

## 4. İzleme

| Kanal | Ne söyler | Nasıl bakılır |
|---|---|---|
| `GET /api/v1/health` | Süreç ayakta + DB bağlantısı | `curl -s localhost:5010/api/v1/health` → `{"status":"ok","db":"up",…}` (DB düşükse `degraded`/`down`) |
| `GET /api/v1/admin/health/detailed` | Sürüm, uptime, DB, cron son koşuları, kuyruk sayıları | admin › Sistem › sağlık kartı |
| `health-check.sh` | 5 dk'da bir PM2 + HTTP; crash sayacı | `/var/log/birbudak-health.log` |
| `error-watcher.sh` | 2 dk'da bir `system_logs` ERROR → Telegram | `/var/lib/birbudak-monitor/` |
| `daily-report.sh` | Sabah özeti (yedek, hata, restart) | Telegram |
| admin › Sistem (ekran 22) | Audit / sistem / cron / mail / webhook günlükleri, filtreli | tarayıcı |
| nginx | 5xx oranı, yavaş istekler | `tail -f /var/log/nginx/bagdam.error.log` |

**Sabah 3 dakikalık kontrol:** ① `pm2 status` ② admin › Özet (ekran 21) ③ admin › Ödeme Problemleri sayacı ④ dünkü `cron_logs` FAILED var mı.

---

## 5. Olay müdahale

Her senaryoda sıra aynı: **belirti → doğrula → durdur/geri al → kök neden → not**. Müdahale sonunda `docs/SISTEM-DURUMU.md`'ye kısa not düşün.

### 5.1 API ayakta değil (site 502)

```bash
pm2 status bagdam-api                       # status: errored / stopped?
pm2 logs bagdam-api --lines 100 --nostream  # son hata
curl -s localhost:5010/api/v1/health        # süreç var ama cevap yok mu?
```

1. nginx zaten `bakim.html` gösteriyor (502/503/504 → bakım sayfası) — panik yok, müşteri boş sayfa görmüyor.
2. `pm2 restart bagdam-api` → 30 s sonra health.
3. Düzelmiyorsa loglardaki ilk hataya bak:
   - `env-validator` hatası → `.env` bozuk/eksik (deploy sırasında mı değişti?).
   - `PrismaClientInitializationError` → §5.2.
   - `EADDRINUSE` → eski süreç asılı: `pm2 delete bagdam-api && pm2 start ecosystem.config.js --only bagdam-api`.
4. Son deploy şüpheliyse: `cat /opt/bagdam/.last-deploy-sha` → `git revert` → yeniden deploy (`deploy/README.md` §15).

### 5.2 Veritabanı ayakta değil

```bash
systemctl status postgresql
sudo -u postgres psql -c 'select 1'
df -h                                        # disk doldu mu? (en sık neden)
tail -50 /var/lib/pgsql/data/log/*.log       # ya da /var/log/postgresql/
```

1. Disk doluysa: eski yedekleri/loglara bak (`/opt/birbudak/backups`, `/var/log`), `logrotate -f /etc/logrotate.d/birbudak`.
2. `systemctl restart postgresql` → API'yi de yeniden başlat (havuz bağlantıları düşer).
3. **Veri kaybı şüphesi varsa hiçbir yazma yapmadan** §6.3'e geç.

### 5.3 PayTR callback gelmiyor

Belirti: müşteri ödedi, sipariş `PENDING_PAYMENT` kaldı.

```bash
# Gelen bildirimler
sudo -u postgres psql -d bagdam_db <<'SQL'
select "receivedAt", provider, status, "eventType" from webhook_events order by "receivedAt" desc limit 20;
SQL
# nginx tarafında istek düştü mü?
grep 'payments/paytr/callback' /var/log/nginx/bagdam.access.log | tail -20
```

| Bulgu | Anlamı | Aksiyon |
|---|---|---|
| nginx logunda hiç istek yok | PayTR bize ulaşamıyor | PayTR panelinde bildirim URL'si doğru mu; Cloudflare WAF/Bot Fight callback yolunu engelliyor mu (skip kuralı olmalı); staging'de `auth_basic off` var mı |
| `403` dönmüş | IP allowlist dışı | Setting `payment.paytrCallbackAllowedIps` — PayTR'nin güncel bildirim IP listesini ekleyin (boşsa yalnız hash doğrulanır) |
| `400` dönmüş | Hash doğrulanamadı | Setting `payment.paytrMerchantKey` / `paytrMerchantSalt` yanlış ya da test/canlı bilgisi karışmış |
| `WebhookEvent` var, `status=IGNORED` | Aynı bildirim ikinci kez geldi | Normal (idempotency) — aksiyon yok |
| Hiçbiri | Geçici kesinti | `payments:reconcile` 30 dk içinde sağlayıcıya sorup düzeltir; acele ediyorsanız job'u elle çalıştırın |

Tek bir siparişi kurtarmak: admin › Siparişler › detay → ödeme durumunu sağlayıcı panelinden doğrulayın →
**elle** `PAID`'e geçirin (audit'e düşer). Ödeme alınmadıysa asla `PAID` yapmayın.

### 5.4 Tahsilat başarısız yığını

Belirti: kesim sonrası Ödeme Problemleri'nde onlarca satır.

**1. Tek müşteri mi, herkes mi?** Herkesse sorun bizdedir, sağlayıcıdadır ya da ayardadır — hata kodlarına bakın:

```bash
sudo -u postgres psql -d bagdam_db <<'SQL'
select "failureCode", count(*) from payments
where "createdAt" > now() - interval '2 hours' and status = 'FAILED'
group by 1 order by 2 desc;
SQL
```

2. Tek bir hata kodu baskınsa → PayTR tarafı. `payment.provider` / test modu / mağaza durumu kontrol.
3. **`payment.provider = manual` çözümlenmiş olabilir** — bu durumda gerçek tahsilat yapılmaz ve süreç başlangıcında
   ERROR log'u yazılır. Ayarı `paytr`'a çekin, süreci yeniden başlatın.
4. Tahsilat toparlanamayacaksa ve kesim penceresi kapanmak üzereyse: kutuları elle `SKIPPED` bırakıp (dunning kendi yapar)
   bir sonraki haftaya telafi tanımlayın (admin › Abonelikler › detay › Telafi).
5. **Teslimat günü 08:00'i geçtiyse** yeniden çekmeyin: kutu hazırlanamaz, para alınmış olur.

### 5.5 Kesim çalışmadı

Belirti: kesim saati geçti, cycle'lar hâlâ `SCHEDULED`.

```bash
sudo -u postgres psql -d bagdam_db <<'SQL'
select name, status, "startedAt", errors from cron_logs where name='cycles:lock-and-charge' order by "startedAt" desc limit 5;
SQL
```

- Hiç satır yok → cron çalışmıyor: `ENABLE_CRON`, PM2 instance sayısı (cluster×1 olmalı), süreç ayakta mı.
- `FAILED` → `errors` alanındaki mesaja bakın; en sık neden **yayınlanmamış BoxTemplate** ya da
  ayarlardan çıkarılmış bir teslimat günü (`NOT_DELIVERY_DAY`).
- Düzelttikten sonra job'u elle çalıştırın (panelden). Kesim saatinden sonra çalıştırmak güvenlidir; gecikme kadar geç kilitlenir.

### 5.6 E-posta gitmiyor

```bash
sudo -u postgres psql -d bagdam_db <<'SQL'
select "createdAt", "templateSlug", status, error from mail_logs order by "createdAt" desc limit 20;
SQL
```

| `status` | Anlamı | Aksiyon |
|---|---|---|
| `SKIPPED` | `DISABLE_MAIL=true` | Üretimde olmamalı → `.env` düzelt + restart |
| `FAILED` + `MAIL_TRANSPORT_UNAVAILABLE` | SMTP kütüphanesi/ayarı yok | Setting `mail.*` doldur, gerekiyorsa bağımlılık kurulumunu doğrula |
| `FAILED` + kimlik hatası | SMTP parolası yanlış | admin › Ayarlar › E-posta → test gönder |
| `SENT` ama ulaşmıyor | SPF/DKIM/DMARC | DNS kayıtlarını doğrulayın; sağlayıcı panelinde bounce'lara bakın |

---

## 6. Yedek ve geri yükleme

### 6.1 Neyimiz var

| Ne | Nerede | Süre |
|---|---|---|
| Günlük DB dump (`-Fc`) + uploads tar | `/opt/birbudak/backups/bagdam/` (03:30, `backup-bagdam.sh`) | yerel 7 gün |
| Aylık kopya | `.../monthly/` | 365 gün |
| Deploy öncesi dump | `.../pre-migrate/` (`deploy.sh` üretir) | 14 gün |
| Off-site (age ile şifreli, rclone) | uzak depo `daily/` + `monthly/` | 30 / 400 gün |

Gece yedeği her koşuda `pg_restore --list` ile bütünlük kontrolünden geçer; sonuç `daily-report`'ta özetlenir.

### 6.2 Aylık restore provası (zorunlu — ADR-0015)

Yedek, geri yüklenene kadar yedek sayılmaz. Ayda bir, **üretim DB'sine dokunmadan**:

```bash
# Sunucuda
ls -lt /opt/birbudak/backups/bagdam/db_*.dump | head
pg_restore --list /opt/birbudak/backups/bagdam/db_<damga>.dump | head
sudo -u postgres createdb -O bagdam bagdam_restore_test
sudo -u postgres pg_restore -d bagdam_restore_test --no-owner --no-privileges \
  /opt/birbudak/backups/bagdam/db_<damga>.dump
sudo -u postgres psql -d bagdam_restore_test -c \
  "select 'orders', count(*) from orders union all select 'users', count(*) from users;"
sudo -u postgres dropdb bagdam_restore_test        # PROVA BİTİNCE MUTLAKA DÜŞÜR
```

Lokalde aynı prova tek komutla otomatiktir (dump → `--list` → ayrı DB → restore → 38 tablo sayım karşılaştırması →
şema/eklenti/`_prisma_migrations` doğrulaması → içerik md5 karşılaştırması → DB düşürme):

```bash
node tools/backup-restore-drill.mjs          # rapor: tools/backup-restore-report.md
```

Son prova sonucu: **10/10 adım başarılı**, 38 tablo birebir (`tools/backup-restore-report.md`).

### 6.3 Gerçek felaket: üretim DB'sini geri yükle

> Bu adımlar **veri kaybettirir** (son yedekten sonraki her şey). Önce §6.4'ü okuyun.

```bash
# 1) Yazmayı durdur
pm2 stop bagdam-api                              # nginx bakım sayfasını gösterir

# 2) MEVCUT durumu yine de yedekle (bozuk bile olsa; geri dönüş şansı)
sudo -u postgres pg_dump -Fc -d bagdam_db > /root/bagdam_before_restore_$(date +%F_%H%M).dump

# 3) Yedeği ÖNCE yan veritabanına aç ve doğrula (asla doğrudan üstüne yazma)
sudo -u postgres createdb -O bagdam bagdam_restore_test
sudo -u postgres pg_restore -d bagdam_restore_test --no-owner --no-privileges <yedek>.dump
sudo -u postgres psql -d bagdam_restore_test -c 'select max("createdAt") from orders;'   # veri ne kadar güncel?

# 4) Kararı verdiysen: üretimi değiştir
sudo -u postgres psql -c 'alter database bagdam_db rename to bagdam_db_bozuk;'
sudo -u postgres psql -c 'alter database bagdam_restore_test rename to bagdam_db;'

# 5) Aç ve doğrula
pm2 start bagdam-api && sleep 5 && curl -s localhost:5010/api/v1/health
```

Uploads geri yükleme: `tar xzf uploads_<damga>.tar.gz -C /opt/bagdam/apps/api/`.
Off-site kopya şifreliyse önce: `age -d -i bagdam-backup.key db.dump.age > db.dump`.

### 6.4 Geri yükleme yerine önce bunlara bakın

- **Tek tablo/satır mı bozuldu?** Yedeği yan DB'ye açıp yalnız o tabloyu taşımak tüm sistemi geri sarmaktan iyidir.
- **Hatalı migration mı?** `pre-migrate/` dump'ı daha yenidir (deploy anındaki hâl), günlük yedekten iyisidir.
- **Silinen veri "soft delete" olabilir:** çoğu tabloda `deletedAt` var; müşteri anonimleştirmesi geri alınamaz ama sipariş silinmez.
- **Ödeme kayıtları sağlayıcıda da var:** DB'de kaybolan bir ödeme PayTR panelinden doğrulanabilir.

---

## 7. Performans

**Beklenen değerler** (lokal, cache'li, 20 eşzamanlı — `tools/load/report.md`):

| Uç | p50 | p95 |
|---|---:|---:|
| `GET /index.html` | ~97 ms | ~112 ms |
| `GET /urunler.html` | ~49 ms | ~58 ms |
| `GET /api/v1/bootstrap` | ~15 ms | ~24 ms |
| `POST /api/v1/checkout/quote` | ~34 ms | ~43 ms |

Üretimde nginx `proxy_cache bagdam_html` (10 s) ve `/assets/*` immutable cache devrede olduğu için anonim sayfalar bunun altındadır.

```bash
# Ölçümü tekrarla (geçici API, dev/prod portlarına dokunmadan)
PORT=4093 HOST=127.0.0.1 ENABLE_CRON=false DISABLE_MAIL=true node apps/api/dist/main.js
node tools/load/run.mjs --api=http://127.0.0.1:4093 --conn=20 --duration=10
# Sorgu sayısı / N+1 taraması (kendi geçici sürecini açar)
node tools/load/n1-scan.mjs
```

**"Site yavaşladı" denince sırayla:**

1. `pm2 status` → restart sayısı artıyor mu, bellek `max_memory_restart` sınırına dayanmış mı (768M)?
2. `GET /api/v1/admin/health/detailed` → DB gecikmesi, cron kuyruğu.
3. DB: uzun süren sorgu var mı?

```bash
sudo -u postgres psql -d bagdam_db <<'SQL'
select pid, now() - query_start as suresi, left(query, 80) as sorgu
from pg_stat_activity
where state = 'active' and now() - query_start > interval '2 seconds'
order by 2 desc;
SQL
```

4. nginx: `proxy_cache` isabet ediyor mu (`$upstream_cache_status`)? Çerezli istek cache'i **bypass eder** — bu tasarım gereğidir (kişiselleşmiş HTML).
5. Bilinen davranış: bir kutu/katalog değişikliğinden sonraki **ilk** istek yavaştır (in-process cache dolar, ~23 sorgu),
   sonrakiler 2 sorguya iner. Sürekli yavaşlık bu değildir.

**Panel yavaş açılıyorsa:** panel rota bazlı bölünmüştür (`vendor-react` 194 kB · `vendor-router` 39 kB · giriş 115 kB ·
ekran başına 4–32 kB). nginx'te `location /app/` **1 yıl immutable** olmalı; değilse her gezinmede yeniden indirilir.

---

## 8. Lansman kontrol listesi (F11)

Sırayla; her madde "evet" olmadan bir sonrakine geçilmez.

**Ödeme**
- [ ] `payment.provider = paytr` (panelden doğrula — `manual` kaldıysa gerçek tahsilat YAPILMAZ)
- [ ] `payment.paytrTestMode = false`, canlı mağaza bilgileri girili (sırlar maskeli görünmeli)
- [ ] PayTR panelinde bildirim URL'si `https://bagdam.com/api/v1/payments/paytr/callback`
- [ ] `payment.paytrCallbackAllowedIps` PayTR'nin güncel bildirim IP listesiyle aynı
- [ ] Sandbox'ta uçtan uca prova: 3DS ödeme · iade · (varsa) kart saklama + MIT tahsilat
- [ ] `payment.storedCardEnabled` yalnız PayTR'den **yazılı teyit** geldiyse açık; değilse kapalı (abonelik tahsilatı ödeme linkine düşer)
- [ ] `payment.nonThreeDsGranted` gerçeği yansıtıyor → buna göre `commerce.chargeStrategy` kararı (`MERCHANT_INITIATED` ‖ `PAYMENT_LINK`)
- [ ] `payment.maxInstallment` ve `payment.enabled` istenen değerde

**İçerik ve yasal**
- [ ] Yasal metinler (KVKK, mesafeli satış, ön bilgilendirme, abonelik sözleşmesi) hukukçu incelemesinden geçti ve **yayınlandı**
- [ ] Gizlilik politikasında veri saklama özeti güncel (`docs/kvkk-veri-saklama.md` ile tutarlı)
- [ ] Çerez banner'ı çalışıyor; reddet/yönet/kabul seçimleri `consents` tablosuna düşüyor
- [ ] SEO başlıkları, `sitemap.xml`, `robots.txt` doğru (apex tam siteye geçince `noindex` kalkmalı)

**Operasyon**
- [ ] `commerce.dunning.retryHours = [2, 12]` (ADR-0020) ve `commerce.cutoff` doğru
- [ ] En az 4 haftalık BoxTemplate hazır ve **yayınlanmış**
- [ ] `delivery-dates:generate` çalıştı, önümüzdeki 8 hafta için gün var
- [ ] Teslimat bölgeleri, ücret ve eşik doğru; kapasiteler ayarlı
- [ ] `site.contactEmail` dolu (toptan talep bildirimi buraya gider)

**Altyapı**
- [ ] `SITE_MODE=full` (apex artık coming-soon değil), `/` → index
- [ ] `health` 200 ×2 (prod + staging); `health-check.sh` Bağdam satırları ekli
- [ ] Gece yedeği koştu + off-site kopya doğrulandı; **restore provası** yapıldı
- [ ] `error-watcher` DBS listesinde `bagdam_db` var; Telegram uyarısı test edildi
- [ ] SMTP canlı; DKIM imzalı gerçek gönderim doğrulandı (SPF + DMARC dahil)
- [ ] 404 / 500 / bakım sayfaları görüntülendi
- [ ] Cloudflare: WAF skip (callback/webhook/pay), Cache Rule `/api/*` bypass, `/assets/*` cache
- [ ] `logs/mail/` önizleme dosyaları üretimde oluşmuyor (`DISABLE_MAIL=false`)
- [ ] nginx `admin.bagdam.com.conf` → `location /app/` 1 yıl immutable cache (admin çıktısı `dist/app/*`; kod bölmeden sonra 86 chunk) ve `location /assets/` API'ye alias/proxy

**Güvenlik (F10 denetiminden devreden — `docs/guvenlik-denetimi.md` §10)**
- [ ] `sharp` **≥0.35** yükseltildi (libvips CVE-2026-33327/33328/35590/35591) ve panel medya yükleme duman testi geçti
- [ ] `pnpm audit` çıktısı gözden geçirildi; yeni high uyarı yok (Prisma CLI zinciri hariç)
- [ ] `env-validator` production'da temiz açıldı: `JWT_SECRET`/`JWT_REFRESH_SECRET`/`SETTINGS_ENCRYPTION_KEY` ≥32 ve zayıf değer değil, `WEB_URL`/`ADMIN_URL` mutlak https, `ALLOW_JOB_TIME_OVERRIDE` **kapalı**
- [ ] CSP başlıkları canlıda doğrulandı (web: PayTR `frame-src` + `font-src data:`; api: `default-src 'none'`) ve tarayıcı konsolunda blok yok
- [ ] PayTR sandbox provasında `script-src-attr 'none'` sorun çıkarmadı (`checkoutFormContent` dalı inline `onclick=` kullanmıyor)
- [ ] HSTS yalnız production'da gidiyor; `X-Powered-By` yok; `X-Frame-Options: DENY`
- [ ] Panelden `<script>` içeren bir CMS metni kaydedip yayınlandığında sayfada **çalışmıyor** (richtext temizleyici — `common/security/html-sanitize.ts`)
- [ ] GitHub: secret scanning + push protection açık (public repo)

**Şema (ADR-0021)**
- [ ] Lansmandan sonra migration'lar yalnız **additive**; kolon silme/yeniden adlandırma yeni ADR ister
- [ ] `deploy.sh` migration öncesi `pg_dump` alıyor ve dosya duruyor

**Lansman sonrası (hypercare, 2 hafta)**
- [ ] İlk teslimat günü baştan sona izlendi (kesim → tahsilat → toplama → teslim)
- [ ] Her sabah: Özet ekranı + Ödeme Problemleri + `cron_logs` + gece yedeği
- [ ] İlk hafta sonunda `docs/SISTEM-DURUMU.md` güncellendi

---

## 9. Kullanıcı aksiyonları (geliştirme dışı)

Bu maddeler kod tarafında hazırdır; **iş sahibinin** tamamlaması gerekir. Lansman ön koşuludur.

| Konu | Ne gerekiyor | Neden bloke ediyor |
|---|---|---|
| **PayTR mağaza onayı** | Canlı mağaza bilgileri (merchant id/key/salt) + bildirim URL'si tanımı | Onaysız gerçek tahsilat yok |
| **PayTR kart saklama teyidi** | "iFrame API üzerinden kart saklama ve saklı karttan MIT tahsilat" yetkisini **yazılı** sorun | Teyit gelmezse abonelik tahsilatı her hafta ödeme linkiyle yürür (müşteri her hafta tıklar) |
| **E-posta sağlayıcısı** | Sağlayıcı seçimi + alan adı doğrulama + SPF/DKIM/DMARC kayıtları | Parola sıfırlama ve kesim hatırlatma mailleri spam'e düşer |
| **ETBİS kaydı** | e-ticaret sitesi bildirimi | Yasal zorunluluk |
| **Gıda İşletme Kayıt Belgesi** | Ürün satışı için | Yasal zorunluluk |
| **İYS (İleti Yönetim Sistemi)** | Pazarlama izinlerinin İYS'ye yüklenmesi | Pazarlama e-postası göndermek için |
| **e-Arşiv / fatura yolu** | Mali müşavirle fatura akışının netleşmesi (şimdilik GİB portalından elle) | Sipariş sonrası fatura |
| **Yasal metin incelemesi** | KVKK / mesafeli satış / ön bilgilendirme / abonelik sözleşmesi metinlerinin hukukçu onayı | Metinler taslak referanslardan uyarlandı, hukuki güncelliği doğrulanmadı |

---

## 10. F10 doğrulama sonuçları

**Lokal, 2026-08-21.** Geçici API `:4094` (`ENABLE_CRON=false`, `DISABLE_MAIL=true`, `PAYMENT_PROVIDER=manual`) +
admin `vite preview :4095`; dev `:4010`/`:4011` ve statik prototip `:8080`'e dokunulmadı.

| Doğrulama | Komut | Sonuç |
|---|---|---|
| Tip kontrolü + lint | `pnpm type-check` · `pnpm lint` | ✅ 3 paket (shared/api/admin) |
| Derleme | `pnpm build` | ✅ api `nest build`, admin 86 chunk (en büyük 193,8 kB `vendor-react`; 500 kB uyarısı yok) |
| API testleri | `pnpm --filter @bagdam/api test` | ✅ **47 suite / 395 test** (gerçek DB) |
| Shared testleri | `pnpm --filter @bagdam/shared test` | ✅ 117 test (TZ=UTC ve Europe/Istanbul) |
| Admin testleri | `pnpm --filter @bagdam/admin test` | ✅ **36 dosya / 228 test** |
| Handlebars şablonları | `node tools/hbs-check.mjs` | ✅ **19/19** derleniyor (12 sayfa + 7 partial), eksik partial referansı yok |
| Seed | `SEED_OVERWRITE_CONTENT=true pnpm db:seed` → düz `pnpm db:seed` | ✅ ilk koşu 40 site_content + 11 legal + 3 post ezildi; ikinci koşu **0 oluşturuldu / hepsi korundu** (idempotent) |
| Şema | `pnpm db:status` | ✅ 5 migration, "Database schema is up to date!" · 37 model / 29 enum (→ [ADR-0021](adr/0021-sema-v1-donduruldu.md)) |
| Piksel parite | `node tools/visual-parity/run.mjs --old=…8080 --new=…4094 --mask=#forgotNote,#cookieConsent` | ✅ **30/30 · 0 px** + sepet/kutu duman 14/14 |
| Uçtan uca F10 | `node tools/e2e-admin/run-f10.mjs` | ✅ **16/16** — rapor `tools/e2e-admin/report-f10.md` |
| Bağımlılık taraması | `pnpm audit` | ⚠️ 3 high — `sharp` (çalışma zamanı, **F10b'de yükselt**), `deepmerge-ts` + `effect` (Prisma CLI, üretim dışı). Ayrıntı: [guvenlik-denetimi.md §8](guvenlik-denetimi.md) |

**e2e F10 neyi sürdü:** çerez şeridi (reddet / yönet / kabul → `consents` satırları, kapalı kategori hiç basılmıyor,
karardan sonra şerit çıkmıyor) · kesim hatırlatma maili (`reminders:cutoff` → MailLog + önizlemede kutu içeriği ve
teslimat günü; ikinci koşu tekrar göndermiyor) · tahsilat başarılı/başarısız mailleri · teslimat durum mailleri
(panelden `Hazırlanıyor → Yolda → Teslim edildi`, ayrıca gerekçeli `Teslim edilemedi`) · iptal teyidi maili ·
`kvkk:purge` (eski MailLog/SystemLog/CronLog + önizleme dosyası silindi, eski AuditLog PII'si `[silindi]`, satır durdu) ·
Sistem ekranı 6 sekmesi · güvenlik matrisi (401/403/404, CSRF, CSP, sır maskesi) · temizlik: **17 tablo ≡ başlangıç**.

**Bilinen sınırlar:** gerçek SMTP gönderimi (DKIM) ve gerçek PayTR sandbox provası lokalde yapılamaz → **F10b/F11**.

---

## İlgili belgeler

- `deploy/README.md` — sunucu kurulumu, nginx, SSL, CI/CD, geri alma
- `deploy/scripts/health-check-snippet.md` — ortak izleme betiklerine eklenecek Bağdam satırları
- `docs/guvenlik-denetimi.md` — uç nokta yetki matrisi, CSP, sır yönetimi, PII, bağımlılık uyarıları
- `docs/kvkk-veri-saklama.md` — veri saklama matrisi ve `kvkk:purge`
- `docs/adr/0021-sema-v1-donduruldu.md` — şema v1 dondurma kuralı (yalnız additive migration)
- `docs/state-machines.md` — Order / Subscription / Cycle / Payment durum geçişleri
- `docs/SISTEM-DURUMU.md` — anlık sistem durumu ve açık notlar
- `tools/load/report.md` · `tools/load/n1-report.md` · `tools/backup-restore-report.md` — ölçüm çıktıları
- `tools/e2e-admin/report-f10.md` · `tools/visual-parity/report.md` — F10 uçtan uca ve parite raporları
