# Bağdam — yedek/restore provası raporu (F10 · C)

> Üretildi: 2026-08-21 06:55:39 (UTC) · araç: `tools/backup-restore-drill.mjs`
> Sonuç: **BAŞARILI** — 10/10 adım

## Ortam

| Alan | Değer |
|---|---|
| Kaynak veritabanı | `bagdam_dev` (yalnız `SELECT` — prova sırasında yazılmadı) |
| Restore hedefi | `bagdam_restore_test` (prova sonunda düşürüldü) |
| Sunucu | PostgreSQL 18.4 · 127.0.0.1:5432 |
| Araçlar | `C:\tools\pgsql\bin\pg_dump.exe` · `C:\tools\pgsql\bin\pg_restore.exe` |
| Eklentiler | citext, plpgsql |

## Adımlar

| # | Adım | Sonuç | Süre (ms) | Not |
|---|---|---|---:|---|
| 1 | a) araçlar ve sürüm | ✅ | 183 | pg_dump (PostgreSQL) 18.4 · sunucu PostgreSQL 18.4 |
| 2 | b) kaynak sayımları (salt okuma) | ✅ | 153 | 38 tablo · 840 satır · eklentiler: citext, plpgsql |
| 3 | c) pg_dump -Fc | ✅ | 151 | 0.16 MB → <tmp>/bagdam-drill-2026-08-21T06-55-37.dump |
| 4 | d) pg_restore --list (bütünlük) | ✅ | 28 | 254 arşiv girdisi okundu |
| 5 | e) hedef veritabanı hazırlığı | ✅ | 263 | bagdam_restore_test oluşturuldu |
| 6 | f) pg_restore | ✅ | 334 | geri yükleme tamam |
| 7 | g) sayım karşılaştırması | ✅ | 109 | 38 tablo birebir (16 çekirdek tablo dahil) |
| 8 | h) şema/eklenti doğrulaması | ✅ | 192 | eklentiler: citext, plpgsql · migration 5 · timestamp(without tz) 0 |
| 9 | i) örnek veri doğrulaması | ✅ | 393 | 3 içerik özeti (md5) birebir |
| 10 | z) temizlik | ✅ | 299 | bagdam_restore_test düşürüldü, dump dosyası silindi |

## Ölçümler (RTO tahmini)

| Ölçüm | Değer |
|---|---|
| Dump boyutu | 0.16 MB (`-Fc`, sıkıştırılmış) |
| Arşiv girdisi | 254 |
| Kaynak satır toplamı | 840 (38 tablo) |
| `pg_dump` süresi | 0.15 s |
| `pg_restore` süresi | 0.33 s |
| Toplam prova süresi | 2.10 s |

> Üretim verisi bu seed setinden büyük olacaktır; süreler satır sayısıyla kabaca doğrusal ölçeklenir.
> Lansman sonrası prova tekrarlanıp bu tablo güncellenmeli (`docs/RUNBOOK.md` → aylık restore provası).

## Tablo sayımları (kaynak ↔ restore)

16 çekirdek tablo kalın; tüm public tablolar listelenir.

| Tablo | Kaynak | Restore | ✓ |
|---|---:|---:|:--:|
| _prisma_migrations | 5 | 5 | ✅ |
| **addresses** | 0 | 0 | ✅ |
| audit_logs | 503 | 503 | ✅ |
| **box_template_items** | 16 | 16 | ✅ |
| **box_templates** | 2 | 2 | ✅ |
| box_tiers | 2 | 2 | ✅ |
| carts | 0 | 0 | ✅ |
| categories | 4 | 4 | ✅ |
| **consents** | 0 | 0 | ✅ |
| coupon_redemptions | 0 | 0 | ✅ |
| coupons | 0 | 0 | ✅ |
| cron_logs | 0 | 0 | ✅ |
| **cycle_items** | 0 | 0 | ✅ |
| **delivery_dates** | 50 | 50 | ✅ |
| delivery_zones | 2 | 2 | ✅ |
| legal_documents | 11 | 11 | ✅ |
| **mail_logs** | 0 | 0 | ✅ |
| media_files | 85 | 85 | ✅ |
| **order_lines** | 0 | 0 | ✅ |
| **orders** | 0 | 0 | ✅ |
| **payment_methods** | 0 | 0 | ✅ |
| **payments** | 0 | 0 | ✅ |
| posts | 3 | 3 | ✅ |
| producers | 15 | 15 | ✅ |
| product_images | 27 | 27 | ✅ |
| product_lots | 22 | 22 | ✅ |
| products | 22 | 22 | ✅ |
| refunds | 0 | 0 | ✅ |
| settings | 37 | 37 | ✅ |
| site_content | 31 | 31 | ✅ |
| **subscription_cancellations** | 0 | 0 | ✅ |
| **subscription_cycles** | 0 | 0 | ✅ |
| **subscription_events** | 0 | 0 | ✅ |
| **subscriptions** | 0 | 0 | ✅ |
| system_logs | 2 | 2 | ✅ |
| **users** | 1 | 1 | ✅ |
| webhook_events | 0 | 0 | ✅ |
| wholesale_leads | 0 | 0 | ✅ |

## Sunucudaki karşılığı

Bu prova, `deploy/scripts/backup-bagdam.sh` zincirinin **geri yükleme** ayağını doğrular:

```bash
# 1) En güncel yedeği seç (sunucu)
ls -lt /opt/birbudak/backups/bagdam/db_*.dump | head
# 2) Bütünlük (script gecelik olarak da yapar)
pg_restore --list /opt/birbudak/backups/bagdam/db_<damga>.dump | head
# 3) YAN veritabanına geri yükle — üretim DB'sinin ÜZERİNE YAZMA
sudo -u postgres createdb -O bagdam bagdam_restore_test
sudo -u postgres pg_restore -d bagdam_restore_test --no-owner --no-privileges db_<damga>.dump
# 4) Sayım karşılaştır → 5) sudo -u postgres dropdb bagdam_restore_test
```

Off-site kopya `age` ile şifreliyse önce çözülür: `age -d -i bagdam-backup.key db.dump.age > db.dump`.
Gerçek felaket senaryosunda üretim DB'sine dönüş adımları `docs/RUNBOOK.md` → “Yedek ve geri yükleme”.
