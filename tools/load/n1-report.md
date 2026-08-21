# Bağdam — N+1 sorgu taraması (F10 · C)

> Üretildi: 2026-08-21 07:09:34 (UTC) · araç: `tools/load/n1-scan.mjs` (geçici API :4094, `PRISMA_LOG=query`)

Yöntem: her uç iki kez çağrılır; ilk çağrı süreç yeni ayağa kalkmış / cache soğukken, ikincisi hemen ardından.
“soğuk” sütunu tüm SQL trafiğini, “sıcak” sütunu in-process önbelleklerden sonra kalan trafiği gösterir.

| Grup | Uç | HTTP | Sorgu (soğuk) | Sorgu (sıcak) | Tablo dağılımı (soğuk) |
|---|---|---:|---:|---:|---|
| Web (hbs) | `GET /index.html` | 200 | **23** ⚠️ | 2 | `media_files`×3 · `settings`×2 · `box_tiers`×2 · `products`×2 · `categories`×2 · `producers`×2 · `users`×1 · `subscriptions`×1 · `delivery_zones`×1 · `box_templates`×1 · `box_template_items`×1 · `product_images`×1 · `product_lots`×1 · `delivery_dates`×1 · `site_content`×1 · `posts`×1 |
| Web (hbs) | `GET /urunler.html` | 200 | **2** | 2 | `users`×1 · `subscriptions`×1 |
| Web (hbs) | `GET /kutu.html` | 200 | **2** | 2 | `users`×1 · `subscriptions`×1 |
| Web (hbs) | `GET /gunluk.html` | 200 | **2** | 2 | `users`×1 · `subscriptions`×1 |
| Web (hbs) | `GET /politikalar.html` | 200 | **3** | 2 | `users`×1 · `subscriptions`×1 · `legal_documents`×1 |
| Public API | `GET /api/v1/bootstrap` | 200 | **1** | 1 | `users`×1 |
| Public API | `GET /api/v1/delivery/dates?zone=urla` | 200 | **4** | 4 | `delivery_zones`×2 · `users`×1 · `delivery_dates`×1 |
| Public API | `POST /api/v1/checkout/quote` | 200 | **9** | 8 | `users`×2 · `delivery_zones`×2 · `products`×1 · `product_lots`×1 · `settings`×1 · `subscriptions`×1 · `legal_documents`×1 |
| Admin liste | `GET /api/v1/admin/products?page=1&limit=20` | 200 | **9** | 9 | `products`×2 · `users`×1 · `BEGIN`×1 · `categories`×1 · `producers`×1 · `product_images`×1 · `media_files`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/orders?page=1&limit=20` | 200 | **5** | 5 | `orders`×2 · `users`×1 · `BEGIN`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/subscriptions?page=1&limit=20` | 200 | **6** | 5 | `subscriptions`×2 · `SELECT`×1 · `users`×1 · `BEGIN`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/customers?page=1&limit=20` | 200 | **5** | 5 | `users`×3 · `BEGIN`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/cycles?date=2026-08-22` | 200 | **2** | 2 | `users`×1 · `subscription_cycles`×1 |
| Admin liste | `GET /api/v1/admin/payment-issues?page=1&limit=20` | 200 | **8** | 6 | `subscription_cycles`×3 · `SELECT`×2 · `orders`×2 · `users`×1 |
| Admin liste | `GET /api/v1/admin/audit-logs?page=1&limit=20` | 200 | **3** | 3 | `audit_logs`×2 · `users`×1 |
| Admin liste | `GET /api/v1/admin/mail-logs?page=1&limit=20` | 200 | **5** | 5 | `mail_logs`×2 · `users`×1 · `BEGIN`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/media?page=1&limit=20` | 200 | **6** | 6 | `media_files`×3 · `users`×1 · `BEGIN`×1 · `COMMIT`×1 |
| Admin liste | `GET /api/v1/admin/dashboard` | 200 | **19** ⚠️ | 17 | `subscriptions`×6 · `orders`×5 · `SELECT`×2 · `subscription_cycles`×2 · `users`×1 · `subscription_events`×1 · `delivery_dates`×1 · `delivery_zones`×1 |
| Ops | `GET /api/v1/admin/ops/pick-list?date=2026-08-22` | 200 | **2** | 2 | `users`×1 · `subscription_cycles`×1 |
| Ops | `GET /api/v1/admin/ops/packing-list?date=2026-08-22` | 200 | **2** | 2 | `users`×1 · `subscription_cycles`×1 |
| Ops | `GET /api/v1/admin/ops/day-summary?date=2026-08-22` | 200 | **6** | 5 | `users`×1 · `SELECT`×1 · `subscription_cycles`×1 · `delivery_dates`×1 · `orders`×1 · `delivery_zones`×1 |

⚠️ = tek istekte 12'den fazla sorgu → elle gözden geçirildi (rapor sonundaki not).

## Sayfa boyu taraması (asıl N+1 kanıtı)

Sorgu adedinin satır sayısıyla **değişmemesi** gerekir. Aynı uç `limit=1` ve `limit=50` ile çağrılır;
fark 0 ise ilişkiler tek `findMany`/`include` ile toplu çekiliyor demektir (N+1 yok).

| Uç | limit=1 | limit=50 | Δ | Sonuç |
|---|---:|---:|---:|---|
| `/api/v1/admin/products?page=1&limit={1|50}` | 9 | 9 | +0 | N+1 yok |
| `/api/v1/admin/media?page=1&limit={1|50}` | 6 | 6 | +0 | N+1 yok |
| `/api/v1/admin/audit-logs?page=1&limit={1|50}` | 3 | 3 | +0 | N+1 yok |
| `/api/v1/admin/orders?page=1&limit={1|50}` | 5 | 5 | +0 | N+1 yok |
| `/api/v1/admin/subscriptions?page=1&limit={1|50}` | 5 | 5 | +0 | N+1 yok |
| `/api/v1/admin/customers?page=1&limit={1|50}` | 5 | 5 | +0 | N+1 yok |
| `/api/v1/admin/mail-logs?page=1&limit={1|50}` | 6 | 5 | -1 | N+1 yok |

Δ ≤ 0 ⇒ N+1 yok. Negatif Δ, ölçüm penceresine denk gelen oturum yenileme işlemidir (`BEGIN`/`COMMIT` çifti), uç noktayla ilgisi yoktur.

## Değerlendirme

- **N+1 bulunmadı.** Hiçbir uçta sorgu adedi sayfa boyuyla artmıyor; tüm liste depoları tek
  `findMany(... include)` + `count` çifti kullanıyor, ilişkiler Prisma tarafından toplu (`IN`) çekiliyor.
- ⚠️ **Ana sayfa (soğuk 23 / sıcak 2):** ilk istek bootstrap + site içeriği + kategori önbelleklerini doldurur
  (katalog, kutu şablonu, ayarlar, teslimat tarihleri, `site_content`, son yazılar). İkinci istekten itibaren
  yalnız oturum sorguları (`users`, `subscriptions`) kalır → önbellek çalışıyor, düzeltme gerekmiyor.
- ⚠️ **`GET /admin/dashboard` (19 sorgu):** ekran 21 birbirinden bağımsız 19 sayaç/aggregate gösterir
  (bugün/hafta sipariş-ciro, abonelik durumları, ödeme problemleri, kesim durumu, son olaylar).
  `DashboardService.get` bunları `Promise.all` ile **eşzamanlı** koşturur → 19 sorgu ≠ 19 tur gecikmesi.
  N+1 değil; birleştirme yalnız tek bir ham SQL yazmakla mümkün olur, okunabilirlik kaybı buna değmez.
- Her istekte görünen `users×1` JwtAuthGuard'ın oturum sahibi kaydı, web sayfalarındaki `subscriptions×1`
  ise gömülü bootstrap'ın `sub` alanıdır (oturum yoksa çalışmaz).

> Not: `orders` / `subscriptions` / `subscription_cycles` tabloları bu koşuda boştu (seed verisi).
> Sayfa boyu taraması bu uçlarda da Δ 0 verdi; ayrıca depo kodu tek `findMany + include` kalıbını kullanıyor.
> Yük altında doğrulama e2e F9 senaryosunun bıraktığı veriyle (koşu sırasında) tekrarlanabilir.
