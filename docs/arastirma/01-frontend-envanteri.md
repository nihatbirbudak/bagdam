> **Bağdam frontend envanteri** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 1 — ajan A). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Bağdam Statik Frontend — Eksiksiz Envanter

Kaynak kök: `<Projeler>/www.bagdam.com/website/`
Okunan dosyalar (tamamı, satır satır): `index.html` (466), `urunler.html` (257), `urun.html` (237), `kutu.html` (642), `sepet.html` (704), `uyelik.html` (612), `gunluk.html` (132), `toptan.html` (120), `politikalar.html` (274), `nasil-seciyoruz.html` (187), `unused/abonelik.html` (271), `unused/secki.html` (222), `assets/products.js` (389), `assets/cart.js` (1235). `styles.css` (1685 satır, 580 KB — içinde base64 gömülü IBM Plex Mono ttf var) yalnızca grep'lendi. Ayrıca `.port` (8080), `server.log` (npm uyarıları), `assets/fonts/manifest.json`.

Aşağıda **STATİK** = sabit tasarım/metin (koda gömülü kalabilir), **İÇERİK** = admin'den düzenlenmesi gereken metin/görsel (CMS), **VERİ** = DB'den gelmeli (liste/kayıt), **DAVRANIŞ** = form/sepet/hesap/iş mantığı.

---

## 1. Sayfa envanteri

### 1.0 Tüm sayfalarda ortak bloklar

