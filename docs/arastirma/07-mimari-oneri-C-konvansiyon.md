> **Mimari öneri C — konvansiyon / yeniden kullanım-önce** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 2 — mimar). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

<!-- summary: Öneri: Bağdam, sunucuda canlı olan uyanisakademi yığınının birebir kopyası olarak kurulur — pnpm 9.15 monorepo (apps/api NestJS 11 + Prisma 6.19 + PostgreSQL 14, apps/admin Vite+React 19+Tailwind 4, packages/shared, database/schema.prisma), PM2 `bagdam-api` :5010, nginx vhost kalıbı, deploy.sh + appleboy/ssh-action, /opt/birbudak/scripts health/backup entegrasyonu. Frontend stratejisi (a): mevcut statik HTML/CSS/JS piksel piksel korunur; `assets/products.js` yerine API'den aynı global değişkenleri dolduran küçük bir bootstrap loader gelir, cart.js'in yalnızca auth/checkout/abonelik uçları API'ye bağlanır; SSR/SPA yok, apps/web kopyala+stamp'lı statik paket olarak deploy.sh'ta aynı `pnpm --filter web build` adımıyla yayınlanır. UA'dan auth (cookie+refresh+CSRF), settings (AES-GCM hassas anahtar), media (sharp→webp), mail (DB SMTP + MailLog), throttling, audit/system-log, health, env-validator, admin iskeleti (AdminAuthContext/router/layout/components/hooks) dosya bazında kopyalanır; Bağdam'a özgü tek yeni çekirdek "abonelik motoru" (Subscription → SubscriptionCycle → CycleItem snapshot + kesim/tahsil cron) sıfırdan yazılır. En kritik sıralama kararı: Sprint 0'da ödeme sağlayıcısı (iyzico kart saklama), tek kesim kuralı, teslimat bölgesi/kargo modeli ve ilk-kutu indirimi kuralı ADR olarak kapatılıp Product/Order/Subscription/Payment şeması tek init migration'da dondurulur; ardından walking skeleton (health + admin login + ilk dinamik sayfa urunler.html) ilk 2 haftada canlıya çıkar, sayfalar tek tek API'ye bağlanırken site hiç kesilmez. Tek DB kuralına bilinçli sapma: lokal `bagdam_dev` PG + `migrate dev` lokal, prod'a yalnız `migrate deploy`; sunucuda isteğe bağlı `bagdam_staging` DB, SSH tüneli (5436) yalnız okuma/inceleme. En büyük risk: abonelik tahsilat modeli (değişken tutarlı haftalık kutu + saklı karttan MIT tahsilat + dunning) ve iyzico NON3D yetkisi — bu karar netleşmeden checkout/abonelik kodu yazılmamalı; ikinci risk public repo'da sır sızıntısı (.env yalnız sunucuda, seed admin env'den, docs/sunucu-baglanti.md gitignore'da). -->

# 1. Yığın kararı

**İlke:** Sunucuda (<SUNUCU_HOST>) zaten işleyen, aynı ekibin bakımını yaptığı uyanisakademi (UA) yığını ve operasyon kalıbı **değiştirilmeden** kopyalanır; Bağdam'a özgü olan yalnız alan modeli (abonelik/kutu/parti) ve statik HTML'in beslenme biçimidir.

