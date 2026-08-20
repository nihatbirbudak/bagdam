# Bağdam — Backend, Veri Modeli, Admin Panel ve Geliştirme Sırası Planı (v2, 2026-08-20)

> **Çalışma listesi:** [YOL-HARITASI.md](YOL-HARITASI.md) · **Kararlar:** [adr/](adr/) (16 ADR, 2026-08-20) · Mimari katmanlar: [ADR-0002](adr/0002-moduler-katmanli-mimari-api-first.md).
>
> **Nasıl üretildi:** 4 araştırma ajanı (frontend envanteri, Türkiye gereksinimleri, Uyanış Akademi referansı, Bahçeden Al referansı) → 3 bağımsız mimari önerisi (MVP-önce / alan-doğruluğu-önce / konvansiyon-önce) → 3 hakem (oybirliğiyle MVP-önce, 125/109/109) → sentez (v1) → 3 eleştirmen (50 bulgu: 3 kritik, 26 önemli, 21 küçük) → düzeltme turu (v2). Ham araştırma dosyaları: [docs/arastirma/](arastirma/README.md). Sunucu bağlantı bilgileri: gitignore'lu `docs/sunucu-baglanti.md`. Kısaltmalar: UA = Uyanış Akademi, BA = Bahçeden Al, F0–F11 = geliştirme fazları, [B#] = eleştirmen bulgu numarası, P2 = lansman sonrası kapsam.

v2 omurgası: mvp-once.

