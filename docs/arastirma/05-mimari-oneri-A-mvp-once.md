> **Mimari öneri A — MVP-önce (KAZANAN)** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 2 — mimar). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

<!-- summary: Yığın: Node 20 + NestJS 11 + Prisma 6 + PostgreSQL 14 (sunucuda zaten kurulu, uyanisakademi konvansiyonuyla birebir), tek PM2 süreci (bagdam-api :5010) hem /api/v1 hem de mevcut HTML sayfalarını Handlebars şablonu olarak render eder; admin Vite+React SPA (admin.bagdam.com) UA admin iskeletinin kopyasıdır. Frontend stratejisi "(b)-lite": 10 HTML dosyası değiştirilmeden views/ altına alınır, products.js yerine sunucu her sayfaya inline `var PRODUCTS/SUB_TIERS/...` bootstrap'ı enjekte eder — cart.js (1235 satır) ve sayfa içi script'ler sıfır değişiklikle çalışmaya devam eder (bare-identifier + typeof guard'larla doğrulandı), CMS metinleri {{ }} ile aynı markup içinde render edilir; piksel koruması Playwright screenshot baseline ile denetlenir. En kritik sıralama kararı: Faz 1'de statik site monorepo içinden canlıya alınır (walking skeleton), Faz 2'de ödeme/abonelik/sipariş dahil TÜM şema tek migration'la dondurulur ve ancak ondan sonra katalog→admin→CMS→auth→checkout(iyzico CF + kart saklama)→abonelik motoru (cycle bazlı, kesimde tahsilat) sırasıyla gidilir; site her fazda çalışır durumdadır. Toplam ~44 geliştirici-günü (tek dev ~9 hafta, 2 dev ~6 hafta); ilk "dinamik site + admin" teslimi 4. faz sonunda (~14 gün). Tek DB kuralına bilinçli olarak UYULMAZ: lokal PG + migrate dev lokal, prod'a yalnız migrate deploy (UA'da 163 test siparişi prod'a sızdı; migrate dev reset riski; KVKK). En büyük riskler: (1) ödeme — iyzico saklı karttan NON3D merchant-initiated tahsilat yetkisi ve iyzico formunun tasarım içinde görünümü; (2) iş kuralı belirsizlikleri (kesim saati, ilk-kutu indirimi, atlama hakkı, fresh ürün tekil satışı) şema dondurulmadan kapatılmazsa abonelik motoru yeniden yazılır; (3) tek kişilik ekipte kapsam sürünmesi — bu yüzden BoxWeek şablonu, kupon, kargo API, SMS, WhatsApp, pause, çoklu adres MVP dışında tutuldu. -->

# 1. Yığın kararı — dil, framework, ORM, DB, frontend stratejisi (mevcut statik HTML/CSS/JS nasıl dinamikleşir: (a) aynı HTML'i koruyup fetch ile API'den besleme, (b) SSR/şablon motoru, (c) SPA'ya taşıma — seçimini ve NEDENİNİ yaz; tasarımın piksel düzeyinde korunması şart), admin panel yığını, paket yöneticisi, repo düzeni (monorepo mu, ayrı repo mu; public repo kısıtı).

## 1.1 Özet karar tablosu

| Katman | Karar | Neden (MVP-önce) |
|---|---|---|
| Dil / runtime | TypeScript, **Node 20.20** (sunucuda kurulu) | Sunucuya yeni runtime kurulmaz; PHP/Laravel yolu bahcedenal'da hiç deploy olamadı. |
| API | **NestJS 11 + Prisma 6 + PostgreSQL 14** | uyanisakademi (UA) ile aynı iskelet → auth/settings/media/pricing/exception-filter/audit modülleri kopyalanır; Prisma migration disiplini hazır; PG 14 zaten 127.0.0.1:5432'de. Fastify/Express'ten daha "ağır" ama kopyalanacak kod miktarı haftalar kazandırır. |
| Web (müşteri sitesi) | **(b)-lite: mevcut HTML dosyaları, olduğu gibi, Handlebars görünümleri olarak aynı NestJS süreci tarafından render edilir** + sayfaya inline "bootstrap" JSON enjekte edilir; `cart.js` ve sayfa içi script'ler **değişmeden** çalışır | Aşağıda 1.2. |
| Admin | **Vite 6 + React 19 + TS + Tailwind 4 + react-router 7** (UA `apps/admin` iskeletinin kopyası), nginx'ten statik, `admin.bagdam.com` | Kanıtlanmış iskelet (RequireAdminAuth, AdminLayout, useApi, AdminScrollTable, MediaPicker…). Sıfırdan admin yazmak en büyük zaman kaybı olurdu. |
| Paket yöneticisi | **pnpm 9** (sunucuda 9.15.9) + turbo | UA deploy.sh ile birebir uyum. |
| Süreç sayısı | **Tek PM2 süreci** `bagdam-api` (:5010) → `/api/v1/*` + HTML view'lar + `/uploads`; nginx `/assets/` ve admin dist'i statik sunar | 1-2 dev, az bakım; in-process cache invalidation tek süreçte trivial; ileride web ayrı sürece taşınabilir (view katmanı ayrı Nest modülü). |
| Repo | **Aynı public repo `nihatbirbudak/bagdam`, pnpm monorepo**; `website/` → `apps/api/views` + `apps/api/public` içine taşınır | Sır yalnız sunucu `.env`'de; `.env.example` sadece anahtar adları; seed admin env'den; müşteri verisi hiçbir zaman repoda değil. Not: repo istenirse ücretsiz private yapılabilir — plan public varsayımıyla yazıldı. |

## 1.2 Frontend stratejisi — neden (b)-lite, neden (a) ve (c) değil

Kanıt (bu oturumda doğrulandı): her sayfa `</body>` öncesinde sırayla `assets/products.js` → `assets/cart.js` → inline `<script>` yükler; `cart.js` global'lere **bare identifier + `typeof` guard** ile erişir (`typeof PRODUCTS !== "undefined" ? PRODUCTS.find(...)`, satır 314, 348, 558, 613, 875, 894, 969, 1017); sayfa içi script'ler (`urunler.html:150+`) `PRODUCTS.filter(...)` ile **anında** (DOMContentLoaded beklemeden) grid basar. Yani sunucu, `products.js` yerine sayfaya şu bloğu basarsa hiçbir istemci kodu değişmeden çalışır:

```html
<script>
window.__BAGDAM__ = {{{bootstrapJson}}};
var PRODUCTS = __BAGDAM__.products, SUB_TIERS = __BAGDAM__.tiers,
    FREQ_OPTIONS = __BAGDAM__.freqOptions, DELIVERY_DAYS = __BAGDAM__.deliveryDays,
    DELIVERY_FEE = __BAGDAM__.deliveryFee;
</script>
<script src="/assets/cart.js?v={{assetVersion}}"></script>
```

- **(a) "HTML'i koru, fetch ile besle"** reddedildi: inline script'ler senkron `PRODUCTS` bekliyor → fetch asenkron olunca 10 sayfanın inline script'i ve cart.js'in yükleme sırası yeniden yazılmalı; CMS metinleri JS ile sonradan yazılınca FOUC (hero/FAQ önce eski metin sonra yeni) — "piksel düzeyinde koruma" hedefiyle çelişir; SEO için içerik JS'e bağımlı kalır.
- **(c) SPA/Next.js'e taşıma** reddedildi: 1235 satırlık cart.js (abonelik taslağı, tercih balonu, yüzen sepet, swap-select, kesim geri sayımı) + kutu.html'in ~450 satır editör mantığı React'e yeniden yazılır; piksel eşleşmesi en riskli yol; MVP'ye haftalar ekler. Hiçbir kazanımı MVP'de gerekmiyor.
- **(b)-lite seçildi**: HTML dosyaları `.hbs` uzantısıyla `views/` altına **byte-byte aynı** kopyalanır; Faz 1'de hiçbir `{{ }}` yokken bile aynı çıktıyı verir (site canlı). Sonra sayfa sayfa (i) bootstrap bloğu, (ii) CMS metinleri `{{site.hero.titleHtml}}` gibi alanlara, (iii) elle yazılmış tekrar eden bloklar (`index.html` 8 öne çıkan kart, pillars, FAQ, trust şeridi, politika sekmeleri, günlük yazıları) aynı markup'la `{{#each}}` partial'larına dönüşür. CSS'e dokunulmaz. **Doğrulama**: Faz 1'de Playwright ile 10 sayfa × 3 genişlik screenshot baseline alınır; her fazda diff ≈ 0 şartı (yalnız içerik farkı kabul).
- URL'ler **`.html` ile aynen korunur** (`/urunler.html?tab=`, `/urun.html?id=incir`, `/kutu.html?tier=sezon`): cart.js ve sayfalarda sabit linkler var; site henüz canlı olmadığı için SEO mirası yok; temiz URL + 301 Faz 10 sonrası isteğe bağlı. Ürün `slug` değerleri mevcut `id`'lerle aynı tutulur.
- **Tek bilinçli tasarım istisnası**: ödeme kart formu (sepet.html 4 input) PCI nedeniyle bizde kalamaz → iyzico Checkout Form (iframe/popup) aynı bölüm kutusu içinde açılır; kart bilgisi localStorage'a asla yazılmaz (`bahceden_card` kaldırılır).
- SEO için ürün grid'lerinin sunucuda basılması (aynı `pcardHtml` markup'ı partial olarak) **P2** — inline script aynı DOM'u yeniden çizmesin diye `data-ssr` bayrağıyla atlanır. MVP'de gerekmez.

## 1.3 İstemci durumu (localStorage) ne olur

