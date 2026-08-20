> **Mimari öneri B — alan-doğruluğu / risk-önce** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 2 — mimar). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

<!-- summary: Yığın: sunucuda zaten çalışan Node 20 + NestJS 11 + Prisma 6 + PostgreSQL 14 (api :5010), admin Vite/React SPA (uyanisakademi iskeletinin kopyası), web için mevcut HTML'in piksel piksel korunduğu hibrit model — Express+Nunjucks SSR (:5011) + `window.__BAGDAM__` bootstrap ile cart.js'in globalleri (PRODUCTS, SUB_TIERS…) DB'den beslenir; ilk dinamik adım `assets/products.js`'in sunucudan üretilmesi olduğu için hiçbir HTML'e dokunmadan tüm site DB'ye bağlanır ve nginx location-by-location geçişle site hiç kesilmez. En kritik sıralama kararı: ödeme sağlayıcısı (iyzico kart saklama), tahsilat anı (kesimde), kesim kuralı (teslimattan önceki gün 12:00, DeliveryDate.cutoffAt tek kaynak), ilk-2-kutu/atlama/retention kuralları ve sipariş–cycle ayrımı (Cycle = faturalama/planlama birimi, kesimde Order'a dönüşür) Sprint 0'da ADR olarak kilitlenip TEK init migration'ında şemaya yazılır; abonelik motoru ödeme ve UI'dan önce testli olarak bitirilir. Mevzuat (mesafeli satış, abonelik sözleşmesi md.22-25, KVKK/İYS, e-arşiv alanları) şemaya baştan işlenir: versiyonlu LegalDocument + Consent, Order fatura alanları, 7 gün fesih/15 gün iade alanları. Dev DB için uyanisakademi'nin "tek DB" kuralından bilinçli sapma: lokal PG + migrate dev, prod'a yalnız migrate deploy; aynı sunucuda küçük staging (iyzico callback testi için). En büyük risk: abonelik yaşam döngüsü + tekrarlayan ödeme + kesim/kapasite üçlüsünün ürün kararları (kim ne zaman ne öder, hangi hafta hangi fiyat/lot) netleşmeden kodlanması — plan bunu F0/F2'de kesinleştirip F6'da UI'siz, testli motor olarak çözer; ikinci risk bahcedenal'daki gibi kapsam şişmesi (kargo aracı, WhatsApp, PayTR, toptan B2B tümü Faz-2'ye itildi). -->

# 1. Yığın kararı

**Perspektif:** alan-doğruluğu/risk-önce. Yığın seçimindeki tek kriter: sunucuda bugün çalışan, ekip tarafından bilinen, abonelik motorunu cron + transaction + state machine ile güvenle yazabileceğimiz şey. Şablon/CodeCanyon/PHP yok (bahcedenal dersi: sunucuda PHP yok, hiç deploy olmadı).

| Katman | Karar | Neden |
|---|---|---|
| Dil / runtime | TypeScript, **Node 20.20** (mevcut) | Sunucuda Node+PM2 var; uyanisakademi (NestJS+Prisma) ile aynı ops kalıpları birebir kopyalanır. |
| API | **NestJS 11** + `@nestjs/schedule` (cron, yalnız instance 0) + class-validator | Abonelik motorunun cron işleri (cycle üret/kilitle/tahsil/retry) ve guard/interceptor/audit altyapısı UA'dan hazır. |
| ORM / DB | **Prisma 6** + **PostgreSQL 14.22** (mevcut, 127.0.0.1:5432), DB adı `bagdam_db`, kullanıcı `bagdam` | Tek migration kaynağı; `migrate deploy` deploy.sh'ta; partial unique index/raw SQL gerektiğinde migration içine yazılır. |
| Para tipi | `Decimal(12,2)` TL, **fiyatlar KDV dahil** (politikalar.html "Fiyatlar KDV dahildir"), KDV oranı ürün alanı (`vatRate`, varsayılan 1) | UA PricingService birebir taşınır; snapshot'lar satırlarda. |
| Web (müşteri sitesi) | **Hibrit: (b) SSR şablon + (a) fetch hidrasyonu.** `apps/web` = Express 5 + **Nunjucks**; mevcut 10 HTML dosyası `.njk`'ya dönüşür (markup/class/CSS **birebir**, yalnız metin düğümleri ve listeler değişken olur), ortak nav/footer/promo-bar tek partial. Sayfa render'ında `<script>window.__BAGDAM__={products,tiers,freq,days,fee,settings}</script>` gömülür; `assets/products.js` bu bootstrap'ten global `PRODUCTS/SUB_TIERS/FREQ_OPTIONS/DELIVERY_DAYS/DELIVERY_FEE`'yi üretir → **cart.js ilk günden değişmeden çalışır**. Etkileşimli sayfalar (kutu/sepet/uyelik) aşamalı olarak `fetch` ile API'ye bağlanır (misafir: localStorage; üye: sunucu). | (c) SPA: 1235 satırlık cart.js + 10 sayfayı React'e taşımak = haftalar, piksel sapma riski, SEO kaybı. Salt (a): `urun.html?id=`/günlük/politika sayfaları SEO'suz ve FOUC'lu kalır, footer 10 kopya olarak sürer, "öne çıkanlar" gibi içerik blokları yine elle. SSR şablon piksel parite + SEO + tek partial verir, cart.js davranışını korur. |
| URL şeması | **Temiz URL'ler go-live'dan önce** (`/`, `/urunler?tab=`, `/urun/:slug`, `/kutu/:tier`, `/sepet`, `/uyelik`, `/gunluk`, `/gunluk/:slug`, `/toptan`, `/politikalar/:slug`, `/nasil-seciyoruz`) + nginx `*.html → 301`. | Domain henüz yayında değil → sıfır maliyet şimdi, go-live sonrası 301 zinciri maliyeti. (Karar — bkz. §8; `.html` kalırsa plan değişmez.) |
| Admin | **Vite 6 + React 19 + Tailwind 4 + react-router 7** SPA, statik `dist` nginx'ten `admin.bagdam.com` (UA `apps/admin` iskeleti kopya) | Hazır bileşen seti (AdminScrollTable, FormAside, MediaPicker, RichTextEditor). |
| Kimlik | JWT access (15 dk) + refresh (7 g) **httpOnly cookie**, CSRF double-submit; admin de cookie (UA P0-07 önerisi) | Aynı origin altında `/api` proxy → CORS/cookie domain derdi yok. |
| Paket yöneticisi / repo | **pnpm 9 monorepo** (`apps/api`, `apps/web`, `apps/admin`, `packages/shared`, `database/`), turbo; tek repo `github.com/nihatbirbudak/bagdam` (**PUBLIC**) | UA konvansiyonu; public olduğu için: `.env` yok, seed'de sır/PII yok (admin şifresi `SEED_ADMIN_PASSWORD` env'den), yasal metinler ve ürün seed'i repo'da kalabilir, müşteri verisi/yedek asla. |
| Süreçler / portlar | PM2 `bagdam-api` **:5010**, `bagdam-web` **:5011**; admin statik | floovent kalıbı (web+backend ayrı süreç); web çökse API/admin ayakta. |
| Cache / kuyruk | Yok (Redis yok). In-process LRU (web 60 s), PG `FOR UPDATE SKIP LOCKED` ile iş kuyruğu (bildirim/ödeme retry) | Bahcedenal Redis dersi; ölçek küçük. |
| Görsel | `uploads/` + sharp (webp + thumb) — UA media modülü | |
| Ödeme | **iyzico** Checkout Form (ilk ödeme, 3DS) + Kart Saklama (tekrarlayan, NON3D) — `PaymentProvider` arayüzü arkasında; PayTR Faz 2 | Kutu tutarı değişken (atla/ekstra/frekans) → iyzico'nun hazır "Abonelik" ürünü uymaz, **kendi cycle motoru + saklı karttan tahsil**. |
| E-posta / SMS | Resend veya SES (SMTP) + Netgsm/İleti Merkezi; `DISABLE_MAIL=true` dev | İşlemsel iletiler İYS dışı; pazarlama = Consent + İYS. |

# 2. Veri modeli

İlkeler: (1) **Cycle ≠ Order**: `SubscriptionCycle` planlama/faturalama birimidir, kesimde (lock) **snapshot'lanarak** bir `Order`'a dönüşür; böylece tekil sipariş, tek seferlik kutu, abonelik teslimatı ve toptan **tek sipariş durum makinesi / tek fatura / tek sevkiyat** modeliyle yönetilir. (2) Fiyat, lot, ürün adı, adres → her zaman satırda snapshot. (3) Kesim ve kapasite için **tek kaynak `DeliveryDate.cutoffAt`** (frontend'deki iki çelişkili kural buradan beslenir). (4) Mevzuat alanları (sözleşme versiyonu, onaylar, fatura, fesih süreleri) ilk migration'da. (5) Tüm para `Decimal(12,2)`, enum UPPERCASE, `@@map(snake_case)`, `createdAt/updatedAt`, soft delete yalnız User/Product/Address/Order.

```prisma
// database/schema.prisma — Bağdam v1 TASLAK (prisma validate ile son biçimi verilecek)
generator client { provider = "prisma-client-js" output = "../node_modules/.prisma/client" }
datasource db     { provider = "postgresql" url = env("DATABASE_URL") }

// ───────── ENUM ─────────
enum UserRole            { CUSTOMER WHOLESALE OPS EDITOR ADMIN }
enum ProductTab          { BOXES DAIRY FIRIN CELLAR }              // FE urunler.html data-tab; products.js tab pantry→CELLAR, fresh→BOXES
enum ProductStatus       { DRAFT ACTIVE HIDDEN ARCHIVED }
enum Availability        { AVAILABLE OUT_OF_SEASON SOLD_OUT }      // FE secki.html "şu an seçkide yok"
enum LotStatus           { PLANNED AVAILABLE DEPLETED CLOSED }
enum Frequency           { WEEKLY BIWEEKLY EVERY4WEEKS }           // FE FREQ_OPTIONS 1hafta/2hafta/4hafta
enum Weekday             { MON TUE WED THU FRI SAT SUN }           // FE DELIVERY_DAYS sali/persembe/cumartesi
enum DeliveryDateStatus  { OPEN LOCKED COMPLETED CANCELLED }
enum SubscriptionStatus  { PENDING_PAYMENT ACTIVE PAUSED PAST_DUE CANCEL_REQUESTED CANCELLED }
enum CycleStatus         { SCHEDULED LOCKED SKIPPED PAID UNPAID FULFILLED CANCELLED }
enum CycleItemSource     { TEMPLATE SWAP EXTRA CART_MERGE }        // FE swap-select / #boxExtras / "bu haftaki kutuma ekle"
enum SkipSource          { USER OPS UNPAID }
enum OrderType           { SUBSCRIPTION_CYCLE ONE_TIME_BOX ALACARTE WHOLESALE }  // FE sub.type + tekli
enum OrderStatus         { PENDING_PAYMENT CONFIRMED PREPARING OUT_FOR_DELIVERY DELIVERED DELIVERY_FAILED CANCELLED }
enum PaymentProvider     { IYZICO PAYTR MANUAL }
enum PaymentKind         { CHECKOUT CYCLE_CHARGE DELTA RETRY }
enum PaymentStatus       { PENDING REQUIRES_3DS SUCCEEDED FAILED REFUNDED PARTIALLY_REFUNDED }
enum RefundStatus        { PENDING SUCCEEDED FAILED }
enum DunningState        { NONE RETRYING CARD_UPDATE_REQUESTED UNPAID }
enum ShipmentMethod      { COURIER CARGO PICKUP }
enum ShipmentStatus      { PLANNED PACKED OUT_FOR_DELIVERY DELIVERED FAILED RETURNED }
enum DiscountKind        { FIRST_BOXES RETENTION COUPON MANUAL }   // FE "ilk 2 kutu %50", "1 kutuluk %50 (üye kaldığın için)"
enum CouponType          { PERCENT FIXED FREE_SHIPPING }
enum LegalDocKind        { PRIVACY TERMS DISTANCE_SALES PREINFO SUBSCRIPTION_CONTRACT DELIVERY RETURNS KVKK_NOTICE COOKIE COOKIE_SETTINGS MARKETING_CONSENT } // FE politikalar.html 8 sekme + 3 ek
enum ConsentType         { KVKK_NOTICE_ACK PREINFO_ACK CONTRACT_ACK SUBSCRIPTION_CONTRACT_ACK MARKETING_EMAIL MARKETING_SMS MARKETING_CALL COOKIE_ANALYTICS COOKIE_MARKETING }
enum IysStatus           { NOT_APPLICABLE PENDING SYNCED FAILED }
enum ContentStatus       { DRAFT PUBLISHED ARCHIVED }
enum JournalType         { INTERVIEW SEASON NOTE }                 // FE "SÖYLEŞİ" / "MEVSİM"
enum NotificationChannel { EMAIL SMS WHATSAPP }
enum NotificationStatus  { QUEUED SENT DELIVERED FAILED }
enum WholesaleLeadStatus { NEW CONTACTED QUALIFIED CLOSED }
enum CancelReason        { PRICE VARIETY DELIVERY_DAYS OTHER }     // FE uyelik.html data-reason
enum BillingParty        { INDIVIDUAL CORPORATE }
enum InvoiceKind         { E_ARSIV E_FATURA }
enum InvoiceStatus       { NOT_ISSUED PENDING ISSUED CANCELLED }

// ───────── KULLANICI / ADRES ─────────
model User {
  id                 String    @id @default(cuid())
  email              String    @unique @db.Citext                 // FE #signupEmail / #loginEmail
  passwordHash       String?                                      // OTP-only girişe açık
  phone              String?   @db.VarChar(20)                    // FE #custPhone
  phoneVerifiedAt    DateTime?
  firstName          String?   @db.VarChar(80)                    // FE #custName (ad soyad → ikiye bölünür)
  lastName           String?   @db.VarChar(80)
  role               UserRole  @default(CUSTOMER)
  isActive           Boolean   @default(true)
  emailVerifiedAt    DateTime?
  emailVerifyToken   String?   @db.VarChar(128)
  passwordResetToken String?   @db.VarChar(128)
  passwordResetExp   DateTime?
  refreshTokenHash   String?
  failedLoginAttempts Int      @default(0)
  lockedUntil        DateTime?
  tastePrefs         Json      @default("{}")                     // FE bahceden_prefs {axis: option}
  firstBoxesPromoUsedAt DateTime?                                 // "ilk 2 kutu" hakkı ömür boyu 1 kez
  retentionOfferUsedAt  DateTime?                                 // FE bahceden_retention_offered
  lastLoginAt        DateTime?
  deletedAt          DateTime?                                    // KVKK silme: anonimleştirme + purge cron
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  addresses      Address[]
  paymentMethods PaymentMethod[]
  subscriptions  Subscription[]
  orders         Order[]
  cart           Cart?
  consents       Consent[]
  notifications  NotificationLog[]
  @@index([role, isActive])
  @@map("users")
}

model TrProvince     { id Int @id  name String  slug String @unique  districts TrDistrict[]  @@map("tr_provinces") }
model TrDistrict     { id Int @id  provinceId Int  name String  slug String  province TrProvince @relation(fields:[provinceId], references:[id])  neighborhoods TrNeighborhood[]  @@unique([provinceId, slug])  @@map("tr_districts") }
model TrNeighborhood { id Int @id  districtId Int  name String  slug String  postalCode String? @db.VarChar(10)  district TrDistrict @relation(fields:[districtId], references:[id])  @@index([districtId])  @@map("tr_neighborhoods") }

model Address {                                                   // FE bahceden_address + sepet/uyelik formları (çoklu adres)
  id             String   @id @default(cuid())
  userId         String
  label          String?  @db.VarChar(50)                         // "Ev", "İş"
  fullName       String   @db.VarChar(160)                        // FE #addrName/#custName
  phone          String   @db.VarChar(20)                         // FE #addrPhone/#custPhone
  provinceId     Int                                              // İzmir (35)
  districtId     Int                                              // FE #custDistrict select (Urla/Çeşme)
  neighborhoodId Int?                                             // zone çözümlemesi için
  line           String   @db.VarChar(500)                        // FE #custAddress/#addrLine
  buildingNo     String?  @db.VarChar(20)
  apartmentNo    String?  @db.VarChar(20)
  directions     String?  @db.VarChar(300)
  postalCode     String?  @db.VarChar(10)                         // FE #custZip
  zoneId         String?                                          // adres kaydında çözülür
  isDefault      Boolean  @default(false)
  // fatura tarafı
  billingParty   BillingParty @default(INDIVIDUAL)
  tckn           String?  @db.VarChar(11)
  companyName    String?  @db.VarChar(200)
  taxOffice      String?  @db.VarChar(100)
  vkn            String?  @db.VarChar(10)
  deletedAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  user  User          @relation(fields:[userId], references:[id], onDelete: Cascade)
  zone  DeliveryZone? @relation(fields:[zoneId], references:[id])
  @@index([userId])
  @@map("addresses")
  // migration'a raw: CREATE UNIQUE INDEX addresses_one_default ON addresses(user_id) WHERE is_default AND deleted_at IS NULL;
}

// ───────── TESLİMAT KURALLARI (tek kaynak) ─────────
model DeliveryZone {                                              // FE "Urla ve Çeşme"; politikalar teslimat bölgesi
  id             String  @id @default(cuid())
  name           String  @db.VarChar(80)
  method         ShipmentMethod @default(COURIER)
  districtIds    Int[]                                            // TrDistrict id listesi (Urla=?, Çeşme=?)
  neighborhoodIds Int[]                                           // boşsa ilçenin tamamı
  fee            Decimal @db.Decimal(12,2) @default(49)           // FE DELIVERY_FEE (tek seferlik)
  freeThreshold  Decimal? @db.Decimal(12,2)                       // FE 1000 TL eşiği
  minOrder       Decimal? @db.Decimal(12,2)
  isActive       Boolean @default(true)
  addresses      Address[]
  dayRules       DeliveryDayRule[]
  @@map("delivery_zones")
}

model DeliveryDayRule {                                           // FE DELIVERY_DAYS + kesim kuralı (politika: önceki gün 12:00)
  id              String  @id @default(cuid())
  zoneId          String
  weekday         Weekday                                          // TUE/THU/SAT
  cutoffOffsetDays Int     @default(1)
  cutoffTime      String  @db.VarChar(5) @default("12:00")        // Europe/Istanbul
  windowStart     String  @db.VarChar(5) @default("09:00")        // politika 09:00–18:00
  windowEnd       String  @db.VarChar(5) @default("18:00")
  defaultCapacity Int     @default(60)
  isActive        Boolean @default(true)
  zone  DeliveryZone @relation(fields:[zoneId], references:[id])
  dates DeliveryDate[]
  @@unique([zoneId, weekday])
  @@map("delivery_day_rules")
}

model DeliveryDate {                                              // cron üretir (8 hafta ileri); kesim/kapasite burada kilitlenir
  id         String   @id @default(cuid())
  ruleId     String
  date       DateTime @db.Date
  cutoffAt   DateTime                                             // FE nextCutoff()/lockedDeliveryDay() yerine TEK kaynak
  capacity   Int
  reserved   Int      @default(0)                                 // atomik UPDATE ... WHERE reserved < capacity
  status     DeliveryDateStatus @default(OPEN)
  lockedAt   DateTime?
  rule   DeliveryDayRule @relation(fields:[ruleId], references:[id])
  cycles SubscriptionCycle[]
  orders Order[]
  @@unique([ruleId, date])
  @@index([date, status])
  @@map("delivery_dates")
}

// ───────── KATALOG / ÜRETİCİ / PARTİ ─────────
model Producer {                                                  // FE products.js meta "Hüseyin Dağ · Kuşçular · Urla" normalize
  id        String  @id @default(cuid())
  name      String  @db.VarChar(120)
  slug      String  @unique
  village   String? @db.VarChar(80)                               // Kuşçular, Yağcılar…
  district  String? @db.VarChar(80)                               // Urla
  story     String?                                               // gunluk.html söyleşi bağlantısı
  photoId   String?
  isVisible Boolean @default(true)
  sortOrder Int     @default(0)
  products  Product[]
  lots      ProductLot[]
  @@map("producers")
}

model Category {                                                  // FE urunler.html sekmeleri + panel notları + ikon; product.category
  id        String     @id @default(cuid())
  parentId  String?
  name      String     @db.VarChar(80)                            // "Süt Ürünleri"
  slug      String     @unique                                    // dairy/firin/cellar/boxes | meyve/sebze/...
  tab       ProductTab?
  panelNote String?                                               // FE "Kutuya dahil değil — …"
  iconId    String?                                               // FE assets/icons/{boxes,dairy,firin,cellar}.png
  sortOrder Int        @default(0)
  status    ContentStatus @default(PUBLISHED)
  parent    Category?  @relation("CatTree", fields:[parentId], references:[id])
  children  Category[] @relation("CatTree")
  products  Product[]
  @@map("categories")
}

model Product {
  id              String   @id @default(cuid())
  slug            String   @unique                                // FE products.js id (incir, cevizliekmek) → urun.html?id=
  name            String   @db.VarChar(160)                       // FE name
  categoryId      String                                          // FE category
  producerId      String?                                         // FE meta
  metaNote        String?  @db.VarChar(120)                       // FE meta soneki "— Erken Hasat"
  tab             ProductTab                                      // FE tab / fresh
  isFresh         Boolean  @default(false)                        // FE fresh → yalnız kutuda
  price           Decimal  @db.Decimal(12,2)                      // FE price (KDV dahil)
  vatRate         Int      @default(1)                            // FE "%1 KDV"
  unit            String   @db.VarChar(30)                        // FE unit "500 g", "kg", "demet"
  boxAmount       String?  @db.VarChar(40)                        // FE boxAmount "kutuda: 1 demet"
  extraOptions    Json?                                           // FE subExtraOptions [{factor,label}] (null → unit kuralı)
  description     String                                          // FE desc
  whyText         String?                                         // FE why ("neden bunu seçtik" — haftalık)
  storageText     String?                                         // FE urun.html "kullanım & saklama" (koddan alana)
  allergenText    String?  @db.VarChar(120)                       // FE "alerjen" (Süt / Yok)
  freshnessNote   String?  @db.VarChar(120)                       // FE "Her sabah taze gelir."
  prefAxis        String?  @db.VarChar(40)                        // FE pref.label (olgunluk/boyut/…)
  prefOptions     String[]                                        // FE pref.options
  prefDefaultIdx  Int?                                            // FE pref.def
  season          String?  @db.VarChar(40)                        // FE season "Ağu–Eyl"
  availability    Availability @default(AVAILABLE)
  status          ProductStatus @default(ACTIVE)
  isFeatured      Boolean  @default(false)                        // FE index "öne çıkanlar"
  featuredOrder   Int?
  pairWithBox     Boolean  @default(false)                        // FE kutu.html pairIds (ekmek, zeytinyağı, peynir, tereyağı)
  pairOrder       Int?
  recoWeight      Int      @default(0)                            // FE renderRecommended basit skor
  seoTitle        String?  @db.VarChar(160)
  seoDescription  String?  @db.VarChar(300)
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  category  Category   @relation(fields:[categoryId], references:[id])
  producer  Producer?  @relation(fields:[producerId], references:[id])
  images    ProductImage[]                                        // FE img + images[]
  lots      ProductLot[]
  @@index([tab, status, isFresh])
  @@map("products")
}

model ProductImage { id String @id @default(cuid())  productId String  mediaId String  alt String? @db.VarChar(160)  sortOrder Int @default(0)  isCover Boolean @default(false)  product Product @relation(fields:[productId], references:[id], onDelete: Cascade)  media Media @relation(fields:[mediaId], references:[id])  @@index([productId])  @@map("product_images") }

model ProductLot {                                                // FE batch "K14-03" → izlenebilir parti
  id           String   @id @default(cuid())
  productId    String
  producerId   String?
  lotCode      String   @db.VarChar(40)                           // FE batch
  harvestDate  DateTime? @db.Date
  bestBefore   DateTime? @db.Date
  tastingNote  String?                                            // "4 bahçeden 7 parti tattık…" (FE why'ın parti sürümü)
  qtyAvailable Decimal? @db.Decimal(10,3)                         // ops stok (opsiyonel)
  qtyAllocated Decimal  @db.Decimal(10,3) @default(0)
  status       LotStatus @default(AVAILABLE)
  isCurrent    Boolean  @default(true)                            // ürün sayfasında gösterilen parti
  createdAt    DateTime @default(now())
  product  Product   @relation(fields:[productId], references:[id], onDelete: Cascade)
  producer Producer? @relation(fields:[producerId], references:[id])
  @@unique([productId, lotCode])
  @@map("product_lots")
}

// ───────── KUTU PLANI / HAFTALIK ŞABLON ─────────
model Plan {                                                      // FE SUB_TIERS (small 6'lı 649, sezon 10'lu 1099)
  id            String  @id @default(cuid())
  code          String  @unique                                   // FE tier id → kutu.html?tier=
  label         String  @db.VarChar(80)
  itemCount     Int                                               // FE count
  price         Decimal @db.Decimal(12,2)                         // FE price
  note          String? @db.VarChar(120)                          // FE note
  imageId       String?                                           // FE img
  isRecommended Boolean @default(false)                           // FE RECOMMENDED_TIER rozeti
  sortOrder     Int     @default(0)
  status        ContentStatus @default(PUBLISHED)
  templates     BoxTemplate[]
  subscriptions Subscription[]
  @@map("plans")
}

model BoxTemplate {                                               // "bu haftanın kutusu": ops kurar; FE defaultFill yerine
  id         String   @id @default(cuid())
  planId     String
  weekStart  DateTime @db.Date                                    // Pazartesi
  curatorName String? @db.VarChar(60)                             // FE "Bu kutuyu hazırlayan — Ece"
  status     ContentStatus @default(DRAFT)
  plan  Plan @relation(fields:[planId], references:[id])
  items BoxTemplateItem[]
  @@unique([planId, weekStart])
  @@map("box_templates")
}
model BoxTemplateItem { id String @id @default(cuid())  templateId String  productId String  lotId String?  qty Decimal @db.Decimal(10,3) @default(1)  unitLabel String @db.VarChar(40)  sortOrder Int @default(0)  isSwappable Boolean @default(true)  template BoxTemplate @relation(fields:[templateId], references:[id], onDelete: Cascade)  @@map("box_template_items") }

// ───────── ABONELİK MOTORU ─────────
model Subscription {                                              // FE bahceden_sub (purchased=true kısmı)
  id               String   @id @default(cuid())
  userId           String
  planId           String                                         // FE tierId
  frequency        Frequency @default(WEEKLY)                     // FE freq
  weekday          Weekday                                        // FE deliveryDay
  addressId        String
  paymentMethodId  String?
  status           SubscriptionStatus @default(PENDING_PAYMENT)
  startedAt        DateTime?
  pausedUntil      DateTime?
  nextDeliveryDate DateTime? @db.Date
  itemPrefs        Json     @default("{}")                        // FE itemPrefs {productId: option}
  skipsAllowed     Int      @default(1)                           // FE skipUsed; politika "yılda 1" → period alanları
  skipsUsed        Int      @default(0)
  skipPeriodStart  DateTime? @db.Date
  dunningState     DunningState @default(NONE)
  failedCycles     Int      @default(0)
  contractDocId    String                                         // kabul edilen Abonelik Sözleşmesi versiyonu
  contractAcceptedAt DateTime
  contractIp       String?  @db.VarChar(45)
  cancelRequestedAt DateTime?
  cancelledAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  user    User  @relation(fields:[userId], references:[id])
  plan    Plan  @relation(fields:[planId], references:[id])
  cycles  SubscriptionCycle[]
  discounts SubscriptionDiscount[]
  events  SubscriptionEvent[]
  cancellation SubscriptionCancellation?
  @@index([userId, status])
  @@index([status, nextDeliveryDate])
  @@map("subscriptions")
}

model SubscriptionDiscount {                                      // FE ilk 2 kutu %50 / retention 1 kutu %50 / kupon
  id             String @id @default(cuid())
  subscriptionId String
  kind           DiscountKind
  percent        Int?
  amount         Decimal? @db.Decimal(12,2)
  cyclesRemaining Int                                             // FIRST_BOXES: 2, RETENTION: 1
  couponId       String?
  createdAt      DateTime @default(now())
  subscription Subscription @relation(fields:[subscriptionId], references:[id], onDelete: Cascade)
  @@map("subscription_discounts")
}

model SubscriptionCycle {                                         // bir teslimat dönemi; kesimde Order'a dönüşür
  id             String   @id @default(cuid())
  subscriptionId String
  cycleNo        Int
  deliveryDateId String
  status         CycleStatus @default(SCHEDULED)
  skipSource     SkipSource?
  // snapshot (lock anında)
  planLabel      String?  @db.VarChar(80)
  boxPrice       Decimal? @db.Decimal(12,2)
  extrasTotal    Decimal? @db.Decimal(12,2)
  discountTotal  Decimal? @db.Decimal(12,2)
  shippingFee    Decimal? @db.Decimal(12,2)
  total          Decimal? @db.Decimal(12,2)
  prepaidAmount  Decimal  @db.Decimal(12,2) @default(0)           // checkout'ta peşin ödenen 1. kutu
  orderId        String?  @unique
  lockedAt       DateTime?
  skippedAt      DateTime?
  retryCount     Int      @default(0)
  nextRetryAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  subscription Subscription  @relation(fields:[subscriptionId], references:[id], onDelete: Cascade)
  deliveryDate DeliveryDate  @relation(fields:[deliveryDateId], references:[id])
  order        Order?        @relation(fields:[orderId], references:[id])
  items        CycleItem[]
  payments     Payment[]
  @@unique([subscriptionId, cycleNo])
  @@index([status, deliveryDateId])
  @@map("subscription_cycles")
}

model CycleItem {                                                 // FE items[] + itemPrefs + extras[{id,factor,label}]
  id          String  @id @default(cuid())
  cycleId     String
  productId   String
  lotId       String?                                             // lock'ta parti bağlanır (etiket/QR)
  source      CycleItemSource
  swapOfProductId String?                                         // FE swap: hangi şablon ürününün yerine
  qty         Decimal @db.Decimal(10,3) @default(1)               // FE factor
  unitLabel   String  @db.VarChar(40)                             // FE label "500 g"
  prefValue   String? @db.VarChar(60)                             // FE data-value çipi
  unitPrice   Decimal? @db.Decimal(12,2)                          // EXTRA için snapshot; TEMPLATE/SWAP 0 (kutu fiyatına dahil)
  lineTotal   Decimal? @db.Decimal(12,2)
  sortOrder   Int     @default(0)
  cycle SubscriptionCycle @relation(fields:[cycleId], references:[id], onDelete: Cascade)
  @@index([cycleId])
  @@map("cycle_items")
}

model SubscriptionEvent { id String @id @default(cuid())  subscriptionId String  cycleId String?  type String @db.VarChar(40)  actorType String @db.VarChar(10)  actorId String?  data Json?  createdAt DateTime @default(now())  subscription Subscription @relation(fields:[subscriptionId], references:[id], onDelete: Cascade)  @@index([subscriptionId, createdAt])  @@map("subscription_events") }

model SubscriptionCancellation {                                  // FE iptal akışı (nedenler kaydedilmiyordu) + Abonelik Yön. md.24-25
  id                 String  @id @default(cuid())
  subscriptionId     String  @unique
  reasons            CancelReason[]
  reasonText         String?
  retentionOffered   Boolean @default(false)
  retentionAccepted  Boolean @default(false)
  requestedAt        DateTime @default(now())
  effectiveAt        DateTime?                                    // ≤ 7 gün (md.24)
  confirmedAt        DateTime?                                    // yazılı teyit e-postası (md.25)
  refundAmount       Decimal? @db.Decimal(12,2)
  refundDueAt        DateTime?                                    // ≤ 15 gün (md.25)
  subscription Subscription @relation(fields:[subscriptionId], references:[id], onDelete: Cascade)
  @@map("subscription_cancellations")
}

// ───────── SEPET / SİPARİŞ ─────────
model Cart {                                                      // FE bahceden_cart + satın alınmamış bahceden_sub (üye için sunucu kopyası)
  id        String   @id @default(cuid())
  userId    String   @unique
  items     Json     @default("[]")                               // [{productSlug, qty, pref}]
  boxDraft  Json?                                                 // {planCode, items[], itemPrefs, frequency, weekday, type, extras[]}
  updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id], onDelete: Cascade)
  @@map("carts")
}

model Order {                                                     // FE bahceden_orders (no 1001+) — tüm tipler
  id               String    @id @default(cuid())
  orderNo          Int       @unique @default(autoincrement())     // sequence start 1001 (migration'da ALTER SEQUENCE)
  type             OrderType
  userId           String?
  cycleId          String?   @unique
  status           OrderStatus @default(PENDING_PAYMENT)
  deliveryDateId   String?
  deliveryWeekday  Weekday?                                       // FE deliveryDay
  customerName     String    @db.VarChar(160)
  customerEmail    String    @db.VarChar(160)
  customerPhone    String    @db.VarChar(20)
  shippingAddress  Json                                           // adres snapshot
  billingParty     BillingParty @default(INDIVIDUAL)
  billingAddress   Json?
  billingTckn      String?   @db.VarChar(11)
  billingVkn       String?   @db.VarChar(10)
  billingTaxOffice String?   @db.VarChar(100)
  billingCompany   String?   @db.VarChar(200)
  subtotal         Decimal   @db.Decimal(12,2)
  discountTotal    Decimal   @db.Decimal(12,2) @default(0)
  shippingFee      Decimal   @db.Decimal(12,2) @default(0)        // FE Kargo 49 / Dahil
  vatTotal         Decimal   @db.Decimal(12,2)                    // FE "%1 KDV" gösterimi
  grandTotal       Decimal   @db.Decimal(12,2)
  couponId         String?
  couponCode       String?   @db.VarChar(40)
  paymentStatus    PaymentStatus @default(PENDING)
  paidAt           DateTime?
  note             String?   @db.VarChar(500)
  adminNote        String?
  // mevzuat
  preinfoDocId     String?
  contractDocId    String?
  acceptedAt       DateTime?
  acceptedIp       String?   @db.VarChar(45)
  confirmationSentAt DateTime?
  invoiceStatus    InvoiceStatus @default(NOT_ISSUED)
  ipAddress        String?   @db.VarChar(45)
  userAgent        String?   @db.VarChar(300)
  deliveredAt      DateTime?
  cancelledAt      DateTime?
  cancelReason     String?   @db.VarChar(200)
  deletedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  user         User?         @relation(fields:[userId], references:[id])
  deliveryDate DeliveryDate? @relation(fields:[deliveryDateId], references:[id])
  cycle        SubscriptionCycle?
  lines        OrderLine[]
  payments     Payment[]
  refunds      Refund[]
  shipments    Shipment[]
  events       OrderEvent[]
  invoice      Invoice?
  @@index([userId, createdAt])
  @@index([status, deliveryDateId])
  @@index([type, createdAt])
  @@map("orders")
}

model OrderLine {                                                 // FE lines[] metinleri yerine yapısal satır
  id          String  @id @default(cuid())
  orderId     String
  productId   String?
  planId      String?                                             // kutu satırı
  lotId       String?
  lotCode     String? @db.VarChar(40)                             // snapshot (fatura/etiket)
  name        String  @db.VarChar(200)                            // "10'lu Sezon Kutusu — 10 ürün"
  variantLabel String? @db.VarChar(80)                            // FE pref / ekstra label "(1 kg)"
  qty         Decimal @db.Decimal(10,3)
  unitLabel   String? @db.VarChar(40)
  unitPrice   Decimal @db.Decimal(12,2)                           // KDV dahil
  lineTotal   Decimal @db.Decimal(12,2)
  vatRate     Int
  vatAmount   Decimal @db.Decimal(12,2)
  discount    Decimal @db.Decimal(12,2) @default(0)
  metadata    Json?                                               // kutu içeriği listesi (ürün/lot/qty) snapshot
  order Order @relation(fields:[orderId], references:[id], onDelete: Cascade)
  @@index([orderId])
  @@map("order_lines")
}

model OrderEvent { id String @id @default(cuid())  orderId String  type String @db.VarChar(40)  fromStatus OrderStatus?  toStatus OrderStatus?  actorType String @db.VarChar(10)  actorId String?  note String?  metadata Json?  createdAt DateTime @default(now())  order Order @relation(fields:[orderId], references:[id], onDelete: Cascade)  @@index([orderId, createdAt])  @@map("order_events") }

// ───────── ÖDEME ─────────
model PaymentMethod {                                             // FE bahceden_card (plaintext) → yalnız PSP token
  id               String  @id @default(cuid())
  userId           String
  provider         PaymentProvider
  providerUserKey  String  @db.VarChar(120)                       // iyzico cardUserKey
  providerCardToken String @db.VarChar(120)                       // iyzico cardToken
  bin              String? @db.VarChar(8)
  last4            String  @db.VarChar(4)                         // FE "•••• 1234"
  brand            String? @db.VarChar(30)
  holderName       String? @db.VarChar(120)
  expMonth         Int?
  expYear          Int?
  isDefault        Boolean @default(false)
  isActive         Boolean @default(true)
  createdAt        DateTime @default(now())
  deletedAt        DateTime?
  user User @relation(fields:[userId], references:[id], onDelete: Cascade)
  @@index([userId])
  @@map("payment_methods")
}

model Payment {
  id               String  @id @default(cuid())
  orderId          String?
  cycleId          String?
  userId           String?
  provider         PaymentProvider
  kind             PaymentKind
  conversationId   String  @unique @db.VarChar(80)                // idempotency (bizim anahtar)
  providerPaymentId String? @db.VarChar(120)
  providerToken    String? @db.VarChar(200)                       // CF token
  amount           Decimal @db.Decimal(12,2)
  currency         String  @db.VarChar(3) @default("TRY")
  status           PaymentStatus @default(PENDING)
  is3ds            Boolean @default(true)
  paymentMethodId  String?
  attemptNo        Int     @default(1)
  failureCode      String? @db.VarChar(40)
  failureMessage   String? @db.VarChar(300)
  rawResponse      Json?
  paidAt           DateTime?
  createdAt        DateTime @default(now())
  order Order?             @relation(fields:[orderId], references:[id])
  cycle SubscriptionCycle? @relation(fields:[cycleId], references:[id])
  refunds Refund[]
  @@index([orderId])
  @@index([status, createdAt])
  @@map("payments")
  // raw: CREATE UNIQUE INDEX payments_provider_pid_succeeded ON payments(provider, provider_payment_id) WHERE status='SUCCEEDED';
}

model Refund { id String @id @default(cuid())  paymentId String  orderId String?  amount Decimal @db.Decimal(12,2)  reason String? @db.VarChar(300)  providerRefundId String? @db.VarChar(120)  status RefundStatus @default(PENDING)  rawResponse Json?  requestedBy String?  createdAt DateTime @default(now())  completedAt DateTime?  payment Payment @relation(fields:[paymentId], references:[id])  order Order? @relation(fields:[orderId], references:[id])  @@map("refunds") }

model WebhookEvent { id String @id @default(cuid())  provider String @db.VarChar(20)  eventType String @db.VarChar(60)  providerRef String @db.VarChar(160)  payload Json  signatureValid Boolean  status String @db.VarChar(20) @default("RECEIVED")  error String?  receivedAt DateTime @default(now())  processedAt DateTime?  @@unique([provider, providerRef, eventType])  @@map("webhook_events") }

model Coupon {                                                    // FE promo bar BAGDAM050 (kod girişi kararına bağlı)
  id            String @id @default(cuid())
  code          String @unique @db.Citext
  type          CouponType
  value         Decimal @db.Decimal(12,2)
  minOrder      Decimal? @db.Decimal(12,2)
  maxUses       Int?
  usedCount     Int @default(0)
  maxUsesPerUser Int @default(1)
  appliesTo     String @db.VarChar(20) @default("ALL")            // ALL | BOX | ALACARTE
  validFrom     DateTime?
  validUntil    DateTime?
  isActive      Boolean @default(true)
  redemptions   CouponRedemption[]
  @@map("coupons")
}
model CouponRedemption { id String @id @default(cuid())  couponId String  userId String  orderId String?  amount Decimal @db.Decimal(12,2)  createdAt DateTime @default(now())  coupon Coupon @relation(fields:[couponId], references:[id])  @@unique([couponId, orderId])  @@map("coupon_redemptions") }

// ───────── SEVKİYAT ─────────
model Shipment {
  id            String  @id @default(cuid())
  orderId       String
  method        ShipmentMethod @default(COURIER)
  status        ShipmentStatus @default(PLANNED)
  scheduledDate DateTime? @db.Date
  carrierCode   String? @db.VarChar(40)                           // Faz 2 kargo
  trackingNo    String? @db.VarChar(80)
  trackingUrl   String? @db.VarChar(300)
  labelUrl      String? @db.VarChar(300)
  courierUserId String?                                           // OPS rolü
  routeSeq      Int?
  coldPack      Boolean @default(false)
  proofMediaId  String?                                           // teslim fotoğrafı
  failureReason String? @db.VarChar(200)
  packedAt      DateTime?
  shippedAt     DateTime?
  deliveredAt   DateTime?
  order  Order @relation(fields:[orderId], references:[id], onDelete: Cascade)
  events ShipmentEvent[]
  @@index([scheduledDate, status])
  @@map("shipments")
}
model ShipmentEvent { id String @id @default(cuid())  shipmentId String  status ShipmentStatus  note String?  occurredAt DateTime @default(now())  actorId String?  raw Json?  shipment Shipment @relation(fields:[shipmentId], references:[id], onDelete: Cascade)  @@map("shipment_events") }

// ───────── FATURA (iskelet, MVP alanları) ─────────
model Invoice { id String @id @default(cuid())  orderId String @unique  kind InvoiceKind @default(E_ARSIV)  provider String @db.VarChar(20) @default("GIB_PORTAL")  number String? @db.VarChar(40)  ettn String? @db.VarChar(60)  issuedAt DateTime?  total Decimal @db.Decimal(12,2)  vatTotal Decimal @db.Decimal(12,2)  pdfMediaId String?  status InvoiceStatus @default(PENDING)  internetSale Json?  sentToCustomerAt DateTime?  rawResponse Json?  createdAt DateTime @default(now())  order Order @relation(fields:[orderId], references:[id])  @@map("invoices") }

// ───────── YASAL / ONAY ─────────
model LegalDocument {                                             // FE politikalar.html 8 sekme (slug, title, updatedAt, lead, sections) — versiyonlu
  id            String  @id @default(cuid())
  kind          LegalDocKind
  slug          String  @db.VarChar(60)                           // gizlilik, mesafeli-satis, …
  title         String  @db.VarChar(160)
  version       Int
  lead          String?
  bodyHtml      String
  effectiveFrom DateTime
  isCurrent     Boolean @default(false)
  contentHash   String  @db.VarChar(64)
  createdAt     DateTime @default(now())
  consents Consent[]
  @@unique([slug, version])
  @@map("legal_documents")
}
model Consent {                                                   // KVKK + İYS kayıtları
  id          String  @id @default(cuid())
  userId      String?
  guestKey    String? @db.VarChar(64)
  type        ConsentType
  documentId  String?
  granted     Boolean
  grantedAt   DateTime @default(now())
  revokedAt   DateTime?
  source      String  @db.VarChar(20) @default("HS_WEB")
  ip          String? @db.VarChar(45)
  userAgent   String? @db.VarChar(300)
  iysStatus   IysStatus @default(NOT_APPLICABLE)
  iysSyncedAt DateTime?
  iysRef      String? @db.VarChar(60)
  user     User?          @relation(fields:[userId], references:[id])
  document LegalDocument? @relation(fields:[documentId], references:[id])
  @@index([userId, type])
  @@map("consents")
}

// ───────── TOPTAN ─────────
model WholesaleLead { id String @id @default(cuid())  email String @db.Citext  businessName String? @db.VarChar(160)  phone String? @db.VarChar(20)  note String?  status WholesaleLeadStatus @default(NEW)  adminNote String?  ip String? @db.VarChar(45)  createdAt DateTime @default(now())  contactedAt DateTime?  @@index([status, createdAt])  @@map("wholesale_leads") }   // FE toptan.html #notifyForm

// ───────── İÇERİK / AYAR / MEDYA ─────────
model JournalPost {                                               // FE gunluk.html yazıları + index teaser
  id            String  @id @default(cuid())
  slug          String  @unique                                   // #cavdar-ekmegi
  type          JournalType                                       // SÖYLEŞİ/MEVSİM
  title         String  @db.VarChar(200)                          // em vurgulu başlık (HTML izinli alt küme)
  readMinutes   Int     @default(4)
  coverMediaId  String?
  bodyHtml      String                                            // p, pull-quote, ürün linkleri
  relatedProductIds String[]
  producerId    String?
  status        ContentStatus @default(DRAFT)
  publishedAt   DateTime?
  seoTitle      String? @db.VarChar(160)
  seoDescription String? @db.VarChar(300)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([status, publishedAt])
  @@map("journal_posts")
}
model FaqItem     { id String @id @default(cuid())  question String @db.VarChar(200)  answerHtml String  sortOrder Int @default(0)  status ContentStatus @default(PUBLISHED)  @@map("faq_items") }          // FE index SSS 4 <details>
model SiteContent { id String @id @default(cuid())  key String @unique @db.VarChar(80)  label String @db.VarChar(120)  schema Json  value Json  updatedById String?  updatedAt DateTime @updatedAt  @@map("site_contents") } // FE §2.20 blokları: hero, pillars, showcase, cloud, blocks, trustItems, panelNotes, boxEditorNotes, manifesto, toptan, journalHero/Close, footer, promoBar, sepet/uyelik metinleri
model Setting     { id String @id @default(cuid())  group String @db.VarChar(50)  key String @unique @db.VarChar(100)  value Json  isSensitive Boolean @default(false)  updatedAt DateTime @updatedAt  @@index([group])  @@map("settings") }  // commerce.*, promo.firstBoxes, delivery.*, payment.*, mail.*, sms.*, seo.*
model Media       { id String @id @default(cuid())  folder String @db.VarChar(120) @default("/")  name String @db.VarChar(200)  originalName String @db.VarChar(200)  mimeType String @db.VarChar(60)  size Int  path String @db.VarChar(300)  thumbPath String? @db.VarChar(300)  width Int?  height Int?  alt String? @db.VarChar(200)  createdAt DateTime @default(now())  productImages ProductImage[]  @@index([folder])  @@map("media") }

// ───────── BİLDİRİM / OTP ─────────
model NotificationTemplate { id String @id @default(cuid())  key String @unique @db.VarChar(60)  channel NotificationChannel  category String @db.VarChar(15) @default("TRANSACTIONAL")  subject String? @db.VarChar(200)  body String  variables Json?  isActive Boolean @default(true)  updatedAt DateTime @updatedAt  @@map("notification_templates") }
model NotificationLog { id String @id @default(cuid())  userId String?  channel NotificationChannel  templateKey String @db.VarChar(60)  to String @db.VarChar(160)  category String @db.VarChar(15)  entityType String? @db.VarChar(30)  entityId String? @db.VarChar(40)  provider String? @db.VarChar(30)  providerMsgId String? @db.VarChar(120)  status NotificationStatus @default(QUEUED)  error String?  payload Json?  sentAt DateTime?  deliveredAt DateTime?  createdAt DateTime @default(now())  user User? @relation(fields:[userId], references:[id])  @@unique([templateKey, entityType, entityId])  @@map("notification_logs") }
model OtpCode { id String @id @default(cuid())  phone String @db.VarChar(20)  codeHash String  purpose String @db.VarChar(20)  expiresAt DateTime  attempts Int @default(0)  consumedAt DateTime?  createdAt DateTime @default(now())  @@index([phone, purpose])  @@map("otp_codes") }

// ───────── AUDIT / SİSTEM ─────────
model AuditLog  { id String @id @default(cuid())  actorId String?  actorEmail String? @db.VarChar(160)  action String @db.VarChar(40)  module String @db.VarChar(40)  entityId String? @db.VarChar(60)  entityName String? @db.VarChar(200)  oldValues Json?  newValues Json?  requestId String? @db.VarChar(60)  ip String? @db.VarChar(45)  success Boolean @default(true)  createdAt DateTime @default(now())  @@index([module, entityId])  @@index([createdAt])  @@map("audit_logs") }  // asla silinmez
model SystemLog { id String @id @default(cuid())  level String @db.VarChar(10)  module String @db.VarChar(40)  message String  requestId String? @db.VarChar(60)  userId String?  metadata Json?  fingerprint String? @db.VarChar(64)  occurrenceCount Int @default(1)  firstSeenAt DateTime @default(now())  lastSeenAt DateTime @default(now())  @@index([level, lastSeenAt])  @@map("system_logs") }
model CronLog   { id String @id @default(cuid())  name String @db.VarChar(60)  status String @db.VarChar(10)  itemsProcessed Int @default(0)  errors Int @default(0)  details Json?  startedAt DateTime  finishedAt DateTime?  durationMs Int?  @@index([name, startedAt])  @@map("cron_logs") }
```

**Durum makineleri (tek kaynak `packages/shared/src/state/*.ts`, API'de guard):**
- `Subscription`: PENDING_PAYMENT→ACTIVE; ACTIVE↔PAUSED (Faz 2); ACTIVE→PAST_DUE (2 ardışık UNPAID cycle) →ACTIVE (kart güncellendi+retry ok) | →CANCELLED; ACTIVE/PAST_DUE→CANCEL_REQUESTED→CANCELLED (kilitli cycle teslim edilince / ≤7 gün).
- `SubscriptionCycle`: SCHEDULED→LOCKED (cron, `deliveryDate.cutoffAt`) →PAID | UNPAID (retry +24s/+72s → UNPAID + skipSource=UNPAID) ; SCHEDULED→SKIPPED (kullanıcı, kesim öncesi, hak varsa; geri alınabilir) ; PAID→FULFILLED (order DELIVERED) ; her şey→CANCELLED (abonelik iptali, yalnız SCHEDULED).
- `Order`: PENDING_PAYMENT→CONFIRMED→PREPARING→OUT_FOR_DELIVERY→DELIVERED | DELIVERY_FAILED(→PREPARING yeniden planla) ; PENDING_PAYMENT/CONFIRMED→CANCELLED (kesim öncesi ücretsiz; kapasite `reserved-1`); iade `Refund` kayıtlarıyla (durum değil).
- `Payment`: PENDING→REQUIRES_3DS→SUCCEEDED|FAILED ; SUCCEEDED→PARTIALLY_REFUNDED|REFUNDED.

**Fiyat kuralları (PricingService, tek yer):** kutu = `plan.price` (lock anında) − `SubscriptionDiscount` (FIRST_BOXES %50 ×2, RETENTION %50 ×1, kupon) ; ekstralar = `round(product.price × qty)` snapshot ; kargo = abonelik 0, tek seferlik `zone.fee` (eşik üstü 0) ; KDV = satır bazında dahil fiyattan ayrıştırma `line×(rate/(100+rate))` (FE `0.01/1.01`) ; **ilk kutu indirimi Order.total'a da yansır** (FE'deki tutarsızlık kapanır).

# 3. API yüzeyi

Global prefix `/api`; kimlik: `access_token` httpOnly cookie (15 dk) + `refresh_token` cookie (7 g, rotasyon, bcrypt hash DB'de) ; `GET /api/auth/csrf` double-submit ; Bearer yalnız sunucu-içi/test. Guard sırası `Throttler → JwtAuth → Csrf → Roles` ; `@Public()` açık liste. Roller: `CUSTOMER` (müşteri), `WHOLESALE` (Faz 2 B2B fiyat görünümü), `OPS` (paketleme/kurye ekranları, salt-okunur katalog), `EDITOR` (içerik/katalog), `ADMIN` (her şey). Mutasyonlar `@Audited`.

| Modül | Public | Auth (müşteri) | Admin/Ops |
|---|---|---|---|
| **health** | `GET /health`, `GET /health/ready` | | `GET /health/detailed` |
| **auth** | `POST /auth/register` (email, şifre, ad, telefon, KVKK ack + pazarlama onayları) · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/forgot` · `POST /auth/reset` · `GET /auth/verify-email` · `POST /auth/otp/request|verify` (Faz 2) · `GET /auth/csrf` | `GET /auth/me` · `PATCH /auth/me` · `POST /auth/me/password` · `POST /auth/logout` · `DELETE /auth/me` (KVKK silme talebi) | — |
| **me** (hesap) | | `GET/POST/PATCH/DELETE /me/addresses` · `PUT /me/addresses/:id/default` · `GET /me/cards` · `POST /me/cards/add-session` (iyzico kart kayıt formu) · `DELETE /me/cards/:id` · `PUT /me/cards/:id/default` · `GET/PUT /me/preferences` (tastePrefs) · `GET /me/consents` · `POST /me/consents` · `GET /me/orders` · `GET /me/orders/:no` · `GET /me/subscription` | |
| **address-ref** | `GET /address-ref/provinces` · `/districts?provinceId` · `/neighborhoods?districtId` | | |
| **delivery** | `GET /delivery/zones` · `GET /delivery/resolve?districtId&neighborhoodId` → zone+fee · `GET /delivery/dates?zoneId&weeks=4` (tarih, cutoffAt, doluluk, kilitli mi) | | `CRUD /admin/delivery/zones`, `/admin/delivery/rules`, `GET/PATCH /admin/delivery/dates` (kapasite, kapat), `POST /admin/delivery/dates/generate` |
| **catalog** | `GET /catalog/bootstrap` (PRODUCTS+tiers+freq+days+fee+promo — web SSR/ cart.js globalleri) · `GET /products?tab&fresh&featured&pairWithBox` · `GET /products/:slug` · `GET /categories` · `GET /producers` · `GET /producers/:slug` · `GET /products/:slug/recommended` | | `CRUD /admin/products` · `POST /admin/products/:id/images` · `PATCH /admin/products/bulk` · `CRUD /admin/products/:id/lots` · `CRUD /admin/producers` · `CRUD /admin/categories` |
| **plans / box** | `GET /plans` · `GET /plans/:code` · `GET /plans/:code/template?week=` (bu haftanın varsayılan içeriği + swap havuzu) · `POST /box/quote` (kutu taslağı fiyat özeti — misafir dahil, sunucu hesaplar) | | `CRUD /admin/plans` · `CRUD /admin/box-templates` (+ `POST /admin/box-templates/:id/publish`, `/clone-next-week`) |
| **cart** | `POST /cart/quote` (misafir sepeti fiyat özeti) | `GET/PUT /cart` · `POST /cart/merge` (login'de localStorage birleştirme) · `PUT /cart/box-draft` | |
| **checkout** | | `POST /checkout/quote` (sepet + kutu taslağı + adres + teslimat günü → satır satır fiyat/KDV/kargo/indirim) · `POST /checkout` (sözleşme versiyonları + onaylar → Order(lar) PENDING_PAYMENT [+Subscription PENDING_PAYMENT + Cycle#1] + kapasite rezervi → iyzico CF `checkoutFormContent`) · `GET /checkout/:orderNo/status` | |
| **payments** | `POST /payments/iyzico/callback` (token→retrieve→Order CONFIRMED, kart token kaydet, Subscription ACTIVE) · `POST /webhooks/iyzico` (HMAC, `WebhookEvent` idempotent) | | `GET /admin/payments` · `POST /admin/payments/:id/refund` · `GET /admin/webhook-events` · `POST /admin/cycles/:id/charge` (manuel tekrar) |
| **subscriptions** | | `GET /subscriptions/current` (sub + yaklaşan cycle'lar + kesim geri sayımı + "kilitli" bayrağı) · `PATCH /subscriptions/:id` (frequency, weekday, addressId, paymentMethodId — bir sonraki SCHEDULED cycle'dan itibaren) · `GET /subscriptions/:id/cycles/:cycleId` · `PUT /subscriptions/:id/cycles/:cycleId/items` (swap + prefValue, SCHEDULED iken) · `POST/DELETE .../cycles/:cycleId/extras` · `POST .../cycles/:cycleId/merge-cart` ("bu haftaki kutuma ekle") · `POST .../cycles/:cycleId/skip` / `DELETE .../skip` · `POST /subscriptions/:id/cancel/start` (neden + metin → retention teklifi var/yok) · `POST .../cancel/accept-offer` · `POST .../cancel/confirm` · `POST .../pause` (Faz 2) | `GET /admin/subscriptions` (filtre: status, weekday, plan, dunning) · `GET /admin/subscriptions/:id` · `PATCH /admin/subscriptions/:id/status` (force, neden) · `POST /admin/subscriptions/:id/cycles/:cid/skip|unskip|lock|relock` · `GET /admin/subscriptions/:id/events` |
| **orders** | | `GET /me/orders` (yukarıda) · `POST /orders/:no/cancel` (kesim öncesi) | `GET /admin/orders` (filtre: status, type, deliveryDate, search) · `GET /admin/orders/:id` · `PATCH /admin/orders/:id/status` (transitions + side-effects) · `POST /admin/orders/:id/notes` · `PATCH /admin/orders/:id/lines` · `POST /admin/orders/:id/invoice` (no/pdf manuel) · `GET /admin/orders/export.csv` |
| **ops** | | | `GET /ops/pick-list?date=` (ürün × toplam adet × lot) · `GET /ops/packing-list?date=` (sipariş bazlı kutu fişi + ekstralar + tercihler) · `GET /ops/labels?date=` (PDF/QR: orderNo, lotCode'lar) · `GET /ops/route?date=` · `PATCH /ops/shipments/:id/status` (packed/out/delivered/failed + foto) · `POST /ops/shipments/bulk-status` |
| **coupons** | `POST /coupons/validate` (throttle) | | `CRUD /admin/coupons` · `GET /admin/coupons/:id/redemptions` |
| **wholesale** | `POST /wholesale/leads` (throttle 3/dk) | | `GET /admin/wholesale/leads` · `PATCH /admin/wholesale/leads/:id` |
| **content** | `GET /content/site` (tüm SiteContent anahtarları, 60 s cache) · `GET /content/faq` · `GET /journal?limit=3` · `GET /journal/:slug` · `GET /legal` · `GET /legal/:slug` (current) · `GET /legal/:slug/v/:version` | `POST /consents/cookie` | `PUT /admin/content/:key` · `CRUD /admin/faq` · `CRUD /admin/journal` (+publish) · `CRUD /admin/legal` (yeni versiyon = yeni satır, `isCurrent` swap) |
| **media** | `GET /media/serve/*` | | `GET /admin/media` · `POST /admin/media/upload` · `PATCH/DELETE /admin/media/:id` · `GET /admin/media/:id/usages` |
| **settings** | `GET /settings/public` (allow-list: site, footer, promo, commerce görünür alanlar) | | `GET /admin/settings` · `PUT /admin/settings/:group` (hassas alanlar AES-GCM, maskeli) · `POST /admin/settings/mail/test` · `POST /admin/settings/sms/test` |
| **customers** | | | `GET /admin/customers` · `GET /admin/customers/:id` (adresler, kartlar last4, siparişler, abonelik, onaylar, tercihler) · `PATCH /admin/customers/:id` (isActive, role) · `POST /admin/customers/:id/anonymize` |
| **notifications** | `POST /webhooks/sms-dlr` | | `GET /admin/notifications` · `CRUD /admin/notification-templates` · `POST /admin/notifications/:id/resend` |
| **dashboard / audit / system** | | | `GET /admin/dashboard` (bugün/teslimat günü özetleri, aktif abonelik, dunning, düşük stok lot) · `GET /admin/audit` · `GET /admin/system-logs` · `GET /admin/cron-logs` |
| **internal (cron, yalnız instance 0)** | | | `deliverydates:generate` (haftalık) · `cycles:ensure` (her aktif abonelik için ileriye 3 cycle, frekansa göre) · `cycles:lock` (5 dk: `cutoffAt ≤ now` → snapshot → Order → charge) · `payments:retry` (dunning) · `reminders:cutoff` (kesimden 24 s önce) · `kvkk:purge` (günlük 03:30) · `otp:cleanup` · `logs:cleanup` (audit hariç) |

# 4. Admin panel

Yığın: UA `apps/admin` iskeleti (AdminLayout/Sidebar/TopBar/BottomNav, useApi, AdminScrollTable, AdminFormAside, MediaPickerModal, RichTextEditor). Öncelik: **P0** = go-live şartı, **P1** = ilk ay, **P2** = sonra.

| Ekran (rota) | Öncelik | Yönettiği tablolar | Not |
|---|---|---|---|
| Giriş (`/login`) + 2 rol (ADMIN/EDITOR/OPS) | P0 | users | cookie auth, 5 hata → kilit |
| Özet (`/`) | P0 | orders, subscription_cycles, delivery_dates, payments | "Yarınki teslimat: N kutu / M tekil, dolu %", dunning'deki abonelikler, bekleyen toptan lead |
| **Katalog › Ürünler** (liste, form) | P0 | products, product_images, product_lots, media | Tüm FE alanları: tab/fresh, fiyat/KDV/unit/boxAmount, ekstra seçenekleri, tercih ekseni, saklama/alerjen/tazelik, sezon, availability, öne çıkan + sıra, kutuyla eşleştir, üretici, galeri (sürükle-sırala) |
| Katalog › Partiler (lot) | P0 | product_lots | ürün içinde sekme + ayrı liste: lot kodu, hasat, SKT, tadım notu, "güncel parti" |
| Katalog › Üreticiler | P0 | producers | ad/köy/ilçe/hikâye/foto; günlük yazısına bağ |
| Katalog › Kategoriler & Sekmeler | P0 | categories | 4 sekme (ikon, panel notu) + alt kategoriler |
| **Kutular › Planlar** | P0 | plans | small/sezon: fiyat, adet, not, görsel, önerilen |
| Kutular › Haftalık Şablon | P0 | box_templates, box_template_items | hafta seçici, plan × içerik (ürün+lot+miktar+swap'lanabilir), küratör adı, "geçen haftayı kopyala", yayınla |
| **Teslimat › Bölgeler / Gün kuralları / Tarihler** | P0 | delivery_zones, delivery_day_rules, delivery_dates | kesim saati, kapasite, günü kapat; tarih listesi doluluk barı |
| **Siparişler** (liste, detay) | P0 | orders, order_lines, order_events, shipments, payments, refunds, invoices | filtre (durum/tip/teslimat günü/arama), durum geçişleri (transitions), iptal (kapasite iade), iade başlat, not, fatura no/PDF manuel, CSV |
| **Abonelikler** (liste, detay) | P0 | subscriptions, subscription_cycles, cycle_items, subscription_discounts, subscription_events, subscription_cancellations | cycle zaman çizelgesi, atla/geri al, kilidi manuel aç-kapat (force, neden), dunning durumu & yeniden çek, iptal nedenleri, retention, kart değiştirme linki gönder |
| **Operasyon › Teslimat Günü** | P0 | orders, shipments, cycle_items, product_lots | tarih seç → (1) toplama listesi ürün×adet×lot, (2) paketleme fişleri (sipariş bazlı, tercihler/ekstralar), (3) etiket PDF (QR: orderNo+lot), (4) kurye listesi + toplu durum (paketlendi/yolda/teslim/başarısız + foto) — OPS rolü yalnız bunu görür |
| Müşteriler (liste, detay) | P0 | users, addresses, payment_methods, consents, orders, subscriptions | PII görünümü audit'lenir; anonimleştir |
| Ödemeler & İadeler | P0 | payments, refunds, webhook_events | başarısız ödemeler listesi, webhook yeniden işle |
| Kampanya › Kuponlar & Kurallar | P0 | coupons, settings(promo.*) | ilk-2-kutu (yüzde/adet/otomatik mi), retention teklifi, promo bar metni/kodu |
| **İçerik › Site Blokları** | P0 | site_contents | anahtar bazlı form (schema→form): hero (+haftalık not), pillars, showcase, cloud, blocks, trust, panel notları, kutu editör notları, manifesto/karşılaştırma, toptan metinleri, günlük hero/kapanış, sepet/üyelik mesajları, footer/iletişim/sosyal, promo bar |
| İçerik › SSS | P0 | faq_items | |
| İçerik › Günlük | P0 | journal_posts, media | tür, süre, tarih, em-vurgulu başlık, kapak, gövde (tiptap), ilişkili ürünler, yayınla |
| **İçerik › Yasal Metinler** | P0 | legal_documents | 8 politika + ön bilgilendirme/abonelik sözleşmesi/pazarlama rızası; "yeni versiyon yayınla" (eskiler salt-okunur; kabul sayısı görünür) |
| Toptan Talepleri | P0 | wholesale_leads | durum, not |
| Medya Kütüphanesi | P0 | media | klasör, yükle (webp+thumb), kullanım yerleri, alt |
| **Ayarlar** | P0 | settings | Genel/SEO · İletişim & Sosyal · Ticaret (KDV varsayılanı, kargo KDV, atlama hakkı/yıl, tekil min sepet) · Ödeme (iyzico açık/kapalı, sandbox — anahtarlar .env) · E-posta (SMTP, test) · SMS (sağlayıcı, başlık, test) · Bildirim şablonları |
| Bildirimler (log + şablon) | P1 | notification_logs, notification_templates | yeniden gönder |
| Sistem › Audit / Hata günlüğü / Cron | P1 | audit_logs, system_logs, cron_logs | |
| Faturalar | P1 | invoices | e-Arşiv entegratörü gelince otomatik |
| Raporlar (iptal nedenleri, churn, ürün bazlı talep, üretici siparişi) | P2 | türetilmiş | |
| Kargo entegrasyonu (Geliver/Basit Kargo) | P2 | shipments | |
| Toptan B2B (hesap, fiyat listesi, havale) | P2 | users(WHOLESALE), orders(WHOLESALE) | |
| Roller & izinler (granüler) | P2 | — | V1: enum rol yeter |

# 5. Geliştirme sırası

Kural: her adım kendinden önceki adımların çıktısına bağlıdır, sonrakine değil; şema (özellikle ödeme/abonelik/sipariş) F2'de kesinleşir ve F3+ kod ona karşı yazılır; web geçişi nginx `location` bazında sayfa sayfa yapılır, site hiç kesilmez. Eforlar tek kıdemli geliştirici + AI-asistan için iş günü.

**F0 — Karar sprinti + ADR'ler (2 g)**
- Kapsam: §8'deki kararlar kapatılır, `docs/adr/0001-0012` (≤25 satır) yazılır: yığın, URL şeması, kesim kuralı, tahsilat anı, ilk-2-kutu, atlama hakkı, retention, teslimat bölgeleri, ödeme sağlayıcı, dev DB stratejisi, fresh ürün tekil satış yok, toptan=lead.
- Ön koşul: yok. DoD: ADR'ler commit; durum makineleri çizimi (`docs/state-machines.md`); politikalar.html metinleriyle uyum listesi.
- Neden bu sırada: abonelik/ödeme şeması bu kararlara göre yazılacak; sonradan "kesim 23:59 mu 12:00 mi" = migration + kod + metin değişikliği.

**F1 — Repo iskeleti + walking skeleton canlıda (3 g)**
- Kapsam: pnpm monorepo (`apps/api` Nest, `apps/web` Express+Nunjucks, `apps/admin` Vite, `packages/shared`, `database/`), UA ortak altyapı (main.ts, env-validator, prisma.service, filters, interceptors, guards) kopyası; `GET /api/health`; web app mevcut HTML'i **statik** servis eder; admin login kabuğu; sunucuda `/opt/bagdam`, PG db/user, PM2 ecosystem, nginx vhost'lar, certbot, Cloudflare zone + DNS, `deploy.sh` + GitHub Actions, backup/health script'lerine ekleme.
- Ön koşul: F0 (URL şeması). DoD: `https://bagdam.com` = bugünkü statik site (piksel aynı), `https://bagdam.com/api/health` 200, `https://admin.bagdam.com` login ekranı (henüz kullanıcı yok), push→deploy çalışıyor, gece yedeği alınıyor.
- Neden: bahcedenal dersi — prod hiç kurulmadı; her sonraki adım canlıya dokunarak ilerler. 

**F2 — Şema v1 + init migration + seed (5 g)**
- Kapsam: §2 şemasının tamamı tek `0001_init` migration'ı (+ raw: partial unique index'ler, `orders_order_no_seq RESTART 1001`, citext extension); seed: `products.js` → JSON dönüştürücü script (22 ürün, 15 üretici, kategoriler, 2 plan, 3 gün kuralı, zone Urla/Çeşme, settings, 8 politika + ön bilgilendirme/abonelik sözleşmesi taslağı `legal_documents` v1, 3 günlük yazısı, SiteContent blokları (index/urunler/kutu/… metinleri), FAQ 4, TR il/ilçe/mahalle (bahcedenal JSON), admin kullanıcı env'den. PricingService + state machine modülleri `packages/shared` + birim testleri (fiyat/KDV/indirim/kesim hesapları, tarih dilimi Europe/Istanbul).
- Ön koşul: F0, F1. DoD: `prisma validate`, migration prod'da uygulandı, seed yüklendi, ERD (`prisma-erd`), pricing/state testleri yeşil, "şema dondu" ADR.
- Neden: tüm domain tabloları aynı anda → ilişkiler tutarlı, sonradan `ALTER` cehennemi yok; henüz müşteri verisi yokken geniş migration ucuz.

**F3 — Çekirdek API (5 g)**
- Kapsam: auth (cookie JWT+refresh+CSRF, register/login/forgot/reset/verify), me (adres CRUD, tercihler, onaylar), address-ref, settings (şifreli hassas alanlar), media (sharp), audit/system-log/cron-log, catalog read (bootstrap/products/categories/producers), plans+template read, content read (site/faq/journal/legal), delivery read (zones/resolve/dates), wholesale lead POST, mail çekirdeği (`DISABLE_MAIL` dev), throttling, jest prod-DB guard.
- Ön koşul: F2. DoD: Postman/HTTP test koleksiyonu; `GET /api/catalog/bootstrap` products.js ile **alan alan eş** (snapshot testi); admin ADMIN kullanıcıyla login.
- Neden: F4 (admin) ve F5 (web okuma) ikisi de bu uçlara bağlı; yazma tarafı (abonelik/ödeme) henüz UI'siz.

**F4 — Admin iskeleti + katalog/içerik/ayar ekranları (7 g)**
- Kapsam: §4'teki P0 ekranlardan: Giriş, Özet(boş), Ürünler(+partiler, görseller), Üreticiler, Kategoriler, Planlar, Haftalık Şablon, Teslimat (bölge/kural/tarih), Site Blokları, SSS, Günlük, Yasal Metinler (versiyon), Medya, Ayarlar, Toptan Talepleri, Kuponlar/Kampanya ayarı. Admin CRUD uçları bu adımda yazılır.
- Ön koşul: F3. DoD: products.js'deki 22 ürün admin'den düzenlenip `bootstrap`'e yansıyor; yeni haftanın kutu şablonu admin'den kurulabiliyor.
- Neden: içerik/katalog yönetimi erken gelirse F5'te web dinamikleşirken veri kaynağı hazır; operasyon ekranları (F9) sipariş verisi gerektirdiği için sonra.

**F5 — Web okuma sayfaları dinamik, sayfa sayfa (5 g)**
- Kapsam: (1) `GET /assets/products.js` web app'ten üretilir (bootstrap → aynı JS globalleri; ETag, 60 s cache) → nginx `location = /assets/products.js` proxy → **tüm site tek hamlede DB'den fiyat/ürün okur, HTML değişmeden**. (2) Partial'lar (nav/footer/promo bar) + `.njk` dönüşümü: `index` (hero/pillars/showcase/öne çıkanlar/teaser/blocks/faq), `urunler` (sekme/tier/güven şeridi/panel notları), `urun/:slug` (galeri, saklama/alerjen/parti alanları, SEO meta), `gunluk`, `politikalar/:slug`, `nasil-seciyoruz`, `toptan` (lead POST). Her sayfa bitince nginx `location` ile canlıya alınır; görsel regresyon (Playwright screenshot diff, 3 viewport) statik sürümle karşılaştırılır. Temiz URL + `.html→301` (F0 kararı).
- Ön koşul: F3, F4 (içerik admin'den). DoD: 7 sayfa SSR, piksel diff ≤ %0,5, Lighthouse SEO ≥ 95, eski URL'ler 301.
- Neden: müşteri tarafına değer en erken burada çıkar; cart.js'e dokunulmaz (risk düşük); abonelik UI'si (F8) motor (F6) olmadan yapılamaz.

**F6 — Abonelik motoru + teslimat + fiyatlama (backend, testli) (7 g)**
- Kapsam: `deliverydates:generate`, `cycles:ensure`, `cycles:lock` (snapshot: şablon+swap+extras+prefs+lot → CycleItem fiyatları → Order + OrderLine + Shipment(PLANNED) + kapasite), skip/unskip (yıl kuralı), extras/swap/merge-cart (SCHEDULED iken), frequency/weekday/adres değişikliği (sonraki cycle'dan), cancel akışı (retention → CANCEL_REQUESTED → effectiveAt ≤7 g → CANCELLED + teyit maili), SubscriptionEvent; `PaymentProvider` arayüzü + `ManualProvider` (test) ile charge/dunning iskeleti (+24s/+72s, 2 UNPAID → PAST_DUE); ops pick/packing list uçları. Zaman dilimi/yaz saati testleri.
- Ön koşul: F2, F3. DoD: Jest senaryoları — "Pazartesi 11:59 ekstra ekle / 12:01 reddedilir", "2 haftalık frekans cycle takvimi", "atla→geri al→kesim", "iptal kilitli cycle teslim edilir", "UNPAID 2 kez → PAST_DUE", "kapasite dolunca gün kapanır"; `time-travel` (fake timers) ile 8 haftalık simülasyon.
- Neden: en zor alan; UI ve gerçek PSP olmadan, sahte sağlayıcı ile determinist test edilir; F7/F8 buna yaslanır.

**F7 — Ödeme (iyzico) + checkout + sipariş + yasal onay + e-posta (7 g)**
- Kapsam: iyzico adaptörü (CF init/retrieve, kart saklama `registerCard`, saklı karttan NON3D `auth`, iade, webhook HMAC + `WebhookEvent`), `POST /checkout/quote|checkout`, callback → Order CONFIRMED / Subscription ACTIVE / Cycle#1 `prepaidAmount`, `cycles:lock` gerçek charge + DELTA (checkout sonrası eklenen ekstralar), dunning e-posta + kart güncelleme linki, consents (KVKK/ön bilgilendirme/sözleşme/abonelik sözleşmesi versiyonları, IP/UA), sipariş onayı + sözleşme kopyası e-postası (kalıcı veri saklayıcısı), order transitions + side-effects (iptal→kapasite/kupon/indirim iadesi), `POST /orders/:no/cancel`, kupon validate/redeem, ilk-2-kutu otomatik indirim (kullanıcı başına 1 kez).
- Ön koşul: F6 (motor), iyzico sandbox hesabı, staging URL (callback). DoD: sandbox'ta uçtan uca: tek seferlik kutu, tekil ürünler, abonelik (ilk ödeme 3DS + sonraki cycle saklı kart), başarısız kart → retry → PAST_DUE, iade; webhook çift teslim idempotent; e-postalar MailLog'da.
- Neden: şema ödeme sağlayıcısına göre yazıldı (F0/F2); motor (F6) hazır olduğundan ödeme yalnız "charge" noktasına takılır.

**F8 — Web etkileşimli sayfalar API'ye: kutu / sepet / uyelik (7 g)**
- Kapsam: cart.js → `bagdam.js` (aynı data-* kancaları, aynı DOM): misafir sepeti/kutu taslağı localStorage'da kalır, fiyat özeti `POST /box/quote` & `/cart/quote` ile sunucudan (client hesap yok), login'de `POST /cart/merge`; `sepet`: auth kapısı gerçek (register'a ad/telefon + KVKK/pazarlama kutucukları; "ödeme yükümlülüğü" buton metni), müşteri bilgileri → Address, teslimat günü → `/delivery/dates` (kesim/kapasite sunucudan), ödeme → iyzico CF (kart formu kaldırılır, `bahceden_card` silinir), başarı sayfası; `kutu`: satın alınmış abonelikte düzenlemeler cycle uçlarına (taslak → "değişiklikleri onayla" = tek PUT), geri sayım `cutoffAt`'ten; `uyelik`: abonelik kartı (`/subscriptions/current`), atla, iptal akışı (nedenler kaydedilir), adres/kart (PSP kart ekleme formu), siparişler (gerçek durumlar). `?sifirla` kaldırılır.
- Ön koşul: F5 (şablon altyapısı), F6, F7. DoD: 3 sayfa canlı; Playwright e2e: misafir→üye→abonelik→ekstra→atla→iptal; localStorage'da kart/parola yok.
- Neden: en çok ürün kararı içeren UI en sona kalır ki backend kurallarını yansıtsın; tasarım korunur çünkü DOM aynı.

**F9 — Admin operasyon ekranları (7 g)**
- Kapsam: Siparişler, Abonelikler (cycle zaman çizelgesi, force işlemler), Teslimat Günü operasyonu (pick/packing/etiket PDF/kurye listesi + toplu durum + foto), Müşteriler, Ödemeler & İadeler, Özet ekranı KPI'ları, OPS rolü kısıtlı menü.
- Ön koşul: F6, F7. DoD: bir teslimat günü uçtan uca admin'den yürütülüyor (hazırlanıyor → yolda → teslim; başarısız teslimat yeniden planlama); iade admin'den.
- Neden: gerçek sipariş/cycle verisi ancak F7'den sonra var.

**F10 — Bildirim/SMS/OTP, fatura alanları, KVKK/çerez, go-live hazırlığı (4 g)**
- Kapsam: SMS sağlayıcı adaptörü (kesim hatırlatma, yola çıktı/teslim, ödeme başarısız), OTP (telefon doğrulama; OTP ile giriş opsiyonel), çerez banner'ı (bahcedenal bileşeni) + `consents/cookie`, `kvkk:purge` + anonimleştirme, fatura alanları checkout'ta (bireysel/kurumsal), sipariş PDF (irsaliye yerine), e-Arşiv için `Invoice` manuel no/PDF, güvenlik gözden geçirme (helmet, rate limit, webhook WAF istisnası), yük testi (k6: 50 eşzamanlı checkout), yedek geri yükleme provası, runbook.
- Ön koşul: F7–F9. DoD: go-live checklist imzalı (ETBİS, İşletme Kayıt Belgesi, İYS kaydı operasyonel taraf), staging'de 1 haftalık "sahte hafta" simülasyonu temiz.

**F11 — Go-live + hypercare (2 g)** — DNS zaten Cloudflare'de; nginx root `location /` web app'e; ilk gerçek teslimat günü ops ekranlarında canlı izleme; ilk 2 hafta günlük rapor.

**Toplam ≈ 61 iş günü (~12–13 hafta).** Faz 2 backlog (ADR'lı, şema hazır): pause, PayTR, kargo aracı (Geliver/Basit Kargo) + `CARGO` sevkiyat, WhatsApp utility, e-Arşiv entegratörü, İYS API senkronu, toptan B2B, üretici siparişleri/raporlar, öneri motoru, çerez yönetim platformu.

# 6. İlk 2 hakta

**Gün 1–2 (F0):** `docs/adr/` 12 ADR; `docs/state-machines.md` (Mermaid); kesim/tahsilat/indirim/atlama kararları kullanıcıyla kapatılır (§8 soruları).

**Gün 2–4 (F1) — repo:**
```bash
mkdir bagdam && cd bagdam && git init && pnpm init
# pnpm-workspace.yaml: packages: [apps/*, packages/*]   (UA'dan kopya turbo.json, .npmrc, .nvmrc=20)
pnpm dlx @nestjs/cli new apps/api --package-manager pnpm --skip-git
pnpm create vite apps/admin --template react-ts
mkdir -p apps/web/{src,views,public} packages/shared/src database/{migrations,seeds,data}
cp -r "…/www.bagdam.com/website/"{assets,styles.css} apps/web/public/     # statik varlıklar olduğu gibi
cp "…/www.bagdam.com/website/"*.html apps/web/views/raw/                  # dönüştürme kaynağı
pnpm add -w prisma@6 @prisma/client@6 bcrypt && pnpm -F @bagdam/api add @nestjs/schedule @nestjs/throttler passport-jwt cookie-parser helmet compression sharp class-validator class-transformer nodemailer
pnpm -F @bagdam/web add express nunjucks undici lru-cache
```
- `apps/web/src/server.ts` (≈120 satır): nunjucks env, `GET /healthz`, **Faz 1'de tüm rotalar statik** (`express.static(public)` + raw HTML), `GET /assets/products.js` henüz statik dosya.
- UA'dan kopya: `apps/api/src/{main.ts, app.module.ts, config/env-validator.ts, common/*}` → modül haritası Bağdam'a göre.
- Sunucu: `adduser`/`createdb bagdam_db` (scram), `/opt/bagdam` clone, `apps/api/.env` (DATABASE_URL?connection_limit=5, JWT_SECRET, JWT_REFRESH_SECRET, SETTINGS_ENCRYPTION_KEY, WEB_URL, ADMIN_URL, API_INTERNAL_URL=http://127.0.0.1:5010, DISABLE_MAIL=false), `ecosystem.config.js` (bagdam-api :5010, bagdam-web :5011), nginx vhost'lar + certbot (Cloudflare zone önce oluşturulur, DNS-only ile sertifika, sonra proxied), `deploy.sh`, GitHub Actions secret'ları, `/opt/birbudak/scripts/backup-bagdam.sh` + health-check satırları.
- DoD gün 4: `bagdam.com` statik site canlı, `/api/health` 200, admin login kabuğu, CI deploy.

**Gün 5–7 (F2) — ilk migration + seed:**
```bash
# database/schema.prisma (§2) → 
pnpm prisma migrate dev --name init --schema=database/schema.prisma      # LOKAL PG bagdam_dev
# migration SQL'e elle ekle: CREATE EXTENSION IF NOT EXISTS citext; ALTER SEQUENCE orders_order_no_seq RESTART WITH 1001; partial unique index'ler
pnpm tsx database/seeds/convert-products-js.ts   # website/assets/products.js → database/data/catalog.json (22 ürün, üretici meta ayrıştırma "Ad · Köy · İlçe — not")
pnpm tsx database/seeds/seed.ts                  # catalog + plans + delivery rules + settings + legal (politikalar.html'den) + site content + journal + faq + tr-address + admin(env)
git commit && git push   # deploy.sh: build → pg_dump → prisma migrate deploy → seed (yalnız boşsa) → pm2 reload
```
- `packages/shared/src/{pricing,state}/` + vitest; ilk testler: KDV ayrıştırma, ilk-2-kutu, ekstra fiyat `round(price×factor)`, kesim hesabı (Europe/Istanbul, DST).

**Gün 8–9 (F3 başlangıcı) — ilk endpoint'ler:** `GET /api/catalog/bootstrap` (products.js ile snapshot eşitlik testi), `GET /api/products?tab=`, `GET /api/content/site`, auth (register/login/refresh/me/csrf), settings, media upload. **İlk dinamik adım (gün 9):** `apps/web` `GET /assets/products.js` → bootstrap'ten aynı JS'i üretir; nginx `location = /assets/products.js { proxy_pass http://127.0.0.1:5011; }` → **tüm site DB'den okur, HTML değişmedi**; admin'den fiyat değiştir → sitede görün (ilk kanıt).

**Gün 10 (F4 başlangıcı) — ilk admin ekranı:** UA `AdminApp/AdminAuthContext/router/AdminLayout/Sidebar/lib/api.ts/hooks/features/components` kopyası → `/login` gerçek + **Ürünler listesi + form** (`useAdminListPanel`, MediaPicker) → `PATCH /admin/products/:id`. DoD: fiyat/alan değişikliği siteye 60 s içinde yansıyor; audit log satırı düşüyor.

**İkinci hafta sonu çıktısı:** canlı statik site (piksel aynı) + DB'den beslenen products.js + çalışan auth/settings/media/catalog API + Ürünler admin ekranı + dondurulmuş şema. Üçüncü haftadan itibaren F4 kalan ekranlar ve F5 `index/urunler` SSR'a geçer.

# 7. Deploy & ops

- **Dizinler:** `/opt/bagdam/` (repo, branch `main`), `apps/api/.env` (yalnız sunucuda, 600), `apps/api/uploads/` (media), `/opt/bagdam/logs/`, yedek `/opt/birbudak/backups/bagdam/` (pg_dump -Fc `bagdam_db` + `uploads.tar.gz`, 7 gün + ayda 1 uzun saklama — fatura/sözleşme kayıtları için 30 günlük off-site kopya önerilir), ACME webroot `/var/www/letsencrypt`.
- **PM2 (`ecosystem.config.js`):** `bagdam-api` (`apps/api/dist/main.js`, `instances: 1` başlangıç — cron kilidi `NODE_APP_INSTANCE==='0'`, `PORT 5010`, `max_memory_restart 512M`, `kill_timeout 8000`, `env_file`), `bagdam-web` (`apps/web/dist/server.js`, `PORT 5011`, `instances 1`). İkinci API instance'ı ancak ölçüm gerekçesiyle (in-memory cache paylaşılmaz).
- **nginx vhost'lar:** `bagdam.com` + `www` (www→apex 301; `location /assets/ { root apps/web/public; immutable 365d }`, `location /media/ { alias uploads; 30d }`, `location /api/ { proxy_pass 127.0.0.1:5010; limit_req zone=api; }`, `location /api/auth/login { limit_req zone=login; }`, `location /api/webhooks/ { proxy_pass …; limit_req off; }`, `location / { proxy_pass 127.0.0.1:5011; }` — **geçiş döneminde** `location /` statik `root apps/web/public` + `try_files`, dinamikleşen sayfalar `location = /urunler …` proxy ile tek tek; `*.html → 301` map); `admin.bagdam.com` (`root apps/admin/dist; try_files → index.html`, `/api/` aynı proxy; güvenlik header'ları, `X-Frame-Options DENY`); her vhost 80→301, HSTS, `client_max_body_size 20M` (/api/admin/media/upload 50M).
- **SSL/Cloudflare/DNS:** Cloudflare Free zone `bagdam.com`; A `@`→<SUNUCU_IP>, CNAME `www`,`admin` (proxied), MX/SPF/DKIM/DMARC DNS-only (mail sağlayıcısına göre; Resend/SES DKIM kayıtları); önce DNS-only ile `certbot --webroot -d bagdam.com -d www.bagdam.com -d admin.bagdam.com`, sonra proxied + SSL "Full (strict)" + Always HTTPS; WAF kuralı: `/api/webhooks/*` için Bot Fight/Challenge kapalı, `/api/*` cache bypass; Page rule: `/assets/*` cache everything. Registrar'da DNSSEC kapalı→NS değişimi→Cloudflare DNSSEC.
- **.env anahtarları (repo'da yalnız `.env.example` adları):** `NODE_ENV, PORT, HOST, DATABASE_URL(?connection_limit=5&pool_timeout=20), JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d, COOKIE_DOMAIN, SETTINGS_ENCRYPTION_KEY, WEB_URL, ADMIN_URL, PAYMENT_PROVIDER=iyzico, IYZICO_API_KEY, IYZICO_SECRET, IYZICO_BASE_URL, IYZICO_WEBHOOK_SECRET, SMS_PROVIDER, NETGSM_*, MAIL_FROM, DISABLE_MAIL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD`; env-validator REQUIRED listesi bunların çekirdeği (UA'daki "şifreleme anahtarı yoksa plaintext" açığı kapatılır: REQUIRED).
- **CI/CD:** `.github/workflows/deploy.yml` (UA kopyası; branch `main`, `paths-ignore docs/**`), `deploy.sh` sırası **build → pg_dump -Fc pre-migrate → prisma migrate deploy → pm2 reload --update-env → `.last-deploy-sha`**; hata halinde PM2 eski build'de kalır (dist'ler `build` tamamlanmadan değişmez: `dist.next` → mv). pnpm `@prisma/client` çift-çözümleme hack'i aynen.
- **Health/monitoring:** `/opt/birbudak/scripts/health-check.sh`'a `bagdam-api` (:5010/api/health) ve `bagdam-web` (:5011/healthz) + `https://bagdam.com/` 200; error-watcher'a `/opt/bagdam/logs/api-error.log`; daily-report'a "yarınki teslimat adedi / dunning" (API `GET /health/ops-summary` token'lı). Cron işleri `CronLog`'a yazar; `cycles:lock` 2 ardışık başarısızlıkta Telegram.
- **Staging/prod:** Aynı sunucuda hafif staging: `bagdam_staging` DB, PM2 `bagdam-api-staging :5020`, `bagdam-web-staging :5021`, `staging.bagdam.com` + `admin-staging.bagdam.com` (Cloudflare Access veya nginx basic auth), branch `staging` → ayrı workflow; iyzico sandbox callback/webhook buraya. Prod'a yalnız `main`.
- **Dev DB stratejisi (KARAR: "tek DB kuralına" uyulmaz):** Lokal PostgreSQL `bagdam_dev` (geliştirici makinesinde PG zaten var), `prisma migrate dev` yalnız lokal, migration commit → prod'da `migrate deploy`. Artılar-eksiler: tek DB = sıfır drift ve seed tekrarı yok ama (a) `migrate dev` drift'te **DB reset** teklif eder → prod felaketi; (b) bahcedenal ADR-0003 ölçümü: SSH tüneli sorgu başına ~87 ms → Prisma N+1'li dev döngüsü 10-20× yavaş; (c) UA'da testler prod'a 163 sahte sipariş yazdı; (d) gerçek müşteri PII'si (KVKK) dev makinesinde + public repo; (e) çevrimdışı çalışılamaz. Telafi: UA jest prod-DB guard'ı ilk günden, staging DB tünelle paylaşılabilir, prod'a salt-okunur `psql` tüneli inceleme için, seed idempotent.

# 8. Riskler ve açık kararlar

**Kullanıcıya sorulacak (önerilen varsayılan ile):**
1. **Kesim kuralı:** teslimattan önceki gün 12:00 (politika + güven şeridi) mi, 2 gün önce 23:59 (`nextCutoff`) mi? → Öneri: **önceki gün 12:00**, `DeliveryDayRule`'da ayarlanabilir.
2. **Tahsilat anı:** UI/politika "teslimat günü çekilir" diyor. → Öneri: **kesimde (lock) çek**; başarısız ödeme paketlemeden önce görülür; metin güncellenir. İlk kutu checkout'ta peşin, sonradan eklenen ekstralar lock'ta DELTA.
3. **İlk 2 kutu %50:** otomatik mi, `BAGDAM050` kodu girilerek mi; kişi başına 1 kez mi; kutu.html'de uygulanıp sepette uygulanmaması hata mı? → Öneri: otomatik, kullanıcı başına ömür boyu 1 abonelik, Order.total'a yansır, promo bar kodu yalnız iletişim (veya Coupon olarak da tanımlanır).
4. **Atlama hakkı:** ömür boyu 1 (kod) vs yılda 1 (politika). → Öneri: **yılda 1** (`skipsAllowed`/yıl), geri alma kesime kadar serbest.
5. **Retention teklifi:** kişi başına 1 kez, süresiz mi? → Öneri: 1 kez, 90 gün içinde bir daha gösterilmez.
6. **Teslimat bölgesi:** yalnız Urla+Çeşme mi; mahalle bazlı kısıt; kapasite/gün kaç kutu? → Öneri: zone ilçe listesi, kapasite 60/gün başlangıç.
7. **Tekil ürünler (süt/fırın/kiler) ayrı sipariş olarak kutusuz satılıyor mu, yalnız abonelere mi?** (SSS "abonelik dışında tek tek satış yapmıyoruz" çelişkisi). → Öneri: tekil satış var (ALACARTE), fresh yalnız kutuda.
8. **Aynı anda abonelik + tek seferlik kutu** mümkün mü (FE'de tek `sub` kaydı)? → Öneri: hayır; tek seferlik kutu = ONE_TIME_BOX order, abonelik varken ikinci kutu değil "ekstra".
9. **KDV oranları:** tümü %1 mi (fırın/kavanoz ürünleri)? Mali müşavirle. → Şema ürün bazlı.
10. **URL şeması:** temiz URL'ler (öneri) vs `.html` kalsın.
11. **Üyelik:** e-posta+şifre (mevcut) mi, telefon+OTP mi? → Öneri: MVP e-posta+şifre + telefon zorunlu; OTP F10'da ek.
12. **Fatura yolu:** GİB portal elle (ciro < 500k) mi, BirFatura/Paraşüt? → MVP alanlar + manuel; entegratör Faz 2.
13. **Toptan:** yalnız e-posta bekleme listesi mi, işletme adı/telefon eklensin mi? → Öneri: 3 alan (e-posta zorunlu, işletme adı, telefon).
14. **Ekstra miktar seçenekleri** ürün bazlı mı (`extraOptions`) yoksa unit kuralı mı? "Sınırsız" üst sınır yok mu? → Öneri: ürün bazlı opsiyonel, stok/lot ile sınırlı.
15. **"6 üretici"** metni vs 15 ad; üretici sayfası olacak mı? → İçerik kararı; şema hazır.
16. **Staging** isteniyor mu (küçük maliyet, iyzico testi için şiddetle önerilir).
17. **İYS/ETBİS/İşletme Kayıt Belgesi/VERBİS** başvuruları kim/ne zaman (kodsuz ama go-live ön koşulu).
18. Sosyal linkler, mail sağlayıcısı (Resend/SES), SMS sağlayıcısı (Netgsm/İleti Merkezi) hesapları.

**Varsayımlar:** fiyatlar KDV dahil; teslimat kendi kurye ile (kargo yok MVP); tek depo; tek dil TR; mobil uygulama yok; iyzico NON3D yetkisi alınır (alınamazsa tekrarlayan tahsilat 3DS'siz yapılamaz → kritik, sözleşme aşamasında teyit — **DOĞRULANMADI**); `<SUNUCU_HOST>` kaynakları (8 vCPU/11 GB) yeterli; bahcedenal TR adres JSON'ı ve yasal metin taslakları kullanılabilir (hukuki güncellik DOĞRULANMADI).

**Teknik riskler ve önlemler:** (a) cycle lock + charge cron'unun çift çalışması → tek instance + `SELECT … FOR UPDATE SKIP LOCKED` + `conversationId` unique; (b) yaz saati/haftalık takvim hataları → `date-fns-tz` + DST testleri; (c) webhook gecikmesi/çift teslim → `WebhookEvent` unique + callback'te retrieve; (d) kapasite yarışı → atomik UPDATE; (e) piksel parite → Playwright görsel regresyon her sayfa geçişinde; (f) public repo sızıntısı → gitleaks pre-commit + secret'lar yalnız sunucu; (g) kapsam şişmesi → Faz-2 backlog ADR'lı, karar kuyruğu ≤3; (h) PG max_connections 100 paylaşımlı → connection_limit=5.

# 9. Referanslardan somut alıntılar

| Adım | Kaynak (UA = uyanisakademi, BA = bahcedenal) | Ne alınır |
|---|---|---|
| F1 | UA `pnpm-workspace.yaml`, `turbo.json`, `package.json` (scripts, `pnpm.overrides.typescript`, `prisma.seed`), `.env.example`, `.github/workflows/deploy.yml`, `deploy.sh`, `ecosystem.config.js` | Monorepo + CI/CD + PM2; deploy.sh sırası değiştirilir (build→dump→migrate), paket adları `@bagdam/*`, port 5010/5011 |
| F1 | UA `apps/api/src/main.ts`, `app.module.ts`, `config/{env-validator,jwt.config,cookie.config}.ts`, `common/{prisma.service,prisma.module,request-context,middleware/request-id,filters/all-exceptions,interceptors/*,decorators/*,guards/*,dto/pagination-query,crypto.util,search.util}.ts` | API bootstrap, guard zinciri, audit interceptor, hata filtresi (Prisma hata eşleme) |
| F1 | BA `deploy/coming-soon/bahcedenal.com.tr.nginx.conf`, `RUNBOOK.md` §1-3,5,6,9; `customer-web/next.config.ts:83-158` | nginx vhost + ACME webroot + Cloudflare DNS/SSL adımları; güvenlik header seti |
| F1 | Sunucu `/opt/birbudak/scripts/backup-uyanisakademi.sh`, `health-check.sh` | `backup-bagdam.sh`, health satırları |
| F2 | UA `database/schema.prisma` (User, UserAddress, Category, Product, ProductImage, Cart, Order, OrderLine, Payment, Coupon, OrderNote/OrderEvent, Media*, SiteSetting, BlogPost, FaqItem, AuditLog, SystemLog, CronLog, TrCity/TrDistrict/TrNeighborhood) + `migrations/20260505100000_payments_gatewayref_paid_partial_unique` | Alan adları/konvansiyon (Citext, Decimal(12,2), @@map), partial unique raw SQL kalıbı |
| F2 | BA `backend/database/data/tr-locations/*.json` + `TrLocationSeeder.php` mantığı; `migrations/2026_05_07_120001..120004`, `140004_add_granular_address_fields.php`; `AddressObserver` (tek default adres) | TR il/ilçe/mahalle seed + adres şeması (is_default partial unique, granular alanlar) |
| F2 | BA `backend/database/migrations/*create_orders_table.php`, `*create_order_items_table.php`, `*create_order_payment_transactions_table.php`, `*create_promo_table.php`; `app/Enums/Order/*` | Adres/kalem snapshot alanları, ödeme transaction ve kupon şeması, durum listeleri (kırpılmış) |
| F2 | BA `scraped-data/static_contents.json` (cayma-hakki, kvkk, mesafeli-satis, on-bilgilendirme, uyelik-sozlesmesi `body_html`); UA `packages/shared/src/contracts/mesafeli-satis.ts` | `legal_documents` v1 taslakları (Bağdam marka/adres; hukuki kontrol şart) |
| F2 | UA `database/seeds/{seed-settings,seed-email-templates,seed-tr-address}.ts`, `seed.ts` | Seed iskeleti; admin env'den |
| F3 | UA `modules/auth/*` (+ `jwt.strategy` purpose claim düzeltmesi), `modules/settings/*` (SENSITIVE_KEYS, AES-GCM), `modules/media/*` (sharp webp/thumb, path-traversal guard), `modules/health/*`, `modules/audit/*`, `modules/system-logs/*`, `modules/address-ref/*`, `modules/products|categories/*` (public select projection), `common/mail.service.ts` çekirdeği (`sendMail`, MailLog idempotency, `DISABLE_MAIL`, `wrapWithLayout`), `src/__tests__/jest-global-setup.ts` (prod DB guard) | Çekirdek modüller kopya-uyarla |
| F3/F6 | UA `modules/pricing/{pricing.service,pricing.types}.ts`, `common/shipping-config.util.ts` | PricingService (KDV dahil/hariç, ROUND_HALF_UP, kargo eşiği) → kutu/ekstra/indirim kuralları eklenir |
| F4 | UA `apps/admin/src/{AdminApp.tsx, app/router.tsx, layouts/AdminLayout.tsx, components/*, contexts/*, hooks/{useApi,useAdminListPanel}.ts, lib/{api,apiTypes,adminNavConfig,adminNavIcons,tableStyles,toast,utils}.ts, features/components/*, features/medya/MediaPickerModal.tsx, pages/urunler/*, pages/ayarlar/*, pages/medya/*, pages/auth/AdminLoginPage.tsx}` | Admin iskeleti + Ürünler/Ayarlar/Medya sayfaları şablon; `resolveApiBase` tam hostname eşleşmesi |
| F5 | BA `customer-web/scripts/{generate-sitemap,optimize-public-images}.mjs`; ADR-0007/0008 görsel fallback; `deploy/coming-soon/index.html` (Organization JSON-LD, canonical) | sitemap/robots, görsel optimizasyon, JSON-LD |
| F6 | BA `backend/app/Services/OrderService.php:81-172, 369-466` (createOrder adım sırası, transaction/rollback, **atomik kapasite UPDATE**), `SlotGeneratorService.php` + `ChannelEtaService.php` (şablon→tarih üretimi, `display_text` sözleşmesi), `migrations/2026_05_08_120001/120002` | `DeliveryDate` üretimi + kapasite rezervi + checkout adımları → Nest `prisma.$transaction` |
| F6/F9 | UA `modules/orders/{order-status-transitions,orders.service(updateStatus, cancel side-effects),order-timeout.scheduler,fulfillment-retry.scheduler}.ts`, `modules/cart/*`, `modules/coupons/*` | Sipariş geçiş tablosu + force/neden + OrderEvent; sepet sync; kupon validate |
| F7 | UA `modules/payment/gateways/{payment-gateway.interface,gateway.factory}.ts` (+ `paytr.adapter.ts` Faz 2), `guest-checkout-token.service.ts`; BA `order_payment_transactions` şeması | `PaymentProvider` arayüzü + factory; iyzico adaptörü yeni yazılır |
| F8 | BA ADR-0029 optimistic cart (`cartSlice.ts`, `ProductCardAddButton.tsx`), ADR-0025 ID-based adres cookie, `useChannelContext.ts` tek-hook state machine; UA `apps/web/src/lib/api.ts` (cookie + CSRF + tryRefresh + forceLogout), `contexts/{AuthContext,CartContext,SiteSettingsContext}.tsx` | `bagdam.js` fetch katmanı (mutasyon tam sepet döner), auth/refresh akışı |
| F10 | BA `customer-web/src/components/Functional/CookieConsent.tsx`, `Cookie/CookieConsentBanner.tsx`, `public/locales/tr.json (cookie.*)`; `backend/app/Console/Commands/PurgeSoftDeletedKvkkData.php` | Çerez banner'ı + KVKK purge cron |
| F10 | UA `modules/email-templates/*` + `seed-email-templates.ts`, `sms-templates/*`, `docs/monitoring-rehberi.md`, `PERFORMANCE_SPRINT_PLAN.md:526-533` (prod don't-do) | Şablon motoru, SMS log, runbook/don't-do listesi |
| Süreç | UA `.github/copilot-instructions.md` (tek DB bölümü yeniden yazılır), `docs/flows/_AKIS-SABLONU.md`, `A1/A2/A3/P1` spec'leri, `YAPILACAKLAR.md`; BA `CLAUDE.md` ADR protokolü (kısaltılmış), `STAGING_DEFERRED.md` | Proje belleği, akış spec şablonları, ADR disiplini (≤25 satır, ayrı dosyalar), karar kuyruğu ≤3 |