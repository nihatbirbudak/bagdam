# Bağdam — Yol Haritası (net plan, 2026-08-20)

> Bu dosya **çalışma listesi**dir: fazlar, yapılacaklar, "bitti sayılır" ölçütleri. Gerekçeler ve ayrıntılar [BACKEND-PLANI.md](BACKEND-PLANI.md) (tam plan) ve [adr/](adr/) (16 karar) dosyalarındadır. Bir fazı bitirmeden sonrakine geçilmez; her faz sonunda bu dosyadaki kutular işaretlenir ve `SISTEM-DURUMU.md` güncellenir.

## 0. Nasıl çalışacağız

| Konu | Kural |
|---|---|
| Dil | Kod/tanımlayıcı İngilizce, commit/doküman Türkçe. Her şey TypeScript (SQL yalnız ham migration'da, bash yalnız deploy/ops). |
| Mimari | [ADR-0002](adr/0002-moduler-katmanli-mimari-api-first.md): özellik modülü × (controller · service · repository · dto · mapper) + `packages/shared` + `common/`. Kural: **mantık Service'te, veri tablolarda, istemciler ince, her şey `/api/v1`'den.** |
| Ortamlar | **Lokal-önce (ADR-0017):** lokal PostgreSQL (`bagdam_dev`) + `migrate dev`; sunucu/staging yalnız F10b'de. `db push` yasak. Prod DB'ye yalnız `bagdam_ro` salt-okunur tünel (bağlantı ayrıntısı `docs/sunucu-baglanti.md`). |
| Repo | Public monorepo. Sır yok (`.env` sunucuda). Feature branch → PR → staging → main. |
| Kapsam | [ADR-0016](adr/0016-kapsam-kilidi.md): P2 listesi lansmana kadar kapalı; açık karar kuyruğu ≤3. |
| Tasarım | Piksel parite: Playwright baseline staging'de; yalnız ADR-0003'teki 7 istisna. |
| Doküman | Faz sonunda: kutular + `docs/SISTEM-DURUMU.md`; yeni mimari karar = yeni ADR (≤25 satır), eskisi düzenlenmez. |

## 1. Mimari (özet)

```
apps/api  (NestJS :5010)              apps/admin (React SPA)      packages/shared      database/
├─ common/  (guard, filter, prisma,   └─ uyanisakademi iskeleti   ├─ enums, DTO tipleri ├─ schema.prisma
│   config, audit, mail, pagination)                             ├─ durum makineleri   └─ migrations/
├─ modules/<özellik>/ {dto, controller, admin.controller,        └─ pricing
│   service, repository, mapper}
├─ web/  (WebController → views/*.hbs, aynı servisler)
├─ views/ (bugünkü HTML'ler .hbs) + public/ (styles.css, assets/, cart.js)
└─ jobs/ (cron: delivery-dates, cycles:ensure, lock-and-charge, reminders, purge)
```

Modüller (sırayla doğar): health → web → pricing/state (shared, F2) → catalog → media → auth(admin) → content → settings → wholesale → auth(müşteri)/me → mail → delivery + subscriptions + jobs(cron) → checkout → orders → payments → notifications.

## 2. Fazlar

Toplam ≈ **55 iş günü** (+ F10b 3 gün sunucu) tek geliştirici (≈ 11 hafta) · iki geliştirici ≈ 40 gün (A: api/motor, B: admin/içerik). İlk görünür teslim (dinamik site + admin, staging'de) **F4 sonu ≈ 17. gün**.

### F0 — Karar sprinti (2 gün) — *şimdi*
- [x] 16 ADR yazıldı (adr/0001–0016) — onaylandı sayılır; itiraz gelirse yeni ADR açılır, eskisi "Yerini aldı: ADR-00xx" olarak işaretlenir
- [ ] Cloudflare: bagdam.com zone'u hesapta ve API token erişimi teyit edildi (✓); **Bot Fight Mode kapalı** (webhook/callback'i bozmasın) — panelden kontrol edilecek
- [x] `.gitignore` (sunucu dokümanı) + repo'ya sır girmeme kuralı
- [ ] `docs/state-machines.md`: Order / Subscription / Cycle / Payment / Cancellation durum geçişleri + `cycles:ensure` algoritması *(F0 çıktısı; en geç F2 şema yazımından önce)*
- [ ] **Sizin yapmanız gerekenler** (bkz. §3): iyzico sandbox + merchant başvurusu + NON3D yazılı sorgu; e-posta sağlayıcısı seçimi (Resend/SES); GitHub'da secret scanning + push protection; ETBİS / İşletme Kayıt Belgesi / İYS / e-Arşiv yolu (mali müşavir)
- **Bitti sayılır:** ADR'ler commit; sandbox anahtarları elde; karar kuyruğu ≤3.

### F1 — Walking skeleton (4 gün) — *ilk kurulacak yapı* — ✅ LOKAL TAMAM (2026-08-20)
Amaç: çalışan iskelet — **lokalde** (ADR-0017: sunucu kurulumu ve yayın F10b'ye taşındı). API health, 10 sayfa byte-byte, admin kabuğu, shared paket, deploy dosyaları (uygulanmaz).
- [x] Monorepo: `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.env.example`, root `package.json` (UA'dan kopya, `@bagdam/*`); `.gitignore`: `docs/sunucu-*.md`, `*.pem`, `*.key`, `.env*` (`!.env.example`), `apps/api/uploads/`, `node_modules/`, `dist/` *(✓ 2026-08-20)*
- [x] `apps/api`: Nest 11 bootstrap (UA `main.ts/app.module.ts/env-validator/common/*`), `api/v1` öneki, hbs view engine, `useStaticAssets`, `HOST 127.0.0.1`; `HealthController`; `WebController` (10 `.hbs` + `404.hbs` + `coming-soon.hbs`); `NotFoundExceptionFilter` (HTML 404) *(✓ 2026-08-20 — lokalde :4010, 10 sayfa byte-byte aynı, health/404/coming-soon doğrulandı)*
- [x] `website/*.html` → `apps/api/views/*.hbs`, `website/assets + styles.css` → `apps/api/public/`; `website/unused` → `docs/arsiv-prototip/` *(✓)*
- [x] `apps/admin` kabuğu (Vite + React; UA iskeleti; login sayfası boş), `packages/shared` boş paket, `database/` klasörü *(✓ 2026-08-20 — :4011, login/dashboard/menü, lint+tsc+test temiz; shared: 36 test iki TZ'de yeşil)*
- [→F10b] Sunucu: Node 22 ikilisi (proje bazlı) + PM2 `interpreter`; `/opt/bagdam`, `/opt/bagdam-staging`; PG `bagdam_db` + `bagdam_staging` (+ `citext`), roller `bagdam`, `bagdam_ro`; `.env` (600); `ecosystem.config.js` (cluster×1, TZ, HOST, 768M)
- [→F10b] nginx: `conf.d/02-bagdam-cache.conf` (proxy_cache_path) + gzip_types; vhost'lar (apex → coming-soon location; `admin.bagdam.com`; `staging.*` basic auth + `auth_basic off` callback/webhook/pay); bakım sayfası `/var/www/maintenance/bagdam`
- [→F10b] SSL: Cloudflare Origin CA wildcard → `/etc/ssl/bagdam/`; Cloudflare kayıtları (A @, CNAME www/admin/staging/admin-staging proxied; SPF/DKIM/DMARC + MX DNS-only); Full (strict), Always HTTPS, HSTS, WAF istisnası webhook/callback, Cache Rule `/api/*` bypass + `/assets/*` cache
- [x] CI/CD: `deploy.yml` (main) + `deploy-staging.yml`; Bağdam'a özel kısıtlı SSH anahtarı + `/opt/birbudak/scripts/deploy-dispatch.sh`; `deploy.sh` (flock → fetch/reset → install → generate → build → `psql citext` → pg_dump pre-migrate → migrate deploy → reload → health → pm2 save) *(dosyalar repo'da ✓ — kurulum F10b)*
- [x] Ops: `backup-bagdam.sh` (03:30; db dump + uploads; 7 gün yerel + şifreli off-site 30 gün), `health-check.sh ENDPOINTS` 5010/5011, `error-watcher/daily-error-digest` DBS, `daily-report` satırı, logrotate *(script'ler `deploy/scripts/` ✓ — kurulum F10b)*
- [→F10b] Playwright baseline: 10 sayfa × 3 viewport (staging)
- **Bitti sayılır (lokal, ADR-0017):** `http://127.0.0.1:4010` 10 sayfa byte-byte aynı ✓; `/api/v1/health` 200 ✓; admin :4011 açılıyor ✓; shared/api/admin tsc+build+test yeşil ✓; Playwright baseline lokalde (F3 başında alınır). Sunucu DoD'si → F10b.

### F2 — Şema-a + seed + paylaşılan kurallar (3 gün) — ✅ TAMAM (2026-08-20)
- [x] `database/schema.prisma` F2a modelleri (User, Address, DeliveryZone, DeliveryDate, Category, Producer, Product, ProductImage, ProductLot, BoxTier, BoxTemplate(+Item), WholesaleLead, Post, LegalDocument, Consent, SiteContent, Setting, MediaFile, AuditLog, MailLog, SystemLog, CronLog) — tümü `Timestamptz(3)` *(✓ 27 enum + 23 model, 41 timestamptz / 0 timestamp)*
- [x] Migration'lar: `0000_extensions` (citext) → `0001_init_core` → `0002_raw_core` (addresses_one_default) *(✓ `20260820000000_extensions` → `20260820130020_init_core` → `20260820130055_raw_core`; prisma timestamp adlandırması; `db:status` güncel)*
- [x] Seed: `convert-products-js.ts` (products.js → catalog.json; meta → Producer), `seed.ts` (22 ürün / 15 üretici / 4 kategori+legacyTab / 2 tier / 2 zone / ProductLot (batch+why) / bu haftanın BoxTemplate'i / Setting commerce.* / admin env'den) *(✓ idempotent; 22 ürün/15 üretici/4 kategori/2 tier/2 zone/48 teslimat tarihi/28 ayar/admin)*
- [x] `packages/shared`: enum'lar, DTO tipleri, durum makineleri (F2b tasarım olarak), `pricing/` (KDV, ilk-2-kutu, ekstra yuvarlama, kargo/eşik zone'dan, kesim hesabı TZ'li) + vitest (UTC ve +03) *(✓ pricing modülü: 13 dosya/103 test — UTC, Europe/Istanbul, America/New_York)*
- [x] CI: `services: postgres:14` ile `migrate deploy + seed + test`; `prisma validate + migrate diff` *(ADR-0017: CI/PG14 provası F10b'ye — şimdilik yok)*
- **Bitti sayılır (lokal):** migration `bagdam_dev`'de ✓; seed yüklü ve idempotent ✓; testler üç TZ'de yeşil ✓; ERD `docs/erd.md` ✓; API health `db: up` ✓; sayfa paritesi 10/10 ✓.

### F3 — Inline bootstrap + katalog dinamik (2 gün) — ✅ TAMAM (2026-08-20)
- [x] `CatalogModule` + `GET /api/v1/bootstrap` (products.js şekline birebir; `tab=legacyTab`, freqOptions şekli, why/batch lot'tan, SOLD_OUT/OUT_OF_SEASON/HIDDEN hariç) + snapshot testi *(✓ dto·controller·service·repository·mapper; snapshot testi products.js ile alan+sıra deepStrictEqual; 2 suite/70 test)*
- [x] 10 `.hbs`'de `<script src="assets/products.js">` → `{{> bootstrap}}` (me/sub şimdilik null); `index.hbs` öne çıkanlar → `home.featured` partial'ı (ürün kartı / tier kartı); `kutu.hbs` pairIds/recommendedTier bootstrap'tan *(✓ `partials/bootstrap.hbs`; `home.featured` şimdilik `web/featured.ts` DEFAULT_FEATURED — F5'te SiteContent)*
- [x] cart.js yaması: `subSetTier` → `__BAGDAM__.templates`, `freshProducts` → `pool`, `isLoggedIn/getSub` → `__BAGDAM__.me/sub` okuyucuları (boşken eski davranış) *(✓ 3 planlı yama, `// F3 bootstrap:` yorumlu)*
- [x] `products.js` repodan silinir; nginx `location /assets/` immutable + `cart.js?v=` *(✓ public/assets/products.js silindi; website/ referansı duruyor; nginx kısmı F10b)*
- **Bitti sayılır (lokal):** HTML diff 8/10 byte-byte + 2 kabul edilen satır (urunler.hbs RECOMMENDED_TIER, kutu.hbs pairIds) ✓; **Playwright 30/30 çift 0 px fark** (10 sayfa × 390/820/1440) ✓; sepet/kutu duman testi 14/14 ✓; bootstrap ≡ products.js ✓; DB'de fiyat/şablon değişince sayfada (60 s cache) ✓. Rapor: `tools/visual-parity/report.md`.

### F4 — Admin iskeleti + admin auth + katalog CRUD + medya import (6 gün) → **ilk görünür teslim** — ✅ LOKAL TAMAM (2026-08-20)
- [x] `AuthModule` çekirdeği (cookie path=/, CSRF, kilit) + UA admin iskeleti (same-origin, `credentials:'include'`) *(✓ access 15 dk + refresh 30 gün rotasyon (bcrypt(sha256) hash, yarış güvenli), `csrf_token` double-submit, 5 hata → 30 dk 423, roller; guard zinciri Throttler → JwtAuth → Csrf → Roles; admin `lib/api.ts`: 401 → bir kez refresh, 403 CSRF → token yenile; auth jest 15 test)*
- [x] Ekranlar 1–8: Giriş · Ürünler liste · Ürün formu (Genel/Fiyat-KDV/Kutu/Tercih/Metinler/**Partiler**/Görseller) · Kategoriler · Üreticiler · Tier'lar · Haftanın Kutusu (yayınla/kopyala) · Medya *(✓ `apps/admin` — tsc + eslint + build + 32 vitest; `/api` `/assets` `/uploads` proxy; Özet sayfası sayılar + sağlık + son audit)*
- [x] `MediaModule` (multer 20 MB → sharp webp+thumb yeni yüklemelerde) + `media:import` (58 mevcut görsel, orijinal yol, ProductImage/BoxTier bağları) *(✓ `POST/GET/PATCH/DELETE /admin/media`, `/uploads/*` statik (main.ts), URL kuralı tek yerde (`media.mapper`); `media:import` 85 görsel (images 40 · sahne 13 · logo 5 · ikonlar 27), idempotent; **sharp workspace'e eklenecek** — bkz. SISTEM-DURUMU açık notlar)*
- [x] `AuditLogInterceptor` (redaksiyon) *(✓ `@Audited(module)` + APP_INTERCEPTOR: actor/action/module/entityId/summary/new-oldValues (e-posta/telefon/adres/parola `[redacted]`), `GET /admin/audit-logs` (ADMIN))*
- **Bitti sayılır:** admin'den ürün/parti/görsel/şablon değişikliği staging'de görünür; audit satırı. *(~17. iş günü)* → **lokal (ADR-0017):** `tools/e2e-admin/run.mjs` Playwright 12/12 — fiyat/parti/görsel/şablon değişikliği `GET /bootstrap` + `/urun.html` + `/kutu.html`'de anında (cache invalidation), audit satırları (LOGIN/UPDATE/CREATE/PUBLISH/UPLOAD), çıkış 401 + CSRF'siz 403; değişiklikler geri alındı (bootstrap ≡ baseline). API jest 6 suite/107 test ✓. Staging görünürlüğü F10b'de.

### F5 — CMS içerik + günlük + yasal + toptan + ayarlar (6 gün) — ✅ LOKAL TAMAM (2026-08-20)
- [x] `ContentModule` (SiteContent + schema, Post, LegalDocument versiyonlu + showInNav/requiresAck), `WholesaleModule` (form fetch, 3/dk/IP), `SettingsModule` (şifreli; zone CRUD; generic grup formu), sitemap/robots *(✓ modules/content · settings (7 grup registry, AES-256-GCM `enc:v1:`) · delivery (zone CRUD + dates/generate) · wholesale (3/dk/IP → 4. istek 429); `/sitemap.xml` + `/robots.txt` kökte; WebController → ContentService/CatalogService uyarlayıcısı; API jest 14 suite/173 test)*
- [x] İçerik seed: SiteContent blokları, LegalDocument v1 (8 nav + 3 hash), 3 Post *(✓ `database/seeds/content/**`: 22 anahtar (registry şeması tek kaynak) · 11 belge · 3 yazı; idempotent — ikinci koşu 0 yeni; `SEED_OVERWRITE_CONTENT=true` ile ezilir)*
- [x] View'larda sabit metinler `{{site.*}}` (index, urunler, kutu, gunluk, politikalar, toptan, nasil-seciyoruz, footer/promo) — sepet/uyelik metinleri F9'a *(✓ `{{{site.*}}}` + sunucu tarafı escape (richtext ham); partial'lar site-footer/promo-bar/journal-post; kategori sekmeleri `{{#each categories}}`; **Playwright 30/30 çift 0 px + duman 14/14** — e2e öncesi ve sonrası)*
- [x] Ekranlar 9–15 (14a): Site Blokları (home.featured karışık sıra) · Promo/Footer/İletişim · Günlük · Yasal Metinler · Toptan · Ayarlar › Bölgeler + gruplar · E-posta/SMS/Ödeme/SEO *(✓ `apps/admin` SchemaForm/RichTextLite/SecretField; vitest 12 dosya/66 test; **e2e F5 13/13** `tools/e2e-admin/run-f5.mjs`)*
- [x] [B16] Doğrula: politikalar.html JS, `showInNav=false` makaleleri (PREINFO / SUBSCRIPTION_CONTRACT / MARKETING_CONSENT) hash/link ile gösteriyor mu? Göstermiyorsa ADR-0003 istisna 7 kapsamında 9. sekme (Abonelik Sözleşmesi) eklenir; sözleşme kopyası ayrıca e-posta ile (F8/F10) *(✓ gösteriyor — 3 nav'sız belge gizli `<article>` olarak basılır, `#slug` ile açılır; 9. sekme gerekmedi)*
- **Bitti sayılır:** admin'den hero/FAQ/politika/blog/iletişim/promo/bölge ücreti değişiyor; diff yalnız içerik. → **lokal (ADR-0017):** e2e F5 13/13 — hero/promo → `/` anında; yazı taslak→yayın→sil; KVKK v2 yayın + 409 + geri; toptan 201→admin→CONTACTED→429; Urla 49→55→49 (bootstrap DELIVERY_FEE); freeShippingRule gte→gt→gte; SMTP parolası maskeli + DB şifreli; audit satırları; **tümü geri alındı → parite 30/30 0 px tekrar**. Rapor `tools/e2e-admin/report-f5.md`.

### F6 — Üyelik + hesap + adres + e-posta çekirdeği (4 gün) — ✅ LOKAL TAMAM (2026-08-20)
- [x] Müşteri auth (register + KVKK/pazarlama kutucukları + Consent, forgot/reset + "parolamı unuttum"), `MeModule` (adres, siparişler, kartlar), `MailModule` (settings → .env fallback; MailLog; DISABLE_MAIL), `Notifier` arayüzü *(✓ `AuthController` register (KVKK_REQUIRED 400 · EMAIL_TAKEN 409 · Consent satırları kullanıcıyla tek işlemde, yayındaki belgeye bağlı · anında giriş · hoş geldin + doğrulama maili) · verify (JWT typ:verify 24 s → `?dogrulandi=1|0`) · forgot (sessiz 200, sha256 token 60 dk) · reset (tek kullanımlık, diğer oturumlar düşer, "parolan değişti" maili) · `MeModule` `/me/address` upsert (tek adres, aktif bölge doğrulaması) · `/me/consents` (İYS PENDING) · orders/cards F8 yer tutucu · `MailModule`: SiteContent `mail.*` 6 Handlebars şablonu (registry grup `mail` + seed) → MailLog → SMTP (Setting mail.* → .env SMTP_*) / `DISABLE_MAIL` önizleme `logs/mail/<id>.html` (`MailLog.error = preview:<dosya>`); `Notifier` + MailNotifier (auth + wholesale.new-lead); `GET /admin/mail-logs`, `POST /admin/settings/mail/test` · `CustomersModule` (liste/detay/PATCH/anonimleştir); API jest 18 suite/195 test)*
- [x] `BahcedenCart.api()` sözleşmesi (CSRF, 401→logout, hata metinleri); auth kapıları API'ye; bootstrap `me` doldu; adres formu ilçe select; ekran 16 (Müşteriler) *(✓ cart.js `api()` (same-origin `/api/v1`, credentials, X-CSRF-Token csrf çerezi/`GET /auth/csrf`, 401 TOKEN_EXPIRED → 1× refresh, diğer 401 → "çıkış" durumu, 403 CSRF_INVALID → taze token, 204 → null, Türkçe hata haritası) · `me()/isLoggedIn()` yalnız bootstrap `__BAGDAM__.me` (WebController req.user'dan; çerezli HTML `private, no-store`) · uyelik/sepet giriş/üye ol/çıkış/parolamı unuttum/`?sifirla=` sıfırlama dalı/`?dogrulandi=1` notu · adres kartı GET/PUT `/me/address` (ilçe select `/delivery/zones`; zip boşaltılabilir) · toptan formu api() (oturumlu CSRF) · localStorage `bahceden_member/session/address` kalktı · admin ekran 16 Müşteriler (liste/detay/PATCH/anonimleştir) + Sistem › E-posta günlüğü + Ayarlar › E-posta "test gönder" (vitest 18 dosya/87 test); **Playwright parite 30/30 0 px (`--mask=#forgotNote`, istisna 4) + duman 14/14; e2e F6 19/19** `tools/e2e-admin/run-f6.mjs`)*
- **Bitti sayılır:** kayıt → giriş → çıkış → parola sıfırlama maili DKIM imzalı; adres ortak; Consent kayıtları; çerezli HTML no-store, anonim 10 s cache. → **lokal (ADR-0017):** e2e F6 19/19 — kayıt → anında giriş → doğrulama bağlantısı → çıkış → giriş → parola sıfırlama maili (DISABLE_MAIL önizlemesinden bağlantı; **DKIM imzalı gerçek gönderim staging/F10b'de — nodemailer kurulumu + SMTP/DNS, SISTEM-DURUMU F6 notu**) → adres ortak (uyelik ↔ sepet, `/me/address`) → Consent satırları (KVKK/pazarlama) → çerezli HTML `private, no-store`, anonim `public, max-age=0, s-maxage=10` → admin ekran 16 + anonimleştirme → **test verisi temizlendi, parite 30/30 0 px**. Rapor `tools/e2e-admin/report-f6.md`.

### F7 — Şema-b + fiyatlama + abonelik motoru (9 gün) — *UI'siz, testli*
- [ ] 1. gün F2b tasarım spike'ı + `0003_commerce` / `0004_raw_commerce` (Cart, Order, OrderLine, PaymentMethod, Payment, Refund, WebhookEvent, Subscription, SubscriptionCycle, CycleItem, SubscriptionEvent, SubscriptionCancellation)
- [ ] `PricingService` (tek kaynak; karışık sepet kind önceliği; kargo abone ‖ zone eşik; ilk-kutu/retention; DELTA)
- [ ] `PaymentProvider` + `ManualProvider`; `ChargeStrategy` MIT / PAYMENT_LINK; `DeliveryDatesService` (generate TZ'li; atomik rezerv/iade; full)
- [ ] `SubscriptionsModule`: `cycles:ensure` (içerik = yayınlanmış BoxTemplate; şablon yoksa cycle üretilmez + ops uyarısı), `cycles:lock-and-charge`, `cycles:expire-payment-links`, dunning (+24 s/+72 s → UNPAID; 2 ardışık → PAST_DUE), skip/unskip (yılda 1, hak iade; cycle#1 atlanamaz), swap/pref/extras/merge-cart, freq/day/address/card PATCH, tek seferlik kutu → COMPLETED, cancel akışı (1:N, teklif, effectiveAt ≤7 g, confirm/abandon, refundDueAt), telafi ucu, SubscriptionEvent
- **Bitti sayılır:** Jest (UTC ve Europe/Istanbul): "11:59 ekstra kabul / 12:01 red", "2 haftalık takvim", "atla→geri al→kesim", "cycle#1 peşin + DELTA", "tek seferlik → COMPLETED", "iptal: kilitli cycle teslim", "UNPAID×2 → PAST_DUE", "PAYMENT_LINK süre dolunca UNPAID", "gün dolu → 409", 8 hafta fake-timer simülasyonu.

### F8 — Checkout + sipariş + iyzico (6 gün)
- [ ] iyzico adaptörü (CF init/retrieve, registerCard, saklı kart NON3D, iade, webhook HMAC + WebhookEvent); `POST /checkout/quote|checkout` (`$transaction`: doğrula → DeliveryDate rezerv → Order + lines snapshot [+ Subscription PENDING + cycle#1] → Payment → CF init); callback → PAID/ACTIVE/PaymentMethod; `GET /pay/:linkToken`
- [ ] sepet.html: CF konteyneri, özet quote'tan, buton metni, `?siparis=` (no-store); customerEmail readonly; Order geçişleri + iptal yan etkileri; sipariş onayı e-postası + LegalDocument kopyası; ekran 17 (Siparişler)
- **Bitti sayılır:** staging sandbox'ta tekil ürün / tek seferlik kutu / abonelik ilk ödemesi (3DS + kart saklama) / sonraki cycle (MIT ve link) / webhook çift teslim IGNORED / iade; Consent kayıtları.

### F9 — Web etkileşimli sayfalar API'ye + ops ekranları (7 gün)
- [ ] `BahcedenCart.remote` (sub kaynağı bootstrap, mutasyonlar API; `nextCutoff/lockedDeliveryDay` → deliveryDates; canlı modda type butonları disabled; kutu.html onay → PATCH cycles/current; uyelik renderSub durum dalları; atla/geri al; iptal akışı; kart formu → PSP add-session; "kutuma ekle" → merge-cart); `bahceden_card/orders/retention_offered/address` localStorage'dan kaldırılır
- [ ] `sepet.texts` / `uyelik.texts` CMS; ekranlar 14b, 18–21: Teslimat tarihleri · Ödeme problemleri · Abonelikler · Teslimat Günü (pick/packing/etiket, toplu durum, telafi) · Özet
- **Bitti sayılır:** Playwright e2e misafir → üye → abonelik → ekstra → atla → iptal; tek seferlik kutu yönetimi; ops günü admin'den uçtan uca; localStorage'da kart/parola yok; diff 0 (istisnalar hariç).

### F10 — Bildirimler + yasal/çerez + KVKK + sertleştirme + şema dondurma (4 gün)
- [ ] E-posta şablonları (ADR-0014 listesi); SMS opsiyonel; çerez banner'ı + Consent; veri saklama matrisi ADR'ı + `kvkk:purge`; güvenlik gözden geçirme (helmet/CSP frame-src iyzico, WAF); k6; restore provası; **ADR "şema v1 donduruldu"**; ekran 22 (Sistem); runbook + `SISTEM-DURUMU.md`
- **Bitti sayılır:** her yaşam döngüsü olayı MailLog'da; restore raporu; go-live checklist.

### F10b — Sunucu kurulumu + yayın hazırlığı (3 gün) — *ADR-0017: lansmandan hemen önce*
> Not (2026-08-20): apex `bagdam.com` "yakında" sayfası **ayrı çalışmada yayınlandı ✓** — statik coming-soon (`/var/www/bagdam-comingsoon`, geçici `sites-available/bagdam.com.conf`, Let's Encrypt, Cloudflare A/CNAME proxied + Full strict); aynı sayfanın "artık Bağdam" sürümü `bahcedenal.com.tr`'de. Ayrıntı: `deploy/coming-soon/README.md`. F10b'de tam vhost bu geçici vhost'un **üzerine yazar** (önce Origin CA), `SITE_MODE=coming-soon` apex'i devralır; bahcedenal → bagdam 301 yönlendirmesi kullanıcı kararıyla ayrıca.
- [ ] Sunucu: Node 22 ikilisi (proje bazlı) + PM2 `interpreter`; `/opt/bagdam`, `/opt/bagdam-staging`; PG `bagdam_db` + `bagdam_staging` (+ `citext`), roller `bagdam`, `bagdam_ro`; `.env` (600); `ecosystem.config.js`
- [ ] nginx: `conf.d/02-bagdam-cache.conf` + gzip_types; vhost'lar (apex, admin, staging, admin-staging; staging basic auth); bakım sayfası; `nginx -t`
- [ ] SSL: Cloudflare Origin CA wildcard → `/etc/ssl/bagdam/`; Cloudflare kayıtları (A @, CNAME www/admin/staging/admin-staging proxied; SPF/DKIM/DMARC + MX DNS-only); Full (strict), Always HTTPS, HSTS, WAF istisnası, Cache Rule
- [ ] CI/CD: GitHub'a push; kısıtlı deploy anahtarı + `deploy-dispatch.sh`; secrets; ilk deploy staging → prod; `SITE_MODE=coming-soon` apex'te
- [ ] Ops: `backup-bagdam.sh` cron, health-check/error-watcher/daily-report satırları, logrotate, off-site yedek
- [ ] PG 14 uyum provası: staging DB'ye `migrate deploy` + seed + duman testi
- [ ] Playwright: lokal baseline ile staging karşılaştırması (diff ≈ 0)
- **Bitti sayılır:** `https://bagdam.com` "yakında" 200; `https://staging.bagdam.com` tam site (basic auth) lokal ile aynı; health 200 ×2; deploy yeşil; gece yedeği + off-site; health-check Bağdam satırları.

### F11 — Lansman + hypercare (2 gün)
- [ ] iyzico prod anahtarları + NON3D teyidi → `commerce.chargeStrategy`; apex coming-soon → tam site; 404/500/bakım kontrol; `unused/` + 27 kullanılmayan görsel temizliği; ETBİS/İşletme Kayıt/İYS durumu; ilk teslimat günü izleme; 2 hafta günlük rapor
- **B planı:** NON3D yoksa PAYMENT_LINK varsayılan; en kötü durumda abonelik "yakında", tek seferlik kutu + tekil ürünle lansman.

## 3. Sizin yapmanız gerekenler (geliştirmeye paralel)

| Ne | Ne zaman | Neden |
|---|---|---|
| iyzico sandbox hesabı + merchant başvurusu; "saklı karttan NON3D (merchant-initiated) tahsilat" yetkisini yazılı sor | F0–F1 | F8 ve F11 stratejisi |
| E-posta sağlayıcısı seçimi (Resend / Amazon SES) + alan adı doğrulama | F0; DNS kayıtları F1 | F6 parola sıfırlama maili DKIM imzalı gitmeli |
| GitHub: repo Settings → Code security → secret scanning + push protection aç | F0 | public repo |
| ETBİS kaydı, gıda İşletme Kayıt Belgesi, İYS başvurusu, e-Arşiv yolu (mali müşavir) | F0–F10 arası | lansman ön koşulu |
| F0 kararlarına itiraz/değişiklik (ADR 0005–0010 iş kuralları) | F2'den önce | şema bu kararlara göre yazılıyor |
| Haftanın kutusu içerikleri, üretici bilgileri, yasal metin taslakları | F4–F5 | admin'den girilecek |

## 4. Kapsam dışı (P2)
ADR-0016 listesi: temiz URL + 301, PayTR, kargo aracı + Tr il/ilçe/mahalle tabloları, WhatsApp, e-Arşiv entegratörü, İYS API, pause, kupon UI, OTP/2FA, Invoice tablosu, çoklu adres UI, ayıplı ürün formu, Cart merge, üretici sayfası.

## 5. Sıradaki somut adım: F1 başlangıcı

```bash
cd "<repo-kökü>"
corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm init && printf 'packages:\n  - "apps/*"\n  - "packages/*"\n' > pnpm-workspace.yaml
# UA'dan kopya: turbo.json, .npmrc, .env.example, deploy.sh, ecosystem.config.js, .github/workflows/{deploy,deploy-staging}.yml
pnpm dlx @nestjs/cli@11 new apps/api --package-manager pnpm --skip-git --strict
pnpm create vite apps/admin --template react-ts
mkdir -p database/{migrations,seeds,data} packages/shared/src docs/adr apps/api/{views,public}
pnpm add -Dw prisma@6 typescript tsx turbo vitest @playwright/test && pnpm add -w @prisma/client@6
pnpm --filter ./apps/api add @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt @nestjs/throttler @nestjs/schedule @nestjs/cache-manager cache-manager hbs helmet compression cookie-parser bcrypt class-validator class-transformer sharp multer nodemailer date-fns date-fns-tz
cp website/*.html apps/api/views/ && for f in apps/api/views/*.html; do mv "$f" "${f%.html}.hbs"; done
cp -r website/assets apps/api/public/assets && cp website/styles.css apps/api/public/
git mv website/unused docs/arsiv-prototip
```
Sonra: `main.ts/app.module.ts` (UA), `WebController` (+coming-soon, 404), `HealthController` → lokalde `pnpm dev` ile `/api/v1/health` 200 ve 10 sayfa açılıyor → sunucu kurulumu (F1 listesi) → staging'e ilk deploy.
