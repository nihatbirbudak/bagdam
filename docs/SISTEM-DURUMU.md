# Bağdam — Sistem Durumu

> Canlı/lokal sistemin anlık durumu. Her faz sonunda güncellenir. Son güncelleme: 2026-08-20

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| F0 Karar sprinti | ✅ | 16 ADR (docs/adr), state-machines.md; kullanıcı aksiyonları (iyzico/e-posta sağlayıcısı/ETBİS) bekliyor |
| F1 Walking skeleton | ✅ (lokal) | Monorepo + apps/api + apps/admin + packages/shared + deploy/ dosyaları. Sunucu kurulumu ADR-0017 ile F10b'ye taşındı |
| F2–F11 | ⬜ | — |

## Lokal ortam (doğrulandı 2026-08-20)

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

ADR-0017: sunucu kurulumu ve yayın **F10b**'de (lansmandan hemen önce). `deploy/README.md` runbook'u hazır. Portlar 5010 (prod) / 5011 (staging) ayrılmış durumda.

## Bilinen açık notlar (F1 ajan raporlarından, sonraki fazlarda ele alınacak)

- PM2 cluster modunda `interpreter` yok sayılabilir → sunucuda `pm2 show bagdam-api` ile Node sürümü doğrulanacak; gerekirse fork modu (ecosystem `BAGDAM_EXEC_MODE=fork`).
- `styles.css` / `cart.js` için nginx'te 1 yıl immutable cache → F3'te `?v=` sürüm parametresi gelene kadar bu iki dosyaya kısa cache.
- Admin API sözleşmesi varsayımları (`/auth/csrf`, `/auth/login`, `/auth/me`, `/auth/logout`) F4'te teyit edilecek.
- dunning `retryHours [24,72]` teslimat gününü aşabilir → F7 spike'ında pencere daraltılacak (state-machines.md §14).
- Off-site yedek için sunucuda rclone/age yok → kurulum `deploy/README.md` §10.
