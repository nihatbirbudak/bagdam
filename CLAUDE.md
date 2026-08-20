# CLAUDE.md — Bağdam

Bağdam (bagdam.com): Urla'dan sofraya seçki kutusu aboneliği + tekil ürün + toptan. Statik prototip (`website/`) → NestJS + Prisma + PostgreSQL backend + React admin'e dönüşüyor.

## Önce oku (her görevde)
1. [docs/YOL-HARITASI.md](docs/YOL-HARITASI.md) — hangi fazdayız, sıradaki iş, "bitti sayılır" ölçütleri
2. [docs/adr/](docs/adr/) — 20 karar (özellikle ADR-0002 mimari, ADR-0003 frontend, ADR-0016 kapsam kilidi)
3. [docs/BACKEND-PLANI.md](docs/BACKEND-PLANI.md) — gerekçeler, Prisma şeması, API yüzeyi, admin ekranları
4. [docs/state-machines.md](docs/state-machines.md) — Order/Subscription/Cycle/Payment/Cancellation geçişleri

## Mimari (ADR-0002) — kısa
- **Mantık Service'te, veri tablolarda, istemciler ince, her şey `/api/v1`'den.**
- `apps/api/src/modules/<özellik>/` = dto · controller (+ admin.controller) · service · repository (Prisma yalnız burada) · mapper
- `apps/api/src/common/` çapraz kesen; `apps/api/src/web/` .hbs sayfalarını aynı servislerle render eder
- `packages/shared/` enum'lar, DTO tipleri, durum makineleri, pricing — api/admin/(ileride mobil) ortak
- `database/` Prisma şeması + migration'lar

## Yapı
```
apps/api      NestJS 11 (:4010 dev, :5010 prod) — views/*.hbs (mevcut tasarım byte-byte), public/ (styles.css, assets/)
apps/admin    Vite + React 19 + Tailwind 4 (:4011 dev)
packages/shared
database/     schema.prisma, migrations/, seeds/
deploy/       nginx, scripts, runbook (sunucuya uygulanacak dosyalar)
website/      ORİJİNAL statik prototip — parite referansı (tools/visual-parity); dokunma
docs/         plan, ADR, yol haritası, araştırma; sunucu-baglanti.md gitignore'lu
```

## Kurallar
- Dil: kod/tanımlayıcı İngilizce; commit, yorum, doküman **Türkçe**.
- Paket yöneticisi **pnpm** (workspace). `pnpm dev:api`, `pnpm dev:admin`, `pnpm build`, `pnpm type-check`, `pnpm test`.
- DB: lokal PostgreSQL (`bagdam_dev`, rol `bagdam`; kök `.env` + `apps/api/.env` gitignore'lu). Komutlar: `pnpm db:validate | db:generate | db:migrate --create-only --name <ad> | db:migrate | db:status | db:seed | db:reset` (**`--` koyma**, pnpm 9 literal geçirir). `prisma migrate dev` yalnız lokal; **`prisma db push` yasak**; prod/staging'e yalnız `migrate deploy` (deploy.sh). Tek DB kuralı YOK (ADR-0011).
- Tasarım: `views/*.hbs` ve `public/styles.css` piksel piksel korunur; yalnız ADR-0003'teki 7 istisna. Handlebars `{{` çakışmasına dikkat.
- Zaman: tüm an alanları `@db.Timestamptz(3)`; ham SQL'de `now()` yasak; TZ Europe/Istanbul (ADR-0004).
- Sır yok: `.env` yalnız sunucuda; repo public; sunucu IP/port yazma (gitignore'lu `docs/sunucu-baglanti.md`).
- Kapsam: ADR-0016 P2 listesi lansmana kadar kapalı; açık ürün kararı kuyruğu ≤3.
- Yeni mimari karar → yeni ADR (≤25 satır); eski ADR düzenlenmez, "Yerini aldı" işaretlenir. Faz bitince YOL-HARITASI kutuları + `docs/SISTEM-DURUMU.md`.
- Commit/push yalnız kullanıcı isteyince.
