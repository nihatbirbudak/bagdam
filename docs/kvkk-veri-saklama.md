# Bağdam — KVKK veri saklama ve imha matrisi (F10)

> Kaynak kararlar: [ADR-0015](adr/0015-guvenlik-ve-repo.md) (KVKK saklama matrisi, `kvkk:purge`, çerez banner'ı),
> [ADR-0014](adr/0014-e-posta-ve-bildirim.md) (MailLog 90 gün), [ADR-0004](adr/0004-zaman-ve-saat-dilimi.md) (tüm anlar `timestamptz`, TZ Europe/Istanbul).
> Uygulama: `apps/api/src/modules/jobs/kvkk-purge.service.ts` (+ `kvkk-purge.repository.ts`), süreler Setting `privacy.*`
> (admin › Ayarlar › **KVKK ve veri saklama**; `packages/shared/src/types/settings.ts` → `PRIVACY_SETTINGS_DEFAULTS`).
> Bu dosyanın özeti gizlilik/KVKK metnine de yazılır: `database/seeds/content/legal/kvkk.html` → "Saklama süreleri".

## 1. Saklama matrisi

| # | Veri türü | Tablo / dosya | Süre (varsayılan) | Ayar | Dayanak | Süre sonunda |
|---|---|---|---|---|---|---|
| 1 | Üyelik kaydı (ad, e-posta, telefon, parola özeti, tercihler) | `users` | Hesap açık kaldığı sürece; pasiflikte **kapalı** (opsiyonel: N ay) | `privacy.anonymizeInactiveMonths` (0 = kapalı) | KVKK m.5/2(c) sözleşmenin ifası | **Anonimleştirme** — `CustomersService.anonymize`: e-posta `anon+<id>@anon.local`, ad/telefon/tercih `null`, parola rastgele, oturumlar düşer, `anonymizedAt` yazılır; satır silinmez (sipariş geçmişi tutarlılığı) |
| 2 | Teslimat adresi (ad, telefon, adres satırı) | `addresses` | Hesapla aynı | — (anonimleştirmeye bağlı) | KVKK m.5/2(c) | Anonimleştirmede **satır silinir** (`CustomersRepository.anonymize`) |
| 3 | Sipariş + sipariş satırı (adres anlık görüntüsü, iletişim, tutarlar) | `orders`, `order_lines` | **10 yıl** (120 ay) | `privacy.retentionMonths` (bilgi amaçlı) | TTK m.82 (ticari defter/belge), VUK m.253 (5 yıl) | **Silinmez** — ticari kayıt. Kişi bazlı talep hâlinde 1. satırdaki anonimleştirme uygulanır (`customerName/Email/Phone` alanları sipariş anlık görüntüsüdür; imha talebi hukuki saklama süresiyle sınırlıdır) |
| 4 | Abonelik, kutu döngüsü, kutu içeriği, abonelik olayları | `subscriptions`, `subscription_cycles`, `cycle_items`, `subscription_events`, `subscription_cancellations` | 10 yıl (siparişle aynı) | `privacy.retentionMonths` | TTK m.82 | Silinmez (ticari kayıt) |
| 5 | Ödeme / iade / kayıtlı kart maskesi (`****1234`, son kullanma, sağlayıcı token'ı) | `payments`, `refunds`, `payment_methods` | 10 yıl | `privacy.retentionMonths` | TTK m.82; BKM/PCI (kart PAN'ı **hiç saklanmaz** — ADR-0019: kart verisi PayTR'de) | Silinmez; kart kaydı müşteri silince `deletedAt` (soft) |
| 6 | Sağlayıcı bildirimi (webhook) gövdesi | `webhook_events` | 10 yıl (ödeme uyuşmazlığı kanıtı) | — | TTK m.82 | Silinmez (PII içermez; tutar/oid) |
| 7 | Açık rıza / onay kayıtları (KVKK, mesafeli satış, ticari ileti, **çerez**) | `consents` (`ipAddress`, `userAgent`, `documentId`, `guestKey`) | Rızanın geri alınmasından sonra **3 yıl** | — | 6563 s. Kanun m.6 + Ticari İletişim Yön. m.13 (İYS kayıt ispatı) | Silinmez (ispat yükü bizde); anonimleştirmede `userId` `NULL`'a düşer |
| 8 | Yasal metin sürümleri | `legal_documents` | Süresiz (sürüm arşivi) | — | İspat | Silinmez |
| 9 | E-posta gönderim günlüğü (alıcı adresi, konu, durum) | `mail_logs` + `apps/api/logs/mail/<id>.html` önizlemeleri | **90 gün** | `privacy.mailLogDays` | ADR-0014; meşru menfaat (teslimat kanıtı) | **Satır silinir**; `DISABLE_MAIL` önizleme dosyası da diskten silinir |
| 10 | Uygulama hata/sistem günlüğü (istek kimliği, kullanıcı kimliği, mesaj) | `system_logs` | **30 gün** | `privacy.systemLogDays` | ADR-0015; meşru menfaat (hata ayıklama) | Satır silinir (eski `logs:cleanup` işi) |
| 11 | Zamanlanmış görev günlüğü | `cron_logs` | **90 gün** | `privacy.cronLogDays` | Operasyon | Satır silinir |
| 12 | Yönetim paneli işlem kaydı (aktör e-postası, IP, eski/yeni değer anlık görüntüsü) | `audit_logs` | Satır **süresiz**; içindeki PII **12 ay** | `privacy.auditPiiMonths` | KVKK m.4 (ölçülülük) + iç denetim | **Satır KALIR, PII maskelenir:** `actorEmail`, `ipAddress`, `summary` ve `oldValues/newValues` içindeki hassas alanlar `[silindi]` olur |
| 13 | Toptan başvuruları (işletme, e-posta, telefon) | `wholesale_leads` | 10 yıl (ticari iletişim) | `privacy.retentionMonths` | Meşru menfaat | Silinmez (talep hâlinde elle silinir — admin) |
| 14 | Sepet (misafir/üye) | `carts`, `cart_items` | Oturumla; terk edilen sepetler ticari kayıt değildir | — | Meşru menfaat | Elle temizlenebilir (P2: otomatik) |
| 15 | Yüklenen medya (ürün görselleri) | `media_files` + `apps/api/uploads/` | Süresiz | — | İşletme varlığı | PII içermez |
| 16 | nginx erişim kaydı | sunucu `/var/log/nginx/*` | **14 gün** | logrotate (`deploy/`) | Meşru menfaat (güvenlik) | logrotate siler |
| 17 | PM2 / uygulama çıktısı | sunucu `logs/*.log` | **30 gün** | logrotate (`deploy/`) | Meşru menfaat | logrotate siler |
| 18 | Veritabanı yedeği (şifreli, off-site) | `db_YYYY-MM-DD_HHMM.dump` | Yerel **7 gün**, off-site **30 gün**, aylık **1 yıl**, migration öncesi **14 gün** | `deploy/scripts/backup-bagdam.sh` | ADR-0015 | Otomatik döndürme. Silme talebi yedeklere geriye dönük uygulanmaz; yedekten geri dönüşte `kvkk:purge` ilk koşusunda yeniden uygulanır |

**Kişisel veri içermeyen tablolar** (tam liste dışı): `products`, `product_lots`, `product_images`, `categories`, `producers`,
`box_tiers`, `box_templates`, `box_template_items`, `delivery_zones`, `delivery_dates`, `site_content`, `settings`, `posts`, `coupons`.

## 2. `kvkk:purge` işi

| Konu | Değer |
|---|---|
| Ad | `kvkk:purge` (`JobName`; `POST /api/v1/admin/jobs/kvkk:purge/run` yalnız geliştirme/test — `ALLOW_JOB_TIME_OVERRIDE`) |
| Cron | `15 3 * * *` (Europe/Istanbul) — gece yedeğinden (03:30) **önce** çalışır ki silinen veri yedeğe girmesin |
| Uygulama | `apps/api/src/modules/jobs/kvkk-purge.service.ts` |
| Kayıt | Her koşu bir `CronLog` satırı: `itemsProcessed` = silinen + maskelenen + anonimleştirilen; `details` = adım adım sayılar + uygulanan `privacy.*` değerleri |
| Kapatma | İlgili ayar **0** ise o adım atlanır (`details.disabled` listesinde görünür) |
| Hata | Adımlar bağımsız: biri hata verirse diğerleri sürer, `errors` artar, koşu `SUCCESS` kalır (kısmi temizlik) |

Adımlar (sırayla):

1. **MailLog** — `createdAt < now − mailLogDays`; satırlar 500'lük toplu silinir, `preview:<yol>` hata alanındaki önizleme dosyaları da diskten kaldırılır (`MailService.purgeLogsOlderThan`).
2. **SystemLog** — `createdAt < now − systemLogDays` (eski `logs:cleanup`).
3. **CronLog** — `startedAt < now − cronLogDays`. Koşan işin kendi satırı `startedAt = now` olduğu için silinmez.
4. **AuditLog PII maskeleme** — `createdAt < now − auditPiiMonths` penceresi taranır; her satırda `actorEmail`/`ipAddress` `[silindi]`, `summary` içindeki e-posta/telefon desenleri `[silindi]`, `oldValues`/`newValues` içinde `common/security/redaction.ts#isSensitiveKey` ile eşleşen alanlar `[silindi]`. **Satır silinmez.** Tarama penceresi bir önceki başarılı koşunun `details.auditMaskedThrough` değerinden başlar (ilk koşu tam tarama); tek koşuda en çok 50.000 satır, kalan bir sonraki koşuya devreder.
5. **Pasif müşteri anonimleştirme** — yalnız `anonymizeInactiveMonths > 0` iken. Aday: `role=CUSTOMER`, silinmemiş, henüz anonimleştirilmemiş, `lastLoginAt` (yoksa `createdAt`) eşikten eski, **canlı aboneliği yok** (`PENDING/ACTIVE/PAST_DUE/CANCEL_REQUESTED/PAUSED`), **açık siparişi yok** (`PENDING_PAYMENT/PAID/PREPARING/OUT_FOR_DELIVERY/DELIVERY_FAILED`) ve eşikten sonra siparişi yok. Anonimleştirme `CustomersService.anonymize` ile (admin ekranındaki düğmeyle **aynı** yol); tek koşuda en çok 200 hesap.

### `[redacted]` ile `[silindi]` farkı

- `[redacted]` — **yazma anında** konur (`AuditLogInterceptor` → `common/security/redaction.ts`): parola, token, kart, e-posta gibi alanlar audit satırına hiç ham girmez.
- `[silindi]` — **saklama süresi dolduğu için sonradan** konur (`kvkk:purge`). İki işaret karışmasın diye ayrı metinlerdir.

## 3. İlgili kişi talepleri (KVKK m.11) — operasyon

| Talep | Yol |
|---|---|
| Bilgi / erişim | Admin › Müşteriler › detay (kayıt, adres, onaylar, siparişler) → PDF/ekran görüntüsü ile yanıt |
| Düzeltme | Admin › Müşteriler › detay (ad/telefon) ya da müşteri kendi hesabından |
| Silme / yok etme | Admin › Müşteriler › **Anonimleştir** (`POST /api/v1/admin/customers/:id/anonymize`). Ticari kayıtlar (3–6) hukuki saklama süresi dolana kadar kalır; müşteriye bu gerekçe yazılı bildirilir |
| Ticari ileti iptali | Üyelik sayfası / `POST /api/v1/me/consents` (`MARKETING_EMAIL` `granted:false`) → İYS'ye iletilir (`iysStatus`) |
| Çerez tercihi değişikliği | Site alt bilgisindeki Çerez Politikası bağlantısı; tarayıcı yerel kaydı (`bagdam_cookie_consent`) silinince şerit yeniden çıkar |

## 4. Çerez envanteri (banner kategorileri)

| Kategori | Örnek | Onay gerekir mi | Nerede |
|---|---|---|---|
| Zorunlu | `access_token`, `refresh_token`, `csrf_token` oturum çerezleri; `bahceden_cart` / `bahceden_prefs` yerel kayıtları | Hayır (KVKK m.5/2(f) meşru menfaat + 5651 s. Kanun) | `apps/api/src/config/cookie.config.ts`, `public/assets/cart.js` |
| Analitik | (henüz kurulu değil) | **Evet** | Setting `cookies.analyticsEnabled` — varsayılan **kapalı**; açılmadan şeritte seçenek çıkmaz |
| Pazarlama | (henüz kurulu değil) | **Evet** | Setting `cookies.marketingEnabled` — varsayılan **kapalı** |

Karar `bagdam_cookie_consent` (localStorage) içinde tutulur; her opsiyonel kategori için ayrıca `consents` tablosuna
`COOKIE_ANALYTICS` / `COOKIE_MARKETING` satırı yazılır (`granted` true/false, IP + user-agent + `guestKey` ile).
Şerit `apps/api/views/partials/cookie-consent.hbs`; sunucuda **gizli** basılır, `cart.js` `// F10 cookie:` bloğu gösterir
(ADR-0003 piksel parite istisnası — parite koşusu `--mask=#cookieConsent` ile ölçülür).

## 5. Doğrulama

```bash
# Kuru koşu yok: süreleri Ayarlar'dan 0 yaparak adım kapatılır. Tek koşu (dev/staging):
curl -X POST http://127.0.0.1:4010/api/v1/admin/jobs/kvkk:purge/run -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -d '{}'
# Sonuç: CronLog satırı (Sistem › Cron günlüğü) details = {mailLogsDeleted, systemLogsDeleted, cronLogsDeleted,
#        auditScanned, auditMasked, customersAnonymized, disabled[], settings{…}}
```

Jest kapsamı: `apps/api/src/__tests__/jobs/kvkk-purge.spec.ts` (yaş sınırı, önizleme dosyası silme, AuditLog maskeleme,
kapalı adım, anonimleştirme adayı seçimi).

Uçtan uca kapsam (F10 · **doğrulandı 2026-08-21**): `tools/e2e-admin/run-f10.mjs` adım **l** — 120/60/200 gün eski
MailLog (+ önizleme dosyası) / SystemLog / CronLog satırları eklenir ve koşudan sonra **silinmiş** olur; 400 gün eski
PII'li AuditLog satırı **durur** ama `actorEmail` · `ipAddress` · `summary` · `newValues` içindeki e-posta/telefon
`[silindi]` olur, PII olmayan alan (`note`) **korunur**; koşu sırasında üretilen taze MailLog satırları etkilenmez.
Aynı koşunun adım **c/d/e**'si çerez şeridinin üç kararını (Reddet · Yönet · Kabul Et) ve kapalı kategori davranışını
`consents` tablosu üzerinden doğrular. Rapor: `tools/e2e-admin/report-f10.md`.

## 6. Gizlilik metnine yazılan özet (durum)

`database/seeds/content/legal/kvkk.html` içindeki **"Saklama süreleri"** paragrafı bu matrisin özetidir
(üyelik · ticari kayıt 10 yıl/TTK m.82 · onay kayıtları 3 yıl/6563 · mail 90 g · sistem 30 g · cron 90 g ·
erişim kaydı 14 g · yedek 30 g · audit PII 12 ay).

> ⚠️ Düz `pnpm db:seed` mevcut `legal_documents` satırlarını **korur** → paragraf DB'ye inmez.
> Lokalde `SEED_OVERWRITE_CONTENT=true pnpm db:seed` ile indirildi ve **parite yeniden ölçüldü (30/30 0 px)**:
> KVKK belgesi `sortOrder 5` olduğu için `politikalar.html`'de gizli `<article>` içindedir, görünür yerleşim değişmez.
> **Staging/prod'da (F10b) aynı komut koşulmalı** ya da metin panelden yeni sürüm olarak yayınlanmalıdır.