Omurga v1 ile aynı: **mvp-once**. v2, üç bağımsız eleştirmenin 50 bulgusuna göre düzeltilmiştir (işlenenler ilgili bölümlerde `[B#]` etiketiyle; reddedilenler §11; değişiklik günlüğü §12). Kanıt: `website/assets/cart.js` (`isLoggedIn` :772 `readJSON(SESSION_KEY)` senkron; `hasPurchasedSub` :779; `CATEGORY_ICON {pantry:"cellar"}` :346; `freshProducts/defaultFill/subSetTier` :874-900; `CUTOFF_WEEKDAY` :1034; `getHours()>=12` :1060; `typeof PRODUCTS` guard'ları; `DOMContentLoaded` init :1214; `sepet\.html` regex :399), `kutu.html` (`isLive()` :203-208, type toggle canlı modda :573-576, `isFirst` :496), `urunler.html:194` (`tab==="pantry"`), `urun.html:107` (`TAB_TO_PANEL`), `uyelik.html` (`RETENTION_KEY` :170, `data-reason` :283, "TEK SEFERLİK SİPARİŞ" :300, :444), `index.html:180-267` (7 ürün + 1 tier kartı), HTML/JS/CSS'te `{{` yok; sunucu SSH doğrulamaları (eleştirmen 3) aşağıda "Sunucu gerçekleri (düzeltilmiş)" bloğunda.

**Sunucu gerçekleri (düzeltilmiş, [B50])**: PG **14.23**, `max_connections 200`, `shared_buffers 2816 MB` (`conf.d/99-birbudak-tuning.conf`), şu an ~57 bağlantı (UA 34, connection_limit'siz); PG oturum TZ **Europe/Istanbul** ([B34]); UA/floovent vhost'ları **Cloudflare Origin CA** (LE değil) ([B36]); certbot `dns-cloudflare` eklentisi kurulu; `bagdam.com` **zaten Cloudflare NS'te** (sharon/lex), zone'da hiç kayıt yok ([B35]); nginx'te `proxy_cache_path` yok, `/var/www/maintenance/<proje>` + `maintenance-toggle.sh` bakım kalıbı var ([B38]); ops script'leri log dosyası değil `uyanisakademi_db.system_logs/incidents` tablolarını okur, `health-check.sh` sabit `ENDPOINTS` haritası, yedek script adı `backup-uyanis.sh` ([B39][B44]); CI deploy SSH anahtarı komut kısıtsız (sunucu güvenlik notu — özel dokümanda) ([B40]); Node **20.20.2 (EOL 2026-04-30)**, tek global kurulum ([B41]); `htpasswd/whois` yok, `jq/rsync/dig` var; 5010/5011 boş; unattended-upgrades açık, oto-reboot kapalı; Türkiye kalıcı +03 (DST yok).

# 0. Yönetici özeti

1. **Yığın = sunucuda çalışan yığın**: TypeScript, NestJS 11, Prisma 6, PostgreSQL 14 (127.0.0.1:5432), PM2, nginx, Cloudflare. PHP/Laravel/Redis/Docker yok. **Runtime hedefi Node 22 LTS** (Node 20 EOL; PM2 `interpreter` ile yalnız Bağdam'a özel Node 22 ikilisi, diğer projeler etkilenmez) [B41].
2. **Frontend (b)-lite**: 10 HTML → byte-byte `.hbs`; `<script src="assets/products.js">` satırı **F3'te** `{{> bootstrap}}` partial'ına dönüşür: `var PRODUCTS/SUB_TIERS/FREQ_OPTIONS/DELIVERY_DAYS/DELIVERY_FEE` **+ `__BAGDAM__.me` (oturum) + `__BAGDAM__.sub` (satın alınmış abonelik DTO'su) + `deliveryDates` (mutlak kesim zamanları) + `templates`** senkron gömülür → cart.js ve inline IIFE'ler parse anında doğru durumu görür (FOUC yok) [B1][B3][B49]. Sunucu-üretimli `/assets/products.js` ara adımı (F3a) **kaldırıldı** (CF/nginx cache çelişkisi) [B5][B30][B42]. cart.js'e faz başına planlı küçük dokunuş: F3 şablon+bootstrap okuma, F6 auth API, F9 remote adaptörü [B26].
3. **URL'ler `.html` ile korunur**; temiz URL + 301 P2.
4. **Tek PM2 süreci** `bagdam-api` :5010 (`exec_mode cluster, instances 1` → sıfır kesintili reload) + staging :5011; admin Vite SPA `admin.bagdam.com` statik; same-origin `/api/`; **httpOnly cookie `path=/`** (nginx HTML cache bypass'ı için) + CSRF [B1][B38][B46].
5. **Şema ~36 model**, iki parça: **F2a** (kullanıcı/adres/bölge/teslimat tarihi/katalog/parti/kutu şablonu/içerik/yasal/ayar/medya/log) F2'de; **F2b** (sipariş/ödeme/abonelik/cycle) F7'nin 1. günü tasarım spike'ı ile. **Dondurma ADR'ı F10'a** (lansmana kadar `migrate dev` serbest; müşteri verisi yok). Tüm an alanları `@db.Timestamptz(3)` [B25][B34].
6. **Abonelik motoru cycle-merkezli**: cycle içeriği = yayınlanmış `BoxTemplate`; swap/ekstra yalnız o cycle'a; kalıcı olan yalnız `Subscription.itemPrefs`; **tek seferlik kutu = tek cycle'lı Subscription (`isOneTime`)** → uyelik/kutu'daki "TEK SEFERLİK SİPARİŞ" yönetimi motorla aynı uçlardan; cycle#1 checkout'ta peşin, kesim öncesi eklemeler **ayrı DELTA Order** (ödenmiş Order değişmez) [B2][B4][B25].
7. **Tahsilat stratejisi arayüzü** F7'de ikili: `MerchantInitiatedCharge` (iyzico saklı kart NON3D) ve `PaymentLinkCharge` (3DS ödeme linki; `AWAITING_PAYMENT` cycle durumu). NON3D yetkisi F11'de "varsayılan strateji" kararıdır, F7'yi bloklamaz [B27].
8. **Ödeme = iyzico Checkout Form + Kart Saklama** (`PaymentProvider` arayüzü; `ManualProvider` testte; PayTR P2). Kart verisi asla bizde değil.
9. **Hafif staging** aynı sunucuda (`bagdam_staging`, :5011, `staging.bagdam.com`, `admin-staging.bagdam.com`, basic auth `openssl passwd -apr1`; callback/webhook `auth_basic off`). **F1'de apex = coming-soon** (aynı tasarım, JSON-LD, robots allow); tam prototip yalnız staging'de; apex tam siteye **F11'de** açılır [B24][B47].
10. **PricingService tek doğruluk kaynağı**; her değerin tek sahibi: kargo/eşik → `DeliveryZone`; why → `ProductLot.tastingNote`; panel notu → `Category.panelNote`; öne çıkanlar → `SiteContent home.featured` (ürün+tier karışık sıra); SEO → `Setting seo.*` [B7][B11].
11. **Yasal**: LegalDocument satır-başına versiyon + `showInNav`; Consent.documentId; iptal 1:N `SubscriptionCancellation(outcome)`; KVKK **veri saklama matrisi** (anonimleştirme, log/yedek süreleri) F10 ADR'ı [B8][B16][B43].
12. **Sıra**: F0 karar → F1 iskelet (apex coming-soon, staging tam site, CF kayıtları, Origin CA, CI kısıtlı anahtar, off-site yedek) → F2 şema-a+seed(katalog) → F3 inline bootstrap+katalog → F4 admin+medya(import) → F5 CMS/yasal/içerik seed → F6 auth/mail → F7 şema-b+motor (9 g) → F8 checkout/iyzico → F9 web adaptörü+ops ekranları → F10 bildirim/yasal/sertleştirme/dondurma → F11 lansman. **Tek dev ~55 iş günü (~11 hafta); 2 dev ~40 iş günü (~8 hafta)**; ilk görünür teslim (dinamik site + admin, staging'de) ~17. iş günü [B28][B29].
13. **Dev DB**: tek DB kuralına uyulmaz (ADR); lokal PG **14** (ya da CI `postgres:14` kapısı zorunlu), `migrate dev` lokal, staging→prod `migrate deploy` sıralı [B45].
14. **Repo**: public monorepo; `.gitignore` düzeltmesi hemen commit (`docs/sunucu-baglanti.md`), GitHub secret scanning + push protection, gitleaks [B48].
15. **Kapsam kilidi (P2)**: temiz URL, PayTR, kargo aracı/Tr* adres, WhatsApp, e-Arşiv entegratörü, İYS API, pause, kupon UI, OTP, Invoice tablosu, çoklu adres UI, ayıplı ürün formu, Cart merge. Karar kuyruğu ≤3.

# 1. Yığın kararı

## 1.1 Karar tablosu

| Katman | Karar | Neden / kanıt |
|---|---|---|
| Dil / runtime | TypeScript; **Node 22 LTS** hedef (sunucuda Node 20 global; Bağdam için `/usr/local/n/versions/node/22.x` veya NodeSource paralel kurulum + PM2 `interpreter`); staging'de UA/floovent'in 22'de çalıştığı doğrulanmadan global Node değiştirilmez [B41] | Node 20 EOL; ödeme/PII işleyen uygulama yamalı runtime ister |
| API | **NestJS 11 + Prisma 6 + PG 14** (`bagdam_db`, rol `bagdam`, `connection_limit=5`; staging `3`; `bagdam_ro` salt-okunur rol) | UA modülleri kopyalanır; PG bağlantı bütçesi paylaşımlı (UA 34, floovent ~17) [B45][B50] |
| Zaman | **Tüm an alanları `@db.Timestamptz(3)`**; `@db.Date` takvim günleri; ham SQL'de `now()/CURRENT_TIMESTAMP` yasak (JS `new Date()` parametre); PM2 `TZ=Europe/Istanbul`; Jest `TZ=UTC` + aynı senaryolar `TZ=Europe/Istanbul`; `date-fns-tz` `zonedTimeToUtc('…12:00','Europe/Istanbul')` [B34] | PG oturum TZ Europe/Istanbul + Prisma `timestamp` varsayılanı = 3 saat kayma riski |
| Para | `Decimal(12,2)` TL KDV dahil; `vatRate Int` (varsayılan 1) | politikalar; sepet.html `line*(0.01/1.01)` |
| Web (müşteri) | **(b)-lite**: `website/*.html` → `apps/api/views/*.hbs` byte-byte; `WebController`; F3'te `{{> bootstrap}}` senkron partial (katalog + me + sub + deliveryDates + templates); `styles.css/assets` nginx statik; HTML **kişiselleşir** (yalnız bootstrap JSON'u), nginx micro-cache çerezli istekleri bypass eder, sunucu çerezli yanıtta `Cache-Control: private, no-store` [B1][B38] | §1.2 |
| URL | `.html` korunur | cart.js sabit linkler/regex |
| Admin | Vite 6 + React 19 + Tailwind 4 (UA `apps/admin` iskeleti), `admin.bagdam.com` statik, cookie auth | hazır bileşenler |
| Kimlik | access JWT 15 dk + refresh 30 gün (rotasyon, bcrypt hash); cookie `access_token` **`path=/`** httpOnly/Secure/SameSite=Lax (HTML bootstrap + nginx bypass için), `refresh_token` `path=/api/v1/auth`; CSRF double-submit; Bearer yalnız test | same-origin |
| Süreçler | `bagdam-api` :5010 `exec_mode:'cluster', instances:1`, `HOST 127.0.0.1`, `TZ`, `max_memory_restart 768M`, `NODE_APP_INSTANCE=0` cron; staging :5011 `ENABLE_CRON=false` [B46] | sıfır kesintili reload |
| Cache/kuyruk | Yok; in-process cache (bootstrap anonim 60 s; settings/site-content invalidate-on-write); cron + `FOR UPDATE SKIP LOCKED` (bound Date) | BA ADR-0032 |
| Görsel | `apps/api/uploads/`; **mevcut 58 görsel yeniden kodlanmadan** (orijinal jpg/png yolu ile) `MediaFile`'a `media:import` komutuyla F4'te alınır; webp+thumb yalnız yeni yüklemelerde [B22][B28] | piksel parite |
| Ödeme | iyzico CF (3DS + `registerCard`) + Kart Saklama; `PaymentProvider` + `ManualProvider`; `ChargeStrategy` MIT \| PAYMENT_LINK [B27] | değişken kutu tutarı |
| E-posta / SMS | SMTP (sağlayıcı kararı **F0**: Resend/SES; SPF/DKIM/DMARC F1'de DNS'e) + `.env` SMTP fallback + `DISABLE_MAIL=true` dev varsayılanı; `Notifier` arayüzü (F7 stub) [B33][B35]; SMS Netgsm P1 opsiyonel | |
| Paket / repo | pnpm 9.15 + turbo; `pnpm.overrides.typescript ~5.8.2`; tek public monorepo (`main`, `staging`); `.gitignore` `docs/sunucu-*.md, *.pem, *.key, .env*`; secret scanning + push protection; gitleaks pre-commit + CI [B48] | |

## 1.2 Frontend: (b)-lite ve senkron bootstrap (katalog + kimlik + abonelik)

- (a) fetch ve (c) SPA v1'deki gerekçelerle RED. **Yeni ([B1])**: aynı ilke kimlik/abonelik için de geçerli — `kutu.html isLive()`, `sepet.html` boş sepet/"Aktif aboneliğin var", `wireAuthGate` parse anında `isLoggedIn()/hasPurchasedSub()` okur. Bu yüzden Nest, çerezi görerek bootstrap'a gömer:

```html
<script>
window.__BAGDAM__ = {{{bootstrapJson}}}; /* JSON.stringify(...).replace(/</g,"\\u003c").replace(/ | /g, …) */
var PRODUCTS = __BAGDAM__.products, SUB_TIERS = __BAGDAM__.tiers, FREQ_OPTIONS = __BAGDAM__.freqOptions,
    DELIVERY_DAYS = __BAGDAM__.deliveryDays, DELIVERY_FEE = __BAGDAM__.deliveryFee;
/* __BAGDAM__.me = {loggedIn, email, name} | null ; __BAGDAM__.sub = cart.js sub DTO'su | null ;
   __BAGDAM__.deliveryDates = [{day,date,cutoffAtIso,locked,full}] ; __BAGDAM__.templates = {small:[…],sezon:[…]} ;
   __BAGDAM__.pool = [fresh slug'ları] ; __BAGDAM__.pairIds ; __BAGDAM__.recommendedTier ; __BAGDAM__.commerce */
</script>
<script src="/assets/cart.js?v={{assetVersion}}"></script>
```
- **cart.js planlı dokunuşları** ([B3][B26]): F3 — `isLoggedIn()` → `__BAGDAM__.me`, `getSub()` canlı modda `__BAGDAM__.sub` (yoksa localStorage taslağı), `subSetTier` → `__BAGDAM__.templates[tier]` varsa şablon, `freshProducts` → `pool`; F6 — login/signup `api()` yardımcısı; F9 — `BahcedenCart.remote` (mutasyonlar), `nextCutoff()/lockedDeliveryDay()` → `deliveryDates`. DOM/data-* değişmez.
- Bootstrap DTO kuralları ([B6][B21]): `tab = category.legacyTab` (cellar→`pantry`; fresh → alan **yok**); `freqOptions=[{id,label,note:"seçtiğin gün",allDays:false}]`; `why = currentLot.tastingNote`; `batch = currentLot.lotCode`; `img/images` MediaFile yolu; **SOLD_OUT/OUT_OF_SEASON/HIDDEN ürünler bootstrap'ta yok** [B22]; snapshot testi products.js ile alan-alan.
- **İzinli tasarım istisnaları** ([B12]): (1) sepet kart formu → iyzico CF konteyneri; (2) üye ol formuna KVKK aydınlatma onayı + pazarlama izni kutucukları; (3) checkout'ta `requiresAck` belge onay kutusu + buton metni "siparişi tamamla — ödeme yükümlülüğü doğurur"; (4) giriş formuna "parolamı unuttum" linki; (5) uyelik adres `#addrDistrict` text→select; (6) coming-soon, 404, bakım sayfaları; (7) uyelik'te yeni abonelik durum metinleri (PAST_DUE/CANCEL_REQUESTED/ödeme bekliyor) aynı kart içinde. Playwright baseline bu bloklar için güncellenebilir işaretli; görsel bölgelerde tolerans/mask.
- Doğrulama: Playwright 10 sayfa × 3 viewport, **staging'de**; diff ≈ 0 (yalnız içerik/istisnalar).
- İstemci durumu: `bahceden_cart`, `bahceden_prefs`, satın alınmamış `bahceden_sub` taslağı kalır; `purchased` sunucudan; `bahceden_member/session/card/orders/retention_offered/address` kaldırılır; `?sifirla` kalır.

# 2. Veri modeli

İlkeler: UA konvansiyonu; snapshot her satırda; kesim/kapasite tek kaynak `DeliveryDate`; an alanları `@db.Timestamptz(3)`; her değerin tek sahibi; "şema-var/UI-yok" alanlar yorumda etiketli (admin form alanı/efor yok) [B20]. **F2a** (katalog, kullanıcı, içerik, ayar, medya, log) F2'de; **F2b** (`Order… Subscription…` bloğu) F7 1. gün; dondurma F10.

```prisma
// database/schema.prisma — Bağdam v2 (PostgreSQL 14, Prisma 6)
generator client { provider = "prisma-client-js"  output = "../node_modules/.prisma/client" }
datasource db     { provider = "postgresql"  url = env("DATABASE_URL") }
// 0000_extensions/migration.sql: CREATE EXTENSION IF NOT EXISTS citext;  (init'ten ÖNCE) [B37]

// ───────── ENUM ─────────
enum UserRole           { CUSTOMER STAFF ADMIN }
enum ProductStatus      { DRAFT ACTIVE HIDDEN }
enum StockStatus        { IN_STOCK LOW SOLD_OUT OUT_OF_SEASON }   // müşteri: yalnız IN_STOCK/LOW bootstrap'ta [B22]
enum DeliveryDay        { SALI PERSEMBE CUMARTESI }
enum DeliveryDateStatus { OPEN LOCKED CLOSED }
enum OrderKind          { SINGLE BOX_ONE_TIME SUBSCRIPTION }      // karışık sepet: SUBSCRIPTION > BOX_ONE_TIME > SINGLE [B15]
enum OrderStatus        { PENDING_PAYMENT PAID PREPARING OUT_FOR_DELIVERY DELIVERED DELIVERY_FAILED CANCELLED REFUNDED PAYMENT_FAILED }
enum OrderLineKind      { PRODUCT BOX EXTRA }
enum BillingParty       { INDIVIDUAL CORPORATE }
enum SubscriptionStatus { PENDING ACTIVE PAST_DUE PAUSED CANCEL_REQUESTED CANCELLED COMPLETED } // PAUSED: şema-var/UI-yok (P2); COMPLETED: tek seferlik kutu [B2]
enum CycleStatus        { SCHEDULED LOCKED AWAITING_PAYMENT SKIPPED CHARGED UNPAID PREPARING OUT_FOR_DELIVERY DELIVERED CANCELLED } // AWAITING_PAYMENT: ödeme linki stratejisi [B27]
enum CycleItemSource    { TEMPLATE SWAP EXTRA CART_MERGE }
enum SkipSource         { USER OPS UNPAID }
enum ChargeStrategy     { MERCHANT_INITIATED PAYMENT_LINK }
enum PaymentProvider    { IYZICO PAYTR MANUAL }
enum PaymentKind        { CHECKOUT CYCLE_CHARGE DELTA RETRY LINK }
enum PaymentStatus      { PENDING REQUIRES_3DS SUCCEEDED FAILED REFUNDED PARTIAL_REFUNDED EXPIRED }
enum WebhookStatus      { RECEIVED PROCESSED FAILED IGNORED }
enum LeadStatus         { NEW CONTACTED CLOSED }
enum ContentStatus      { DRAFT PUBLISHED }
enum LegalKind          { PRIVACY TERMS DISTANCE_SALES DELIVERY RETURNS KVKK COOKIE COOKIE_SETTINGS PREINFO SUBSCRIPTION_CONTRACT MARKETING_CONSENT }
enum ConsentKind        { PREINFO_ACK CONTRACT_ACK SUBSCRIPTION_CONTRACT_ACK KVKK_ACK MARKETING_EMAIL MARKETING_SMS COOKIE_ANALYTICS COOKIE_MARKETING }
enum IysStatus          { NOT_APPLICABLE PENDING SYNCED FAILED }
enum CancelReason       { PRICE VARIETY DELIVERY_DAYS OTHER }
enum CancelOutcome      { PENDING RETENTION_ACCEPTED CANCELLED ABANDONED }  // [B8]
enum SubEventType       { CREATED ACTIVATED TIER_CHANGED FREQ_CHANGED DAY_CHANGED PREF_CHANGED SWAP EXTRA_ADDED EXTRA_REMOVED
                          CART_MERGED SKIP UNSKIP LOCKED AWAITING_PAYMENT CHARGED DELTA_CHARGED PAYMENT_FAILED RETRY UNPAID CARD_UPDATED
                          CANCEL_REQUESTED RETENTION_OFFERED RETENTION_USED CANCELLED COMPLETED PAUSED RESUMED ADMIN_NOTE }
enum MailStatus         { QUEUED SENT FAILED SKIPPED }

// ───────── F2a: KULLANICI / ADRES / BÖLGE / TESLİMAT TARİHİ ─────────
model User {
  id                    String    @id @default(cuid())
  email                 String    @unique @db.Citext                 // FE #loginEmail / #signupEmail
  passwordHash          String
  name                  String?   @db.VarChar(120)
  phone                 String?   @db.VarChar(30)                    // opsiyonel; zorunlu telefon Address/Order'da [B10]
  role                  UserRole  @default(CUSTOMER)
  isActive              Boolean   @default(true)
  emailVerifiedAt       DateTime? @db.Timestamptz(3)
  refreshTokenHash      String?
  passwordResetToken    String?   @unique
  passwordResetExpires  DateTime? @db.Timestamptz(3)
  failedLoginAttempts   Int       @default(0)
  lockedUntil           DateTime? @db.Timestamptz(3)
  prefs                 Json?                                         // FE bahceden_prefs
  retentionOfferUsedAt  DateTime? @db.Timestamptz(3)                  // FE bahceden_retention_offered (üye başına 1)
  firstBoxesPromoUsedAt DateTime? @db.Timestamptz(3)                  // ilk 2 kutu %50 (üye başına 1 abonelik)
  marketingOptIn        Boolean   @default(false)
  lastLoginAt           DateTime? @db.Timestamptz(3)
  anonymizedAt          DateTime? @db.Timestamptz(3)                  // KVKK anonimleştirme [B43]
  createdAt             DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime  @updatedAt @db.Timestamptz(3)
  deletedAt             DateTime? @db.Timestamptz(3)
  addresses      Address[]
  orders         Order[]
  subscriptions  Subscription[]
  paymentMethods PaymentMethod[]
  consents       Consent[]
  cart           Cart?
  @@map("users")
}

model DeliveryZone {                                                  // FE #custDistrict: Urla / Çeşme — kargo/eşik TEK SAHİBİ [B11]
  id             String   @id @default(cuid())
  name           String   @db.VarChar(60)
  slug           String   @unique @db.VarChar(60)
  fee            Decimal  @default(49) @db.Decimal(12,2)              // FE DELIVERY_FEE
  freeThreshold  Decimal? @db.Decimal(12,2)                           // FE 1000 TL
  capacityPerDay Int      @default(999)                               // fiilen sınırsız; ops düşürür [B9]
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)
  addresses     Address[]
  dates         DeliveryDate[]
  subscriptions Subscription[]
  orders        Order[]
  @@map("delivery_zones")
}

model DeliveryDate {                                                  // TEK kesim+kapasite kaynağı; cron 8 hafta ileri üretir
  id        String   @id @default(cuid())
  zoneId    String
  zone      DeliveryZone @relation(fields: [zoneId], references: [id])
  day       DeliveryDay
  date      DateTime @db.Date
  cutoffAt  DateTime @db.Timestamptz(3)                               // zonedTimeToUtc(date-1 12:00, Europe/Istanbul) [B34]
  capacity  Int
  reserved  Int      @default(0)                                      // UPDATE … WHERE reserved < capacity (atomik)
  status    DeliveryDateStatus @default(OPEN)
  cycles    SubscriptionCycle[]
  orders    Order[]
  @@unique([zoneId, date])
  @@index([date, status])
  @@map("delivery_dates")
}

model Address {                                                       // FE bahceden_address + #addressForm (MVP tek adres)
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fullName  String   @db.VarChar(120)
  phone     String   @db.VarChar(30)                                  // zorunlu [B10]
  line      String   @db.VarChar(500)
  zoneId    String
  zone      DeliveryZone @relation(fields: [zoneId], references: [id])
  zip       String?  @db.VarChar(10)
  isDefault Boolean  @default(true)                                   // şema-var/UI-yok (çoklu adres P2)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  deletedAt DateTime? @db.Timestamptz(3)
  subscriptions Subscription[]
  @@index([userId])
  @@map("addresses")
  // raw: CREATE UNIQUE INDEX addresses_one_default ON addresses(user_id) WHERE is_default AND deleted_at IS NULL;
}

// ───────── F2a: KATALOG / ÜRETİCİ / PARTİ ─────────
model Category {                                                      // FE sekmeler; ikon STATİK assets/icons/<slug>.png [B17]
  id        String  @id @default(cuid())
  slug      String  @unique @db.VarChar(40)                           // boxes | dairy | firin | cellar (UI data-tab)
  legacyTab String? @db.VarChar(20)                                   // bootstrap product.tab: cellar→"pantry", dairy, firin, boxes→null [B6]
  label     String  @db.VarChar(60)
  panelNote String?                                                   // FE urunler.html:86,92,98 — TEK SAHİP [B11]
  sortOrder Int     @default(0)
  isActive  Boolean @default(true)
  products  Product[]
  @@map("categories")
}

model Producer {                                                      // FE meta "Üretici · Köy · Urla[ — not]"
  id           String  @id @default(cuid())
  name         String  @db.VarChar(120)
  slug         String  @unique @db.VarChar(120)
  village      String? @db.VarChar(80)
  district     String  @default("Urla") @db.VarChar(80)
  story        String?                                                // şema-var/UI-yok (üretici sayfası P2)
  photoMediaId String?
  photoMedia   MediaFile? @relation("ProducerPhoto", fields: [photoMediaId], references: [id], onDelete: SetNull) // şema-var/UI-yok
  isActive     Boolean @default(true)
  sortOrder    Int     @default(0)
  products     Product[]
  lots         ProductLot[]
  @@map("producers")
}

model Product {
  id            String        @id @default(cuid())
  slug          String        @unique @db.VarChar(80)                 // FE id → urun.html?id=, data-add-to-cart
  name          String        @db.VarChar(120)
  categoryId    String
  category      Category      @relation(fields: [categoryId], references: [id])
  group         String?       @db.VarChar(40)                         // FE category meyve|sebze|bakliyat|süt ürünleri|fırın
  producerId    String?
  producer      Producer?     @relation(fields: [producerId], references: [id], onDelete: SetNull)
  metaNote      String?       @db.VarChar(80)                         // "Erken Hasat"
  price         Decimal       @db.Decimal(12,2)
  vatRate       Int           @default(1)
  unit          String        @db.VarChar(40)
  boxAmount     String?       @db.VarChar(60)                         // FE "kutuda: …"
  extraOptions  Json?                                                 // [{factor,label}] — null → Setting commerce.extraAmountOptions
  description   String
  storageText   String?                                               // FE urun.html:124-130 koddan alana
  allergenText  String?       @db.VarChar(120)
  freshnessNote String?       @db.VarChar(120)
  prefLabel     String?       @db.VarChar(40)
  prefOptions   String[]
  prefDefault   Int?
  isFresh       Boolean       @default(false)
  season        String?       @db.VarChar(40)
  status        ProductStatus @default(ACTIVE)
  stockStatus   StockStatus   @default(IN_STOCK)
  pairWithBox   Boolean       @default(false)                         // FE kutu.html pairIds
  pairOrder     Int           @default(0)
  sortOrder     Int           @default(0)
  images        ProductImage[]
  lots          ProductLot[]                                          // why = lots(isCurrent).tastingNote [B11]
  templateItems BoxTemplateItem[]
  orderLines    OrderLine[]
  cycleItems    CycleItem[]
  createdAt     DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime      @updatedAt @db.Timestamptz(3)
  deletedAt     DateTime?     @db.Timestamptz(3)
  @@index([categoryId]) @@index([status, isFresh])
  @@map("products")
}

model ProductImage {
  id        String    @id @default(cuid())
  productId String
  product   Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  mediaId   String
  media     MediaFile @relation(fields: [mediaId], references: [id])
  alt       String?   @db.VarChar(160)
  isCover   Boolean   @default(false)
  sortOrder Int       @default(0)
  @@index([productId])
  @@map("product_images")
}

model ProductLot {                                                    // FE batch + why (parti sürümü) — her ürünün ≥1 lot'u seed'lenir
  id          String    @id @default(cuid())
  productId   String
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  producerId  String?
  producer    Producer? @relation(fields: [producerId], references: [id], onDelete: SetNull)
  lotCode     String    @db.VarChar(40)                               // FE batch
  harvestDate DateTime? @db.Date
  bestBefore  DateTime? @db.Date
  tastingNote String?                                                 // FE why — TEK SAHİP
  isCurrent   Boolean   @default(true)
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  cycleItems  CycleItem[]
  @@unique([productId, lotCode])
  @@map("product_lots")
}

// ───────── F2a: KUTU / HAFTALIK ŞABLON ─────────
model BoxTier {                                                       // FE SUB_TIERS
  id            String  @id @default(cuid())
  slug          String  @unique @db.VarChar(40)                       // small | sezon
  label         String  @db.VarChar(80)
  itemCount     Int
  price         Decimal @db.Decimal(12,2)
  note          String? @db.VarChar(160)
  imageMediaId  String?
  imageMedia    MediaFile? @relation("TierImage", fields: [imageMediaId], references: [id], onDelete: SetNull)
  isRecommended Boolean @default(false)
  isActive      Boolean @default(true)
  sortOrder     Int     @default(0)
  templates     BoxTemplate[]
  subscriptions Subscription[]
  @@map("box_tiers")
}

model BoxTemplate {                                                   // "bu haftanın kutusu" — cycle içeriğinin TEK kaynağı [B4]
  id          String   @id @default(cuid())
  tierId      String
  tier        BoxTier  @relation(fields: [tierId], references: [id])
  weekStart   DateTime @db.Date
  curatorName String?  @db.VarChar(60)                                // şema-var/UI: yalnız packing fişi
  status      ContentStatus @default(DRAFT)
  items       BoxTemplateItem[]
  @@unique([tierId, weekStart])
  @@map("box_templates")
}
model BoxTemplateItem {
  id          String  @id @default(cuid())
  templateId  String
  template    BoxTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  productId   String
  product     Product @relation(fields: [productId], references: [id])
  qtyLabel    String  @db.VarChar(60)
  isSwappable Boolean @default(true)
  sortOrder   Int     @default(0)
  @@unique([templateId, productId])
  @@map("box_template_items")
}

// ───────── F2b: SEPET / SİPARİŞ ─────────
model Cart {                                                          // şema-var/kullanım P2 (üye sepeti merge)
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     Json     @default("[]")
  boxDraft  Json?
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  @@map("carts")
}

model Order {                                                         // ödendikten sonra DEĞİŞMEZ (snapshot) [B25]
  id               String      @id @default(cuid())
  orderNo          Int         @unique @default(autoincrement())      // raw: RESTART 1001
  kind             OrderKind
  status           OrderStatus @default(PENDING_PAYMENT)
  userId           String?
  user             User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  subscriptionId   String?
  subscription     Subscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  customerName     String      @db.VarChar(120)
  customerEmail    String      @db.VarChar(160)                       // = User.email (checkout'ta readonly) [B15]
  customerPhone    String      @db.VarChar(30)
  zoneId           String?
  zone             DeliveryZone? @relation(fields: [zoneId], references: [id], onDelete: SetNull)
  deliveryDateId   String?
  deliveryDate     DeliveryDate? @relation(fields: [deliveryDateId], references: [id], onDelete: SetNull)
  deliveryDay      DeliveryDay
  deliveryOn       DateTime    @db.Date
  addressSnapshot  Json
  billingParty     BillingParty @default(INDIVIDUAL)                  // billing*: şema-var/UI-yok — kurumsal fatura talebi admin'den girilir (TR mevzuat) [B20]
  billingName      String?     @db.VarChar(200)
  billingTaxNo     String?     @db.VarChar(11)
  billingTaxOffice String?     @db.VarChar(100)
  subtotal         Decimal     @db.Decimal(12,2)
  discountTotal    Decimal     @default(0) @db.Decimal(12,2)          // ilk-kutu %50 / retention — grandTotal'a YANSIR
  shippingFee      Decimal     @default(0) @db.Decimal(12,2)
  vatTotal         Decimal     @default(0) @db.Decimal(12,2)
  grandTotal       Decimal     @db.Decimal(12,2)
  couponCode       String?     @db.VarChar(40)
  paidAt           DateTime?   @db.Timestamptz(3)
  invoiceNo        String?     @db.VarChar(40)                        // manuel GİB e-Arşiv; Invoice tablosu P2
  invoicePdfPath   String?     @db.VarChar(255)
  note             String?
  adminNote        String?                                            // telafi (ayıplı ürün) kaydı MVP'de burada [B19]
  ipAddress        String?     @db.VarChar(64)
  userAgent        String?     @db.VarChar(255)
  cancelledAt      DateTime?   @db.Timestamptz(3)
  cancelReason     String?     @db.VarChar(200)
  lines            OrderLine[]
  payments         Payment[]
  consents         Consent[]
  cycle            SubscriptionCycle? @relation("CycleMainOrder")
  deltaCycle       SubscriptionCycle? @relation("CycleDeltaOrder")
  createdAt        DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime    @updatedAt @db.Timestamptz(3)
  deletedAt        DateTime?   @db.Timestamptz(3)
  @@index([userId]) @@index([status]) @@index([deliveryOn, status])
  @@map("orders")
}

model OrderLine {
  id        String        @id @default(cuid())
  orderId   String
  order     Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  kind      OrderLineKind
  productId String?
  product   Product?      @relation(fields: [productId], references: [id], onDelete: SetNull)
  tierSlug  String?       @db.VarChar(40)
  name      String        @db.VarChar(160)
  unit      String?       @db.VarChar(40)
  qty       Decimal       @db.Decimal(8,3)                            // EXTRA: factor
  unitPrice Decimal       @db.Decimal(12,2)
  lineTotal Decimal       @db.Decimal(12,2)
  vatRate   Int           @default(1)
  pref      String?       @db.VarChar(60)
  lotCode   String?       @db.VarChar(40)
  metadata  Json?                                                     // BOX: {items:[{productId,name,pref,boxAmount,lotCode}]}
  @@index([orderId])
  @@map("order_lines")
}

// ───────── F2b: ÖDEME ─────────
model PaymentMethod {                                                 // yalnız PSP token
  id                  String          @id @default(cuid())
  userId              String
  user                User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider            PaymentProvider
  providerCustomerKey String          @db.VarChar(120)
  providerCardToken   String          @db.VarChar(120)
  bin                 String?         @db.VarChar(8)
  last4               String          @db.VarChar(4)
  brand               String?         @db.VarChar(30)
  holderName          String?         @db.VarChar(120)
  expMonth            Int?
  expYear             Int?
  isDefault           Boolean         @default(true)
  isActive            Boolean         @default(true)
  createdAt           DateTime        @default(now()) @db.Timestamptz(3)
  deletedAt           DateTime?       @db.Timestamptz(3)
  subscriptions       Subscription[]
  payments            Payment[]
  @@index([userId])
  @@map("payment_methods")
}

model Payment {
  id                  String          @id @default(cuid())
  orderId             String
  order               Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  provider            PaymentProvider
  kind                PaymentKind     @default(CHECKOUT)
  conversationId      String          @unique @db.VarChar(80)         // idempotency
  providerPaymentId   String?         @db.VarChar(120)
  providerToken       String?         @db.VarChar(160)
  paymentMethodId     String?
  paymentMethod       PaymentMethod?  @relation(fields: [paymentMethodId], references: [id], onDelete: SetNull)
  amount              Decimal         @db.Decimal(12,2)
  status              PaymentStatus   @default(PENDING)
  is3ds               Boolean         @default(true)
  isMerchantInitiated Boolean         @default(false)
  linkToken           String?         @unique @db.VarChar(64)         // PAYMENT_LINK stratejisi [B27]
  linkExpiresAt       DateTime?       @db.Timestamptz(3)
  attemptNo           Int             @default(1)
  failureCode         String?         @db.VarChar(40)
  failureMessage      String?         @db.VarChar(255)
  rawResponse         Json?
  paidAt              DateTime?       @db.Timestamptz(3)
  refunds             Refund[]
  createdAt           DateTime        @default(now()) @db.Timestamptz(3)
  @@index([orderId]) @@index([providerPaymentId]) @@index([status, createdAt])
  @@map("payments")
  // raw: CREATE UNIQUE INDEX payments_provider_pid_succeeded ON payments(provider, provider_payment_id) WHERE status='SUCCEEDED';
}

model Refund {
  id               String        @id @default(cuid())
  paymentId        String
  payment          Payment       @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  amount           Decimal       @db.Decimal(12,2)
  reason           String?       @db.VarChar(255)
  providerRefundId String?       @db.VarChar(120)
  status           PaymentStatus @default(PENDING)
  requestedBy      String?
  createdAt        DateTime      @default(now()) @db.Timestamptz(3)
  @@map("refunds")
}

model WebhookEvent {
  id             String          @id @default(cuid())
  provider       PaymentProvider
  eventType      String          @db.VarChar(80)
  providerRef    String          @db.VarChar(160)
  payload        Json
  signatureValid Boolean
  status         WebhookStatus   @default(RECEIVED)
  error          String?
  receivedAt     DateTime        @default(now()) @db.Timestamptz(3)
  processedAt    DateTime?       @db.Timestamptz(3)
  @@unique([provider, eventType, providerRef])
  @@map("webhook_events")
}

// ───────── F2b: ABONELİK MOTORU ─────────
model Subscription {                                                  // FE bahceden_sub (purchased) — abonelik VE tek seferlik kutu [B2]
  id                 String             @id @default(cuid())
  userId             String
  user               User               @relation(fields: [userId], references: [id])
  tierId             String
  tier               BoxTier            @relation(fields: [tierId], references: [id])
  isOneTime          Boolean            @default(false)               // FE type onetime → tek cycle, sonra COMPLETED
  status             SubscriptionStatus @default(PENDING)
  frequencyWeeks     Int                @default(1)                   // 1|2|4 (isOneTime'da anlamsız)
  deliveryDay        DeliveryDay
  zoneId             String
  zone               DeliveryZone       @relation(fields: [zoneId], references: [id])
  addressId          String?
  address            Address?           @relation(fields: [addressId], references: [id], onDelete: SetNull)
  paymentMethodId    String?
  paymentMethod      PaymentMethod?     @relation(fields: [paymentMethodId], references: [id], onDelete: SetNull)
  itemPrefs          Json               @default("{}")                // FE itemPrefs {productSlug: option} — KALICI olan yalnız bu [B4]
  chargeStrategy     ChargeStrategy     @default(MERCHANT_INITIATED)  // Setting commerce.chargeStrategy'den kopya (abonelik başına) [B27]
  discountBoxesLeft  Int                @default(2)
  nextBoxDiscountPct Int?                                             // retention %50
  skipsUsed          Int                @default(0)                   // un-skip iade eder; reset = startedAt yıl dönümü [B14]
  skipsResetAt       DateTime?          @db.Timestamptz(3)
  failedCycles       Int                @default(0)
  contractDocId      String?
  startedAt          DateTime?          @db.Timestamptz(3)
  nextDeliveryOn     DateTime?          @db.Date
  nextCutoffAt       DateTime?          @db.Timestamptz(3)
  cancelRequestedAt  DateTime?          @db.Timestamptz(3)
  cancelledAt        DateTime?          @db.Timestamptz(3)
  completedAt        DateTime?          @db.Timestamptz(3)
  cycles             SubscriptionCycle[]
  orders             Order[]
  events             SubscriptionEvent[]
  cancellations      SubscriptionCancellation[]                       // 1:N [B8]
  createdAt          DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime           @updatedAt @db.Timestamptz(3)
  @@index([userId]) @@index([status, nextCutoffAt])
  @@map("subscriptions")
}

model SubscriptionCycle {
  id             String      @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  cycleNo        Int
  deliveryDateId String
  deliveryDate   DeliveryDate @relation(fields: [deliveryDateId], references: [id])
  status         CycleStatus @default(SCHEDULED)
  skipSource     SkipSource?
  boxPrice       Decimal?    @db.Decimal(12,2)                        // lock snapshot
  extrasTotal    Decimal?    @db.Decimal(12,2)
  discount       Decimal?    @db.Decimal(12,2)
  shippingFee    Decimal?    @db.Decimal(12,2)
  total          Decimal?    @db.Decimal(12,2)                        // FE "Bu haftaki ödeme"
  prepaidAmount  Decimal     @default(0) @db.Decimal(12,2)            // cycle#1: checkout'ta peşin
  orderId        String?     @unique                                  // cycle#1 → checkout Order'ı; diğerleri lock'ta üretilen Order
  order          Order?      @relation("CycleMainOrder", fields: [orderId], references: [id], onDelete: SetNull)
  deltaOrderId   String?     @unique                                  // peşin sonrası eklenen ekstralar: AYRI küçük Order [B25]
  deltaOrder     Order?      @relation("CycleDeltaOrder", fields: [deltaOrderId], references: [id], onDelete: SetNull)
  lockedAt       DateTime?   @db.Timestamptz(3)
  skippedAt      DateTime?   @db.Timestamptz(3)
  paymentDueAt   DateTime?   @db.Timestamptz(3)                       // PAYMENT_LINK: link süresi
  retryCount     Int         @default(0)
  nextRetryAt    DateTime?   @db.Timestamptz(3)
  items          CycleItem[]
  @@unique([subscriptionId, cycleNo])
  @@index([status, deliveryDateId])
  @@map("subscription_cycles")
}

model CycleItem {
  id              String          @id @default(cuid())
  cycleId         String
  cycle           SubscriptionCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  source          CycleItemSource
  productId       String
  product         Product         @relation(fields: [productId], references: [id])
  lotId           String?
  lot             ProductLot?     @relation(fields: [lotId], references: [id], onDelete: SetNull)
  swapOfProductId String?         @db.VarChar(40)
  pref            String?         @db.VarChar(60)
  qty             Decimal         @default(1) @db.Decimal(8,3)
  unit            String?         @db.VarChar(40)
  label           String?         @db.VarChar(80)
  unitPrice       Decimal?        @db.Decimal(12,2)                   // lock snapshot; telafi = EXTRA unitPrice 0 [B19]
  lotCode         String?         @db.VarChar(40)
  sortOrder       Int             @default(0)
  @@index([cycleId])
  @@map("cycle_items")
}

model SubscriptionEvent {
  id             String       @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  cycleId        String?
  type           SubEventType
  actor          String       @db.VarChar(10)
  data           Json?
  createdAt      DateTime     @default(now()) @db.Timestamptz(3)
  @@index([subscriptionId, createdAt])
  @@map("subscription_events")
}

model SubscriptionCancellation {                                      // her iptal AKIŞI bir satır [B8]; Abonelik Yön. md.24-25
  id                String   @id @default(cuid())
  subscriptionId    String
  subscription      Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  reason            CancelReason?
  reasonText        String?
  retentionOffered  Boolean  @default(false)
  outcome           CancelOutcome @default(PENDING)
  requestedAt       DateTime @default(now()) @db.Timestamptz(3)
  effectiveAt       DateTime? @db.Timestamptz(3)                      // ≤ 7 gün
  confirmedAt       DateTime? @db.Timestamptz(3)
  refundAmount      Decimal? @db.Decimal(12,2)
  refundDueAt       DateTime? @db.Timestamptz(3)                      // ≤ 15 gün
  @@index([subscriptionId, requestedAt])
  @@map("subscription_cancellations")
}

// ───────── F2a: TOPTAN / İÇERİK / YASAL / AYAR / MEDYA / LOG ─────────
model WholesaleLead {
  id           String     @id @default(cuid())
  email        String     @db.Citext
  businessName String?    @db.VarChar(160)                            // şema-var/UI-yok (form yalnız e-posta)
  phone        String?    @db.VarChar(30)
  note         String?
  status       LeadStatus @default(NEW)
  ip           String?    @db.VarChar(45)
  createdAt    DateTime   @default(now()) @db.Timestamptz(3)
  @@index([status, createdAt])
  @@map("wholesale_leads")
}

model Post {
  id           String        @id @default(cuid())
  slug         String        @unique @db.VarChar(120)
  kind         String        @db.VarChar(30)
  readMinutes  Int           @default(4)
  titleHtml    String
  excerpt      String?
  bodyHtml     String
  coverMediaId String?
  coverMedia   MediaFile?    @relation("PostCover", fields: [coverMediaId], references: [id], onDelete: SetNull)
  relatedSlugs String[]
  status       ContentStatus @default(DRAFT)
  publishedAt  DateTime?     @db.Timestamptz(3)
  sortOrder    Int           @default(0)
  createdAt    DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime      @updatedAt @db.Timestamptz(3)
  @@index([status, publishedAt])
  @@map("posts")
}

model LegalDocument {                                                 // satır başına versiyon
  id            String    @id @default(cuid())
  kind          LegalKind
  slug          String    @db.VarChar(60)
  title         String    @db.VarChar(160)
  version       Int
  leadHtml      String?
  bodyHtml      String
  contentHash   String    @db.VarChar(64)
  effectiveFrom DateTime  @db.Timestamptz(3)
  isCurrent     Boolean   @default(false)
  requiresAck   Boolean   @default(false)
  showInNav     Boolean   @default(false)                             // 8 politika true; PREINFO/SUBSCRIPTION_CONTRACT/MARKETING_CONSENT hash/link ile [B16]
  sortOrder     Int       @default(0)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  consents      Consent[]
  @@unique([slug, version])
  @@index([kind, isCurrent])
  @@map("legal_documents")
}

model Consent {
  id          String      @id @default(cuid())
  userId      String?
  user        User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  guestKey    String?     @db.VarChar(64)
  orderId     String?
  order       Order?      @relation(fields: [orderId], references: [id], onDelete: SetNull)
  kind        ConsentKind
  documentId  String?
  document    LegalDocument? @relation(fields: [documentId], references: [id], onDelete: SetNull)
  granted     Boolean     @default(true)
  source      String      @default("HS_WEB") @db.VarChar(20)
  ipAddress   String?     @db.VarChar(64)
  userAgent   String?     @db.VarChar(255)
  iysStatus   IysStatus   @default(NOT_APPLICABLE)
  iysSyncedAt DateTime?   @db.Timestamptz(3)
  revokedAt   DateTime?   @db.Timestamptz(3)
  createdAt   DateTime    @default(now()) @db.Timestamptz(3)
  @@index([userId, kind]) @@index([orderId])
  @@map("consents")
}

model SiteContent {
  key       String   @id @db.VarChar(80)
  label     String   @db.VarChar(120)
  schema    Json
  value     Json
  updatedBy String?
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  @@map("site_content")
}

model Setting {
  key       String   @id @db.VarChar(100)
  group     String   @db.VarChar(40)
  value     Json
  isSecret  Boolean  @default(false)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  @@index([group])
  @@map("settings")
}

model MediaFile {
  id           String   @id @default(cuid())
  path         String   @db.VarChar(255)
  thumbPath    String?  @db.VarChar(255)
  originalName String   @db.VarChar(255)
  mimeType     String   @db.VarChar(80)
  size         Int
  width        Int?
  height       Int?
  alt          String?  @db.VarChar(160)
  folder       String   @default("genel") @db.VarChar(80)
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  productImages ProductImage[]
  posts         Post[]      @relation("PostCover")
  producers     Producer[]  @relation("ProducerPhoto")
  tiers         BoxTier[]   @relation("TierImage")
  @@index([folder])
  @@map("media_files")
}

model AuditLog {                                                      // silinmez; müşteri PII'si anonimleştirmede [silindi] ile maskelenir [B43]
  id         String   @id @default(cuid())
  actorId    String?
  actorEmail String?  @db.VarChar(160)
  action     String   @db.VarChar(20)
  module     String   @db.VarChar(40)
  entityId   String?  @db.VarChar(60)
  summary    String?  @db.VarChar(255)
  oldValues  Json?
  newValues  Json?
  requestId  String?  @db.VarChar(60)
  ipAddress  String?  @db.VarChar(64)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  @@index([module, entityId]) @@index([createdAt])
  @@map("audit_logs")
}
model MailLog {                                                       // 90 gün
  id           String     @id @default(cuid())
  to           String     @db.VarChar(160)
  subject      String     @db.VarChar(255)
  templateSlug String     @db.VarChar(60)
  entityId     String?    @db.VarChar(60)
  status       MailStatus @default(QUEUED)
  error        String?
  messageId    String?    @db.VarChar(160)
  createdAt    DateTime   @default(now()) @db.Timestamptz(3)
  sentAt       DateTime?  @db.Timestamptz(3)
  @@unique([templateSlug, entityId])
  @@map("mail_logs")
}
model SystemLog {                                                     // 30 gün; ops script'leriyle uyumlu kolonlar [B39]
  id              String   @id @default(cuid())
  level           String   @db.VarChar(10)
  module          String   @db.VarChar(40)
  action          String?  @db.VarChar(40)
  message         String
  requestId       String?  @db.VarChar(60)
  userId          String?
  metadata        Json?
  fingerprint     String?  @db.VarChar(64)
  occurrenceCount Int      @default(1)
  firstSeenAt     DateTime @default(now()) @db.Timestamptz(3)
  lastSeenAt      DateTime @default(now()) @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  @@index([level, lastSeenAt]) @@index([createdAt])
  @@map("system_logs")
}
model CronLog {                                                       // 90 gün
  id             String    @id @default(cuid())
  name           String    @db.VarChar(60)
  status         String    @db.VarChar(10)
  itemsProcessed Int       @default(0)
  errors         Int       @default(0)
  details        Json?
  startedAt      DateTime  @db.Timestamptz(3)
  finishedAt     DateTime? @db.Timestamptz(3)
  durationMs     Int?
  @@index([name, startedAt])
  @@map("cron_logs")
}
```

**Migration dosyaları (uygulama notu 2026-08-20: Prisma timestamp'li klasör adı kullanır; ham SQL'de kolon adları camelCase — `"userId"`, `"isDefault"`, `"deletedAt"`; F7'de `orders_orderNo_seq`, `"providerPaymentId"`):** `0000_extensions/migration.sql` (`CREATE EXTENSION IF NOT EXISTS citext;`) → `0001_init_core` (F2a) → `0002_raw_core.sql` (`addresses_one_default`) → F7: `0003_commerce` (F2b) + `0004_raw_commerce.sql` (`ALTER SEQUENCE orders_order_no_seq RESTART WITH 1001; payments_provider_pid_succeeded`). `deploy.sh` ön adımı `psql -c 'CREATE EXTENSION IF NOT EXISTS citext'` [B37]. Dondurma: F10 ADR (squash yok; additive devam).

**Setting anahtarları (`commerce`):** `vatRate 1` · `deliveryDays [{id:"sali",label:"Salı",dow:2},…]` · `frequencies [{id:"1hafta",weeks:1,label:"Haftada 1"},…]` (bootstrap `{id,label,note,allDays:false}` basar [B21]) · `cutoff {daysBefore:1,time:"12:00"}` · `firstBoxDiscount {pct:50,boxes:2,perUserOnce:true}` · `skipsPerYear 1` · `firstCycleSkippable false` · `retentionOffer {pct:50,boxes:1,perUserOnce:true}` · `extraAmountOptions {kg:[0.25,0.5,1,2],"500 g":[1,2,3],default:[1,2,3,4]}` · `deliveryWindow "09:00–18:00"` · `deliveryDatesHorizonWeeks 8` · `dunning {retryHours:[24,72],pastDueAfterUnpaid:2}` · `chargeStrategy "MERCHANT_INITIATED"|"PAYMENT_LINK"` · `paymentLinkHours 20` · `cookies.analyticsEnabled false` · `seo.*` (başlıklar) · `payment.iyzico {enabled, nonThreeDsGranted}`. **Kargo/eşik Setting'de YOK** (DeliveryZone) [B11]. Gizli anahtarlar (`mail.smtp`, `sms.netgsm`) seed'e konmaz; panelden girilir; MailModule `.env` SMTP fallback [B33].

**SiteContent anahtarları:** `promoBar`, `home.hero`, `home.pillars`, `home.showcase`, `home.cloud`, **`home.featured` `[{type:"product"|"tier", ref, order}]`** [B7], `home.blocks`, `home.faq`, `urunler.trust`, `kutu.notes`, `sepet.texts` + `uyelik.texts` (**F9**; durum metinleri PAST_DUE/UNPAID/CANCEL_REQUESTED/ödeme bekliyor dahil [B23][B32]), `manifesto.*`, `toptan.*`, `gunluk.hero/close`, `footer`. (`urunler.panelNotes` ve `seo.titles` kaldırıldı [B11].)

# 3. API yüzeyi

Önek `/api/v1`; guard `Throttler → JwtAuth → Csrf → Roles`; admin `/admin/*` class-level `@Roles('ADMIN','STAFF') @Audited`.

| Modül | Public | Auth (CUSTOMER) | Admin |
|---|---|---|---|
| web (view) | `GET /` (F1: coming-soon; F11: index), `/index.html`, `/urunler.html`, `/urun.html`, `/kutu.html`, `/sepet.html`, `/uyelik.html`, `/gunluk.html`, `/toptan.html`, `/politikalar.html`, `/nasil-seciyoruz.html` (hbs + `{{> bootstrap}}`; çerez varsa `me/sub` gömülü + `Cache-Control: private, no-store`), `404.hbs` (`NotFoundExceptionFilter`, text/html) [B49], `/sitemap.xml`, `/robots.txt` | — | — |
| health | `GET /health` | — | `GET /admin/health/detailed` |
| auth | `POST /auth/register {email,password,consents[]}` · `/login` · `/refresh` · `/forgot` · `/reset` · `GET /auth/csrf` | `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `PATCH /auth/me/password` · `DELETE /auth/me` (şema-var/UI-yok: KVKK talebi e-posta ile; uç P2'de UI'a bağlanır) | — |
| me | — | `GET/PUT /me/address` · `GET /me/orders` · `GET /me/orders/:orderNo` · `GET /me/cards` · `DELETE /me/cards/:id` · `POST /me/cards/add-session` · `GET/PUT /me/cart` (P2) | — |
| catalog | `GET /bootstrap` (anonim kısım 60 s cache; `me/sub` çerezli istekte) · `GET /products` · `GET /products/:slug` · `GET /tiers` · `GET /tiers/:slug/template?week=` · `GET /producers` | — | `CRUD /admin/products` (+ lots inline: `PATCH /admin/products/:id/lots/:lotId`) · `PATCH /admin/products/:id/{status,stock,pair,sort}` · `POST /admin/products/:id/images` · `CRUD /admin/categories` · `CRUD /admin/producers` · `CRUD /admin/tiers` · `CRUD /admin/box-templates` (+`/publish`, `/clone-next-week`) · `GET/PUT /admin/box-week` |
| delivery | `GET /delivery/zones` · `GET /delivery/dates?zone=&weeks=4` → `[{day,date,cutoffAtIso,locked,full}]` [B9][B49] | — | `CRUD /admin/delivery/zones` · `GET/PATCH /admin/delivery/dates` (kapasite/kapat; **F9**) · `POST /admin/delivery/dates/generate` |
| content | `GET /site-content` · `GET /posts?limit=3` · `GET /posts/:slug` · `GET /legal` (isCurrent; nav = showInNav) · `GET /legal/:slug` · `GET /legal/:slug/v/:version` | `POST /consents` | `GET/PUT /admin/site-content/:key` · `CRUD /admin/posts` · `CRUD /admin/legal` · `GET/PUT /admin/settings/:group` · `POST /admin/settings/mail/test` |
| wholesale | `POST /wholesale-leads` (3/dk/IP) | — | `GET /admin/wholesale-leads` · `PATCH …/:id` |
| checkout / orders | `POST /checkout/quote` | `POST /checkout` (consents + addressId + deliveryDateId → `$transaction`: doğrula → DeliveryDate rezerv (409 `DAY_FULL` + metin) → Order + lines snapshot [+ Subscription PENDING (isOneTime?) + cycle#1 `prepaidAmount`] → Payment PENDING → CF init) · `GET /orders/:orderNo/status` · `POST /orders/:orderNo/cancel` | `GET /admin/orders` · `GET /admin/orders/:id` · `PATCH /admin/orders/:id/status` · `POST /admin/orders/:id/notes` · `PATCH /admin/orders/:id/invoice` · `PATCH /admin/orders/:id/billing` (kurumsal fatura alanları) · `GET /admin/orders/export.csv` |
| payments | `POST /payments/iyzico/callback` (→ 302 `/sepet.html?siparis=<no>`; bu yanıt `no-store`) · `POST /webhooks/iyzico` · `GET /pay/:linkToken` (PAYMENT_LINK: 3DS CF sayfası) [B27] | — | `GET /admin/payments` · `POST /admin/payments/:id/refund` · `GET /admin/webhook-events` (+ yeniden işle) · `POST /admin/cycles/:id/charge` · `POST /admin/cycles/:id/send-payment-link` |
| subscriptions | — | `GET /me/subscription` (sub DTO + status + dunning bayrağı + açık cycle + cutoffAtIso + locked) · `PATCH /me/subscription` (freq, deliveryDay, addressId, paymentMethodId; **type/tier değişimi yok** — canlı modda type butonları disabled [B13]) · `PATCH /me/subscription/cycles/current` (swap/pref/extras; SCHEDULED iken) · `POST …/cycles/current/merge-cart` · `POST …/cycles/current/skip` · `DELETE …/skip` (hak iade) · `POST /me/subscription/cancel {reason,note}` → teklif · `POST …/retention/accept` · `POST …/cancel/confirm` · `POST …/cancel/abandon` | `GET /admin/subscriptions` · `GET /admin/subscriptions/:id` · `PATCH /admin/subscriptions/:id` · `GET /admin/cycles` · `PATCH /admin/cycles/:id/status` · `POST /admin/cycles/:id/compensate` (EXTRA unitPrice 0) [B19] · `GET /admin/ops/pick-list?date=` · `GET /admin/ops/packing-list?date=` (**F9**) |
| customers | — | — | `GET /admin/customers` · `GET /admin/customers/:id` · `PATCH /admin/customers/:id` · `POST /admin/customers/:id/anonymize` |
| media | `GET /uploads/*` (nginx) | — | `POST /admin/media` · `GET /admin/media` · `PATCH /admin/media/:id` · `DELETE /admin/media/:id`; CLI `media:import` (F4) |
| dashboard / sistem | — | — | `GET /admin/dashboard` · audit/system/cron/mail logs |
| jobs (instance 0) | `delivery-dates:generate` (00:30) · `cycles:ensure` (saatlik) · `cycles:lock-and-charge` (5 dk; `cutoffAt <= $1` bound Date; `FOR UPDATE SKIP LOCKED`) · `cycles:expire-payment-links` · `payments:retry` · `reminders:cutoff` (24 s önce; haftalık kutu içeriği ile birleşik [B18]) · `kvkk:purge` (03:30) · `logs:cleanup` (system 30g, mail 90g, cron 90g; audit asla) | | |

**Kimlik:** cookie `access_token` `path=/`; `refresh_token` `path=/api/v1/auth`; CSRF tüm mutasyonlarda; login nginx `3r/m` + `@Throttle`; 5 hata → 30 dk. **Roller:** CUSTOMER / STAFF / ADMIN.

# 4. Admin panel

| # | Ekran | Önc./Faz | Tablolar | Not |
|---|---|---|---|---|
| 1 | Giriş | P0/F4 | users | cookie |
| 2 | Ürünler liste | P0/F4 | products, categories, producers | filtre; sürükle-sırala; pair inline; stok durumu |
| 3 | Ürün formu | P0/F4 | products, product_images, product_lots, media_files | sekmeler: Genel · Fiyat/KDV · Kutu · Tercih · Metinler (desc/storage/allergen/freshness) · **Partiler** (güncel lot: kod + "neden seçtik") · Görseller · (SEO yok) |
| 4 | Kategoriler | P0/F4 | categories | ad, panel notu, sıra (ikon statik) |
| 5 | Üreticiler | P0/F4 | producers | ad/köy/ilçe (hikâye/foto alanı var, UI'da kullanılmaz) |
| 6 | Tier'lar | P0/F4 | box_tiers | |
| 7 | Haftanın Kutusu | P0/F4 | box_templates, box_template_items | hafta → tier başına içerik, swap'lanabilir, küratör, kopyala, yayınla; **yayınlanınca kutu.html şablonu basar (F3 bootstrap+cart.js yaması sayesinde)** [B3] |
| 8 | Medya | P0/F4 | media_files | import edilen 58 görsel klasörlerde; picker |
| 9 | Site Blokları | P1/F5 | site_content | schema'dan form; **home.featured** ürün/tier karışık sıralama |
| 10 | Promo/Footer/İletişim | P1/F5 | site_content | |
| 11 | Günlük | P1/F5 | posts | |
| 12 | Yasal Metinler | P1/F5 | legal_documents | versiyon yayınla; showInNav; requiresAck |
| 13 | Toptan | P1/F5 | wholesale_leads | |
| 14a | Ayarlar › Bölgeler + genel ayar grupları | P1/F5 | delivery_zones, settings | zone CRUD (ücret/eşik/kapasite); UA generic grup formu (commerce.*) [B31] |
| 14b | Ayarlar › Teslimat tarihleri | P0/F9 | delivery_dates | doluluk, günü kapat |
| 15 | E-posta/SMS/Ödeme/SEO | P1/F5 | settings | şifreli; test |
| 16 | Müşteriler | P1/F6 | users, addresses, orders, subscriptions, payment_methods, consents | anonimleştir |
| 17 | Siparişler | P0/F8 | orders, order_lines, payments, refunds | durum geçişleri; iade; fatura no/PDF; kurumsal fatura alanları |
| 18 | Ödeme problemleri | P1/F9 | payments, cycles(UNPAID/AWAITING_PAYMENT) | link gönder, yeniden çek |
| 19 | Abonelikler | P0/F9 | subscriptions, cycles, cycle_items, events, cancellations | tek seferlik kutular da burada (isOneTime) |
| 20 | Teslimat Günü (ops) | P0/F9 | cycles, orders, cycle_items, product_lots | pick/packing/etiket; toplu durum; telafi |
| 21 | Özet | P1/F9 | türetilmiş | |
| 22 | Sistem | P1/F10 | audit/system/cron/mail/webhook | |
| 23 | Kuponlar | P2 | — | |

# 5. Geliştirme sırası

**F0 — Karar sprinti + ADR'ler + operasyonel ön koşullar (2 g)**
- Kapsam: `docs/adr/0001-0016.md` (≤25 satır): yığın+Node 22 hedefi+runtime yükseltme planı [B41]; (b)-lite + **senkron me/sub bootstrap + cookie path=/ + HTML kişiselleşme kuralı** [B1][B38]; `.html` URL; **timestamptz + TZ + now() yasağı** [B34]; kesim (önceki gün 12:00); tahsilat anı (cycle#1 peşin; sonraki eklemeler DELTA Order; cycle#1 atlanamaz); **tahsilat stratejisi ikili** (NON3D kararı F11) [B27]; ilk-2-kutu; atlama (yılda 1, un-skip iade, reset yıl dönümü) [B14]; retention 1 kez; teslimat (Urla+Çeşme kurye; kapasite fiilen sınırsız, ops düşürür) [B9]; fresh tekil satılmaz; **tek seferlik kutu = tek cycle'lı Subscription** [B2]; **cycle içeriği = BoxTemplate, kalıcı yalnız itemPrefs** [B4]; auth e-posta+parola, **telefon Address/Order'da zorunlu** [B10]; karışık sepet kind önceliği + kargo kuralı [B15]; çerez; staging; dev DB lokal + CI PG14 kapısı [B45]; F1 apex coming-soon [B24]; telafi manuel [B19]; "şema-var/UI-yok" listesi [B20]; `docs/state-machines.md` (Order/Subscription/Cycle/Payment/Cancellation + `cycles:ensure` algoritması). Operasyon: iyzico sandbox + merchant başvurusu + NON3D yazılı sorgu; **Cloudflare: bagdam.com zone'unun hesap erişimi teyidi, Bot Fight Mode kapalı** [B35][B47]; e-posta sağlayıcısı kararı (Resend/SES) [B35]; ETBİS/İşletme Kayıt/İYS/e-Arşiv başvuruları; `.gitignore` commit + secret scanning [B48].
- DoD: ADR'ler commit; sandbox anahtarları; CF erişimi; karar kuyruğu ≤3.

**F1 — Walking skeleton (4 g) [B24][B28][B35][B36][B38][B39][B40][B44][B46][B49]**
- Kapsam: monorepo; `apps/api` Nest bootstrap (UA `main.ts/app.module.ts/env-validator/common/*`, `api/v1`, hbs, `useStaticAssets`, `HOST 127.0.0.1`), `WebController` (10 `.hbs` + `404.hbs` + `coming-soon.hbs`), `/health`; `website/*` → `apps/api/views,public`; `apps/admin` kabuğu; sunucu: `/opt/bagdam`, `/opt/bagdam-staging`, PG `bagdam_db`+`bagdam_staging` (+citext), roller `bagdam`, `bagdam_ro`; Node 22 ikilisi + PM2 `interpreter`; `ecosystem.config.js` (cluster×1, TZ, HOST); nginx: `conf.d/02-bagdam-cache.conf` (`proxy_cache_path /var/cache/nginx/bagdam … keys_zone=bagdam_html:10m`), `conf.d` gzip_types, vhost'lar (apex → `coming-soon` location'ı; `/.well-known/acme-challenge/` gerekmez → **Cloudflare Origin CA wildcard `*.bagdam.com`+`bagdam.com` → `/etc/ssl/bagdam/`**), staging vhost basic auth (`openssl passwd -apr1`) + `auth_basic off` callback/webhook; `/var/www/maintenance/bagdam` + `maintenance-toggle.sh` parametrik; **Cloudflare kayıtları** (A `@`, CNAME `www/admin/staging/admin-staging` proxied; SPF/DKIM/DMARC + MX/null-MX DNS-only; Full(strict), Always HTTPS, HSTS; WAF istisnası webhook/callback; Cache Rule `/api/*` bypass, `/assets/*` cache); CI: Bağdam'a özel SSH anahtarı `command="/opt/birbudak/scripts/deploy-dispatch.sh",no-pty,no-port-forwarding,…` + workflow `environment: production` + `concurrency`; `deploy.sh` (flock, koşullu migrate/seed, build→dump→migrate→reload→health→`pm2 save`); `backup-bagdam.sh` (`backup-uyanis.sh`'tan; `db_YYYY-MM-DD_HHMM.dump`; age-şifreli `rclone` → R2/Storage Box 30 gün; aylık 1 yıl; pre-migrate 14 gün); `health-check.sh ENDPOINTS` + `error-watcher/daily-error-digest` `DBS` döngüsü + `daily-report` satırı + `/etc/logrotate.d/birbudak`; Playwright baseline **staging'de**.
- DoD: `https://bagdam.com` = coming-soon (200, JSON-LD, robots allow); `https://staging.bagdam.com` = bugünkü statik site (diff 0, basic auth); `/api/v1/health` 200 (prod+staging); push→deploy yeşil (staging→prod sırası); gece yedeği + off-site kopya alındı; health-check Bağdam satırlarını raporluyor; `renew` yok (Origin CA).
- Neden: altyapı ilk hafta kanıtlanır; prototip (sahte checkout/kart formu) marka alan adında yayınlanmaz.

**F2 — Şema-a + init migration + katalog seed + paylaşılan kurallar (3 g) [B25][B28][B34][B37]**
- Kapsam: F2a modelleri (`0000_extensions`, `0001_init_core`, `0002_raw_core`); seed: `convert-products-js.ts` (vm ile products.js → `catalog.json`; meta ayrıştırma → Producer), `seed.ts` (22 ürün/15 üretici/4 kategori+legacyTab/2 tier/2 zone/ProductLot (batch+why)/bu haftanın BoxTemplate'i/Setting commerce/admin env'den); `packages/shared`: enum'lar, DTO'lar, state machine'ler (F2b dahil tasarım olarak), `pricing/` (KDV, ilk-2-kutu, ekstra round, kargo/eşik zone'dan, kesim hesabı TZ'li) + vitest (UTC ve +03 altında); CI: `services: postgres:14` ile `migrate deploy + seed + test`, `prisma validate + migrate diff`.
- DoD: migration prod+staging; seed yüklü; testler yeşil (iki TZ); ERD.
- Neden: F3-F6 yalnız F2a tablolarına yaslanır; ticari tablolar (F2b) motor tasarımıyla birlikte F7'de (yeniden modelleme önlenir).

**F3 — Inline bootstrap + katalog dinamik (2 g) [B1][B3][B5][B6][B7][B21][B26][B30][B42]**
- Kapsam: `CatalogModule` + `GET /bootstrap` (products.js şekline birebir; `tab=legacyTab`, freqOptions şekli, why/batch lot'tan, SOLD_OUT hariç) + snapshot testi; 10 `.hbs`'de `<script src="assets/products.js">` → `{{> bootstrap}}` (me/sub alanları henüz null); `index.hbs` öne çıkanlar → `home.featured` partial'ı (iki markup dalı: ürün kartı / tier kartı); `kutu.hbs` pairIds/recommendedTier bootstrap'tan; **cart.js yaması**: `subSetTier` → `__BAGDAM__.templates`, `freshProducts` → `pool`, `isLoggedIn/getSub` → `__BAGDAM__.me/sub` okuyucuları (boşken eski davranış); `products.js` repodan silinir (alias yok); nginx `location /assets/` immutable + `cart.js?v=`.
- DoD: staging diff 0; DB'de fiyat/şablon değişince sayfada; snapshot testi yeşil.

**F4 — Admin iskeleti + admin auth + katalog CRUD + medya import (6 g) [B22][B28]**
- Kapsam: `AuthModule` çekirdeği (cookie path=/, CSRF, kilit); UA admin iskeleti (same-origin, `credentials:'include'`); ekran 1-8; `MediaModule` (multer 20 MB → sharp webp+thumb yeni yüklemelerde) + `media:import` (58 görsel, orijinal yol, klasörler, ProductImage/BoxTier bağları); `AuditLogInterceptor` (redaksiyon: e-posta/telefon/adres).
- DoD: admin'den ürün/parti/görsel/şablon değişikliği staging'de görünür; audit satırı. **İlk görünür teslim: "dinamik site + admin" (staging'de, ~17. iş günü).**

**F5 — CMS içerik + günlük + yasal + toptan + ayarlar (6 g) [B16][B28][B31][B32]**
- Kapsam: `ContentModule`; içerik seed'i burada (SiteContent blokları+schema, LegalDocument v1 8+3 (showInNav), 3 Post); view'larda sabit metinler `{{site.*}}` (index, urunler trust/panel notları (Category), kutu notları, gunluk, politikalar `{{#each legal}}` yalnız showInNav nav'da — diğer makaleler hash ile erişilir (DOĞRULANMADI: politikalar JS'nin nav'sız makaleyi gösterip göstermediği; göstermiyorsa istisna 7), toptan, nasil-seciyoruz, footer/promo partial'ları; **sepet/uyelik metinleri F9'a**); `WholesaleModule` + toptan form fetch; `SettingsModule` (şifreli; zone CRUD; generic grup formu); ekran 9-15 (14a); sitemap/robots.
- DoD: admin'den hero/FAQ/politika/blog/iletişim/promo/bölge ücreti değişiyor; diff yalnız içerik.

**F6 — Üyelik + hesap + adres + e-posta çekirdeği + `BahcedenCart.api` (4 g) [B10][B12][B32][B33][B35]**
- Kapsam: müşteri auth (register + KVKK/pazarlama kutucukları + Consent, forgot/reset + "parolamı unuttum" linki), `MeModule`, `MailModule` (settings → `.env` fallback; MailLog; `DISABLE_MAIL`); `Notifier` arayüzü; `BahcedenCart.api()` sözleşmesi (CSRF, 401→logout, hata metinleri) ve auth kapıları API'ye; bootstrap `me` doldu (`is-logged-in` senkron); adres formu select; ekran 16.
- DoD: kayıt→giriş→çıkış→parola sıfırlama maili **DKIM imzalı, spam'e düşmüyor**; adres ortak; Consent kayıtları; çerezli HTML `no-store`, anonim HTML 10 s cache.

**F7 — Şema-b + fiyatlama + abonelik motoru (ManualProvider, Notifier stub) (9 g) [B2][B4][B9][B14][B15][B19][B25][B27][B29][B34]**
- Kapsam: 1. gün F2b tasarım spike'ı + `0003_commerce`/`0004_raw_commerce` + test iskeleti; `PricingService` (tek kaynak; karışık sepet kind önceliği; kargo: abone ‖ zone eşik; ilk-kutu/retention; DELTA); `PaymentProvider` + `ManualProvider`; **`ChargeStrategy`: `MerchantInitiatedCharge` ve `PaymentLinkCharge`** (LOCKED → AWAITING_PAYMENT → CHARGED/UNPAID; `cycles:expire-payment-links`); `DeliveryDatesService` (generate TZ'li; atomik rezerv/iade; `full`); `SubscriptionsModule`: `cycles:ensure` (içerik = yayınlanmış BoxTemplate; şablon yoksa cycle üretilmez + ops uyarısı), `cycles:lock-and-charge` (bound `new Date()`; snapshot → Order [cycle#1: mevcut Order + varsa DELTA Order] → charge), dunning (+24s/+72s → UNPAID + skipSource; 2 ardışık → PAST_DUE), skip/unskip (yıl kuralı, hak iadesi; cycle#1 atlanamaz), swap/pref/extras/merge-cart (SCHEDULED), freq/day/address/card PATCH, **tek seferlik kutu** (isOneTime → cycle#1 DELIVERED/CANCELLED → COMPLETED), cancel akışı (1:N kayıt; teklif; effectiveAt ≤7 g; confirm/abandon; refundDueAt), telafi ucu, SubscriptionEvent.
- Ön koşul: F2 (F6 değil — Notifier stub). DoD: Jest (TZ=UTC ve Europe/Istanbul): "11:59 ekstra kabul / 12:01 red", "2 haftalık takvim", "atla→geri al→kesim (hak iade)", "cycle#1 peşin + DELTA Order", "tek seferlik → COMPLETED", "iptal: kilitli cycle teslim", "UNPAID×2 → PAST_DUE", "PAYMENT_LINK: süre dolunca UNPAID", "gün dolu → 409", fake-timer 8 hafta simülasyonu.

**F8 — Checkout + sipariş + iyzico (6 g)**
- Kapsam: iyzico adaptörü (CF init/retrieve, registerCard, saklı kart NON3D `auth`, iade, webhook HMAC + WebhookEvent); `POST /checkout/quote|checkout`; callback → PAID/ACTIVE/PaymentMethod; sipariş onayı e-postası + LegalDocument kopyası; sepet.html: CF konteyneri, özet quote'tan, buton metni, `?siparis=` (no-store); `customerEmail` readonly prefill; Order geçişleri + iptal side-effects; ekran 17; staging sandbox testi (her iki strateji); `GET /pay/:linkToken`.
- DoD: staging'de tekil ürün / tek seferlik kutu / abonelik ilk ödemesi (3DS+kart saklama) / sonraki cycle (MIT ve link) / webhook çift teslim IGNORED / iade; Consent kayıtları.

**F9 — Web etkileşimli sayfalar API'ye + ops ekranları (7 g) [B13][B17][B18][B23][B29][B31][B32][B49]**
- Kapsam: `BahcedenCart.remote` (sub kaynağı bootstrap, mutasyonlar API; `nextCutoff/lockedDeliveryDay` → `deliveryDates`; canlı modda type butonları disabled; kutu.html onay → `PATCH cycles/current`; uyelik renderSub durum dalları (PAST_DUE/UNPAID/CANCEL_REQUESTED/ödeme linki), atla/geri al, iptal akışı, kart formu → PSP add-session, "kutuma ekle" → merge-cart; `bahceden_card/orders/retention_offered/address` kaldırılır); `sepet.texts/uyelik.texts` CMS; ekran 14b, 18-21; pick/packing uçları.
- DoD: Playwright e2e misafir→üye→abonelik→ekstra→atla→iptal; tek seferlik kutu yönetimi; ops günü admin'den uçtan uca; localStorage'da kart/parola yok; diff 0 (istisnalar hariç).

**F10 — Bildirimler + yasal/çerez + KVKK + sertleştirme + şema dondurma (4 g) [B18][B43]**
- Kapsam: e-posta şablonları (sipariş onayı, **haftalık kutu içeriği + kesim hatırlatma**, tahsilat ok/başarısız + kart güncelleme/ödeme linki, yola çıktı/teslim, **teslimat başarısız/yeniden planlandı**, iptal teyidi, sözleşme kopyası); SMS opsiyonel; çerez banner'ı + Consent; **veri saklama matrisi ADR'ı** (anonymize: User+Address+Order.customer*/addressSnapshot/ip/ua; AuditLog PII `[silindi]`; MailLog 90 g, SystemLog 30 g, CronLog 90 g; nginx access log 14 g, pm2 30 g; yedek 30 g off-site; gizlilik metnine yazılır); `kvkk:purge`; güvenlik gözden geçirme (helmet, CSP `frame-src` iyzico — DOĞRULANMADI alan adı, WAF); k6; restore provası (`pg_restore --list` + tam restore); **ADR "şema v1 donduruldu"**; ekran 22; runbook + `SISTEM-DURUMU.md`.
- DoD: her yaşam döngüsü olayı MailLog'da; restore raporu; go-live checklist.

**F11 — Lansman + hypercare (2 g)**
- Kapsam: iyzico prod anahtarları + NON3D teyidi → `commerce.chargeStrategy` kararı; apex coming-soon → tam site (`/`→index; robots/sitemap); 404/500/bakım kontrol; `unused/` + 27 görsel temizliği; ETBİS/İşletme Kayıt/İYS durumu; ilk teslimat günü izleme; 2 hafta günlük rapor. B planı: NON3D yoksa varsayılan PAYMENT_LINK (ek geliştirme yok); en kötü durumda abonelik "yakında", tek seferlik kutu + tekil ürünle lansman.

| Adım | Kapsam | Bağımlı | Çıktı | Efor (g) | v1→v2 sıra/efor gerekçesi |
|---|---|---|---|---|---|
| F0 | Kararlar + 16 ADR + CF/e-posta/iyzico/ETBİS başvuruları | — | ADR, state-machines | 2 | +4 ADR [B1][B2][B4][B27] |
| F1 | Monorepo, Nest+hbs+404, admin kabuğu, sunucu/PM2/nginx cache/Origin CA/CF kayıtları/kısıtlı CI anahtarı/off-site yedek/ops entegrasyonu/staging; apex coming-soon; baseline staging'de | F0 | staging tam site, apex coming-soon | 4 | apex gated [B24]; NS adımı çıktı [B35]; SSL Origin CA [B36] |
| F2 | Şema-a + seed (katalog) + shared pricing/state + CI PG14 | F0,F1 | dolu DB, yeşil testler | 3 | içerik seed F5'e, medya F4'e [B28]; F2b F7'ye [B25] |
| F3 | Bootstrap (inline, me/sub alanlı) + katalog + featured partial + cart.js yaması | F2 | tüm katalog DB'den, diff 0 | 2 | F3a kaldırıldı [B30][B42] |
| F4 | Admin iskeleti + admin auth + katalog CRUD + medya (+import) | F3 | dinamik site + admin (staging) | 6 | +1 g media import [B28] |
| F5 | Content/Settings/Wholesale + içerik/yasal seed + şablon CMS turu (sepet/uyelik hariç) | F4 | 10 sayfa admin'den | 6 | +1 g içerik seed [B28] |
| F6 | Müşteri auth + Me + Mail + api() sözleşmesi + Müşteriler | F2,F4 | üyelik uçtan uca | 4 | sözleşme F6'da [B32] |
| F7 | Şema-b + Pricing + Provider/Manual + ChargeStrategy×2 + DeliveryDates + motor + cancel | F2 (Notifier stub) | testli motor | 9 | 6→9 [B29]; F6 bağımlılığı kalktı |
| F8 | iyzico + checkout + callback/webhook + Siparişler ekranı + staging testi | F6,F7 | sandbox'ta 3 tür | 6 | — |
| F9 | remote adaptörü + uyelik durumları + ops/teslimat tarihleri/abonelik ekranları + pick/packing | F7,F8 | abonelik uçtan uca | 7 | +1 g (ops uçları/ekran 14b) [B29][B31] |
| F10 | Bildirim + çerez + KVKK matrisi + sertleştirme + dondurma | F9 | go-live checklist | 4 | dondurma burada [B25] |
| F11 | Lansman | F10 | canlı sipariş | 2 | strateji kararı [B27] |

**Toplam ≈ 55 iş günü** (tek dev ~11 hafta). **2 dev (≈40 iş günü ≈ 8 hafta):** A (API/motor): F0→F1→F2→F3→F7→F8→F9(ort.)→F10; B (admin/içerik): F0→(F1-F3 sırasında admin iskeleti + MediaModule + Playwright)→F4→F6→F5→F9(ort.)→F11. Kritik yol: F0 2 + F1 4 + F2 3 + F3 2 + F7 9 + F8 6 (F6, B tarafından ~21. günde biter) + F9 7 + F10 4 + F11 2 ≈ 39-40 gün.

# 6. İlk 14 iş günü [B28]

**Gün 1–2 (F0):** ADR 0001-0016 + `state-machines.md`; CF zone erişimi + Bot Fight Mode kontrolü; e-posta sağlayıcısı; iyzico sandbox; `.gitignore` commit + secret scanning; mali müşavir/ETBİS/İYS.

**Gün 3–6 (F1):**
```bash
cd "<repo-kökü>"
corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm init && printf 'packages:\n  - "apps/*"\n  - "packages/*"\n' > pnpm-workspace.yaml
# UA'dan kopya: turbo.json, .npmrc, .env.example, deploy.sh, ecosystem.config.js, .github/workflows/{deploy,deploy-staging}.yml
pnpm dlx @nestjs/cli@11 new apps/api --package-manager pnpm --skip-git --strict
pnpm create vite apps/admin --template react-ts
mkdir -p database/{migrations,seeds,data} packages/shared/src docs/adr apps/api/{views,public}
pnpm add -Dw prisma@6 typescript tsx turbo vitest @playwright/test && pnpm add -w @prisma/client@6
pnpm --filter ./apps/api add @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt @nestjs/throttler @nestjs/schedule @nestjs/cache-manager cache-manager hbs helmet compression cookie-parser bcrypt class-validator class-transformer sharp multer nodemailer date-fns date-fns-tz
cp website/*.html apps/api/views/ && for f in apps/api/views/*.html; do mv "$f" "${f%.html}.hbs"; done
cp -r website/assets apps/api/public/assets && cp website/styles.css apps/api/public/
git mv website/unused docs/arsiv-prototip
```
- `main.ts/app.module.ts` (UA; `api/v1`; hbs; `HOST 127.0.0.1`), `WebController` (+`coming-soon`, `404`), `HealthController`. Sunucu: Node 22 ikilisi; `/opt/bagdam{,-staging}`; `createuser bagdam bagdam_ro; createdb -O bagdam bagdam_db bagdam_staging; psql -c 'CREATE EXTENSION citext'` (her iki DB); `.env` (600); ecosystem (cluster×1, TZ); `conf.d/02-bagdam-cache.conf` + gzip_types; Origin CA sertifikası; vhost'lar; CF kayıtları + SPF/DKIM/DMARC; kısıtlı deploy anahtarı + `deploy-dispatch.sh`; `backup-bagdam.sh` + rclone off-site; health-check/error-watcher/daily-report satırları; logrotate; Playwright baseline (staging). **DoD gün 6:** apex coming-soon, staging statik site, health 200 ×2, CI yeşil, yedek + off-site.

**Gün 7–9 (F2):**
```bash
pnpm prisma migrate dev --name init_core --schema database/schema.prisma   # lokal PG 14 (bagdam_dev)
pnpm tsx database/seeds/convert-products-js.ts && pnpm tsx database/seeds/seed.ts
pnpm --filter @bagdam/shared test        # pricing/state, TZ=UTC ve TZ=Europe/Istanbul
git push origin staging && git push origin main   # CI: postgres:14 → migrate deploy → staging → prod
```

**Gün 10–11 (F3):** `GET /api/v1/bootstrap` (snapshot testi) → `{{> bootstrap}}` 10 şablonda + cart.js yaması (templates/pool/me/sub okuyucuları) → `home.featured` partial → **ilk dinamik sayfa `urunler.html`**, sonra urun/kutu/index; staging diff 0.

**Gün 12–14 (F4 başlangıcı):** UA admin iskeleti kopyası; admin login/me/logout (cookie path=/); **Ürünler listesi + formu (Partiler sekmesi)**; `media:import`. **14. gün sonu:** staging site DB'den, admin'den değişiklik 60 s içinde sitede, audit satırı.

# 7. Deploy & ops

| Konu | Karar |
|---|---|
| Dizin | `/opt/bagdam/` (`main`), `/opt/bagdam-staging/` (`staging`); `apps/api/{dist,views,public,uploads(git dışı),.env}`, `apps/admin/dist`, `logs/` |
| PM2 | `bagdam-api` :5010 `exec_mode:'cluster', instances:1, interpreter:<node22>, env:{HOST:'127.0.0.1',PORT:5010,TZ:'Europe/Istanbul',NODE_ENV:'production'}, max_memory_restart:'768M', kill_timeout:8000, env_file`; staging :5011 `ENABLE_CRON=false`; deploy sonunda `pm2 save` [B46] |
| nginx apex | `80→301`; `www→apex`; `location /assets/ { alias; expires 365d; immutable }` (`cart.js?v=`); `/uploads/` 30d; `location /api/ { proxy_pass :5010; limit_req zone=api burst=20 nodelay }`; `= /api/v1/auth/login` login zone; `~ ^/api/v1/(webhooks|payments/.+/callback|pay/)` limit dışı; `location / { proxy_pass :5010; proxy_cache bagdam_html; proxy_cache_valid 200 10s; proxy_cache_bypass $cookie_access_token $arg_siparis; proxy_no_cache $cookie_access_token; proxy_cache_use_stale error timeout http_502 http_503; proxy_intercept_errors on; }`; `error_page 502 503 504 /bakim.html; location = /bakim.html { root /var/www/maintenance/bagdam; internal; }`; güvenlik header'ları; `client_max_body_size 20M`; gzip_types conf.d'de [B38][B49] |
| nginx admin / staging | `admin.bagdam.com` SPA statik + `/api/`; `X-Frame-Options DENY`; staging basic auth (`openssl passwd -apr1`) + `auth_basic off` callback/webhook/pay; `robots` noindex [B47] |
| SSL | **Cloudflare Origin CA** wildcard (`*.bagdam.com`, `bagdam.com`, 15 yıl) `/etc/ssl/bagdam/origin.{pem,key}`; yenileme yok; yalnız CF proxy arkasında geçerli (yerel problar `127.0.0.1`) [B36] |
| Cloudflare/DNS | zone mevcut (erişim F0'da teyit); A `@` + CNAME'ler proxied; MX/SPF/DKIM/DMARC DNS-only; Full(strict), Always HTTPS, HSTS; Bot Fight Mode kapalı; WAF skip webhook/callback; Cache Rule `/api/*` bypass, `/assets/*` cache; origin IP kilitleme = ayrı birbudak ops işi (tüm projeler) [B35][B47] |
| `.env` | `NODE_ENV PORT HOST TZ DATABASE_URL(…?connection_limit=5&pool_timeout=20) JWT_SECRET JWT_REFRESH_SECRET SETTINGS_ENCRYPTION_KEY WEB_URL ADMIN_URL ENABLE_CRON PAYMENT_PROVIDER IYZICO_* IYZICO_WEBHOOK_SECRET(DOĞRULANMADI) SMTP_* (fallback) DISABLE_MAIL SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD UPLOADS_DIR`; env-validator fail-fast |
| Backup/health | `backup-bagdam.sh` 03:30 (`db_…dump` + `uploads_…tar.gz`, 7 gün yerel; age-şifreli rclone off-site 30 gün; aylık 1 yıl; pre-migrate 14 gün; `pg_restore --list` doğrulama); `health-check.sh ENDPOINTS` 5010/5011 + `/` 200; `error-watcher/daily-error-digest` `DBS=(uyanisakademi_db bagdam_db)`; `daily-report` Bağdam + off-site satırı; `/etc/logrotate.d/birbudak`; CronLog 2 hata → Telegram; aylık restore provası [B39][B44] |
| CI/CD | `deploy.yml` (main) + `deploy-staging.yml`; `environment: production` + reviewer; `concurrency`; kısıtlı SSH anahtarı + `deploy-dispatch.sh` (`SSH_ORIGINAL_COMMAND` ∈ {bagdam, bagdam-staging}); `deploy.sh`: `flock` → fetch/reset → install → generate → build `dist.next→mv` → `psql citext` → `pg_dump pre-migrate` → `migrate deploy` → reload → health → `pm2 save` → `.last-deploy-sha`; echo'da sır yok; CI testleri `postgres:14` servisinde [B40][B45] |
| Dev DB | tek DB kuralına **uyulmaz** (ADR): lokal PG 14 `bagdam_dev`/`bagdam_test` (PG 18 varsa paralel 14 instance; değilse CI PG14 kapısı zorunlu), `migrate dev` yalnız lokal, `db push` yasak, staging→prod `migrate deploy`; prod'a yalnız `bagdam_ro` tüneli; Jest prod guard (`bagdam_db`, `bagdam_staging`, <SUNUCU_IP>) [B45] |
| Runtime ömrü | Node 22 proje bazlı; PG14→16/17 `pg_upgrade` bakım penceresi tüm projeler için ayrı ops işi (Bağdam ham SQL PG14 sözdiziminde) [B41] |

# 8. Riskler ve açık kararlar

**F0'da kapanması zorunlu (önerilen varsayılan):** 1 kesim önceki gün 12:00; 2 tahsilat cycle#1 peşin + DELTA Order + cycle#1 atlanamaz; 3 ilk-2-kutu otomatik/üye başına 1/yansır; 4 atlama yılda 1 (un-skip iade, reset yıl dönümü); 5 retention 1 kez; 6 Urla+Çeşme kurye, kapasite fiilen sınırsız; 7 fresh tekil satılmaz; 8 aynı anda tek aktif Subscription (tek seferlik dahil); 9 iyzico + **strateji ikili**, NON3D F11 kararı; 10 e-posta+parola, telefon Address/Order'da; 11 çerez bilgilendirme; 12 staging; **13 cookie path=/ + HTML kişiselleşme yalnız bootstrap; 14 timestamptz/TZ; 15 apex coming-soon F11'e kadar; 16 e-posta sağlayıcısı (SPF/DKIM/DMARC F1); 17 Node 22; 18 cycle içeriği = BoxTemplate, kalıcı itemPrefs; 19 tek seferlik kutu = Subscription(isOneTime); 20 telafi manuel.**

**MVP'yi engellemez:** "6 üretici" vs 15; küratör adı; günlük çelişkileri (Nurdan/Nuran, "Cuma kapında"); IG/YT; KDV oranı ürün bazlı; fatura yolu (GİB portal elle); SMS; `season` rozeti; toptan form alanları; şirket ön koşulları; PG upgrade penceresi; origin IP kilitleme.

**Varsayımlar:** fiyatlar KDV dahil; tek depo/tek satıcı; tek dil; mobil yok; Redis yok; kart verisi bizde değil; orderNo 1001; misafir sepeti localStorage, checkout login; BA yasal taslaklar kullanılabilir (hukuki güncellik DOĞRULANMADI); Türkiye kalıcı +03.

**Teknik riskler → önlem:** lock+charge çift çalışma → instance 1 + `SKIP LOCKED` + conversationId; **TZ kayması → timestamptz + bound Date + iki TZ'de test**; webhook çift → WebhookEvent unique; kapasite yarışı → atomik UPDATE + 409; piksel parite → Playwright (istisna listesi, görsel mask); kişisel HTML önbelleği → bypass + no-store; sızıntı → .env sunucu, kısıtlı CI anahtarı, secret scanning; kapsam → P2 ADR'lı, kuyruk ≤3; PG havuzu → limit 5/3; inline JSON XSS → kaçış; tek geliştirici → UA iskeleti + ADR; **NON3D belirsizliği → ikili strateji**; SSL yenileme → Origin CA.

# 9. Referanslardan somut alıntılar

| Faz | Kaynak | Ne alınır |
|---|---|---|
| F1 | `UA/pnpm-workspace.yaml, turbo.json, package.json, .npmrc, .env.example` | aynen (`@bagdam/*`); `predev` tünel alınmaz |
| F1 | `UA/deploy.sh, ecosystem.config.js, .github/workflows/deploy.yml` | yollar/adlar Bağdam; cluster×1; flock; build→dump→migrate; `pm2 save`; kısıtlı anahtar + dispatch |
| F1 | `UA/apps/api/src/main.ts, app.module.ts, config/*, common/{prisma,request-context,middleware,filters,interceptors,decorators,guards,dto,crypto.util,search.util,cron-log}`, `modules/health` | kopyala; hbs; `api/v1`; `HOST 127.0.0.1`; `NotFoundExceptionFilter` eklenir |
| F1 | `BA/deploy/coming-soon/{RUNBOOK.md,index.html,robots.txt,nginx.conf}`, `customer-web/next.config.ts:83-158` | apex coming-soon (Bağdam tasarımıyla), JSON-LD, header seti (NS/DNSSEC adımları atlanır) |
| F1 | sunucu `/opt/birbudak/scripts/{backup-uyanis.sh,health-check.sh,error-watcher.sh,daily-error-digest.sh,daily-report.sh,maintenance-toggle.sh}`, `/etc/nginx/sites-available/uyanisakademi*` (Origin CA yolu, @maintenance) | türetme/satır ekleme |
| F2 | `UA/database/schema.prisma` (User, UserAddress, Category, Product, ProductImage, Cart, Order, OrderLine, Payment, OrderEvent, MediaFile, SiteSetting, BlogPost, AuditLog, MailLog, SystemLog, CronLog), partial unique migration | konvansiyon; timestamptz eklenir |
| F2/F7 | `BA/backend/database/migrations/*orders*, *order_items*, *order_payment_transactions*, *promo*`, `app/Enums/Order/*` | snapshot alanları, durumlar |
| F5 | `BA/scraped-data/static_contents.json`, `UA/packages/shared/src/contracts/mesafeli-satis.ts` | LegalDocument taslakları |
| F2/F5 | `UA/database/seeds/{seed-settings,seed-email-templates}.ts, seed.ts` | seed iskeleti (secret'sız) |
| F3 | `UA/modules/{products,categories}` | CatalogModule |
| F4 | `UA/apps/admin/src/{AdminApp,app/router,layouts,components,contexts,hooks,lib,features/components,features/medya,pages/urunler,pages/medya,pages/auth,pages/dashboard}`, `UA/modules/media`, `modules/auth` (admin) | birebir; cookie; `media:import` |
| F5 | `UA/modules/settings + crypto.util`, `pages/ayarlar`, `modules/content`, `RichTextEditor`, `modules/sitemap`; `BA/BahcedenAlWebSettingsSeeder.php` | Settings/Content/sitemap |
| F6 | `UA/modules/auth`, `apps/web/src/lib/api.ts`, `common/mail.*`, `modules/email-templates`, `modules/members`, `modules/users` | müşteri auth; `api()`; Mail |
| F7 | `UA/modules/pricing`, `BA/OrderService.php:81-172,369-466`, `SlotGeneratorService.php`, `ChannelEtaService.php`, `UA/modules/orders/{fulfillment-retry,order-timeout}.scheduler.ts`, `app.module.ts` cron kilidi | Pricing; transaction sırası; atomik kapasite; DeliveryDate üretimi; dunning/retry |
| F8 | `UA/modules/payment/gateways/*`, `modules/orders/{order-status-transitions,orders.controller,orders.service}`, `pages/siparisler`, `features/siparisler/api.ts` | provider factory; durum makinesi; Siparişler |
| F9 | BA ADR-0029 `cartSlice.ts`, `useChannelContext.ts` | remote adaptör sözleşmesi |
| F10 | `BA/CookieConsentBanner.tsx + tr.json`, `PurgeSoftDeletedKvkkData.php`, `UA/modules/sms-templates`, `docs/monitoring-rehberi.md`, `BA/PERFORMANCE_SPRINT_PLAN.md:526-533` | banner; purge; SMS; runbook |
| Test | `UA/__tests__/jest-global-setup.ts`, `__tests__/security/*` | prod guard |
| Süreç | `UA/.github/copilot-instructions.md`, `docs/flows/_AKIS-SABLONU.md`, `YAPILACAKLAR.md`; `BA/CLAUDE.md`, `STAGING_DEFERRED.md` | ADR ≤25 satır; SİSTEM-DURUMU |

Alınmayacaklar: Hyperlocal/Laravel kodu; multi-vendor/store/rider/wallet/referral/SaaS şemaları; Redis; Maps/Geocoding; Firebase; çoklu dil; UA eğitim/seans/AI modülleri; permission tabloları; `predev` tünel; api-subdomain + localStorage admin token; LE webroot (Origin CA yerine).

# 10. Hakem/sentez notları

Omurga mvp-once korunur. v1'de alınan fikirler (LegalDocument versiyon, prepaidAmount/DELTA, SubscriptionCancellation, CART_MERGE, ManualProvider-önce, ProductLot/BoxTemplate, DeliveryDate, SiteContent.schema, ödeme yükümlülüğü, staging, deploy.sh düzeni, MediaFile import, Cart, UA log tabloları, sitemap, statik dayanıklılık, B planı) yerinde. v2'de eleştirmenlerin çürüttüğü dayanaklar değiştirildi: **sunucu-üretimli products.js (F3a) kaldırıldı** (CF/nginx cache çelişkisi ve iki veri yolu), **"UA LE emsali" iddiası yanlıştı → Origin CA**, **"bagdam.com DNS yok" yanlıştı → zone mevcut**, **"DST testleri" → UTC↔+03 testleri**, **"şema F2'de donar" → F10**, **"tek tasarım istisnası" → 7 maddelik liste**, **"cart.js F9'a kadar değişmez" → planlı küçük yamalar**, **"2 dev 7-8 hafta" → 8 hafta (40 g), tek dev 55 g**. DOĞRULANMADI: iyzico webhook secret alanı ve CSP `frame-src` alan adları; NON3D MIT yetkisi; politikalar.html JS'nin nav'sız makaleyi gösterip göstermediği; BA yasal taslakların hukuki güncelliği; Prisma 6'nın lokal PG18 ile tam paritesi (bu yüzden CI PG14 kapısı).

# 11. Reddedilen / daraltılan eleştiriler

1. **[B9] "Kapasiteyi MVP'den tamamen kaldır" — kısmen RED.** `DeliveryDate` zaten tek kesim kaynağı olarak gerekli ([B49] mutlak kesim zamanları da buradan gelir); kapasite alanı şemada kalır ama varsayılan 999 (fiilen sınırsız), UI'da yalnız "dolu gün" notu (`lockedDayNote` kalıbı) + checkout 409. Kaldırmak, kurye kapasitesi dolduğunda ops'un günü kapatmasını (ekran 14b) imkânsız kılardı; ekleme maliyeti ~0,5 gün.
2. **[B25] "DELTA yerine ekstralar ayrı Order" — KABUL; "dondurmayı lansmana kadar tamamen serbest bırak + squash" — kısmen RED.** Dondurma F10'a taşındı ve şema F2a/F2b'ye bölündü; ancak **migration squash yapılmaz** (staging/prod DB'lerde admin içeriği F4'ten itibaren birikir; squash = DB sıfırlama). Additive migration'larla devam.
3. **[B42] "F3a'yı atlayıp inline bootstrap'a geç" ile [B30] "F3 = yalnız F3a, inline'ı F5'e ertele" çelişiyordu — F3a KALDIRILDI ([B42] tercih edildi).** Gerekçe: [B1] oturum/abonelik durumunun senkron gömülmesi F6'dan önce bir inline bootstrap partial'ı gerektirir; products.js alias'ı CF/nginx cache ile çelişir ve iki veri yolu yaratır. Şablonlara F3 (tek satır) ve F5 (CMS) olmak üzere iki geçiş kabul edilmiş maliyettir (her biri Playwright ile doğrulanır).
4. **[B20] "Producer.journalSlug ve Product.seo*'yu kaldır" — KABUL; "Cart/billing*/PAUSED/Address.isDefault'u kaldır" — RED (etiketlenerek tutuldu).** Bunlar ucuz kolonlar/enum değerleri; admin form alanı ve efor ayrılmaz ("şema-var/UI-yok" yorumları); billing* TR mevzuatı gereği kurumsal fatura talebinde admin'den doldurulur.
5. **[B16] "SUBSCRIPTION_CONTRACT'ı nav'a al" — KARAR ERTELENDİ (F5'te doğrulama).** `showInNav=false` + hash/link erişimi tercih edildi; politikalar.html JS'nin nav'sız makaleyi gösterip göstermediği DOĞRULANMADI; göstermiyorsa izinli tasarım istisnası 7 kapsamında 9. sekme eklenir (Abonelik Yön. md.5 kopyası ayrıca e-posta ile gönderilir).
6. **[B29] "F7'yi 9-10 güne çıkar VEYA ops uçlarını F9'a taşı" — İKİSİ DE yapıldı** (F7 9 g, pick/packing F9); toplam 55 g.
7. **[B47] "origin'i yalnız CF IP'lerine kilitle" — MVP dışına alındı** (tüm projeleri etkileyen ufw değişikliği; birbudak ops işi).

# 12. Değişiklik günlüğü (v1→v2)

| Bulgu | Değişiklik |
|---|---|
| B1 (KRİTİK) | Bootstrap'a `me/sub` senkron; cookie `path=/`; HTML kişiselleşme kuralı + nginx bypass/no-store; ADR-0003 (§8 karar 13); cart.js F3 okuyucu yaması |
| B24 (KRİTİK) | F1 apex = coming-soon; tam prototip staging'de; apex F11'de açılır; Playwright staging'de |
| B34 (KRİTİK) | Tüm an alanları `@db.Timestamptz(3)`; ham SQL bound Date; PM2 `TZ`; testler iki TZ'de; DST→UTC↔+03; ADR-0004 (§8 karar 14) |
| B2 | `Subscription.isOneTime`, `SubscriptionStatus.COMPLETED`; tek seferlik kutu motorla yönetilir |
| B3, B26 | Bootstrap `templates/pool`; `subSetTier/freshProducts` yaması F3; "cart.js değişmez" → planlı dokunuşlar; F4 DoD gerçekçi |
| B4 | `defaultItems` kaldırıldı → `itemPrefs`; cycle içeriği = BoxTemplate; `cycles:ensure` algoritması state-machines.md |
| B5, B30, B42 | F3a (sunucu products.js) kaldırıldı; inline bootstrap F3; `cart.js?v=` |
| B6 | `Category.legacyTab`; bootstrap `tab` kuralı; fresh → alan yok; snapshot testi |
| B7 | `SiteContent home.featured [{type,ref,order}]`; Product.isFeatured/featuredOrder kaldırıldı; iki markup partial |
| B8 | `SubscriptionCancellation` 1:N + `outcome`; `/cancel/abandon` |
| B9 | Kapasite varsayılan 999; `GET /delivery/dates full`; 409 `DAY_FULL` + not |
| B10 | ADR: telefon Address/Order'da zorunlu; User.phone opsiyonel; form değişmez |
| B11 | Tek sahip: kargo/eşik → DeliveryZone (Setting'den silindi); why → ProductLot.tastingNote (Product.whyText silindi); panelNote → Category (SiteContent urunler.panelNotes silindi); seo → Setting |
| B12 | §1.2 izinli tasarım istisnaları listesi (7 madde) |
| B13 | Canlı modda type butonları disabled (F9); PATCH'te type yok |
| B14 | Un-skip hak iadesi; reset = startedAt yıl dönümü; ADR |
| B15 | customerEmail = User.email readonly; karışık sepet kind önceliği; kargo kuralı PricingService testi |
| B16 | `LegalDocument.showInNav`; nav 8; diğerleri hash/link (F5 doğrulama) |
| B17 | Category.iconMediaId kaldırıldı; ikon statik, dosya adı = slug |
| B18 | F10 şablonlarına haftalık kutu içeriği + teslimat başarısız |
| B19 | Telafi manuel: adminNote/Refund/`compensate` (EXTRA unitPrice 0); form P2; politika metni uyumlanır |
| B20 | "şema-var/UI-yok" etiketleri; Producer.journalSlug ve Product.seo* kaldırıldı |
| B21 | freqOptions bootstrap şekli `{id,label,note,allDays:false}` |
| B22 | 58 görsel yeniden kodlanmadan import (F4 `media:import`); StockStatus müşteri kuralı; Playwright görsel mask |
| B23 | uyelik.texts durum metinleri; `/me/subscription` status+dunning; F9 renderSub dalları |
| B25 | Şema F2a/F2b; dondurma F10; DELTA = ayrı Order (`deltaOrderId`); ödenmiş Order değişmez |
| B27 | `ChargeStrategy` MIT/PAYMENT_LINK; `CycleStatus.AWAITING_PAYMENT`; `Payment.linkToken/linkExpiresAt`; `/pay/:token`; NON3D kararı F11 |
| B28 | F2 seed daraltıldı (3 g); içerik seed F5, medya import F4; "İlk 14 iş günü"; F1 DoD |
| B29 | F7 9 g; Notifier stub (F7 ← F2); ops uçları F9; tek dev 55 g, 2 dev 40 g; 2-dev iş bölümü |
| B31 | Ekran 14 → 14a (F5 zone+generic ayar) / 14b (F9 tarihler) |
| B32 | sepet/uyelik CMS F9; `BahcedenCart.api()` sözleşmesi F6 |
| B33 | Secret'lar seed'de yok; Mail `.env` fallback; deploy.sh koşullu migrate/seed |
| B35 | CF: NS/DNSSEC adımları çıktı; hesap erişimi F0; SPF/DKIM/DMARC F1; e-posta sağlayıcısı F0; F6 DoD DKIM |
| B36 | SSL = Cloudflare Origin CA; "UA LE emsali" ifadesi kaldırıldı |
| B37 | `0000_extensions` migration; deploy.sh `psql citext` |
| B38 | `conf.d/02-bagdam-cache.conf` proxy_cache_path; bypass+no_cache; `proxy_intercept_errors`; bakım sayfası `/var/www/maintenance/bagdam` + toggle |
| B39 | SystemLog `action/createdAt`; health-check ENDPOINTS; error-watcher DBS; daily-report; backup adlandırma; logrotate |
| B40 | Kısıtlı CI SSH anahtarı + dispatch; environment/concurrency; echo'da sır yok |
| B41 | Node 22 hedefi + PM2 interpreter; PG upgrade penceresi ayrı ops işi |
| B43 | F10 veri saklama matrisi ADR'ı; `User.anonymizedAt`; AuditLog PII maskeleme; log retention; access log |
| B44 | backup-bagdam.sh `backup-uyanis.sh`'tan; off-site şifreli R2 F1'de; pre-migrate dizini; `pg_restore --list` |
| B45 | Lokal PG 14 / CI postgres:14 kapısı; `prisma validate + migrate diff`; staging→prod sırası; `bagdam_ro`; guard |
| B46 | PM2 cluster×1, HOST 127.0.0.1, TZ, 768M; deploy flock; `pm2 save` |
| B47 | `openssl passwd -apr1`; `auth_basic off`; Bot Fight Mode teyidi F0; origin kilitleme ops işi |
| B48 | `.gitignore` commit; desenler; secret scanning + push protection |
| B49 | `404.hbs` F1; gzip_types; bootstrap `deliveryDates` mutlak zaman; cart.js F9 |
| B50 | Sunucu gerçekleri bloğu düzeltildi; ADR gerekçeleri; SİSTEM-DURUMU kaynak tablosu |
