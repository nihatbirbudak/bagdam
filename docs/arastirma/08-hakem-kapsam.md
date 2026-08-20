> **Hakem raporu — kapsam & doğruluk merceği** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 2 — hakem). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Hakem merceği: kapsam

**Kazanan:** mvp-once

## Puanlar

- **mvp-once** — kapsam 8, sıra 9, sunucu uyumu 9, sadelik 9, risk 7 → **toplam 42/50**
  Kapsam: envanterdeki 10 sayfa + 2 unused, 22 ürün alanı (storage/allergen/freshnessNote dahil), pref (Product.prefLabel/Options/Default + User.prefs + OrderLine/CycleItem.pref), Producer, BoxTier, Subscription/Cycle/CycleItem/SubscriptionEvent (skip, extras, swap, retention, iptal nedeni), Order+OrderLine snapshot, PaymentMethod token, Consent, WholesaleLead, Post, Policy, SiteContent (anahtar listesi §2.20 ile birebir), Setting commerce.* (cart.js sabitlerinin tamamı tabloda), MediaFile, AuditLog — hepsi alan-alan frontend öğesine bağlanmış. Doğruluk: frontend iddiası sağlandı (cart.js'te `typeof PRODUCTS` guard'ları :66,:314,:348,:558,:613,:875,:894,:969,:1017,:1072; urunler.html:192-194 / urun.html:101 / kutu.html:158 inline script'ler PRODUCTS'ı senkron kullanıyor → inline bootstrap yaklaşımı cart.js'i değiştirmeden çalışır). Eksik/yanlış: Policy in-place version (+1) — kabul edilen metin saklanmıyor (Mesafeli md.20 3 yıl); ProductLot ve BoxWeek ertelenmiş (frontend tek batch gösterdiği için kabul edilebilir ama izlenebilirlik zayıf); MailLog/CronLog şemada yok ama Faz 6/9'da kullanılıyor; checkout'ta peşin ödenen ilk cycle'a kesim öncesi eklenen ekstralar için fark tahsilatı tasarlanmamış; iptalde 7 gün/15 gün yasal tarih alanları yok. Sıra: karar→canlı iskelet→donmuş şema→bootstrap→admin(14. gün ilk teslim)→CMS→auth→checkout→motor; geri dönüş yaratmıyor. Sunucu: tek PM2 süreci :5010 + nginx statik, same-origin cookie, deploy.sh sırası düzeltilmiş, backup/health entegrasyonu, lokal dev DB kararı gerekçeli. Sadelik: ~26 model, HTML byte-byte aynı, cart.js sıfır değişiklik. Risk: 44 gün gerçekçi; tek süreçte web+API bağlaşımı ve politika versiyon hatası puan düşürdü.
- **alan-dogru** — kapsam 9, sıra 8, sunucu uyumu 8, sadelik 5, risk 6 → **toplam 36/50**
  Kapsam en geniş: ProductLot (batch→lot, CycleItem.lotId, OrderLine.lotCode), BoxTemplate (küratör 'Ece'), DeliveryZone/DayRule/DeliveryDate (tek kesim kaynağı + kapasite), SubscriptionDiscount (ilk 2 kutu/retention/kupon), SubscriptionCancellation (effectiveAt ≤7g, confirmedAt, refundDueAt ≤15g), CycleItem source CART_MERGE ('bu haftaki kutuma ekle'), prepaidAmount + Payment kind DELTA (checkout'ta ödenen 1. kutu + sonradan eklenen ekstra), LegalDocument satır-başına versiyon (slug+version unique, contentHash), Consent+İYS alanları, Invoice/billing (TCKN/VKN), Cart server kopyası, OTP, NotificationTemplate/Log, Shipment/ShipmentEvent. 10 sayfanın tamamı F5 (7 okuma) + F8 (kutu/sepet/uyelik) ile planlı; bootstrap 'alan alan eş snapshot testi'. Doğruluk sorunları: Order.cycleId ve SubscriptionCycle.orderId çift FK (taslak olduğu belirtilmiş); Address'te TrProvince/District/Neighborhood FK zorunlu — frontend yalnız Urla/Çeşme select'i taşıyor, 74k mahalle seed'i MVP için aşırı; temiz URL kararı cart.js'teki sabit linklerle (cart.js:91,:209,:269 sepet/kutu.html; :399 `/sepet\.html$/` regex ile yüzen sepetin gizlenmesi) çelişir — F8'e kadar 301 hop'u ve regex kırılması; web ayrı süreç (:5011) + staging (:5020/21) ops yükü. Sıra mantıklı (motor F6'da sahte sağlayıcıyla testli, PSP F7'de) ama ilk görünür teslim ~4. hafta, cart.js→bagdam.js yeniden yazımı (7g) sona yığılmış. Efor 61 gün — üç öneri içinde en yüksek takvim riski; ~50 model.
- **konvansiyon** — kapsam 8, sıra 7, sunucu uyumu 8, sadelik 6, risk 6 → **toplam 35/50**
  Kapsam: UA şemasından kırpılmış User/UserAddress/Order/Payment/Coupon + Bağdam'a özgü Producer, ProductLot, BoxTier, BoxTemplate, Subscription/Cycle/CycleItem, SavedCard, WebhookEvent, Shipment, CancellationRequest, LegalDocument (versiyonlu satır), Consent, WholesaleLead, BlogPost, FaqItem, SiteSetting grupları, MediaFolder/File — tüm sayfalar ve varlıklar karşılanıyor; 58 kullanılan görselin medyaya içe aktarımı düşünülmüş. Eksik: SubscriptionEvent (abonelik olay izi) yok; DeliveryZone modeli yok (settings.teslimat.ilceler); ProductImage.url MediaFile'a bağlı değil (kullanım takibi zayıf); sepet/uyelik metinleri site.* listesinde yok; çerez banner'ı Faz 2'ye atılmış. Doğruluk: (1) 'assets/bootstrap.js' async fetch + `bagdam:ready` ile '10 sayfa × 1 satır' iddiası eksik — inline script'ler PRODUCTS'ı üst düzeyde senkron kullanıyor (urunler.html:192-194, urun.html:101, kutu.html:158, sepet.html:413/419/493, uyelik.html:201) ve cart.js'in DOMContentLoaded init'i (cart.js:1214: updateBadge, wireAddButtons→renderStepper, categoryFor :348) veri gelmeden koşar → boş stepper/ikon, yeniden çizim ve FOUC; 'piksel koruma' şartıyla çelişen iskelet-görünüm riskini kendisi de kabul ediyor (risk 4). (2) 'Cloudflare zone zaten aktif' ve '/root/cf-api.sh' — sunucu gerçekleri 'DNS/Cloudflare kurulumu henüz yok' diyor → DOĞRULANMADI/yanlış. (3) api.bagdam.com ayrı origin → CORS + cookie domain karmaşası (Q12 olarak açık bırakılmış). (4) Admin token localStorage'da (UA P0-07 açığı) P1'e ertelenmiş. Sıra: adım 7'de motor+dunning+SMS+Shipment+admin ops+3 web sayfası 8 güne sıkıştırılmış; adım 1'de 4 gün lokal iş canlı iskeletten önce. Sunucu uyumu yüksek (UA kopyası) ama 40 gün iyimser.

# Bağdam Mimari Önerileri — Bağımsız Hakem Raporu (Mercek: Kapsam & Doğruluk)

## 0. Yöntem ve kanıt
- Üç öneri (mvp-once, alan-dogru, konvansiyon) Faz 1 çıktıları (A frontend envanteri, B bahcedenal, C uyanisakademi, D TR gereksinimleri) ve sunucu gerçekleriyle karşılaştırıldı.
- Frontend iddiaları dosya üzerinde doğrulandı (`website/`):
  - `assets/cart.js`: global dizilere `typeof PRODUCTS !== \"undefined\"` guard'ıyla erişim (:66, :314, :325, :348, :558, :613, :691, :875, :894, :904, :969, :998, :1017, :1041, :1072); init `document.addEventListener(\"DOMContentLoaded\", …)` (:1214: updateBadge, wireToggles, wireAddButtons…); sabit `.html` linkleri (:91 `sepet.html`, :209, :253 `urun.html?id=`, :269 `kutu.html?tier=`); `/(^|\\/)sepet\\.html$/` regex (:399).
  - Sayfa inline script'leri PRODUCTS'ı **senkron** kullanıyor: `urunler.html:192-194`, `urun.html:101`, `kutu.html:158,:469-471 (pairIds)`, `sepet.html:413,419,493,497,531,595`, `uyelik.html:201,238`. Yükleme sırası her sayfada `products.js → cart.js → inline`.
- Sunucu gerçeği: \"DNS/Cloudflare kurulumu henüz yok — planlanacak\"; boş port 5010; PHP/Redis yok.

## 1. Kapsam matrisi (envanter öğesi × öneri)

| Envanter öğesi | mvp-once | alan-dogru | konvansiyon |
|---|---|---|---|
| Ürün (22 alan + storage/allergen/freshness, season, images[]) | ✓ Product + ProductImage→MediaFile | ✓ (+extraOptions, recoWeight, seo) | ✓ (+extraOptions, stock, seo; ProductImage.url medyaya bağlı değil) |
| Tercih (pref eksenleri, bahceden_prefs, itemPrefs, cart pref) | ✓ | ✓ | ✓ |
| Parti/lot (batch, why) | ◐ Product.batchCode/whyText; ProductLot P2; snapshot OrderLine/CycleItem.batchCode | ✓ ProductLot + lotId/lotCode snapshot | ✓ ProductLot + lotCode snapshot |
| Üretici (meta normalize) | ✓ Producer | ✓ Producer | ✓ Producer (+journalSlug) |
| Kutu/tier + önerilen + pair + haftalık içerik | ✓ BoxTier; içerik = fresh havuzu + sortOrder (defaultFill korunur); BoxWeek P2 | ✓ Plan + BoxTemplate (küratör) | ✓ BoxTier + BoxTemplate |
| Abonelik: freq/gün/skip/extras/swap/retention/iptal nedeni/dunning | ✓ Subscription/Cycle/CycleItem/SubscriptionEvent | ✓ + SubscriptionDiscount, SubscriptionCancellation (7g/15g), prepaidAmount/DELTA, CART_MERGE | ✓ + CancellationRequest; SubscriptionEvent yok |
| Sepet (bahceden_cart, \"kutuma ekle\") | ◐ localStorage kalır; extras POST | ✓ Cart server + merge | ✓ Cart server + merge |
| Checkout alanları (16 input: auth 6 + müşteri 6 + kart 4) | ✓ Address(zone select)+Order snapshot; kart→iyzico CF | ✓ + billing TCKN/VKN, TR FK adres, DeliveryDate kapasite | ✓ UserAddress (party/tcNo) + Order snapshot |
| Üyelik (e-posta+parola, reset, kilit) | ✓ (e-posta doğrulama P2) | ✓ (+OTP, phoneVerified) | ✓ (UA kopyası, emailVerified) |
| Toptan lead | ✓ | ✓ | ✓ |
| Günlük (tür, süre, tarih, em başlık, kapak, ilişkili ürün) | ✓ Post | ✓ JournalPost (+producerId) | ✓ BlogPost |
| Politikalar (8 sekme, son güncelleme, onay) | ✗ in-place version (metin kaybolur) | ✓ satır-başına versiyon | ✓ satır-başına versiyon |
| İçerik/ayarlar (hero, pillars, showcase, cloud, blocks, FAQ, trust, panel notları, kutu notları, sepet/uyelik metinleri, footer, promo, manifesto, toptan) | ✓ SiteContent anahtar listesi + Setting commerce.* tablo | ✓ SiteContent(schema Json) + FaqItem + Setting | ◐ site.* grupları (sepet/uyelik metinleri listelenmemiş) |
| Medya | ✓ MediaFile (düz klasör) | ✓ Media | ✓ MediaFolder/File + 58 görsel içe aktarım |
| Teslimat bölgesi/kesim kuralı | ✓ DeliveryZone + Setting commerce.cutoff | ✓ Zone/DayRule/DeliveryDate (tek kaynak, kapasite) | ◐ settings.teslimat (tablo yok) |
| Yasal onay/İYS | ✓ Consent | ✓ Consent + İYS alanları | ✓ Consent |
| Bildirim/log tabloları | ✗ MailLog/CronLog şemada yok (fazlarda kullanılıyor) | ✓ NotificationLog/Template, SystemLog, CronLog | ✓ UA MailLog/SmsLog/SystemLog/CronLog |

## 2. Doğruluk bulguları

### mvp-once
- **Frontend stratejisi doğru**: `typeof` guard'ları ve senkron inline kullanım kanıtlandı → sayfaya gömülü `window.__BAGDAM__` + `var PRODUCTS=…` bloğu cart.js'i ve inline script'leri değiştirmeden çalıştırır; `.html` URL'leri korunduğu için cart.js linkleri ve `sepet.html` regex'i bozulmaz.
- **Hata — Policy versiyonlama**: `version +1` ve `bodyHtml` üzerine yazma; Consent yalnız sayı tutar → kabul edilen metin geri üretilemez (Mesafeli md.20). Düzeltilmeli.
- **Boşluk — ilk cycle ödemesi vs ekstra**: Faz 7 checkout'ta abonelik ilk kutusu tahsil ediliyor; Faz 8'de aynı cycle'a kesim öncesi ekstra/swap ekleniyor ama fark tahsilatı yok.
- **Şema tutarsızlığı**: Faz 6/9 MailLog'a, cron'lar CronLog'a dayanıyor; tabloda yok. Post.coverMediaId ilişkisiz.
- İptalde 7/15 gün yasal alanları yok; SMS yalnız opsiyonel (kabul edilebilir).
- Setting anahtar tablosu cart.js sabitleriyle (DELIVERY_FEE 49, eşik 1000, KDV %1, ekstra miktar seçenekleri :947-966, kesim kuralı :1034/:1057 çelişkisi) birebir eşleşiyor — güçlü.

### alan-dogru
- En eksiksiz alan modeli; mevzuat (Abonelik Yönetmeliği 7/15 gün, Mesafeli md.8 buton metni, İYS) ve operasyon (pick/packing/etiket, kapasite) kapsanmış.
- **Çelişki — temiz URL**: cart.js'te sabit `.html` linkleri ve `sepet\\.html` regex'i; bagdam.js yeniden yazımı F8'e kadar 301 hop'u ve yüzen sepetin sepet sayfasında gizlenmemesi riski.
- **Aşırı modelleme**: Address'te Tr* FK zorunlu + 74k mahalle seed'i; frontend yalnız Urla/Çeşme select'i taşıyor. Order.cycleId ↔ Cycle.orderId çift FK (taslak notu var).
- Efor 61 gün, ~50 model, web ayrı süreç + staging; cart.js→bagdam.js yeniden yazımı (7g) en sonda.

### konvansiyon
- **Hata — async bootstrap**: `assets/bootstrap.js` fetch + `bagdam:ready` ile \"10 sayfa × 1 satır\" iddiası; oysa inline script'ler üst düzeyde senkron PRODUCTS kullanıyor ve cart.js'in DOMContentLoaded init'i (:1214) veriden önce koşuyor (categoryFor :348, renderStepper) → boş stepper/ikon, yeniden çizim, FOUC, SEO'suz ürün/günlük. Kendi risk 4 maddesi bunu kabul ediyor. Düzeltme: senkron script (sunucu üretimli products.js) veya gömülü JSON.
- **Yanlış varsayım**: \"Cloudflare zone zaten aktif\", \"/root/cf-api.sh\" → sunucu gerçekleriyle çelişiyor (DNS yok). DOĞRULANMADI.
- Çerez banner'ı Faz 2'de; admin token localStorage (P1); api.bagdam.com ayrı origin (CORS/cookie). SubscriptionEvent yok; ProductImage medyaya bağlı değil.
- Adım 7 aşırı yoğun (motor+dunning+SMS+Shipment+admin ops+3 web sayfası = 8 gün); 40 gün iyimser.

## 3. Puanlar (1-10; risk: 10 = en az riskli)

| Öneri | completeness | ordering | server_fit | simplicity | risk | **total/50** |
|---|---|---|---|---|---|---|
| mvp-once | 8 | 9 | 9 | 9 | 7 | **42** |
| alan-dogru | 9 | 8 | 8 | 5 | 6 | **36** |
| konvansiyon | 8 | 7 | 8 | 6 | 6 | **35** |

## 4. Kazanan: **mvp-once**
Gerekçe: frontend'i en doğru okuyan ve kanıtlanabilir biçimde değiştirmeden besleyen tek öneri (senkron gömülü bootstrap, `.html` URL'leri, cart.js sıfır değişiklik, Playwright screenshot baseline), sunucu konvansiyonuna tam uyum (tek süreç :5010, same-origin cookie, deploy.sh sırası düzeltilmiş, backup/health), en sade şema (~26 model) ve en iyi faz sırası (canlı iskelet 1. hafta, donmuş şema 2. hafta, admin 14. gün). Eksikleri (politika versiyonu, DELTA tahsilat, MailLog/CronLog, iptal yasal tarihleri, ProductLot) alan-dogru/konvansiyon'dan alınan somut eklerle kapanır; toplam kapsam genişlemeden doğruluk tamamlanır.

## 5. Diğer önerilerden alınacaklar
1. [alan-dogru] LegalDocument satır-başına versiyon (slug+version, isCurrent, contentHash); Consent satır id'sine bağlanır.
2. [alan-dogru] İlk dinamik adım: sunucu üretimli `GET /assets/products.js` (senkron, sıfır HTML değişikliği) — inline bootstrap'a köprü/yedek.
3. [alan-dogru] Cycle.prepaidAmount + Payment.kind DELTA.
4. [alan-dogru] SubscriptionCancellation: effectiveAt ≤7g, confirmedAt, refundDueAt ≤15g.
5. [alan-dogru] CycleItem.source CART_MERGE.
6. [alan-dogru] Motor önce sahte provider + fake-timer 8 hafta simülasyonu + DST testleri; state machine'ler packages/shared'da.
7. [alan-dogru] Minimal ProductLot şema donmadan önce.
8. [alan-dogru] SiteContent.schema Json → şemadan üretilen admin formu.
9. [alan-dogru] \"Ödeme yükümlülüğü\" buton metni + register KVKK/pazarlama kutucukları.
10. [alan-dogru] Aynı sunucuda hafif staging (iyzico callback testi).
11. [konvansiyon] 58 kullanılan görselin MediaFile'a içe aktarımı + ProductImage→MediaFile FK; 27 kullanılmayan dosya arşive.
12. [konvansiyon] Üye için Cart(items, boxDraft) + merge (P2).
13. [konvansiyon] Producer.journalSlug.
14. [konvansiyon] MailLog/CronLog/SystemLog tabloları (UA).
15. [konvansiyon] UA sitemap modülü.

## 6. Final planda MUTLAKA düzeltilecek hatalar
- mvp-once: Policy in-place versiyon → satır-başına versiyon; DELTA tahsilat tasarımı; MailLog/CronLog/SystemLog + Post.coverMediaId ilişkisi; iptal yasal tarih alanları.
- konvansiyon: async bootstrap → senkron; Cloudflare \"zaten aktif\" varsayımı → DNS/NS/LE adımları Faz 1'e; çerez banner'ı lansman öncesine (ya da \"analitik yok\" ADR'ı); admin cookie auth + same-origin `/api`.
- alan-dogru: temiz URL ↔ cart.js sabit link/regex çelişkisi (tercihen `.html` korunur); çift FK; Tr* FK zorunluluğu ve 74k seed MVP dışı; 61 günlük kapsam P2'ye bölünür.
- Üçü de: iyzico NON3D MIT yetkisi DOĞRULANMADI → Faz 0 teyidi + B planı (3DS ödeme linki); tek kesim kuralı ve ilk-kutu indiriminin Order.total'a yansıması şema donmadan kararlaştırılır; PricingService tek doğruluk kaynağı, kutu/sepet özetleri sunucu tutarını basar.

## 7. DOĞRULANMADI / sınırlar
- iyzico webhook secret alanı ve CSP `frame-src` alan adı (mvp-once'ın da işaretlediği gibi).
- konvansiyon'un \"Cloudflare zone aktif\" ve \"/root/cf-api.sh\" iddiaları sunucu gerçeklerine göre doğrulanamadı.
- bahcedenal yasal metin taslaklarının hukuki güncelliği.
- Efor tahminleri (44/61/40 gün) tek kıdemli geliştirici varsayımıyla; doğrulanamaz, göreli karşılaştırma amaçlıdır.