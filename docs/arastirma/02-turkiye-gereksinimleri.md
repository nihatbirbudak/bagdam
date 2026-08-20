> **Türkiye'ye özgü sistem gereksinimleri (ödeme/kargo/mevzuat/iletişim/abonelik)** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 1 — ajan D). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Bağdam — Türkiye'ye Özgü Backend Gereksinimleri Araştırması (Ağustos 2026)

> Not: Aşağıdaki bilgiler 2026 tarihli web kaynaklarından derlendi; doğrulanamayan noktalar **DOĞRULANMADI** diye işaretlendi. Fiyat/komisyon bilgileri pazarlığa ve hacme göre değişir; kesinleştirmeden sağlayıcıdan teklif alınmalı.
> Frontend bağlamı: `assets/products.js` içinde `SUB_TIERS` (tek tier: `sezon`, 10 ürün, 1099 TL), `FREQ_OPTIONS` (`1hafta`, `2hafta`, `4hafta`), `DELIVERY_DAYS` (`sali`, `persembe`, `cumartesi`); `assets/cart.js` içinde `getSub()` → `{tierId, items[], skipThisWeek, skipUsed, freq, deliveryDay, type, itemPrefs{}, extras[], extrasCutoff, purchased}`, localStorage anahtarları `bahceden_cart/prefs/sub/address/card/orders/retention_offered`. **Dikkat:** cart.js'te kesim kuralı için iki farklı yorum var (satır ~1033 "2 days before, 23:59" ve satır ~1052 "locks at noon the day before") — `CUTOFF_WEEKDAY = {sali:0, persembe:2, cumartesi:4}` Pazar/Salı/Perşembe'yi gösteriyor. Backend'de tek bir kesim kuralı (zone bazlı) tanımlanmalı ve frontend ona çekilmeli.

---

## 1. Online Ödeme

### (a) Bulgular
| Sağlayıcı | Abonelik / kart saklama | Entegrasyon modeli | 3DS | Komisyon (2026, kaynaklara göre) | Webhook |
|---|---|---|---|---|---|
| **iyzico** | Abonelik ürünü (ürün → ödeme planı → abonelik; `paymentInterval` DAILY/WEEKLY/MONTHLY/YEARLY, `paymentIntervalCount`, `trialPeriodDays`, `recurrenceCount`; durumlar ACTIVE/PENDING/UNPAID/UPGRADED/CANCELED/EXPIRED; retry servisi 160 güne kadar; eklenti ilk 3 ay ücretsiz sonra **199 TL/ay**; yalnız kredi kartı). Ayrı **Kart Saklama** servisi: `cardUserKey` + `cardToken`, `/payment/auth` ile NON3D veya 3DS tahsilat, `registeredCard=1`; eklenti "99 TL" (periyot belirtilmemiş — DOĞRULANMADI). | Checkout Form: `POST /payment/iyzipos/checkoutform/initialize/auth/ecom` → `checkoutFormContent`/`paymentPageUrl` + `token`; `callbackUrl`'e token POST edilir; sonuç retrieve ile doğrulanır. Ayrıca doğrudan API. SDK: PHP/Node/Python/.NET/Go/Java. | 3DS Checkout Form içinde iyzico tarafından yürütülür; saklı kartla NON3D tahsilat mümkün (NON3D yetkisi iyzico'dan istenmeli — DOĞRULANMADI). | Yardım merkezi: kurumsal **%4,29 + 0,25 TL/işlem**, sabit ücret yok, hakediş haftalık Çarşamba; üçüncü taraf karşılaştırma siteleri %1,95–2,99 pazarlıklı oranlar yazıyor. | Panelden HTTPS URL; `X-IYZ-SIGNATURE-V3` HMAC-SHA256; 2xx alana kadar 15 dk arayla 3 deneme; abonelik olayları `subscription.order.success/failure` (`orderReferenceCode`, `subscriptionReferenceCode`, `customerReferenceCode`). |
| **PayTR** | Kart Saklama API + **Kayıtlı Karttan Tekrarlayan Ödeme** (`utoken`, `ctoken`, `recurring_payment=1`, `non_3d=1`); **mağazaya yetki tanımlanması (onay) gerekir**; sonuç doğrudan döner + Bildirim URL'ye POST. iFrame API'de `store_card`/`utoken` ile ilk ödemede kart saklama. | iFrame API (sunucu tarafı `iframe_token` → `<iframe src=https://www.paytr.com/odeme/guvenli/<token>>`), Direkt API, Link API. | İlk işlem 3DS; tekrarlayan işlemler Non3D. | %0,99'dan başlayan, hacim/sektöre göre (tek çekim %0,99–4; 12 taksit ~%3,20); kurulum/aylık ücret yok; **ertesi gün** ödeme (blokeli seçenekte daha düşük oran). | Bildirim URL (sunucu tarafı POST: `merchant_oid`, `status`, `total_amount`, `hash`); "OK" yanıtı şart. |
| **Craftgate** | PCI-DSS-1 kart saklama (`cardUserKey`/`cardToken`), tek tık ödeme, "tekrarlayan ödeme/abonelik altyapısı" pazarlama metinlerinde var; native zamanlayıcılı abonelik API'si DOĞRULANMADI (developer portal giriş istiyor). | Ödeme orkestrasyonu: kendi banka sanal POS'larını + ödeme kuruluşlarını tek API'den yönetme, en düşük komisyona yönlendirme (routing); SDK'lar var. | 3DS/non-3DS her ikisi. | Teklif bazlı; hedef kitle kurumsal/marketplace/fintech. | Var (portal). |
| **Param (ParamPOS)** | Kart saklama servisleri var (dev.param.com.tr 403 verdi — alan adları DOĞRULANMADI); mewebstudio/pos kütüphanesi Param için NonSecure/3DSecure/3DPay, iptal/iade/durum desteği listeliyor. | SOAP/WS ağırlıklı (TP_WMD_UCD, TP_WMD_Pay vb.), statik IP tanımı, 23 banka. | 3DS + non-secure. | %0,99–%11 aralığı (taksite göre), sabit ücret yok. | Var. |
| **Stripe** | — | — | — | **Türkiye merkezli şirkete hesap açmıyor** (BDDK/TCMB lisansı yok). Yalnızca yurt dışı şirket (UK/EU/US LLC) üzerinden. | — |

