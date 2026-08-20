# Bağdam — Sistem Durumu

> Canlı/lokal sistemin anlık durumu. Her faz sonunda güncellenir. Son güncelleme: 2026-08-20 (F5 sonu)

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| F0 Karar sprinti | ✅ | 16 ADR (docs/adr), state-machines.md; kullanıcı aksiyonları (iyzico/e-posta sağlayıcısı/ETBİS) bekliyor |
| F1 Walking skeleton | ✅ (lokal) | Monorepo + apps/api + apps/admin + packages/shared + deploy/ dosyaları. Sunucu kurulumu ADR-0017 ile F10b'ye taşındı |
| F2 Şema-a + seed + pricing | ✅ | `database/schema.prisma` (23 model, F2a), 3 migration, seed idempotent, shared pricing 117 test (ADR-0018 kuralları dahil), health `db: up` |
| F3 Inline bootstrap + katalog dinamik | ✅ | `CatalogModule` + `/api/v1/bootstrap`; `partials/bootstrap.hbs`; cart.js 3 yama; products.js kaldırıldı; HTML diff 8/10 byte-byte + 2 kabul edilen satır; **Playwright 30/30 çift 0 px**; duman 14/14; API 70 test |
| F4 Admin iskeleti + auth + katalog CRUD + medya | ✅ (lokal) | `AuthModule` (cookie access 15 dk + refresh 30 gün rotasyon, CSRF double-submit, 5 hata → 30 dk kilit, roller) + guard zinciri Throttler → JwtAuth → Csrf → Roles; `AuditLogInterceptor` (redaksiyon) + `GET /admin/audit-logs`; `CatalogAdminController` (/api/v1/admin/products·lots·images·categories·producers·tiers·box-templates·box-week); `MediaModule` (multer 20 MB → sharp webp+thumb, `/uploads/*` statik) + `media:import` (85 görsel, idempotent); admin ekranları 1–8. API jest 6 suite/107 test; admin vitest 5/32; **Playwright e2e 12/12** (`tools/e2e-admin/report.md`) |
| F5 CMS içerik + günlük + yasal + toptan + ayarlar | ✅ (lokal) | `ContentModule` (SiteContent 22 anahtar × registry şeması + PUT doğrulama, Post, LegalDocument sürümlü publish/409/nav, Consent, `/sitemap.xml` + `/robots.txt` kökte) · `SettingsModule` (7 grup registry; sırlar AES-256-GCM `enc:v1:`, GET maskeli) · `DeliveryModule` (public zones/dates, admin zone CRUD + dates/generate) · `WholesaleModule` (POST 3/dk/IP + admin); WebController → `ContentSourceAdapter` (ContentService + CatalogService.listActiveCategories; Prisma okuyucusu kalktı); 10 .hbs'de `{{{site.*}}}` + 3 partial; içerik seed'i (22 · 11 · 3, idempotent); admin ekranları 9–15 (14a). API jest 14 suite/173 test; admin vitest 12 dosya/66 test; **Playwright parite 30/30 0 px + duman 14/14** (ContentService ile); **Playwright e2e F5 13/13** (`tools/e2e-admin/report-f5.md`) |
| F6–F11 | ⬜ | — |

## Lokal ortam (doğrulandı 2026-08-20)

| Veritabanı | ✅ PostgreSQL 18.4 `bagdam_dev` / `bagdam_test` (rol `bagdam`, citext, TZ Europe/Istanbul); `pnpm db:status` güncel; seed: categories 4 · producers 15 · products 22 · product_images 27 · product_lots 22 · media_files 85 (seed 29 + `media:import` 56: ikonlar/logo/sahne/urunler) · box_tiers 2 · box_templates 2 (16 item) · delivery_zones 2 · delivery_dates 48 · settings 31 (commerce 17 — ADR-0018 üç kural dahil; seo/cookies/payment) · site_content 22 · legal_documents 11 (nav 8 + hash 3, v1) · posts 3 · users 1 (admin) |
|---|---|