| Anahtar | MVP sonrası |
|---|---|
| `bahceden_cart`, `bahceden_prefs`, `bahceden_sub` (satın alınmamış taslak) | **Kalır** (misafir/üye fark etmez; checkout'ta sunucuya gönderilir, sunucu fiyatı yeniden hesaplar). Üye prefs'i `PATCH /me` ile opsiyonel senkron. |
| `bahceden_sub.purchased=true` durumu (canlı abonelik) | **Sunucuya taşınır**: kutu.html/uyelik.html `isLive()` ise `GET /me/subscription` ile aynı `sub` şekline hidrate edilir (`BahcedenCart.remote` adaptörü, Faz 8). |
| `bahceden_member`, `bahceden_session`, `bahceden_card`, `bahceden_orders`, `bahceden_retention_offered`, `bahceden_address` | **Kaldırılır** → cookie oturumu, `/me/orders`, `/me/addresses`, sunucu tarafı retention bayrağı. |
| `?sifirla` | Kalır (yalnız localStorage temizler), prod'da zararsız. |

# 2. Veri modeli — Prisma şema taslağı (model adları + alanlar + tipler + ilişkiler + enum'lar; kod bloğu). Abonelik, kutu/tier, ürün/parti/üretici, sepet/sipariş/ödeme/teslimat, kullanıcı/adres, toptan talep, günlük/içerik, politika/ayar, medya, audit. Hangi alanın hangi frontend öğesine karşılık geldiğini belirt.

İlkeler: UA konvansiyonu (`cuid` id, `@@map snake_case`, `Decimal(10,2)`, `createdAt/updatedAt`, soft delete sadece User/Product/Order), **~26 model**; Hyperlocal'ın 186 tablosu değil. ★ = MVP'de yazılır ama ilk aylarda yalnızca ödeme/abonelik için kullanılır; ☐ = ileriye dönük, ek tablo olarak sonradan gelir (şema kırılmaz): `ProductLot`, `BoxWeek`, `Shipment`, `Coupon` kullanımı, `SmsLog`.

```prisma
// database/schema.prisma — Bağdam v1 (MVP)
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"  url = env("DATABASE_URL") }

// ───────── Enum'lar ─────────
enum UserRole           { CUSTOMER STAFF ADMIN }
enum ProductStatus      { DRAFT ACTIVE HIDDEN }
enum StockStatus        { IN_STOCK LOW SOLD_OUT OUT_OF_SEASON }       // "şu an seçkide yok" durumu
enum DeliveryDay        { SALI PERSEMBE CUMARTESI }                     // products.js DELIVERY_DAYS
enum OrderKind          { SINGLE BOX_ONE_TIME SUBSCRIPTION }            // sepet.html type: tekli / onetime / subscription
enum OrderStatus        { PENDING_PAYMENT PAID PREPARING OUT_FOR_DELIVERY DELIVERED CANCELLED REFUNDED PAYMENT_FAILED }
enum OrderLineKind      { PRODUCT BOX EXTRA }
enum SubscriptionStatus { PENDING ACTIVE PAST_DUE PAUSED CANCELLED }
enum CycleStatus        { SCHEDULED LOCKED SKIPPED CHARGED UNPAID PREPARING OUT_FOR_DELIVERY DELIVERED CANCELLED }
enum CycleItemKind      { BOX_ITEM EXTRA }
enum PaymentProvider    { IYZICO PAYTR MANUAL }
enum PaymentStatus      { PENDING REQUIRES_3DS SUCCEEDED FAILED REFUNDED PARTIAL_REFUNDED }
enum WebhookStatus      { RECEIVED PROCESSED FAILED IGNORED }
enum LeadStatus         { NEW CONTACTED CLOSED }
enum ContentStatus      { DRAFT PUBLISHED }
enum ConsentKind        { PREINFO_ACK CONTRACT_ACK SUBSCRIPTION_CONTRACT_ACK KVKK_ACK MARKETING_EMAIL MARKETING_SMS }
enum SubEventType       { CREATED ACTIVATED TIER_CHANGED FREQ_CHANGED DAY_CHANGED ITEMS_CHANGED PREF_CHANGED
                          EXTRA_ADDED EXTRA_REMOVED SKIP UNSKIP LOCKED CHARGED PAYMENT_FAILED RETRY UNPAID
                          CARD_UPDATED CANCEL_REQUESTED RETENTION_OFFERED RETENTION_USED CANCELLED PAUSED RESUMED }

// ───────── Kullanıcı / adres / bölge ─────────
model User {
  id                    String    @id @default(cuid())
  email                 String    @unique @db.Citext          // sepet/uyelik #loginEmail, #signupEmail
  passwordHash          String
  name                  String?   @db.VarChar(120)            // #custName / #addrName'den türetilir
  phone                 String?   @db.VarChar(30)
  role                  UserRole  @default(CUSTOMER)
  isActive              Boolean   @default(true)
  emailVerifiedAt       DateTime?
  refreshTokenHash      String?                                // tek cihaz yeter (UA kalıbı)
  passwordResetToken    String?   @unique
  passwordResetExpires  DateTime?
  failedLoginAttempts   Int       @default(0)
  lockedUntil           DateTime?
  prefs                 Json?                                  // bahceden_prefs {axis: option} (opsiyonel senkron)
  retentionOfferUsedAt  DateTime?                              // bahceden_retention_offered (üye başına 1)
  marketingOptIn        Boolean   @default(false)              // İYS: pazarlama e-postası onayı
  lastLoginAt           DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?
  addresses       Address[]
  orders          Order[]
  subscriptions   Subscription[]
  paymentMethods  PaymentMethod[]
  consents        Consent[]
  @@map("users")
}

model DeliveryZone {                                           // sepet #custDistrict select: Urla / Çeşme
  id        String  @id @default(cuid())
  name      String  @db.VarChar(60)
  slug      String  @unique @db.VarChar(60)                    // urla, cesme
  isActive  Boolean @default(true)
  sortOrder Int     @default(0)
  addresses     Address[]
  subscriptions Subscription[]
  orders        Order[]
  @@map("delivery_zones")
}

model Address {                                                // bahceden_address + uyelik #addressForm
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fullName  String   @db.VarChar(120)                           // #custName / #addrName
  phone     String   @db.VarChar(30)                            // #custPhone / #addrPhone
  line      String                                              // #custAddress / #addrLine (textarea)
  zoneId    String                                              // #custDistrict (Urla/Çeşme) — uyelik'teki serbest metin select'e çevrilir
  zone      DeliveryZone @relation(fields: [zoneId], references: [id])
  zip       String?  @db.VarChar(10)                            // #custZip / #addrZip
  isDefault Boolean  @default(true)                             // MVP: tek adres; çoklu adres ek maliyetsiz
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  subscriptions Subscription[]
  @@index([userId])
  @@map("addresses")
}

// ───────── Katalog ─────────
model Category {                                               // urunler.html sekmeleri + index mobil sekmeler
  id         String  @id @default(cuid())
  slug       String  @unique @db.VarChar(40)                   // boxes | dairy | firin | cellar  (ürün tab: pantry→cellar eşlemesi seed'de)
  label      String  @db.VarChar(60)                           // "Taze Kutular", "Süt Ürünleri", "Fırın", "Kiler"
  iconPath   String? @db.VarChar(255)                          // assets/icons/{boxes,dairy,firin,cellar}.png
  panelNote  String?                                           // urunler.html:86,92,98 "Kutuya dahil değil — …"
  sortOrder  Int     @default(0)
  isActive   Boolean @default(true)
  products   Product[]
  @@map("categories")
}

model Producer {                                               // products.js meta "Üretici · Köy · Urla" normalize
  id        String  @id @default(cuid())
  name      String  @db.VarChar(120)                           // Hüseyin Dağ, Bağdam Çiftlik…
  slug      String  @unique @db.VarChar(120)
  village   String? @db.VarChar(80)                            // Kuşçular, Zeytineli, Güzelbahçe…
  district  String  @default("Urla") @db.VarChar(80)
  story     String?                                            // ileride üretici sayfası / günlük
  photoPath String? @db.VarChar(255)
  isActive  Boolean @default(true)
  products  Product[]
  @@map("producers")
}

model Product {
  id             String        @id @default(cuid())
  slug           String        @unique @db.VarChar(80)        // products.js id → urun.html?id=, data-add-to-cart
  name           String        @db.VarChar(120)               // name
  categoryId     String                                        // tab (dairy/firin/pantry) veya fresh→boxes
  category       Category      @relation(fields: [categoryId], references: [id])
  group          String?       @db.VarChar(40)                // category: meyve|sebze|bakliyat|süt ürünleri|fırın (öneri/ikon)
  producerId     String?
  producer       Producer?     @relation(fields: [producerId], references: [id], onDelete: SetNull)
  metaNote       String?       @db.VarChar(80)                // meta soneki "— Erken Hasat"; meta = producer.name · village · district [— metaNote]
  price          Decimal       @db.Decimal(10,2)              // price (KDV dahil)
  unit           String        @db.VarChar(40)                // unit: "500 g", "L", "6'lı"… (ekstra miktar seçenekleri unit'e göre)
  boxAmount      String?       @db.VarChar(60)                // boxAmount "kutuda: …"
  vatRate        Int           @default(1)                    // sepet "%1 KDV" gösterimi
  description    String                                       // desc
  whyText        String?                                      // why "neden bunu seçtik" (haftalık güncellenir)
  batchCode      String?       @db.VarChar(40)                // batch "K14-03" (urun.html parti numarası) ☐ ProductLot'a taşınır
  storageText    String?                                      // urun.html:124-130 koda gömülü saklama metni → alan
  allergenText   String?       @db.VarChar(120)               // urun.html:131 "Süt"/"Yok"
  freshnessNote  String?       @db.VarChar(120)               // "Her sabah taze gelir."
  prefLabel      String?       @db.VarChar(40)                // pref.label (olgunluk, boyut…)
  prefOptions    String[]                                     // pref.options
  prefDefault    Int?                                         // pref.def
  isFresh        Boolean       @default(false)                // fresh: true → yalnız kutuda ("kutuda dene" CTA)
  season         String?       @db.VarChar(40)                // season "Ağu–Eyl"
  status         ProductStatus @default(ACTIVE)
  stockStatus    StockStatus   @default(IN_STOCK)             // bu hafta havuzda mı (fresh için "haftanın kutusu" ekranı)
  isFeatured     Boolean       @default(false)                // index.html öne çıkanlar (8 kart)
  featuredOrder  Int           @default(0)
  pairWithBox    Boolean       @default(false)                // kutu.html pairIds ["ekmek","zeytinyagi","beyazpeynir","tereyagi"]
  pairOrder      Int           @default(0)
  sortOrder      Int           @default(0)                    // grid sırası + defaultFill önceliği
  coverImageId   String?
  images         ProductImage[]
  orderLines     OrderLine[]
  cycleItems     CycleItem[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?
  @@index([categoryId]) @@index([status, isFresh])
  @@map("products")
}

model ProductImage {                                           // img (kapak) + images[] (urun.html galeri)
  id        String  @id @default(cuid())
  productId String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  mediaId   String
  media     MediaFile @relation(fields: [mediaId], references: [id])
  alt       String? @db.VarChar(160)
  isCover   Boolean @default(false)
  sortOrder Int     @default(0)
  @@index([productId])
  @@map("product_images")
}

model BoxTier {                                                // products.js SUB_TIERS
  id            String  @id @default(cuid())
  slug          String  @unique @db.VarChar(40)                // small | sezon (kutu.html?tier=)
  label         String  @db.VarChar(80)                        // "10'lu Sezon Kutusu"
  itemCount     Int                                            // count
  price         Decimal @db.Decimal(10,2)                      // price
  note          String? @db.VarChar(160)                       // note "9–10 ürün · kalabalık hane…"
  imagePath     String? @db.VarChar(255)                       // img
  isRecommended Boolean @default(false)                        // RECOMMENDED_TIER rozeti
  isActive      Boolean @default(true)
  sortOrder     Int     @default(0)
  subscriptions Subscription[]
  @@map("box_tiers")
}

// ───────── Sipariş / ödeme ─────────
model Order {
  id               String      @id @default(cuid())
  orderNo          Int         @unique @default(autoincrement()) // "SİPARİŞ #1001" (migration: sequence 1001'den başlar)
  kind             OrderKind
  status           OrderStatus @default(PENDING_PAYMENT)
  userId           String?
  user             User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  subscriptionId   String?
  subscription     Subscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  cycleId          String?     @unique                         // abonelik döngüsünden üretilen sipariş
  cycle            SubscriptionCycle? @relation(fields: [cycleId], references: [id], onDelete: SetNull)
  customerName     String      @db.VarChar(120)                // snapshot (#custName)
  customerEmail    String      @db.VarChar(160)
  customerPhone    String      @db.VarChar(30)
  zoneId           String?
  zone             DeliveryZone? @relation(fields: [zoneId], references: [id], onDelete: SetNull)
  addressSnapshot  Json                                         // {fullName, phone, line, zone, zip}
  deliveryDay      DeliveryDay                                  // #checkoutDeliveryDay
  deliveryDate     DateTime    @db.Date                         // nextDeliveryDate(deliveryDay)
  subtotal         Decimal     @db.Decimal(10,2)
  discountTotal    Decimal     @default(0) @db.Decimal(10,2)    // ilk-kutu %50 / retention / kupon
  shippingFee      Decimal     @default(0) @db.Decimal(10,2)    // 49 / 0 (abone veya >1000)
  vatTotal         Decimal     @default(0) @db.Decimal(10,2)    // gösterim (%1 dahil)
  grandTotal       Decimal     @db.Decimal(10,2)
  couponCode       String?     @db.VarChar(40)                  // ★ BAGDAM050 girilirse
  paidAt           DateTime?
  note             String?                                      // müşteri notu (UI'da yok; ileride)
  adminNote        String?
  ipAddress        String?     @db.VarChar(64)
  userAgent        String?     @db.VarChar(255)
  lines            OrderLine[]
  payments         Payment[]
  consents         Consent[]
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  deletedAt        DateTime?
  @@index([userId]) @@index([status]) @@index([deliveryDate])
  @@map("orders")
}

model OrderLine {                                              // Order.lines[] string'lerinin yapısal hali
  id          String        @id @default(cuid())
  orderId     String
  order       Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  kind        OrderLineKind                                    // PRODUCT (cart item) | BOX (tier) | EXTRA
  productId   String?
  product     Product?      @relation(fields: [productId], references: [id], onDelete: SetNull)
  tierSlug    String?       @db.VarChar(40)
  name        String        @db.VarChar(160)                   // snapshot ("10'lu Sezon Kutusu — 10 ürün", "Salça")
  unit        String?       @db.VarChar(40)
  qty         Decimal       @db.Decimal(8,3)                   // ürün adedi; extra için factor (0.25/0.5/1/2…)
  unitPrice   Decimal       @db.Decimal(10,2)
  lineTotal   Decimal       @db.Decimal(10,2)
  pref        String?       @db.VarChar(60)                    // cart item pref ("Tam kıvamında")
  batchCode   String?       @db.VarChar(40)                    // izlenebilirlik snapshot
  vatRate     Int           @default(1)
  metadata    Json?                                            // BOX için {items:[{productId,name,pref,boxAmount,batchCode}]}
  @@index([orderId])
  @@map("order_lines")
}

model PaymentMethod {                                          // bahceden_card'ın PSP token karşılığı (PAN/CVC asla yok)
  id                  String          @id @default(cuid())
  userId              String
  user                User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider            PaymentProvider
  providerCustomerKey String          @db.VarChar(120)         // iyzico cardUserKey / PayTR utoken
  providerCardToken   String          @db.VarChar(120)         // iyzico cardToken / PayTR ctoken
  bin                 String?         @db.VarChar(8)
  last4               String          @db.VarChar(4)           // uyelik "•••• 1234 — Ad"
  brand               String?         @db.VarChar(30)
  holderName          String?         @db.VarChar(120)
  expMonth            Int?
  expYear             Int?
  isDefault           Boolean         @default(true)
  isActive            Boolean         @default(true)
  createdAt           DateTime        @default(now())
  subscriptions       Subscription[]
  @@index([userId])
  @@map("payment_methods")
}

model Payment {
  id                  String          @id @default(cuid())
  orderId             String
  order               Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  provider            PaymentProvider
  conversationId      String          @unique @db.VarChar(80)  // idempotency anahtarı (bizim ürettiğimiz)
  providerPaymentId   String?         @db.VarChar(120)         // iyzico paymentId
  providerToken       String?         @db.VarChar(160)         // CF token
  amount              Decimal         @db.Decimal(10,2)
  status              PaymentStatus   @default(PENDING)
  is3ds               Boolean         @default(true)
  isMerchantInitiated Boolean         @default(false)          // saklı karttan döngü tahsilatı
  attemptNo           Int             @default(1)
  failureCode         String?         @db.VarChar(40)
  failureMessage      String?         @db.VarChar(255)
  rawResponse         Json?
  paidAt              DateTime?
  refunds             Refund[]
  createdAt           DateTime        @default(now())
  @@index([orderId]) @@index([providerPaymentId])
  @@map("payments")
}

model Refund {
  id                String        @id @default(cuid())
  paymentId         String
  payment           Payment       @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  amount            Decimal       @db.Decimal(10,2)
  reason            String?       @db.VarChar(255)
  providerRefundId  String?       @db.VarChar(120)
  status            PaymentStatus @default(PENDING)
  createdAt         DateTime      @default(now())
  @@map("refunds")
}

model WebhookEvent {                                           // iyzico (ileride PayTR/kargo) — idempotent işleme
  id             String          @id @default(cuid())
  provider       PaymentProvider
  eventType      String          @db.VarChar(80)
  providerRef    String?         @db.VarChar(160)              // paymentId / orderReferenceCode
  payload        Json
  signatureValid Boolean
  status         WebhookStatus   @default(RECEIVED)
  error          String?
  receivedAt     DateTime        @default(now())
  processedAt    DateTime?
  @@unique([provider, eventType, providerRef])
  @@map("webhook_events")
}

// ───────── Abonelik motoru ─────────
model Subscription {                                           // bahceden_sub (purchased=true) karşılığı
  id                 String             @id @default(cuid())
  userId             String
  user               User               @relation(fields: [userId], references: [id])
  tierId             String                                    // tierId
  tier               BoxTier            @relation(fields: [tierId], references: [id])
  status             SubscriptionStatus @default(PENDING)
  frequencyWeeks     Int                @default(1)            // freq: 1hafta|2hafta|4hafta → 1|2|4
  deliveryDay        DeliveryDay                               // deliveryDay
  zoneId             String
  zone               DeliveryZone       @relation(fields: [zoneId], references: [id])
  addressId          String?
  address            Address?           @relation(fields: [addressId], references: [id], onDelete: SetNull)
  paymentMethodId    String?
  paymentMethod      PaymentMethod?     @relation(fields: [paymentMethodId], references: [id], onDelete: SetNull)
  defaultItems       Json                                      // items[] + itemPrefs{} → [{productId, pref}] (kalıcı kutu tercihi)
  discountBoxesLeft  Int                @default(2)            // "ilk 2 kutu %50" kalan hak (settings'ten seed)
  nextBoxDiscountPct Int?                                      // retention "1 kutuluk %50" (sub.nextBoxDiscount)
  skipsUsed          Int                @default(0)            // skipUsed (settings.skipsPerYear ile karşılaştırılır)
  skipsResetAt       DateTime?
  startedAt          DateTime?
  nextDeliveryDate   DateTime?          @db.Date
  nextCutoffAt       DateTime?
  cancelRequestedAt  DateTime?
  cancelledAt        DateTime?
  cancelReason       String?            @db.VarChar(60)        // uyelik data-reason: Fiyat / Ürün çeşitliliği / Teslimat günleri / Diğer
  cancelNote         String?                                   // #cancelReasonText
  contractVersion    Int?                                      // kabul edilen abonelik sözleşmesi sürümü
  cycles             SubscriptionCycle[]
  orders             Order[]
  events             SubscriptionEvent[]
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  @@index([userId]) @@index([status, nextCutoffAt])
  @@map("subscriptions")
}

model SubscriptionCycle {                                      // bir teslimat dönemi ("bu haftaki kutu")
  id             String      @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  cycleNo        Int
  deliveryDate   DateTime    @db.Date
  cutoffAt       DateTime                                      // "DEĞİŞİKLİK İÇİN: X SÜREN VAR" (tek kesim kuralı settings'ten)
  status         CycleStatus @default(SCHEDULED)
  boxPrice       Decimal?    @db.Decimal(10,2)                 // kilitte snapshot
  extrasTotal    Decimal?    @db.Decimal(10,2)
  discount       Decimal?    @db.Decimal(10,2)
  shippingFee    Decimal?    @db.Decimal(10,2)
  total          Decimal?    @db.Decimal(10,2)                 // "Bu haftaki ödeme"
  lockedAt       DateTime?
  skippedAt      DateTime?                                     // skipThisWeek
  skipSource     String?     @db.VarChar(10)                   // user | ops | unpaid
  retryCount     Int         @default(0)                       // dunning: +24s, +72s
  nextRetryAt    DateTime?
  items          CycleItem[]
  order          Order?
  @@unique([subscriptionId, cycleNo])
  @@index([status, cutoffAt]) @@index([deliveryDate, status])
  @@map("subscription_cycles")
}

model CycleItem {                                              // kutu.html #boxItems satırları + #boxExtras
  id              String        @id @default(cuid())
  cycleId         String
  cycle           SubscriptionCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  kind            CycleItemKind                                // BOX_ITEM | EXTRA
  productId       String
  product         Product       @relation(fields: [productId], references: [id])
  swapOfProductId String?       @db.VarChar(40)                // swap-select data-slot ile değiştirilen
  pref            String?       @db.VarChar(60)                // data-item/data-axis/data-value
  qty             Decimal       @default(1) @db.Decimal(8,3)   // EXTRA için factor (0.25/0.5/1/2, 1–4×)
  unit            String?       @db.VarChar(40)
  label           String?       @db.VarChar(80)                // extra.label "500 g"
  unitPrice       Decimal?      @db.Decimal(10,2)              // kilitte snapshot
  batchCode       String?       @db.VarChar(40)                // kilitte snapshot (parti izlenebilirliği)
  sortOrder       Int           @default(0)
  @@index([cycleId])
  @@map("cycle_items")
}

model SubscriptionEvent {                                      // abonelik denetim izi (iptal nedeni, retention, kesim, tahsilat)
  id             String       @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  cycleId        String?
  type           SubEventType
  actor          String       @db.VarChar(10)                  // user | system | admin
  data           Json?
  createdAt      DateTime     @default(now())
  @@index([subscriptionId, createdAt])
  @@map("subscription_events")
}

// ───────── Toptan / içerik / yasal / ayar / medya / audit ─────────
model WholesaleLead {                                          // toptan.html #notifyForm (yalnız e-posta) + ileride alanlar
  id           String     @id @default(cuid())
  email        String     @db.VarChar(160)
  businessName String?    @db.VarChar(160)
  phone        String?    @db.VarChar(30)
  note         String?
  status       LeadStatus @default(NEW)
  source       String     @default("toptan.html") @db.VarChar(40)
  createdAt    DateTime   @default(now())
  @@map("wholesale_leads")
}

model Post {                                                   // gunluk.html yazıları + index teaser
  id              String        @id @default(cuid())
  slug            String        @unique @db.VarChar(120)       // cavdar-ekmegi, zeytinyagi, incir (#anchor)
  kind            String        @db.VarChar(30)                // "Söyleşi" | "Mevsim"
  readMinutes     Int           @default(4)
  titleHtml       String                                       // "bir annenin ekmeği, <em>iki sofrada</em>"
  excerpt         String?
  bodyHtml        String                                       // p + pull-quote + ürün linkleri
  coverMediaId    String?
  relatedSlugs    String[]                                     // ürün slug'ları (sadeekmek, cevizliekmek)
  status          ContentStatus @default(DRAFT)
  publishedAt     DateTime?
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@map("posts")
}

model Policy {                                                 // politikalar.html 8 sekme (data-policy)
  id          String   @id @default(cuid())
  slug        String   @unique @db.VarChar(60)                 // gizlilik, mesafeli-satis, iptal-iade…
  title       String   @db.VarChar(160)
  leadHtml    String?                                          // .policy-lead
  bodyHtml    String                                           // h2 + p bölümleri
  version     Int      @default(1)                             // her yayınlamada +1; Consent'e yazılır
  shownUpdatedAt DateTime                                      // "SON GÜNCELLEME: 18 AĞUSTOS 2026"
  requiresAck Boolean  @default(false)                         // checkout'ta onay kutusu ister mi
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  consents    Consent[]
  updatedAt   DateTime @updatedAt
  @@map("policies")
}

model Consent {                                                // mesafeli satış/abonelik/KVKK onay kaydı (3 yıl saklanır)
  id         String      @id @default(cuid())
  userId     String?
  user       User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  orderId    String?
  order      Order?      @relation(fields: [orderId], references: [id], onDelete: SetNull)
  kind       ConsentKind
  policyId   String?
  policy     Policy?     @relation(fields: [policyId], references: [id], onDelete: SetNull)
  version    Int?
  granted    Boolean     @default(true)
  ipAddress  String?     @db.VarChar(64)
  userAgent  String?     @db.VarChar(255)
  createdAt  DateTime    @default(now())
  @@index([userId]) @@index([orderId])
  @@map("consents")
}

model SiteContent {                                            // sayfa blokları (hero, pillars, faq, footer…) anahtar→JSON
  key        String   @id @db.VarChar(80)                      // "home.hero", "home.faq", "footer", "promoBar", "urunler.trust"…
  value      Json
  updatedBy  String?
  updatedAt  DateTime @updatedAt
  @@map("site_content")
}

model Setting {                                                // ticari kurallar + entegrasyon ayarları (UA SiteSetting kalıbı)
  key       String   @id @db.VarChar(100)                      // "commerce.deliveryFee", "commerce.cutoff", "mail.smtp"…
  group     String   @db.VarChar(40)
  value     Json
  isSecret  Boolean  @default(false)                           // şifreli saklanır, API'de maskelenir
  updatedAt DateTime @updatedAt
  @@map("settings")
}

model MediaFile {                                              // medya kütüphanesi (uploads/ + sharp webp/thumb)
  id            String   @id @default(cuid())
  path          String   @db.VarChar(255)                      // /uploads/2026/08/xyz.webp
  thumbPath     String?  @db.VarChar(255)
  originalName  String   @db.VarChar(255)
  mimeType      String   @db.VarChar(80)
  size          Int
  width         Int?
  height        Int?
  alt           String?  @db.VarChar(160)
  folder        String   @default("genel") @db.VarChar(80)     // urunler | kutular | blog | sahne | ikonlar
  createdAt     DateTime @default(now())
  productImages ProductImage[]
  @@map("media_files")
}

model AuditLog {                                               // admin mutasyonları (UA AuditLogInterceptor)
  id         String   @id @default(cuid())
  actorId    String?
  actorEmail String?  @db.VarChar(160)
  action     String   @db.VarChar(20)                          // CREATE | UPDATE | DELETE | STATUS
  module     String   @db.VarChar(40)
  entityId   String?  @db.VarChar(60)
  summary    String?  @db.VarChar(255)
  oldValues  Json?
  newValues  Json?
  ipAddress  String?  @db.VarChar(64)
  createdAt  DateTime @default(now())
  @@index([module, entityId]) @@index([createdAt])
  @@map("audit_logs")
}
```

**Migration notları:** `ALTER SEQUENCE orders_order_no_seq RESTART WITH 1001;` (ilk sipariş #1001); `CREATE EXTENSION IF NOT EXISTS citext;`; `payments` için `UNIQUE (provider_payment_id) WHERE status='SUCCEEDED'` partial index (UA `payments_gatewayRef_paid_partial_unique` kalıbı).

**`Setting` anahtarları (seed, commerce grubu — cart.js/sepet.html sabitlerinin karşılığı):**

| key | value (seed) | Frontend kaynağı |
|---|---|---|
| `commerce.deliveryFee` | 49 | products.js DELIVERY_FEE |
| `commerce.freeShippingThreshold` | 1000 | sepet.html:425,573 |
| `commerce.vatRate` | 1 | sepet.html:491 |
| `commerce.deliveryDays` | `["SALI","PERSEMBE","CUMARTESI"]` + etiketler | DELIVERY_DAYS |
| `commerce.frequencies` | `[{id:"1hafta",weeks:1,label:"Haftada 1"},…]` | FREQ_OPTIONS |
| `commerce.cutoff` | `{daysBefore:1, time:"12:00"}` (**KARAR**; tek kural) | cart.js:1034 vs :1057 çelişkisi |
| `commerce.firstBoxDiscount` | `{pct:50, boxes:2}` | promo bar, kutu.html:496 |
| `commerce.skipsPerYear` | 1 | skipUsed / politika "yılda bir kez" |
| `commerce.retentionOffer` | `{pct:50, boxes:1}` | uyelik.html retention |
| `commerce.extraAmountOptions` | `{kg:[0.25,0.5,1,2], "500 g":[1,2,3], default:[1,2,3,4]}` | cart.js:947-966 |
| `commerce.deliveryWindow` | "09:00–18:00" | politikalar:115 |
| `mail.smtp` (secret), `payment.iyzico.enabled`, `site.analytics` | — | — |

**`SiteContent` anahtarları:** `promoBar{text,code}`, `home.hero{bgImage,titleHtml,subtitle,ctaText,ctaHref}`, `home.pillars[4]`, `home.showcase`, `home.cloud`, `home.blocks`, `home.faq[]`, `urunler.trust[4]`, `kutu.notes{editorNotes[2],typeTooltip,extrasNote}`, `sepet.texts`, `uyelik.texts{cancelReasons[],retentionText,…}`, `manifesto.*` (nasil-seciyoruz blokları), `toptan.*`, `gunluk.hero/close`, `footer{phone,address,mapsUrl,instagramUrl,youtubeUrl,legalName,year}`, `seo.titles{page:title}`.

# 3. API yüzeyi — modül listesi ve uç noktalar (public / auth / admin ayrımı), kimlik doğrulama modeli (JWT+refresh, cookie/bearer), rol modeli.

Önek `/api/v1`. Tüm admin uçları `/api/v1/admin/*` altında, class-level `@Roles('ADMIN','STAFF') @Audited`.

| Modül | Public | Auth (CUSTOMER) | Admin |
|---|---|---|---|
| **health** | `GET /health` (alan adı/DB detayı yok) | — | `GET /admin/health/detailed` |
| **auth** | `POST /auth/register` `{email,password}` (signup formu), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/forgot`, `POST /auth/reset`, `GET /auth/csrf` | `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me` (name, phone, prefs), `PATCH /auth/me/password` | — |
| **me** | — | `GET/PUT /me/address` (tek/varsayılan adres; liste CRUD'u aynı uçta `addresses` P2), `GET /me/orders`, `GET /me/orders/:orderNo`, `GET /me/cards`, `DELETE /me/cards/:id`, `POST /me/cards/add-session` (iyzico 1 TL/registerCard akışı, Faz 8) | — |
| **catalog** | `GET /bootstrap` (products[ACTIVE], tiers, freqOptions, deliveryDays, deliveryFee, commerce ayarları, promoBar — cart.js global'leri; 60 sn in-process cache), `GET /products?category=&fresh=&featured=`, `GET /products/:slug`, `GET /tiers`, `GET /producers` | — | `CRUD /admin/products`, `PATCH /admin/products/:id/status|featured|pair|sort`, `POST /admin/products/:id/images`, `CRUD /admin/categories`, `CRUD /admin/producers`, `CRUD /admin/tiers`, `GET/PUT /admin/box-week` (fresh havuzu: stockStatus/sortOrder/batchCode/whyText toplu güncelleme) |
| **content** | `GET /site-content` (tüm anahtarlar; view render'ında iç çağrı), `GET /posts?limit=3`, `GET /posts/:slug`, `GET /policies`, `GET /policies/:slug` | — | `GET/PUT /admin/site-content/:key`, `CRUD /admin/posts`, `CRUD /admin/policies` (+ `POST …/publish` → version+1), `GET/PUT /admin/settings/:group` |
| **wholesale** | `POST /wholesale-leads` `{email,businessName?,phone?,note?}` (throttle 3/dk/IP) | — | `GET /admin/wholesale-leads`, `PATCH …/:id` (status) |
| **checkout / orders** | `POST /checkout/quote` (sepet+sub payload → sunucu tutarları; sepet.html özet bu değerleri basar) | `POST /checkout` (Order + lines + Subscription PENDING + ilk cycle + iyzico CF init → `{paymentPageUrl|checkoutFormContent, conversationId}`), `GET /orders/:orderNo/status` | `GET /admin/orders?status=&kind=&date=`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status` (geçiş tablosu), `POST /admin/orders/:id/notes`, `GET /admin/orders/export.csv?deliveryDate=` |
| **payments** | `POST /payments/iyzico/callback` (CF token → retrieve → Order PAID / Subscription ACTIVE / PaymentMethod kaydı → 302 `/sepet.html?siparis=<no>`), `POST /webhooks/iyzico` (HMAC-SHA256 `X-IYZ-SIGNATURE-V3`, WebhookEvent upsert, idempotent) | — | `POST /admin/payments/:id/refund` |
| **subscriptions** | — | `GET /me/subscription` (aktif abonelik + güncel cycle, cart.js `sub` şekline hazır DTO), `PATCH /me/subscription` (freq, deliveryDay, addressId, paymentMethodId, defaultItems), `PATCH /me/subscription/cycles/current` (items swap/pref, extras add/remove — kesim öncesi), `POST /me/subscription/cycles/current/skip`, `DELETE …/skip`, `POST /me/subscription/cancel` `{reason, note}` → retention teklifi döner, `POST /me/subscription/retention/accept`, `POST /me/subscription/cancel/confirm` | `GET /admin/subscriptions?status=`, `GET /admin/subscriptions/:id` (events, cycles), `PATCH /admin/subscriptions/:id` (status, ops skip, note), `GET /admin/cycles?deliveryDate=&status=`, `PATCH /admin/cycles/:id/status`, `GET /admin/cycles/pick-list?deliveryDate=` (ürün × adet), `GET /admin/cycles/packing-list?deliveryDate=` (kutu başına fiş) |
| **customers** | — | — | `GET /admin/customers`, `GET /admin/customers/:id` (adres, siparişler, abonelik, kartlar-last4), `PATCH /admin/customers/:id` (isActive) |
| **media** | `GET /uploads/*` (nginx statik) | — | `POST /admin/media` (multipart, 20 MB, jpeg/png/webp → sharp webp + thumb), `GET /admin/media?folder=`, `PATCH /admin/media/:id` (alt), `DELETE /admin/media/:id` (kullanım kontrolü) |
| **dashboard / audit** | — | — | `GET /admin/dashboard` (bugünkü sipariş, aktif abonelik, bu haftanın cycle'ları, tükenen ürün), `GET /admin/audit-logs` |
| **jobs (iç, cron)** | — | — | `@Cron` yalnız `NODE_APP_INSTANCE` yok/0: her saat `cycles:ensure` (aktif abonelere sonraki cycle), her 10 dk `cycles:lock-and-charge` (cutoffAt geçenler), her saat `payments:retry`, günlük 03:10 `cleanup` (system log; audit asla) |
| **web (view)** | `GET /`, `/index.html`, `/urunler.html`, `/urun.html`, `/kutu.html`, `/sepet.html`, `/uyelik.html`, `/gunluk.html`, `/toptan.html`, `/politikalar.html`, `/nasil-seciyoruz.html` (hbs render + bootstrap), `/sitemap.xml`, `/robots.txt` | — | — |

**Kimlik doğrulama:** UA `auth` modülünün kopyası — access JWT 15 dk + refresh 30 gün (rotasyon, `User.refreshTokenHash` bcrypt), ikisi de **httpOnly + Secure + SameSite=Lax cookie** (`access_token`, `refresh_token`; path `/api`). Web sayfaları ve admin SPA'sı API'ye **aynı origin** üzerinden gider (nginx her iki vhost'ta `/api/` → 5010 proxy), dolayısıyla CORS/`Domain=` ayarı gerekmez. CSRF: UA `CsrfGuard` (double-submit `XSRF-TOKEN` cookie + `X-CSRF-Token` header) — state değiştiren tüm uçlarda; iyzico callback/webhook `@Public` + imza doğrulama ile muaf. Bearer desteği yalnız test/script için. Login throttle: nginx `login 3r/m` + Nest `@Throttle(5,60)`; 5 hatalı deneme → 30 dk kilit. Parola sıfırlama e-posta ile. E-posta doğrulama MVP'de yok (checkout'ta e-posta zaten sipariş onayıyla doğrulanır) — P2.

**Roller:** `CUSTOMER` (web), `STAFF` (admin: katalog/içerik/sipariş/abonelik operasyonu; ayarlar-ödeme-müşteri silme hariç), `ADMIN` (her şey + ayarlar + iade + kullanıcı yönetimi). Permission tabloları yok (UA'da da enforce edilmiyordu) — `RolesGuard` + enum yeterli.

# 4. Admin panel — ekran listesi (öncelik etiketli), her ekranın hangi tabloyu yönettiği, medya kütüphanesi, içerik (CMS) ekranları, sipariş/abonelik operasyon ekranları, ayarlar.

Yığın: UA `apps/admin` iskeleti (AdminApp, RequireAdminAuth, AdminLayout/TopBar/Sidebar/BottomNav, useApi/useMutation, AdminToolbar/ScrollTable/FormAside/ConfirmModal, RichTextEditor(tiptap), MediaPickerModal). Auth: cookie (localStorage token yok). Menü (`adminNavConfig.ts`): Özet · Katalog · Haftanın Kutusu · Siparişler · Abonelikler · Teslimatlar · Müşteriler · Toptan · İçerik · Medya · Ayarlar · Sistem.

| # | Ekran | Öncelik | Tablo(lar) | Not |
|---|---|---|---|---|
| 1 | Giriş | P0 (Faz 4) | User | ADMIN/STAFF; cookie auth |
| 2 | Ürünler — liste | P0 | Product, Category, Producer | filtre: kategori/fresh/status/stok; sürükle-sırala (`sortOrder`), featured/pair toggle inline |
| 3 | Ürün formu | P0 | Product, ProductImage, MediaFile | tüm §2 alanları; pref (label+options+def); görsel galerisi (kapak işaretle, sırala); "urun.html önizle" linki |
| 4 | Kategoriler | P0 | Category | 4 sekme; ikon, panel notu, sıra |
| 5 | Üreticiler | P0 | Producer | ad/köy/ilçe/hikâye/foto |
| 6 | Kutu tier'ları | P0 | BoxTier | fiyat, adet, not, görsel, önerilen |
| 7 | Haftanın Kutusu | P0 | Product (isFresh) | fresh ürün listesi: havuzda mı (stockStatus), sıra, parti kodu, "neden seçtik" inline düzenleme, sezon; ☐ BoxWeek şablonu sonradan |
| 8 | Medya kütüphanesi | P0 | MediaFile | klasör filtresi, upload (çoklu), alt metin, kullanım sayısı, silme koruması; ürün/blog/içerik formlarından picker |
| 9 | Site İçeriği | P1 (Faz 5) | SiteContent | anahtar başına form (hero, pillars, showcase, cloud, blocks, FAQ listesi, trust şeridi, panel notları, kutu editör notları, manifesto, toptan metinleri, günlük hero/kapanış, sepet/uyelik metinleri); HTML alanları için RichText (em vurgusu) |
| 10 | Kampanya şeridi & Footer & İletişim | P1 | SiteContent (`promoBar`, `footer`) | telefon, adres, maps, IG/YT, yıl, yasal unvan |
| 11 | Blog yazıları | P1 | Post | tür, süre, tarih, başlık (em), kapak, gövde (tiptap), ilişkili ürünler, yayın durumu |
| 12 | Politikalar | P1 | Policy | 8 sekme; yayınla → version+1; "onay gerektirir" bayrağı |
| 13 | Toptan talepleri | P1 | WholesaleLead | liste, durum, CSV |
| 14 | Ayarlar › Teslimat & Fiyatlandırma | P1 | Setting (commerce.*), DeliveryZone | kargo ücreti, ücretsiz eşik, KDV, teslimat günleri, frekanslar, kesim kuralı, ilk kutu indirimi, atlama hakkı, retention, ekstra miktar seçenekleri, bölgeler |
| 15 | Ayarlar › E-posta / Ödeme / SEO | P1–P2 | Setting (mail.*, payment.*, seo.*) | SMTP (şifreli), iyzico açık/kapalı (anahtarlar `.env`'de), sayfa başlıkları |
| 16 | Müşteriler | P1 (Faz 6) | User, Address, Order, Subscription, PaymentMethod(last4) | liste/detay; pasifleştir; KVKK silme talebi (anonimleştir) |
| 17 | Siparişler — liste/detay | P0 (Faz 7) | Order, OrderLine, Payment | filtre durum/tür/teslimat tarihi; detay: satırlar, adres, ödeme, durum geçişi (izinli geçişler), not, iade başlat; CSV |
| 18 | Abonelikler — liste/detay | P0 (Faz 8) | Subscription, SubscriptionEvent, PaymentMethod | durum, tier, gün, frekans, kalan indirim, olay akışı, iptal nedeni, ops "bu haftayı atla", kart durumu |
| 19 | Teslimatlar (bu hafta) | P0 (Faz 8) | SubscriptionCycle, CycleItem, Order | tarihe göre cycle+tekil sipariş listesi; durum toplu güncelle (Hazırlanıyor→Yolda→Teslim); **pick-list** (ürün × toplam adet, üretici bazlı) ve **packing fişi** (kutu başına içerik+tercih+parti+adres) PDF/CSV |
| 20 | Özet (dashboard) | P1 | türetilmiş | bugünkü/haftalık siparişler, aktif abonelik, kesimde bekleyen, başarısız tahsilat, tükenen ürün, yeni toptan talebi |
| 21 | Sistem › Audit log / Webhook olayları | P2 | AuditLog, WebhookEvent | salt okunur |
| 22 | Kuponlar | P2 | (Coupon ☐) | MVP'de promo "ilk 2 kutu" kuraldır, kod girişi yok |

# 5. Geliştirme sırası — numaralı fazlar/adımlar; HER adım için: kapsam, ön koşul (hangi adımlara bağlı), çıktı/tanım-of-done, neden bu sırada (tekrar geri dönmeyi önleme gerekçesi), tahmini efor (gün).

Efor = tek kıdemli dev, UA'dan kopya-uyarla varsayımıyla. 2 dev'de: A = API/şema/ödeme, B = admin/şablon/içerik; Faz 4-5 ile 6-7 paralel yürür.

**Faz 0 — Karar sprinti + operasyonel ön koşullar (2 gün, kod yok; operasyon paralelde sürer)**
- Kapsam: §8'deki "şemayı etkileyen" 8 kararı kapat ve `docs/adr/0001…0010.md` (≤25 satır) yaz: kesim kuralı (tek), ilk-kutu indirimi kuralı, atlama hakkı, teslimat bölgesi = Urla+Çeşme kendi kurye (kargo yok), fresh ürünler tekil satılmaz, ödeme = iyzico CF + kart saklama, auth = e-posta+parola, URL'ler `.html` korunur, dev DB = lokal. iyzico sandbox başvurusu; Cloudflare hesabına `bagdam.com` zone ekleme planı; ETBİS / İşletme Kayıt Belgesi / İYS / e-Arşiv yolu (mali müşavir) başvurularını başlat.
- Ön koşul: yok. DoD: ADR'ler commit'lendi; sandbox anahtarları alındı; NS değişimi için registrar erişimi var.
- Neden: §2 şeması ve abonelik motoru bu kararlara bağlı; sonradan değişirse Faz 8 yeniden yazılır.

**Faz 1 — Walking skeleton: monorepo + mevcut statik site canlıda (3 gün)**
- Kapsam: pnpm monorepo (`apps/api`, `apps/admin`, `packages/shared`(ince), `database/`), NestJS `main.ts/app.module.ts` UA'dan (helmet, compression, cookie-parser, ValidationPipe, AllExceptionsFilter, RequestId, Throttler, trust proxy), `GET /api/v1/health`; **view katmanı**: `website/*.html` → `apps/api/views/*.hbs` (byte-byte aynı), `website/assets` → `apps/api/public/assets`; `WebController` her `.html` yolunu render eder; admin Vite iskeleti (login sayfası, "yakında"); `ecosystem.config.js`, `deploy.sh`, GitHub Actions, nginx vhost'ları, LE sertifikaları, Cloudflare DNS kesimi (Full strict), `backup-bagdam.sh` + health-check'e 5010 ekleme. Playwright screenshot baseline (10 sayfa × mobil/tablet/masaüstü).
- Ön koşul: Faz 0 (sadece DNS erişimi). DoD: `https://bagdam.com` mevcut statik siteyle aynı (screenshot diff 0), `/api/v1/health` 200, `admin.bagdam.com` login ekranı, `git push main` → deploy; yedek cron ilk dump'ı aldı.
- Neden: bahcedenal dersinin tersi — altyapı ilk gün kanıtlanır, sonraki her faz canlıda doğrulanır; site hiç kapanmaz.

**Faz 2 — Şema v1 + ilk migration + seed (3 gün)**
- Kapsam: §2 şemasının tamamı (ödeme/abonelik/sipariş dahil) **tek `0001_init` migration**; `database/seeds/`: `import-products.ts` (`products.js`'i `vm.runInNewContext` ile çalıştırıp PRODUCTS/SUB_TIERS/FREQ/DAYS okur → Product/Producer(meta parse)/BoxTier/Category), `seed-settings.ts` (commerce.*), `seed-site-content.ts` (HTML'den elle çıkarılmış JSON), `seed-policies.ts` + `seed-posts.ts` (politikalar/gunluk HTML'inden), `seed-zones.ts`, `seed-admin.ts` (env'den). Görseller `public/assets/images/*` yollarıyla `MediaFile`'a kaydedilir (kopyalamadan).
- Ön koşul: Faz 0 kararları, Faz 1 (DB erişimi/deploy). DoD: `prisma migrate deploy` prod'da koştu; `psql`'de 22 ürün, 15 üretici, 2 tier, 8 politika, 3 yazı; ADR-0011 "şema v1 donduruldu — ödeme/abonelik/sipariş tabloları değişirse yeni ADR".
- Neden: "şema kararları kodlamadan önce kesinleşmeli"; feature modülleri değişmeyen tablolara yazılır; seed tekrarlanabilir → lokal dev DB'si aynı veriyle.

**Faz 3 — Bootstrap + katalog dinamik (3 gün)**
- Kapsam: `CatalogModule` (products/tiers/producers public GET), `GET /bootstrap` (cart.js şekline birebir DTO: `{id:slug, name, category:group, meta, location, batch, price:Number, unit, boxAmount, img, images[], desc, why, pref, fresh, season, tab}` + tiers + freq + days + fee), view'lara `{{{bootstrapScript}}}` (products.js `<script>` satırı kaldırılır), in-process cache (60 sn, admin yazınca invalidate), `index.html` 8 öne çıkan kart → `{{#each featured}}` aynı markup partial'ı, `kutu.html` `pairIds` → `__BAGDAM__.pairIds` (1 satır), `RECOMMENDED_TIER` → bootstrap'tan. cart.js değişmez.
- Ön koşul: Faz 2. DoD: screenshot diff 0; DB'de fiyat değiştir → sayfada değişir; `products.js` repodan silindi.
- Neden: admin ekranlarının anlamlı olması için sayfalar DB'den beslenmeli; tüm katalog tek noktadan (bootstrap) geldiği için sonraki sayfa dönüşümleri veri tarafına dokunmaz.

**Faz 4 — Admin iskeleti + katalog CRUD + medya (5 gün) → "dinamik site + admin" ilk teslim**
- Kapsam: admin auth (ADMIN/STAFF login, cookie), UA admin iskeleti kopyası, ekran 1-8 (§4), `MediaModule` (multer memory 20 MB → sharp webp max 2048 q82 + 300 px thumb → `uploads/YYYY/MM/`), `AuditLogInterceptor`.
- Ön koşul: Faz 3. DoD: admin'den ürün fiyat/metin/görsel değişikliği sitede görünüyor; yeni ürün ekleyip `urun.html?id=` ile açılıyor; haftanın kutusu ekranından fresh havuzu değişince kutu.html değişiyor.
- Neden: en erken görünür değer; içerik/commerce'den bağımsız.

**Faz 5 — CMS içerik + blog + politikalar + toptan lead + ayarlar (5 gün)**
- Kapsam: `ContentModule`; view'larda sabit metinler `{{site.*}}`'a (index, urunler trust+panel notları, kutu notları/tooltip, gunluk, politikalar `{{#each policies}}`, toptan, nasil-seciyoruz, footer partial, promo bar partial), `WholesaleModule` + toptan.html form `fetch('/api/v1/wholesale-leads')` (mevcut teşekkür UI'ı korunur), `SettingsModule` (UA kopyası, şifreli anahtarlar), ekran 9-15.
- Ön koşul: Faz 4 (admin iskeleti). DoD: admin'den hero/FAQ/politika/blog/iletişim değişiyor; toptan e-postası DB'ye düşüyor; screenshot diff yalnız içerik.
- Neden: commerce'den bağımsız, ürünle birlikte "site artık tamamen admin'den" durumu tamamlanır; sonraki fazlar şablonlara dokunmaz (sepet/uyelik hariç).

**Faz 6 — Üyelik + hesap + adres + e-posta altyapısı (4 gün)**
- Kapsam: `AuthModule` (UA kopyası: register/login/refresh/logout/forgot/reset/me, cookie, CSRF, kilit), `MeModule` (address, orders[boş], profile), `MailModule` çekirdeği (SMTP settings'ten, MailLog idempotency, `DISABLE_MAIL` dev), parola sıfırlama şablonu; sepet/uyelik auth kapıları: `wireAuthGate` API'ye bağlanır (aynı 6 input; hata metinleri korunur), `bahceden_member/session` kaldırılır, `body.is-logged-in` `GET /auth/me` ile; adres formu `/me/address`'e (uyelik `#addrDistrict` → Urla/Çeşme select); ekran 16.
- Ön koşul: Faz 2 (şema), Faz 4 (admin iskeleti). DoD: kayıt→giriş→çıkış→parola sıfırlama maili; adres kaydı iki sayfada ortak.
- Neden: checkout'un ön koşulu; ödeme olmadan test edilebilir.

**Faz 7 — Checkout + sipariş + iyzico (6 gün)**
- Kapsam: `PricingService` (tek doğruluk kaynağı: satır toplamları, kargo 49/ücretsiz eşik/abone dahil, ilk-kutu indirimi, retention, KDV gösterimi — sepet/kutu JS hesapları yalnız ön izleme), `POST /checkout/quote` + sepet.html özetinin sunucu tutarlarıyla eşlenmesi, `POST /checkout` (transaction: Order+OrderLine snapshot [+ Subscription PENDING + cycle#1 SCHEDULED] → iyzico CF initialize, `registerCard` abonelikte), `PaymentsModule` (callback → retrieve → PAID/ACTIVE/PaymentMethod; webhook HMAC + WebhookEvent; idempotent), sipariş onay e-postası (+ politika kopyası), sepet.html kart bölümü → CF konteyneri, `?siparis=` başarı görünümü (mevcut markup), uyelik siparişler listesi `/me/orders`; ekran 17; sipariş durum geçiş tablosu (UA `order-status-transitions`).
- Ön koşul: Faz 6; iyzico sandbox (Faz 0). DoD: sandbox'ta tekil ürün, tek seferlik kutu ve abonelik ilk ödemesi tamamlanır; webhook iki kez gelince ikinci IGNORED; `Consent` kayıtları (PREINFO_ACK, CONTRACT_ACK, abonelikte SUBSCRIPTION_CONTRACT_ACK) yazılır.
- Neden: ilk tahsilat + kart saklama abonelik motorunun girdisidir; sipariş modeli tekil/kutu/abonelik için tek olduğu için Faz 8 yeni tablo açmaz.

**Faz 8 — Abonelik motoru + ops ekranları (7 gün)**
- Kapsam: `SubscriptionsModule`: `cycles:ensure` (sonraki cycle + `cutoffAt` = settings kuralı), kesim kilidi (items/extras/fiyat/parti snapshot → Order kind=SUBSCRIPTION → saklı karttan NON3D tahsilat → CHARGED / retry +24s,+72s → UNPAID → cycle SKIPPED + e-posta "kart güncelle"; 2 ardışık UNPAID → PAST_DUE), skip/unskip (hak sayacı), extras/swap/pref/day/freq PATCH (kesim öncesi), iptal → neden + retention teklifi (üye başına 1) → onay (≤7 gün işleme, SubscriptionEvent), `GET /me/subscription` → cart.js `sub` DTO; **istemci adaptörü** `BahcedenCart.remote` (kutu.html `isLive()` ve uyelik.html `renderSub` veri kaynağı sunucu; "değişiklikleri onayla" → PATCH; "bu haftaki kutuma ekle" → extras POST); ekran 18-20.
- Ön koşul: Faz 7. DoD: sandbox uçtan uca: abone ol → düzenle → kesim → tahsilat → hazırlanıyor → yolda → teslim; atla/geri al; başarısız kart → retry → UNPAID; iptal+retention; pick-list/packing çıktıları.
- Neden: en karmaşık iş mantığı en son ama şeması Faz 2'de donmuş olduğu için yalnız servis/cron kodu yazılır.

**Faz 9 — Bildirimler + yasal + sertleştirme (3 gün)**
- Kapsam: e-posta şablonları (sipariş onayı, kesim 24 s hatırlatma, tahsilat başarılı/başarısız, yola çıktı/teslim, iptal teyidi, abonelik sözleşmesi kopyası), çerez banner (bahcedenal `CookieConsentBanner` metni; localStorage), KVKK silme/anonimleştirme servisi, `/me` veri indirme (P2), SMS (Netgsm) **opsiyonel** — yalnızca "yola çıktı" için.
- Ön koşul: Faz 8. DoD: her yaşam döngüsü olayı MailLog'da; politikalar sayfası çerez metniyle tutarlı.

**Faz 10 — Lansman (3 gün)**
- Kapsam: iyzico prod anahtarları + NON3D yetkisi teyidi, Cloudflare WAF istisnası (`/api/v1/webhooks/*`, `/api/v1/payments/*/callback`), `/api/*` cache bypass, rate limit kontrol, sitemap/robots, 404/500 sayfaları (aynı tasarım), yedekten geri yükleme provası, Playwright smoke (10 sayfa + checkout sandbox), `unused/` ve kullanılmayan 27 görsel temizliği, ETBİS/İşletme Kayıt/İYS durumu, `docs/SISTEM-DURUMU.md`.
- DoD: canlı sipariş alındı; Telegram uyarıları çalışıyor.

**Toplam ≈ 44 gün** (tek dev ~9 hafta; 2 dev ~6 hafta). "Dinamik site + admin" ilk teslim: Faz 4 sonu (~14 gün). P2 (lansman sonrası): ürün grid SSR, temiz URL'ler + 301, BoxWeek şablonu (gelecek haftaları planlama), ProductLot, kupon, çoklu adres, kargo aracı API (şehir dışı kuru ürün), WhatsApp, pause, e-Arşiv entegratörü (BirFatura/Paraşüt), İYS API, PayTR ikinci sağlayıcı.

# 6. İlk 2 hafta — somut başlangıç: repo iskeleti, komutlar, ilk migration, ilk endpoint, ilk admin ekranı, ilk dinamik sayfa.

**Hafta 1 (Faz 0 → 1 → 2)**

Gün 1: ADR'ler (`docs/adr/`), iyzico sandbox başvurusu, Cloudflare zone ekleme, registrar NS planı. Repo düzeni:

```
bagdam/
├── apps/api/            (NestJS; views/, public/, uploads/ [gitignore])
├── apps/admin/          (Vite React)
├── packages/shared/     (enum + DTO tipleri; ince)
├── database/            (schema.prisma, migrations/, seeds/, data/)
├── docs/adr/, docs/SISTEM-DURUMU.md
├── deploy.sh, ecosystem.config.js, .github/workflows/deploy.yml
├── pnpm-workspace.yaml, turbo.json, package.json, .env.example, .gitignore (+ .env, uploads/, dist/)
```

Komutlar (Windows, Git Bash):
```bash
cd "<repo-kökü>"
corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm init && printf 'packages:\n  - "apps/*"\n  - "packages/*"\n' > pnpm-workspace.yaml
pnpm dlx @nestjs/cli@11 new apps/api --package-manager pnpm --skip-git --strict
pnpm create vite apps/admin --template react-ts
mkdir -p database/seeds packages/shared/src && pnpm add -Dw prisma@6 typescript tsx turbo && pnpm add -w @prisma/client@6
pnpm --filter ./apps/api add @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt @nestjs/throttler @nestjs/schedule @nestjs/cache-manager cache-manager hbs helmet compression cookie-parser bcrypt class-validator class-transformer sharp multer nodemailer
# mevcut siteyi taşı (kopya; website/ bir süre referans olarak kalır, Faz 3'te silinir)
mkdir -p apps/api/views apps/api/public && cp website/*.html apps/api/views/ && for f in apps/api/views/*.html; do mv "$f" "${f%.html}.hbs"; done
cp -r website/assets apps/api/public/assets && cp website/styles.css apps/api/public/
git mv website/unused docs/arsiv-prototip   # eski sayfalar referans olarak
```

Gün 2: `apps/api/src/main.ts` + `app.module.ts` (UA'dan kopya, `setGlobalPrefix('api/v1')`, `app.setBaseViewsDir(views)`, `app.setViewEngine('hbs')`, `useStaticAssets(public)`), `WebController` (`@Get(['/', '/index.html'])` … `@Render('index')`), `HealthController` → `GET /api/v1/health` → `{ok:true, ts}`. Lokal: `pnpm --filter api start:dev` → `http://localhost:5010/urunler.html` statikle aynı.

Gün 3: Sunucu: `mkdir -p /opt/bagdam /opt/bagdam/logs`, `git clone`, `createuser bagdam` + `createdb bagdam_db`, `/opt/bagdam/apps/api/.env`, `ecosystem.config.js` (`bagdam-api`, `PORT 5010`, `instances 1`), nginx `bagdam.com.conf` + `admin.bagdam.com.conf`, certbot, Cloudflare A kayıtları (proxied), `deploy.sh` + GitHub Actions secrets, `cp /opt/birbudak/scripts/backup-uyanisakademi.sh backup-bagdam.sh` (DB adı/uploads yolu), health-check'e `http://127.0.0.1:5010/api/v1/health`. Playwright baseline script `apps/api/test/visual/baseline.spec.ts`.

Gün 4-5: `database/schema.prisma` (§2 tamamı) → `pnpm prisma migrate dev --name init --schema database/schema.prisma` (lokal `bagdam_dev`); `0001_init` sonrası elle SQL migration `0002_sequences_citext` (orders seq 1001, citext, payments partial unique). Seed: `database/seeds/import-products.ts`:
```ts
import vm from 'node:vm'; import fs from 'node:fs';
const ctx: any = {}; vm.runInNewContext(fs.readFileSync('apps/api/public/assets/products.js','utf8') + ';this.PRODUCTS=PRODUCTS;this.SUB_TIERS=SUB_TIERS;this.FREQ_OPTIONS=FREQ_OPTIONS;this.DELIVERY_DAYS=DELIVERY_DAYS;this.DELIVERY_FEE=DELIVERY_FEE;', ctx);
// meta "Hüseyin Dağ · Kuşçular · Urla — Erken Hasat" → producer {name, village, district}, metaNote
```
`pnpm prisma db seed` → lokal; deploy.sh ile prod'a `migrate deploy` + `seed --only-if-empty`. ADR-0011 "şema v1 donduruldu".

**Hafta 2 (Faz 3 → 4 başlangıcı)**

Gün 6-7: `CatalogModule` + `GET /api/v1/bootstrap` (DTO = products.js şekli) → `WebController` her render'a `bootstrapScript` geçirir; tüm `.hbs`'lerde `<script src="assets/products.js"></script>` → `{{{bootstrapScript}}}`; `index.hbs` featured partial; `kutu.hbs` pairIds. **İlk dinamik sayfa: `urunler.html`** (grid ve tier kartları DB'den) → screenshot diff 0 → deploy. Ardından urun/kutu/index.

Gün 8-10: Admin: UA `apps/admin/src/{AdminApp,app/router,layouts,components,contexts,hooks,lib,features/components}` kopyası (paket adı `@bagdam/admin`, `resolveApiBase` = `/api/v1` same-origin), `AuthModule`'ün admin kısmı (login/me/logout cookie), **ilk admin ekranı: Ürünler listesi + form** (`/admin/products`), ardından Medya upload. Hafta sonu DoD: admin'den fiyat değişince bagdam.com'da görünüyor.

# 7. Deploy & ops — sunucuda dizin, port, PM2, nginx vhost(lar), SSL, Cloudflare/DNS, .env, backup/health entegrasyonu (/opt/birbudak/scripts), CI/CD, staging/prod ayrımı, dev DB stratejisi (tek DB kuralına uyulsun mu?).

| Konu | Karar |
|---|---|
| Dizin | `/opt/bagdam/` (repo kökü; `apps/api/dist`, `apps/api/views`, `apps/api/public`, `apps/api/uploads` [diskte, git dışı], `apps/api/.env`, `apps/admin/dist`, `logs/`) |
| Port / PM2 | `bagdam-api` → `127.0.0.1:5010`, `script dist/main.js`, `cwd /opt/bagdam/apps/api`, `instances 1` (cluster), `max_memory_restart 512M`, `kill_timeout 8000`, `env_file .env`, log `/opt/bagdam/logs/api-{out,error}.log` (pm2-logrotate mevcut). İkinci instance gerekirse cron kilidi zaten `NODE_APP_INSTANCE==0`. |
| nginx `bagdam.com` | `80→301 https`; `443`: LE cert; `www.bagdam.com → 301 bagdam.com`; `location /assets/ { alias /opt/bagdam/apps/api/public/assets/; expires 365d; immutable }` (cache-busting `?v=<git sha>` şablonda), `location /uploads/ { alias /opt/bagdam/apps/api/uploads/; expires 30d }`, `location /api/ { proxy_pass http://127.0.0.1:5010; limit_req zone=api burst=20 nodelay; X-Real-IP/X-Forwarded-* }`, `location = /api/v1/auth/login { limit_req zone=login … }`, `location / { proxy_pass http://127.0.0.1:5010; }` (HTML render; `proxy_cache` yok); güvenlik header'ları (nosniff, X-Frame-Options SAMEORIGIN — iyzico iframe için CSP `frame-src https://*.iyzipay.com` DOĞRULANMADI alan adı), `client_max_body_size 20M`. |
| nginx `admin.bagdam.com` | `root /opt/bagdam/apps/admin/dist; try_files $uri /index.html;` `/assets/` immutable; `location /api/ → 5010` (same-origin cookie); `X-Frame-Options DENY`; isteğe bağlı Cloudflare Access veya nginx `allow` IP listesi ek katman. |
| SSL | certbot HTTP-01 webroot `/var/www/letsencrypt` (mevcut `certbot.timer`), `bagdam.com,www,admin` tek sertifika. Cloudflare "Always HTTPS" ile `/.well-known/acme-challenge/` yenilemesi çalışmazsa DNS-01 (`certbot-dns-cloudflare`) — DOĞRULANMADI (UA aynı kalıpla çalışıyor). |
| Cloudflare / DNS | Free plan; A `bagdam.com`, `www`, `admin` → <SUNUCU_IP> **proxied**; MX/SPF/DKIM/DMARC **DNS only** (mail sağlayıcısı kararı açık); SSL Full (strict); Always HTTPS; HSTS; WAF özel kural: `/api/v1/webhooks/*` ve `/api/v1/payments/*/callback` için Bot Fight/challenge **skip**; Cache Rule: `/api/*` bypass, `/assets/*` cache; origin yalnız CF IP'lerinden (ufw/nginx `00-cloudflare-realip.conf` mevcut). Registrar'da DNSSEC kapat → NS değiştir → aktif olunca DNSSEC CF'den aç. |
| `.env` (yalnız sunucu) | `NODE_ENV=production PORT=5010 DATABASE_URL=postgresql://bagdam:***@127.0.0.1:5432/bagdam_db?connection_limit=5&pool_timeout=20 JWT_SECRET JWT_REFRESH_SECRET SETTINGS_ENCRYPTION_KEY WEB_URL=https://bagdam.com ADMIN_URL=https://admin.bagdam.com COOKIE_SECURE=true IYZICO_BASE_URL IYZICO_API_KEY IYZICO_SECRET_KEY IYZICO_WEBHOOK_SECRET(DOĞRULANMADI: panelden alınır) SMTP_* (veya settings'te şifreli) DISABLE_MAIL=false SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD UPLOADS_DIR`. `env-validator.ts` fail-fast; zayıf default reddi. Repo public → `.env.example` yalnız anahtar adları. |
| Backup / health | `/opt/birbudak/scripts/backup-bagdam.sh` (pg_dump -Fc `bagdam_db` + `uploads` tar.gz, 7 gün, 03:30) → `/opt/birbudak/backups/bagdam/`; `health-check.sh`'e PM2 `bagdam-api` + `GET 127.0.0.1:5010/api/v1/health` + `https://bagdam.com/` 200; `error-watcher` PM2 log deseni; Telegram mevcut. Aylık restore provası (Faz 10'da ilk). |
| CI/CD | `.github/workflows/deploy.yml` (push `main`, paths-ignore docs/**, `appleboy/ssh-action` → `bash /opt/bagdam/deploy.sh`, 2 deneme). `deploy.sh`: `git fetch && reset --hard origin/main` → `pnpm install --frozen-lockfile` → `prisma generate` (pnpm çift-client düzeltmesi UA'dan) → **build api + admin** → `pg_dump -Fc` ön-yedek → `prisma migrate deploy` → `pm2 reload ecosystem.config.js --update-env` → `curl /api/v1/health` → `.last-deploy-sha`; hata → `notify-telegram.sh`. (UA'daki "migrate build'den önce" sırası düzeltildi.) |
| Staging/prod | MVP'de **staging uygulaması yok** (1-2 dev, tek süreç). İhtiyaç olursa aynı sunucuda `bagdam-staging-api` :5011 + `bagdam_staging_db` + `staging.bagdam.com` (UA/floovent kalıbı) 1 günde eklenir. Ödeme sandbox testleri lokal + iyzico sandbox ile. |
| **Dev DB stratejisi — tek DB kuralına UYULMAZ** | **Artı (UA kuralı):** tek şema/seed, drift yok, gerçek veriyle geliştirme, tek kişide basit. **Eksi:** `prisma migrate dev` drift görünce **reset** önerir (prod'da felaket); UA'da testler prod'a 163 sipariş yazdı; KVKK — müşteri PII geliştirme makinesinde; SSH tüneli gecikmesi (bahcedenal ADR-0003: 87 ms/sorgu); offline çalışılamaz; iki dev çakışır. **Karar:** lokal PostgreSQL `bagdam_dev` (+ `bagdam_test`), `migrate dev` **yalnız lokal**, migration commit → prod'da `migrate deploy` (deploy.sh); seed küçük (22 ürün) olduğu için lokal seed bedava; prod'a yalnız `psql` salt-okunur tünel (inceleme). Jest global setup'a prod DB guard (UA `jest-global-setup.ts`) ilk günden. ADR-0009 olarak yazılır (UA'dan bilinçli sapma). |

# 8. Riskler ve açık kararlar — kullanıcıya sorulacak sorular, varsayımlar.

**Şemayı/fazı etkileyen, Faz 0'da kapanması ZORUNLU sorular:**
1. **Kesim kuralı** tek hangisi? (kod: 2 gün önce 23:59 *ve* 1 gün önce 12:00; politika: önceki gün 12:00; güven şeridi: "1 gün öncesine"). Varsayım: **teslimattan önceki gün 12:00** → `commerce.cutoff={daysBefore:1,time:"12:00"}`; cart.js `nextCutoff()` ve `lockedDeliveryDay()` bootstrap'taki kurala çekilir.
2. **İlk kutu indirimi**: otomatik mi kod (BAGDAM050) ile mi; 2 kutu mu; üye başına bir kez mi; sepet toplamına da uygulanacak mı (bugün yalnız kutu.html özetinde)? Varsayım: otomatik, aboneliğin ilk 2 cycle'ı, üye başına 1, `discountBoxesLeft`.
3. **Atlama hakkı**: ömür boyu 1 (kod) vs yılda 1 (politika)? Varsayım: yılda 1 (`skipsPerYear`, `skipsResetAt`).
4. **Teslimat**: yalnız Urla+Çeşme kendi kurye; şehir dışına kargo MVP'de yok? Ürünlerin çoğu soğuk zincir → varsayım: **kargo yok**, `Shipment` tablosu sonradan. Teslimat saati 09:00–18:00 sabit.
5. **Fresh ürünler** tekil satılmayacak (SSS "abonelik dışında tek tek satış yapmıyoruz" yalnız fresh için) — varsayım evet; süt/fırın/kiler tekil satılır.
6. **Ödeme**: iyzico onay; saklı karttan **NON3D merchant-initiated** tahsilat yetkisi alınabiliyor mu (alınamazsa abonelik tahsilatı "ödeme linki + 3DS" akışına döner → Faz 8 +3 gün). "Ödemen teslimat günü çekilir" mi, **kesimde** mi? Varsayım: **kesimde** (stok/üretici siparişi için para garantisi).
7. **Tekil sipariş + aktif abonelik** aynı anda: tekil siparişin teslimat günü ayrı mı? Varsayım: ayrı Order, kendi `deliveryDay`'i (`bahceden_sub.deliveryDay` paylaşımı kaldırılır).
8. **Üyelik**: e-posta+parola (mevcut UI) — telefon+OTP sonra. KVKK aydınlatma onayı kutusu signup'a eklenecek mi (varsayım: evet, tek checkbox + link; tasarıma küçük ek).

**Diğer açık sorular (MVP'yi engellemez, karar bekler):** "6 üretici" metni vs 15 üretici; üretici sayfası olacak mı; küratör adı ("Ece") gerçek veri mi; FAQ "Cuma teslimat" çelişkisi (gunluk incir yazısı); IG/YT adresleri; KDV oranı ürün bazlı mı (fırın %1? — mali müşavir); fatura: GİB e-Arşiv elle mi entegratör mü (MVP elle; `Order`da fatura alanları için kurumsal fatura istenecek mi → varsayım: MVP bireysel, `billingType` P2); e-posta gönderim sağlayıcısı (mevcut SMTP? Resend? SPF/DKIM); SMS gerekli mi; `season`/stok gösterimi (ürün kartında "sezon dışı" rozeti?); çerez banner yeterli mi; toptan formuna işletme adı/telefon eklensin mi (şema hazır).

**Riskler ve önlemler:**
- Ödeme entegrasyonu (en büyük teknik risk): sandbox'ı Faz 0'da aç; `PaymentProvider` arayüzü ile PayTR'ye geçiş yolu; webhook idempotency ilk günden.
- İş kuralı belirsizliği → abonelik motoru yeniden yazımı: ADR'ler şemadan önce; `Setting`'e taşınan kurallar kod değişmeden ayarlanır.
- Tasarım sapması: screenshot baseline + her faz diff; iyzico CF tek istisna (kullanıcıya önceden gösterilir).
- Tek süreçte web+API: CPU-ağır işlemler (sharp) `sharp.concurrency(1)`; gerekirse view katmanı ayrı sürece taşınır (aynı kod, ayrı Nest uygulaması) — şema/API etkilenmez.
- Public repo: sır sızıntısı → `.env` yok, seed admin env'den, `gitleaks` pre-commit (ops.), görsel/içerik repoda sorun değil.
- Kapsam sürünmesi (bahcedenal dersi): P2 listesi sabit; karar kuyruğu ≤3; plan dışı UI eklemesi yok.
- Tek geliştirici riski: UA iskeleti kopyası + ADR + `docs/SISTEM-DURUMU.md` ile devralınabilirlik.

# 9. Referanslardan somut alıntılar — uyanisakademi/bahcedenal'dan hangi dosya/kalıp hangi adımda kullanılacak.

Kısaltmalar: `UA/` = `www.uyanisakademi.com.tr`, `BA/` = `www.bahcedenal.com.tr`.

| Faz | Kaynak | Ne alınır / nasıl uyarlanır |
|---|---|---|
| 1 | `UA/pnpm-workspace.yaml`, `turbo.json`, `package.json` (scripts, `pnpm.overrides.typescript`, `prisma.seed`) | aynen; paket adları `@bagdam/*`; `predev` SSH tünel script'i **alınmaz** (lokal DB) |
| 1 | `UA/deploy.sh`, `ecosystem.config.js`, `.github/workflows/deploy.yml` | yollar `/opt/bagdam`, `bagdam-api`, port 5010, `instances 1`, branch `main`; migrate build'den sonraya + pg_dump + SHA |
| 1 | `UA/apps/api/src/main.ts`, `app.module.ts`, `config/env-validator.ts`, `common/{prisma.*, request-context, middleware/request-id, filters/all-exceptions.filter, interceptors/{timeout,request-logger}}`, `modules/health/*` | kopyala; `setGlobalPrefix('api/v1')`; hbs view engine ekle; CORS listesi bagdam domainleri |
| 1 | `BA/deploy/coming-soon/RUNBOOK.md` §1-3,5 + `bahcedenal.com.tr.nginx.conf` + `customer-web/next.config.ts:83-158` | Cloudflare DNS/SSL adımları, nginx vhost kalıbı, güvenlik header seti |
| 1 | `/opt/birbudak/scripts/backup-uyanisakademi.sh`, `health-check.sh` (sunucu) | `backup-bagdam.sh` kopyası; health listesine 5010 |
| 2 | `UA/database/schema.prisma` (User, UserAddress→Address, Category, Product[kırpılmış], ProductImage, Order, OrderLine, Payment, MediaFile, SiteSetting, BlogPost→Post, AuditLog) + `20260505100000_payments_gatewayref_paid_partial_unique` | alan tipleri/konvansiyonlar; partial unique index SQL |
| 2 | `BA/backend/database/migrations/2025_05_06_*create_orders_table.php`, `create_order_items_table.php`, `2025_09_08_*order_payment_transactions`, `2025_08_14_*promo` | adres/kalem snapshot alanları, payment transaction şekli, kupon alanları (P2) |
| 2 | `UA/database/seeds/{seed-settings,seed-email-templates}.ts`, `seed.ts` (admin bloğu env tabanlı) | settings/e-posta şablonu seed kalıbı |
| 2 | `BA/scraped-data/static_contents.json` (cayma-hakki, kisisel-verilerin-korunmasi, mesafeli-satis-sozlesmesi, on-bilgilendirme, uyelik-sozlesmesi) | Politika metinlerini tamamlamak için taslak (aynı şirket; hukuki kontrol şart) |
| 3 | `UA/apps/api/src/modules/{products,categories}/*` (public GET + select projection) | CatalogModule; DTO'yu products.js şekline çeviren mapper Bağdam'a özgü |
| 4 | `UA/apps/admin/src/{AdminApp.tsx, app/router.tsx, layouts/AdminLayout.tsx, components/*, contexts/*, hooks/{useApi,useAdminListPanel}.ts, lib/{api,apiTypes,adminNavConfig,adminNavIcons,tableStyles,toast,utils}.ts, features/components/*, features/medya/MediaPickerModal.tsx, pages/urunler/{AdminUrunlerListePage,AdminUrunlerFormPage,AdminUrunlerKategorilerPage}.tsx, pages/medya/*, pages/auth/AdminLoginPage.tsx}` | birebir kopya; `resolveApiBase` = same-origin `/api/v1`; token localStorage yerine cookie (`credentials:'include'`) |
| 4 | `UA/apps/api/src/modules/media/*` (multer memory, sharp webp+thumb, path-traversal guard), `common/interceptors/audit-log.interceptor.ts`, `decorators/*`, `guards/{jwt-auth,roles,csrf}.guard.ts` | MediaModule, AuditLog, RolesGuard |
| 4 | `BA/customer-web/scripts/optimize-public-images.mjs` | mevcut 53 görselin tek seferlik webp/optimize toplu dönüşümü |
| 5 | `UA/apps/api/src/modules/settings/*` + `common/crypto.util.ts` (SENSITIVE_KEYS, AES-256-GCM, PUBLIC_ALLOWED_GROUPS), `pages/ayarlar/AdminAyarlarPage.tsx` | SettingsModule + admin Ayarlar; anahtar zorunlu |
| 5 | `UA/apps/api/src/modules/content/*`, `components/ui/RichTextEditor` (tiptap) | Post/Policy/SiteContent CRUD + editör |
| 5 | `BA/backend/database/seeders/BahcedenAlWebSettingsSeeder.php` (web JSON anahtarları) | SiteContent/Setting anahtar seti fikri (iletişim/sosyal/yasal) |
| 6 | `UA/apps/api/src/modules/auth/*`, `config/{jwt,cookie}.config.ts`, `apps/web/src/lib/api.ts` (cookie + CSRF + tryRefresh) | AuthModule; web tarafında cart.js içine küçük `api()` yardımcı fonksiyonu (fetch + CSRF header) |
| 6 | `UA/apps/api/src/common/mail.{module,service}.ts` (çekirdek: getSmtpConfig, transporter cache, sendMail+MailLog, wrapWithLayout), `modules/email-templates/*` | MailModule; marka sabitleri SiteContent'ten |
| 7 | `UA/apps/api/src/modules/pricing/*` (7 adım, ROUND_HALF_UP, shipping-config) | PricingService (cohort/aile dizimi dalları silinir; ilk-kutu/retention kuralları eklenir) |
| 7 | `UA/apps/api/src/modules/payment/gateways/{payment-gateway.interface,gateway.factory}.ts` | `PaymentProvider` arayüzü + factory; iyzico adaptörü yeni (PayTR adaptörü referans) |
| 7 | `UA/apps/api/src/modules/orders/{order-status-transitions,order-timeout.scheduler,orders.controller}.ts` + `orders.service.ts` (updateStatus, OrderEvent/OrderNote, cancel side-effects), `pages/siparisler/*`, `features/siparisler/api.ts` | sipariş durum makinesi + admin Siparişler |
| 7 | `BA/backend/app/Services/OrderService.php:81-172` (createOrder adım sırası, tek transaction, rollback) | `POST /checkout` servis sırası (`prisma.$transaction`) |
| 7–8 | `BA/backend/app/Services/OrderService.php:369-466` (atomik kapasite `UPDATE … WHERE current<max`) | ileride teslimat günü kapasitesi (P2) |
| 8 | `BA/backend/app/Services/SlotGeneratorService.php` + `ChannelEtaService.php` (`display_text` sözleşmesi) | cycle üretimi (haftalık → N gün horizon) ve "DEĞİŞİKLİK İÇİN: X SÜREN VAR" metninin sunucudan gelmesi |
| 8 | `UA/apps/api/src/modules/orders/fulfillment-retry.scheduler.ts`, `common/cron-log.*`, `app.module.ts` (`NODE_APP_INSTANCE` kilidi) | retry/dunning scheduler + CronLog |
| 9 | `BA/customer-web/src/components/Cookie/CookieConsentBanner.tsx` + `public/locales/tr.json` (`cookie.*`), `BA/backend/app/Console/Commands/PurgeSoftDeletedKvkkData.php` | çerez banner metni/mantığı (vanilla JS'e çevrilir); KVKK 30 gün hard-delete cron |
| 9 | `UA/packages/shared/src/contracts/mesafeli-satis.ts` | mesafeli satış sözleşmesi şablonu → Bağdam metni + Consent versiyonu |
| 10 | `BA/deploy/coming-soon/RUNBOOK.md` §6,9, `customer-web/scripts/{generate-sitemap,update-robots}.mjs`, `BA/PERFORMANCE_SPRINT_PLAN.md:526-533` | lansman/301/sitemap; production don't-do listesi |
| Süreç | `UA/.github/copilot-instructions.md` (kurallar şablonu), `docs/YAPILACAKLAR.md` + `sistem-durumu.md` konvansiyonu; `BA/CLAUDE.md` ADR protokolü (≤25 satır/ADR, ayrı dosya) | `docs/adr/`, `docs/SISTEM-DURUMU.md`; karar kuyruğu ≤3 |
| Test | `UA/apps/api/src/__tests__/jest-global-setup.ts` (prod DB guard), `__tests__/security/*` | ilk günden; `bagdam_test` lokal |

**Alınmayacaklar:** Hyperlocal/Laravel kodu, multi-vendor/store/rider/wallet/referral şemaları, Redis, Google Maps/Geocoding, Firebase, i18n çoklu dil, UA'nın eğitim/seans/AI modülleri, permission tabloları, `predev` SSH tünel (tek DB kuralı), Laravel Scheduler/queue.