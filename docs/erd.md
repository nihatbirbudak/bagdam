# Bağdam — ERD (F2a + F2b şeması)

> Kaynak: [`database/schema.prisma`](../database/schema.prisma) · gerekçe: [BACKEND-PLANI.md §2](BACKEND-PLANI.md) · kararlar: ADR-0004 (Timestamptz), ADR-0005 (kesim/bölge), ADR-0006 (tahsilat/DELTA), ADR-0007 (indirim/atlama/retention), ADR-0008 (abonelik modeli), ADR-0010 (ödeme), ADR-0013 (F2a/F2b, additive migration), ADR-0016 (kupon UI P2).
> F2'de üretildi (F2a); **F7 1. gününde F2b varlıkları + minimal Coupon eklendi (2026-08-20)**. Durum geçişleri: [state-machines.md](state-machines.md).
> **F10 sonu (2026-08-21): şema v1 DONDURULDU — [ADR-0021](adr/0021-sema-v1-donduruldu.md).** Aşağıdaki 37 model / 29 enum / 5 migration
> sayımı bundan sonra referanstır; yalnız **additive** migration serbesttir (yeni tablo · nullable kolon · index · enum değeri · FK).
> Kolon/tablo silme, yeniden adlandırma, tip daraltma, enum değeri kaldırma **yeni ADR ister**.

## Özet

