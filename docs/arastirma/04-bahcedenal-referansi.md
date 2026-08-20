> **Bahçeden Al referansı (kalıplar ve dersler)** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 1 — ajan B). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Bahçeden Al → Bağdam: Referans Proje Analizi (kalıplar + dersler)

Kaynak kök: `<Projeler>/www.bahcedenal.com.tr`
Okunanlar: CLAUDE.md, PROJECT_MEMORY.md (tam), DECISIONS.md (ADR-0001..0005, 0007, 0008, 0010..0013, 0016, 0019..0022, 0025, 0027 başı, 0028..0032, 0034 başı, 0035, 0036), 186 migration adı + ~45 çekirdek migration alan düzeyinde, routes/*.php, app/Models, app/Enums, app/Services (OrderService/CartService/ChannelEtaService/DeliveryZoneService/SlotGenerator), config/menu.php, resources/views ağacı, deploy/coming-soon/*, scraped-data/*, HYPERLOCAL_ANALYSIS_FINAL.md, SPRINT_NOTES.md, STAGING_DEFERRED.md, PERFORMANCE_SPRINT_PLAN.md (prod deploy bölümü), EXPRESS/MULTI_WAREHOUSE plan başlıkları, customer-web seçili dosyalar, _archive/legacy/docs başları.

---

## 1. Proje özeti

| Konu | Durum (dokümanlardan) |
|---|---|
| Ne | "Bahçeden Al" — üreticiden taze ürün, **dual-channel** (Cargo Türkiye geneli + Express Urla polygon, slot bazlı) grocery platformu. Şirket: Birbudak Grup Danışmanlık (aynı aile şirketi; üretim adresi Kuşçular/Urla — `scraped-data/site-info.json`). |
| Yığın | **Hyperlocal v1.3.0** ($49 CodeCanyon, infinitietech) fork'u: `backend/` Laravel 12 + Sanctum + Spatie media/permission + Tabler.io Blade admin; `customer-web/` Next.js 16.2 + React 19 + Redux Toolkit + HeroUI + i18next + SWR + Leaflet + next-pwa + Firebase; `customer-app/ rider-app/ seller-app/` Flutter 3.41. DB: PostgreSQL (Hyperlocal MySQL → PG'ye 7 patch ile çevrildi, ADR-0003). |
| Ölçek | 186 migration (168 Hyperlocal + 18 custom), ~870 PHP dosya (app+routes+database), 192 blade, 298 TS/TSX, 516+298+377 Dart, 712 route, `lang/tr/labels.php` 2127 anahtar. Gerçek katalog: **85 ürün, 28→59 kategori, 3 marka**. |
| Süreç | 36 ADR (`DECISIONS.md` 250 KB, append-only MADR). ADR-0001 2026-05-06 → ADR-0035 2026-05-10 (son **kod** kararı) → ADR-0036 2026-07-23 (yalnız domain/ops). Yani ~5 günde 35 ADR, sonra 2,5 ay sessizlik, ardından sadece cutover. `customer-web/` klasör mtime 14 Ağustos — içerik değişikliği DOĞRULANMADI. |
| Nerede kaldı | Yerelde çalışan: backend + customer-web (SSR), 85 ürün import, Cargo+Urla Express 2 seller/2 store, TR lokasyon tabloları, slot altyapısı, Redis cache (yerel), KVKK banner, Getir-pattern anasayfa. **Production'a hiç çıkmadı**: sunucuda PHP/Composer/Redis yok (PROJECT_MEMORY "Production-ready değiliz"). Mobile 3 app'e hiç dokunulmadı (Mobile TODO listeleri ADR'larda birikiyor). 2026-07-24'ten beri `bahcedenal.com.tr` **coming-soon** (anasayfa 200, derin URL 302→/) — SEO kaybı işliyor. |
| Neden tamamlanmadı (dokümanlardan çıkarım) | (a) Kapsam: 5 codebase, multi-vendor/multi-warehouse/slot/carrier/Iyzico/e-Arşiv/3 mobil app için 97-145 kişi-gün plan (HYPERLOCAL_ANALYSIS_FINAL) — 85 ürünlük site için. (b) Yığın-sunucu uyumsuzluğu: PHP yığını seçildi, sunucuda yok; "2 günlük" deploy adımı hiç yapılmadı. (c) Dev-mode perf tüneli (ADR-0030/31/32): production yokken Redis/N+1/SSR optimizasyonuna günler harcandı, ölçümler "php artisan serve boot 385ms" dominant çıktı. (d) Karar bekleyen onlarca madde (SPRINT_NOTES: 🟡 "kullanıcı kararı", 🔴 backend bağımlılığı) + plan-dışı UI eklemelerin geri alınması + 3 paralel audit'in yanlış CRITICAL'leri → kullanıcı direktifi "mimari karar verme, uygula" (ADR-0022). (e) Dış bağımlılıklar: Google Geocoding REQUEST_DENIED, Ticimax panel kapanması/mail/domain krizi (ADR-0036). (f) Anasayfa 5 kez pattern değiştirdi (ADR-0015/0018/0023/0024/0026: Migros→Getir→Yemeksepeti) — lansman öncesi pattern kovalama. |

---

## 2. Veri modeli özeti (alan düzeyi) ve Bağdam kararı

Legend: ✅ Bağdam'a gerekli (sadeleşerek) · 🟡 opsiyonel/koşullu · ❌ gereksiz.

### 2.1 Katalog

| Tablo | Alanlar (migration'lardan) | Bağdam |
|---|---|---|
| `products` | id, uuid, **seller_id**, category_id, brand_id?, product_condition_id, provider/provider_product_id, slug(500) unique, title, product_identity, type (`simple\|variant\|digital` — PG CHECK constraint patch'lendi), short_description, description, indicator(veg/non_veg), download_*, **minimum_order_quantity, quantity_step_size, total_allowed_quantity**, is_inclusive_tax, is_returnable+returnable_days, is_cancelable+cancelable_till, is_attachment_required+attachment_mode, status(active/draft), featured, video_type/link, cloned_from_id, tags(text), custom_fields(json), warranty/guarantee_period, made_in, metadata(json), hsn_code, verification_status+rejection_reason, base_prep_time, requires_otp, image_fit(cover/contain), softDeletes. Görsel kolonu yok → Spatie `media`. | ✅ slug/title/description/status/featured/softDeletes/image_fit; ✅ **minimum_order_quantity + quantity_step_size** (toptan için birebir); 🟡 tags/metadata; ❌ seller_id, provider*, digital/download, indicator, otp, attachment, verification, hsn, base_prep_time, total_allowed_quantity (ADR-0028: 1 default'u sepeti kilitledi — ders). |
| `product_variants` | uuid, product_id, title, slug unique, weight/height/breadth/length, availability, provider*, barcode, visibility, is_default, softDeletes | ✅ gramaj/ambalaj varyantı gerekiyorsa (500g/1kg, kasa); ❌ provider_json. |
| `store_product_variants` | product_variant_id, **store_id**, sku, price, special_price, cost, stock | ✅ alanlar (sku/price/special_price/cost/stock) ama **store boyutu olmadan** doğrudan varyanta. Toptan için ayrı `price_tiers` (min_qty→unit_price) veya `wholesale_price` alanı Bağdam'a özgü — Hyperlocal'da yok. |
| `categories` | uuid, parent_id, title, slug, description, status, requires_approval, metadata, softDeletes; sonradan commission, background_*, font_color, sort_order, home_category | ✅ parent_id (1 seviye), title, slug, sort_order, status, görsel; ❌ commission, requires_approval. |
| `brands` | uuid, slug, title, description, status, metadata (image→media) | ❌ (tek marka). 🟡 "üretici/çiftçi" kartı istenirse ufak `producers` tablosu — Hyperlocal'da da yoktu (Seller genişletme planıydı, yapılmadı). |
| `reviews` | user_id, product_id, rating, slug, comment | 🟡 V1.5. |
| `tax_classes/tax_rates/product_taxes` | title/rate pivot | ❌ → üründe `vat_rate` (1/10/20) yeterli. |
| addon_groups/items, global_product_attributes, custom_product_sections/fields, product_faqs, collections, product_conditions | — | ❌ |

### 2.2 Satıcı/mağaza/lojistik (Hyperlocal'ın çekirdeği, Bağdam için büyük ölçüde gürültü)

| Tablo | Not | Bağdam |
|---|---|---|
| `sellers` (user_id, adres, 4 KYC belge, verification/visibility_status, `is_bahcedenal`) + `seller_user` pivot | Multi-tenant + impersonation (ADR-0035) | ❌ |
| `stores` (seller_id, delivery_zone_id, adres/koordinat, iletişim, banka alanları(!), currency_code, max_delivery_distance, order_preparation_time, politikalar, `fulfillment_type` hyperlocal/regular/both, status online/offline) | ADR-0022 notu: `StoreResource` banka PII leak — Hyperlocal bug'ı | ❌ (tek depo). Sadece "mağaza bilgisi" = settings JSON. |
| `delivery_zones` (name, slug, center_lat/lng, radius_km, **boundary_json** polygon, status) + `store_zone`, `user_zone` | Ray-cast `DeliveryZoneService::isPointInPolygon`; Urla polygon seed var | 🟡 Bağdam Urla yerel teslimat yapacaksa **tek zone** (mahalle listesi veya polygon); kargo için gereksiz. |
| `delivery_slot_templates` (store_id, day_of_week, start/end, max_orders) + `delivery_time_slots` (+template_id, current_orders) | ADR-0027; `slots:generate` 00:30 cron, 14 gün horizon; atomik rezervasyon | 🟡 Abonelik kutusu "teslimat günü kapasitesi" için **kalıp** değerli (bkz. §4). |
| delivery_boys + 10 tablo, shipping_parcels(*kullanılmıyor*), seller_orders/items, commissions, seller_statements, withdrawals, wallets, gift_cards, referrals, support_tickets, subscription_plans/seller_subscriptions (**satıcı SaaS planı — müşteri kutu aboneliği DEĞİL**), system_updates, impersonations, countries, app_notifications, user_fcm_tokens | — | ❌ tamamı |

### 2.3 Sepet / sipariş / ödeme / kupon

| Tablo | Alanlar | Bağdam |
|---|---|---|
| `carts` (uuid, user_id) + `cart_items` (cart_id, product_id, product_variant_id, **store_id**, quantity, save_for_later, addon_signature) | Sunucu sepeti; guest için frontend `offlineCart` (redux-persist) | ✅ sadeleşmiş (store_id yok); guest sepeti cookie/local + login'de `POST /cart/sync` kalıbı. |
| `orders` | uuid, user_id, slug unique, email, ip_address, currency_code/rate, payment_method, payment_status, fulfillment_type, is_rush_order, estimated_delivery_time, delivery_time_slot_id, delivery_boy_id, delivery_zone_id, wallet_balance, promo_code+promo_discount, gift_card+discount, delivery_charge, handling_charges, per_store_drop_off_fee, subtotal, total_payable, final_total, status, **billing_\* ×14 ve shipping_\* ×14 snapshot** (name, address_1/2, landmark, zip, phone, address_type, lat/lng, city, state, country, country_code), order_note | ✅ uuid/slug/ip/email, payment_method/status, promo_code+discount, delivery_charge, subtotal/total, status, **adres snapshot (tek set yeterli: shipping_*)**, order_note; ✅ `order_type` (tekil / kutu-teslimatı / toptan) Bağdam eki; ❌ currency_rate, wallet, gift card, rush, delivery_boy/zone/slot (🟡 slot sadece yerel teslimat varsa). |
| `order_items` | order_id, product_id, product_variant_id, store_id, **title, variant_title, sku, price, quantity, subtotal** (snapshot), discount/discounted_price, tax_amount/tax_percent, admin/seller_commission, commission_settled, status, otp*, promo_discount, cancelable snapshot | ✅ snapshot alanları + tax_percent + status; ❌ komisyon, otp, store_id. |
| `order_payment_transactions` | uuid, order_id?, user_id, transaction_id, amount, currency, payment_method, payment_status (pending/completed/failed/refunded/partially_refunded), message, payment_details json | ✅ birebir (Iyzico/PayTR için ideal; webhook idempotency transaction_id unique ile). |
| `promo` | code unique, description, start/end, discount_type (free_shipping/flat/percent), discount_amount, promo_mode (instant/cashback), usage_count, individual_use, max_total_usage, max_usage_per_user, min_order_total, max_discount_value, softDelete + `order_promo_line` | ✅ cashback hariç. |
| Enum'lar | `OrderStatusEnum`: pending, awaiting_store_response, partially_accepted, rejected_by_seller, accepted_by_seller, ready_for_pickup, assigned, preparing, collected, out_for_delivery, delivered, cancelled, failed. `OrderItemStatusEnum`: + returned/refunded. `PaymentStatusEnum`: pending/completed/failed/refunded/partially_refunded. `PaymentTypeEnum`: cod, wallet, razorpay, stripe, paystack, flutterwave. | Bağdam: `pending → confirmed → preparing → shipped/out_for_delivery → delivered` + `cancelled/refunded` yeter; payment: `iyzico`, `bank_transfer`(toptan), `cod`? |

### 2.4 Kullanıcı / adres / lokasyon / ayar / medya

| Tablo | Alanlar | Bağdam |
|---|---|---|
| `users` | name, email (nullable), mobile (nullable unique), password (nullable), firebase_uid, email_verified_at, mobile_verified_at, logged_in_type (google/apple/platform), referral_code, friends_code, reward_points, status (active/inactive — model cast `boolean` bug'ı ADR-0035), **access_panel** (web/admin/seller), country_code; Spatie roles | ✅ name/email/phone/password/verified_at/status + `role` (admin/customer/wholesale); ❌ referral, reward, firebase, access_panel. |
| `addresses` (Hyperlocal + ADR-0011/13/21 ekleri) | user_id (nullable → guest), **is_default, label(50), neighborhood_id FK, google_place_id**, **province_id, district_id**, address_line1/2, **street_name, building_name, block, floor, apartment_no**, city, landmark, state, zipcode (nullable), mobile, address_type (home/office/other), country, country_code, lat/lng, softDeletes. Partial unique: `(user_id) WHERE is_default AND deleted_at IS NULL` (raw SQL, Laravel API desteklemiyor). `AddressObserver`: tek default + FK zincirinden city/state türet. | ✅ **örnek alınacak en iyi şema**: province/district/neighborhood FK + label + is_default + granular alanlar + softDelete. ❌ google_place_id (harita yoksa), landmark. |
| `provinces` (external_id, code plaka, name, slug) / `districts` (province_id, external_id, name, slug; unique(province_id,slug)) / `neighborhoods` (district_id, external_id, name, slug, postal_code?, center_lat/lng?) | 81 / 973 / 74.399; seeder `TrLocationSeeder` chunk=1000, slug `Str::slug($name,'-','tr')`, "MAHALLESİ" suffix strip, Title Case. Kaynak JSON'da posta kodu/koordinat **yok** (center_lat/lng NULL) | ✅ **veri + seeder mantığı kopyalanır** (bkz. §7). Bağdam yalnız Urla'ya yerel teslimat yapıyorsa bile Türkiye geneli kargo için tam set gerekli. |
| `neighborhood_corrections` | self-learning mahalle düzeltme logu (ADR-0021) | ❌ |
| `settings` | `variable` (PK string) + `value` (text JSON). Variables: system, web, app, payment, email, notification, storage, authentication, **cargo** (`{eta_min_days:1, eta_max_days:3}`), ... `web` JSON anahtarları: siteName, supportNumber, supportEmail, address, defaultLatitude/Longitude, allowedCountries, social links, headerScript/footerScript, metaDescription/Keywords, privacyPolicy/termsCondition/returnRefundPolicy/shippingPolicy/**kvkkPolicy/withdrawalRight** (rich-text), PWA alanları, feature section metinleri | ✅ **aynı key-value JSON kalıbı** (Prisma `Json` kolon). |
| `media` | Spatie medialibrary standart (morph, collection_name, disk, conversions, responsive_images) | 🟡 Basit `images` tablosu (owner_type/owner_id, path, alt, sort) + Sharp ile webp/boyut üretimi yeterli. |

---

## 3. Admin panel yapısı ve Bağdam karşılığı

Hyperlocal admin: Blade + Tabler.io, menü `backend/config/menu.php` (`admin`, `seller`, `delivery-partner` panelleri; `labels.*` i18n), görünümler `resources/views/admin/*`.

| Hyperlocal admin menüsü (config/menu.php) | Bağdam minimal karşılığı |
|---|---|
| Dashboard | ✅ Dashboard: bugünkü siparişler, aktif abonelik sayısı, bu haftanın kutu teslimatları, düşük stok |
| Orders (index/show) | ✅ Siparişler: liste+filtre (durum/tip/tarih), detay, durum değiştir, not, kargo takip no alanı |
| Categories (main/sub/all/sort/bulk-upload) | ✅ Kategoriler (tek ekran, sürükle-sırala) |
| Brands | ❌ |
| Customers (+ wallet transactions, deposits, referrals, earnings) | ✅ Müşteriler (liste, adresler, siparişler, **abonelik durumu**, toptan hesabı işareti); ❌ wallet/referral |
| Subscriptions (plans, subscribers) — **satıcı SaaS** | ✅ ama **farklı anlam**: Kutu planları (haftalık/2 haftalık/aylık, boy), Abonelikler (aktif/duraklatılmış/iptal, sonraki teslimat), Teslimat dönemi planı (bu haftanın kutu içeriği) — Bağdam'a özgü, sıfırdan |
| Seller management (sellers, add, earning settlement, withdrawals) | ❌ |
| Stores | ❌ (tek depo → Ayarlar) |
| Products (products, pending approval, product FAQs) | ✅ Ürünler: liste/tablo, form (varyant, fiyat, **toptan fiyat/min adet**, stok, görseller, KDV), öne çıkan |
| Tax rates | ❌ (ürün alanı) |
| Delivery boy management (7 alt) | ❌ |
| Banners (hero/quick cards/carousel/all) | 🟡 Tek "Anasayfa içerik" ekranı (hero görsel+metin, 2-4 kart) — settings JSON ile |
| Featured sections (+sort) | 🟡 "Vitrin" = featured flag + sıralama |
| Promos | ✅ Kuponlar (flat/percent/free_shipping, min tutar, kullanım limiti, tarih) |
| FAQs | 🟡 settings JSON |
| Delivery zones | 🟡 Urla yerel teslimat varsa: mahalle listesi/polygon + teslimat günleri + ücret; kargo: bölge yok, kargo ücreti/ücretsiz eşiği settings |
| App notifications / Notifications | ❌ (e-posta şablonu yeter) |
| Roles & permissions, System users | 🟡 2 rol (admin/editor) sabit |
| Settings (system/web/app/system-update/home-general/storage/authentication/email/payment/notification/delivery-boy/seller — 13 blade) | ✅ Ayarlar: Genel (site, iletişim, adres, sosyal), Yasal metinler (KVKK, mesafeli satış, ön bilgilendirme, cayma, üyelik — rich text), Kargo (ETA gün, ücret, ücretsiz eşik), Ödeme (Iyzico anahtarları sunucu .env'de; panelde sadece açık/kapalı), E-posta (SMTP), SEO (meta) |
| System updates | ❌ |
| Toptan | **Bağdam'a özgü**: toptan başvuruları (onay), toptan fiyat listesi, toptan siparişler (havale/EFT, fatura) |

Ders: Hyperlocal admin'in 30+ ekranının 2/3'ü Bağdam için ölü yük; "silme, gizle" politikası (ADR-0005) bakım yükünü ve saldırı yüzeyini taşıdı.

---

## 4. Yeniden kullanılabilir kalıplar

### 4.1 Sepet & sipariş akışı (backend)
- `OrderService::createOrder` adım sırası (tek DB transaction): (1) cart + sistem ayarı doğrula → (2) ödeme yöntemi → (3) adres + teslimat bölgesi → (4) stok + teslimat uygunluğu → (4.5) **kapasite atomik rezervasyonu** → (5) order oluştur → (6) item'lar + snapshot + ödeme transaction + finalize; başarısızlıkta `DB::rollBack()` (audit R2: önceden rollback yoktu → orphan order). Bu sıra Bağdam'ın NestJS servisinde `prisma.$transaction` ile aynen uygulanabilir.
- **Atomik kapasite** (`reserveDeliverySlotCapacity`): `UPDATE delivery_time_slots SET current_orders=current_orders+1 WHERE id=? AND store_id IN (...) AND current_orders < max_orders AND is_active AND start_time>now()`; etkilenen satır 0 ise "slot dolu". Release: `GREATEST(current_orders-1,0)`. → Bağdam'da **"haftalık kutu teslimat günü kapasitesi"** veya "Urla yerel teslimat günü" için birebir.
- Cart kuralları: `validateQuantityRules` (minimum_order_quantity, quantity_step_size) + `checkStock`; ders: gizli limitler (`total_allowed_quantity=1`, `maximumItemsAllowedInCart null→1`) kullanıcıyı kilitledi — Bağdam'da **limit = stok**, başka örtük limit yok.
- `POST /cart/sync` (guest → login sepet birleştirme), `reorder` endpoint'i, `POST /orders/items/{id}/cancel` item bazlı iptal → abonelikte "bu haftayı atla" ile aynı ruh.

### 4.2 Optimistic cart (frontend, ADR-0029)
Snapshot al → Redux'a anında yaz (geçici negatif id) → API → success: backend'in döndürdüğü **tam sepet** ile state'i değiştir / failure: snapshot'a dön + toast. **Tek round-trip** kuralı: add/update/remove endpoint'leri tam sepeti döndürür, ikinci `getCart` yok. Bağdam'da React Query `onMutate/onError/onSettled` ile aynı; API sözleşmesi "mutasyon tam sepet döner".

### 4.3 Kanal / adres kuralları
- **ADR-0019 state-machine + tek hook** (`useChannelContext`): tüm sayfalar manuel branch yazmaz, hook `apiParams` + `swrKeySegment` + `shouldShowEmptyState` döner. Bağdam'da "teslimat tipi" (kargo / Urla yerel) veya "müşteri tipi" (perakende/toptan fiyat görünümü) için aynı teknik.
- **ADR-0025 ID-based aktif adres**: cookie `{mode:saved|guest, id, label, lat/lng, province_id, district_id, neighborhood_id}`; proximity match yok; login'de default adres otomatik yüklenir; eski şema geriye uyumlu parse. Bağdam: aynı cookie şeması (lat/lng opsiyonel).
- **ADR-0027 ETA sözleşmesi**: backend `{type:'days'|'slot'|'instant', display_text, ...}` döner, UI sadece `display_text` okur → gelecekte kargo→yerel geçişte UI değişmez. Cargo ETA `settings.cargo {eta_min_days, eta_max_days}` admin'den.
- **Web product-first, checkout'ta adres** (ADR-0012): SEO için katalog guest'e açık; sepete ekleme/checkout login wall (ADR-0022: "guest browse, sepete ekleme login").
- Adres UX (ADR-0021): kullanıcı sadece kapı/blok/daire + tarif + telefon + tip girer; il/ilçe/mahalle read-only chip; manuel cascading dropdown (`TrLocationCascading`) fallback. Bağdam harita kullanmayacaksa: il→ilçe→mahalle cascading + sokak/bina/daire alanları yeterli.

### 4.4 SEO / redirect / domain cutover (ADR-0036, RUNBOOK)
- Coming-soon deseni: anasayfa **200** (Organization JSON-LD, canonical www), eski derin URL'ler **302→/** (301 değil — kalıcı 301 hakkı lansmana saklanır), `robots.txt Allow` (Disallow/noindex bilinçli yok — Google bunu kalıcı kaldırma sayar), HTTP→HTTPS 301, ACME webroot `/var/www/letsencrypt` 80 ve 443'te.
- Lansman: eski URL → yeni slug **doğrudan 301 map** (nginx `map`, zincir yok), ≥1 yıl tut, yeni sitemap GSC'ye, Change of Address kullanma (domain aynı). Kaynak envanter `seo-snapshot/` (131 URL) + `scraped-data/seo_redirects.csv` (old_url, canonical, title, description).
- Cloudflare: Free plan, web kayıtları Proxied, mail kayıtları DNS-only, SSL "Full" → LE sertifika sonrası "Full (strict)", Always Use HTTPS; CF taraması DKIM'i kaçırır → elle ekle. Bağdam DNS henüz yok → RUNBOOK §1-3,5 birebir şablon.
- Next.js `headers()` bloğu (HSTS preload, X-Frame SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy, CORP) + sitemap/robots Cache-Control; `scripts/generate-sitemap.mjs` (statik + API'den dinamik).

### 4.5 TR il/ilçe/mahalle veri seti
- **Konum**: `backend/database/data/tr-locations/` — `sehirler.json` (5 KB), `ilceler.json` (112 KB), `mahalleler-1..4.json` (4×~2,8 MB). Kaynak: kullanıcının elindeki `turkiye-adresler-json-main/` (seeder yorumu). Şekil: `{sehir_id, sehir_adi}`, `{ilce_id, ilce_adi, sehir_id, sehir_adi}`, `{mahalle_id, mahalle_adi, ilce_id, ilce_adi, sehir_id, sehir_adi}` (BÜYÜK HARF, "… MAHALLESİ"). Posta kodu ve koordinat **yok**.
- Seeder mantığı (`TrLocationSeeder.php`): external_id upsert, Title Case TR, "MAHALLESİ" strip, `Str::slug(...,'tr')`, chunk 1000, ~30 sn. Bağdam: Prisma seed'de aynı 3 tablo; slug için `slugify` + TR harita (ı→i, İ→i, ş→s…).

### 4.6 KVKK cookie banner + veri saklama
- İki bileşen var: `src/components/Cookie/CookieConsentBanner.tsx` (2-tier: "Sadece Zorunlu / Tümünü Kabul Et", i18n `cookie.*`) ve `src/components/Functional/CookieConsent.tsx` (3-buton Reddet/Yönet/Kabul Et + zorunlu/analitik/pazarlama detay; `localStorage` `cookie_consent_choice` + `cookie_consent_detail`; i18n `cookieConsent.*`; link `/privacy-policy`). TR metin: "Bahçeden Al deneyiminizi geliştirmek için çerez kullanıyoruz. Zorunlu çerezler (oturum, sepet, dil) … Opsiyonel çerezler (kayıtlı adresler, Google Maps) …" / "KVKK Aydınlatma Metni".
- `kvkk:purge` artisan komutu (günlük 03:00): soft-delete'li `addresses` ve `users` 30 gün sonra hard-delete, `--days` 1-365. Bağdam: NestJS cron aynısı.
- Yasal sayfalar `web_settings` rich-text'ten (`kvkkPolicy`, `withdrawalRight`, `termsCondition`, `privacyPolicy`…) SSR render; sayfalar `/kvkk`, `/cayma-hakki`, `/cerez-politikasi`, `/uyelik-sozlesmesi`, `/politikalar`. **Mevcut metinler**: `scraped-data/static_contents.json` (`body_html`): cayma-hakki 2.7k, kisisel-verilerin-korunmasi 7.3k, mesafeli-satis-sozlesmesi 8.9k, on-bilgilendirme 8.9k, uyelik-sozlesmesi 20k karakter — aynı şirket (Birbudak Grup); Bağdam'a marka/adres değişikliğiyle uyarlanabilir (hukuki güncelliği DOĞRULANMADI).

### 4.7 TR locale
- TR primary + EN fallback (ADR-0004/0009); formal "siz"; terim haritası "Vendor→Üretici, Marketplace→Pazaryeri, Hyperlocal→Hızlı Teslimat"; `Europe/Istanbul`, `tr_TR` faker; i18next `scan:i18n`. Bağdam: tek dil TR yeterli (EN'i ertele) — Bahçeden Al'da 2127+1432 anahtarı çevirmek başlı başına sprint oldu.

### 4.8 Görsel fallback
- ADR-0007/0008/0014: backend placeholder URL'si (`product-placeholder.jpg`) "boş" değildir → `||` fallback çalışmaz; **placeholder tespiti + slug-based yerel fallback** (`/images/products/${slug}/main.jpg`), kategori için keyword→görsel eşlemesi. `scripts/optimize-public-images.mjs` (Sharp, ~10 MB→1.5 MB, og-image 1200×630 crop). Bağdam: görselleri baştan `uploads/` + Sharp ile webp üret; fallback tek SVG placeholder.

### 4.9 Performans dersleri (ADR-0016/0030/0031/0032)
- Kök sebepler: static export modunda ölü `getServerSideProps`, SSR'de ardışık `await` (→ `Promise.all`), 26 farklı SWR politikası (→ global `SWRConfig`: revalidateOnFocus false, dedupe 60-120 s, 5xx retry), `/settings` 5 dk polling (→ 30 dk), redux-persist tüm root (→ whitelist), slice-bütünü selector (→ atomic), debounce her render'da reset (→ useRef), N+1 (per-row rating query → tek aggregate), `SELECT DISTINCT + json` PG hatası (withCount kullanılamadı), Firebase umbrella/lodash full import.
- Asıl ders (ADR-0032): **dev-mode'da perf tartışma**; production-like build'de ölç; staging'e ertelenen liste (`STAGING_DEFERRED.md`) kalıbı iyi. Redis katmanı yerelde kazanım vermedi (PHP boot dominant) — Bağdam'da Redis'e hiç girme; PG + Node in-process cache + Cloudflare.

### 4.10 Süreç kalıpları
- `CLAUDE.md` ADR tetikleyici protokolü + MADR şablonu + "Superseded" kuralı + PROJECT_MEMORY "Current State / Sıradaki / Don't-do": iyi, ama 250 KB'lık DECISIONS.md ve ADR başına 100+ satır "Consequences" sürdürülemez hale gelmiş. Bağdam: aynı protokol, ADR ≤ 25 satır, `docs/adr/NNNN-*.md` ayrı dosyalar.
- `SPRINT_NOTES.md` "kendiliğimden düzeltmiyorum, not alıyorum" — iyi niyetli ama 20+ 🟡 karar birikti ve iş durdu; Bağdam'da **karar kuyruğu max 3, her sprint başında kapatılır**.

---

## 5. Kaçınılacaklar / dersler → Bağdam'da önlem

| Ders (kanıt) | Bağdam önlemi |
|---|---|
| **Aşırı kapsam**: 85 ürün için multi-vendor/multi-warehouse/rider/wallet/referral/slot/carrier/3 mobil app; 186 tablo; HYPERLOCAL_ANALYSIS "109/150 uyum" bile 97-145 kişi-gün dedi. | Kapsam: tekil ürün + seçki kutusu aboneliği + toptan = **3 sipariş tipi, tek depo, ~15-20 tablo**. Mobil app yok (PWA). Çoklu satıcı/depo "sonra" değil "hiç". |
| **Şablon fork riskleri**: MySQL→PG 7 patch; PG enum CHECK; gizli iş kuralları (total_allowed_quantity=1, maxItemsInCart null→1); hardcoded `fulfillment_type`; kullanılmayan şema (shipping_parcels, Carrier yok); `StoreResource` banka PII sızıntısı; `users.status` cast bug; lisans/installer temizliği 32 dosya; güncelleme alınamıyor; "silme, gizle" kuralı. | Şablon/CodeCanyon **yok**. Kendi ince şema; her tablo bir ihtiyaca bağlı. Bilinmeyen kod tabanını temizlemek yerine küçük yazmak. |
| **Sunucu-yığın uyumsuzluğu**: sunucuda PHP/Redis yok; "2 günlük" kurulum hiç yapılmadı; backend hiç deploy olmadı; coming-soon 4 haftadır canlı ve SEO kanıyor. | Sunucuda zaten çalışan yığın (Node 20 + PM2 + PG14 + nginx + certbot) ve **uyanisakademi konvansiyonu** (pnpm monorepo, NestJS + Prisma, Vite admin, deploy.sh + GitHub Actions). **Walking skeleton ilk hafta canlıda** (api health + web iskelet + admin login), sonra özellik. |
| **Dev-mode perf tüneli**: ADR-0030/31/32 + 6 paralel audit + Redis; ölçümler "artisan serve 385 ms" tarafından yutuldu. | Perf işi ancak production'da ölçülen bir sorun varsa; önce ship. |
| **Audit/ajan gürültüsü**: 3 paralel audit'in 17 CRITICAL'inin çoğu yanlış; plan-dışı UI eklemeler geri alındı; kullanıcı "mimari karar verme, uygula" dedi (ADR-0022). | Mimari kararlar önce kısa ADR olarak yazılır, uygulama ADR'a karşı denetlenir; ajanlar sadece "kural nerede uygulanmadı" arar. Plan-dışı UI eklemesi yok. |
| **Karar birikimi**: SPRINT_NOTES'ta onlarca 🟡 "kullanıcı kararı bekleniyor" + 🔴 backend bağımlı; Google API key, carrier stratejisi, SSR verify aylarca açık. | Sprint 0'da kapanması zorunlu karar listesi (ödeme sağlayıcı, kargo firması/manuel, yerel teslimat var mı, abonelik döngüsü, toptan onay akışı, DNS/CF). Açık kalan karar = özellik dışarı. |
| **Pattern kovalama**: anasayfa Migros→Getir→Yemeksepeti 5 ADR; branding "final değil" hep ertelendi. | Tek referans, tek tasarım kararı; branding ilk 2 hafta içinde dondurulur. |
| **Dış bağımlılık**: Google Geocoding REQUEST_DENIED; Ticimax panel kapanması, mail Ticimax'ta, 7 gün veri silme penceresi. | Harita/Geocoding MVP'de yok (il/ilçe/mahalle dropdown yeter). Domain + mail baştan Cloudflare + bağımsız mail; repo public → sırlar sadece sunucu `.env`. |
| **Mobil borç**: her ADR'da "Mobile TODO" birikti, 1.190 Dart dosyasına hiç dokunulmadı. | Mobil yok; PWA + responsive. |
| **Seed/veri**: 85 ürün seed'de stok=100 sabit, tek görsel, kategori 3 kez yeniden yapılandırıldı (28→11/48→12). | Ürün/katalog veri modelini ilk hafta sabitle; gerçek stok/fiyat/gramaj ile tek seed JSON. |

---

## 6. Sunucu uyumu — PHP değil Node/Prisma, kanıta dayalı

**Sunucu (2026-08-20 SSH)**: Ubuntu 22.04, 8 vCPU/11 GB, Node 20.20 + pnpm 9.15 + PM2 6 (pm2-root.service + logrotate), PostgreSQL 14.22 (localhost, scram), nginx 1.18 (+ conf.d real-ip/rate-limit zonları), certbot timer + Cloudflare Full(strict). **Yok**: PHP, Redis, Docker, MySQL. Mevcut projeler: floovent (Next+Nest), uyanisakademi (pnpm monorepo: Nest API PM2 cluster + Vite web/admin statik), b2ld-contact-api. Ortak ops: `/opt/birbudak/scripts/` (health-check 5 dk, pg_dump -Fc + uploads tar 7 gün, daily-report, error-watcher, Telegram).

**Bahçeden Al'ın kendi kanıtı**: PERFORMANCE_SPRINT_PLAN "Production deploy" bölümü PHP 8.2-fpm + 12 ext + OPcache ini + Composer + Redis harden + php-fpm vhost + queue worker + scheduler cron gerektiriyordu (ADR-0030 "sunucuda PHP yok") ve **hiç yapılmadı**; ayrıca Laravel Scheduler (5 cron job: cashback, referral, subscription:expire, slots:generate, kvkk:purge) ve `queue:work` süreçleri ayrı supervisor ister — PM2 ekosistemine ikinci bir runtime eklemek demek. Redis kazanımı yerelde ölçülemedi; Bağdam ölçeğinde gereksiz.

**Karar önerisi**: Node 20 + **NestJS (veya Fastify) + Prisma + PostgreSQL 14**, admin Vite React SPA statik, web Next.js SSR (SEO) veya Vite+SSR — **uyanisakademi ile aynı iskelet** (ops script'leri, deploy.sh, GitHub Actions `appleboy/ssh-action`, ecosystem.config.js, nginx vhost kalıbı kopyalanır). Yerleşim: `/opt/bagdam/` (apps/api port **5010**, apps/web 3xxx veya statik, apps/admin statik), uploads `/opt/bagdam/apps/api/uploads`, `.env` sadece sunucuda (repo public), yedek `/opt/birbudak/backups/bagdam/` (backup-bagdam.sh kopyası), nginx: `bagdam.com`/`www` (web), `admin.bagdam.com` (statik + app auth), `api.bagdam.com` veya `/api/` proxy 127.0.0.1:5010 + `limit_req zone=api`, `/assets/` immutable, güvenlik header'ları, LE webroot `/var/www/letsencrypt`, Cloudflare proxied Full(strict). PHP seçilmesi için tek gerekçe "Hyperlocal kodunu yeniden kullanmak" olurdu; §2-3 gösterdi ki kullanılabilir kısım kod değil, kalıp.

**"Tek DB kuralı" (local dev → SSH tüneli → production DB) artı/eksi**
- Artı: şema/ortam sapması yok, seed tekrarı yok, tek kişilik ekipte basit, "prod'da çalışmıyor" sınıfı hata azalır, `prisma migrate dev` ile migration'lar tek kaynaktan.
- Eksi (kanıtlı): (1) **ADR-0003 ölçümü**: SSH tüneli üzerinden PG sorgu başına 87 ms → 11-17 sn sayfa; yerel PG 4 ms/50 sorgu, "1000×" — ORM'li (Prisma) N+1'e yatkın dev döngüsünde aynı risk. (2) `prisma migrate dev` drift görünce **DB reset** teklif eder — production'da felaket; migration geliştirme asla canlı DB'ye karşı yapılmamalı. (3) Gerçek müşteri PII'si (KVKK) geliştirme makinesinde; public repo ile birleşince sızıntı riski. (4) Test verisi/seed production'u kirletir; offline çalışılamaz. (5) Geliştirme makinesinde **PostgreSQL 18 zaten kurulu** (PROJECT_MEMORY), maliyet sıfır.
- Öneri: **lokal PG (bagdam_dev) + `prisma migrate dev` lokal → migration commit → sunucuda `deploy.sh` içinde `prisma migrate deploy`**; production'a sadece `psql`/read-only tünel (inceleme) veya gerekirse aynı sunucuda `bagdam_staging` DB. Kural ADR'a yazılsın (uyanisakademi'den bilinçli sapma, gerekçe ADR-0003 ölçümü + migrate dev reset riski).

---

## 7. Somut alıntı adayları (yol → ne alınır)

| Dosya/klasör | Ne alınır |
|---|---|
| `backend/database/data/tr-locations/{sehirler,ilceler,mahalleler-1..4}.json` | TR il/ilçe/mahalle ham veri (~11 MB) → Bağdam `prisma/seed/data/`. |
| `backend/database/seeders/TrLocationSeeder.php` | Upsert/chunk/slug/Title-Case/"MAHALLESİ" strip mantığı → TS seed. |
| `backend/database/migrations/2026_05_07_120001..120003_*` + `120004_extend_addresses_for_saved_pattern.php` + `140001` + `140004_add_granular_address_fields.php` | provinces/districts/neighborhoods + addresses (is_default, label, FK'lar, granular alanlar, softDelete, partial unique index raw SQL) → Prisma şema. |
| `backend/app/Observers/AddressObserver*` (ADR-0013/0021; dosya adı DOĞRULANMADI) | "tek default adres" + FK zincirinden city/state türetme kuralı. |
| `backend/app/Services/OrderService.php:81-172, 369-466` | createOrder adım sırası + transaction/rollback + atomik kapasite UPDATE → Nest servis. |
| `backend/app/Enums/Order/*StatusEnum.php`, `PaymentStatusEnum.php` | Durum listeleri (kırpılarak). |
| `backend/database/migrations/2025_09_08_*_create_order_payment_transactions_table.php`, `2025_08_14_*_create_promo_table.php` | Ödeme transaction + kupon şeması. |
| `backend/database/migrations/2025_05_06_055951_create_orders_table.php`, `060344_create_order_items_table.php` | Adres/kalem **snapshot** alanları. |
| `backend/database/migrations/2026_05_08_120001/120002` + `app/Services/SlotGeneratorService.php` + `ChannelEtaService.php` | Haftalık şablon → 14 günlük instance üretimi + `display_text` ETA sözleşmesi → kutu teslimat günü/kapasite. |
| `backend/database/seeders/BahcedenAlWebSettingsSeeder.php` + `settings` tablosu (`variable`,`value` JSON) + `2026_05_08_120003_add_cargo_eta_to_settings.php` | Key-value ayar anahtar seti (site/iletişim/sosyal/yasal/kargo ETA). |
| `backend/app/Console/Commands/PurgeSoftDeletedKvkkData.php` | KVKK 30 gün hard-delete cron. |
| `customer-web/src/components/Functional/CookieConsent.tsx` + `src/components/Cookie/CookieConsentBanner.tsx` + `public/locales/tr.json` (`cookie.*`, `cookieConsent.*`) + `src/lib/cookies.ts` | KVKK çerez banner'ı (metin + localStorage anahtarları + cookie helper). |
| `scraped-data/static_contents.json` (slug: cayma-hakki, kisisel-verilerin-korunmasi, mesafeli-satis-sozlesmesi, on-bilgilendirme, uyelik-sozlesmesi; alan `body_html`) | Yasal metin taslakları (Birbudak Grup) → Bağdam için uyarlanacak; hukuki kontrol gerekir. |
| `scraped-data/products-enriched.json` (`slug,name,sku,price,currency,availability,in_stock,description,images[],primary_image,seo{title,meta_description,meta_keywords},category_path,category_breadcrumb[]`) + `enrich.mjs`, `category-tree.json` | Ürün seed JSON şablonu + kategori ağacı üretimi; aynı bölge ürün taksonomisi. |
| `backend/database/seeders/BahcedenAlCategoryRestructureSeeder.php` | 11 ana kategori TR adı/slug (Sebze & Meyve, Süt Ürünleri, Et-Tavuk-Yumurta, Kahvaltılık, Bakliyat & Tahıl, Zeytin & Yağ, Baharat & Bitki, Konserve-Salça-Turşu, Kuruyemiş, İçecekler, Süpergıdalar). |
| `backend/database/seeders/UrlaExpressZoneSeeder.php:38-61` | Urla bölgesi 9 noktalı polygon (lng,lat) + merkez 38.33/26.7647 — Urla yerel teslimat bölgesi gerekirse. |
| `deploy/coming-soon/bahcedenal.com.tr.nginx.conf`, `index.html` (JSON-LD Organization, canonical, OG), `robots.txt`, `RUNBOOK.md` §1-3, §5, §6, §9 | Coming-soon + cutover + Cloudflare DNS/SSL adımları + lansman 301 map stratejisi → bagdam.com için şablon. |
| `seo-snapshot/*.xml`, `scraped-data/seo_redirects.csv` | (Bahçeden Al'a özgü) 301 map kaynağı kalıbı. |
| `customer-web/next.config.ts:83-158` | Güvenlik header'ları + sitemap/robots Cache-Control. |
| `customer-web/scripts/generate-sitemap.mjs`, `update-robots.mjs` | Build-time sitemap/robots üretimi. |
| `customer-web/scripts/optimize-public-images.mjs` | Sharp toplu görsel optimizasyonu. |
| `customer-web/src/hooks/useChannelContext.ts`, `useUserLocation.ts`, `src/components/Location/TrLocationCascading.tsx`, `LocationSelector.tsx` | Tek-hook state machine + ID-based adres cookie + il/ilçe/mahalle cascading dropdown. |
| `customer-web/src/lib/redux/slices/cartSlice.ts` + `src/components/Cards/ProductCardAddButton.tsx` | Optimistic cart (snapshot/restore) akışı → React Query karşılığı. |
| `customer-web/src/pages/_app.tsx` SWRConfig + `src/routes/api.ts` axios timeout/retry | Fetch politikası varsayılanları. |
| `CLAUDE.md` (Update Protocol + ADR şablonu), `PROJECT_MEMORY.md` §4/§6 yapısı, `STAGING_DEFERRED.md` | Proje belleği/ADR disiplini (kısaltılmış). |
| `PERFORMANCE_SPRINT_PLAN.md:526-533` | Production don't-do listesi (APP_DEBUG, public Redis/PG, build artifact git'te…). |

Alınmayacaklar: Hyperlocal kodunun kendisi (Laravel/Flutter), multi-vendor/store/rider/wallet/referral/subscription(SaaS) şemaları, Redis katmanı, Google Maps/Geocoding bağımlılığı, Firebase, i18n çoklu dil, Tabler Blade admin.
