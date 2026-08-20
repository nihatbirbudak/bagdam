# ADR-0011: Ortamlar: lokal PG14 + migrate dev; staging; prod'a yalnız migrate deploy (tek DB kuralına uyulmaz)

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** uyanisakademi'nin "tek DB" kuralında 163 test siparişi prod'a sızdı; migrate dev reset riski; KVKK.
- **Karar:** Lokal PG 14 (`bagdam_dev`, `bagdam_test`; PG 18 varsa paralel 14 instance, yoksa CI `postgres:14` kapısı zorunlu). `prisma migrate dev` yalnız lokal; `db push` yasak; staging → prod sırasıyla `migrate deploy`. Aynı sunucuda hafif staging (`/opt/bagdam-staging`, `bagdam_staging`, :5011, `staging.bagdam.com` + `admin-staging.bagdam.com`, basic auth; callback/webhook/pay `auth_basic off`; `ENABLE_CRON=false`). Prod'a yalnız `bagdam_ro` salt-okunur tüneli (bağlantı ayrıntısı `docs/sunucu-baglanti.md`). Jest prod guard. Branch'ler: `main` (prod), `staging`.
