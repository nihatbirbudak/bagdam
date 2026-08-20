# Bağdam — Sistem Durumu

> Canlı/lokal sistemin anlık durumu. Her faz sonunda güncellenir. Son güncelleme: 2026-08-20

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| F0 Karar sprinti | ✅ | 16 ADR (docs/adr), state-machines.md; kullanıcı aksiyonları (iyzico/e-posta sağlayıcısı/ETBİS) bekliyor |
| F1 Walking skeleton | ✅ (lokal) | Monorepo + apps/api + apps/admin + packages/shared + deploy/ dosyaları. Sunucu kurulumu ADR-0017 ile F10b'ye taşındı |
| F2 Şema-a + seed + pricing | ✅ | `database/schema.prisma` (23 model, F2a), 3 migration, seed idempotent, shared pricing 103 test, health `db: up` |
| F3–F11 | ⬜ | — |

## Lokal ortam (doğrulandı 2026-08-20)

| Veritabanı | ✅ PostgreSQL 18.4 `bagdam_dev` / `bagdam_test` (rol `bagdam`, citext, TZ Europe/Istanbul); `pnpm db:status` güncel; seed: categories 4 · producers 15 · products 22 · product_images 27 · product_lots 22 · media_files 29 · box_tiers 2 · box_templates 2 (16 item) · delivery_zones 2 · delivery_dates 48 · settings 28 · site_content 3 · users 1 (admin) |
|---|---|

| Bileşen | Durum |
|---|---|
| `pnpm install` | ✅ pnpm 9.15.9, 822 paket |
| `@bagdam/shared` | ✅ tsc + build + 36 vitest (TZ=UTC ve Europe/Istanbul) |
| `@bagdam/api` | ✅ tsc + nest build; `node dist/main.js` → http://127.0.0.1:4010 ; `GET /api/v1/health` 200 |
| Sayfa paritesi | ✅ 10/10 sayfa eski statik siteyle byte-byte aynı (`cmp`); `/` = index |
| Önbellek başlıkları | ✅ anonim `public, max-age=0, s-maxage=10`; `access_token` çerezli `private, no-store` |
| 404 | ✅ web → 404.hbs (text/html), `/api/*` → JSON zarfı; `/api/v1/index.html` 404 |
| SITE_MODE | ✅ `coming-soon`: `/` ve `/index.html` → coming-soon, diğer 9 sayfa 404, statikler 200 |
| `@bagdam/admin` | ✅ tsc + eslint + vite build + 8 vitest; dev `http://localhost:4011` (Vite ::1'e bağlanır), `/api` proxy → 4010 |

## Sunucu

> Coming-soon / apex yayını bu çalışmanın kapsamı dışında (kullanıcı ayrı çalışmada yürütüyor).

ADR-0017: sunucu kurulumu ve yayın **F10b**'de (lansmandan hemen önce). `deploy/README.md` runbook'u hazır. Portlar 5010 (prod) / 5011 (staging) ayrılmış durumda.

## Açık ürün kararları (kuyruk ≤3 — ADR-0016)

1. **Ücretsiz kargo eşiği:** `≥ 1000 TL` (pricing testleri böyle) mi, prototipteki gibi `> 1000` mi? (tek satır: `shipping.ts`)
2. **İlk-2-kutu/retention indirimi yuvarlama:** 649 → 324,50 (Decimal, kuruş) mi, prototipteki gibi 325 (tam TL) mi?
3. **Aktif abonenin tekil ürün siparişinde kargo:** 0 (ADR-0005 "abone") mi, zone kuralı mı (state-machines.md #15 / prototip)? → F7'de tek cümleyle hizalanacak.

## Bilinen açık notlar (F1 ajan raporlarından, sonraki fazlarda ele alınacak)

- PM2 cluster modunda `interpreter` yok sayılabilir → sunucuda `pm2 show bagdam-api` ile Node sürümü doğrulanacak; gerekirse fork modu (ecosystem `BAGDAM_EXEC_MODE=fork`).
- `styles.css` / `cart.js` için nginx'te 1 yıl immutable cache → F3'te `?v=` sürüm parametresi gelene kadar bu iki dosyaya kısa cache.
- Admin API sözleşmesi varsayımları (`/auth/csrf`, `/auth/login`, `/auth/me`, `/auth/logout`) F4'te teyit edilecek.
- dunning `retryHours [24,72]` teslimat gününü aşabilir → F7 spike'ında pencere daraltılacak (state-machines.md §14).
- Off-site yedek için sunucuda rclone/age yok → kurulum `deploy/README.md` §10.
- Raw SQL migration'larda kolon adları camelCase (`"userId"`, `"isDefault"`); F7 `raw_commerce` için `orders_orderNo_seq` / `"providerPaymentId"` kullanılacak (BACKEND-PLANI §2 notu güncellendi).
- `pnpm db:migrate -- --name x` yazımı prisma'yı interaktif soruya düşürür; doğru: `pnpm db:migrate --create-only --name <ad>` (CLAUDE.md'de).
- Kargo KDV oranı planda yok (vatTotal yalnız satır KDV'si) → fatura için F8 öncesi karar.
- `MediaFile.path` unique değil; F4 media:import aynı path-upsert kuralını kullanmalı (ileride additive `@@unique([path])`).
- Prisma 7 `package.json#prisma.seed` alanını kaldıracak → ileride `prisma.config.ts` (kapsam dışı).