Kaynaklar: [iyzico Abonelik](https://docs.iyzico.com/urunler/abonelik) · [Abonelik İşlemleri](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/abonelik-islemleri) · [Ödeme Planı](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/odeme-plani) · [Kart Saklama](https://docs.iyzico.com/ek-servisler/kart-saklama) · [Webhook](https://docs.iyzico.com/ek-servisler/webhook) · [CF Başlatma](https://docs.iyzico.com/odeme-metotlari/odeme-formu/cf-entegrasyonu/cf-baslatma) · [iyzico Fiyatlandırma](https://www.iyzico.com/destek/yardim-merkezi/genel-bilgiler/fiyatlandirma) · [poskomisyon iyzico](https://poskomisyon.com/pos/iyzico-sanal/) · [PayTR Kayıtlı Kart Tekrarlayan Ödeme](https://dev.paytr.com/en/direkt-api/kart-saklama-api/kayitli-kart-tekrarlayan-odeme) · [PayTR iFrame API](https://dev.paytr.com/en/iframe-api) · [PayTR komisyon 2026](https://eticaretradari.com/odeme/paytr/) · [Craftgate vs iyzico](https://eticaretradari.com/odeme/craftgate-vs-iyzico/) · [Craftgate routing](https://craftgate.io/blog/odemeleri-en-dusuk-komisyonlu-sanal-posa-yonlendirme) · [Param API](https://dev.param.com.tr/tr/api) · [mewebstudio/pos](https://github.com/mewebstudio/pos) · [Stripe TR 2026](https://www.manaycpa.com/tr/stripe-turkiye-hesap-acma-ve-odeme-alma-rehberi-2026/) · [payments.tr Stripe](https://payments.tr/blog/stripe-turkiye-kullanilir-mi-guncel-rehber) · [3DS/tekrarlayan ödeme](https://www.paytr.com/blog/tokenizasyon-ve-kart-saklama-guvenli-odeme-deneyimi)

3DS notu: Kaynaklar "yasal zorunluluk" konusunda çelişiyor; pratikte sağlayıcılar ilk ödemeyi 3DS ile, saklı karttan tekrarlayan ödemeleri tokenizasyon şartıyla non-3D yapıyor (PayTR dokümanı bunu açıkça yazıyor). TCMB güçlü kimlik doğrulama istisnalarının tam metni DOĞRULANMADI.

### (b) Bağdam için öneri
- **MVP: iyzico Checkout Form + Kart Saklama** (sandbox, SDK, imzalı webhook, hızlı onboarding). Bağdam'ın kutusu **sabit tutarlı değil** (haftayı atla, extras, 2/4 haftalık frekans, tier değişimi, teslimat günü): iyzico'nun hazır Abonelik ürünü (sabit plan fiyatı, sabit aralık, skip yok) buna oturmuyor. Bu yüzden **"kendi abonelik motoru + saklı karttan tahsilat"** modeli: her cycle'ın kesim anında backend, o cycle'ın gerçek tutarını (`kutu + extras + kargo`) `cardUserKey/cardToken` ile tahsil eder.
- **Faz 2:** PayTR ikinci sağlayıcı (daha düşük komisyon, ertesi gün hakediş; recurring için yetki onayı alınır). Sağlayıcıyı soyutlayan `PaymentProvider` arayüzü ilk günden yazılsın. Craftgate ancak birden fazla banka POS'u/komisyon optimizasyonu gündeme gelince.
- Stripe: şirket TR'de olduğu sürece yok.

### (c) Veri modeli / API etkisi
- `payment_methods`: `id, user_id, provider(enum iyzico|paytr), provider_customer_key (cardUserKey/utoken), provider_card_token (cardToken/ctoken), bin, last4, brand, card_assoc, exp_month, exp_year, is_default, status, created_at, deleted_at`. Kart verisi **asla** bizde tutulmaz (frontend'deki `bahceden_card` localStorage'ı kaldırılmalı).
- `payments`: `id, order_id | subscription_cycle_id, provider, provider_payment_id, conversation_id (bizim idempotency anahtarı), amount, currency, status(pending|requires_3ds|succeeded|failed|refunded|partial_refunded), is_3ds, is_merchant_initiated, failure_code, failure_message, raw_response jsonb, attempt_no, created_at`.
- `payment_attempts` / dunning alanları cycle'da: `payment_status, retry_count, next_retry_at, dunning_state(none|retrying|card_update_requested|unpaid)`. Önerilen retry: kesim anı → +24s → +72s; hâlâ başarısızsa cycle `unpaid/skipped`, müşteriye kart güncelleme linki; 2 ardışık başarısız cycle → abonelik `past_due` → `paused`.
- `refunds`: `id, payment_id, amount, reason, provider_refund_id, status, created_at`.
- `webhook_events`: `id, provider, event_type, provider_ref, payload jsonb, signature_valid, received_at, processed_at, status, error` — idempotent işleme (aynı `paymentId`/`orderReferenceCode` iki kez işlenmez).
- `orders`: `payment_status, paid_at, payment_id, provider_conversation_id`.
- Uç noktalar: `POST /api/checkout/init` (sipariş + CF init → `checkoutFormContent|paymentPageUrl`), `POST /api/payments/iyzico/callback` (token → retrieve → siparişi kesinleştir), `POST /api/webhooks/iyzico` (HMAC doğrula → kuyruğa at), `GET/DELETE /api/me/cards`, `POST /api/me/cards/add` (1 TL doğrulama/iade veya ilk siparişte `registerCard`), iç servis `POST /internal/cycles/:id/charge`, `POST /internal/cycles/:id/retry`.

### (d) MVP mi?
- Kart saklama + tek sağlayıcı + webhook + retry: **MVP**. Taksit, ikinci sağlayıcı, routing: **sonra**.

---

## 2. Kargo / Teslimat

### (a) Bulgular
- **Doğrudan kargo API'leri (Aras/Yurtiçi/MNG/Sürat/PTT):** Her biri için şubeyle **kurumsal sözleşme** + web servis kullanıcı adı gerekir (Aras: esasweb.araskargo.com.tr üzerinden entegrasyon formu); her firma ayrı SOAP/REST şeması, ayrı barkod/etiket ve takip formatı.
- **Kargo aracı platformları (tek API, çoklu firma):**
  - **Geliver**: REST + OpenAPI, SDK'lar (Go/Node/Python/C#/PHP/Java); kaynaklar: adres, gönderi (`shipments.create` → teklifler), `transactions.acceptOffer` (etiketi satın al), `barcode/trackingNumber/labelURL/trackingUrl/statusCode`, webhook; 10+ firma (Aras, Yurtiçi, Sürat, PTT, HepsiJet, MNG, Kolay Gelsin); fiyat 64 TL+vergi'den başlayan plan veya kendi anlaşmanla gönderi başı 1 TL; test modunda her GET durumu bir adım ilerletir.
  - **Basit Kargo**: REST (`POST /v2/order`, `/v2/order/barcode`, `GET /label/svg/{id}`, fiyat hesaplama, webhook NEW→SHIPPED→DELIVERED), 120 istek/dk; firmalar PTT/MNG/Yurtiçi/Aras/Sürat/HepsiJET/KolayGelsin + `ECONOMIC/FAST` yönlendirme + kendi anlaşman (`SELF_`).
  - Diğer: Kargonomi, Kargo Entegratör. **"Kargom Sende"**: alan adına ulaşılamadı, API dokümanı bulunamadı — **DOĞRULANMADI**.
- **Taze ürün/soğuk zincir:** Kargo firmaları yaş sebze-meyve, yumurta, süt/yoğurt gibi riskli ürünleri standart kargoyla taşımıyor (tarlaburada.com teslimat sayfası: "riskli ürünler kargo ile gönderilememektedir"; Aras soğuk şikayetleri). Yurtiçi Kargo'nun "soğuk zincir" ürünü var ama kapsam/fiyat DOĞRULANMADI. HepsiJet İzmir dahil 5 ilde aynı gün/ertesi gün (09:00–23:00) ve randevulu teslimat sunuyor; fiyat 0–2 desi 78,50 TL+KDV (02.01.2026). Tazedirekt (Migros) İzmir'de Urla/Güzelbahçe/Çeşme dahil ilçelere haftanın belirli günlerinde kendi dağıtımıyla gidiyor; 1.750 TL üstü ücretsiz teslimat; min. sepet bölgeye göre.
- Kaynaklar: [Geliver Kargo API](https://geliver.io/kargo-api) · [geliver-js SDK](https://github.com/geliverapp/geliver-js) · [Geliver entegrasyon](https://geliver.io/entegrasyon) · [Basit Kargo API](https://basitkargo.com/api) · [Kargonomi API](https://www.kargonomi.com.tr/help-category/api-dokumantasyonu/) · [Kargo Entegratör](https://kargoentegrator.com/kargo-api/) · [Aras entegrasyon (Dijiworks)](https://www.dijiworks.com.tr/entegrasyonlar/aras-kargo-entegrasyonu) · [Aras (ideasoft)](https://www.ideasoft.com.tr/yardim/aras-kargo-entegrasyonu/) · [HepsiJet entegrasyon](https://www.dijiworks.com.tr/entegrasyonlar/hepsijet-entegrasyon) · [HepsiJet fiyat 2026](https://www.dopigo.com/hepsijet-kargo-fiyatlari-nedir/) · [Tazedirekt teslimat bölgeleri](https://www.tazedirekt.com/teslimat-bolgelerimiz-ve-saatlerimiz) · [tarlaburada teslimat](https://www.tarlaburada.com/sayfa/www-tarlaburada-com-2) · [Kolay Gelsin (Yengeç)](https://yengec.co/blog/kolay-gelsin-kargo-gonderim-hizmetleri/)

### (b) Bağdam için öneri
- **Kutu aboneliği (taze/soğuk zincir): kendi kurye / elden teslim**, tanımlı **bölge + gün + kesim** ile (Urla, Çeşme, Güzelbahçe, Seferihisar, Karşıyaka/Bornova/Konak… gibi İzmir ilçeleri). Frontend'deki Salı/Perşembe/Cumartesi günleri ve `deliveryDay` buna uyuyor. Soğuk paket (buz aküsü/strafor) ve teslim kanıtı (foto/imza) süreçte.
- **Tekil kuru ürünler (zeytinyağı, sabun, reçel vb.) şehir dışına: kargo aracı platformu** (Geliver veya Basit Kargo) ile tek entegrasyon; MVP'de etiket/takip yeterli, fiyat karşılaştırma bonus.
- **Toptan (toptan.html):** ayrı akış; teslimat manuel planlanır, veri modelinde `shipment.method = 'wholesale_delivery'`.

### (c) Veri modeli / API etkisi
- `delivery_zones`: `id, name, type(courier|cargo|pickup), city, districts[] (ilçe/mahalle listesi), delivery_days[] (sali|persembe|cumartesi), cutoff_rule {offset_days, time}` (**tek kaynak**; frontend'in iki farklı kesim yorumu buradan beslenmeli), `fee, free_threshold, min_order, cold_chain bool, active`.
- `addresses`: `il, ilce, mahalle, acik_adres, bina_no, daire, tarif, lat, lng, phone, zone_id` (zone çözümleme endpoint'i: `GET /api/delivery/zones/resolve?ilce=&mahalle=`).
- `shipments`: `id, order_id | subscription_cycle_id, method(courier|cargo|pickup), carrier_code, provider(geliver|basitkargo|direct|none), provider_shipment_id, barcode, tracking_number, tracking_url, label_url, status(planned|packed|out_for_delivery|delivered|failed|returned), scheduled_date, slot, desi, weight, package_count, cold_pack bool, shipped_at, delivered_at, proof_url, failure_reason`.
- `shipment_events`: `shipment_id, status, occurred_at, location, raw jsonb` (webhook'tan).
- Kendi kurye için: `courier_routes (date, courier_user_id)`, `route_stops (route_id, shipment_id, sequence, eta, status)`; MVP'de "gün sonu teslimat listesi CSV/PDF" yeterli.
- Uç noktalar: `POST /internal/shipments/:id/create-label`, `POST /api/webhooks/geliver`, `GET /api/orders/:id/tracking`, `PATCH /internal/shipments/:id/status` (kurye uygulaması/panel).

### (d) MVP mi?
- Bölge/gün/kesim + kurye teslimat durumu + SMS: **MVP**. Kargo aracı API entegrasyonu: **MVP-lite** (başta panelden manuel etiket de olabilir), webhook takibi **sonra**. Rota optimizasyonu: **sonra**.

---

## 3. Fatura / Mevzuat

### (a) Bulgular
**e-Fatura / e-Arşiv (2026):**
- Genel eşik: brüt satış hasılatı **3 milyon TL** (izleyen yılın 1 Temmuz'una kadar geçiş). **E-ticaret (internet satışı) için eşik 500.000 TL** (2022 ve sonrası). e-Arşiv'de **parasal sınır 1 Ocak 2026'dan itibaren genel kural olarak kaldırıldı** (e-Fatura mükellefi olmayan alıcıya tutar fark etmeksizin e-Arşiv); basit usul/işletme hesabı mükellefleri 31.12.2026'ya kadar vergiler dahil 3.000 TL'ye kadar kâğıt fatura kesebilir.
- GİB e-Arşiv Portalı **ücretsiz**, başvurusuz; ama **resmi API yok**, elle giriş (entegratörler GİB kullanıcı bilgisiyle "portal entegrasyonu" sunuyor).
- İnternet satışı faturasında **zorunlu ek alanlar**: satışın yapıldığı web adresi, ödeme şekli ve ödeme tarihi, gönderiyi taşıyan (kargo) ve gönderim tarihi, "Bu satış internet üzerinden yapılmıştır" ibaresi; faturanın kâğıt çıktısı gönderiyle birlikte irsaliye yerine geçer; tüketiciye elektronik teslim serbest.
- Entegratörler: Paraşüt (~150 TL/ay'dan, fatura başı ~4 TL; API: `sales_invoices` → `e_archives`), BirFatura (ücretsiz plan, 1 TL/kontör, API), Logo İşbaşı (463 TL/yıl'dan), Mukellef, Uyumsoft/EDM/Foriba (teklif bazlı). Nilvera'nın bir pazaryeri entegrasyonu "pasif" olarak işaretlenmiş (Nilvera genel olarak aktif; DOĞRULANMADI). Kontör aralığı 1–5 TL/fatura.
- Kaynaklar: [GİB e-Arşiv hakkında](https://ebelge.gib.gov.tr/earsivhakkinda.html) · [Paraşüt e-Arşiv limitleri 2026](https://www.parasut.com/blog/e-arsiv-fatura-limitleri) · [Paraşüt zorunluluk 2026](https://www.parasut.com/blog/e-fatura-ve-e-arsiv-zorunlulugu) · [KolayBi GİB portal](https://www.kolaybi.com/blog/gib-portal-uzerinden-e-arsiv-fatura-nasil-kesilir) · [Yengeç GİB portal API yok](https://yengec.co/blog/gib-e-arsiv-portal/) · [e-Fatura program karşılaştırma 2026](https://eticaretradari.com/e-fatura/) · [Paraşüt API EArchives](https://apidocs.parasut.com/#tag/EArchives) · [VUK 509 Tebliğ](https://www.asmmmo.org.tr/userfiles/others/files/Mvzt/Gh/24/12-08-Vergi%20Usul%20Kanunu%20Genel%20Tebli%C4%9Fi%20(S%C4%B1ra%20No%20509).pdf)

**Mesafeli Sözleşmeler Yönetmeliği:**
- Md.5 ön bilgilendirme zorunlu unsurları: malın temel nitelikleri; satıcı kimliği/iletişim (MERSİS/VKN, adres, tel, e-posta); toplam fiyat (vergiler dahil), ek masraflar; ödeme, teslimat, ifa bilgileri ve taahhütler; cayma hakkının şartları/süresi/usulü ve iade taşıyıcısı; cayma hakkının bulunmadığı haller; şikâyet/çözüm yolları (tüketici hakem heyeti/mahkeme). Md.7: tüketicinin ön bilgileri edindiğini **teyit etmesi** sağlanır; Md.8: sipariş butonunda "**ödeme yükümlülüğü**" ifadesi; Md.9: 14 gün cayma; **Md.15: "çabuk bozulabilen veya son kullanma tarihi geçebilecek malların teslimine ilişkin sözleşmeler"de cayma hakkı yok** (taze gıda kutusu için kritik; zeytinyağı/sabun gibi dayanıklı ürünlerde cayma hakkı **vardır**); Md.16: en geç 30 gün teslim; **Md.20: kayıtlar 3 yıl saklanır**.
- **Abonelik Sözleşmeleri Yönetmeliği** (6502 md.52): "belirli aralıklarla mal temini" abonelik sözleşmesidir; elektrik/su/gaz/telekom dışı aboneliklere yalnız **md.5,6,7,8,13,22–25** uygulanır: sözleşme yazılı/kalıcı veri saklayıcısında ve bir örneği tüketiciye verilir (md.5, min 12 punto); zorunlu içerik (taraflar, konu, süre, bedel, ödeme, fesih şartları…) (md.6); belirsiz süreli/1 yıldan uzun sözleşmeyi tüketici gerekçesiz feshedebilir (md.22); **fesih bildirimi kâğıt veya kalıcı veri saklayıcısıyla yapılabilir, sözleşme kurma yönteminden ağır olamaz** (md.23); **fesih 7 gün içinde işlenir** (md.24); **yazılı teyit + kalan bedel 15 günde iade** (md.25); otomatik uzama hükmü konulamaz (md.13).
- Kaynaklar: [Mesafeli Sözleşmeler Yönetmeliği (Lexpera)](https://www.lexpera.com.tr/mevzuat/yonetmelikler/mesafeli-sozlesmeler-yonetmeligi) · [mevzuat.gov.tr PDF](https://mevzuat.gov.tr/File/GeneratePdf?mevzuatNo=20237&mevzuatTur=KurumVeKurulusYonetmeligi&mevzuatTertip=5) · [Paraşüt ön bilgilendirme](https://www.parasut.com/blog/on-bilgilendirme-formu-mesafeli-satis-sozlesmesi) · [Abonelik Sözleşmeleri Yönetmeliği (Lexpera)](https://www.lexpera.com.tr/mevzuat/yonetmelikler/abonelik-sozlesmeleri-yonetmeligi-1) · [Erdem&Erdem abonelik fesih](https://www.erdem-erdem.av.tr/bilgi-bankasi/abonelik-sozlesmelerinin-sona-erdirilmesi)

**KVKK / çerez / VERBİS:**
- Aydınlatma her işleme için zorunlu; açık rıza ayrı kutucuk (aydınlatma+rıza tek metin olamaz). Kurul 2022/1358 kararı: çerez aydınlatma/açık rıza sunmamak ihlal; Çerez Rehberi (Aralık 2022): zorunlu çerezler rıza gerektirmez, analitik/reklam çerezleri **opt-in**; rıza kayıtları tutulmalı. VERBİS: ana faaliyeti özel nitelikli veri olmayanlar için **<50 çalışan ve <100 milyon TL bilanço** ise muaf (kümülatif); muafiyet KVKK'dan muafiyet değildir (envanter, aydınlatma, veri güvenliği, başvuru yönetimi sürer).
- Kaynaklar: [KVKK Karar 2022/1358](https://www.kvkk.gov.tr/Icerik/7595/2022-1358) · [Çerez Rehberi özeti (Esenyel)](https://www.esenyelpartners.com/tr/kvkk-cerez-rehberi-uyarinca-web-siteleri-icin-uyum-yol-haritasi/) · [KVKK aydınlatma 2026](https://bilalalyar.av.tr/kvkk-aydinlatma-rehberi-2026/) · [VERBİS istisnaları 2026](https://www.mondaq.com/turkey/data-protection/1736820/) · [Regulfy VERBİS](https://regulfy.com/blog/verbis-kayit-yukumlulugu-rehberi-2026/)

**ETBİS:** Kendi sitesinden satış yapan her işletme kayıt olmak zorunda; eticaret.gov.tr'den MERSİS/VKN + e-Devlet ile ücretsiz; KEP adresi gerekli; 2026'da ETBİS karekod uygulaması kaldırıldı; ceza 20–50 bin TL (2025). Kaynak: [Workon ETBİS 2026](https://workon.com.tr/blog/etbis-kayit-nasil-yapilir/) · [Karadağ Av. ETBİS](https://www.karadagavukatlik.av.tr/e-ticaret-siteleri-icin-etbis-sistemine-kayit-zorunlulugu/)

**İYS / ticari elektronik ileti:** SMS/e-posta/arama ile pazarlama yapan her işletme (büyüklük fark etmeksizin) İYS'ye kayıt olur (MERSİS, e-imza, 1–3 iş günü onay). Onaylar alındıktan **3 iş günü içinde** İYS'ye işlenir; İYS dışı alınan onayın ispat yükü hizmet sağlayıcıda. **Sipariş onayı, kargo/teslimat bildirimi, OTP, fatura bilgisi gibi işlemsel iletiler izin gerektirmez** — içine promosyon eklenirse ticari sayılır. Onay kaynağı kodları (HS_WEB, HS_MESAJ…); her gönderim öncesi İYS kontrolü (`iys=1`). Ceza 2026: ileti başına ~14.300 TL'ye, toplu gönderimde 143.000 TL'ye kadar. Kaynaklar: [İleti Merkezi İYS rehberi](https://www.iletimerkezi.com/docs/guides/iys-rehberi) · [Cenuta 6563/İYS 2026](https://www.cenuta.com/blog/6563-sayili-kanun-ve-iys-nedir-ticari-elektronik-ileti-yukumlulukleri-ve-ceza-rehberi-2026/) · [Mysoft izinsiz gönderilebilen iletiler](https://iletiyonetimi.com/iysde-izinsiz-gonderilebilen-iletiler-ve-yasal-duzenlemeler) · [BTS Legal SSS](https://www.bts-legal.com/insights/publications/hizmet-saglayicilar-icin-ticari-elektronik-ileti-yonetim-sistemi-kayit-yukumlulugu-hakkinda-sikca-sorulan-sorular/)

**Gıda satışına özgü (ek):** İnternetten gıda satan işletme Tarım ve Orman Bakanlığı'ndan **İşletme Kayıt Belgesi** almalı (5996 sayılı Kanun; e-Devlet üzerinden). Türk Gıda Kodeksi Etiketleme Yönetmeliği: uzaktan satışta zorunlu etiket bilgileri (isim, içindekiler, alerjen, net miktar, TETT/SKT hariç, üretici…) **satın alma sonuçlanmadan önce** sitede sunulmalı. GEKAP: e-ticaret koli/poşet ambalajı "piyasaya sürülen ambalaj" sayılır; beyan (boş da olsa) yükümlülüğü mali müşavirle netleştirilmeli. Kaynaklar: [turkiye.gov.tr İşletme Kayıt Belgesi](https://www.turkiye.gov.tr/gida-tarbil-isletme-kayit-belgesi) · [Hijyen Akademi e-ticaret gıda](https://hijyenakademi.net/blog/evden-gida-satisi-e-ticaret-hijyen-belgesi-zorunlulugu) · [TGK Etiketleme (Lexpera)](https://www.lexpera.com.tr/mevzuat/yonetmelikler/turk-gida-kodeksi-gida-etiketleme-ve-tuketicileri-bilgilendirme-yonetmeligi) · [ÇŞB GEKAP SSS](https://csb.gov.tr/sss-detay/1655)

### (b) Bağdam için öneri
- Fatura: başlangıçta (ciro < 500k TL e-ticaret eşiği) **GİB e-Arşiv portalı elle** veya düşük maliyetli entegratör (**BirFatura** ücretsiz plan/1 TL kontör ya da **Paraşüt** API); sipariş → fatura otomasyonu Faz 2. Sipariş şemasına fatura alanları **MVP'de** konmalı.
- Hukuki metinler (politikalar.html `data-policy` sekmeleri): Ön Bilgilendirme Formu, Mesafeli Satış Sözleşmesi, **Abonelik Sözleşmesi** (ayrı), KVKK Aydınlatma, Açık Rıza (pazarlama), Çerez Politikası, İptal/İade (gıda cayma istisnası açıkça) — **versiyonlu** tutulsun; sipariş/abonelik onayında hangi versiyonun kabul edildiği kaydedilsin; kopyası e-posta ile gönderilsin (kalıcı veri saklayıcısı).
- İptal akışı (uyelik.html retention akışı): fesih talebi **tek tık** (sözleşme kurmaktan zor olamaz), 7 gün içinde işleme, yazılı teyit, varsa iade 15 gün.

### (c) Veri modeli / API etkisi
- `legal_documents`: `id, type(preinfo|distance_contract|subscription_contract|kvkk_notice|consent_marketing|cookie_policy|return_policy), version, content_html, effective_from, hash`.
- `consents`: `id, user_id | guest_key, type(kvkk_notice_ack|marketing_sms|marketing_email|marketing_call|cookie_analytics|cookie_marketing|preinfo_ack|contract_ack|subscription_contract_ack), document_version_id, granted bool, granted_at, revoked_at, source('HS_WEB'), ip, user_agent, iys_status(pending|synced|failed), iys_synced_at, iys_ref`.
- `orders`: `preinfo_version_id, contract_version_id, accepted_at, accepted_ip, contract_pdf_url, confirmation_email_sent_at, billing_type(individual|corporate), billing_name, tckn (opsiyonel), vkn, tax_office, billing_address_id, invoice_id`.
- `invoices`: `id, order_id, kind(e_arsiv|e_fatura), provider(gib_portal|birfatura|parasut), provider_invoice_id, ettn, number, issued_at, total, vat_total, pdf_url, status, internet_sale {web_address, payment_method, payment_date, carrier_name, shipped_at}, sent_to_customer_at`; `invoice_lines: product_id, name, qty, unit, unit_price, vat_rate, lot_code`.
- `subscription_cancellations`: `subscription_id, requested_at, channel, reason (uyelik.html data-reason seçenekleri), retention_offer_shown, effective_at (≤7 gün), confirmed_at, refund_amount, refund_due_at (≤15 gün)`.
- `cookie_consents`: `anon_id, categories jsonb, policy_version, ts, ip`.
- Saklama politikası: sipariş/sözleşme kayıtları ≥3 yıl (Mesafeli md.20), fatura VUK 5 yıl, TTK 10 yıl ticari defter (son ikisi mali müşavirle teyit — DOĞRULANMADI); silme talepleri (KVKK) için soft-delete + anonimleştirme.
- Uç noktalar: `GET /api/legal/:type/current`, `POST /api/consents`, `POST /api/subscriptions/:id/cancel`, `POST /internal/invoices/:order_id/issue`, `GET /api/orders/:id/invoice.pdf`.

### (d) MVP mi?
- Onay/sözleşme versiyonlama, fatura alanları, gıda cayma istisnası metni, ETBİS/İşletme Kayıt Belgesi/İYS kaydı (operasyonel): **MVP**. Otomatik e-Arşiv kesimi, İYS API senkronu, çerez yönetim platformu (Cooqee/Cerezgo vb.): **sonra** (MVP'de basit kendi banner'ı + kayıt yeter).

---

## 4. İletişim (SMS / e-posta / WhatsApp)

### (a) Bulgular
- **Netgsm**: OTP SMS yalnız API ile, 3–4 sn teslim; 1.000 OTP 316 TL, 5.000 → 1.203 TL, 10.000 → 1.999 TL (KDV/ÖİV dahil); REST v2 (`msgheader`, `messages[{msg,no}]`, `iysfilter`), resmi Node/Python SDK; olgun ekosistem. **İleti Merkezi**: 1.000 SMS 359 TL (0,359 TL), 10.000 → 1.599 TL (0,16 TL), 100.000 → 14.499 TL; OTP API, İYS entegrasyonu (`iys-register`, `iys-check`, `send-sms iys=1`). **Verimor**: OTP aynı paket fiyatından; fiyat sayfası erişilemedi (403) — DOĞRULANMADI. Başlık (sender ID) tahsisi gerekir (3–11 karakter).
- **E-posta**: Resend ücretsiz 3.000/ay (100/gün, 1 domain), Pro $20/ay 50.000; Amazon SES $0,10/1.000 (yeni hesaplarda $200 kredi); SMTP + DKIM/SPF/DMARC şart.
- **WhatsApp Business Platform** (Cloud API veya BSP üzerinden): 1 Temmuz 2025'ten beri mesaj bazlı ücret; Türkiye: Marketing $0,0109, **Utility $0,0009, Authentication $0,0009**; servis penceresi (24 s) içinde utility şablonları ücretsiz; şablon onayı gerekir.
- Kaynaklar: [Netgsm OTP](https://www.netgsm.com.tr/sms/otp-sms) · [netgsm-sms-python](https://github.com/netgsm/netgsm-sms-python) · [@netgsm/sms npm](https://www.npmjs.com/package/@netgsm/sms) · [İleti Merkezi fiyat](https://www.iletimerkezi.com/toplu-sms-fiyatlari) · [Netgsm vs İleti Merkezi](https://saasmetre.com/karsilastirma/netgsm-vs-ileti-merkezi) · [Verimor OTP](https://www.verimor.com.tr/otp-one-time-password-sms/) · [Resend fiyat 2026](https://nuntly.com/resend-pricing) · [SES fiyat 2026](https://www.emailplatformreview.com/blog/amazon-ses-pricing-official-2026/) · [WhatsApp API TR fiyat (VatanSMS)](https://www.vatansms.com/whatsapp/business-api-fiyatlar/) · [Meta WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing)

### (b) Bağdam için öneri
- **MVP:** e-posta (Resend ya da SES; sipariş onayı + sözleşme kopyası + fatura) ve **SMS** (Netgsm veya İleti Merkezi; OTP girişi, "yarın kesim" hatırlatması, "kutun yola çıktı/teslim edildi"). Telefon + OTP ile giriş, TR e-ticaret alışkanlığına uygun ve şifre yönetimini kaldırır.
- **Faz 2:** WhatsApp utility şablonları (teslimat günü bildirimi, kart güncelleme linki) — ucuz ama şablon onayı/BSP seçimi zaman alır.
- Pazarlama iletileri ancak İYS onayı + İYS ön kontrolü ile; transactional şablonlara asla promosyon eklenmez.

### (c) Veri modeli / API etkisi
- `notification_templates`: `key, channel(sms|email|whatsapp), category(transactional|marketing), body, locale, provider_template_id`.
- `notifications`: `id, user_id, channel, template_key, category, payload jsonb, provider, provider_msg_id, status(queued|sent|delivered|failed), sent_at, delivered_at, error, related(order_id|cycle_id)`.
- `notification_preferences`: `user_id, channel, marketing_opt_in (İYS'ye bağlı), transactional her zaman açık, quiet_hours`.
- `otp_codes`: `phone, code_hash, purpose(login|phone_verify|card_update), expires_at, attempts, consumed_at`; rate limit.
- Zamanlayıcı olayları: `cycle.cutoff_reminder (kesimden 24 s önce)`, `cycle.charged`, `cycle.payment_failed`, `shipment.out_for_delivery`, `shipment.delivered`, `subscription.cancel_confirmed`.
- Uç noktalar: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`, `POST /api/webhooks/sms-dlr`, iç kuyruk `notifications.enqueue`.

### (d) MVP mi? E-posta + SMS + OTP: **MVP**. WhatsApp, İYS API senkronu, pazarlama gönderimi: **sonra**.

---

## 5. Abonelik Kutusu Alan Modeli

### (a) Bulgular
- Best practice (Kanopy/Dodo): 4 çekirdek varlık **Subscriber, Subscription (plan, interval, status active/paused/canceled/past_due, cycle no, next renewal), SubscriptionCycle (tek dönem: ödeme + kutu içeriği + gönderi), Plan**; skip = tek dönemi ücretsiz/gönderimsiz atla, pause = yenileme tarihini dondur (öneri en fazla 90 gün), cancel = sonlandır; başarısız ödeme için 24 s → e-posta/kart güncelleme → 72 s → 7 gün uyarı → 14 gün iptal; envanter üç durum (available/allocated/shipped); toplama listeleri ürün bazında; self-servis portal (swap, pause, tier değişimi) churn'ü yarıya indiriyor; iptal nedeni 5–7 seçenek.
- TR örnekleri: Tazedirekt (Migros) — bölge/gün bazlı dağıtım, 1.750 TL üstü ücretsiz, yiyecek-içecek düzenli teslimatında iade/değişim yok; Bahçeden Al (sebze/meyve kutusu, site yenileniyor), Büyükannem (haftalık sebze paketi), Topluluk Destekli Tarım (gidatopluluklari.org: haftalık sabit ağırlık/adet kutu, üreticiye düzenli gelir). Kesim saati bilgileri bu sitelerde açık değil (DOĞRULANMADI).
- Kaynaklar: [Kanopy subscription box platform](https://kanopylabs.com/blog/how-to-build-a-subscription-box-ecommerce-platform) · [Dodo subscription box billing](https://dodopayments.com/blogs/subscription-box-billing) · [Rework pause/skip](https://resources.rework.com/libraries/ecommerce-growth/subscription-pause-skip) · [Tazedirekt teslimat](https://www.tazedirekt.com/teslimat-bolgelerimiz-ve-saatlerimiz) · [Bahçeden Al sebze kutusu](https://bahcedenal.com.tr/sebze-kutusu) · [Büyükannem haftalık paket](https://buyukannem.com/urun-etiketi/haftalik-sebze-paketi/) · [Gıda Toplulukları TDT](https://gidatopluluklari.org/?page_id=96)

### (b) Bağdam için öneri
- Frontend modeliyle uyumlu, **cycle-merkezli** motor: abonelik = kural seti (tier, frekans 1/2/4 hafta, teslimat günü, adres, kart, tercihler); her teslimat = `subscription_cycle` (kesimde kilitlenir → tahsil → paketlenir → teslim). Haftayı atla ve extras cycle seviyesinde; swap'lar cycle_items'ta. Haftalık "bu haftanın kutusu" şablonu ops tarafından kurulur; kesimde şablon + kullanıcı değişiklikleri **snapshot**'lanır (fiyat ve lot dahil).
- Kesim: tek kural (ör. teslimat gününden 1 gün önce 12:00 — frontend yorumlarındaki çelişki giderilmeli), kesim sonrası düzenleme yok, tahsilat kesimde.
- Lot/parti: `PRODUCTS.batch` → `product_lots`; cycle_items lot'a bağlanır → kutu etiketinde parti kodu ve üretici (gunluk.html anchor'larıyla izlenebilirlik).
- Üretim planı: kesim sonrası "teslimat günü × ürün × adet" özeti → üreticiye sipariş (`producer_orders`).

### (c) Veri modeli / API etkisi
- `plans` (tier): `code('sezon'), name, item_count, base_price, active, sort` (SUB_TIERS ile eş).
- `subscriptions`: `id, user_id, plan_id, frequency_weeks(1|2|4), delivery_day(sali|persembe|cumartesi), zone_id, address_id, payment_method_id, status(pending_payment|active|paused|past_due|cancel_requested|cancelled), started_at, paused_until, next_delivery_date, next_cutoff_at, prefs jsonb (itemPrefs/pref axes), skips_allowed_per_period, skips_used, cancel_reason, cancelled_at, contract_version_id`.
- `subscription_cycles`: `id, subscription_id, cycle_no, delivery_date, cutoff_at, status(scheduled|locked|skipped|paid|unpaid|packed|out_for_delivery|delivered|failed|cancelled), box_price, extras_total, shipping_fee, discount, total, payment_id, shipment_id, order_id, locked_at, skipped_at, skip_source(user|ops|unpaid)`.
- `cycle_items`: `cycle_id, product_id, lot_id, qty, unit, unit_price, source(template|swap|extra), swap_of_product_id, pref_value` (extras = `source=extra`; frontend'deki `factor` → qty/unit).
- `box_templates`: `id, plan_id, week_start, delivery_day?, notes`; `box_template_items: template_id, product_id, qty, unit, lot_id?, is_substitutable`.
- `product_lots`: `id, product_id, producer_id, lot_code, harvest_date, best_before, qty_available, qty_allocated, qty_shipped`.
- `producers`: `id, name, village, district, story, gunluk_anchor` (meta "Üretici · Köy · Urla" buradan).
- `producer_orders`: `id, producer_id, delivery_date, status`; `producer_order_items: product_id, qty, unit`.
- `subscription_events` (audit): `subscription_id, cycle_id?, type(created|tier_changed|freq_changed|day_changed|skip|unskip|swap|extra_added|paused|resumed|cancel_requested|cancelled|payment_failed|retry|card_updated), actor(user|system|ops), data jsonb, ts`.
- `packing_lists` / `pick_lists` türetilmiş görünümler (ürün bazlı toplam; cycle bazlı paket fişi, kutu etiketi QR → sipariş+lot).
- Uç noktalar: `GET/POST /api/subscriptions`, `PATCH /api/subscriptions/:id` (tier/freq/day/address/card), `POST /api/subscriptions/:id/skip` (cycle_id), `POST /api/subscriptions/:id/pause`, `/resume`, `/cancel`; `GET /api/cycles/:id`, `POST /api/cycles/:id/items/swap`, `POST /api/cycles/:id/extras`; iç: `POST /internal/cycles/generate (haftalık)`, `POST /internal/cycles/:id/lock`, `/charge`, `GET /internal/ops/pick-list?date=`.

### (d) MVP mi? Plan/cycle/skip/extras/swap/kesim/tahsil/lot snapshot: **MVP**. Pause, hediye abonelik, öneri algoritması, üretici portalı: **sonra**.

---

## 6. Hosting / DNS (Cloudflare)

### (a) Bulgular
- Ücretsiz plan: sınırsız bant genişliği, CDN, DDoS, Universal SSL, **Free Managed WAF ruleset** (alt küme) + az sayıda özel kural (Pro'da 20, Free'de 5 — üçüncü taraf kaynak), edge cache TTL kuralla min. 2 saat, tek haneli cache/redirect/config kuralı; DNS 1.000 kayıt/zone; Workers 100k istek/gün, Pages 500 build/ay, R2 10 GB, D1 5 GB, KV 100k okuma/gün. 
- Kaynaklar: [Cloudflare full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) · [Cloudflare Free plan](https://www.cloudflare.com/plans/free/) · [Free limits checklist 2026 (Easton)](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/) · [Free vs Pro 2026](https://softwaresynced.com/vs/cloudflare-free-vs-pro-is-the-upgrade-worth-it-in-2026/) · [costbench free plan](https://costbench.com/software/cdn-edge/cloudflare/free-plan/)

### (b) Öneri + bagdam.com DNS kesim adımları (kısa)
1. Cloudflare'de "Add a domain" → bagdam.com (Free). 2. Mevcut DNS kayıtlarını gözden geçir (apex A/AAAA, `www` CNAME, MX/SPF/DKIM/DMARC — e-posta kayıtları **DNS only**). 3. Registrar'da DNSSEC açıksa **önce kapat**. 4. Registrar'da nameserver'ları Cloudflare'in verdiği iki NS ile değiştir. 5. Yayılmayı (≤24 s) `dig NS bagdam.com` ile doğrula; zone "Active" olunca DNSSEC'i Cloudflare'den aç. 6. SSL/TLS "Full (strict)", HSTS, "Always HTTPS"; origin IP'yi gizle (sadece Cloudflare IP'lerinden gelen trafiğe izin). 7. **Webhook yolları** (`/api/webhooks/*`) için WAF/Bot Fight challenge'ı kapatan özel kural (sağlayıcı çağrıları engellenmesin); `/api/*` cache bypass. 8. Statik dosyalar (assets) cache; `?sifirla` gibi parametreli sayfalar cache dışı.

### (c) Veri modeli etkisi: yok; yalnız `webhook_events.signature_valid` + IP/HMAC doğrulaması ve rate-limit'lerin Cloudflare arkasında `CF-Connecting-IP` ile çalışması.
### (d) **MVP** (go-live öncesi).

---

## Faz Sıralamasına Etkisi (hangi karar hangi adımdan ÖNCE)
1. **Şirket/operasyon ön koşulları (kodsuz, erken):** şirket + MERSİS/KEP → ETBİS kaydı; Tarım Bakanlığı İşletme Kayıt Belgesi; İYS kaydı; VERBİS muafiyet tespiti; mali müşavirle e-Arşiv yolu (portal vs entegratör) ve GEKAP.
2. **Ödeme sağlayıcısı kararı (iyzico) → sipariş/abonelik şemasından ÖNCE:** `payment_methods` token alanları, `conversation_id` idempotency, 3DS callback akışı, `webhook_events`, retry/dunning durumları şemaya bu karara göre girer.
3. **Teslimat modeli (kendi kurye bölgeleri + günler + kesim kuralı; şehir dışı için kargo aracı) → `subscription_cycles` ve checkout'tan ÖNCE:** adres → zone → uygun gün/ücret/kesim hesaplaması checkout ve cycle üretiminin girdisi. Frontend'deki çelişkili kesim kuralı burada tek tipleştirilir.
4. **Hukuki metinler + onay versiyonlama → checkout ve abonelik oluşturma uç noktalarından ÖNCE:** `legal_documents`/`consents`, sipariş butonunda "ödeme yükümlülüğü", e-posta ile sözleşme kopyası, gıda cayma istisnası.
5. **Abonelik motoru (plan/cycle/skip/extras/lot snapshot) → kurye/paketleme ekranlarından ÖNCE:** pick-list ve üretici siparişleri cycle verisinden türetilir.
6. **Bildirim altyapısı (e-posta + SMS/OTP) → abonelik yaşam döngüsü olayları tanımlandıktan SONRA, go-live'dan ÖNCE;** transactional/marketing ayrımı ve İYS alanları şemada baştan.
7. **Fatura entegratörü (BirFatura/Paraşüt) → siparişler oluştuktan SONRA** (Faz 2), ama `orders` içindeki fatura alanları (bireysel/kurumsal, VKN/vergi dairesi, internet satış bilgileri) MVP'de.
8. **Cloudflare DNS kesimi → go-live'dan ÖNCE;** webhook yollarına WAF istisnası sağlayıcı entegrasyon testinden önce yapılmalı.
9. **Sonra:** PayTR ikinci sağlayıcı/routing, WhatsApp utility, pause, kargo webhook takibi, çerez yönetim platformu, İYS API senkronu, rota optimizasyonu.