| Blok | Sınıf | Sayfalar | Sınıf. | Not / kaynak |
|---|---|---|---|---|
| Header nav | `.nav` → burger (`assets/icons/hamburger-kapali.png`/`-acik.png`), logo (`assets/logo/logo-horizontal.svg`), linkler: `tüm ürünler` → urunler.html, `blog` → gunluk.html, `toptan` → toptan.html, `nasıl seçiyoruz` → nasil-seciyoruz.html; sağda `uye-icon.png` → uyelik.html | 10 aktif sayfa | STATİK (menü) / İÇERİK (menü etiketleri isteğe bağlı CMS) | cart.js `wireNavBurger()` :1194-1212 (mobil aç/kapat, Esc, dış tıklama) |
| Promo bar | `.promo-bar` "Abone ol, ilk **2 kutunda %50 indirim** kazan — kod: BAGDAM050" | yalnız index.html:100, urunler.html:40, kutu.html:40 | İÇERİK (kampanya metni + kod) | Kod hiçbir yerde girilmiyor; kupon input'u yok. unused/abonelik.html:26'da eski kod `ILKKUTU` |
| Footer | `.site-foot`: logo-vertical.svg; "mutlu müşteri hattı" `tel:+905309494093` → "+90 (530) 949 40 93"; konum linki Google Maps → "8034 Sokak No:38, Kuşçular — Urla / İzmir"; IG/YT ikonları `href="#"`; "© 2026 — BAĞDAM. TÜM HAKLARI SAKLIDIR."; "Tüm Politikalar" → politikalar.html; "designed and powered by You Medya" → youmedya.com/iletisim (logo `assets/logo/you-medya.png` CSS'ten) | 10 aktif sayfa (10 kopya, aynı markup) | İÇERİK (telefon, adres, sosyal linkler, yıl) | index.html:379-422 ve diğerlerinde birebir aynı |
| Yüzen sepet | `.floating-cart` (JS ile body'ye eklenir): "sepeti doldur" ipucu harf animasyonu, kategori ikon yığını (`data-cat`: boxes/dairy/firin/cellar), sayaç; tıklayınca çekmece açılır; sepet.html'de gizli; footer'a yaklaşınca dock | tüm sayfalar | DAVRANIŞ | cart.js :86-174, :390-421 |
| Sepet çekmecesi | `.cart-drawer`: başlık "Sepetin", satırlar (kutu satırı `data-sub-remove` "kaldır" + "kutuyu düzenle"; ürün satırları `data-cart-idx` `data-dir` +/−), "Bunları da sevebilirsin" (ilk 3 non-fresh ürün), Toplam, "siparişi tamamla" → sepet.html | tüm sayfalar | DAVRANIŞ + VERİ (öneri) | cart.js :181-341 |
| Tercih balonu | `.pref-pop`: tercihi olan ürüne kart üzerinden ilk + basınca çip balonu (`data-pref-value`) | `data-add-to-cart` olan her yer | DAVRANIŞ | cart.js :516-580 |
| Özel select menüsü | `.swap-select` için krem açılır liste (`.swap-menu`, `data-value`) | kutu.html | DAVRANIŞ (UI) | cart.js :1121-1190 |
| Footer sosyal hizalama | IG/YT ikonlarını yüzen sepetin soluna hizalar | tüm | STATİK (UI) | cart.js :1091-1113 |
| `?sifirla` | herhangi bir sayfaya eklenince 9 localStorage anahtarı silinir | tüm | DAVRANIŞ (prototip aracı) | cart.js :9-18 |
| SVG ikon kütüphanesi | `<symbol id="ico-fig|olive|egg|melon|walnut|grape|tomato|chard|seal">` | index.html:13-79 (diğerlerinde yalnız `ico-seal`) | STATİK (artık kullanılmıyor; `.seal` img ile değiştirilmiş) | — |

JS yükleme sırası her sayfada: `assets/products.js` → `assets/cart.js` → sayfa içi inline script. Global değişkenler: `PRODUCTS`, `SUB_TIERS`, `FREQ_OPTIONS`, `DELIVERY_DAYS`, `DELIVERY_FEE`, `BahcedenCart` (IIFE API, cart.js:1224-1234).

---

### 1.1 `index.html` — Ana sayfa
URL: `/index.html` (query yok; `#hikaye`, `#faq`, `#top` çapaları). Amaç: marka manifestosu + öne çıkanlar + blog + SSS.

| # | Blok (satır) | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Mobil kategori sekmeleri `.mobile-cat-tabs` (:110-115) | 4 link: `urunler.html?tab=boxes` "Taze Kutular" (`icons/boxes.png`), `?tab=dairy` "Süt Ürünleri", `?tab=firin` "Fırın", `?tab=cellar` "Kiler" | VERİ (kategori listesi + ikon) |
| 2 | Hero `.hero` (:118-124) | bg `images/hero-crate.jpg`, ikon `logo-icon.svg`, h1 "biz market değiliz. *seçiciyiz.*", alt metin "Urla'nın Kuşçular, Yağcılar gibi birkaç köyündeki 6 üreticiden doğrudan sofranıza — aynı gün toplanır. Bu hafta bardacık inciri tam kıvamında.", CTA "kutunu oluştur" → urunler.html | İÇERİK (başlık, alt metin, görsel, CTA metni/linki) — "bu hafta ... tam kıvamında" haftalık güncellenen metin |
| 3 | Değer sütunları `.pillars` (:127-144) | 4 × (h3 + p): Mevsiminde / Şeffaf / Seçilmiş / Garantili | İÇERİK |
| 4 | Showcase `.showcase` (:147-164) | görsel `images/urunler/sezon.jpg`, eyebrow "Şu An Sezonda", h2 "bardacık inciri, *tam kıvamında.*", paragraf, CTA; sağda "Tüm Ürünler" + 4 kategori sekmesi (tekrar) | İÇERİK (haftalık "sezonda" vitrini) + VERİ (kategoriler) |
| 5 | Kategori bulutu `.cloud` (:167-171) | "indirim sebze *meyve* bakliyat / *süt ürünleri* fırın" + CTA "ürünleri keşfet" | İÇERİK/STATİK (dekoratif; link yok) |
| 6 | Öne çıkanlar `.offers` (:174-270) | h2 "öne *çıkanlar*" + açıklama; **8 adet elle yazılmış** `.pcard`: zeytinyagi 480 TL/L, beyazpeynir 260/500 g, ekmek 95/800 g somun, **10'lu Sezon Kutusu** 1099/kutu (→ kutu.html?tier=sezon, stepper yerine `+` link), zeytin 180/500 g, yogurt 150/700 g kavanoz, tereyagi 180/250 g, salca 140/500 g kavanoz. Her kartta `data-add-to-cart="<id>"` slot'u; "tümünü gör" → urunler.html | VERİ (öne çıkan ürün listesi — fiyat/meta products.js'in **kopyası**, DB'den gelmeli) + DAVRANIŞ (stepper) |
| 7 | Blog teaser `.journal-teaser` (:273-294) | 3 kart: `gunluk.html#cavdar-ekmegi` "Söyleşi · 5 dk" / `#zeytinyagi` "Söyleşi · 6 dk" / `#incir` "Mevsim · 4 dk"; "tümünü oku" | VERİ (son 3 yazı) |
| 8 | İki blok `.blocks#hikaye` (:297-308) | sol: eyebrow "Restoranlar İçin", "toptan tedarik — *yakında*", metin, "haberdar ol" → toptan.html; sağ: `images/crate.jpg` + "hikayemiz" → nasil-seciyoruz.html | İÇERİK |
| 9 | SSS `.faq-row#faq` (:311-375) | sol: kasa animasyonu (`icons/crate-*.png` ×6 çeşit ×2 + `crate-box.png`, IntersectionObserver :427-439); sağ 4 `<details>`: "haftalık kutu" (Salı/Perşembe/Cumartesi; "Abonelik dışında tek tek satış yapmıyoruz" — **ürün sayfalarıyla çelişir**), "teslimat" (yalnız Urla ve Çeşme), "kaynağımız" (6 üretici), "üyelik" (Bağdam Seçkisi) | İÇERİK (SSS listesi) |
| 10 | Inline JS (:426-464) | kasa animasyonu + "hikayemiz" buton hizalama | STATİK |

JS bağımlılığı: products.js (stepper için PRODUCTS), cart.js. data-*: `data-add-to-cart` ×7.

---

### 1.2 `urunler.html` — Ürünler (sekmeli)
URL: `urunler.html?tab=boxes|dairy|firin|cellar` (sekme tıklanınca `history.replaceState` ile URL güncellenir :169-173; varsayılan `boxes`). Amaç: kutu tier seçimi + tekil ürün grid'leri.

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Sekmeler `#prodTabs` (:47-52) | 4 buton `data-tab="boxes|dairy|firin|cellar"` + ikon | VERİ (kategori/sekme) |
| 2 | Panel boxes `#panel-boxes` (:55-82) | `#tierSlotLeft/Right` JS ile `SUB_TIERS`'tan `tier-card` (görsel, label, "Şu an en iyi olan N ürünü seç.", "N ürün", fiyat "/ kutu", abonelik modunda "ilk 2 kutu {price/2} TL", buton "ürünleri seç"/"kutunu düzenle" → `kutu.html?tier=`); `RECOMMENDED_TIER="sezon"` rozeti "en çok tercih edilen" (:207); güven şeridi 4 madde: "İstediğin zaman iptal" (`icons/iptal.png`), "Her hafta düzenle — Teslimattan 1 gün öncesine kadar" (`duzenleme.png`), "Sipariş atlama hakkı" (`haftaatla.png`), "Salı, Perşembe, Cumartesi — Urla ve Çeşme'ye" (`teslimat.png`) | VERİ (tier listesi) + İÇERİK (güven maddeleri) + DAVRANIŞ |
| 3 | Panel dairy (:85-88) | not "Kutuya dahil değil — ..." + `#dairyGrid` = `PRODUCTS.filter(tab==="dairy")` | VERİ + İÇERİK (panel notu) |
| 4 | Panel firin (:91-94) | not + `#firinGrid` (tab firin) | VERİ |
| 5 | Panel cellar (:97-100) | not + `#cellarGrid` (tab **pantry** → panel adı **cellar** eşlemesi :194) | VERİ |
| 6 | `pcardHtml(p)` (:177-191) | görsel, ad, meta, fiyat "/unit", `data-add-to-cart` | DAVRANIŞ |

Not: fresh ürünlerin (10 adet) kendi grid'i yok — sadece kutu içinde görünürler; urun.html'de "kutuda dene" CTA'sı var.

---

### 1.3 `urun.html` — Ürün detay
URL: `urun.html?id=<productId>` (yoksa/bulunamazsa `incir` / `PRODUCTS[0]` :100-101). Başlık dinamik (:102). Geri linki `TAB_TO_PANEL` ile `urunler.html?tab=` (:107-109).

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Görsel `.pd-visual` | `images[]` varsa prev/next oklarıyla galeri, yoksa `img`; `.seal` logo | VERİ (ürün görselleri) |
| 2 | Mobil sekmeler `#pdTabs` | `data-pd-tab="main|details|reco"` / `data-pd-panel` | STATİK (UI) |
| 3 | main panel | meta, h1 name, desc, tercih toggle'ı (`data-pref-axis="<label>"`, `.toggle` ×options, `def` aktif), fiyat "/unit"; fresh ise CTA "kutuda dene" → urunler.html, değilse `data-add-to-cart` büyük stepper | VERİ + DAVRANIŞ |
| 4 | details panel | "neden bunu seçtik" = `why`; "kullanım & saklama" = **koda gömülü kural** (:124-130: fresh / dairy / firin / diğer için 4 sabit metin); "alerjen" = dairy→"Süt" değilse "Yok" (:131); "parti numarası" = `batch`, ama firin→"Her sabah taze gelir.", yumurta→"Her sabah taze toplanır." (:132-136) | VERİ — saklama/alerjen/tazelik notu **ürün alanı** olmalı |
| 5 | reco panel | "senin için *önerdiklerimiz*" → `BahcedenCart.renderRecommended(#reco, [p.id])` (3 non-fresh, skor: prefs + sepet kategorileri, cart.js:612-673) | DAVRANIŞ/VERİ |

---

### 1.4 `kutu.html` — Kutu (abonelik) düzenleyici
URL: `kutu.html?tier=small|sezon`. Parametre geçerli ve mevcut tier'dan farklıysa `subSetTier` (:156-163); tier yoksa `urunler.html`'e yönlendirir (:164-167). Başlık dinamik.

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Crumb "← kutulara dön" | → urunler.html | STATİK |
| 2 | Görsel `#tierImg` + "bu kutu ile alabilecekleriniz" `#pairsRow` | `pairIds=["ekmek","zeytinyagi","beyazpeynir","tereyagi"]` önce, sonra diğer non-fresh (:469-476); `data-pair-id` stepper (:325-352) | VERİ (eşleştirme listesi **hardcoded** → admin'den "kutuyla önerilenler") + DAVRANIŞ |
| 3 | Başlık alanı | `#tierMeta` = tier.note, `#tierTitle` = label, `#tierDesc` "Şu an en iyi olan N ürünü, senin için tattığımız haliyle kapına getiriyoruz." (:367), `#tierPrice` "N TL / kutu" | VERİ + İÇERİK (şablon cümle) |
| 4 | Sipariş tipi `.order-type` | `data-type="subscription|onetime"` + `?` tooltip "Abonelere: ilk 2 kutu %50 indirimli, kargo bizden. Tek seferlik: indirim yok, kargo 49 TL" (:63-69) | DAVRANIŞ + İÇERİK (tooltip) |
| 5 | Notlar `.box-editor-note` (:72-74) | "Dokunmazsan ... otomatik ... doldururuz" / "Doğada iki gün ... e-posta ve/veya telefonla bildiririz" | İÇERİK |
| 6 | Gönderim sıklığı `#freqToggle` | `FREQ_OPTIONS` → `data-freq`; onetime'da disabled/faded | VERİ + DAVRANIŞ |
| 7 | "bu haftaki *içerik*" `#boxItems` + `#cutoff` | satır: img, ad, meta, "kutuda: boxAmount", `swap-select data-slot` (diğer fresh ürünlerle değiştir), tercih çipleri `.box-item-pref data-item data-axis` + `data-value` (parantezli seçenek "Küçük (közleme)" ana+alt not olarak ayrıştırılır :435-436); geri sayım yalnız satın alınmış abonelikte "DEĞİŞİKLİK İÇİN: X SÜREN VAR" | VERİ + DAVRANIŞ |
| 8 | "kutuna *ekstra* ekle" `#boxExtras` | "SINIRSIZ EKLEME HAKKI"; `#extrasNote` dinamik metin (:478-480); picker: ürün `swap-select#extraProduct` (fresh), miktar `#extraAmount` (`subExtraOptions`), önizleme fiyat, `+`; eklenen satırlar `data-extra-idx` çöp | DAVRANIŞ + İÇERİK (not) |
| 9 | Teslimat günü `#deliveryDayToggle` | `DELIVERY_DAYS` → `data-day`; kilitli gün notu `#dayNote` (`lockedDayNote`) | VERİ + DAVRANIŞ |
| 10 | Fiyat özeti `#priceSummary` | kutu (abonelik+satın alınmamışsa **%50 ilk kutu** fiyatı), "ilk 2 kutuda %50 indirim uygulandı -X", ekstralar satır satır, "ekstralar yalnızca bu siparişe", Kargo (onetime 49 / abonelik "Dahil"), Toplam / "Bu haftaki ödeme", "ödemen teslimat günü çekilir" | DAVRANIŞ (fiyat kuralı) |
| 11 | Alt buton `#boxEditorFoot` | 3 mod: (a) satın alınmış abonelik → taslak (`draft`) + "değişiklikleri onayla"/"vazgeç" veya "aboneliğine dön" → uyelik.html; (b) `sub.active` → "sepette" (disabled) + çöp (active=false); (c) → "aboneliği başlat"/"sepete ekle" (teslimat günü seçilmeden disabled, `isConfirmValid` :314-320) | DAVRANIŞ |
| 12 | Lightbox | küçük görsellere tıklayınca büyütme | STATİK (UI) |

data-*: `data-type`, `data-freq`, `data-day`, `data-slot`, `data-item`, `data-axis`, `data-value`, `data-extra-idx`, `data-pair-id`, `data-pref-value` (balon). Input'lar: 3 `<select>` (`#extraProduct`, `#extraAmount`, satır başına `swap-select` JS ile).

---

### 1.5 `sepet.html` — Sepet / Checkout
URL: `sepet.html` (query yok). Yüzen sepet bu sayfada gizli.

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Hero `.shop-hero` | sepet ikonu + kategori yığını `#shopHeroFillRow`; h1 "sipariş öncesi *son adımlar*" | STATİK/İÇERİK |
| 2 | Mobil adım sekmeleri `#checkoutSteps` (:45-50) | `data-step="summary|customer|delivery|payment"`; giriş sonrası ve sepet doluysa görünür; otomatik ilerleme (:631-695) | DAVRANIŞ |
| 3 | Auth kapısı `#checkoutAuth` (:54-73) | sekme `data-mode="login|signup"`; **giriş formu**: `#loginEmail` (email), `#loginPassword` (password), `#loginMsg`, `#loginSubmit`; **üye ol formu**: `#signupEmail`, `#signupEmailConfirm`, `#signupPassword`, `#signupPasswordConfirm`, `#signupMsg`, `#signupSubmit`. Doğrulama cart.js:830-858 (boş, eşleşme, localStorage `bahceden_member` ile karşılaştırma). Gönderim: **hiçbir yere** (localStorage) | DAVRANIŞ (hesap) |
| 4 | Müşteri Bilgileri `#customerSection` (:76-102) | `#custName` text **required**, `#custEmail` email **req**, `#custPhone` tel **req**, `#custAddress` textarea **req**, `#custDistrict` select **req** (Seç / Urla / Çeşme), `#custZip` text (ops.). Her `input`'ta `bahceden_address`'e kaydedilir (:244-253); tamamlanınca bölüm otomatik kapanır, teslimat/ödeme açılır | DAVRANIŞ (sipariş adresi) |
| 5 | Teslimat Bilgileri `#deliverySection` | `#checkoutDeliveryDay` toggle (`data-day`, `subSetDeliveryDay` — **sipariş düzeyinde gün `bahceden_sub.deliveryDay`'de tutulur**), `#checkoutDayNote` kilit notu, `#checkoutShippingNote` "Kargo: X TL / Dahil" | DAVRANIŞ |
| 6 | Ödeme Bilgileri `#paymentSection` | tek yöntem "Kredi Kartı / Banka Kartı"; `#cardName` text req, `#cardNumber` text req (maxlength 19, 4'lü gruplama :304-306), `#cardExpiry` AA/YY req, `#cardCvc` req (max 4). Abonelik aktifse `bahceden_card`'a **plaintext** kaydedilir (:293-303) | DAVRANIŞ (ödeme — gerçek PSP yok) |
| 7 | "siparişi tamamla" `#checkoutComplete` (:392-455) | required kontrolü + teslimat günü; sipariş satırları + toplam hesaplanır; kargo: abone veya toplam>1000 → 0, değilse 49; `addOrder({date, deliveryDate, lines[], total, deliveryDay, type})`; sub.active→purchased; sepet boşaltılır; başarı mesajı (aboneyse üyelik linki); `body.order-done` | DAVRANIŞ |
| 8 | Sipariş özeti `#cartWrap` (:461-629) | boşsa: satın alınmış abonelik varsa "sepetin boş / Ürünler bu haftaki kutuna eklendi..." + "aboneliğini görüntüle", yoksa "henüz bir aboneliğin yok." + "aboneliği başlat"; kutu satırı (tier img, "label — N ürün + M ekstra", ürün adları, "+ EKSTRA:", "HAFTADA 1 — SALI OTOMATİK GELİR" / "BU HAFTA ATLANDI", "kutuyu düzenle" → kutu.html, `#subRemove` "kaldır"); ürün satırları (`data-idx` `data-dir` stepper; meta yerine seçilen `pref`); **"Aktif aboneliğin var"** kutusu + `#addToBoxBtn` "bu haftaki kutuma ekle" (sepet ürünlerini extras'a taşır, factor=qty, label "qty × unit · pref" :593-603); Toplam, Kargo, "%1 KDV" (dahil hesap `line*(0.01/1.01)` :491,535); mobil "devam et" | DAVRANIŞ |

Toplam input: **16** (6 auth + 6 müşteri + 4 kart) — `<form>` etiketi yok, `div.checkout-form`. Gönderim hedefi: yalnız localStorage.

---

### 1.6 `uyelik.html` — Hesap
URL: `uyelik.html`. Auth kapısı sepet.html ile aynı id'ler (cart.js `wireAuthGate("accountGrid")` :136). "çıkış yap" `#logoutLink` (:37, :603-607).

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Hero | `uye-icon.png`, h1 "hesabın *ve* aboneliğin.", çıkış linki | STATİK |
| 2 | Auth `#checkoutAuth` (:40-59) | sepet ile aynı 6 input | DAVRANIŞ |
| 3 | Abonelik kartı `#subCard` (`renderSub` :180-450) | satın alınmış tier yoksa: "Henüz bir aboneliğin yok." + "kutunu tamamla" (taslak varsa) / "kutunu oluştur"; varsa: "AKTİF ABONELİK"/"TEK SEFERLİK SİPARİŞ", tier label, ürün adları, "BU HAFTAKİ EKSTRALAR" (editable ise `data-extra-idx` çöp → taslak), "Gönderim: Haftada 1 — Salı", "BİR SONRAKİ SİPARİŞ ATLANDI", teslimat günü toggle `#accountDayToggle data-day` (→ taslak), ödeme özeti (Kutu / "1 kutuluk %50 indirim (üye kaldığın için)" / ekstralar / "Bu haftaki ödeme" / "Ödemen teslimat günü çekilir…"), "DEĞİŞİKLİK İÇİN: X SÜREN VAR", taslak varsa "değişiklikleri onayla"/"vazgeç", "kutunu düzenle + ekstra ekle" → kutu.html (kilitliyse "Bu haftanın değişiklik süresi doldu"), `#skipWeekBtn` ("bir sonraki siparişi atla" / "atlamayı iptal et" / "atlama hakkın kullanıldı" disabled) → onay kutusu `#skipYesBtn/#skipNoBtn`, `#cancelSubLink` → iptal akışı | DAVRANIŞ (abonelik yönetimi) |
| 4 | İptal akışı `.cancel-flow` (:277-297, :405-449) | "Gittiğine üzüldük."; neden çipleri `data-reason` = Fiyat / Ürün çeşitliliği / Teslimat günleri / Diğer; `#cancelReasonText` textarea; `RETENTION_KEY=bahceden_retention_offered` yoksa teklif: "1 kutuluk %50 indirim" → `#useOfferBtn` (sub.nextBoxDiscount=true, key set) / `#confirmCancelBtn` (subCancel) / `#cancelFlowBack`. **Neden/metin hiçbir yere kaydedilmez** | DAVRANIŞ + İÇERİK (neden listesi, teklif metni) |
| 5 | Sağ sekmeler `#accountTabs` `data-panel="address|payment|orders"` | | DAVRANIŞ |
| 6 | Teslimat adresi `#addressCard` (:492-544) | kayıtlıysa özet + "adresi düzenle"; form `#addressForm`: `#addrName` req, `#addrPhone` req, `#addrLine` textarea req, `#addrDistrict` **text** req (sepette select!), `#addrZip`; submit → `setAddress` (email korunur) | DAVRANIŞ |
| 7 | Ödeme yöntemi `#paymentCard` (:547-589) | kayıtlıysa "•••• 1234 — Ad" + "kartı değiştir"; form `#cardForm`: `#cardFormName`, `#cardFormNumber`, `#cardFormExpiry`, `#cardFormCvc` (hepsi req) → `setCard` | DAVRANIŞ |
| 8 | Önceki siparişler `#ordersList` (:456-488) | `bahceden_orders` listesi: "ABONELİK · / TEK SEFERLİK KUTU · SİPARİŞ #1001", durum "HAZIRLANIYOR" (now < deliveryDate) / "TESLİM EDİLDİ", sipariş tarihi+saat, teslimat tarihi+gün adı, satırlar, toplam | VERİ (sipariş geçmişi) |

Input toplam: 16 (6 auth + 5 adres + 4 kart + 1 textarea). 2 gerçek `<form>` (JS string içinde).

---

### 1.7 `gunluk.html` — Blog / Günlük
URL: `gunluk.html#cavdar-ekmegi | #zeytinyagi | #incir`. JS yok (yalnız ortak).

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Hero `.journal-hero` | eyebrow "Blog", h1 "üreticiler, mevsimler ve bir *kutunun* hikayesi.", açıklama | İÇERİK |
| 2 | Yazı `#cavdar-ekmegi` (:41-51) | meta "SÖYLEŞİ · 5 DK · 16.08.2026", h2 "bir annenin ekmeği, *iki sofrada*", img `urunler/sadeekmek.jpg`, 4 paragraf (1 `.pull-quote`), linkler `urun.html?id=sadeekmek`, `?id=cevizliekmek`. Kişi: "Nurdan Canbulat" (products.js'te **Nuran**), Levan / Onur Canbulat | VERİ (JournalEntry) |
| 3 | Yazı `#zeytinyagi` (:53-64) | "SÖYLEŞİ · 6 DK · 10.08.2026", "dürüst bir zeytinyağını *ne yapar?*", img `urunler/zeytinyagi.jpg`, 5 p (1 pull-quote). Kişi "Mehmet Usta" (products.js'te zeytinyağı üreticisi "Bağdam Çiftlik") | VERİ |
| 4 | Yazı `#incir` (:66-76) | "MEVSİM · 4 DK · 07.08.2026", "bardacık inciri neden bu kadar *kısa ömürlü?*", img `scene-originals/fig.jpg`, 4 p. "Perşembe toplanan incir Cuma kapında" (teslimat günleriyle çelişir) | VERİ |
| 5 | Kapanış `.journal-close` | "bu hafta *ne var,* gör." + "kutunu oluştur" | İÇERİK |

Yazı yapısı: tür (SÖYLEŞİ/MEVSİM) · okuma süresi · tarih · başlık (em vurgulu) · kapak görseli · gövde (p, pull-quote, ürün linkleri) · slug (#id).

---

### 1.8 `toptan.html` — Toptan (yakında)
URL: `toptan.html`.

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Hero `.soon-hero` | `icons/toptan-icon.png`, eyebrow "Restoranlar & Şefler İçin", h1 "toptan tedarik *yakında.*", metin | İÇERİK |
| 2 | Form `#notifyForm` (:40-44) | **1 input**: `type=email` `required` placeholder "e-posta adresin" (name/id yok), buton "haberdar ol"; submit → `preventDefault`, form gizlenir, `#notifyMsg` "Teşekkürler — toptan hattı açıldığında ilk sana haber vereceğiz." **Hiçbir yere gönderilmez, saklanmaz** (:111-117) | DAVRANIŞ (lead toplama) |
| 3 | Detaylar `.soon-details` | 3 × (h3+p): "Aynı üretici ağı", "Urla ve Çeşme içi, ertesi sabah" (sabah 7'den önce), "Şeffaf fiyatlandırma" | İÇERİK |

Not: görev metnindeki "toptan tedarik talebi formu" gerçekte yalnız e-posta bekleme listesi.

---

### 1.9 `politikalar.html` — Politikalar
URL: `politikalar.html#<policyId>`; `data-policy` linkleri `history.replaceState` + `hashchange` (:235-270). Bilinmeyen hash → ilk politika.

8 sekme (`.policies-nav a[data-policy]` :47-54 / `article.policy#id` :58-182): `gizlilik`, `kullanim-kosullari`, `mesafeli-satis`, `teslimat`, `iptal-iade`, `kvkk`, `cerez`, `cerez-ayarlari`. Her biri: eyebrow "Politikalar", h1, `.policy-updated` "SON GÜNCELLEME: 18 AĞUSTOS 2026", `.policy-lead`, N × (h2 + p). Sınıf: **VERİ/İÇERİK** (Policy kaydı: slug, title, updatedAt, lead, sections[]). Cerez Ayarları sayfasında gerçek toggle yok (yalnız metin). Satıcı: "BİRBUDAK GRUP DANIŞMANLIK TİC. LTD. ŞTİ. — 8034 Sokak No:38, Kuşçular, Urla / İzmir — Tel: +90 (530) 949 40 93" (:96, :141). İş kuralları metinde: kesim "teslimat gününden önceki gün 12:00" (:85, :113, :128), teslimat 09:00–18:00 (:115), kargo "Aboneliklerde dahil; tek seferlikte 1.000 TL üzeri ücretsiz, altı 49 TL" (:117), "yılda bir kez bir haftayı atlama" (:130), ayıplı ürün 24 saat (:132), iade 3–7 iş günü (:134), aboneliklerde "haftalık tutar teslimat günü tahsil edilir" (:102), cayma hakkı yok (gıda) (:104).

---

### 1.10 `nasil-seciyoruz.html` — Manifesto
URL: `nasil-seciyoruz.html`. JS yok.

| # | Blok | İçerik | Sınıf. |
|---|---|---|---|
| 1 | Manifesto (:45-50) | eyebrow "Bağdam Nasıl Çalışır", h1 "biz market değiliz. *seçiciyiz.*", alt metin, kural "İYİ DEĞİLSE BAĞDAM'DA YOK." | İÇERİK |
| 2 | Karşılaştırma `.compare` (:53-85) | h2 "fark *ne?*"; 3 sütun (hızlı teslimat uygulamaları / üretici ağı servisleri / **bağdam** aktif) × 4 satır (Teslimat, Ürün seçimi, Kalite kontrolü, Kişiselleştirme) | İÇERİK (tablo) |
| 3 | Sistem 01 (:88-104) | "nasıl *seversin?*" + demo kart "Gülbahçe Kavunu — nasıl seversin?" toggle Diri/Tam olgun, "YEME ZAMANI: BUGÜN–YARIN" | İÇERİK (statik demo) |
| 4 | Sistem 02 (:107-122) | "seçen kişi *görünür*" + küratör kartı avatar "E", "Bu kutuyu hazırlayan — Ece — Bağdam" | İÇERİK (küratör adı → ileride Kutu/Order alanı olabilir) |
| 5 | Garanti (:125-129) | `logo-icon.svg`, "seçimin riski *bizde.*", metin | İÇERİK |
| 6 | Kapanış (:132-135) | "bu hafta *iyi olanı* gördün mü?" + "abone ol" → urunler.html | İÇERİK |

Not: `assets/images/steps/{buluyoruz,tadiyoruz,seciyoruz,ayiriyoruz,garanti}.jpg` (5 görsel) hiçbir yerde kullanılmıyor — muhtemelen kaldırılmış "adımlar" bölümünün görselleri.

---

### 1.11 `unused/abonelik.html` (eski, marka "bahçeden al")
Eski tek sayfalık abonelik editörü: `.order-type data-type`, tiers (`tier.note` gösterir), `#editor` (freq toggle `data-freq`, `#boxItems` swap-select `data-slot`, `#skipBtn`, `#confirmBtn` "haftalık aboneliği başlat"/"siparişi tamamla", `#cancelNote`). Kesim metni "Salı 23:59'a kadar" (:43), "sadece İzmir'e teslim" (:51), onay mesajı "Bu Cuma kapında" (:242-245), `?tier=` ön seçim (:255-258). Promo kodu `ILKKUTU`. **Aktif siteye bağlı değil**; iş kuralı tarihçesi için referans.

### 1.12 `unused/secki.html` (eski "seçki" sayfası)
Haftalık seçki grid'i: eyebrow "14 Ağustos — Urla", `#reco` (renderRecommended), filtre çipleri `data-filter` = tümü/indirim/sebze/meyve/bakliyat/süt ürünleri/fırın/**et**/**balık** (:46-54), 8 elle yazılmış `.pcard data-category` (incir, zeytinyagi, yumurta "Gezen Tavuk Yumurtası — Güzelbahçe", uzum, **ceviz** (products.js'te yok, 310 TL/kg, Bademler), pazi, domates "Salkım Domates 65 TL", zeytin) + kart içi `.pcard-pref data-pref-axis` toggle'ları + `add-btn data-add-to-cart`; "şu an seçkide yok. iyi olan gelince eklenir." boş durumu. Eski "haftalık seçki" modeli; `et/balık` kategorileri ve `indirim` filtresi gelecekte planlanan kategorilere işaret ediyor.

---

## 2. Varlık (entity) listesi

### 2.1 Product — `assets/products.js:1-369` (22 kayıt)

| Alan | Tip | Zorunlu | Örnek | Not |
|---|---|---|---|---|
| id | string (slug) | ✓ | `"incir"`, `"cevizliekmek"` | URL `urun.html?id=` ve sepet/kutu referansı |
| name | string | ✓ | `"Bardacık İnciri"` | |
| category | enum | ✓ | `meyve` (3) · `sebze` (7) · `bakliyat` (4) · `süt ürünleri` (5) · `fırın` (3) | Öneri skorunda `tab || category` (cart.js:626) |
| meta | string | ✓ | `"Hüseyin Dağ · Kuşçular · Urla"`, `"Bağdam Çiftlik · Kuşçular · Urla — Erken Hasat"` | Serbest metin: "Üretici · Köy · İlçe[ — not]" → Producer'a **normalize edilmeli** |
| location | string | ✓ | `"Kuşçular · Urla"` | meta'nın köy·ilçe kısmı (tekrar) |
| batch | string | ✓ | `"K14-03"`, `"ZY-11"`, `"EK-01"` | Parti/lot kodu; urun.html'de firin ve yumurta için gösterilmez |
| price | number (TL, KDV dahil) | ✓ | `249` | %1 KDV dahil varsayımı (sepet.html:491) |
| unit | string | ✓ | `"500 g"`, `"L"`, `"6'lı"`, `"kg"`, `"demet"`, `"adet"`, `"500 g kavanoz"`, `"700 ml şişe"`, `"800 g somun"`, `"700 g kalıp"`, `"250 g"` | Ekstra miktar seçenekleri `unit==="kg"` / `"500 g"` / diğer'e göre (cart.js:947-966) |
| boxAmount | string | ops. (fresh'lerde) | `"500 g"`, `"1 adet (~1,5 kg)"`, `"4 adet"`, `"1 demet"` | kutu.html:457 "kutuda: …" |
| img | path | ✓ | `"assets/images/urunler/zeytinyagi.jpg"` | kapak |
| images | path[] | ops. | `["scene-originals/fig.jpg","fig.jpg"]` (incir, uzum, pazi, domates, kirikpeynir) | urun.html galeri |
| desc | string | ✓ | "İnce kabuk, yoğun aroma…" | |
| why | string | ✓ | "4 farklı bahçeden 7 parti tattık…" | "neden bunu seçtik" — parti bazlı, **her hafta değişir** |
| pref | `{label, options[], def}` \| null | ops. | `{label:"olgunluk", options:["Sert","Tam kıvamında","Yumuşak"], def:1}` | Eksenler: olgunluk, yoğunluk, boyut, olum, tuzluluk. 12 üründe var, 10'unda null |
| fresh | boolean | ✓ | `true` (10) / `false` (12) | true → yalnız kutuda; false → tekil satış |
| season | string | ops. (fresh) | `"Ağu–Eyl"`, `"Eyl–Mar"` | UI'da gösterilmiyor (DOĞRULANMADI: grep'te `season` kullanan sayfa yok) |
| tab | enum | ops. (non-fresh) | `pantry` (4) · `dairy` (5) · `firin` (3) | urunler.html paneli: pantry→"cellar" |
| *(türetilen)* storage | string | — | urun.html:124-130 kural | Ürün alanı olmalı |
| *(türetilen)* allergen | string | — | dairy→"Süt" | Ürün alanı olmalı |
| *(türetilen)* freshnessNote | string | — | "Her sabah taze gelir." | Ürün alanı olmalı |

Ürün listesi (id · tab/fresh · fiyat/unit · üretici): incir fresh 249/500 g Hüseyin Dağ · zeytinyagi pantry 480/L Bağdam Çiftlik · yumurta dairy 89/6'lı Mehmet Aydın · uzum fresh 159/500 g Ali Karaca (Zeytineli) · pazi fresh 45/demet Fatma Güler · domates fresh 85/kg Ramazan Öz (Güzelbahçe) · kavun fresh 55/kg İbrahim Sarı (Gülbahçe) · acur fresh 40/kg Emine Yaman · misir fresh 15/adet Halil Uçar (Bademler) · biber fresh 60/kg Kadir Aksoy · patlican fresh 50/kg Zehra Tekin (Güzelbahçe) · bamya fresh 130/kg Şerife Kaya · zeytin pantry 180/500 g Bağdam Çiftlik · salca pantry 140/500 g kavanoz Emrem Çiftlik · domatespuresi pantry 120/700 ml şişe Bağdam Çiftlik · beyazpeynir dairy 260/500 g Emrem Çiftlik · kirikpeynir dairy 240/500 g Emrem Çiftlik · tereyagi dairy 180/250 g Bağdam Çiftlik · yogurt dairy 150/700 g kavanoz Bağdam Çiftlik · ekmek firin 95/800 g somun Hatice Yıldız (Yağcılar) · cevizliekmek firin 130/700 g kalıp Nuran Canbulat · sadeekmek firin 100/700 g kalıp Nuran Canbulat.

### 2.2 Producer — `meta`/`location`'dan türetilir (normalize edilmiş tablo yok)

| Alan | Örnek | Kaynak |
|---|---|---|
| name | Hüseyin Dağ, Bağdam Çiftlik, Emrem Çiftlik, Nuran Canbulat … (15 farklı ad) | products.js meta |
| village | Kuşçular (11 ürün), Zeytineli, Güzelbahçe, Gülbahçe, Bademler, Yağcılar (6 köy) | meta/location |
| district | Urla (hepsi) | |
| note | "Erken Hasat" (zeytinyagi) | meta sonek |
| story / avatar / curator | gunluk.html söyleşileri (Mehmet Usta, Nurdan/Nuran Canbulat, Levan) | günlük |

Çelişki: hero ve SSS "6 üretici" der (index.html:122, :368), products.js'te 15 farklı üretici adı var.

### 2.3 Category / Tab

| Kaynak | Değerler |
|---|---|
| Sekme (urunler.html `data-tab`, ikonlar `assets/icons/{boxes,dairy,firin,cellar}.png`) | boxes "Taze Kutular", dairy "Süt Ürünleri", firin "Fırın", cellar "Kiler" |
| Ürün `tab` | pantry (=cellar), dairy, firin; fresh'ler tab'sız (boxes) |
| Ürün `category` | meyve, sebze, bakliyat, süt ürünleri, fırın |
| Yüzen sepet ikon eşlemesi | `CATEGORY_ICON={pantry:"cellar",dairy:"dairy",firin:"firin"}` + "boxes" (cart.js:346) |
| Eski (secki.html) | tümü, indirim, sebze, meyve, bakliyat, süt ürünleri, fırın, et, balık |
| Panel notu | urunler.html:86,92,98 (kategori başına açıklama) |

### 2.4 BoxTier — `products.js:371-374` (`SUB_TIERS`)

| Alan | small | sezon |
|---|---|---|
| id | `small` | `sezon` |
| label | 6'lı Sezon Kutusu | 10'lu Sezon Kutusu |
| count | 6 | 10 |
| price | 649 | 1099 |
| note | "5–6 ürün · 1–2 kişilik hane" | "9–10 ürün · kalabalık hane, sofra kuranlar" |
| img | `assets/images/urunler/small.jpg` | `assets/images/urunler/sezon.jpg` |
| *(kod)* recommended | — | `RECOMMENDED_TIER="sezon"` urunler.html:207 |
| *(kod)* ilk kutu fiyatı | `Math.round(price/2)` = 325 | 550 (kutu.html:497, urunler.html:209) |
| *(kod)* içerik | `defaultFill(count)` → fresh ürünlerden tercih skoruna göre (cart.js:881-891) | |

### 2.5 FreqOption — `products.js:377-381`: `1hafta` "Haftada 1", `2hafta` "2 haftada bir", `4hafta` "4 haftada bir"; `note:"seçtiğin gün"`, `allDays:false` (hepsi). `allDays:true` yolu kodda hâlâ destekleniyor (eski "Haftada 3", cart.js:1037-1047).

### 2.6 DeliveryDay — `products.js:383-387`: `sali` Salı, `persembe` Perşembe, `cumartesi` Cumartesi. Kod sabitleri: `DELIVERY_WEEKDAY={sali:2,persembe:4,cumartesi:6}` (cart.js:726), `CUTOFF_WEEKDAY={sali:0,persembe:2,cumartesi:4}` (2 gün önce 23:59, cart.js:1034), `lockedDeliveryDay()` (bir önceki gün 12:00'den teslimat günü sonuna kadar kilit, cart.js:1057-1065). `DELIVERY_FEE=49` (products.js:389). Ücretsiz kargo eşiği 1000 TL (sepet.html:425,573; politikalar:117). Teslimat bölgesi: Urla, Çeşme (sepet select, SSS, politikalar).

### 2.7 Subscription (sepetteki kutu + satın alınmış abonelik aynı kayıt) — `bahceden_sub`, cart.js:680-684 `SUB_DEFAULTS`

| Alan | Tip | Varsayılan | Anlam / kaynak |
|---|---|---|---|
| tierId | string\|null | null | seçili tier (`subSetTier` :893) |
| items | productId[] | [] | kutu içeriği (count adet; `subSwapItem` :908) |
| itemPrefs | `{productId: optionLabel}` | {} | ürün bazlı tercih (`subSetItemPref` :931) |
| freq | freqId | "1hafta" | `subSetFreq` :995 |
| deliveryDay | dayId\|null | null | **hem abonelik hem tekil sipariş günü** (sepet.html:378) |
| type | "subscription"\|"onetime" | "subscription" | `subSetType` :1009 |
| skipThisWeek | bool | false | `subToggleSkip` :920 |
| skipUsed | bool | false | tek atlama hakkı (ömür boyu, kodda) |
| extras | `{id, factor, label}[]` | [] | `subAddExtra` :977; sepetten "kutuma ekle" de buraya (factor=qty) |
| extrasCutoff | epoch ms\|null | null | geçince extras otomatik silinir (getSub :697-701) |
| active | bool | (undefined) | kutu sepette / ödenmemiş (kutu.html:564, drawer :233) |
| purchased | bool | false | ödendi → canlı abonelik (sepet.html:440) |
| nextBoxDiscount | bool | (yok) | retention %50 (uyelik.html:440) |

### 2.8 BoxExtra — `{id, factor, label}`; fiyat `Math.round(product.price * factor)` (cart.js:968-971). Miktar seçenekleri: unit `kg` → 250 g(0.25)/500 g(0.5)/1 kg(1)/2 kg(2); unit `500 g` → 500 g(1)/1 kg(2)/1,5 kg(3); diğer (adet/demet) → 1–4 × unit. Yalnız o siparişe ait; kesimde düşer.

### 2.9 Cart / CartItem — `bahceden_cart` = `[{id, qty, pref}]` (cart.js:39-49). `pref` = seçilen seçenek etiketi veya null; aynı id+pref birleşir. Satır fiyatı `price*qty`. Kutu sepette ayrı satır olarak gösterilir (tier+extras), sayaçta +1.

### 2.10 Preference (damak zevki) — `bahceden_prefs` = `{axisLabel: optionLabel}` (cart.js:430-437) — ör. `{"olgunluk":"Sert","boyut":"M"}`. Öneri ve `defaultFill` skorlarında kullanılır. Ürün sayfası toggle'ı (`data-pref-axis`) ve kutu çipleri yazar.

### 2.11 Order — `bahceden_orders` (cart.js:711-722; sepet.html:427-434)

| Alan | Tip | Örnek |
|---|---|---|
| no | int | 1001, 1002… (ilk 1001) |
| date | epoch ms | Date.now() |
| deliveryDate | epoch ms\|null | `nextDeliveryDate(deliveryDay)` |
| lines | string[] | `["10'lu Sezon Kutusu — 10 ürün", "+ Ata Tohumu Domates (1 kg)", "Salça × 2"]` |
| total | number | kutu(+extras)+ürünler+kargo (**ilk kutu indirimi uygulanmaz**) |
| deliveryDay | dayId | "sali" |
| type | "subscription"\|"onetime"\|"tekli" | |
| *(eksik)* adres/ödeme/KDV/durum | — | siparişe bağlanmıyor; durum zamana göre türetiliyor (uyelik.html:473) |

### 2.12 Address — `bahceden_address` = `{name, email, phone, line, district, zip}` (sepet.html:245-252; uyelik.html:521-528). Tek adres; `district` sepette select (Urla/Çeşme), üyelikte serbest metin.

### 2.13 PaymentCard — `bahceden_card` = `{name, number, expiry, cvc}` **plaintext** (sepet.html:297-302; uyelik.html:570-575). Yalnız abonelikli ödemede otomatik kaydedilir. Tek ödeme yöntemi: kredi/banka kartı. Gerçek sistemde PSP token'ı olmalı.

### 2.14 User / Account / Session — `bahceden_member` = `{email, password}` plaintext (cart.js:854); `bahceden_session` = `{loggedIn:true}` \| null (cart.js:364). Üye ol alanları: e-posta, e-posta tekrar, parola, parola tekrar; giriş: e-posta, parola. Ad/telefon üye kaydında yok (adreste). Farklı e-postayla üye olunca tüm kişisel anahtarlar silinir (cart.js:343-352). `hasPurchasedSub()` = loggedIn && purchased (cart.js:360).

### 2.15 RetentionOffer — `bahceden_retention_offered="1"` (uyelik.html:170, :444); teklif: 1 kutuluk %50 → `sub.nextBoxDiscount`. Hak yalnız "indirimi kullan"a basınca yanar.

### 2.16 CancelReason — seçenekler `["Fiyat","Ürün çeşitliliği","Teslimat günleri","Diğer"]` + serbest metin (uyelik.html:282-286). **Kaydedilmiyor** → DB tablosu gerekir.

### 2.17 WholesaleLead (toptan) — tek alan: `email` (toptan.html:41). Gönderilmiyor.

### 2.18 JournalEntry (gunluk.html)

| Alan | Örnek |
|---|---|
| slug | cavdar-ekmegi, zeytinyagi, incir |
| type | SÖYLEŞİ / MEVSİM (index teaser: "Söyleşi", "Mevsim") |
| readMinutes | 5, 6, 4 |
| publishedAt | 16.08.2026, 10.08.2026, 07.08.2026 |
| title (em vurgulu) | "bir annenin ekmeği, *iki sofrada*" |
| coverImage | urunler/sadeekmek.jpg … |
| body | paragraflar + pull-quote + ürün linkleri (HTML/markdown) |
| relatedProducts | sadeekmek, cevizliekmek (gövde linkleri) |

### 2.19 Policy (politikalar.html) — `{slug, title, updatedAt:"18 AĞUSTOS 2026", lead, sections:[{h2, p}]}` × 8 (gizlilik, kullanim-kosullari, mesafeli-satis, teslimat, iptal-iade, kvkk, cerez, cerez-ayarlari).

### 2.20 SiteContent / Settings (sayfa bazlı CMS blokları)

| Anahtar | Alanlar | Kaynak |
|---|---|---|
| promoBar | text, code (BAGDAM050), discountPct (50), firstBoxes (2) | index/urunler/kutu :40-41 |
| hero | bgImage, title, subtitle, ctaText, ctaHref, weeklyNote ("Bu hafta bardacık inciri…") | index.html:118-124 |
| pillars[4] | title, text | index:127-144 |
| showcase | eyebrow, title, text, image, ctaText | index:147-164 |
| cloud | lines | index:167-171 |
| featuredProducts[8] | productId \| tierId | index:180-267 |
| journalTeaser | son 3 yazı (otomatik) | index:279-292 |
| blocks | toptan teaser (eyebrow, title, text, cta), hikaye görseli + cta | index:297-308 |
| faq[4] | question, answer | index:358-373 |
| trustItems[4] | icon, label, sub | urunler.html:59-80 |
| panelNotes | dairy/firin/cellar notları | urunler:86,92,98 |
| boxEditorNotes | 2 not + extrasNote şablonu + tooltip | kutu.html:66-74, :91 |
| manifesto sayfası | manifesto, compare tablosu, sistem 01/02 demo metinleri, curator adı "Ece", garanti, kapanış | nasil-seciyoruz.html |
| toptan sayfası | eyebrow, title, text, 3 detay, teşekkür mesajı | toptan.html |
| journalHero / journalClose | başlık/metin | gunluk.html |
| footer | phone (+90 530 949 40 93), address, mapsUrl, instagramUrl (#), youtubeUrl (#), copyright year, legalName (BİRBUDAK GRUP…) | tüm sayfalar |
| sepet/uyelik metinleri | boş sepet mesajları, başarı mesajı, "Aktif aboneliğin var" metni, retention/iptal metinleri | sepet.html:446-448,469-476,565; uyelik.html:279-296,312 |
| seo | `<title>` "Bağdam — …", favicon `logo-icon.svg` | her sayfa |

### 2.21 Promo/Coupon — BAGDAM050 (%50 ilk 2 kutu). Kod girişi yok; indirim abonelik modunda kutu.html özetinde **her zaman** uygulanmış görünür (kutu.html:496 `isFirst = subscription && !isLive()`), ama sepet toplamı ve Order.total tam fiyat (sepet.html:416, :489).

---

## 3. Kullanıcı akışları

### 3.1 Sepete ekleme (tekil ürün, tercihli)
1. Kart/öneri/çekmece slot'u `data-add-to-cart` → `wireAddButtons` (cart.js:582-605). `+` → ürünün `pref`'i varsa ve sepette yoksa **tercih balonu** açılır (`openPrefPopFor`), çip seçilince `add(id, prefValue)`. Ürün sayfasında kendi toggle'ı (`data-pref-axis`) varsa balon açılmaz, aktif toggle metni pref olur (:591-593). Tercihsiz → `add(id,null)`.
2. `add` → `bahceden_cart` `[{id,qty,pref}]` (aynı id+pref birleştirilir) → `updateFloatingCart(true, category)` (bump + kategori ikonu).
3. `−` → `decrementCartProduct` (önce pref=null satırı, yoksa ilk bulunan).
4. Tercih toggle'ı (`.toggle` içinde `data-pref-axis`) → `recordPref(axis,label)` → `bahceden_prefs`.
State: `bahceden_cart`, `bahceden_prefs`.

### 3.2 Kutu / abonelik oluşturma
1. urunler.html `?tab=boxes` → tier kartı "ürünleri seç" → `kutu.html?tier=sezon`.
2. kutu.html: `subSetTier(tier)` → `items = defaultFill(count)` (cart.js:893-900). Sipariş tipi (`subSetType`), sıklık (`subSetFreq`), ürün değiştir (`subSwapItem` — slot sayısı sabit), tercih çipi (`subSetItemPref` + global pref), ekstra ekle (`subAddExtra` → `extrasCutoff=nextCutoff()`), teslimat günü (`subSetDeliveryDay`). Hepsi anında `bahceden_sub`'a yazılır.
3. "aboneliği başlat"/"sepete ekle" → `sub.active=true` (kutu.html:562-567) → buton "sepette" + çöp (active=false). Sepet sayacında +1, çekmecede kutu satırı.
4. sepet.html → checkout (3.5) → `purchased=true, active=false`.
State: `bahceden_sub` (tierId, items, itemPrefs, freq, deliveryDay, type, extras, extrasCutoff, active).

### 3.3 Satın alınmış aboneliği değiştirme (taslak/onay)
- kutu.html: `isLive()` (loggedIn && purchased) ise tüm değişiklikler bellek içi `draft`'a yazılır; "değişiklikleri onayla" → `setSub(draft)` + extras varsa `extrasCutoff` damgası (kutu.html:511-540); "vazgeç" → draft=null. Fiyat özeti "Bu haftaki ödeme" + "ödemen teslimat günü çekilir"; ilk kutu indirimi gösterilmez.
- uyelik.html: ekstra silme ve gün değişikliği `subDraft`'a (uyelik.html:333-350) → "değişiklikleri onayla"/"vazgeç" (:352-368). Geri sayım `formatCountdown(nextCutoff())`; "kilitlendi" ise düzenleme linki yerine "Bu haftanın değişiklik süresi doldu".
State: `bahceden_sub`; taslak yalnız bellek.

### 3.4 Haftayı atlama
uyelik.html `#skipWeekBtn` → onay ("atla"/"vazgeç") → `subToggleSkip()`: `skipThisWeek=true, skipUsed=true` (cart.js:920-926). Geri alma onaysız ve serbest; `skipUsed` bir kez true olunca yeni atlama **asla** yapılamaz ("atlama hakkın kullanıldı"). Atlanan hafta ödeme 0 (uyelik:227, sepet:489). Politika "yılda bir kez" der — kodda süresiz tek hak.

### 3.5 Checkout (sepet.html)
1. Giriş/üye ol kapısı (3.6) → `#checkoutSections` görünür.
2. Müşteri bilgileri (5 zorunlu + posta kodu) → her tuşta `bahceden_address`; tamamlanınca teslimat + ödeme açılır (kilit :340-349).
3. Teslimat günü (`subSetDeliveryDay` → `bahceden_sub.deliveryDay` — **tekil siparişte de**), kilitli gün notu.
4. Kart bilgileri (4 zorunlu) → abonelikse `bahceden_card`.
5. "siparişi tamamla": required + gün kontrolü → `addOrder` (`bahceden_orders`, no 1001+) → kutu `purchased=true` → `bahceden_cart=[]` → başarı mesajı.
6. Özel: satın alınmış abonelik + sepette tekil ürün → "bu haktaki kutuma ekle" → ürünler extras'a taşınır, sepet boşalır (sepet.html:593-603).
Kargo: abone veya ara toplam >1000 → 0, değilse 49. KDV %1 (dahil) yalnız gösterim.

### 3.6 Üyelik / giriş / çıkış
- Üye ol: email+tekrar, parola+tekrar eşleşme → `setMember({email,password})` (önceki üyeden farklıysa kişisel anahtarlar silinir) → `setLoggedIn(true)`.
- Giriş: `bahceden_member` ile birebir karşılaştırma; hata mesajları ("Bu e-postayla bir hesap bulamadık — üye ol.", "E-posta ya da parola hatalı.").
- Çıkış: uyelik.html `#logoutLink` → `setLoggedIn(false)`; satın alınmış abonelik arayüzde gizlenir (kayıt durur).
- `body.is-logged-in` sınıfı CSS için.
State: `bahceden_member`, `bahceden_session`.

### 3.7 Abonelik iptali + retention
uyelik "aboneliği iptal et" → akış açılır (neden çipleri + textarea) → `bahceden_retention_offered` yoksa %50 teklif → "indirimi kullan, üye kal" (`nextBoxDiscount=true`, key="1") | "yine de iptal et" → `subCancel()` = `SUB_DEFAULTS + {active:false}` (tierId/items sıfırlanır, `purchased=false`) | "vazgeç". Nedenler kaydedilmez.

### 3.8 Toptan talep
toptan.html e-posta → submit → yalnız UI teşekkür. State yok.

### 3.9 Günlük okuma
index teaser → `gunluk.html#slug`; yazı içi ürün linkleri → urun.html. State yok.

### 3.10 Politikalar
Footer → politikalar.html (#hash ile doğrudan sekme). State yok.

---

## 4. İstemci durumu (localStorage)

| Anahtar | Şekil | Yazan | Okuyan |
|---|---|---|---|
| `bahceden_cart` | `[{id:string, qty:int, pref:string\|null}]` | cart.js add/remove/setQty/setCart | her sayfa (badge, drawer), sepet.html |
| `bahceden_prefs` | `{[axisLabel]: optionLabel}` | recordPref, subSetItemPref | renderRecommended, defaultFill |
| `bahceden_sub` | bkz. 2.7 (`tierId, items[], itemPrefs{}, freq, deliveryDay, type, skipThisWeek, skipUsed, extras[], extrasCutoff, active, purchased, nextBoxDiscount`) | kutu.html, sepet.html, uyelik.html, drawer | aynı + count() |
| `bahceden_address` | `{name,email,phone,line,district,zip}` | sepet.html (her input), uyelik.html formu | sepet/uyelik |
| `bahceden_card` | `{name,number,expiry,cvc}` (plaintext) | sepet.html (abonelikse), uyelik.html formu | sepet/uyelik |
| `bahceden_member` | `{email,password}` (plaintext) | signup | login |
| `bahceden_session` | `{loggedIn:true}` \| null | login/signup/logout | isLoggedIn, hasPurchasedSub, wireAuthGate |
| `bahceden_orders` | `[{no,date,deliveryDate,lines[],total,deliveryDay,type}]` en yeni üstte | sepet.html checkout | uyelik.html siparişler |
| `bahceden_retention_offered` | `"1"` | uyelik.html useOffer | uyelik.html cancel flow |

Özel parametreler: `?sifirla` (cart.js:9-18) → 9 anahtarı siler, URL temizlenir. `?tab=` (urunler), `?id=` (urun), `?tier=` (kutu), `#policyId` (politikalar), `#slug` (gunluk).
"Logged in" bayrağı `bahceden_session` üyeden (`bahceden_member`) bağımsız; çıkışta abonelik verisi silinmez ama gizlenir. Taslaklar (`draft`, `subDraft`), `pickedExtraId`, `changesSaved`, `skipConfirmOpen`, `cancelFlowOpen`, `cancelOfferThisFlow`, sepet bölüm durumları (`sectionState`) yalnız bellekte.

---

## 5. Dinamikleştirme haritası

| Blok / işlev | API ucu (öneri) | Admin ekranı | Kaynak |
|---|---|---|---|
| Ürün listeleri (urunler grid'leri, öne çıkanlar, öneri, kutu yan ürünleri, drawer reco) | `GET /api/products?tab=&fresh=&featured=` | Ürünler (CRUD: tüm 2.1 alanları + storage/allergen/freshnessNote + görseller + featured/sort + pair-with-box bayrağı) | urunler.html:192-194, index:180-267, cart.js:612-673, kutu.html:469 |
| Ürün detay | `GET /api/products/:id` | Ürünler | urun.html |
| Üreticiler (meta) | `GET /api/producers` (product.producerId ile) | Üreticiler (ad, köy, ilçe, hikâye, foto) | products.js meta |
| Kategoriler/sekmeler + panel notları + ikonlar | `GET /api/categories` | Kategoriler | urunler.html:47-100, index:110-115 |
| Haftalık parti/"neden seçtik"/batch/season | product alanı veya `GET /api/products/:id/batches` | Haftalık Seçki (parti kodu, why, sezon, stok) | products.js why/batch |
| Kutu tier'ları + önerilen + haftalık varsayılan içerik | `GET /api/box-tiers`, `GET /api/box-tiers/:id/default-items?week=` | Kutular (tier CRUD, bu haftanın varsayılan içeriği, küratör adı) | products.js:371-374, cart.js:881-900 |
| Frekans, teslimat günleri, kargo ücreti, ücretsiz kargo eşiği, kesim kuralı, bölgeler (Urla/Çeşme), KDV oranı, ilk-kutu indirimi, atlama hakkı | `GET /api/settings/commerce` | Ayarlar › Teslimat & Fiyatlandırma | products.js:377-389, cart.js:1034-1065, sepet.html:425,491 |
| Sepet | misafir: localStorage; üye: `GET/PUT /api/cart` (isteğe bağlı senkron) | — | cart.js |
| Tercihler (damak zevki) | `PUT /api/me/preferences` | Müşteri detayı (salt okunur) | bahceden_prefs |
| Kutu taslağı / abonelik | `POST /api/subscriptions` (checkout'ta), `GET /api/me/subscription`, `PATCH …/items|extras|freq|delivery-day`, `POST …/skip`, `DELETE …/skip`, `POST …/cancel` (reason), `POST …/retention-offer/accept` | Abonelikler (liste, durum, haftalık içerik, ekstralar, atlama, iptal nedenleri, retention) | kutu.html, uyelik.html |
| Ekstralar | `POST /api/me/subscription/extras` (productId, factor/amount) | Abonelik detayı; Ayarlar › miktar seçenekleri (unit→seçenek) | cart.js:947-993 |
| Checkout / sipariş | `POST /api/orders` (items, subscription, addressId, deliveryDay, paymentToken), `GET /api/me/orders` | Siparişler (no, tarih, teslimat günü/tarihi, satırlar, toplam, kargo, KDV, durum hazırlanıyor/yolda/teslim, adres) | sepet.html:392-455, uyelik.html:456-488 |
| Ödeme | PSP entegrasyonu (kart token, abonelik için saklı kart, teslimat günü tahsilat) | Ödemeler/iade | sepet.html kart formu |
| Adres | `GET/PUT /api/me/address` (çoklu adres düşünülebilir) | Müşteriler | sepet/uyelik |
| Üyelik | `POST /api/auth/signup|login|logout`, `GET /api/me` (parola hash, oturum çerezi/JWT) | Müşteriler | cart.js:752-862 |
| Toptan lead | `POST /api/wholesale-leads` (email [+ ileride işletme adı, telefon, ihtiyaç]) | Toptan talepleri | toptan.html |
| Blog | `GET /api/posts?limit=3`, `GET /api/posts/:slug` | Blog yazıları (tür, süre, tarih, başlık, kapak, gövde, ilişkili ürünler) | gunluk.html, index teaser |
| Politikalar | `GET /api/policies`, `GET /api/policies/:slug` | Politikalar (zengin metin, updatedAt) | politikalar.html |
| Site içeriği (hero, pillars, showcase, cloud, blocks, faq, trust, notlar, manifesto, toptan metinleri, footer/iletişim/sosyal, promo bar) | `GET /api/site-content` (anahtar→blok) | Site İçeriği / Ayarlar › İletişim & Sosyal › Kampanya şeridi | bkz. 2.20 |
| Kupon | `POST /api/coupons/validate` (isteğe bağlı) | Kuponlar | promo-bar |

**Medya kütüphanesi**: ürün görselleri (kapak + galeri; şu an `assets/images/urunler/*` ve `scene-originals/*` + üst düzey jpg'ler karışık), kutu görselleri (small/sezon), sahne/hero görselleri (hero-crate, crate), blog kapakları, kategori ikonları (boxes/dairy/firin/cellar png), güven ikonları, adımlar (steps/*) → tek bir **Media** tablosu (id, url, alt, tür, boyut) + ürün/kutu/yazı/içerik bloklarından referans. Aktif sitede kullanılmayan 27 dosya (bkz. §7) temizlenebilir veya kütüphaneye alınabilir. Logo/ikon seti statik kalabilir.

---

## 6. Belirsizlikler / ürün soruları

1. **Kesim kuralı çifte**: `nextCutoff()` teslimattan 2 gün önce 23:59 (cart.js:1034), `lockedDeliveryDay()` bir önceki gün 12:00 (cart.js:1057), politika "önceki gün 12:00", güven şeridi "teslimattan 1 gün öncesine", eski sayfa "Salı 23:59". Hangisi geçerli?
2. **İlk 2 kutu %50**: kutu.html özetinde uygulanıyor, sepet toplamı/Order.total'da uygulanmıyor (sepet.html:416). Gerçek kural? Kod (BAGDAM050) girilecek mi, otomatik mi? Tek kutu mu 2 kutu mu? Üye başına bir kez mi?
3. **Atlama hakkı**: kodda ömür boyu tek hak (`skipUsed`), politika "yılda bir kez". Hangisi?
4. **Tekil sipariş teslimat günü** `bahceden_sub.deliveryDay`'de tutuluyor — tekil sipariş ve abonelik aynı günü mü paylaşır? Aynı anda hem abonelik hem tek seferlik kutu olabilir mi (tek `sub` kaydı var — hayır)?
5. **Abonelik tahsilatı** "teslimat günü çekilir" (politika + UI) — ilk sipariş checkout'ta mı çekiliyor? Tekrarlayan ödeme için kart saklama/PSP hangisi?
6. **Kart verisi** plaintext localStorage — gerçek sistemde PSP tokenization şart; CVC asla saklanmamalı.
7. **KDV %1** tüm ürünlerde sabit — fırın/kavanoz ürünlerinde farklı oran olabilir mi? Fiyatlar KDV dahil mi (öyle varsayılmış)?
8. **Kargo**: abonelikte dahil; tekil >1000 TL ücretsiz, altı 49 TL — ekstralar abonelik kargosuna dahil mi? "bu haftaki kutuma ekle" ile eklenen fırın/süt ürünleri kutuyla aynı gün mü?
9. **Teslimat bölgesi**: Urla + Çeşme (select), eski sayfa "sadece İzmir"; mahalle/köy bazlı kısıt var mı? Teslimat saati 09:00–18:00 sabit mi?
10. **"6 üretici"** (hero/SSS) vs products.js'te 15 üretici adı; üretici sayfaları olacak mı?
11. **Fresh ürünler yalnız kutuda** — tekil satılmayacak mı (SSS "Abonelik dışında tek tek satış yapmıyoruz" süt/fırın/kilerle çelişiyor)? Fresh ürünlerin listelendiği bir sayfa olacak mı?
12. **Kutu içeriği**: varsayılan doldurma tercih skoruna göre rastgele sıralı — gerçekte haftalık küratör listesi mi? Kutudaki miktarlar (`boxAmount`) sabit; müşteri miktar değiştiremez, ekstra ile ekler — doğru mu? Swap havuzu tüm fresh ürünler mi, haftalık stok mu?
13. **Ekstra miktar seçenekleri** unit'e göre sabit (kg: 250 g–2 kg vb.) — ürün bazlı tanımlanacak mı? "sınırsız" gerçekten sınırsız mı?
14. **Extras otomatik silinme** (extrasCutoff geçince) — sunucuda siparişe dönüşmüş sayılacak mı?
15. **Sipariş durumu** zamana göre türetiliyor ("HAZIRLANIYOR"/"TESLİM EDİLDİ") — gerçek durum makinesi (hazırlanıyor, yolda, teslim, iptal) ve bildirimler (e-posta/telefon — kutu.html:74 "bildiririz")?
16. **İptal nedenleri** kaydedilmiyor — kaydedilsin mi? Retention teklifi (1 kutuluk %50) üye başına tek mi, süresi var mı?
17. **Üyelik alanları**: yalnız e-posta+parola; ad/telefon adreste. KVKK/pazarlama onayı checkbox'ı yok — gerekli mi? Parola sıfırlama, e-posta doğrulama?
18. **Adres**: tek adres; ilçe sepette select, üyelikte serbest metin; fatura adresi/kurumsal fatura?
19. **Toptan formu**: yalnız e-posta — işletme adı/telefon/ihtiyaç alanları eklenecek mi? Nereye gidecek (CRM/e-posta)?
20. **Günlük**: yazı türleri (SÖYLEŞİ/MEVSİM) sabit mi? Yazar/küratör alanı? Yazıda "Nurdan" vs üründe "Nuran Canbulat"; "Perşembe toplanan incir Cuma kapında" (Cuma teslimat yok).
21. **Kampanya şeridi** sayfadan sayfaya farklı (yalnız 3 sayfada) — global mi olacak?
22. **Öne çıkanlar** (index) elle seçili 8 kart — admin'den "featured" bayrağı/sıra mı, kural mı?
23. **Öneri motoru** (prefs + sepet kategorileri) sunucuda mı yeniden yazılacak, yoksa basit "öne çıkan non-fresh" mi?
24. **Küratör** ("Ece — Bağdam") kutu/sipariş bazlı gerçek veri mi olacak?
25. **Çerez ayarları** sayfasında gerçek onay yönetimi (toggle) gerekecek mi?
26. **Sosyal linkler** `#` — IG/YT adresleri?
27. `season` alanı hiçbir UI'da kullanılmıyor — ürün kartında gösterilecek mi; sezon dışı ürün gizlenecek mi?
28. `allDays`/"Haftada 3" frekansı kodda hâlâ destekleniyor — geri gelecek mi?
29. Eski `secki.html`'deki kategoriler (et, balık, indirim) planda mı?
30. Ürün `batch`/`why` haftalık değişiyorsa ürün mü parti mi versiyonlanacak (sipariş anındaki parti kaydı)?
31. Stok/tükenme durumu hiç modellenmemiş — "şu an seçkide yok" durumu nasıl yönetilecek?
32. DOĞRULANMADI: styles.css içindeki sınıf/animasyon detayları okunmadı; CSS'te `url()` ile yalnız `you-medya.png` ve data-URI'lar var (grep).

---

## 7. Sayılar

- **Sayfa**: 10 aktif HTML + 2 `unused/` = 12. JS: 2 dosya (products.js 389, cart.js 1235 satır). CSS: 1 (1685 satır, 580 KB; 7 `@font-face`: Switzer 400/500/600/700, Sentient Italic 400, IBM Plex Mono base64 + …).
- **Ürün**: 22 (fresh/kutuluk 10; tekil 12 → pantry 4, dairy 5, firin 3). Tercihli (pref) ürün: 12; tercih eksenleri: 5 (olgunluk, yoğunluk, boyut, olum, tuzluluk). Galeri (images[]) olan: 5. boxAmount olan: 10. season olan: 10.
- **Kategori**: `category` 5 (meyve 3, sebze 7, bakliyat 4, süt ürünleri 5, fırın 3); sekme 4 (boxes, dairy, firin, cellar=pantry). Eski seçki filtreleri 9.
- **Üretici (meta'dan)**: 15 farklı ad, 6 köy (Kuşçular 11 ürün, Güzelbahçe 2, Zeytineli, Gülbahçe, Bademler, Yağcılar), 1 ilçe (Urla). Metinlerde "6 üretici".
- **Kutu tier**: 2 (small 6'lı 649 TL, sezon 10'lu 1099 TL). Frekans: 3. Teslimat günü: 3. Kargo: 49 TL; ücretsiz eşik 1000 TL. KDV %1. İlk kutu indirimi %50 (2 kutu). Atlama hakkı 1. Retention %50 × 1 kutu.
- **Form / input**: gerçek `<form>` 3 (toptan `#notifyForm` 1 input; uyelik `#addressForm` 5 input; uyelik `#cardForm` 4 input). Form-benzeri bölümler: sepet.html 16 input (auth 6 + müşteri 6 + kart 4), uyelik.html toplam 16 (auth 6 + adres 5 + kart 4 + iptal textarea 1), kutu.html 3 select (+ satır başına swap-select JS ile), unused/abonelik 1. Zorunlu alanlar: sepet müşteri 5 + kart 4 (+ teslimat günü); uyelik adres 4, kart 4; toptan 1.
- **Blog yazısı**: 3. **Politika**: 8. **SSS**: 4. **Pillar**: 4. **Güven maddesi**: 4. **Öne çıkan kart**: 8 (7 ürün + 1 kutu). **Karşılaştırma**: 3×4.
- **localStorage anahtarı**: 9. **data-* kancası**: 24 farklı (add-to-cart, cart-idx, dir, pref-axis, pref-value, sub-remove, cat, mode, value, tab, tier, pd-tab, pd-panel, slot, freq, day, type, item, axis, extra-idx, pair-id, idx, step, panel, reason, policy + unused: filter, category).
- **Görsel/varlık**: `assets/images` 53 (üst düzey 25, `scene-originals` 8, `steps` 5, `urunler` 15), `assets/icons` 27, `assets/logo` 5, `assets/fonts` 6 (5 woff2 + manifest.json) → toplam 91 dosya. Aktif sitede referanslanan görsel/ikon/logo: 58/85; **kullanılmayan 27**: icons `footer.png, sepet.png, sepet-kapali.png, sepet.svg`; images `basket.jpg, enginar.jpg, beyazpeynir.jpg, domatespuresi.jpg, ekmek.jpg, kirikpeynir.jpg, salca.jpg, tereyagi.jpg, tulumpeyniri.jpg` (üst düzey kopyalar), `scene-originals/{eggs,olivebranch,oliveoil,walnuts}.jpg`, `steps/*` (5), `eggs.jpg, olivebranch.jpg, oliveoil.jpg, walnuts.jpg` (yalnız unused/secki), logo `icon-acik.svg`.
