# ADR-0001: Yığın: TypeScript · NestJS 11 · Prisma 6 · PostgreSQL 14 · PM2 tek süreç

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** Ortak birbudak sunucusunda Node 20/PM2/PostgreSQL 14/nginx/Cloudflare kurulu ve uyanisakademi bu yığınla canlı; PHP/Redis/Docker yok. Bahçeden Al'ın Laravel yığını sunucuda çalışamaz. (Bağlantı bilgileri gitignore'lu `docs/sunucu-baglanti.md`.)
- **Karar:** Her şey TypeScript. API = NestJS 11 + Prisma 6 + PostgreSQL 14 (`bagdam_db`, rol `bagdam`, `connection_limit=5`). Tek PM2 süreci `bagdam-api` :5010 (`exec_mode cluster, instances 1`), staging :5011. Admin = Vite 6 + React 19 + Tailwind 4 SPA (`admin.bagdam.com`). Paket yöneticisi pnpm 9.15 + turbo, tek public monorepo. Runtime hedefi **Node 22 LTS**, proje bazlı kurulum + PM2 `interpreter` (global Node 20 diğer projeler için değişmez).
- **Sonuçlar:** uyanisakademi modülleri (auth, settings, media, mail, throttling, health, admin iskeleti, deploy.sh, ecosystem) kopyalanır; Redis/kuyruk yok (in-process cache + cron + `FOR UPDATE SKIP LOCKED`); para `Decimal(12,2)` KDV dahil, `vatRate` varsayılan 1.