| Katman | Karar | Kaynak/kanıt |
|---|---|---|
| Dil / runtime | TypeScript, Node 20 (sunucuda 20.20.2) | sunucu gerçekleri |
| Backend | **NestJS 11** + Passport-JWT + @nestjs/throttler + @nestjs/schedule + cache-manager (UA `apps/api/package.json` sürümleri aynen) | UA apps/api |
| ORM / DB | **Prisma 6.19.2 + PostgreSQL 14** (`database/schema.prisma`, generator output `../node_modules/.prisma/client`, `.npmrc public-hoist-pattern @prisma/client`) | UA root package.json, .npmrc, deploy.sh pnpm hack |
| Frontend (web) | **Seçim (a): mevcut HTML/CSS/JS aynen korunur, fetch ile API'den beslenir.** Gerekçe: (1) tasarım piksel düzeyinde korunmalı; sayfalar zaten `PRODUCTS/SUB_TIERS/FREQ_OPTIONS/DELIVERY_DAYS/DELIVERY_FEE` global dizilerinden JS ile render ediyor (urunler.html `pcardHtml`, kutu.html, urun.html, index kart stepper'ları) — tek değişiklik `assets/products.js` yerine `assets/bootstrap.js`: `GET /api/catalog/bootstrap` → aynı global'leri doldurur ve `document.dispatchEvent(new Event("bagdam:ready"))`; sayfa inline script'leri bu olaya sarılır (10 sayfa × 1 satır). (2) cart.js'in localStorage sepet/tercih mantığı misafir için kalır; yalnız auth kapısı, checkout, abonelik ve hesap uçları `fetch(..., {credentials:"include"})` ile API'ye bağlanır. (3) SSR/şablon motoru gereksiz: SEO'lu sayfalar statik HTML olarak nginx'ten zaten 200 döner; ürün/günlük içerikleri için build-time değil **runtime fetch + `<noscript>` fallback yok** kabul edilir (SEO için ürün/günlük sayfalarının meta'sı API'den `document.title`; ileride gerekirse nginx'ten `GET /api/seo/…` ile önceden render edilen JSON-LD eklenir). (4) SPA'ya taşımak = 14 dosya/1235 satır cart.js + 580 KB CSS'i yeniden yazmak; UA ekibi React bilse de bu tasarımı React'e taşımak "piksel koruma" şartını tehlikeye atar ve lansmanı geciktirir (bahcedenal dersi: pattern kovalama). Sonuç: `apps/web` **Vite'sız statik paket**: `src/` = website/ kopyası, `build` = `node scripts/build.mjs` (dist'e kopya + css/js linklerine `?v=<git sha>` damgası + `window.__API_BASE__` enjeksiyonu). deploy.sh'taki `pnpm --filter web build` adımı aynı kalır. |
| Admin | **Vite 6 + React 19 + Tailwind 4 + react-router 7 + tiptap + dnd-kit + recharts + lucide** — UA `apps/admin` iskeleti (AdminApp, AdminAuthContext, router, AdminLayout/TopBar/Sidebar/BottomNav/MobileDrawer, hooks/useApi + useAdminListPanel, lib/api|apiTypes|adminNavConfig|tableStyles|toast|utils, features/components/* 16 bileşen, MediaPickerModal) dosya bazında kopyalanır | UA apps/admin/src |
| Paylaşılan tipler | `packages/shared` (`@bagdam/shared`, `src/types/*.ts`, `src/contracts/mesafeli-satis.ts` şablonu) | UA packages/shared |
| Paket yöneticisi | **pnpm 9.15.x** (sunucuda 9.15.9; `packageManager` alanı) + turbo 2 (`build dependsOn ^build`), `pnpm.overrides.typescript ~5.8.2` | UA package.json/turbo.json |
| Repo | **Tek monorepo** = mevcut public `github.com/nihatbirbudak/bagdam` (branch `main`). `website/` → `apps/web/src/` olarak `git mv` (tek kaynak; eski yol kalkar). Public kısıtı: `.env`/`.env.*` gitignore; `.env.example` yalnız anahtar adları; seed admin `SEED_ADMIN_EMAIL/PASSWORD` env'den; `docs/sunucu-baglanti.md` zaten gitignore'da; GitHub Secrets yalnız `SERVER_HOST/PORT/SSH_KEY`; PayTR/iyzico/SMTP anahtarları DB `site_settings`'te şifreli (UA kalıbı) ya da sunucu `.env`'de. |
| Ödeme | `PaymentGateway` interface + `PaymentGatewayFactory` (UA) korunur; Bağdam için **iyzico adapter** (Checkout Form + Kart Saklama) ilk, PayTR adapter UA'dan hazır (Faz 2) |
| Bildirim | UA `mail.service` (DB SMTP, MailLog idempotency) + `sms.service` (NetGSM) çekirdeği |

# 2. Veri modeli

Konvansiyon UA ile aynı: `cuid` id, `@@map(snake_case)`, `createdAt/updatedAt`, `deletedAt` soft delete, `Decimal(12,2)` para, `Citext` e-posta/kupon, UPPERCASE enum, her FK/status için `@@index`, snapshot alanları `Json`. UA'dan **aynen** alınan modeller (alanları UA şemasından, Aile Dizimi/eğitim alanları silinerek): `User` (bkz. aşağıda kırpılmış), `UserAddress`, `Category`, `ProductImage`, `Cart`, `Payment`, `Coupon`, `OrderDiscount`, `OrderNote`, `OrderEvent`, `MediaFolder`, `MediaFile`, `SiteSetting`, `BlogPost`, `FaqItem`, `SitePage`, `EmailTemplate`, `MailLog`, `SmsTemplate`, `SmsLog`, `AuditLog`, `SystemLog`, `CronLog`, `Incident`, `Ticket/TicketReply`, `TrCity/TrDistrict/TrNeighborhood` (opsiyonel, kargo açılırsa). Bağdam'a özgü yeni modeller: `Producer`, `ProductLot`, `BoxTier`, `BoxTemplate(+Item)`, `Subscription`, `SubscriptionCycle`, `CycleItem`, `SavedCard`, `WebhookEvent`, `Shipment` (kurye), `WholesaleLead`, `LegalDocument`, `Consent`, `CancellationRequest`.

```prisma
// ── Enum'lar ──
enum UserRole        { CUSTOMER ADMIN EDITOR }
enum ProductStatus   { DRAFT ACTIVE ARCHIVED }
enum ProductTab      { BOXES DAIRY FIRIN CELLAR }            // urunler.html ?tab= ; products.js tab (pantry→CELLAR), fresh→BOXES
enum DeliveryDay     { SALI PERSEMBE CUMARTESI }             // products.js DELIVERY_DAYS
enum Frequency       { W1 W2 W4 }                           // FREQ_OPTIONS 1hafta/2hafta/4hafta
enum SubStatus       { DRAFT ACTIVE PAUSED PAST_DUE CANCEL_REQUESTED CANCELLED }
enum CycleStatus     { SCHEDULED LOCKED SKIPPED CHARGING PAID UNPAID PACKED OUT_FOR_DELIVERY DELIVERED FAILED CANCELLED }
enum OrderType       { SINGLE BOX_ONETIME BOX_CYCLE }       // sepet ürünleri / kutu tek seferlik / abonelik döngüsü
enum OrderStatus     { PENDING AWAITING_PAYMENT CONFIRMED PROCESSING SHIPPED DELIVERED CANCELLED RETURNED } // UA birebir
enum PaymentStatus   { PENDING PAID FAILED REFUNDED PARTIAL_REFUND TIMED_OUT }                              // UA birebir
enum PaymentMethod   { CARD TRANSFER CASH }                  // UA; toptan için TRANSFER
enum PaymentProvider { IYZICO PAYTR }
enum ShipmentMethod  { COURIER CARGO PICKUP }
enum ShipmentStatus  { PLANNED PACKED OUT_FOR_DELIVERY DELIVERED FAILED RETURNED }
enum DiscountType    { PERCENTAGE FIXED_AMOUNT FREE_SHIPPING }  // UA
enum ContentStatus   { DRAFT PUBLISHED ARCHIVED }               // UA
enum LeadStatus      { NEW CONTACTED QUALIFIED CLOSED }
enum LegalType       { PREINFO DISTANCE_CONTRACT SUBSCRIPTION_CONTRACT KVKK COOKIE RETURN TERMS PRIVACY }
enum ConsentType     { KVKK_ACK PREINFO_ACK CONTRACT_ACK SUBSCRIPTION_CONTRACT_ACK MARKETING_EMAIL MARKETING_SMS COOKIE_ANALYTICS COOKIE_MARKETING }

// ── Kullanıcı / adres (UA kırpılmış) ──
model User {
  id String @id @default(cuid())
  email String @unique @db.Citext            // sepet/uyelik #loginEmail / #signupEmail
  passwordHash String @db.VarChar(255)
  firstName String @db.VarChar(100)          // #custName'den türetilir (ad soyad split)
  lastName  String @db.VarChar(100)
  phone String? @db.VarChar(30)              // #custPhone
  role UserRole @default(CUSTOMER)
  isWholesale Boolean @default(false)        // toptan hesabı işareti (Faz 2)
  emailVerified Boolean @default(false)
  emailVerificationToken String? @db.VarChar(500)
  emailVerificationExpiry DateTime?
  passwordResetToken String? @db.VarChar(500)
  passwordResetExpiry DateTime?
  refreshToken String? @db.VarChar(500)      // bcrypt hash (UA)
  failedLoginAttempts Int @default(0)
  lockedUntil DateTime?
  newsletterOptIn Boolean @default(false)    // İYS pazarlama onayı özeti (detay Consent'te)
  prefs Json @default("{}")                  // bahceden_prefs {axis: option} — damak zevki
  retentionOfferUsedAt DateTime?             // bahceden_retention_offered
  isActive Boolean @default(true)
  lastLoginAt DateTime?
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  addresses UserAddress[]  cart Cart?  orders Order[]  subscriptions Subscription[]
  savedCards SavedCard[]   consents Consent[]  blogPosts BlogPost[] @relation("BlogAuthor")
  @@map("users")
}
model UserAddress {                          // sepet.html #cust* / uyelik.html #addr* (tek adres, isDefault)
  id String @id @default(cuid())
  userId String
  title String @default("Teslimat") @db.VarChar(100)
  fullName String @db.VarChar(255)           // #custName / #addrName
  phone String @db.VarChar(30)               // #custPhone / #addrPhone
  line1 String @db.VarChar(500)              // #custAddress / #addrLine
  district String @db.VarChar(100)           // #custDistrict select (Urla|Çeşme) — settings.teslimat.ilceler ile doğrulanır
  city String @default("İzmir") @db.VarChar(100)
  postalCode String? @db.VarChar(10)         // #custZip
  directions String? @db.VarChar(500)
  party AddressParty @default(INDIVIDUAL) tcNo String? @db.VarChar(11) companyName String? taxOffice String? taxNo String? // fatura (UA)
  isDefault Boolean @default(true)
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id], onDelete: Cascade)
  @@index([userId]) @@map("user_addresses")
}
enum AddressParty { INDIVIDUAL CORPORATE }

// ── Katalog ──
model Category {                             // urunler.html sekmeleri + panel notları + index mobil sekmeler
  id String @id @default(cuid())
  name String @db.VarChar(255)               // "Taze Kutular" / "Süt Ürünleri" / "Fırın" / "Kiler"
  slug String @unique @db.VarChar(255)       // boxes|dairy|firin|cellar (?tab=)
  tab ProductTab @unique
  iconUrl String? @db.VarChar(500)           // assets/icons/{boxes,dairy,firin,cellar}.png
  panelNote String? @db.Text                 // urunler.html :86/:92/:98 "Kutuya dahil değil — …"
  sortOrder Int @default(0)  status ProductStatus @default(ACTIVE)
  products Product[]
  @@map("categories")
}
model Producer {                             // products.js meta "Üretici · Köy · Urla[ — not]" normalize
  id String @id @default(cuid())
  name String @db.VarChar(255)               // "Hüseyin Dağ", "Bağdam Çiftlik"
  slug String @unique @db.VarChar(255)
  village String? @db.VarChar(100)           // Kuşçular, Zeytineli…
  district String @default("Urla") @db.VarChar(100)
  story String? @db.Text  photoUrl String? @db.VarChar(500)
  journalSlug String? @db.VarChar(255)       // gunluk.html#… bağlantısı
  isActive Boolean @default(true)  sortOrder Int @default(0)
  products Product[] lots ProductLot[]
  @@map("producers")
}
model Product {
  id String @id @default(cuid())
  sku String @unique @db.VarChar(50)         // = products.js id (incir, zeytinyagi…) — URL ?id= ve cart/sub referansı
  slug String @unique @db.VarChar(255)
  name String @db.VarChar(255)               // name
  categoryId String   producerId String?
  metaNote String? @db.VarChar(100)          // meta soneki "Erken Hasat"
  kind String @db.VarChar(20)                // category: meyve|sebze|bakliyat|süt ürünleri|fırın (öneri skoru)
  isFresh Boolean @default(false)            // fresh: true → yalnız kutuda (swap havuzu), false → tekil satış
  price Decimal @db.Decimal(12,2)            // price (KDV dahil)
  vatRate Int @default(1)  vatIncluded Boolean @default(true)
  unit String @db.VarChar(30)                // unit "500 g" | "L" | "kg" | "demet" | "adet"…
  boxAmount String? @db.VarChar(50)          // boxAmount "1 adet (~1,5 kg)" (kutu.html "kutuda: …")
  extraOptions Json?                         // ekstra miktar seçenekleri [{label:"250 g",factor:0.25}] — cart.js subExtraOptions unit kuralı yerine ürün bazlı
  description String? @db.Text               // desc
  whyChosen String? @db.Text                 // why (parti bazlı; güncel lot'tan da okunabilir)
  storageNote String? @db.Text               // urun.html "kullanım & saklama" (şimdi koda gömülü kural)
  allergen String? @db.VarChar(100)          // urun.html "alerjen" (dairy→"Süt")
  freshnessNote String? @db.VarChar(255)     // "Her sabah taze gelir." (firin/yumurta parti yerine)
  pref Json?                                 // {label:"olgunluk", options:[...], def:1} — data-pref-axis toggle/çip
  season String? @db.VarChar(30)             // season "Ağu–Eyl"
  coverUrl String @db.VarChar(500)           // img
  stock Int @default(0)  stockUnlimited Boolean @default(true)  lowStockAt Int @default(3)
  isFeatured Boolean @default(false) featuredOrder Int @default(0)   // index.html öne çıkanlar 8 kart
  pairWithBox Boolean @default(false) pairOrder Int @default(0)      // kutu.html pairIds (ekmek, zeytinyagi, beyazpeynir, tereyagi)
  showInListing Boolean @default(true)  status ProductStatus @default(ACTIVE)
  seoTitle String? seoDescription String?
  deletedAt DateTime? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
  category Category @relation(fields:[categoryId], references:[id])
  producer Producer? @relation(fields:[producerId], references:[id], onDelete: SetNull)
  images ProductImage[] lots ProductLot[] cycleItems CycleItem[] orderLines OrderLine[] templateItems BoxTemplateItem[]
  @@index([categoryId]) @@index([isFresh, status]) @@index([isFeatured]) @@map("products")
}
model ProductImage { id String @id @default(cuid()) productId String url String @db.VarChar(1000) alt String? sortOrder Int @default(0) product Product @relation(fields:[productId], references:[id], onDelete: Cascade) @@index([productId]) @@map("product_images") } // images[] galeri
model ProductLot {                            // products.js batch "K14-03" → haftalık parti; sipariş/cycle anında snapshot
  id String @id @default(cuid())
  productId String producerId String?
  lotCode String @db.VarChar(50)              // batch
  whyChosen String? @db.Text                  // o haftanın "neden seçtik"
  harvestDate DateTime? @db.Date  bestBefore DateTime? @db.Date
  qtyAvailable Int? qtyAllocated Int @default(0)
  isCurrent Boolean @default(true)
  createdAt DateTime @default(now())
  product Product @relation(fields:[productId], references:[id], onDelete: Cascade)
  producer Producer? @relation(fields:[producerId], references:[id], onDelete: SetNull)
  @@unique([productId, lotCode]) @@index([productId, isCurrent]) @@map("product_lots")
}

// ── Kutu / abonelik ──
model BoxTier {                                // SUB_TIERS small/sezon
  id String @id @default(cuid())
  code String @unique @db.VarChar(30)          // "small" | "sezon" (kutu.html?tier=)
  label String @db.VarChar(100)                // "10'lu Sezon Kutusu"
  itemCount Int                                // count
  price Decimal @db.Decimal(12,2)              // price
  note String? @db.VarChar(255)                // note "9–10 ürün · kalabalık hane…"
  imageUrl String? @db.VarChar(500)            // img
  isRecommended Boolean @default(false)        // RECOMMENDED_TIER rozeti
  sortOrder Int @default(0) isActive Boolean @default(true)
  templates BoxTemplate[] subscriptions Subscription[]
  @@map("box_tiers")
}
model BoxTemplate {                            // haftalık küratör içeriği (cart.js defaultFill yerine)
  id String @id @default(cuid())
  tierId String  weekStart DateTime @db.Date   // Pazartesi
  curatorName String? @db.VarChar(100)         // nasil-seciyoruz "Ece — Bağdam"
  notes String? @db.Text  isPublished Boolean @default(false)
  tier BoxTier @relation(fields:[tierId], references:[id])
  items BoxTemplateItem[]
  @@unique([tierId, weekStart]) @@map("box_templates")
}
model BoxTemplateItem { id String @id @default(cuid()) templateId String productId String lotId String? qty Int @default(1) sortOrder Int @default(0) template BoxTemplate @relation(fields:[templateId], references:[id], onDelete: Cascade) product Product @relation(fields:[productId], references:[id]) @@unique([templateId, productId]) @@map("box_template_items") }
model Subscription {                           // bahceden_sub (purchased=true kısmı)
  id String @id @default(cuid())
  userId String  tierId String
  status SubStatus @default(DRAFT)
  frequency Frequency @default(W1)             // freq
  deliveryDay DeliveryDay                      // deliveryDay
  addressId String?  savedCardId String?
  itemPrefs Json @default("{}")                // itemPrefs {productId: option}
  baseItems Json @default("[]")                // items[] (kullanıcının kalıcı swap tercihleri)
  skipsUsed Int @default(0) skipsAllowedPerYear Int @default(1)   // skipUsed / politika "yılda bir"
  nextBoxDiscountPct Int @default(0)           // nextBoxDiscount retention %50
  introBoxesLeft Int @default(2)               // "ilk 2 kutu %50" sayacı (kural ADR'da)
  startedAt DateTime? pausedUntil DateTime? cancelledAt DateTime? cancelReason String? @db.VarChar(255)
  contractVersionId String?                    // abonelik sözleşmesi versiyonu
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id]) tier BoxTier @relation(fields:[tierId], references:[id])
  address UserAddress? @relation(fields:[addressId], references:[id], onDelete: SetNull)
  savedCard SavedCard? @relation(fields:[savedCardId], references:[id], onDelete: SetNull)
  cycles SubscriptionCycle[] cancellations CancellationRequest[]
  @@index([userId]) @@index([status, deliveryDay]) @@map("subscriptions")
}
model SubscriptionCycle {                      // bir teslimat dönemi: kesimde kilitlenir → tahsil → paket → teslim
  id String @id @default(cuid())
  subscriptionId String  cycleNo Int
  deliveryDate DateTime @db.Date  cutoffAt DateTime   // tek kesim kuralı (settings) buradan hesaplanır; uyelik "DEĞİŞİKLİK İÇİN: X SÜREN VAR"
  status CycleStatus @default(SCHEDULED)
  skipped Boolean @default(false) skipSource String? @db.VarChar(20)   // skipThisWeek
  boxPrice Decimal @db.Decimal(12,2) extrasTotal Decimal @default(0) @db.Decimal(12,2)
  discount Decimal @default(0) @db.Decimal(12,2) shippingFee Decimal @default(0) @db.Decimal(12,2) total Decimal @db.Decimal(12,2)
  orderId String? @unique  lockedAt DateTime?  chargeAttempts Int @default(0) nextRetryAt DateTime?
  subscription Subscription @relation(fields:[subscriptionId], references:[id], onDelete: Cascade)
  order Order? @relation(fields:[orderId], references:[id])
  items CycleItem[]
  @@unique([subscriptionId, cycleNo]) @@index([deliveryDate, status]) @@index([cutoffAt, status]) @@map("subscription_cycles")
}
model CycleItem {                              // kutu içeriği + ekstralar (snapshot)
  id String @id @default(cuid())
  cycleId String productId String lotId String?
  source String @db.VarChar(10)                // template | swap | extra
  qty Decimal @default(1) @db.Decimal(8,3)     // extras factor (0.25 = 250 g)
  unitLabel String? @db.VarChar(50)            // "500 g", "2 × demet"
  unitPrice Decimal @db.Decimal(12,2)          // sipariş anı fiyatı
  prefValue String? @db.VarChar(100)           // data-value çip
  swapOfProductId String?
  cycle SubscriptionCycle @relation(fields:[cycleId], references:[id], onDelete: Cascade)
  product Product @relation(fields:[productId], references:[id])
  @@index([cycleId]) @@map("cycle_items")
}

// ── Sepet / sipariş / ödeme ──
model Cart { id String @id @default(cuid()) userId String @unique items Json @default("[]") /* bahceden_cart [{id,qty,pref}] */ boxDraft Json? /* bahceden_sub (purchased=false, active) */ updatedAt DateTime @updatedAt user User @relation(fields:[userId], references:[id], onDelete: Cascade) @@map("carts") }
model Order {                                  // UA Order + orderType/deliveryDay
  id String @id @default(cuid())
  orderNo String @unique @db.VarChar(30)       // "#1001" (bahceden_orders.no)
  userId String?  orderType OrderType @default(SINGLE)
  customerName String customerEmail String customerPhone String?
  status OrderStatus @default(PENDING) paymentMethod PaymentMethod @default(CARD)
  deliveryDay DeliveryDay? deliveryDate DateTime? @db.Date      // Order.deliveryDay/deliveryDate
  subtotal Decimal @default(0) @db.Decimal(12,2) vatTotal Decimal @default(0) @db.Decimal(12,2)
  shippingCost Decimal @default(0) @db.Decimal(12,2) discountTotal Decimal @default(0) @db.Decimal(12,2) grandTotal Decimal @default(0) @db.Decimal(12,2)
  deliveryAddress Json? invoiceAddress Json?   // snapshot
  couponCode String? @db.VarChar(50)
  note String? adminNote String?
  preinfoVersionId String? contractVersionId String? agreementAcceptedAt DateTime? agreementIp String? @db.VarChar(45)
  ipAddress String? @db.VarChar(45) userAgent String? @db.VarChar(500)
  deliveredAt DateTime? deletedAt DateTime? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
  user User? @relation(fields:[userId], references:[id], onDelete: SetNull)
  lines OrderLine[] payments Payment[] events OrderEvent[] notes OrderNote[] discounts OrderDiscount[] shipment Shipment? cycle SubscriptionCycle?
  @@index([userId]) @@index([status]) @@index([orderType, deliveryDate]) @@index([createdAt]) @@map("orders")
}
model OrderLine { id String @id @default(cuid()) orderId String productId String? sku String @db.VarChar(50) name String @db.VarChar(255) variant String? @db.VarChar(255) /* pref veya "10 ürün + 2 ekstra" */ qty Decimal @db.Decimal(8,3) unitPrice Decimal @db.Decimal(12,2) lineTotal Decimal @db.Decimal(12,2) vatRate Int @default(1) vatAmount Decimal @default(0) @db.Decimal(12,2) lotCode String? @db.VarChar(50) metadata Json? order Order @relation(fields:[orderId], references:[id], onDelete: Cascade) product Product? @relation(fields:[productId], references:[id], onDelete: SetNull) @@index([orderId]) @@map("order_lines") }
model Payment {                                // UA Payment + provider/conversationId/MIT
  id String @id @default(cuid()) orderId String
  provider PaymentProvider @default(IYZICO) method PaymentMethod status PaymentStatus @default(PENDING)
  amount Decimal @db.Decimal(12,2) paidAt DateTime?
  conversationId String @unique @db.VarChar(64)   // idempotency (merchantOid)
  gatewayRef String? @db.VarChar(255) gatewayResponse Json?
  is3ds Boolean @default(true) isMerchantInitiated Boolean @default(false) savedCardId String?
  failureCode String? @db.VarChar(50) failureMessage String? @db.VarChar(500) attemptNo Int @default(1)
  refundedAmount Decimal @default(0) @db.Decimal(12,2)
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
  order Order @relation(fields:[orderId], references:[id], onDelete: Cascade) savedCard SavedCard? @relation(fields:[savedCardId], references:[id], onDelete: SetNull)
  @@index([orderId]) @@index([status]) @@index([gatewayRef]) @@map("payments")   // + raw partial unique (UA 20260505100000 kalıbı)
}
model SavedCard {                              // bahceden_card yerine PSP token (kart verisi asla bizde değil)
  id String @id @default(cuid()) userId String provider PaymentProvider
  providerUserKey String @db.VarChar(255) providerCardToken String @db.VarChar(255)
  bin String? @db.VarChar(8) last4 String @db.VarChar(4) brand String? @db.VarChar(30) expMonth Int? expYear Int?
  isDefault Boolean @default(true) isActive Boolean @default(true) deletedAt DateTime? createdAt DateTime @default(now())
  user User @relation(fields:[userId], references:[id], onDelete: Cascade) subscriptions Subscription[] payments Payment[]
  @@index([userId]) @@map("saved_cards")
}
model WebhookEvent { id String @id @default(cuid()) provider String @db.VarChar(20) eventType String @db.VarChar(100) providerRef String? @db.VarChar(255) payload Json signatureValid Boolean receivedAt DateTime @default(now()) processedAt DateTime? status String @default("received") @db.VarChar(20) error String? @db.Text @@unique([provider, providerRef, eventType]) @@map("webhook_events") }
model Coupon { id String @id @default(cuid()) code String @unique @db.Citext /* BAGDAM050 */ discountType DiscountType discountValue Decimal @db.Decimal(12,2) minOrderAmount Decimal? @db.Decimal(12,2) maxUsageCount Int? usedCount Int @default(0) maxUsagePerUser Int? validFrom DateTime validUntil DateTime isActive Boolean @default(true) appliesTo String @default("ALL") @db.VarChar(20) /* ALL|BOX|SINGLE */ orderDiscounts OrderDiscount[] @@map("coupons") }
model OrderDiscount { id String @id @default(cuid()) orderId String couponId String? discountType DiscountType appliedAmount Decimal @db.Decimal(12,2) order Order @relation(fields:[orderId], references:[id], onDelete: Cascade) coupon Coupon? @relation(fields:[couponId], references:[id]) @@map("order_discounts") }
model OrderEvent { id String @id @default(cuid()) orderId String eventType String @db.VarChar(50) description String? @db.VarChar(500) actorId String? metadata Json? createdAt DateTime @default(now()) order Order @relation(fields:[orderId], references:[id], onDelete: Cascade) @@index([orderId]) @@map("order_events") }
model OrderNote  { id String @id @default(cuid()) orderId String adminId String? text String @db.Text createdAt DateTime @default(now()) order Order @relation(fields:[orderId], references:[id], onDelete: Cascade) @@map("order_notes") }
model Shipment {                               // kurye teslimatı (Urla/Çeşme) — kargo aracı Faz 2
  id String @id @default(cuid()) orderId String @unique
  method ShipmentMethod @default(COURIER) status ShipmentStatus @default(PLANNED)
  scheduledDate DateTime @db.Date deliveryDay DeliveryDay
  carrier String? @db.VarChar(50) trackingNo String? @db.VarChar(100) trackingUrl String? @db.VarChar(500)
  courierName String? @db.VarChar(100) routeOrder Int? coldPack Boolean @default(true)
  shippedAt DateTime? deliveredAt DateTime? proofUrl String? @db.VarChar(500) failureReason String? @db.VarChar(255)
  order Order @relation(fields:[orderId], references:[id], onDelete: Cascade)
  @@index([scheduledDate, status]) @@map("shipments")
}
model CancellationRequest { id String @id @default(cuid()) subscriptionId String reason String @db.VarChar(50) /* data-reason: Fiyat|Ürün çeşitliliği|Teslimat günleri|Diğer */ reasonText String? @db.Text retentionOfferShown Boolean @default(false) retentionAccepted Boolean @default(false) requestedAt DateTime @default(now()) effectiveAt DateTime? confirmedAt DateTime? refundAmount Decimal? @db.Decimal(12,2) subscription Subscription @relation(fields:[subscriptionId], references:[id], onDelete: Cascade) @@map("cancellation_requests") }

