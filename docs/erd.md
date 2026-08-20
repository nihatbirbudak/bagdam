# Bağdam — ERD (F2a şeması)

> Kaynak: [`database/schema.prisma`](../database/schema.prisma) (F2a) · gerekçe: [BACKEND-PLANI.md §2](BACKEND-PLANI.md) · kararlar: ADR-0004 (Timestamptz), ADR-0005 (kesim/bölge), ADR-0008 (abonelik modeli), ADR-0013 (F2a/F2b, additive migration).
> Bu dosya F2'de üretildi; F7'de F2b varlıkları eklenince güncellenir.

## Özet

- **Tablo sayısı:** 23 (F2a) + `_prisma_migrations`. **Enum:** 27 (F2b dahil; `packages/shared/src/enums.ts` ile birebir — doğrulama: ad + sıralı değer listesi).
- **Migration zinciri:** `20260820000000_extensions` (citext) → `20260820130020_init_core` (F2a tabloları) → `20260820130055_raw_core` (`addresses_one_default` kısmi benzersiz indeks). F7: `*_commerce` + `*_raw_commerce`.
- **Zaman:** tüm an alanları `TIMESTAMPTZ(3)` (41 kolon; `timestamp without time zone` yok), takvim günleri `DATE` (`DeliveryDate.date`, `BoxTemplate.weekStart`, `ProductLot.harvestDate/bestBefore`).
- **Adlandırma:** tablolar snake_case (`@@map`), kolonlar camelCase (alanlarda `@map` yok → ham SQL'de `"userId"` gibi tırnaklı yazılır).
- **Tek sahip kuralı [B11]:** kargo/eşik → `DeliveryZone`; kesim+kapasite → `DeliveryDate`; kategori paneli notu → `Category.panelNote`; ürün "why" → `ProductLot.tastingNote`; cycle içeriği → `BoxTemplate`.
- **Şema-var/UI-yok (ADR-0013):** `Address.isDefault`, `Producer.story/photoMedia`, `WholesaleLead.businessName`, `BoxTemplate.curatorName`.

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
    string orderId "F7: Order FK"
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

## F2b — F7'de eklenecek varlıklar (noktalı = henüz yok)

`0003_commerce` ile gelir: Cart, Order, OrderLine, PaymentMethod, Payment, Refund, WebhookEvent, Subscription, SubscriptionCycle, CycleItem, SubscriptionEvent, SubscriptionCancellation. F2a modellerindeki karşı ilişkiler (`User.orders/subscriptions/paymentMethods/cart`, `DeliveryZone.subscriptions/orders`, `DeliveryDate.cycles/orders`, `Address.subscriptions`, `Product.orderLines/cycleItems`, `ProductLot.cycleItems`, `BoxTier.subscriptions`, `Consent.order`) şemada `// F2b:` yorumu olarak bekliyor; `Consent.orderId` şimdiden ilişkisiz `String?` (FK additive eklenir).

```mermaid
erDiagram
  %% F2a (mevcut) → F2b (F7) ilişkileri — noktalı çizgi: henüz şemada yok
  User ||..o{ Order : "orders"
  User ||..o{ Subscription : "subscriptions"
  User ||..o{ PaymentMethod : "paymentMethods"
  User ||..o| Cart : "cart"
  DeliveryZone ||..o{ Order : "zone"
  DeliveryZone ||..o{ Subscription : "zone"
  DeliveryDate ||..o{ Order : "deliveryDate"
  DeliveryDate ||..o{ SubscriptionCycle : "deliveryDate"
  Address ||..o{ Subscription : "address"
  BoxTier ||..o{ Subscription : "tier"
  Product ||..o{ OrderLine : "product"
  Product ||..o{ CycleItem : "product"
  ProductLot |o..o{ CycleItem : "lot"
  Order ||..o{ Consent : "consents"

  %% F2b iç ilişkileri
  Order ||..o{ OrderLine : "lines"
  Order ||..o{ Payment : "payments"
  Payment ||..o{ Refund : "refunds"
  PaymentMethod |o..o{ Payment : "paymentMethod"
  PaymentMethod |o..o{ Subscription : "paymentMethod"
  Subscription ||..o{ SubscriptionCycle : "cycles"
  Subscription ||..o{ Order : "orders"
  Subscription ||..o{ SubscriptionEvent : "events"
  Subscription ||..o{ SubscriptionCancellation : "cancellations"
  SubscriptionCycle ||..o{ CycleItem : "items"
  SubscriptionCycle |o..o| Order : "order / deltaOrder"

  Order {
    string id PK
    int orderNo UK "raw: RESTART 1001"
    enum kind "OrderKind"
    enum status "OrderStatus"
    jsonb addressSnapshot
    decimal grandTotal
  }
  Subscription {
    string id PK
    boolean isOneTime
    enum status "SubscriptionStatus"
    int frequencyWeeks
    jsonb itemPrefs
    enum chargeStrategy "ChargeStrategy"
  }
  SubscriptionCycle {
    string id PK
    int cycleNo "UK(subscriptionId,cycleNo)"
    enum status "CycleStatus"
    decimal total
  }
  CycleItem {
    string id PK
    enum source "CycleItemSource"
    decimal qty
  }
  Payment {
    string id PK
    string conversationId UK
    enum status "PaymentStatus"
    string linkToken UK
  }
  WebhookEvent {
    string id PK
    enum provider "PaymentProvider"
    enum status "WebhookStatus"
  }
  Cart {
    string id PK
    string userId UK
    jsonb items
  }
```

## Doğrulama (lokal, 2026-08-20)

- `pnpm db:validate` ✓ · `prisma format` temiz ✓ · `pnpm db:status` → "Database schema is up to date!" ✓
- `psql`: 23 tablo, `citext` 1.8 kurulu, `users.email` tipi `citext`, `addresses_one_default` kısmi benzersiz indeks mevcut, 41 `timestamptz` kolon / 0 `timestamp` kolon ✓
- Migration SQL'lerinde PG 14 dışı sözdizimi yok (jsonb, citext, text[], kısmi indeks, enum — hepsi PG 14'te var) ✓
- `GET /api/v1/health` → `{"status":"ok","db":"up",…}` ✓
