# Bağdam — Sistem Durumu

> Canlı/lokal sistemin anlık durumu. Her faz sonunda güncellenir. Son güncelleme: 2026-08-20 (F4 sonu)

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| F0 Karar sprinti | ✅ | 16 ADR (docs/adr), state-machines.md; kullanıcı aksiyonları (iyzico/e-posta sağlayıcısı/ETBİS) bekliyor |
| F1 Walking skeleton | ✅ (lokal) | Monorepo + apps/api + apps/admin + packages/shared + deploy/ dosyaları. Sunucu kurulumu ADR-0017 ile F10b'ye taşındı |
| F2 Şema-a + seed + pricing | ✅ | `database/schema.prisma` (23 model, F2a), 3 migration, seed idempotent, shared pricing 117 test (ADR-0018 kuralları dahil), health `db: up` |
| F3 Inline bootstrap + katalog dinamik | ✅ | `CatalogModule` + `/api/v1/bootstrap`; `partials/bootstrap.hbs`; cart.js 3 yama; products.js kaldırıldı; HTML diff 8/10 byte-byte + 2 kabul edilen satır; **Playwright 30/30 çift 0 px**; duman 14/14; API 70 test |
| F4 Admin iskeleti + auth + katalog CRUD + medya | ✅ (lokal) | `AuthModule` (cookie access 15 dk + refresh 30 gün rotasyon, CSRF double-submit, 5 hata → 30 dk kilit, roller) + guard zinciri Throttler → JwtAuth → Csrf → Roles; `AuditLogInterceptor` (redaksiyon) + `GET /admin/audit-logs`; `CatalogAdminController` (/api/v1/admin/products·lots·images·categories·producers·tiers·box-templates·box-week); `MediaModule` (multer 20 MB → sharp webp+thumb, `/uploads/*` statik) + `media:import` (85 görsel, idempotent); admin ekranları 1–8. API jest 6 suite/107 test; admin vitest 5/32; **Playwright e2e 12/12** (`tools/e2e-admin/report.md`) |
| F5–F11 | ⬜ | — |

## Lokal ortam (doğrulandı 2026-08-20)

| Veritabanı | ✅ PostgreSQL 18.4 `bagdam_dev` / `bagdam_test` (rol `bagdam`, citext, TZ Europe/Istanbul); `pnpm db:status` güncel; seed: categories 4 · producers 15 · products 22 · product_images 27 · product_lots 22 · media_files 85 (seed 29 + `media:import` 56: ikonlar/logo/sahne/urunler) · box_tiers 2 · box_templates 2 (16 item) · delivery_zones 2 · delivery_dates 48 · settings 31 (commerce 17 — ADR-0018 üç kural dahil) · site_content 3 · users 1 (admin) |
|---|---|

| Bileşen | Durum |
|---|---|
| `pnpm install` | ✅ pnpm 9.15.9, 822 paket |
| `@bagdam/shared` | ✅ tsc + build + 117 vitest (TZ=UTC ve Europe/Istanbul) |
| `@bagdam/api` | ✅ tsc + nest build; `node dist/main.js` → http://127.0.0.1:4010 ; `GET /api/v1/health` 200 |
| Sayfa paritesi | ✅ 10/10 sayfa eski statik siteyle byte-byte aynı (`cmp`); `/` = index |
| Önbellek başlıkları | ✅ anonim `public, max-age=0, s-maxage=10`; `access_token` çerezli `private, no-store` |
| 404 | ✅ web → 404.hbs (text/html), `/api/*` → JSON zarfı; `/api/v1/index.html` 404 |
| SITE_MODE | ✅ `coming-soon`: `/` ve `/index.html` → coming-soon, diğer 9 sayfa 404, statikler 200 |
| Görsel parite (F3) | ✅ `tools/visual-parity/run.mjs` — eski 8080 vs yeni 4010, 10 sayfa × 390/820/1440, pixelmatch 0.1 → 30/30 OK (0 px), sepet/kutu duman 14/14; rapor `tools/visual-parity/report.md` |
| `@bagdam/admin` | ✅ tsc + eslint + vite build (`dist/app/*`) + 32 vitest (5 dosya); dev `http://localhost:4011` (Vite ::1'e bağlanır), `/api` + `/assets` + `/uploads` proxy → 4010 (`ADMIN_API_PROXY` env ile hedef değişir) |
| Admin e2e (F4) | ✅ `tools/e2e-admin/run.mjs` — geçici API :4033 + `vite preview` :4034 (proxy'li): giriş → fiyat 480→485 (bootstrap + `/urun.html` anında) → parti ZY-12 güncel (batch/why) → PNG yükle → ürüne ekle → kapak (bootstrap `img=uploads/urunler/….webp`, `/uploads` statik 200) → Haftanın Kutusu sezon/small değiştir+Yayınla (bootstrap + `/kutu.html` templates) → kategori panelNote (admin API) → audit-logs (LOGIN/UPDATE/CREATE/PUBLISH/UPLOAD, actorEmail) → çıkış 401 + CSRF'siz POST 403 → **tüm değişiklikler geri alındı, bootstrap ≡ baseline**; 12/12 OK, rapor `tools/e2e-admin/report.md` |
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