// ── Toptan / içerik / yasal / ayar / medya / log ──
model WholesaleLead { id String @id @default(cuid()) email String @db.Citext /* toptan.html #notifyForm */ businessName String? phone String? note String? @db.Text status LeadStatus @default(NEW) source String @default("toptan.html") @db.VarChar(50) ip String? @db.VarChar(45) createdAt DateTime @default(now()) @@index([email]) @@map("wholesale_leads") }
model BlogPost { id String @id @default(cuid()) title String @db.VarChar(300) /* em vurgusu için *...* işareti */ slug String @unique @db.VarChar(300) /* gunluk.html#slug */ kind String @db.VarChar(20) /* SÖYLEŞİ|MEVSİM */ readMinutes Int @default(4) excerpt String? @db.Text body String? @db.Text /* HTML: p, blockquote.pull-quote, ürün linkleri */ coverImage String? @db.VarChar(500) authorId String? relatedSkus String[] @default([]) status ContentStatus @default(DRAFT) publishedAt DateTime? seoTitle String? seoDesc String? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt author User? @relation("BlogAuthor", fields:[authorId], references:[id], onDelete: SetNull) @@index([status, publishedAt]) @@map("blog_posts") }
model FaqItem { id String @id @default(cuid()) question String @db.VarChar(500) answer String @db.Text category String? @db.VarChar(50) /* index.html #faq */ sortOrder Int @default(0) status ContentStatus @default(PUBLISHED) @@map("faq_items") }
model LegalDocument { id String @id @default(cuid()) type LegalType slug String @db.VarChar(100) /* politikalar.html data-policy */ title String @db.VarChar(255) lead String? @db.Text body String @db.Text version Int @default(1) effectiveFrom DateTime @default(now()) isCurrent Boolean @default(true) hash String? @db.VarChar(64) createdAt DateTime @default(now()) @@unique([slug, version]) @@index([type, isCurrent]) @@map("legal_documents") }
model Consent { id String @id @default(cuid()) userId String? guestKey String? @db.VarChar(64) type ConsentType documentId String? granted Boolean grantedAt DateTime @default(now()) revokedAt DateTime? source String @default("HS_WEB") @db.VarChar(20) ip String? @db.VarChar(45) userAgent String? @db.VarChar(500) iysStatus String? @db.VarChar(20) user User? @relation(fields:[userId], references:[id], onDelete: SetNull) @@index([userId, type]) @@map("consents") }
model SiteSetting { id String @id @default(cuid()) group String @db.VarChar(50) key String @unique @db.VarChar(100) value Json createdAt DateTime @default(now()) updatedAt DateTime @updatedAt @@index([group]) @@map("site_settings") }
// SiteSetting grupları (UA seed-settings kalıbı): firma.* (BİRBUDAK GRUP…, adres, tel, maps, IG/YT), site.* (hero, pillars[4], showcase, cloud, blocks, trustItems[4], boxEditorNotes, toptan sayfası, manifesto, footer), kampanya.* (promoBar metni, kod, introDiscountPct 50, introBoxes 2), teslimat.* (ilceler [Urla,Çeşme], gunler, cutoffRule {offsetDays:1,time:"12:00"}, kargoUcreti 49, ucretsizKargoLimiti 1000, abonelikKargoDahil true, teslimatSaat "09:00-18:00"), odeme.* (provider, krediKartiAktif, havaleAktif), abonelik.* (skipPerYear 1, retentionPct 50, dunning [24,72]), mail.*, sms.*, iyzico.*/paytr.* (SENSITIVE), seo.*
model MediaFolder { id String @id @default(cuid()) name String @db.VarChar(200) slug String @db.VarChar(200) parentId String? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt parent MediaFolder? @relation("FolderTree", fields:[parentId], references:[id], onDelete: Cascade) children MediaFolder[] @relation("FolderTree") files MediaFile[] @@unique([parentId, slug]) @@map("media_folders") }
model MediaFile { id String @id @default(cuid()) name String @db.VarChar(300) originalName String @db.VarChar(300) mimeType String @db.VarChar(100) size Int path String @db.VarChar(500) folderId String width Int? height Int? thumbnailPath String? @db.VarChar(500) alt String? @db.VarChar(300) createdAt DateTime @default(now()) updatedAt DateTime @updatedAt folder MediaFolder @relation(fields:[folderId], references:[id], onDelete: Cascade) @@index([folderId]) @@map("media_files") }
// AuditLog, SystemLog, CronLog, Incident, MailLog, EmailTemplate, SmsTemplate, SmsLog, Ticket/TicketReply: UA schema.prisma'dan birebir (alan listesi UA 2161-2321).
```

**Frontend → model eşlemesi (özet):** `bahceden_cart` → misafir: localStorage; üye: `Cart.items` (`PUT /cart` sync). `bahceden_sub` (active, purchased=false) → `Cart.boxDraft`; purchased=true → `Subscription` + üretilmiş `SubscriptionCycle`'lar; `extras/extrasCutoff` → bir sonraki açık cycle'ın `CycleItem(source=extra)`; `skipThisWeek` → `cycle.skipped`; `draft/subDraft` → yalnız bellek (PATCH ile onay). `bahceden_address` → `UserAddress`. `bahceden_card` → **kaldırılır**, `SavedCard` (PSP token). `bahceden_member/session` → `User` + httpOnly cookie. `bahceden_orders` → `Order` (orderType). `bahceden_retention_offered` → `User.retentionOfferUsedAt` + `CancellationRequest`. `bahceden_prefs` → `User.prefs` (misafirde localStorage kalır). Promo BAGDAM050 → `Coupon` + `Subscription.introBoxesLeft`.

# 3. API yüzeyi

Global prefix `/api`, guard sırası UA ile aynı: `ThrottlerGuard → JwtAuthGuard → CsrfGuard → RolesGuard`; `@Public()` uçlar anonim + varsa kullanıcıyı çözer. **Kimlik modeli:** UA auth modülü birebir — access JWT (15m) + refresh (7d) **httpOnly cookie** (`access_token`/`refresh_token`, `sameSite lax`, `COOKIE_DOMAIN=.bagdam.com`), CSRF double-submit (`GET /auth/csrf` → `csrf_token` cookie, mutasyonlarda `X-CSRF-Token`), Bearer fallback (admin). Statik site `fetch(url, {credentials:"include"})` ile çağırır; cart.js'teki `isLoggedIn()` → `GET /auth/me` sonucu (bellek + `body.is-logged-in`). Admin: UA `AdminAuthContext` (localStorage Bearer) kopyalanır; P1'de cookie'ye taşınır (UA audit P0-07). **Roller:** `CUSTOMER`, `EDITOR` (içerik+medya+ürün okuma), `ADMIN`; `User.isWholesale` bayrağı (Faz 2). Hata/log/audit: `AllExceptionsFilter`, `@Audited('modul')` interceptor, `RequestIdMiddleware`.

| Modül (UA kaynağı) | Public | Auth (müşteri) | Admin |
|---|---|---|---|
| `health` (UA) | `GET /health`, `/health/detailed` (alan adı sızdırmaz) | — | `GET /health/detailed/admin` |
| `auth` (UA) | `POST /auth/register` (email, password, name?, consents[]), `/login`, `/refresh`, `/forgot-password`, `/reset-password`, `GET /auth/verify-email`, `/csrf` | `GET /auth/me`, `POST /auth/logout`, `PATCH /auth/me`, `/me/password`, `DELETE /auth/me`, `GET/POST/PATCH/DELETE /auth/me/addresses`, `PATCH /auth/me/preferences` (prefs Json) | — |
| `catalog` (yeni; UA products+categories kalıbı) | `GET /catalog/bootstrap` → `{products[], tiers[], freqOptions[], deliveryDays[], settings{deliveryFee, freeShippingThreshold, cutoffRule, promo}}` (CacheInterceptor 60 s) — products.js'in tam karşılığı; `GET /products?tab=&fresh=&featured=`, `GET /products/:sku`, `GET /categories`, `GET /producers`, `GET /box-tiers`, `GET /box-tiers/:code/template?week=` | — | `POST/PATCH/DELETE /products/:id`, `PATCH /products/bulk-*`, `POST /products/:id/images`, `POST/PATCH /products/:id/lots`, `POST/PATCH/DELETE /categories`, `/producers`, `/box-tiers`, `POST/PATCH /box-templates`, `/box-templates/:id/items`, `POST /box-templates/:id/publish` |
| `cart` (UA) | `POST /cart/summary` (fiyat/kargo/KDV hesap — client hesaplamaz, UA pricing.service) | `GET /cart`, `PUT /cart` (items + boxDraft sync), `DELETE /cart` | — |
| `coupons` (UA) | `POST /coupons/validate` | — | CRUD `/coupons` |
| `checkout` (yeni; UA orders.createOrder + payment.service kalıbı) | — | `POST /checkout/quote` (sepet+kutu taslağı → satır/kargo/indirim), `POST /checkout` (addressId, deliveryDay, consents, saveCard) → order(s) + payment session (`checkoutFormContent`/`paymentPageUrl`), `GET /checkout/:orderNo/status` | — |
| `payments` (UA gateways + iyzico adapter) | `POST /payments/iyzico/callback` (3DS/CF dönüş), `POST /webhooks/iyzico` (HMAC → WebhookEvent), `POST /payments/paytr/callback` (Faz 2) | `GET /me/cards`, `POST /me/cards` (registerCard), `DELETE /me/cards/:id`, `PATCH /me/cards/:id/default` | `POST /payments/:id/refund`, `GET /payments` |
| `orders` (UA kırpılmış) | `POST /orders/guest-lookup` (opsiyonel) | `GET /orders/my`, `GET /orders/my/:id`, `POST /orders/:id/cancel-request`, `GET /orders/:id/receipt-pdf` | `GET /orders?status=&type=&date=`, `GET /orders/stats`, `/export`, `GET/PATCH /orders/:id`, `PATCH /orders/:id/status` (transitions tek kaynak), `POST /orders/:id/notes`, `PATCH /orders/:id/lines/:lineId` |
| `subscriptions` (yeni) | — | `GET /me/subscription` (sub + açık cycle + geri sayım), `POST /subscriptions` (checkout içinden çağrılır), `PATCH /me/subscription` (frequency, deliveryDay, addressId, savedCardId, itemPrefs, baseItems), `GET /me/subscription/cycles`, `POST /me/subscription/cycles/:id/skip`, `DELETE …/skip`, `POST …/cycles/:id/swap` ({slot, productId}), `POST …/cycles/:id/extras` ({productId, factor}), `DELETE …/extras/:itemId`, `POST /me/subscription/cancel` ({reason, text}) → retention teklifi döner, `POST /me/subscription/cancel/confirm`, `POST /me/subscription/retention/accept` | `GET /subscriptions?status=&day=`, `GET /subscriptions/:id`, `PATCH /subscriptions/:id` (pause/resume/force), `GET /cycles?date=&status=`, `POST /cycles/:id/lock|charge|retry|skip|mark-packed|mark-delivered`, `GET /ops/pick-list?date=` (ürün×adet), `GET /ops/packing-list?date=` (kutu fişi), `GET /ops/producer-orders?date=` |
| `shipments` (yeni; UA shipping kırpılmış) | — | `GET /orders/:id/tracking` | `GET /shipments?date=`, `PATCH /shipments/:id/status`, `POST /shipments/:id/proof` |
| `leads` (yeni) | `POST /wholesale-leads` (email, throttle 3/dk) | — | `GET /wholesale-leads`, `PATCH /wholesale-leads/:id` |
| `content` (UA) | `GET /content/posts?limit=3`, `GET /content/posts/slug/:slug`, `GET /content/faqs`, `GET /content/pages/slug/:slug` | — | CRUD posts/faqs/pages |
| `legal` (yeni) | `GET /legal` (tüm güncel politikalar → politikalar.html), `GET /legal/:slug/current` | `POST /consents` | CRUD `/legal` (yeni versiyon yayınla) |
| `settings` (UA) | `GET /settings` (PUBLIC_ALLOWED_GROUPS: firma, site, kampanya, teslimat, seo) | — | `GET /settings/admin`, `PUT /settings/:group`, `POST /settings/mail/test` |
| `media` (UA) | `GET /media/serve/*path` | — | folders/files CRUD + upload (ADMIN, EDITOR) |
| `members` (UA) | — | — | `GET /members`, `/stats`, `/:id`, `/:id/orders`, `/:id/subscription`, `PATCH /:id`, `/:id/status` |
| `dashboard`, `audit`, `system-logs`, `email-templates`, `sms-templates`, `messaging` (UA) | — | — | UA uçları aynen |
| `sitemap` (UA) | `GET /sitemap.xml` (statik sayfalar + ürün + günlük) | — | — |

Cron'lar (yalnız `NODE_APP_INSTANCE` 0, UA `CronLogService` kalıbı): `cycles:generate` (günlük 00:30, her aktif abonelik için horizon 4 hafta cycle üret), `cycles:lock-and-charge` (her 15 dk: `cutoffAt <= now` → LOCKED → saklı karttan MIT tahsil → PAID/UNPAID + Order oluştur), `cycles:retry` (dunning +24s/+72s), `reminders` (kesimden 24 s önce e-posta/SMS), `order-timeout` (UA), `log-cleanup` (system/cron logs; audit asla).

# 4. Admin panel

UA `adminNavConfig.ts` yapısıyla (Grup → Leaf/Divider) yeni menü. Öncelik: **P0** lansman için şart, **P1** ilk ay, **P2** sonra.

| Ekran (rota) | Önc. | Tablo(lar) | Not / UA kaynağı |
|---|---|---|---|
| Giriş (`/login`) | P0 | users | `pages/auth/AdminLoginPage.tsx` |
| Özet (`/`) | P0 | orders, subscriptions, cycles, products | `AdminDashboardPage` + `GET /dashboard/stats`: bugünün teslimatları, bu haftanın kutu sayısı (gün bazlı), bekleyen ödeme, düşük stok |
| Katalog › Ürünler liste/form (`/urunler`, `/urunler/:id`) | P0 | products, product_images, product_lots, producers | `AdminUrunlerListePage/FormPage` + MediaPicker; form sekmeleri: Genel / Fiyat-KDV-Birim / Kutu (isFresh, boxAmount, extraOptions, pairWithBox) / Tercih ekseni / Metinler (desc, why, storage, allergen, freshness) / Parti (lot listesi, "güncel parti") / Görseller / SEO |
| Katalog › Kategoriler (`/urunler/kategoriler`) | P0 | categories | `AdminUrunlerKategorilerPage` (4 sabit sekme: ad, ikon, panel notu, sıra) |
| Katalog › Üreticiler (`/urunler/ureticiler`) | P0 | producers | UA `AdminUrunlerMarkalarPage` yeniden adlandırılmış |
| Katalog › Öne çıkanlar & kutu yanı (`/urunler/vitrin`) | P1 | products.isFeatured/pairWithBox | dnd-kit sıralama |
| Kutular › Tier'lar (`/kutular/tierler`) | P0 | box_tiers | basit CRUD |
| Kutular › Haftalık içerik (`/kutular/haftalik`) | P0 | box_templates, box_template_items, product_lots | hafta seçici → tier başına ürün listesi (fresh havuzundan), lot seçimi, küratör adı, "yayınla" |
| Abonelikler › Liste/Detay (`/abonelikler`, `/abonelikler/:id`) | P0 | subscriptions, cycles, cycle_items, cancellation_requests | durum, gün, frekans, adres, kart (last4), cycle zaman çizelgesi, skip/ekstra/swap geçmişi, iptal nedenleri, force işlemler |
| Operasyon › Teslimat günü (`/operasyon/gun/:date`) | P0 | cycles, orders, shipments | kesim sonrası: toplama listesi (ürün×adet), paket fişleri (kutu içeriği + etiket QR), kurye sırası, durum güncelle (packed/out/delivered), CSV/PDF (UA `orders-pdf.service`) |
| Operasyon › Üretici siparişleri (`/operasyon/ureticiler`) | P1 | cycles→producer toplamı | salt okunur özet, ileride producer_orders |
| Siparişler › Liste/Detay (`/siparisler`, `/siparisler/:id`) | P0 | orders, order_lines, payments, order_events, order_notes, shipments | `AdminSiparislerListePage/DetayPage` + `features/siparisler/api.ts`; filtre: tip (tekil/kutu/abonelik), durum, gün |
| Siparişler › Ödeme problemleri (`/siparisler/odeme-problemleri`) | P1 | payments, cycles UNPAID | dunning listesi, "kart güncelleme linki gönder" |
| Siparişler › İade/İptal talepleri | P1 | cancel/refund | UA kırpılmış |
| Müşteriler (`/uyeler`, `/uyeler/:id`) | P0 | users, user_addresses, consents, saved_cards(last4) | `AdminUyelerListePage/UyeDetayPage`: siparişler + abonelik sekmesi |
| Toptan talepleri (`/toptan`) | P0 | wholesale_leads | liste + durum + not (çok küçük ekran) |
| Promosyon › Kuponlar (`/promosyon/kuponlar`) | P1 | coupons | UA `promosyon/*` |
| İçerik › Günlük (`/icerik/gunluk`) | P0 | blog_posts | `AdminBlogPage` (tiptap; pull-quote ve ürün linki butonu) |
| İçerik › SSS (`/icerik/sss`) | P0 | faq_items | `AdminSssPage` |
| İçerik › Site içeriği (`/icerik/site`) | P0 | site_settings (site.*, kampanya.*) | sekmeli form: Anasayfa (hero, pillars, showcase, cloud, blocks), Ürünler sayfası (güven şeridi, panel notları), Kutu editörü notları, Toptan sayfası, Nasıl seçiyoruz (manifesto, karşılaştırma tablosu, küratör), Footer/İletişim/Sosyal, Kampanya şeridi — UA `AdminAyarlarPage` kalıbı (PUT /settings/:group) |
| İçerik › Politikalar (`/icerik/politikalar`) | P0 | legal_documents | 8 sekme, "yeni versiyon yayınla" (eski versiyon saklanır) |
| Medya (`/medya`) | P0 | media_folders, media_files | `AdminMedyaPage` + `MediaPickerModal` aynen; başlangıç klasörleri: urunler/, kutular/, sahne/, gunluk/, ikonlar/ (mevcut 58 kullanılan dosya seed ile içe aktarılır) |
| Mesajlaşma › E-posta şablonları / Mail log / SMS şablonları | P1 | email_templates, mail_logs, sms_* | UA aynen |
| Ayarlar › Genel/Firma, Teslimat & Fiyatlandırma, Ödeme, Abonelik kuralları, Mail/SMS, SEO | P0 | site_settings | UA `AdminAyarlarPage` + `entegrasyonlar/*` (hassas anahtar maskeleme) |
| Kullanıcılar & roller (`/kullanicilar`) | P1 | users (ADMIN/EDITOR) | UA `AdminKullanicilarPage`; permission ağacı V1'de yok |
| Sistem › Sağlık / Hata günlüğü / Cron / Incident / Audit | P1 | system_logs, cron_logs, incidents, audit_logs | UA `pages/sistem/*` aynen |

# 5. Geliştirme sırası

Kural: her adımın çıktısı sonrakinin girdisi; site hiç kapanmaz (statik HTML önce `/var/www/`-benzeri statik olarak yayına alınır, sonra sayfa sayfa API'ye bağlanır; bir sayfa API'ye geçene kadar `products.js` fallback'i çalışır).

| # | Adım | Kapsam | Ön koşul | Tanım-of-done | Neden bu sırada | Efor |
|---|---|---|---|---|---|---|
| 0 | **Karar sprinti (ADR 0001–0008)** | Ödeme sağlayıcısı (iyzico CF + kart saklama; NON3D başvurusu), tek kesim kuralı (öneri: teslimat gününden 1 gün önce 12:00 — politika ve lockedDeliveryDay ile uyumlu), teslimat bölgesi (Urla+Çeşme kurye; kargo V2), ilk-kutu indirimi (2 kutu %50, otomatik, üye başına 1 kez), atlama hakkı (yılda 1), abonelik tahsilat anı (kesimde MIT), tek-DB kuralı sapması, DNS/CF. Şirket ön koşulları listesi (ETBİS, İşletme Kayıt Belgesi, İYS, e-Arşiv yolu) kullanıcıya teslim | — | `docs/adr/0001-0008.md` (≤25 satır), `docs/SISTEM-DURUMU.md`, karar kuyruğu ≤3 | Şema bu kararlara bağlı; bahcedenal'da karar birikimi işi durdurdu | 2 |
| 1 | **Monorepo iskeleti + statik web yayını** | UA kök dosyaları kopyala (`package.json`, `pnpm-workspace`, `turbo`, `.npmrc`, `.gitignore`, `.env.example`), `website/`→`apps/web/src`, `apps/web/scripts/build.mjs`, `apps/api` UA bootstrap (main.ts, app.module, common/*, config/*, health, settings, audit, system-logs, prisma), `apps/admin` UA iskeleti + login + boş dashboard, `packages/shared`, `database/schema.prisma` (UA'dan alınan modeller + §2 yeni modeller) → **tek `init` migration**, seed (admin env'den, settings, categories/tiers/freq/days, products.js → Product/Producer import scripti) | 0 | Lokal: `pnpm dev` ile api :4010 `/api/health` 200, admin login, web statik açılıyor; `tsc --noEmit` 3 pakette temiz | Şema ilk günden tam ki migration zinciri temiz kalsın; UA dosyaları olduğu gibi gelince geri dönüş yok | 4 |
| 2 | **Sunucu walking skeleton (canlı)** | `/opt/bagdam`, `bagdam_db` + `bagdam` PG kullanıcısı, `.env`, `ecosystem.config.js` (:5010), `deploy.sh`, nginx 3 vhost (`bagdam.com/www` statik web, `admin.bagdam.com`, `api.bagdam.com`), LE sertifika, Cloudflare A/CNAME (proxied), GitHub Actions deploy.yml, health-check/backup script entegrasyonu | 1 | `https://bagdam.com` mevcut tasarım canlı (statik), `https://api.bagdam.com/api/health` 200, `admin.bagdam.com` login, Actions yeşil, Telegram health'e bagdam eklendi | bahcedenal dersi: backend hiç deploy olmadı; ilk hafta canlı olmalı, sonra her push canlıya iner | 2 |
| 3 | **Katalog API + ilk dinamik sayfalar** | `catalog` modülü (bootstrap/products/categories/producers/box-tiers/templates), ürün/kategori/üretici/tier/haftalık içerik admin ekranları, medya modülü + mevcut görsellerin içe aktarımı; web: `assets/bootstrap.js`, `urunler.html` → `urun.html` → `index.html` öne çıkanlar → `kutu.html` (tier/pair/şablon) API'den; `products.js` fallback'i kaldır | 2 | Admin'den fiyat değişince sitede görünüyor; 4 sayfa API'den; Lighthouse tasarım farkı 0 (görsel regresyon ekran görüntüsü karşılaştırması) | Katalog her şeyin girdisi; en az riskli dinamikleştirme; admin'in gerçek işi hemen başlar | 6 |
| 4 | **İçerik/CMS + politikalar + toptan lead** | content (posts/faq/pages), legal (versiyonlu), settings `site.*`/`kampanya.*`/`teslimat.*`, leads; web: gunluk.html, index teaser/SSS/hero/pillars/promo bar, politikalar.html, toptan.html, nasil-seciyoruz.html, footer | 3 | 10 sayfanın tüm İÇERİK blokları admin'den düzenlenebilir; toptan e-postası DB'ye düşüyor + bildirim maili | Auth gerektirmez, paralel ilerleyebilir; lansmanda içerik ekibi bağımsız çalışır | 4 |
| 5 | **Auth + hesap + sepet senkronu** | UA auth modülü (register/login/refresh/forgot/reset/verify/me/addresses) + mail çekirdeği (SMTP ayarları DB'de, MailLog); web: sepet.html/uyelik.html auth kapısı API'ye, `bahceden_member/session/card` kaldır, `Cart` sync (login'de localStorage→DB merge), adres formu, prefs | 3 | Üye ol/giriş/çıkış/şifre sıfırlama uçtan uca; uyelik.html adres kartı DB'den; admin Müşteriler ekranı | Checkout ve abonelik için kimlik şart; UA'dan kopya olduğu için hızlı | 4 |
| 6 | **Fiyatlama + checkout + ödeme (tekil + tek seferlik kutu)** | UA `pricing.service` (KDV %1, kargo 49/eşik 1000/abonelikte dahil, kupon BAGDAM050), `checkout` + `orders` (UA createOrder sırası: doğrula→adres→stok→order+lines snapshot→payment session; `$transaction`), iyzico adapter (CF init/callback/retrieve, webhook HMAC, WebhookEvent idempotency, registerCard), Order durum makinesi + OrderEvent, sipariş e-postaları, admin Siparişler ekranı; web: sepet.html checkout adımları API'ye (kart formu yerine iyzico CF iframe/redirect; ödeme sonrası `?odeme=ok` dönüşü), uyelik.html sipariş geçmişi | 5 | Sandbox'ta tekil ürün + tek seferlik kutu siparişi ödenip admin'de görünüyor; webhook tekrarında çift kayıt yok; sözleşme onayı + versiyonu siparişe yazılıyor | Abonelik motoru ödeme/kart saklama üzerine kurulur; önce tek seferlik akış sağlamlaşır | 7 |
| 7 | **Abonelik motoru** | Subscription/Cycle/CycleItem servisleri, cycle üretimi, kesim-kilit-tahsil cron (MIT saklı kart), dunning/retry, skip/swap/extras/day/freq PATCH'leri, iptal+retention akışı, ilk-2-kutu indirimi, hatırlatma mail/SMS (NetGSM), admin Abonelikler + Teslimat günü (pick/packing list, kurye durumu), Shipment; web: kutu.html "aboneliği başlat" → checkout; uyelik.html abonelik kartı/iptal/atla/taslak onayı; sepet.html "bu haftaki kutuma ekle" | 6 | Sandbox'ta abonelik başlat → cycle üretildi → kesimde tahsil → PAID → teslimat listesi → delivered; atla/ekstra/swap/iptal uçtan uca; başarısız ödeme retry + UNPAID | Son ve en karmaşık parça; tüm alt yapılar (katalog, auth, ödeme, mail) hazır olmalı | 8 |
| 8 | **Sertleşme + lansman** | Jest güvenlik/iş kuralı testleri (UA `__tests__/security` şablonu, prod DB guard), görsel regresyon, rate limit/nginx doğrulama, SPF/DKIM/DMARC, Cloudflare WAF istisnası `/api/webhooks/*`, yedek geri yükleme provası, PII/log taraması, `docs/SISTEM-DURUMU.md`, runbook; iyzico canlı anahtarlar; `robots/sitemap` | 7 | Lansman kontrol listesi %100; geri yükleme provası raporu | — | 3 |
| 9 | **Faz 2 (lansman sonrası)** | PayTR adapter, kargo aracı (Geliver/Basit Kargo) ve Tr* adres tabloları, e-Arşiv entegratörü, WhatsApp utility, toptan sipariş/fiyat listesi, İYS API, admin cookie auth, çerez banner'ı (bahcedenal CookieConsent metni) | 8 | — | — | 10+ |

Toplam ~40 iş günü (tek geliştirici; UA kopyaları nedeniyle altyapı günleri düşük).

# 6. İlk 2 hafta

**Gün 1–2 (Adım 0):** ADR'ları yaz (`docs/adr/0001-yigin.md` … `0008-dns.md`), kullanıcıya §8 sorularını ilet; cevapsız kalan = özellik dışarı.

**Gün 3–6 (Adım 1):**
```bash
# repo kökü (public bagdam)
git mv website apps/web/src && mkdir -p apps/api apps/admin packages/shared database docs/adr
# UA'dan kopya (yollar düzeltilerek): package.json, pnpm-workspace.yaml, turbo.json, .npmrc, .env.example, deploy.sh, ecosystem.config.js, .github/workflows/deploy.yml
# apps/api: UA main.ts, app.module.ts, config/{env-validator,jwt.config,cookie.config}.ts, common/* (prisma, guards, filters, interceptors, decorators, dto, crypto.util, mail.*, sms.*, cron-log.*), modules/{health,settings,audit,system-logs,media,auth,users,members,content,categories,products(→catalog),cart,coupons,pricing,orders(kırpılmış),payment/gateways,email-templates,dashboard,sitemap}
# apps/admin: UA src/{AdminApp,main,index.css,app/router,layouts,components,contexts,hooks,lib,features/components,features/medya,pages/{auth,dashboard,medya,ayarlar,sistem,kullanicilar}}
# packages/shared: UA package.json + tsconfig + src/index.ts + types/{user,product,order,media,blog}.ts
pnpm install
# database/schema.prisma → §2; lokal PG: createdb bagdam_dev
npx prisma migrate dev --schema=database/schema.prisma --name init
npx tsx database/seeds/seed.ts   # SEED_ADMIN_EMAIL/PASSWORD env; settings; categories/tiers/freq/days; products.js → Product/Producer import
pnpm dev:api   # :4010 → GET /api/health, GET /api/catalog/bootstrap
pnpm dev:admin # :3011 → login → Ürünler listesi (ilk admin ekranı)
pnpm --filter @bagdam/web dev   # basit static server (:8080) → urunler.html assets/bootstrap.js ile API'den (ilk dinamik sayfa)
```
İlk endpoint: `GET /api/catalog/bootstrap` (products.js'in JSON karşılığı + settings). İlk admin ekranı: Ürünler liste/form (UA `AdminUrunlerListePage/FormPage` kırpılmış). İlk dinamik sayfa: `urunler.html` (sadece `<script src="assets/products.js">` → `assets/bootstrap.js` + inline script `bagdam:ready` sarmalı; görsel fark 0).

**Gün 7–8 (Adım 2):** sunucu kurulumu (§7) + ilk GitHub Actions deploy; `bagdam.com` statik canlı.
**Gün 9–10:** `urun.html`, `index.html` öne çıkanlar, `kutu.html` tier/pair/şablon API'den; admin Kategoriler/Üreticiler/Tier/Haftalık içerik; medya içe aktarımı. Hafta sonu: `docs/SISTEM-DURUMU.md` + `YAPILACAKLAR.md`.

# 7. Deploy & ops

| Konu | Karar |
|---|---|
| Dizin | `/opt/bagdam/` (monorepo, deploy key ile clone), `apps/api/.env` (yalnız sunucu), `apps/api/uploads/media/` (Multer/sharp hedefi, `process.cwd()` PM2 cwd = apps/api), `logs/`, `apps/web/dist`, `apps/admin/dist` |
| PM2 | `ecosystem.config.js`: `name bagdam-api`, `cwd /opt/bagdam/apps/api`, `script dist/main.js`, `instances 1` (yük düşük; cron kilidi yine `NODE_APP_INSTANCE`), `exec_mode fork` (2'ye çıkınca cluster), `env {NODE_ENV:'production', PORT:5010}`, `env_file`, `max_memory_restart 512M`, `kill_timeout 8000`, log `/opt/bagdam/logs/api-{error,out}.log`; pm2-logrotate mevcut |
| nginx | 3 vhost UA kalıbı: `bagdam.com`+`www` → `root /opt/bagdam/apps/web/dist`, `try_files $uri $uri/ =404` (MPA; SPA fallback yok), HTML `Cache-Control no-cache`, `assets/` ve `styles.css` `max-age=86400` (`?v=sha` damgalı), `/.well-known/acme-challenge/ → /var/www/letsencrypt`, güvenlik header'ları, `gzip`; `admin.bagdam.com` → admin/dist SPA `try_files … /index.html`, `/assets/` immutable 365d; `api.bagdam.com` → `proxy_pass http://127.0.0.1:5010`, `limit_req zone=api burst=20`, `/api/auth/login` `zone=login`, `X-Real-IP/X-Forwarded-*`, `client_max_body_size 50M` (`/api/media/` 100M), `/api/webhooks/` ve `/api/payments/*/callback` rate-limit dışı. 80→301 https. |
| SSL / CF | certbot webroot (`certbot certonly --webroot -w /var/www/letsencrypt -d bagdam.com -d www.bagdam.com -d admin.bagdam.com -d api.bagdam.com`, certbot.timer + deploy-hook reload); Cloudflare zone zaten aktif (Free, NS Cloudflare): `A @ → <SUNUCU_IP> proxied`, `CNAME www/admin/api → bagdam.com proxied`, SSL Full (strict) (LE sonrası), Always HTTPS, HSTS; WAF özel kural: `/api/webhooks/*` ve `/api/payments/*/callback` için Bot Fight/challenge kapalı; `/api/*` cache bypass; sunucudaki `/root/cf-api.sh` ile kayıtlar eklenebilir. Mail kayıtları (MX/SPF/DKIM/DMARC) DNS-only — mail sağlayıcısı kararı §8. |
| .env (sunucu) | `DATABASE_URL=postgresql://bagdam:***@127.0.0.1:5432/bagdam_db?connection_limit=5&pool_timeout=20`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SETTINGS_ENCRYPTION_KEY` (REQUIRED'a taşınır), `COOKIE_DOMAIN=.bagdam.com`, `WEB_URL`, `ADMIN_URL`, `PAYMENT_PROVIDER=IYZICO`, `IYZICO_*` (veya DB settings şifreli), `NODE_ENV=production`, `PORT=5010`, `DISABLE_MAIL` (dev'de true) |
| Backup / health | `/opt/birbudak/scripts/backup-bagdam.sh` (mevcut `backup-<proje>.sh` kopyası: `pg_dump -Fc bagdam_db` + `uploads` tar.gz → `/opt/birbudak/backups/bagdam/`, 7 gün, cron 03:30); `health-check.sh`'a `bagdam-api` PM2 adı + `http://127.0.0.1:5010/api/health` eklenir; error-watcher'a `/opt/bagdam/logs/api-error.log`; daily-report'a DB/uploads boyutu |
| CI/CD | `.github/workflows/deploy.yml` UA kopyası (branch `main`, `bash /opt/bagdam/deploy.sh`, 2 deneme); `deploy.sh` UA kopyası ama **sıra düzeltilir**: fetch/reset → install → prisma generate (pnpm hack) → **API+web+admin build** → `pg_dump -Fc` ön-yedek (`/opt/birbudak/backups/bagdam/pre-migrate-<sha>.dump`) → `prisma migrate deploy` → `pm2 reload` → `.last-deploy-sha` |
| Staging | Ayrı sunucu yok. Sunucuda isteğe bağlı `bagdam_staging` DB + `bagdam-api-staging` :5011 (UA'da yok; yalnız ödeme sandbox testleri için); varsayılan: lokal + iyzico sandbox yeterli |
| Dev DB stratejisi (tek DB kuralı) | **Uyulmaz — bilinçli sapma (ADR-0007).** Artı (UA): drift yok, tek migration kaynağı, gerçek veriyle test. Eksi (kanıt): UA'da testler prod'a 163 sipariş yazdı; `migrate dev` drift görünce reset teklif eder; tünel gecikmesi (bahcedenal ADR-0003 87 ms/sorgu); PII lokalde; public repo. Karar: lokal PostgreSQL `bagdam_dev` + `prisma migrate dev` lokal → migration commit → sunucuda `migrate deploy`; `db push` yasak; UA `jest-global-setup` prod guard'ı (`:5436/`, `bagdam_db`, `<SUNUCU_IP>`) ilk günden; SSH tüneli (`ssh -N bagdam`, 5436) yalnız salt-okunur inceleme/`psql`; prod'a veri yazan tek yol admin paneli veya deploy. |

# 8. Riskler ve açık kararlar

**Kullanıcıya sorular (Sprint 0'da kapanmalı):**
1. Ödeme: iyzico (önerilen) mi PayTR mi? Saklı karttan NON3D tekrarlayan tahsilat yetkisi başvurusu yapılabilir mi? Abonelik tahsilatı kesimde mi teslimat günü mü (politika "teslimat günü")?
2. Tek kesim kuralı: teslimattan 1 gün önce 12:00 mı (politika/lockedDeliveryDay), 2 gün önce 23:59 mu (nextCutoff)?
3. İlk 2 kutu %50: otomatik mi kodla mı; üye başına bir kez mi; Order.total'da da uygulanacak mı?
4. Atlama hakkı: yılda 1 mi (politika) ömür boyu 1 mi (kod)? Pause (duraklatma) V1'de var mı?
5. Teslimat: yalnız Urla+Çeşme kurye mi; mahalle kısıtı; kargo (şehir dışı kuru ürün) V1'de var mı? Teslimat saati 09:00–18:00 sabit mi?
6. Fresh ürünler tekil satılmayacak mı (SSS çelişkisi)? Kutu swap havuzu = haftalık şablon mu tüm fresh ürünler mi? Stok/tükenme yönetilecek mi?
7. Üyelik: e-posta+parola mı, telefon+OTP mi (SMS maliyeti)? E-posta doğrulama zorunlu mu? Pazarlama onayı (İYS) kutucuğu?
8. Mail/SMS sağlayıcısı: SMTP (hangi), NetGSM (UA hesabı var mı)? bagdam.com için mail servisi (MX) ne olacak?
9. Fatura: GİB portal elle mi entegratör mü (Faz 2); bireysel/kurumsal fatura alanları checkout'ta gösterilecek mi?
10. Sosyal linkler, "6 üretici" metni, Nurdan/Nuran, küratör adı, kampanya şeridinin hangi sayfalarda olacağı (içerik kararları).
11. Domain e-posta ve şirket ön koşulları (ETBİS, İşletme Kayıt Belgesi, İYS, VERBİS, e-Arşiv, GEKAP) kim/ne zaman.
12. admin.bagdam.com / api.bagdam.com subdomain'leri kabul mü, yoksa `/api` path proxy mi?

**Varsayımlar:** tek depo/tek satıcı; tek dil TR; mobil app yok; Redis yok; kart verisi asla bizde değil; fiyatlar KDV dahil %1; Order.orderNo 1001'den başlar; misafir sepeti localStorage, checkout login ister; Tr* adres tabloları V1'de yok (ilçe select).

**Riskler:** (1) Abonelik motoru + MIT tahsilat + dunning en karmaşık parça; sağlayıcı onayı gecikirse lansman tek seferlik kutuyla yapılır (abonelik "yakında"). (2) Public repo'da sır sızıntısı — `.env` yalnız sunucu, seed env'den, pre-commit gitleaks (önerilir). (3) UA kopyasında gereksiz alan/kod taşınması — her kopyada "silme değil, hiç alma" ilkesi. (4) Statik HTML + fetch: JS kapalı/yavaş ağda boş liste — `bagdam:ready` öncesi iskelet görünüm, 2 s timeout'ta hata notu. (5) Cache tutarlılığı: settings değişince `GET /settings` 60 s cache; kampanya şeridi gecikmesi kabul. (6) PG `max_connections 100` paylaşımlı — `connection_limit=5`. (7) Tasarım regresyonu — her dinamik sayfada ekran görüntüsü diff'i (Playwright) zorunlu.

# 9. Referanslardan somut alıntılar

| Kaynak dosya/kalıp | Nerede (adım) | Ne alınır |
|---|---|---|
| UA `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.env.example`, `.gitignore` | 1 | Kök konfig; `predev` tünel script'i **alınmaz** (tek DB sapması) |
| UA `deploy.sh`, `ecosystem.config.js`, `.github/workflows/deploy.yml` | 2 | Yollar `/opt/bagdam`, filtre `@bagdam/*`, port 5010, instances 1; migrate sırası + pre-dump + SHA eklenir |
| UA `apps/api/src/main.ts`, `app.module.ts`, `config/{env-validator,jwt.config,cookie.config}.ts` | 1 | Bootstrap, trust proxy, helmet/compression/cookie, CORS listesi (`bagdam.com` domainleri), guard/interceptor sırası, cron instance kilidi; `SETTINGS_ENCRYPTION_KEY` REQUIRED'a |
| UA `common/` (prisma.*, guards/{jwt-auth,roles,csrf}, filters/all-exceptions, interceptors/{timeout,request-logger,audit-log}, middleware/request-id, request-context, decorators/*, dto/pagination-query, crypto.util, search.util, cron-log.*, mail.module/service çekirdeği, sms.service) | 1, 5, 7 | Aynen; mail'in eğitim/seans metodları ve marka sabitleri silinir |
| UA `modules/auth/*` + `jwt.strategy.ts` | 5 | Register/login/refresh/forgot/reset/verify/me/addresses/csrf; 2FA opsiyonel; `purpose` claim kontrolü eklenir |
| UA `modules/settings/*` (SENSITIVE_KEYS, PUBLIC_ALLOWED_GROUPS, encryptValue) + `database/seeds/seed-settings.ts` | 1, 4 | Grup anahtarları Bağdam'a göre (firma/site/kampanya/teslimat/odeme/abonelik/mail/sms/iyzico/seo) |
| UA `modules/media/*` (uploads/media, sharp webp+thumb, serve path guard) + admin `features/medya/MediaPickerModal` | 3 | Aynen; R2/video yok |
| UA `modules/products|categories|instructors(→producers)|content|members|users|dashboard|health|audit|system-logs|sitemap|email-templates|cart|coupons` | 3, 4, 5 | Kopyala-uyarla; products → `catalog` (bootstrap ucu eklenir) |
| UA `modules/pricing/pricing.service.ts` + `common/shipping-config.util.ts` | 6 | KDV dahil formüller, kupon, kargo eşiği (`teslimat.kargoUcreti/ucretsizKargoLimiti`) |
| UA `modules/orders/{order-status-transitions,orders.controller,orders.service (createOrder/updateStatus/cancel side-effects),order-timeout.scheduler,orders-pdf.service}` | 6, 7 | Durum makinesi + OrderEvent + timeout; PDF → paket fişi/teslimat listesi |
| UA `modules/payment/gateways/{payment-gateway.interface,gateway.factory,paytr.adapter}` + `payment.service` callback idempotency, `20260505100000_payments_gatewayref_paid_partial_unique` | 6 | Interface/factory aynen; iyzico adapter yeni; PayTR Faz 2 |
| UA `database/schema.prisma` (User, UserAddress, Category, ProductImage, Cart, Order, OrderLine, Payment, Coupon, OrderDiscount, OrderNote, OrderEvent, MediaFolder/File, SiteSetting, BlogPost, FaqItem, SitePage, EmailTemplate, MailLog, SmsTemplate/Log, AuditLog, SystemLog, CronLog, Incident, Ticket*, Tr*) | 1 | §2'deki kırpılmış halleriyle tek init migration |
| UA `database/seeds/{seed.ts,seed-email-templates,seed-sms-templates,seed-tr-address}` | 1, 9 | Admin env'den; Tr-address Faz 2 |
| UA `apps/api/src/__tests__/jest-global-setup.ts` + `__tests__/security/*` | 1, 8 | Prod DB guard (`:5436/`, `bagdam_db`, IP) + güvenlik testleri |
| UA `apps/admin/src/*` (AdminApp, router RequireAdminAuth, layouts, components, contexts, hooks, lib, features/components, pages/{auth,dashboard,urunler,siparisler,uyeler,medya,ayarlar,entegrasyonlar,icerik,kullanicilar,sistem,promosyon}) | 1, 3–7 | Menü `adminNavConfig` §4'e göre; eğitim/operasyon/aile-dizimi sayfaları alınmaz |
| UA `apps/web/src/lib/api.ts` (tryRefresh/forceLogout/CSRF) | 5 | cart.js içine vanilla JS olarak uyarlanır (`assets/api.js`) |
| UA `docs/{deployment-plani,monitoring-rehberi,local-calistirma-rehberi}.md`, `docs/flows/_AKIS-SABLONU.md`, `YAPILACAKLAR.md`, `.github/copilot-instructions.md` | 0, 2 | Şablon; sunucu bilgileri <SUNUCU_HOST>'a, tek DB bölümü ADR-0007'ye göre yeniden |
| UA `scripts/monitoring/*`, `scripts/backup.sh` | 2 | `/opt/birbudak/scripts/backup-bagdam.sh` ve health-check satırları |
| bahcedenal `deploy/coming-soon/bahcedenal.com.tr.nginx.conf`, `RUNBOOK.md` §1–3/5 | 2 | nginx vhost + LE webroot + Cloudflare DNS/SSL adımları (bagdam zone zaten aktif) |
| bahcedenal `backend/app/Services/OrderService.php` createOrder sırası + atomik kapasite UPDATE | 6, 7 | NestJS `$transaction` sırası; teslimat günü kapasitesi (`teslimat.gunKapasitesi`) |
| bahcedenal `customer-web/src/components/Functional/CookieConsent.tsx` + tr.json `cookie.*` | 9 | Çerez banner metni/anahtarları (vanilla JS'e) |
| bahcedenal `scraped-data/static_contents.json` (cayma-hakki, kisisel-verilerin-korunmasi, mesafeli-satis-sozlesmesi, on-bilgilendirme, uyelik-sozlesmesi) | 4 | LegalDocument seed taslakları (hukuki kontrol gerekir; Bağdam'ın mevcut politikalar.html metni birincil) |
| bahcedenal `backend/database/data/tr-locations/*.json` + `TrLocationSeeder.php` | 9 | Kargo açılırsa Tr* seed |
| bahcedenal `customer-web/next.config.ts` headers, `scripts/optimize-public-images.mjs` | 2, 3 | nginx güvenlik header listesi; görsel içe aktarımında sharp toplu optimizasyon |
| bahcedenal dersleri (ADR-0003 tünel ölçümü, ADR-0022 karar birikimi, ADR-0032 dev-mode perf) | 0, 7 | ADR-0007 (dev DB), karar kuyruğu ≤3, perf işi yalnız prod ölçümüyle |