| Bileşen | Durum |
|---|---|
| `pnpm install` | ✅ pnpm 9.15.9, 822 paket |
| `@bagdam/shared` | ✅ tsc + build + 117 vitest (TZ=UTC ve Europe/Istanbul) |
| `@bagdam/api` | ✅ tsc + nest build; `node dist/main.js` → http://127.0.0.1:4010 ; `GET /api/v1/health` 200; F5: `/sitemap.xml` (text/xml, 10 sayfa + günlük yazıları) ve `/robots.txt` kökte 200 (global prefix dışı); jest 14 suite/173 test (gerçek DB) |
| Sayfa paritesi | ✅ 10/10 sayfa eski statik siteyle byte-byte aynı (`cmp`); `/` = index |
| Önbellek başlıkları | ✅ anonim `public, max-age=0, s-maxage=10`; `access_token` çerezli `private, no-store` |
| 404 | ✅ web → 404.hbs (text/html), `/api/*` → JSON zarfı; `/api/v1/index.html` 404 |
| SITE_MODE | ✅ `coming-soon`: `/` ve `/index.html` → coming-soon, diğer 9 sayfa 404, statikler 200 |
| Görsel parite (F3) | ✅ `tools/visual-parity/run.mjs` — eski 8080 vs yeni 4010, 10 sayfa × 390/820/1440, pixelmatch 0.1 → 30/30 OK (0 px), sepet/kutu duman 14/14; rapor `tools/visual-parity/report.md` |
| Görsel parite (F5, CMS) | ✅ aynı araç, eski 8080 vs geçici 4043 (ContentService kaynaklı `{{{site.*}}}`, `{{#each legal|legalDocs|posts|categories}}`): **30/30 0 px**, duman 14/14 — e2e öncesi ve geri alma sonrası iki kez. Byte düzeyinde yalnız: footer `mapsUrl` `&`→`&amp;`, nasil-seciyoruz metin içi `"`→`&quot;` (2 satır), gunluk prototipteki CRLF satır sonları (gövde metni aynı), politikalar 3 gizli taslak makale, toptan form script'i, bootstrap satırı |
| `@bagdam/admin` | ✅ tsc + eslint + vite build (`dist/app/*`) + 66 vitest (12 dosya; F5 ekranları 9–15 dahil); dev `http://localhost:4011` (Vite ::1'e bağlanır), `/api` + `/assets` + `/uploads` proxy → 4010 (`ADMIN_API_PROXY` env ile hedef değişir) |
| Admin e2e (F4) | ✅ `tools/e2e-admin/run.mjs` — geçici API :4033 + `vite preview` :4034 (proxy'li): giriş → fiyat 480→485 (bootstrap + `/urun.html` anında) → parti ZY-12 güncel (batch/why) → PNG yükle → ürüne ekle → kapak (bootstrap `img=uploads/urunler/….webp`, `/uploads` statik 200) → Haftanın Kutusu sezon/small değiştir+Yayınla (bootstrap + `/kutu.html` templates) → kategori panelNote (admin API) → audit-logs (LOGIN/UPDATE/CREATE/PUBLISH/UPLOAD, actorEmail) → çıkış 401 + CSRF'siz POST 403 → **tüm değişiklikler geri alındı, bootstrap ≡ baseline**; 12/12 OK, rapor `tools/e2e-admin/report.md` |
| Admin e2e (F5) | ✅ `tools/e2e-admin/run-f5.mjs` — geçici API :4043 + `vite preview` :4044 (proxy'li): giriş → Site Blokları home.hero başlığı (RichTextLite HTML modu) → `/` HTML'inde anında → geri al · promoBar → `/index.html` + `/urunler.html` · Günlük: yeni yazı taslak (gunluk.html'de yok) → yayınla (gunluk.html + `/api/v1/posts` + ana sayfa son yazılar + sitemap) → sil · Yasal: KVKK yeni taslak sürüm → Yayınla (politikalar.html + `/api/v1/legal/kvkk` v2; yayındaki PUT 409 LEGAL_CURRENT_LOCKED; `/legal/kvkk/v/1` arşiv) → v1 yeniden yayınla · Toptan: `/toptan.html` formu 201 → admin listesi → CONTACTED → 4. istek 429 (3/dk/IP) · Bölgeler: Urla 49→55 → bootstrap + `/index.html` DELIVERY_FEE → 49; dates/generate idempotent (0 yeni) · Genel: commerce.freeShippingRule gte→gt → GET /admin/settings + bootstrap.commerce → gte · E-posta: SMTP parolası → GET maskeli+hasValue, DB `enc:v1:` (düz metin yok), maske PUT değiştirmez, test düğmesi 501→"F6" · audit-logs (content/settings/delivery/wholesale, `[redacted]`) · çıkış 401 → **tümü geri alındı (API + psql: toptan talepleri, KVKK v2 taslağı, mail.pass), site-content/legal/posts/bootstrap ≡ baseline**; 13/13 OK, rapor `tools/e2e-admin/report-f5.md` |
| Medya içe aktarma | ✅ `pnpm --filter @bagdam/api media:import` → tarandı 85 · media_files 85 (ikonlar 27 · logo 5 · sahne 13 · urunler 40); ikinci koşu 0 değişiklik (idempotent) |

## Sunucu

> Coming-soon / apex yayını bu çalışmanın kapsamı dışında (kullanıcı ayrı çalışmada yürütüyor).

ADR-0017: sunucu kurulumu ve yayın **F10b**'de (lansmandan hemen önce). `deploy/README.md` runbook'u hazır. Portlar 5010 (prod) / 5011 (staging) ayrılmış durumda.

## Açık ürün kararları (kuyruk ≤3 — ADR-0016)

Kapatılanlar (2026-08-20): aşağıdaki üç madde **→ ayara taşındı (ADR-0018); varsayılan: ≥ / kuruş / evet; admin F5'te değiştirilebilir** (Setting `commerce.freeShippingRule` / `commerce.discountRounding` / `commerce.subscriberFreeShipping`; pricing `PricingContext.rules`).
- ~~Ücretsiz kargo eşiği `≥ 1000` mi `> 1000` mi~~ → `freeShippingRule` (`gte` varsayılan | `gt`).
- ~~İlk-2-kutu/retention indirimi 324,50 mi 325 mi~~ → `discountRounding` (`kurus` varsayılan | `tl`).
- ~~Aktif abonenin tekil ürün siparişinde kargo 0 mı zone kuralı mı~~ → `subscriberFreeShipping` (`true` varsayılan | `false`; abonelik siparişinde kargo her zaman 0).

Kuyrukta kalan:
1. **Kupon sistemi MVP'ye alınsın mı?** (ADR-0016 P2 listesinde; kullanıcı kararı bekleniyor.)

## Bilinen açık notlar (F1 ajan raporlarından, sonraki fazlarda ele alınacak)

- **F5 notları (2026-08-20):**
  - `CatalogService.buildBootstrap` `deliveryDates`'i hâlâ kendi repository sorgusuyla kurar; `DeliveryService.getDates('urla',4)` ile eşdeğerliği delivery testi doğrular (aynı mapper kuralı). F7 cron `delivery-dates:generate` → `DeliveryService.generateDates()`; catalog'un DeliveryService'e bağlanması F7'de (döngü yok: Delivery → Settings, Catalog bağımsız).
  - Site `toptan.html` formu anonim çalışır; oturumlu müşteri (F6) için `BahcedenCart.api()` X-CSRF-Token ekleyecek (CsrfGuard access çerezi görünce başlık ister — e2e'de site formu ayrı anonim context'te çalıştırıldı; admin çerezleri aynı host/farklı portta da gönderilir).
  - Ayarlar: admin formu grubun TÜM alanlarını gönderir → zorunlu olmayan `number` boş/null gelirse alan **değişmez** (SKIP, settings.validation); sır alanları boş/maske → değişmez. "Sırrı temizle" ucu yok (e2e psql ile sildi) — F6 MailModule ile birlikte değerlendirilebilir.
  - Yasal: taslak sürüm silme ucu yok (admin'in açtığı v2+ taslaklar kalır; yayınlanmazsa zararsız; e2e psql ile temizledi). [B16] sonucu: politikalar.html JS nav'sız makaleyi `#slug` ile gösteriyor → 9. sekme gerekmedi (ADR-0003 istisnası kullanılmadı).
  - Kategori sekmeleri/panel notları `CatalogService.listActiveCategories()` (60 s cache; kategori mutasyonu `invalidateBootstrapCache` ile düşürür). SiteContent/legal/posts cache'leri ContentAdminService yazımında düşer (TTL 5 dk yalnız emniyet).
  - Admin `lib/apiTypes.ts` F5 tipleri shared'daki (AdminSiteContentItem / AdminLegalGroup / AdminSettingGroup / DeliveryZone / WholesaleLeadList …) ile aynı şekil ama yerel kopya; `export type {…} from '@bagdam/shared'` ile tekilleştirilebilir.
  - İçerik düzenlendikten sonra parite koşusu için `SEED_OVERWRITE_CONTENT=true pnpm db:seed` (admin değişikliklerini seed değerlerine çeker).

- PM2 cluster modunda `interpreter` yok sayılabilir → sunucuda `pm2 show bagdam-api` ile Node sürümü doğrulanacak; gerekirse fork modu (ecosystem `BAGDAM_EXEC_MODE=fork`).
- `styles.css` / `cart.js` için nginx'te 1 yıl immutable cache → F3'te `?v=` sürüm parametresi gelene kadar bu iki dosyaya kısa cache.
- ~~Admin API sözleşmesi varsayımları (`/auth/csrf`, `/auth/login`, `/auth/me`, `/auth/logout`) F4'te teyit edilecek.~~ → F4'te doğrulandı (e2e 12/12).
- **F4 açık (bağımlılık):** `sharp` bagdam workspace'inde kurulu değil (yalnız UA projesinin pnpm store'unda) → `pnpm --filter @bagdam/api add sharp` gerekli; kuruluncaya kadar `POST /admin/media` 503 (açık mesaj), diğer medya uçları çalışır. e2e bu koşuda sharp'ı geçici `NODE_PATH` ile UA store'undan yükleyerek webp+thumb dalını doğruladı. `bcrypt` + `@types/bcrypt` kök devDependencies'ten hoist ile çözülüyor → apps/api dependencies'e eklenmeli (prod `--prod` kurulumda kırılır). `@types/multer` yok (gerekmiyor: yerel `UploadedFileLike`).
- **F4 açık (deploy):** admin Vite çıktısı artık `dist/app/*` (`/assets/*` API medya yolu için boşaltıldı) → `deploy/nginx/admin*.conf`: `location /app/` immutable + `location /assets/` → API public (alias/proxy) eklenmeli; `/uploads/` location'ı zaten var. Dev/preview'da `/assets` + `/uploads` proxy'si vite.config.ts'te.
- F4 notu: Category.panelNote yalnız admin API'de (urunler.html panel metinleri F3'te statik; F5 CMS ile `{{site.*}}`). Bootstrap/public DTO'larda görsel yolu site-göreli (`assets/...` aynen, yüklemeler `uploads/<klasör>/<ad>.webp`; `media.mapper#toSiteMediaPath` tek kural); admin DTO'larında `/assets/...` | `/uploads/...`.
- F4 notu: testler (auth/catalog-admin/media spec) ve e2e gerçek `bagdam_dev` DB'sine yazar ve kendi verisini temizler; yalnız `audit_logs` satırları birikir (append-only, tasarım gereği). `apps/api/.env`'deki `PORT` geçici koşularda `PORT=4033 node dist/main.js` ile ezilir; 4010 dev API'sine dokunulmadı.
- dunning `retryHours [24,72]` teslimat gününü aşabilir → F7 spike'ında pencere daraltılacak (state-machines.md §14).
- Off-site yedek için sunucuda rclone/age yok → kurulum `deploy/README.md` §10.
- Raw SQL migration'larda kolon adları camelCase (`"userId"`, `"isDefault"`); F7 `raw_commerce` için `orders_orderNo_seq` / `"providerPaymentId"` kullanılacak (BACKEND-PLANI §2 notu güncellendi).
- `pnpm db:migrate -- --name x` yazımı prisma'yı interaktif soruya düşürür; doğru: `pnpm db:migrate --create-only --name <ad>` (CLAUDE.md'de).
- Kargo KDV oranı planda yok (vatTotal yalnız satır KDV'si) → fatura için F8 öncesi karar.
- `MediaFile.path` unique değil; F4 media:import aynı path-upsert kuralını kullanmalı (ileride additive `@@unique([path])`).
- Prisma 7 `package.json#prisma.seed` alanını kaldıracak → ileride `prisma.config.ts` (kapsam dışı).
