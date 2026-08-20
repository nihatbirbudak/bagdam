> **Hakem raporu — geliştirme sırası & rework merceği** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 2 — hakem). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Hakem merceği: sira

**Kazanan:** mvp-once

## Puanlar

- **mvp-once** — kapsam 8, sıra 9, sunucu uyumu 8, sadelik 9, risk 8 → **toplam 42/50**
  Tüm katmanları kapsıyor (şema ~26 model, API, admin 22 ekran, ops pick/packing, deploy). Sıra temiz ve her faz bir öncekine yaslanıyor: F1 byte-byte aynı .hbs ile site canlı → F2 şema dondurulur → F3 bootstrap (senkron `var PRODUCTS=...`; doğrulandı: cart.js bare-identifier + `typeof` guard, satır 66/314/348/894/1017; inline IIFE'ler senkron PRODUCTS kullanır: urun.html:101, kutu.html:158) → F4 admin → F5 CMS → F6 auth → F7 checkout/iyzico → F8 motor. 'Dinamik site + admin' ilk teslim F4 sonu (~14 gün). Eksikler: kapasite/DeliveryDate yok, BoxTemplate/ProductLot ertelenmiş, abonelik motoru (F8) yalnız iyzico sonrası test edilebilir (Manual provider yok), cycle#1 'checkout'ta peşin' vs 'kesimde tahsil' çelişkisi modellenmemiş, staging yok (callback için prod domain + sandbox anahtarı kullanılmalı), tek süreçte web+API. Sunucu uyumu iyi (Nest :5010, PM2, deploy.sh sırası düzeltilmiş, aynı-origin /api); hbs-in-Nest sunucuda emsalsiz ama basit.
- **alan-dogru** — kapsam 10, sıra 8, sunucu uyumu 7, sadelik 5, risk 7 → **toplam 37/50**
  En eksiksiz öneri: DeliveryDate (tarih×kesim×kapasite, atomik rezerv) tek kesim kaynağı, ProductLot/BoxTemplate, versiyonlu LegalDocument + Consent(IYS), SubscriptionCancellation (≤7/≤15 gün), Invoice/Shipment/Notification/OTP, prepaid+DELTA, durum makineleri + birim testleri, staging. Sıra konusunda iki üstün fikir: F6 motor `ManualProvider` ile PSP'den ÖNCE deterministik test (ödeme kararı değişse motor yeniden yazılmaz) ve staging'in F7 ön koşulu olması. Ancak doğrulanmış bir sıralama hatası var: F5'te temiz URL (`/urun/:slug`, `/kutu/:tier`, `/politikalar/:slug`) + `.html→301` uygulanırken cart.js'e F8'e kadar dokunulmuyor; cart.js `sepet.html` (:91,:209), `urun.html?id=` (:253,:661), `kutu.html?tier=` (:269), göreli `assets/icons/...` (:97-98,:381) ve sayfa tespiti `/(^|\/)sepet\.html$/` (:399,:1096) hardcoded; HTML'de 44 göreli asset referansı, `<base>` yok → iç içe yollarda kırılır. Kapsam geniş (60+ model init, Tr* 74k mahalle, 5 rol, 2 web süreci + staging çifti, 61 gün) → bahcedenal 'aşırı kapsam' dersine yaklaşıyor; gelir üreten akış (F8) ~46. güne kayıyor. Express+Nunjucks :5011 sunucuda emsalsiz (floovent web/backend ayrımına benzer, kabul edilebilir).
- **konvansiyon** — kapsam 8, sıra 7, sunucu uyumu 10, sadelik 8, risk 6 → **toplam 39/50**
  Sunucu konvansiyonuna en sadık: nginx'ten statik web dist (UA apps/web ile aynı), Nest :5010, UA deploy.sh/ecosystem/workflow/backup/health kopyası, settings şifreli DB'de. Şema geniş ve makul (BoxTemplate, Lot, Shipment, Legal, Consent, SavedCard, WebhookEvent + UA log tabloları). Sıra genel olarak doğru ama: (1) Seçim (a) async `bootstrap.js` + `bagdam:ready` — 'cart.js değişmeden' iddiası doğrulanamadı: cart.js DOMContentLoaded'da `updateBadge()→count()→hasActiveSub()` `typeof SUB_TIERS` ile çalışır (:66-70, :1214-1222); fetch dönmeden SUB_TIERS tanımsız → rozet/drawer yanlış; inline IIFE'ler senkron (urun.html:101) → 10 sayfa + cart.js düzenlenmeli; FOUC/layout shift 'piksel koruma' ile çelişir; SEO JS'e bağımlı kalır; ileride SSR gerekirse şablon katmanı = rework. (2) Adım 7 motor+ops+SMS+Shipment+3 sayfa tek blokta (8 gün), PSP'den bağımsız test yolu yok. (3) api.bagdam.com + COOKIE_DOMAIN=.bagdam.com + CORS credentials (aynı-origin yerine) ve admin token localStorage (P1'e ertelenmiş) = ek yapılandırma/rework. Efor (40 gün) iyimser.

# Bağdam Mimari Önerileri — Hakem Değerlendirmesi (Mercek: Geliştirme Sırası & Rework Riski)

Tarih: 2026-08-20 · Değerlendirilen: `mvp-once`, `alan-dogru`, `konvansiyon` · Kaynaklar: öneri metinleri, Faz 1 çıktıları (A/B/C/D), `website/` dosyaları (grep/sed ile doğrulandı), UA `deploy.sh`/`ecosystem.config.js`, bahcedenal `deploy/coming-soon`, `tr-locations`.

## 0. Doğrulanan teknik gerçekler (puanlamanın dayanağı)

| # | Gerçek | Kanıt | Etkilediği öneri |
|---|---|---|---|
| 1 | Her sayfa `products.js → cart.js → inline <script>` sırasıyla yükler; inline script'ler **IIFE olarak parse anında** çalışır ve `PRODUCTS`/`SUB_TIERS`'ı **senkron** kullanır | urun.html:97-101 (`PRODUCTS.find`), kutu.html:154-158 (`SUB_TIERS.some`), urunler.html:150+ | konvansiyon (a) async fetch → 10 sayfa + cart.js düzenlemesi; mvp-once/alan-dogru senkron global koruduğu için sıfır istemci değişikliği |
| 2 | cart.js global'lere bare identifier + `typeof` guard ile erişir; `products.js` `const` tanımlar | cart.js:66, 314, 348, 558, 613, 691, 875, 894, 969, 1017, 1041, 1072 | mvp-once'ın `var PRODUCTS = __BAGDAM__.products` bloğu çalışır |
| 3 | cart.js `DOMContentLoaded`'da `updateBadge()` çağırır; `count()` → `hasActiveSub()` `typeof SUB_TIERS` kontrolü yapar | cart.js:60-70, 1214-1222 | konvansiyon: fetch dönmeden rozet/drawer yanlış; "cart.js değişmeden" iddiası **geçersiz** |
| 4 | cart.js hardcoded `.html` linkler ve göreli `assets/` yolları içerir; sepet sayfası regex ile tespit edilir | cart.js:91, 97-98, 209, 253, 269, 381, 399, 661, 1096; index.html 44 göreli asset ref, `<base>` yok | alan-dogru: F5'te temiz URL (`/urun/:slug`, `/kutu/:tier`) iç içe yollarda göreli asset/link kırılması; F8'e kadar cart.js'e dokunulmuyor |
| 5 | HTML/JS'te `{{` / `{%` yok | grep 0 eşleşme | hbs (mvp-once) ve nunjucks (alan-dogru) byte-byte kopya güvenli |
| 6 | Kesim kuralı kodda ikili: `CUTOFF_WEEKDAY` (2 gün önce 23:59) ve `lockedDeliveryDay()` (1 gün önce 12:00) | cart.js:1033-1035, 1057-1065 | Üç öneri de tek kural kararını F0'a koymuş (doğru); mvp-once §8'de cart.js'in bootstrap kuralına çekileceğini yazıyor — bu da bir cart.js değişikliği, F8 adaptörüne planlanmalı |
| 7 | UA deploy.sh migrate'i build'den ÖNCE çalıştırır; ecosystem `instances 2 cluster`, PORT 5000 | UA deploy.sh:22-48, ecosystem.config.js | Üç öneri de sırayı düzeltiyor (build → pg_dump → migrate → reload) ✔ |
| 8 | UA apps/web = Vite+React statik dist; sunucuda Express/Nunjucks veya hbs emsali yok | UA apps/web/package.json | konvansiyon statik web konvansiyonla birebir; mvp-once (hbs-in-Nest) ve alan-dogru (Express+Nunjucks :5011) yeni kalıp |
| 9 | bahcedenal `CookieConsentBanner.tsx`, `tr-locations/*.json`, `deploy/coming-soon/{RUNBOOK.md,nginx.conf}` mevcut | ls | Üç önerinin alıntıları gerçek |

## 1. Puan tablosu

| Öneri | Completeness | Ordering | Server fit | Simplicity | Risk (10=az) | **Toplam/50** |
|---|---|---|---|---|---|---|
| **mvp-once** | 8 | 9 | 8 | 9 | 8 | **42** |
| konvansiyon | 8 | 7 | 10 | 8 | 6 | 39 |
| alan-dogru | 10 | 8 | 7 | 5 | 7 | 37 |

**Kazanan: `mvp-once`.** Gerekçe: bağımlılık zinciri en temiz (her faz bir öncekine yaslanıyor, sonrakine değil), site F1'den itibaren byte-byte aynı görünümle canlı, frontend dinamikleştirme yöntemi (senkron bootstrap + hbs) doğrulanmış istemci davranışını korur, şema F2'de donar ve özellik modülleri değişmeyen tablolara yazılır, "dinamik site + admin" ~14 günde teslim. Zayıf noktaları (motorun PSP'ye bağımlı testi, cycle#1 belirsizliği, kapasite yokluğu) alan-dogru'dan alınacak fikirlerle **mevcut sırayı bozmadan** kapatılabilir.

## 2. Öneri bazlı değerlendirme

### 2.1 mvp-once (42)

**Bağımlılıklar doğru mu?** Evet. F0 kararlar → F1 iskelet (DNS/LE/PM2/nginx/backup) → F2 şema+seed → F3 bootstrap/katalog → F4 admin+medya → F5 CMS → F6 auth/mail → F7 checkout/iyzico → F8 motor → F9 bildirim/yasal → F10 lansman. Her faz DoD'si bir öncekini tüketiyor; geri dönüş gerektiren tek yer F8'in `BahcedenCart.remote` adaptörü (planlı).

**Hangi karar değişirse ne yeniden yazılır?**
- Ödeme sağlayıcısı: `PaymentProvider` enum (IYZICO/PAYTR/MANUAL) + `PaymentMethod.providerCustomerKey/providerCardToken` + `Payment.conversationId` generic → adaptör değişir, şema değişmez ✔. Ancak NON3D yetkisi alınamazsa F7 **ve** F8 birlikte bloklanır (Manual provider yok) ✘.
- Abonelik modeli: cycle-merkezli, `Setting.commerce.*`'e taşınan kurallar (kesim, ilk-kutu, atlama) kod değişmeden ayarlanır ✔; ama `cutoffAt` her cycle'a yazıldığından kural değişince SCHEDULED cycle'lar yeniden hesaplanmalı (küçük script) △. Kapasite yok; eklenmesi yeni tablo + checkout/lock değişikliği △.
- Auth modeli: e-posta+parola; telefon+OTP eklemek additive (User.phone var, OtpCode yok) ✔.
- Medya: `MediaFile.path` + ProductImage; seed görselleri kopyalamadan yol ile kaydediyor ✔.
- Frontend yöntemi: hbs view katmanı ayrı Nest modülü; ayrı sürece taşınması şema/API'yi etkilemez ✔.

**Site kesintisiz mi?** Evet — F1'de `.hbs` byte-byte aynı, Playwright baseline, her fazda diff≈0 şartı. `?sifirla` ve `.html` URL'ler korunuyor; cart.js'e F8'e kadar dokunulmuyor (kanıt: gerçek #1-2).

**Eksik/çekince:** (i) cycle#1 için "checkout'ta Order + Subscription PENDING + cycle#1" ve "kilitte her cycle Order üretir" cümleleri çift Order/çift tahsilat riski doğuruyor; `prepaidAmount` veya "cycle#1.orderId = checkout Order'ı" kuralı yazılmalı. (ii) Staging yok — iyzico callback'i için F7'de "prod domain + sandbox anahtarı" adımı açıkça yazılmalı. (iii) Admin login F4'te gerekiyor, AuthModule F6'da — hafta-2 planında "AuthModule'ün admin kısmı" ile kapatılmış ama faz tablosunda görünmüyor. (iv) Consent guestKey/IYS alanları yok (çerez banner F9'da geri dönüş).

### 2.2 konvansiyon (39)

**Güçlü:** Sunucu konvansiyonuna birebir uyum (statik web dist nginx'ten, Nest :5010, UA deploy/ecosystem/workflow/backup/health kopyası, settings şifreli DB'de, UA admin olduğu gibi). Şema makul genişlikte (BoxTemplate, Lot, Shipment, Legal, Consent, SavedCard, WebhookEvent). "Lansman tek seferlik kutuyla" yedek planı gerçekçi.

**Sıra/rework sorunları:**
- **Seçim (a) async fetch** — gerçek #1 ve #3: inline IIFE'ler senkron, cart.js init rozeti fetch'ten önce hesaplar. "10 sayfa × 1 satır, cart.js değişmeden" iddiası doğrulanamadı; en az cart.js'e `bagdam:ready` dinleyicisi + yeniden render eklenmeli. FOUC/layout shift piksel-koruma hedefiyle çelişir; `urun`/`gunluk` SEO'su JS'e bağımlı; ileride SSR gerekirse şablon katmanı = yeniden yazım (yöntem değişikliği riski en yüksek öneri).
- Adım 7 (8 gün): motor + dunning + SMS + Shipment + ops ekranları + 3 web sayfası tek blok, PSP'siz test yolu yok → bahcedenal "her şey bağlı" riski.
- `api.bagdam.com` + `COOKIE_DOMAIN=.bagdam.com` + CORS credentials ve admin token localStorage (P1'de cookie'ye taşıma = planlı rework). Aynı-origin `/api` ile bu iş hiç doğmazdı.
- Adım 1'de tam şema+seed lokal, adım 2'de sunucu — "walking skeleton önce" ilkesine küçük bir sapma ama ~8. günde canlı; kabul edilebilir.

### 2.3 alan-dogru (37)

**Güçlü (ve final plana alınacak):** `ManualProvider` ile motorun PSP'den ÖNCE deterministik testi (F6<F7); `DeliveryDate` tek kesim/kapasite kaynağı + atomik rezerv; staging çifti; `prepaidAmount`/DELTA; versiyonlu LegalDocument + Consent(IYS) + SubscriptionCancellation süreleri; pricing/state `packages/shared` + birim testler; sunucudan üretilen `/assets/products.js` sıfır-HTML-değişikliği ara adımı; `dist.next → mv` atomik deploy.

**Sıra/rework sorunları:**
- **Temiz URL F5'te, cart.js F8'de** (gerçek #4): iç içe rotalarda göreli asset/link kırılması, `sepet.html` regex tespiti (`/sepet` altında yüzen sepet checkout'ta görünür), `kutu.html?tier=` için query taşıyan 301 map. Öneri bunu "karar" olarak işaretlemiş ve "`.html` kalırsa plan değişmez" demiş; ama yazıldığı haliyle F5 DoD'si ("eski URL'ler 301") F8 öncesi kırılma üretir.
- **Kapsam**: 60+ model tek init, Tr* 74k mahalle, Invoice/OTP/Notification, WHOLESALE/OPS rolleri, 2 web süreci + staging çifti (4 PM2 süreci), 61 iş günü; gelir üreten akış (F8) ~46. güne kayıyor. bahcedenal dersi ("85 ürün için 186 tablo") burada yumuşak biçimde tekrar ediyor. Eklemeler additive olduğu için rework riski düşük ama takvim/odak riski yüksek.
- Express+Nunjucks :5011 sunucuda emsalsiz (floovent web/backend ayrımına benzediği için kabul edilebilir); Tr* yalnız kargo açılırsa anlamlı.

## 3. "Önce ne" kararları kanıtlı mı?

| Karar | mvp-once | alan-dogru | konvansiyon |
|---|---|---|---|
| Şema, özellik kodundan önce donar | ✔ F2, ADR "v1 donduruldu" | ✔ F2 + testler | ✔ Adım 1 |
| Canlı iskelet ilk hafta | ✔ F1 (3 g) | ✔ F1 (3 g) | △ Adım 2 (~8. gün) |
| Katalog → admin → CMS → auth → checkout → motor | ✔ | ✔ (motor F6 önce, PSP F7) | ✔ ama motor+ops+web tek blok |
| Frontend yöntemi kanıta dayalı | ✔ cart.js satır atıfları doğru | ✔ products.js sunucudan (sıfır değişiklik) doğru; temiz URL kanıtsız | ✘ "cart.js değişmeden" doğrulanamadı |
| Ödeme kararı şemadan önce (Faz 1 D §"Faz Sıralamasına Etkisi" #2) | ✔ F0 | ✔ F0 | ✔ Adım 0 |
| Tek DB kuralından bilinçli sapma + gerekçe (bahcedenal ADR-0003, UA 163 test siparişi) | ✔ ADR-0009 | ✔ | ✔ ADR-0007 |
| Staging / callback URL | ✘ (1 günde eklenir notu) | ✔ | △ opsiyonel |

## 4. Final plana ZORUNLU düzeltmeler (özet)

1. Bootstrap **senkron** olacak (inline `var PRODUCTS=…` veya sunucudan üretilen `products.js`); async fetch + `bagdam:ready` kullanılmayacak.
2. `.html` URL'ler etkileşimli sayfalar (kutu/sepet/uyelik) dönüşene kadar korunur; temiz URL + 301 lansman sonrası P2.
3. Abonelik motoru `ManualProvider` ile iyzico'dan önce/paralel test edilir; NON3D yetkisi F0'da yazılı teyit; 3DS ödeme-linki yedek akışı tasarlanır.
4. Cycle#1 tahsilat semantiği (`prepaidAmount`/DELTA veya "cycle#1.orderId = checkout Order'ı") şemaya ve lock servisine açıkça yazılır.
5. `DeliveryDate` (kesim + kapasite) ve `BoxTemplate`/`ProductLot` MVP şemasına alınır (additive, küçük); `Consent.guestKey/iysStatus` F2'de.
6. iyzico callback için staging ya da "prod domain + sandbox anahtarı" adımı F7 ön koşulu; webhook WAF istisnası testten önce.
7. Aynı-origin `/api` + httpOnly cookie (admin dahil); subdomain API ve localStorage token yok.
8. Kapsam kilidi: Tr* adres, Invoice/OTP/Notification tabloları, WHOLESALE/OPS rolleri, kargo aracı, WhatsApp → P2 (ADR'lı backlog); karar kuyruğu ≤3.

## 5. Sonuç

`mvp-once` sıra ve rework merceğinde en sağlam iskelet; `alan-dogru` alan modeli ve test disiplininde en olgun ama kapsam/takvim ve temiz-URL sıralama hatası taşıyor; `konvansiyon` sunucu uyumunda en iyi ama frontend yöntemi doğrulanmış istemci davranışıyla çelişiyor. Final plan = mvp-once iskeleti + alan-dogru'nun motor/kesim/staging/yasal kalıpları + konvansiyon'un sunucu konvansiyonu ve yedek lansman planı.