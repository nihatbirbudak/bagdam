# database/seeds — F2 katalog + ayar + admin seed'i · F5 içerik seed'i

Statik prototipteki katalog verisini (`website/assets/products.js`), temel ayarları ve **F5 içeriğini** (SiteContent blokları,
LegalDocument v1, günlük yazıları — `website/*.html` metinleri birebir) PostgreSQL'e yükler.
Kapsam: docs/BACKEND-PLANI.md §5 F2+F5 / YOL-HARITASI F2+F5 — *22 ürün · 15 üretici · 4 kategori (+legacyTab) · 2 tier ·
2 bölge · ProductLot (batch+why) · bu haftanın BoxTemplate'i · Setting commerce.\* · admin env'den · SiteContent 22 anahtar ·
LegalDocument 11 (8 nav + 3 hash) · Post 3*.

## Dosyalar

| Dosya | Görev |
|---|---|
| `convert-products-js.ts` | `products.js`'i `vm` ile çalıştırır (PRODUCTS, SUB_TIERS, FREQ_OPTIONS, DELIVERY_DAYS, DELIVERY_FEE — sabitler orada yoksa `cart.js`'ten regex+vm), `kutu.html`'den `pairIds`, `urunler.html`'den sekmeler + panel notlarını okur → `database/data/catalog.json` + `producers.json`. Deterministik: aynı kaynaklardan bayt-bayt aynı çıktı; değişmediyse dosyaya yazmaz. |
| `seed.ts` | `pnpm db:seed` (= `tsx database/seeds/seed.ts`; `prisma migrate reset` de `package.json#prisma.seed` üzerinden çağırır). `catalog.json`/`producers.json`'ı DB'ye upsert eder, ayar/içerik/admin ekler, sonunda DB sayımlarını basar. |
| `content/site-content.json` | F5 — SiteContent **değerleri** (`values: {key: value}`; 22 anahtar: promoBar, footer, home.*, urunler.trust, kutu.notes, manifesto.*, toptan.*, gunluk.*). Şema + etiket **registry'den** (`apps/api/src/modules/content/site-content.registry.ts`, tek kaynak; seed oradan import eder). Liste değerleri `{items:[…]}` gibi adlı list alanında; richtext alanları HTML, diğerleri düz metin (sunucu kaçışlar). |
| `content/legal.json` + `content/legal/<slug>.html` | F5 — LegalDocument v1: 8 politika (`website/politikalar.html` birebir; gövde dosyası 6 boşluk girintili `<h2>/<p>` satırları → render byte paritesi; `effectiveFrom` sayfadaki "SON GÜNCELLEME: 18 AĞUSTOS 2026") `showInNav=true`; + 3 nav'sız taslak (`on-bilgilendirme` PREINFO, `abonelik-sozlesmesi` SUBSCRIPTION_CONTRACT, `ticari-ileti-izni` MARKETING_CONSENT — BA `static_contents.json` ve UA `mesafeli-satis.ts` kalıbından uyarlandı, başında "TASLAK — hukuki inceleme bekliyor"; `requiresAck` PREINFO/SUBSCRIPTION_CONTRACT true; `effectiveFrom` seed günü). Hepsi `isCurrent=true`, `version=1`; `contentHash = sha256(bodyHtml)`. |
| `content/posts.json` + `content/posts/<slug>.html` | F5 — Post: `gunluk.html`'deki 3 yazı birebir (slug = `#anchor` id: `cavdar-ekmegi`, `zeytinyagi`, `incir`; `kind` görünen etiket "Söyleşi"/"Mevsim"; `publishedAt` meta tarihi 12:00 +03; `coverPath` → MediaFile.path, seed MediaFile.alt'ı sayfadaki img alt'ına eşitler; `relatedSlugs` gövdedeki ürün bağlantıları). PUBLISHED. |
| `lib/meta.ts` | `meta` = `"Üretici · Köy · İlçe[ — not]"` ayrıştırma (Producer + Product.metaNote). |
| `lib/slug.ts` | Türkçe duyarlı slug (`Hüseyin Dağ` → `huseyin-dag`). |
| `lib/media.ts` | Görsel → MediaFile alanları: `path` = prototipteki göreli yol (yeniden kodlama yok), gerçek dosya `apps/api/public/` altından stat (mimeType, size, JPEG/PNG boyutları), klasör eşlemesi. |
| `lib/load-env.ts` | `.env` yükleme sırası: `apps/api/.env` → kök `.env` (main.ts ile aynı). |
| `lib/paths.ts`, `lib/types.ts` | Mutlak yollar; `catalog.json`/`producers.json` tipleri. |
| `tsconfig.json` | Yalnız tip denetimi: `npx tsc -p database/seeds/tsconfig.json` (çalıştırma tsx ile; kökte `@types/node` olmadığından `apps/api`'ninki kullanılır). |

## Çalıştırma

```bash
pnpm tsx database/seeds/convert-products-js.ts   # products.js → database/data/*.json (kaynak değişince yeniden)
pnpm db:seed                                      # DB'ye yükle (idempotent)
npx tsc -p database/seeds/tsconfig.json           # tip denetimi (isteğe bağlı)
```

Ortam: `DATABASE_URL` zorunlu (`apps/api/.env` ya da kök `.env`). `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (≥ 8 karakter)
varsa admin kullanıcı (rol ADMIN, bcrypt 12 tur, e-posta doğrulanmış) oluşturulur; yoksa uyarı verilip atlanır.
`SEED_OVERWRITE_SETTINGS=true` → Setting satırları seed değerlerine zorla çekilir (yalnız lokal/CI).
`SEED_OVERWRITE_CONTENT=true` → SiteContent / LegalDocument v1 / Post satırları seed değerlerine zorla çekilir (admin içerik
değişiklikleri ezilir; yalnız lokal/CI — piksel parite koşusundan önce).

## Veri kaynağı ve eşlemeler

- **Kaynak** `website/assets/products.js` (F3'e kadar tek doğruluk kaynağı); `website/kutu.html:469` (`pairIds`);
  `website/urunler.html` (sekmeler `data-tab` + `.prod-panel-note`, satır 86/92/98); `website/urun.html:124-130`
  (saklama/alerjen/tazelik metinleri → `Product.storageText/allergenText/freshnessNote`); `website/index.html`
  (promo şeridi, footer); `apps/api/views/*.hbs` `<title>` (Setting `seo.<sayfa>`).
- **Kategori** (BACKEND-PLANI [B6]): `products.js tab` `pantry→cellar`, `dairy→dairy`, `firin→firin`; `fresh:true` ürünlerde
  `tab` yok → `boxes` (kutu havuzu, `isFresh=true`). `Category.legacyTab` tersi: `cellar→"pantry"`, `dairy`, `firin`, `boxes→null`.
  `Product.group` = `products.js category` (meyve|sebze|bakliyat|süt ürünleri|fırın). `Product.slug` = `products.js id`.
- **Üretici**: `meta` ilk parçası → `Producer.name/slug`, ikinci → `village`, üçüncü → `district` (hepsi Urla); ` — ` sonrası
  (`Erken Hasat`) **Product.metaNote** (şema gereği üründe; `producers.json`'da yok). 15 üretici, ilk görünüş sırasıyla.
- **Parti**: `batch` → `ProductLot.lotCode`, `why` → `tastingNote`, `isCurrent=true` (her ürünün 1 lot'u).
- **Görseller**: `img` (kapak, sortOrder 0) + `images` → `ProductImage` → `MediaFile(path="assets/images/…")`; tier `img` →
  `BoxTier.imageMedia`. Klasör: `scene-originals/`, `steps/` → `sahne`; diğer `assets/images/**` → `urunler`. Bu seed 29 görseli
  kaydeder (ürün + tier); kalan görseller (58'in tamamı, ikon/logo/sahne) **F4 `media:import`** ile gelir — import **path'e göre
  upsert** etmeli ve aynı klasör kuralını kullanmalı ki kayıtlar çoğalmasın (`lib/media.ts#mediaFolderFor`).
- **Tier**: `SUB_TIERS` → `BoxTier` (`small` 6 ürün 649 TL, `sezon` 10 ürün 1099 TL); `isRecommended` = `sezon`
  (`urunler.html:208 RECOMMENDED_TIER`).
- **BoxTemplate**: tier başına, `weekStart` = bu haftanın Pazartesi'si (Europe/Istanbul), `PUBLISHED`; öğeler cart.js
  `defaultFill(count)` mantığıyla (tercih sinyali yok → fresh havuzunun ilk `count` ürünü, products.js sırası), `qtyLabel` = `boxAmount`.
- **Bölge/tarih** (ADR-0005): `urla`, `cesme` — fee 49 (`DELIVERY_FEE`), ücretsiz eşik 1000 (sepet.html:573), kapasite 999.
  `DeliveryDate`: bugünden 8 hafta × bölge × {Salı, Perşembe, Cumartesi} = 48 satır; `cutoffAt` = teslimattan 1 gün önce 12:00
  Europe/Istanbul — `packages/shared` `nextDeliveryDates/computeCutoffAt` (fromZonedTime) ile.
- **Setting**: `commerce.*` (17 anahtar — `@bagdam/shared` `COMMERCE_SETTINGS_DEFAULTS` tek kaynak; fiyatlama kuralları
  `freeShippingRule`/`discountRounding`/`subscriberFreeShipping` dahil, ADR-0018), `cookies.analyticsEnabled`,
  `payment.iyzico {enabled:false, nonThreeDsGranted:false}`, `seo.<sayfa> {title}` (12 sayfa). **Gizli anahtar yok** [B33];
  kargo/eşik Setting'de değil, DeliveryZone'da [B11].
- **SiteContent (F5)**: `content/site-content.json` değerleri — `website/index|urunler|kutu|nasil-seciyoruz|toptan|gunluk.html`
  metinleri birebir (22 anahtar; şema `@bagdam/shared` `ContentSchema` `{fields:[{name,label,type,…}]}`, registry'den kopyalanır).
  `home.featured` = `{items:[{type,ref,order}]}` (website/index.html kart sırası: 7 ürün + `sezon` tier). Kategori sekmeleri ve
  panel notları SiteContent'te DEĞİL — Category tablosundan (`label`, `panelNote` [B11]; ikon `assets/icons/<slug>.png`).
  `sepet/uyelik.texts` **F9**.
- **LegalDocument (F5)**: `content/legal.json` — kind eşlemesi `gizlilik`→PRIVACY, `kullanim-kosullari`→TERMS, `mesafeli-satis`→DISTANCE_SALES
  (requiresAck), `teslimat`→DELIVERY, `iptal-iade`→RETURNS, `kvkk`→KVKK (requiresAck), `cerez`→COOKIE, `cerez-ayarlari`→COOKIE_SETTINGS
  (sortOrder = politikalar.html nav sırası) + `on-bilgilendirme`→PREINFO, `abonelik-sozlesmesi`→SUBSCRIPTION_CONTRACT, `ticari-ileti-izni`→MARKETING_CONSENT
  (`showInNav=false`; politikalar sayfasında gizli makale olarak basılır, `#slug` ile açılır — B16 doğrulandı).
- **Post (F5)**: `content/posts.json` — `cavdar-ekmegi` (Söyleşi · 5 dk · 16.08.2026, kapak `urunler/sadeekmek.jpg`), `zeytinyagi`
  (Söyleşi · 6 dk · 10.08.2026, `urunler/zeytinyagi.jpg`), `incir` (Mevsim · 4 dk · 07.08.2026, `scene-originals/fig.jpg`).

## İdempotentlik

Tekrar çalıştırmak kayıt çoğaltmaz (slug/key/unique ile upsert):

| Varlık | Tekrar çalıştırmada |
|---|---|
| Category, Producer, Product, ProductImage, ProductLot, MediaFile, BoxTier, BoxTemplate(+Item) | Seed'in sahip olduğu alanlar seed değerine çekilir (F3 bootstrap paritesi); `Product.status/stockStatus/vatRate/extraOptions` ve admin'in eklediği başka satırlar dokunulmaz; id'ler korunur; listeden çıkan seed görseli/şablon öğesi silinir. |
| DeliveryZone | Yoksa oluşturulur; varsa yalnız `name/sortOrder` (fee/freeThreshold/capacity admin'in). |
| DeliveryDate | `(zone, date)` yoksa oluşturulur; varsa yalnız `day/cutoffAt` tazelenir (`reserved/capacity/status` korunur). Ufuk kaydıkça yeni tarihler eklenir (cron ile aynı davranış). |
| Setting | Yalnız yoksa oluşturulur (`SEED_OVERWRITE_SETTINGS=true` ile ezilir). |
| SiteContent | `key` yoksa oluşturulur; varsa **değer korunur, şema/etiket registry'den tazelenir** (yeni alan eklenince admin formu güncel kalır); F3'ün eski biçimli satırı (`fields[].key`) otomatik yeni biçime çekilir; `SEED_OVERWRITE_CONTENT=true` ile değer de ezilir. |
| LegalDocument | `(slug, version=1)` yoksa oluşturulur (aynı slug'ın başka `isCurrent` satırı varsa bayrağı düşer); varsa yalnız `SEED_OVERWRITE_CONTENT=true` ile ezilir. Admin'in açtığı v2+ sürümlere dokunulmaz. |
| Post | `slug` yoksa oluşturulur; varsa yalnız `SEED_OVERWRITE_CONTENT=true` ile ezilir. Kapak MediaFile'ı `path` ile bulunur (yoksa uyarı, kapaksız). |
| User (admin) | Yoksa oluşturulur; varsa rol/aktiflik/doğrulama eşitlenir, parola env ile uyuşmuyorsa güncellenir. |

Doğrulama (lokal, 2026-08-20): iki ardışık `pnpm db:seed` → categories 4 · producers 15 · products 22 · product_images 27 ·
product_lots 22 · media_files 29 · box_tiers 2 · box_templates 2 (weekStart 2026-08-17) · box_template_items 16 ·
delivery_zones 2 · delivery_dates 48 · settings 28 · site_content 3 · users 1 — ikinci çalıştırmada sayılar değişmedi.
F5 (2026-08-20): `SEED_OVERWRITE_CONTENT=true pnpm db:seed` → site_content 22 (19 yeni + 3 eski biçimden) · legal_documents 11
(nav 8) · posts 3; ardından bayraksız `pnpm db:seed` → 0 oluşturuldu / 22 · 11 · 3 korundu (idempotent).

## Sonraki fazlarla ilişki

- **F3** bootstrap (`GET /bootstrap`) bu verinin products.js şekline birebir dönmesini snapshot testiyle doğrular
  (`catalog.json` ham alanları korur; `tab=category.legacyTab`, `why/batch` lot'tan, `img/images` MediaFile yolundan).
- **F4** `media:import`: 58 görselin tamamı (ikon/logo/sahne dahil) orijinal yoluyla; burada açılan 29 MediaFile kaydıyla
  path üzerinden eşleşmeli (çoğaltma yok), ProductImage/BoxTier bağları zaten kurulu.
- **F5** içerik seed'i (bu README'deki `content/**`): şablonlar `{{{site.*}}}` / `{{#each legal|legalDocs|posts|categories}}` okur
  (`apps/api/views/*.hbs` + `partials/site-footer|promo-bar|journal-post.hbs`; veri `apps/api/src/web/content-view.ts`,
  kaynak `web/site-content.reader.ts` → ContentService'e geçirilecek). Değerler seed ile aynıyken render `website/*.html` ile
  piksel-piksel aynı (`tools/visual-parity/run.mjs` 30/30 0 px, 2026-08-20); byte düzeyinde yalnız: footer `mapsUrl` `&`→`&amp;`,
  metin içi `"`→`&quot;` (2 satır, nasil-seciyoruz), politikalar'da 3 gizli taslak makale, toptan form script'i.
- **F7** `0003_commerce` sonrası bu seed değişmez; abonelik/sipariş verisi seed'lenmez.