- **Tablo sayısı:** 37 = F2a 23 + F2b 12 (Cart, Order, OrderLine, PaymentMethod, Payment, Refund, WebhookEvent, Subscription, SubscriptionCycle, CycleItem, SubscriptionEvent, SubscriptionCancellation) + Coupon 2 (Coupon, CouponRedemption) — DB'de 38 (`_prisma_migrations` ile). **Enum:** 29 (F7: `CouponKind`, `CouponScope`); `packages/shared/src/enums.ts` ile birebir — doğrulama: ad + sıralı değer listesi + `*_VALUES` + `*_LABELS`.
- **Migration zinciri:** `20260820000000_extensions` (citext) → `20260820130020_init_core` (F2a) → `20260820130055_raw_core` (`addresses_one_default`) → `20260820183243_commerce` (F2b + Coupon + F2a karşı ilişkiler + `consents.orderId` FK) → `20260820183416_raw_commerce` (`"orders_orderNo_seq"` RESTART 1001; `payments_provider_pid_succeeded` kısmi benzersiz indeks).
- **Zaman:** tüm an alanları `TIMESTAMPTZ(3)` (78 kolon: F2a 41 + F2b 37; `timestamp without time zone` yok), takvim günleri `DATE` (`DeliveryDate.date`, `BoxTemplate.weekStart`, `ProductLot.harvestDate/bestBefore`, `Order.deliveryOn`, `Subscription.nextDeliveryOn`).
- **Adlandırma:** tablolar snake_case (`@@map`), kolonlar camelCase (alanlarda `@map` yok → ham SQL'de `"userId"`, `"providerPaymentId"`, `"orders_orderNo_seq"` gibi tırnaklı).
- **Tek sahip kuralı [B11]:** kargo/eşik → `DeliveryZone`; kesim+kapasite → `DeliveryDate`; kategori paneli notu → `Category.panelNote`; ürün "why" → `ProductLot.tastingNote`; cycle içeriği → `BoxTemplate`; kalıcı ürün tercihi → `Subscription.itemPrefs`; fiyat snapshot'ı → `Order/OrderLine` (ödendikten sonra değişmez) ve kilitte `SubscriptionCycle/CycleItem`.
- **Snapshot / idempotency:** `Order` ödendikten sonra değişmez, kesim sonrası eklemeler DELTA Order (`SubscriptionCycle.deltaOrderId`); `Payment.conversationId` unique + `payments_provider_pid_succeeded`; `WebhookEvent @@unique(provider, eventType, providerRef)`; `SubscriptionCycle @@unique(subscriptionId, cycleNo)`; `CouponRedemption.orderId` unique (sipariş başına ≤1 kupon).
- **Şema-var/UI-yok (ADR-0013/0016):** `Address.isDefault`, `Producer.story/photoMedia`, `WholesaleLead.businessName`, `BoxTemplate.curatorName`, **`Cart`** (üye sepeti merge P2), **`Order.billing*`** (kurumsal fatura — admin'den), **`SubscriptionStatus.PAUSED`**, **`Coupon` / `CouponRedemption`** (kod girişi + admin ekranı 23 P2; `Order.couponCode` snapshot, Coupon'a FK yok).

## F2a — varlıklar ve ilişkiler

```mermaid
erDiagram
  %% ── Kullanıcı / adres / bölge / teslimat tarihi ──
  User ||--o{ Address : "addresses"
  User ||--o{ Consent : "consents (SetNull)"
  DeliveryZone ||--o{ Address : "zone"
  DeliveryZone ||--o{ DeliveryDate : "dates"

  %% ── Katalog / üretici / parti ──
  Category ||--o{ Product : "category"
  Producer |o--o{ Product : "producer (SetNull)"
  Producer |o--o{ ProductLot : "producer (SetNull)"
  Product ||--o{ ProductImage : "images (Cascade)"
  Product ||--o{ ProductLot : "lots (Cascade)"
  Product ||--o{ BoxTemplateItem : "templateItems"

  %% ── Kutu / haftalık şablon ──
  BoxTier ||--o{ BoxTemplate : "templates"
  BoxTemplate ||--o{ BoxTemplateItem : "items (Cascade)"

  %% ── Medya ──
  MediaFile ||--o{ ProductImage : "media"
  MediaFile |o--o{ Producer : "photoMedia (SetNull)"
  MediaFile |o--o{ BoxTier : "imageMedia (SetNull)"
  MediaFile |o--o{ Post : "coverMedia (SetNull)"

  %% ── Yasal / rıza ──
  LegalDocument |o--o{ Consent : "document (SetNull)"

  User {
    string id PK
    citext email UK
    string passwordHash
    enum role "UserRole"
    boolean isActive
    timestamptz emailVerifiedAt
    string passwordResetToken UK
    timestamptz retentionOfferUsedAt
    timestamptz firstBoxesPromoUsedAt
    jsonb prefs
    timestamptz anonymizedAt
    timestamptz deletedAt
  }
  DeliveryZone {
    string id PK
    string slug UK
    decimal fee "49 varsayılan"
    decimal freeThreshold
    int capacityPerDay "999"
    boolean isActive
  }
  DeliveryDate {
    string id PK
    string zoneId FK
    enum day "DeliveryDay"
    date date "UK(zoneId,date)"
    timestamptz cutoffAt "date-1 12:00 TR"
    int capacity
    int reserved
    enum status "DeliveryDateStatus"
  }
  Address {
    string id PK
    string userId FK
    string zoneId FK
    string fullName
    string phone
    string line
    boolean isDefault "raw: addresses_one_default"
    timestamptz deletedAt
  }
  Category {
    string id PK
    string slug UK "boxes|dairy|firin|cellar"
    string legacyTab
    string label
    string panelNote
  }
  Producer {
    string id PK
    string slug UK
    string name
    string village
    string district "Urla"
    string photoMediaId FK
  }
  Product {
    string id PK
    string slug UK
    string categoryId FK
    string producerId FK
    decimal price
    int vatRate "1"
    string unit
    jsonb extraOptions
    string[] prefOptions
    boolean isFresh
    enum status "ProductStatus"
    enum stockStatus "StockStatus"
    boolean pairWithBox
    timestamptz deletedAt
  }
  ProductImage {
    string id PK
    string productId FK
    string mediaId FK
    boolean isCover
  }
  ProductLot {
    string id PK
    string productId FK
    string producerId FK
    string lotCode "UK(productId,lotCode)"
    date harvestDate
    date bestBefore
    string tastingNote "FE why"
    boolean isCurrent
  }
  BoxTier {
    string id PK
    string slug UK "small|sezon"
    int itemCount
    decimal price
    string imageMediaId FK
    boolean isRecommended
  }
  BoxTemplate {
    string id PK
    string tierId FK
    date weekStart "UK(tierId,weekStart)"
    enum status "ContentStatus"
  }
  BoxTemplateItem {
    string id PK
    string templateId FK
    string productId FK
    string qtyLabel
    boolean isSwappable
  }
  MediaFile {
    string id PK
    string path
    string thumbPath
    string mimeType
    int size
    string folder
  }
  Post {
    string id PK
    string slug UK
    string kind
    string titleHtml
    string bodyHtml
    string coverMediaId FK
    enum status "ContentStatus"
    timestamptz publishedAt
  }
  LegalDocument {
    string id PK
    enum kind "LegalKind"
    string slug "UK(slug,version)"
    int version
    string contentHash
    timestamptz effectiveFrom
    boolean isCurrent
    boolean requiresAck
    boolean showInNav
  }
  Consent {
    string id PK
    string userId FK
    string guestKey
    string orderId FK "F7: orders (SetNull)"
    enum kind "ConsentKind"
    string documentId FK
    boolean granted
    enum iysStatus "IysStatus"
    timestamptz revokedAt
  }
```

### Bağımsız tablolar (ilişkisiz)

| Tablo | Model | Not |
|---|---|---|
| `wholesale_leads` | WholesaleLead | `email` citext; `status` LeadStatus |
| `site_content` | SiteContent | `key` PK; `schema` + `value` jsonb (anahtarlar: BACKEND-PLANI §2) |
| `settings` | Setting | `key` PK, `group` indexli; `isSecret` (panelden girilir) |
| `audit_logs` | AuditLog | silinmez; PII anonimleştirmede maskelenir |
| `mail_logs` | MailLog | `UK(templateSlug, entityId)`; 90 gün |
| `system_logs` | SystemLog | fingerprint + occurrenceCount; 30 gün |
| `cron_logs` | CronLog | `idx(name, startedAt)`; 90 gün |
| `webhook_events` | WebhookEvent (F2b) | PSP webhook idempotency `UK(provider, eventType, providerRef)` → çift teslim IGNORED; `payload` jsonb, `signatureValid` |

## F2b — sepet / sipariş / ödeme / abonelik motoru / kupon (F7, `0003_commerce` + `0004_raw_commerce`)

F2a modellerindeki karşı ilişkiler artık gerçek: `User.orders/subscriptions/paymentMethods/cart/couponRedemptions`, `DeliveryZone.subscriptions/orders`, `DeliveryDate.cycles/orders`, `Address.subscriptions`, `Product.orderLines/cycleItems`, `ProductLot.cycleItems`, `BoxTier.subscriptions`, `Consent.order`. `onDelete` kuralı: bağımlı satırlar **Cascade** (lines, payments, refunds, cycles, items, events, cancellations, cart, payment_methods, coupon_redemptions←order), referans/snapshot bağları **SetNull** (Order→user/zone/deliveryDate/subscription, OrderLine→product, Payment→paymentMethod, Subscription→address/paymentMethod, CycleItem→lot, Consent→order, CouponRedemption→user), silinmesi engellenenler **Restrict** (Subscription→user/tier/zone, SubscriptionCycle→deliveryDate, CycleItem→product, CouponRedemption→coupon).

```mermaid
erDiagram
  %% ── F2a ↔ F2b ──
  User ||--o{ Order : "orders (SetNull)"
  User ||--o{ Subscription : "subscriptions (Restrict)"
  User ||--o{ PaymentMethod : "paymentMethods (Cascade)"
  User ||--o| Cart : "cart (Cascade)"
  User |o--o{ CouponRedemption : "couponRedemptions (SetNull)"
  DeliveryZone |o--o{ Order : "zone (SetNull)"
  DeliveryZone ||--o{ Subscription : "zone (Restrict)"
  DeliveryDate |o--o{ Order : "deliveryDate (SetNull)"
  DeliveryDate ||--o{ SubscriptionCycle : "deliveryDate (Restrict)"
  Address |o--o{ Subscription : "address (SetNull)"
  BoxTier ||--o{ Subscription : "tier (Restrict)"
  Product |o--o{ OrderLine : "product (SetNull)"
  Product ||--o{ CycleItem : "product (Restrict)"
  ProductLot |o--o{ CycleItem : "lot (SetNull)"
  Order |o--o{ Consent : "consents (SetNull)"

  %% ── Sipariş / ödeme ──
  Order ||--o{ OrderLine : "lines (Cascade)"
  Order ||--o{ Payment : "payments (Cascade)"
  Payment ||--o{ Refund : "refunds (Cascade)"
  PaymentMethod |o--o{ Payment : "paymentMethod (SetNull)"
  PaymentMethod |o--o{ Subscription : "paymentMethod (SetNull)"

  %% ── Abonelik motoru ──
  Subscription ||--o{ SubscriptionCycle : "cycles (Cascade)"
  Subscription |o--o{ Order : "orders (SetNull)"
  Subscription ||--o{ SubscriptionEvent : "events (Cascade)"
  Subscription ||--o{ SubscriptionCancellation : "cancellations (Cascade)"
  SubscriptionCycle ||--o{ CycleItem : "items (Cascade)"
  Order |o--o| SubscriptionCycle : "CycleMainOrder: cycle.orderId UK (SetNull)"
  Order |o--o| SubscriptionCycle : "CycleDeltaOrder: cycle.deltaOrderId UK (SetNull)"

  %% ── Kupon ──
  Coupon ||--o{ CouponRedemption : "redemptions (Restrict)"
  Order ||--o| CouponRedemption : "couponRedemption: orderId UK (Cascade)"

  Cart {
    string id PK
    string userId FK "UK"
    jsonb items "CartLineInput[]"
    jsonb boxDraft "CartBoxInput"
    timestamptz updatedAt
  }
  Order {
    string id PK
    int orderNo UK "SERIAL; raw RESTART 1001"
    enum kind "OrderKind"
    enum status "OrderStatus"
    string userId FK
    string subscriptionId FK
    string customerEmail "= User.email"
    string zoneId FK
    string deliveryDateId FK
    enum deliveryDay "DeliveryDay"
    date deliveryOn "idx(deliveryOn,status)"
    jsonb addressSnapshot
    enum billingParty "BillingParty (UI-yok)"
    decimal subtotal
    decimal discountTotal
    decimal shippingFee
    decimal vatTotal
    decimal grandTotal
    string couponCode "snapshot"
    timestamptz paidAt
    string invoiceNo "manuel e-Arşiv"
    string adminNote "telafi"
    timestamptz cancelledAt
    timestamptz deletedAt
  }
  OrderLine {
    string id PK
    string orderId FK
    enum kind "OrderLineKind"
    string productId FK
    string tierSlug
    string name
    decimal qty "8,3 — EXTRA: factor"
    decimal unitPrice
    decimal lineTotal
    int vatRate
    string pref
    string lotCode
    jsonb metadata "BOX: items[]"
  }
  PaymentMethod {
    string id PK
    string userId FK
    enum provider "PaymentProvider"
    string providerCustomerKey
    string providerCardToken
    string last4
    string brand
    boolean isDefault
    boolean isActive
    timestamptz deletedAt
  }
  Payment {
    string id PK
    string orderId FK
    enum provider "PaymentProvider"
    enum kind "PaymentKind"
    string conversationId UK "idempotency"
    string providerPaymentId "raw: payments_provider_pid_succeeded"
    string paymentMethodId FK
    decimal amount
    enum status "PaymentStatus"
    boolean is3ds
    boolean isMerchantInitiated
    string linkToken UK "PAYMENT_LINK"
    timestamptz linkExpiresAt
    int attemptNo
    jsonb rawResponse
    timestamptz paidAt
  }
  Refund {
    string id PK
    string paymentId FK
    decimal amount
    string providerRefundId
    enum status "PaymentStatus"
    string requestedBy
  }
  Subscription {
    string id PK
    string userId FK
    string tierId FK
    boolean isOneTime "tek seferlik kutu"
    enum status "SubscriptionStatus"
    int frequencyWeeks "1|2|4"
    enum deliveryDay "DeliveryDay"
    string zoneId FK
    string addressId FK
    string paymentMethodId FK
    jsonb itemPrefs "kalıcı tercih"
    enum chargeStrategy "ChargeStrategy"
    int discountBoxesLeft "2"
    int nextBoxDiscountPct "retention"
    int skipsUsed
    timestamptz skipsResetAt
    int failedCycles
    string contractDocId
    timestamptz startedAt
    date nextDeliveryOn
    timestamptz nextCutoffAt "idx(status,nextCutoffAt)"
    timestamptz cancelledAt
    timestamptz completedAt
  }
  SubscriptionCycle {
    string id PK
    string subscriptionId FK
    int cycleNo "UK(subscriptionId,cycleNo)"
    string deliveryDateId FK
    enum status "CycleStatus"
    enum skipSource "SkipSource"
    decimal boxPrice "lock snapshot"
    decimal extrasTotal
    decimal discount
    decimal shippingFee
    decimal total
    decimal prepaidAmount "cycle#1 peşin"
    string orderId FK "UK"
    string deltaOrderId FK "UK — DELTA Order"
    timestamptz lockedAt
    timestamptz skippedAt
    timestamptz paymentDueAt
    int retryCount
    timestamptz nextRetryAt
  }
  CycleItem {
    string id PK
    string cycleId FK
    enum source "CycleItemSource"
    string productId FK
    string lotId FK
    string swapOfProductId
    string pref
    decimal qty "8,3"
    string label
    decimal unitPrice "lock snapshot; telafi 0"
    string lotCode
  }
  SubscriptionEvent {
    string id PK
    string subscriptionId FK
    string cycleId "FK yok"
    enum type "SubEventType"
    string actor "USER|SYSTEM|ADMIN|OPS|PSP"
    jsonb data
    timestamptz createdAt "idx(subscriptionId,createdAt)"
  }
  SubscriptionCancellation {
    string id PK
    string subscriptionId FK
    enum reason "CancelReason"
    string reasonText
    boolean retentionOffered
    enum outcome "CancelOutcome"
    timestamptz requestedAt
    timestamptz effectiveAt "≤ +7 gün"
    timestamptz confirmedAt
    decimal refundAmount
    timestamptz refundDueAt "≤ +15 gün"
  }
  Coupon {
    string id PK
    citext code UK
    enum kind "CouponKind"
    decimal value "PERCENT yüzde / AMOUNT TL"
    decimal minSubtotal
    enum appliesTo "CouponScope"
    timestamptz startsAt
    timestamptz endsAt
    int usageLimit
    int perUserLimit
    int usedCount
    boolean isActive
    timestamptz deletedAt
  }
  CouponRedemption {
    string id PK
    string couponId FK
    string orderId FK "UK"
    string userId FK
    decimal amount
    timestamptz createdAt
  }
  Consent {
    string id PK
    string orderId FK "F7 FK (SetNull)"
  }
```

### F2b ham SQL (`0004_raw_commerce`)

| SQL | Amaç |
|---|---|
| `ALTER SEQUENCE "orders_orderNo_seq" RESTART WITH 1001;` | Sipariş numaraları 1001'den başlar (`Order.orderNo` SERIAL, müşteriye görünen no) |
| `CREATE UNIQUE INDEX "payments_provider_pid_succeeded" ON "payments"("provider","providerPaymentId") WHERE "status"='SUCCEEDED';` | Aynı sağlayıcı ödeme kimliği tek bir başarılı Payment'ta — callback/webhook çift teslimine karşı idempotency (state-machines.md §4) |

## Doğrulama (lokal, 2026-08-20 — F7 1. gün)

- `prisma format` temiz ✓ · `pnpm db:validate` ✓ · `pnpm db:migrate` (`0003_commerce` + `0004_raw_commerce`) uygulandı · `pnpm db:status` → "Database schema is up to date!" (5 migration) ✓ · `pnpm db:generate` ✓ (client 37 model)
- `psql`: 38 tablo (37 + `_prisma_migrations`), 29 enum, `orders_orderNo_seq` başlangıç 1001 (`is_called=false` → ilk sipariş 1001), `payments_provider_pid_succeeded` kısmi benzersiz indeks mevcut, `coupons.code` tipi `citext`, `consents_orderId_fkey` (SET NULL), **78 `timestamptz` kolon / 0 `timestamp`** (F2b 37/37) ✓
- Enum paritesi: 29 Prisma enum ↔ `packages/shared/src/enums.ts` (ad, sıralı değer, `*_VALUES`, `*_LABELS`) birebir ✓ (`consistency.test.ts` + ayrıca script ile)
- `pnpm --filter @bagdam/shared type-check && test` ✓ (117 vitest) · `pnpm --filter @bagdam/api type-check` ✓ · API jest (gerçek DB) ✓ — F2a ilişkilerinin eklenmesi mevcut sorguları bozmadı
- Migration SQL'lerinde PG 14 dışı sözdizimi yok (jsonb, citext, enum, SERIAL, kısmi indeks) ✓
