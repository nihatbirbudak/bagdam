> **Uyanış Akademi referansı (sunucunun canlı konvansiyonu)** — Bu dosya 2026-08-20 tarihli çok ajanlı araştırmanın ham çıktısıdır (Faz 1 — ajan C). Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

# Uyanış Akademi Referans Analizi → Bağdam Backend Kalıpları

> Kaynak kök: `<Projeler>/www.uyanisakademi.com.tr` (aşağıda `UA/` kısaltması). Tüm bulgular dosya okumasına dayanır; doğrulanamayanlar **DOĞRULANMADI** ile işaretlidir.
> Varsayım: Bağdam fiziksel ürün satan bir e-ticaret projesidir (eğitim/seans/etkinlik yok) — **DOĞRULANMADI**, görev tanımından çıkarıldı.

---

## 1. Mimari ve Konvansiyon Özeti

### 1.1 Repo düzeni (UA/ARCHITECTURE.md, pnpm-workspace.yaml, turbo.json, package.json)

```
/ (repo kökü)
├── apps/web        @uyanisakademi/web    React 19 + Vite 6 + Tailwind 4 + react-router 7   dev :3000
├── apps/admin      @uyanisakademi/admin  aynı yığın + vitest + tiptap + dnd-kit + recharts   dev :3001
├── apps/api        @uyanisakademi/api    NestJS 11 + Prisma 6 + Passport-JWT                 dev :4000, prod :5000 (PM2)
├── apps/uyanis-seansi-web                ek subdomain uygulaması (Bağdam için gereksiz)
├── packages/shared @uyanisakademi/shared tip + sözleşme paketi (types: src/index.ts, main: dist/index.js)
├── database/
│   ├── schema.prisma   (generator output = ../node_modules/.prisma/client; 92 model, 49 enum, 2893 satır)
│   ├── migrations/     (89 migration; ilk 20260404134703_init)
│   ├── seeds/          seed.ts + seed-rbac/settings/email-templates/sms-templates/cargo/testimonials/tr-address/…
│   └── scripts/        tek-seferlik ops scriptleri (iade, fatura, telafi)
├── docs/               ARCHITECTURE, flows/ (spec'ler), api/, admin/, audit/, arsiv/, …
├── deploy.sh, ecosystem.config.js, .github/workflows/deploy.yml
└── package.json  packageManager pnpm@9.15.4; root dep: @prisma/client 6.19.2 + prisma 6.19.2 + bcrypt; pnpm.overrides typescript ~5.8.2
```

- `pnpm-workspace.yaml`: `apps/*`, `packages/*`. `turbo.json`: `build` → `dependsOn ^build`, `outputs dist/**`; `dev` persistent.
- Root `predev` script: 5433 portu kapalıysa `ssh -fN uyanisakademi` ile SSH tüneli açar (tek DB kuralının otomasyonu).
- Root scriptleri: `dev`, `dev:web|admin|api`, `build`, `type-check`, `test:api`, `test:e2e` (Playwright), `prisma.seed = npx tsx database/seeds/seed.ts`.
- Geliştirme kuralları (ARCHITECTURE §Geliştirme Kuralları): yeni admin sayfası → `apps/admin/src/pages/` + router; yeni endpoint → `modules/<m>/` controller+service+DTO; paylaşılan tip → `packages/shared/src/types/`; şema değişikliği → `prisma migrate dev`; web↔admin doğrudan import YASAK.

### 1.2 Build / deploy zinciri

| Adım | Kaynak | İçerik |
|---|---|---|
| Tetik | `.github/workflows/deploy.yml` | push `master` (paths-ignore docs/**, **.md) + workflow_dispatch; `appleboy/ssh-action@v1`, secrets `SERVER_HOST/SERVER_PORT/SERVER_SSH_KEY`, `script: bash /opt/uyanisakademi/deploy.sh`; 1. deneme `continue-on-error`, başarısızsa 2. deneme (SSH "dial tcp i/o timeout" nedeniyle) |
| deploy.sh | `UA/deploy.sh` | `set -e`; `export $(grep DATABASE_URL apps/api/.env)`; `git fetch && git reset --hard origin/master`; `pnpm install --frozen-lockfile`; pnpm hoisted `.prisma/client` cache temizliği + `npx prisma generate --schema=database/schema.prisma` + generate çıktısını `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/` içine kopyalama (pnpm çift-resolution hack'i); `npx prisma migrate deploy`; API build `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @uyanisakademi/api build` (önce `tsconfig.tsbuildinfo` silinir); `pnpm --filter web build`, `--filter admin build`; `pm2 reload ecosystem.config.js --update-env` |
| PM2 | `UA/ecosystem.config.js` | `name uyanisakademi-api`, `cwd /opt/uyanisakademi/apps/api`, `script dist/main.js`, `instances 2, exec_mode cluster`, `env {NODE_ENV:'production', PORT:5000}`, `env_file apps/api/.env`, `max_memory_restart 512M`, `min_uptime 30s`, `max_restarts 20`, `restart_delay 2000`, `kill_timeout 8000`, `listen_timeout 15000`, log `/opt/uyanisakademi/logs/api-{error,out}.log`, `merge_logs true` |
| nginx | deployment-plani.md | web/admin `dist` statik, api → proxy :5000; Cloudflare Full(Strict) |

Dikkat: `deploy.sh` migrate'i build'den ÖNCE çalıştırır ve rollback/ön-yedek yoktur (audit F-INFRA-16 — bkz. §6).

### 1.3 API bootstrap kalıbı (UA/apps/api/src/main.ts + app.module.ts)

- `dotenv`: önce `apps/api/.env`, sonra root `.env`.
- `BigInt.prototype.toJSON`; `sharp.cache(false)`, `sharp.concurrency(1)`.
- `validateEnv()` (config/env-validator.ts) → NestFactory'den önce fail-fast.
- `uncaughtException`/`unhandledRejection` → SystemLog'a yaz + tek paylaşımlı PrismaClient + `process.exit(1)`.
- `NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })`; `app.set('trust proxy', 1)`; `RequestIdMiddleware` (X-Request-Id + AsyncLocalStorage `RequestContext`); body limit 1mb json/urlencoded; `helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false, crossOriginResourcePolicy:false})`; `compression()`; `cookieParser()`; `setGlobalPrefix('api')`.
- CORS: origin fonksiyonu — origin yoksa izin; `localhost|127.0.0.1|0.0.0.0` ve özel ağ IP regex'i; `WEB_URL/ADMIN_URL/SEANS_URL` + sabit prod domainleri; `credentials:true`.
- `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`; `AllExceptionsFilter(systemLogs)`; `enableShutdownHooks()`; `listen(PORT ?? 4000, HOST ?? '0.0.0.0')`.
- `app.module.ts`: `CacheModule.register({isGlobal, ttl 5dk, max 500})`; `ScheduleModule.forRoot()` yalnızca `NODE_APP_INSTANCE` yok/`'0'` ise (PM2 cluster cron kilidi); `ThrottlerModule 100 istek/dk/IP`; global guard sırası `ThrottlerGuard → JwtAuthGuard → CsrfGuard → RolesGuard`; interceptor `TimeoutInterceptor (30 s, @SkipTimeout)` + `RequestLoggerInterceptor`.

### 1.4 Ortam değişkenleri

| Değişken | Zorunluluk | Kaynak |
|---|---|---|
| `DATABASE_URL` (≥10), `JWT_SECRET` (≥32), `NODE_ENV` | zorunlu (fail-fast) | env-validator.ts |
| `JWT_REFRESH_SECRET`, `SETTINGS_ENCRYPTION_KEY` (32 byte hex), `ENCRYPTION_KEY` (32 byte hex), `WEB_URL`, `ADMIN_URL`, `SEANS_URL` | prod'da uyarı | env-validator.ts |
| `JWT_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d), `PORT`, `HOST`, `COOKIE_DOMAIN` | opsiyonel | jwt.config.ts, cookie.config.ts |
| `DISABLE_MAIL`, `MAIL_DENYLIST_DOMAINS` | dev/test | mail.service.ts |
| `PAYMENT_PROVIDER` (PAYTR), `PAYTR_*`, `PAYTR_CALLBACK_ALLOWED_IPS` | ödeme | .env.example, gateway.factory.ts |
| `VITE_API_URL` | web/admin build | lib/api.ts (yoksa hostname'e göre türetir) |
| Weak-default kontrolü: prod'da `JWT_SECRET` ∈ {`dev-secret-uyanisakademi-2026`, `change-me`, …} → bootstrap fail | | env-validator.ts |

Not: SMTP, PayTR, R2, Zoom, NetGSM gibi entegrasyon kimlik bilgileri env'de değil, **DB `site_settings` tablosunda şifreli** tutulur (§3.2). `database.config.ts` hâlâ MySQL port 3306 default'u taşır — kullanılmayan kalıntı.

### 1.5 Port / servis (Bağdam'a projeksiyon)

- UA dokümanları Hetzner `<ESKI_SUNUCU_IP>:<ESKI_SSH_PORT>` anlatır; görevde verilen sunucu gerçekleri `<SUNUCU_HOST> (<SUNUCU_IP>:<SSH_PORT>)` — iki kaynak çelişiyor, görev bilgileri esas alındı (hangi dokümanın güncel olduğu **DOĞRULANMADI**).
- Bağdam için: `/opt/bagdam/` (pnpm monorepo), `bagdam-api` PM2 → `127.0.0.1:5010`, web/admin dist nginx statik, uploads `/opt/bagdam/apps/api/uploads`, env `/opt/bagdam/apps/api/.env`, yedek `/opt/birbudak/backups/bagdam/` (mevcut `backup-<proje>.sh` kalıbı), health-check cron'una `:5010/api/health` eklenecek.

---

## 2. Prisma Şema Kalıpları

### 2.1 Tam model / enum envanteri (UA/database/schema.prisma)

**Modeller (92):** User, Role, Permission, RolePermission, UserRoleAssignment, UserAddress, Category, Instructor, Product, ProductCategory, ProductImage, ProductSpec, TrainingDetail, TrainingContent, Cohort, CurriculumSection, CurriculumLesson, Enrollment, CertificateSeries, CertificateBatch, CertificateRecord, LessonProgress, ZoomRecording, SessionDetail, SessionContent, EventDetail, EventRegistration, SessionSlot, Appointment, WorkingHoursConfig, ClosedPeriod, Order, OrderLine, Payment, PaymentInstallment, TransferNotification, HavaleFaturaTalebi, Coupon, GiftCard, OrderDiscount, CargoIntegration, ShippingOption, ShippingRate, Shipment, ShipmentEvent, Invoice, InvoiceLine, ReturnRequest, ReturnLine, CancelRequest, RefundRecord, OrderNote, OrderEvent, ChangeNotificationLog, MediaFolder, MediaFile, SiteSetting, BlogPost, FaqItem, SitePage, Testimonial, Ticket, TicketReply, BulkEmail, EmailSubscriber, SmsTemplate, SmsLog, MailLog, Cart, AuditLog, NotificationPreference, CronLog, SystemLog, Incident, EmailTemplate, TrCity, TrDistrict, TrNeighborhood, AiChatConversation, AiChatMessage, AiChatEmbedding, AiChatDocument, AileDizimiSession, AileDizimiMessage, AileDizimiState, AileDizimiFunnelEvent, SessionFeedback, AileDizimiPackage, AileDizimiCredit, IapTransaction, AileDizimiReferral, AileDizimiDailyMetric.

**Enum'lar (49):** ProductType, ProductStatus, SessionFormat, ScheduleType, CohortStatus, LessonType, SlotStatus, AppointmentStatus, AppointmentProvisionStatus, EnrollmentStatus, RegistrationStatus, EnrollmentType, CertificateSource, CertificateStatus, UserRole, Gender, AddressUsage, AddressParty, ContentType, OrderStatus, PaymentStatus, PaymentMethod, OrderSource, PackingStatus, CartItemKind, InstallmentStatus, TransferStatus, ShipmentStatus, CargoProviderKey, ShippingCalcMethod, InvoiceType, InvoiceStatus, RefundStatus, ReturnStatus, OrderLineStatus, CancelRequestStatus, DiscountType, GiftCardStatus, CertificateBatchStatus, HavaleFaturaTalebiStatus, ContentStatus, TicketStatus, TicketPriority, EmailStatus, AiChatConversationStatus, AiChatMessageRole, AileDizimiSessionStatus, AileDizimiRole, SessionFeedbackKind.

### 2.2 Genel konvansiyonlar (Bağdam'da aynen uygulanmalı)

- `id String @id @default(cuid())`; tablolar `@@map("snake_case")`; `createdAt @default(now())`, `updatedAt @updatedAt`; soft delete `deletedAt DateTime?` (User, Product, Order).
- Para `Decimal @db.Decimal(12,2)` (kargo/desi `Decimal(8,2)`/`(10,2)`); KDV `Int vatRate` + `Boolean vatIncluded`.
- `@db.VarChar(n)` sınırları her string'de; `@db.Citext` e-posta/kupon/hediye kart kodu (case-insensitive unique; migration öncesi duplicate precheck workflow'u var: `.github/workflows/precheck-citext.yml`).
- Enum değerleri UPPERCASE; FE'de lowercase'e çevrilir (`apps/admin/src/lib/apiTypes.ts statusToFront/Back`).
- FK'lerde `onDelete: Cascade` (child satır) / `SetNull` (referans); her FK ve status için `@@index`.
- Snapshot alanları JSON (`Order.deliveryAddress Json?`, `OrderLine.metadata Json?`, `Cart.items Json`).
- Sıralama `sortOrder Int @default(0)`; ağaç yapıları self-relation (`Category "CategoryTree"`, `Permission "PermTree"`, `MediaFolder "FolderTree"`).

### 2.3 Bağdam'a doğrudan uyarlanabilir modeller (kısaltılmış alanlarla)

| Model | Temel alanlar (UA'dan) | Bağdam notu |
|---|---|---|
| **User** | `email Citext @unique`, `passwordHash`, `firstName/lastName`, `role UserRole(CUSTOMER/ADMIN/EDITOR)`, `phone`, `avatarUrl`, `birthDate`, `gender`, `country/city/district`, `emailVerified + emailVerificationToken/Expiry`, `isActive`, `lastLoginAt`, `refreshToken` (bcrypt hash), `passwordResetToken/Expiry`, `newsletterOptIn/At`, `twoFactorSecret/Enabled/BackupCodes`, `failedLoginAttempts`, `lockedUntil`, `totpAttempts/totpLockedUntil`, `deletedAt` | Aile Dizimi alanlarını (`firstAileDizimiPurchaseAt`, `aileDizimiDemoUsedAt`, `aileDizimiLifetime*`, `usedLaunchTier`, `aileDizimi*Consent*`, `referralCode`) ve ilişkilerini sil. Kopyala. |
| **Role / Permission / RolePermission / UserRoleAssignment** | Role: `name @unique, description, isSystem`; Permission: `module, action, label, parentId(tree), sortOrder, @@unique([module,action])`; pivotlar composite id | API'de yalnızca `User.role` enum'u enforce ediliyor (RolesGuard); permission tabloları sadece `roles.service.ts` tarafından yönetiliyor, guard yok. Bağdam: ya gerçek PermissionsGuard yaz ya da V1'de bu 4 tabloyu atla, sadece `UserRole` enum'u kullan. |
| **UserAddress** | `usage(DELIVERY/INVOICE/BOTH)`, `title, fullName, phone, line1, country, city, district, directions, doorNo, postalCode`, `party(INDIVIDUAL/CORPORATE)`, `tcNo, companyName, taxOffice, taxNo, notTurkishCitizen`, `isDefault` | Aynen. TR adres referansı `TrCity/TrDistrict/TrNeighborhood` (+ `seed-tr-address.ts`, `address-ref` modülü) ile birlikte al. |
| **Category** | `parentId(tree)`, `name, slug @unique, sortOrder, isSystem, status ProductStatus` | Aynen. |
| **Instructor → Brand** | `name, slug, logoUrl, shortDesc, status` | Adı `Brand` yap (UA'da zaten admin rotası `urunler/markalar`). |
| **Product** | Tanım: `sku @unique, barcode, gtin, name, slug @unique, brandId, supplierName, breadcrumbCategoryId`; Fiyat: `vatIncluded, vatRate, purchasePrice, marketPrice, salePrice, discountedPrice, discountPercent, discountStart/End, discountForever, currency, unit`; Stok: `stock, minQuantity, maxQuantity, defaultQuantity, quantityStep, stockWarning, maxInstallments, installmentLock`; Kargo: `desi1, weightKg, widthCm, depthCm, heightCm, fixedShippingPrice, freeShipping`; Metin: `preText, description, highlights Json, customSections Json, searchKeywords`; SEO: `seoTitle/Keywords/Description, seoNoIndex/NoFollow`; Bayrak: `showInListing, showInShowcase, isOpportunity, isNew, codBanned, returnBanned, returnPolicyDays, estimatedDeliveryShow`; `countryOfOrigin, taxExemptionCode, productLabel`; `status, deletedAt` | `productType` enum'u ve TRAINING/SESSION/EVENT ilişkilerini, `capacity`, `introMedia`, `desi2`/`freeShippingAllCart` (deprecated) alanlarını çıkar. Varyant modeli UA'da YOK (`OrderLine.variant String?` sadece snapshot) — Bağdam varyant istiyorsa `ProductVariant` eklenmeli. |
| **ProductCategory / ProductImage / ProductSpec** | pivot; `url, alt, sortOrder`; `label, value, sortOrder` | Aynen. |
| **Cart** | `userId @unique, items Json, coupon Json?, giftCard Json?, updatedAt` | Aynen (misafir sepeti localStorage, üye sepeti DB — A1 §2). |
| **Order** | `orderNo @unique`, `userId?`, `customerName/Email/Phone` (denormalize), `source(WEB/STORE/PHONE/MANUAL_TRANSFER)`, `status OrderStatus`, `packingStatus`, `paymentMethod(CARD/TRANSFER/CASH)`, tutarlar `subtotal, vatTotal, shippingCost, discountTotal, grandTotal, currency`, `deliveryAddress Json?, invoiceAddress Json?`, `note, adminNote`, `fulfillmentError`, `deliveredAt`, sözleşme `preContractAccepted, distanceSalesAccepted, agreementAcceptedAt, agreementIp`, `ipAddress, userAgent`, `deletedAt` | `appointments/eventRegistrations/enrollments/havaleFaturaTalebi` ilişkilerini sil. |
| **OrderLine** | `productId?, sku, name, variant?, kind CartItemKind, status OrderLineStatus, qty, unitPrice(KDV hariç), lineTotal(KDV hariç), vatRate, vatAmount, metadata Json?` | `CartItemKind`'ı `PHYSICAL` (+ gerekiyorsa `DIGITAL`) olarak daralt. |
| **Payment / PaymentInstallment / TransferNotification** | Payment: `method, status PaymentStatus, amount, paidAt, gatewayRef, gatewayResponse Json, installmentCount, refundedAmount, adminFlag/Note/SetBy/SetAt`; partial unique index `payments_gatewayRef_paid_unique WHERE status='PAID'` (raw migration); Transfer: `senderName, referenceNote, transferDate, amount, status, receivedAt` | Aynen (PayTR devam edecekse). |
| **Coupon / GiftCard / OrderDiscount** | Coupon: `code Citext @unique, discountType(PERCENTAGE/FIXED_AMOUNT/FREE_SHIPPING), discountValue, minOrderAmount, maxUsageCount, usedCount, validFrom/Until, isActive, applicableProductSkus String[], scope`; GiftCard: `code, initialBalance, currentBalance, status, expiresAt, issuedToUserId`; OrderDiscount: `couponId?, giftCardId?, discountType, appliedAmount` | `scope` (aile_dizimi) kaldırılabilir. |
| **CargoIntegration / ShippingOption / ShippingRate / Shipment / ShipmentEvent** | Integration: `name, slug, providerKey(MANUAL/YURTICI_KARGO), active, isDefault, sortOrder, sender*/collect* credentials`; Option: `name, description, active, sortOrder, calculationMethod(FLAT_RATE/DESI_BAND), price, freeShippingThreshold, cargoIntegrationId`; Rate: `minDesi, maxDesi, price`; Shipment: `carrier, trackingNo, trackingUrl, status, shippedAt, estimatedDelivery, deliveredAt, carrierBarcodeRef @unique, cargoKey, docId, docNumber, jobId, barcodeData, labelZpl`; Event: `label, eventDate, location` | Deprecated alanları (`collectCustomerCode, cargoCompany, taxNumber, companyTitle, autoCheck*`) alma. Kargo firması değişirse provider enum'u güncelle. |
| **Invoice / InvoiceLine** | `invoiceNo @unique, uuid, gibInvoiceNo, type(E_FATURA/E_ARSIV), typeCode, status, amount, taxAmount, xmlUrl, pdfUrl, issuedAt, cancelledAt, relatedInvoiceId(iade), retryCount, provider, rawResponse`; Line: `orderLineId?, name, qty, unitPrice, vatRate, vatAmount, lineTotal` | e-Fatura planı varsa aynen; yoksa erteleyip `Invoice` iskeletini tut. |
| **ReturnRequest / ReturnLine / CancelRequest / RefundRecord** | standart alanlar (`status, reason, description, adminNote, returnTrackingCode/Carrier`; `amount, method, status, externalRef`) | Aynen. |
| **OrderNote / OrderEvent** | Note: `adminId, text`; Event: `eventType VarChar(50), description, actorId, metadata Json` | Aynen — durum makinesi ve idempotency (`FULFILLED`, `STOCK_RESTORED`) bunlara dayanır. |
| **MediaFolder / MediaFile** | Folder: `name, slug, parentId, @@unique([parentId, slug])`; File: `name, originalName, mimeType, size, path, folderId, width, height, thumbnailPath, alt` | Aynen. |
| **SiteSetting** | `group VarChar(50), key @unique VarChar(100), value Json` (`key = "group.field"`) | Aynen. |
| **BlogPost / FaqItem / SitePage / Testimonial** | Blog: `title, slug, excerpt, body, coverImage, category, authorId, status ContentStatus, publishedAt, seoTitle/Desc`; Faq: `question, answer, category, sortOrder, status`; Page: `slug, title, body, status`; Testimonial: `authorName, authorPhoto, text, rating, isActive, sortOrder, source, externalId, googleMapsUri` | Aynen (CMS ihtiyacına göre). |
| **Ticket / TicketReply** | `subject, message, status, priority, guestName/Email/Phone, memberId, assigneeId, closedAt` | İletişim formu + destek için. |
| **EmailTemplate / SmsTemplate / MailLog / SmsLog / EmailSubscriber / BulkEmail** | EmailTemplate: `slug @unique, category, name, subject, bodyHtml, variables Json, emoji, title, isActive`; MailLog: `to, subject, status, error, slug, entityId, category, messageId, @@unique([slug, entityId])` | Aynen; SMS yoksa SmsTemplate/SmsLog atla. |
| **AuditLog / SystemLog / CronLog / Incident / NotificationPreference** | AuditLog: `actorId, actorEmail, action, module, entityId, entityName, summary, oldValues/newValues Json, success, requestId, note, ipAddress, userAgent, metadata`; SystemLog: `level, module, action, requestId, userId, actorType, entityType/Id, status, errorCode, message, metadata, durationMs, ip, ua, fingerprint, occurrenceCount, firstSeenAt, lastSeenAt`; CronLog: `schedulerName, status, itemsProcessed, errors, details, startedAt, finishedAt, durationMs` | Aynen — admin "Sistem" sayfaları bunlara bağlı. |

### 2.4 Bağdam'da GEREKSİZ olanlar

- Eğitim: `TrainingDetail, TrainingContent, Cohort, CurriculumSection, CurriculumLesson, Enrollment, LessonProgress, CertificateSeries/Batch/Record, ZoomRecording` + enum `CohortStatus, LessonType, EnrollmentStatus, EnrollmentType, CertificateSource/Status/BatchStatus, ContentType`.
- Seans/Etkinlik: `SessionDetail, SessionContent, SessionSlot, Appointment, WorkingHoursConfig, ClosedPeriod, EventDetail, EventRegistration` + `SessionFormat, ScheduleType, SlotStatus, AppointmentStatus, AppointmentProvisionStatus, RegistrationStatus`.
- AI/Aile Dizimi: `AiChat*`, `AileDizimi*`, `SessionFeedback`, `IapTransaction` + ilgili enum'lar; `User` ve `Product`/`OrderLine`/`Coupon` içindeki aile dizimi alan/ilişkileri.
- Muhtemelen gereksiz: `HavaleFaturaTalebi` (web-dışı havale→fatura akışı), `ChangeNotificationLog` (etkinlik/eğitim değişiklik bildirimi), `PaymentInstallment` (PayTR taksit tablosu; gerekirse tut).
- `ProductType` enum'u: tek tip kalıyorsa kaldır ya da ileriye dönük `PHYSICAL | DIGITAL` bırak; `CartItemKind` → `PHYSICAL`.

---

## 3. NestJS Modül Kalıpları

Kök: `UA/apps/api/src/`. Modül listesi (`modules/`): address-ref, ai-chat, aile-dizimi, audit, auth, cart, categories, certificates, cohorts, content, coupons, dashboard, drive, email-templates, enrollments, events, gift-cards, havale-fatura-talebi, health, homepage, instructors, invoice, media, members, messaging, meta-capi, orders, payment, pricing, products, session-slots, sessions, settings, shipping, sitemap, sms-templates, storage, system-logs, testimonials, trainings, users, videos, zoom.

| Alan | Dosyalar | Ne yapıyor | Bağdam'a taşıma |
|---|---|---|---|
| **Ortak altyapı** | `common/prisma.service.ts`, `prisma.module.ts` (@Global), `filters/all-exceptions.filter.ts`, `middleware/request-id.middleware.ts`, `request-context.ts` (AsyncLocalStorage), `interceptors/{timeout,request-logger,audit-log}.interceptor.ts`, `decorators/{public,roles,current-user,audit,skip-timeout}.decorator.ts`, `dto/pagination-query.dto.ts`, `crypto.util.ts`, `search.util.ts`, `validators/tc-kimlik.validator.ts` | Exception filter Prisma hatalarını (P2002→409, P2025→404, Validation→400, Init→503) sızıntısız mesaja çevirir ve 4xx/5xx'i SystemLog'a yazar (401/403 ve DTO 400 hariç). Audit interceptor `@Audited('modul')` + POST/PATCH/PUT/DELETE'te AuditLog yazar, `setAuditContext(req, old, new)` ile diff alır, hassas alanları redakte eder. | **Kopyala** (sadece `inferModule` haritasını Bağdam modüllerine göre güncelle). |
| **Auth** | `modules/auth/{auth.module,auth.controller,auth.service,jwt.strategy}.ts`, `dto/auth.dto.ts`, `config/jwt.config.ts`, `config/cookie.config.ts`, `common/guards/{jwt-auth,roles,csrf}.guard.ts` | JwtModule.register secret/expiresIn (15m); JwtStrategy cookie `access_token` → fallback Bearer; `validate()` DB'den `isActive/deletedAt` kontrolü; refresh token `User.refreshToken` bcrypt hash + `$transaction` rotasyon; login: kilit (5 hata → 30 dk), 2FA ise `tempToken {purpose:'2fa'} 5m`; `setAuthCookies` httpOnly/secure/sameSite lax/`COOKIE_DOMAIN`; `GET /auth/csrf` double-submit cookie; CsrfGuard Bearer'lı istekleri muaf tutar; uçlar: register/login/refresh/forgot/reset/verify-email/resend/me/logout/csrf/me(PATCH)/me/password/me(DELETE)/me/addresses CRUD/2fa setup-verify-disable-status/notification-preferences; endpoint bazlı `@Throttle` (login 5/dk, register 5/dk, forgot 3/dk, refresh 30/dk, 2FA 5/dk). | **Uyarla**: kopyala; `COOKIE_DOMAIN` → `.bagdam.com`; audit önerisi olan `purpose` claim kontrolünü `jwt.strategy.validate` içine ekle (P0-06); admin'i de cookie tabanlı yapmayı değerlendir (P0-07). `RolesGuard` sadece `user.role` enum'una bakar. |
| **Env doğrulama** | `config/env-validator.ts` | REQUIRED/RECOMMENDED listeleri, minLength, weak-default reddi; `main.ts` başında çağrılır. | **Kopyala**, listeyi Bağdam env'ine göre düzenle. |
| **Settings** | `modules/settings/{settings.controller,settings.service,settings.module}.ts`, `dto/upsert-settings-group.dto.ts`, `common/crypto.util.ts` | `SiteSetting{group,key,value}`; `SENSITIVE_KEYS` açık liste (suffix heuristiği yok), mask `••••••••`; PUT'ta maskeli/boş hassas alan atlanır, yeni değer `encryptValue()` (AES-256-GCM `iv:tag:ct` hex, anahtar `SETTINGS_ENCRYPTION_KEY`); `findByGroupRaw()` iç servisler için decrypt; `fullyDecrypt()` çift şifreleme düzeltmesi; `PUBLIC_ALLOWED_GROUPS` default-deny public `GET /settings` (`CacheInterceptor 5 dk` + `Cache-Control`); PUT sonrası cache `del` + `StorageService.refreshConfig()`; `POST /settings/mail/test`. `seed-settings.ts` grup/anahtar kataloğu. | **Kopyala**. Dikkat: `encryptValue` anahtar yoksa **plaintext** yazar — Bağdam'da anahtarı zorunlu yap (env-validator REQUIRED'a taşı). Cache cluster'da paylaşılmaz (§6). |
| **Media** | `modules/media/{media.controller,media.service,media.module}.ts`, `dto/*` | Disk: `process.cwd()/uploads/media/<folderPath>/`; Multer memoryStorage `fileSize 25MB` + mimetype whitelist; sharp → WebP (max 2048, q82) + 300px thumb (q70), `limitInputPixels 100M`; `MediaFile{path,thumbnailPath,width,height}`; klasör ağacı, rename/move, bulk-delete/move, usages; `GET /media/serve/*path` public, path-traversal guard, `Cache-Control immutable`; admin rolleri `ADMIN, EDITOR`. R2/video modülleri (`storage`, `videos`) ayrı. | **Kopyala** (R2/video kısmını alma). nginx'te `client_max_body_size` (media 100M) ile uyumlu. Yedekler `uploads` tar'ına girer. |
| **Orders** | `modules/orders/{orders.controller,orders.service(2952 satır),order-status-transitions,order-timeout.scheduler,fulfillment-retry.scheduler,order-daily-summary.scheduler,orders-pdf.service}.ts`, `dto/*` | `ORDER_STATUS_ALLOWED_TRANSITIONS` tek kaynak (PENDING→AWAITING_PAYMENT/CANCELLED; AWAITING_PAYMENT→PENDING/CANCELLED; CONFIRMED→PROCESSING/CANCELLED; PROCESSING→SHIPPED/DELIVERED/CANCELLED; SHIPPED→DELIVERED/PROCESSING; DELIVERED/CANCELLED/RETURNED terminal). `updateStatus(id,status,req,{force,reason})`: force için Tier1/Tier2 set'leri + uyarılar, `$transaction([order.update, orderEvent.create])`, SystemLog, mail+SMS fire-and-forget (force'ta gönderilmez), CANCELLED side-effect'leri (`restoreDiscountsOnCancel`, `restoreStockOnCancel`, `cancelPreparingShipmentsOnCancel`, `reverseFulfillment`). `fulfillOrder` `PaymentService` içinde (`modules/payment/payment.service.ts:2865`): `FULFILLED` OrderEvent idempotency guard, satır bazlı try/catch, kısmi başarısızlıkta event yazılmaz, `fulfillment-retry.scheduler` 3 deneme. İade/iptal/not/satır düzenleme/CSV export/PDF uçları. | **Uyarla**: transitions + updateStatus + OrderEvent/OrderNote + cancel side-effect'leri + timeout scheduler kopyala; `fulfillOrder`'ı dijital ürün yoksa stok/kupon/mail ile sınırlı minimal sürüme indir (enrollment/appointment/aile dizimi dallarını sil). |
| **Pricing (P1)** | `modules/pricing/{pricing.module,pricing.service,pricing.types}.ts`, `common/shipping-config.util.ts` | `calculatePricing(items,{couponCode,giftCardCode,userId,strict})` 7 adım (price resolution → line calc → subtotals → coupon → shipping → gift card → grand total); `r2()` ROUND_HALF_UP satır bazında; KDV dahil/hariç formülleri; kargo KDV %20 sabit; `resolveShippingConfig`: ShippingOption → SiteSetting `siparis.kargoUcreti/ucretsizKargoLimiti` → 0₺ fallback; `PricingResult` snapshot alanları Order/OrderLine'a birebir. A1 `/cart/summary` ve A2 checkout aynı servisi kullanır; client hesaplamaz. | **Kopyala** (cohort fiyat çözümlemesi ve `SEANS_ONLY_COUPON_SCOPES` dalını sil). |
| **Mail** | `common/mail.module.ts` (@Global), `common/mail.service.ts` (1677 satır), `modules/email-templates/*`, `common/contract-pdf.service.ts`, `database/seeds/seed-email-templates.ts` | SMTP ayarları her gönderimde DB `mail.*` grubundan (şifre decrypt); nodemailer pooled transporter cache (config hash), timeout'lar; `sendMail(to,subject,html,attachments?,{slug,entityId,category})` → `MailLog @@unique([slug,entityId])` idempotency, `DISABLE_MAIL=true` dry-run, `MAIL_DENYLIST_DOMAINS` + `.internal` engeli, 2 deneme backoff; `EmailTemplatesService.render(slug, vars)` Handlebars compile (cache) → `wrapWithLayout(title, emoji, body, {logoUrl, storeName, …})`; DB şablonu yoksa koddaki fallback; `buildUnsubscribeUrl` HMAC. 40+ `sendXxxMail` metodu. | **Uyarla**: çekirdek (`getSmtpConfig`, `getOrCreateTransporter`, `sendMail`, `wrapWithLayout`, `renderFromDb`) + order/auth mail'lerini al; eğitim/seans/zoom/sertifika mail'lerini sil; marka sabitlerini (`uyanisakademi.com.tr`, Instagram/YouTube linkleri) Bağdam'a çevir veya SiteSetting'ten oku. |
| **Throttling** | `app.module.ts` (ThrottlerModule 100/dk, `APP_GUARD ThrottlerGuard`), route bazlı `@Throttle`, `@SkipThrottle` (health) | Uygulama katmanı; nginx `01-rate-limits.conf` (api 10r/s, login 3r/m, search 2r/s) ikinci katman. `trust proxy 1` olmadan IP yanlış okunur. | **Kopyala**. |
| **Ödeme adaptörü** | `modules/payment/gateways/{payment-gateway.interface,gateway.factory,paytr.adapter}.ts`, `paytr.service.ts`, `guest-checkout-token.service.ts` | `PaymentGateway` interface (createPaymentSession, verifyCallback, parseInstallmentCount, queryStatus, refund, getInstallmentRates) + `PaymentGatewayFactory.getActive()` (`PAYMENT_PROVIDER` env). | Interface + factory **kopyala**; PayTR adaptörü Bağdam da PayTR kullanacaksa uyarla. |
| **Diğer** | `modules/health` (public `/health`, `/health/detailed` alan adı sızdırmaz, admin `/health/detailed/admin`), `modules/audit`, `modules/system-logs` (+ `incident.controller`), `modules/dashboard` (`GET /dashboard/stats`, audit: cache yok 22+ sorgu), `modules/cart` (`POST /cart/summary`, `/validate-item` public; GET/PUT/DELETE üye), `coupons`/`gift-cards` (`POST /validate` public + throttle; CRUD ADMIN), `users` + `roles.controller` (roles/permissions/users/:id/roles), `members` (class-level `@Roles('ADMIN','EDITOR') @Audited`), `categories`/`products` (GET public, mutasyon ADMIN; `/products/slug/:slug`, bulk-status/price/stock/categories), `address-ref`, `sitemap`, `testimonials`, `content` | | Health/audit/system-logs/dashboard/cart/coupons/gift-cards/users/members/categories/products/address-ref/sitemap: **kopyala-uyarla**. |
| **Test altyapısı** | `src/__tests__/{security,business-logic,workflows,webhooks,spec-audit}`, `jest-global-setup.ts` (prod DB guard: `:5433/`, prod IP, prod DB adı → bloke; `ALLOW_PROD_DB_TESTS=true` bypass), `jest.config.ts` | Supertest ile çalışan API'ye HTTP. | Guard'ı Bağdam DB adı/IP'siyle **kopyala**; ayrı test DB (`bagdam_test_db`) ile başla. |

---

## 4. Admin Panel Kalıpları

Kök: `UA/apps/admin/src/` (vite.config: `@` alias, Tailwind plugin, prod'da `console.log/info/debug` drop ama `error/warn` korunur, vitest jsdom).

- **Giriş/Provider:** `AdminApp.tsx` → `AdminErrorBoundary > BrowserRouter > AdminAuthProvider > ConfirmProvider > AdminRouter + Toaster`.
- **Auth:** `contexts/AdminAuthContext.tsx` — localStorage `admin-access-token/refresh/user`, exp kontrolü (30 s tampon), mount'ta `GET /auth/me` ile doğrulama, yalnız `admin|editor` rolü kabul, `login()` 2FA dalı (`requiresTwoFactor/tempToken` → `verify2FA`), `getAdminToken()` global getter. **Refresh akışı yok**: 401'de temizle + `/login`. (Audit P0-07: httpOnly cookie'ye taşınması önerilmiş.)
- **Router:** `app/router.tsx` — `RequireAdminAuth` wrapper (loading → "Yükleniyor…", değilse `/login`), `<Route element={<RequireAdminAuth><AdminLayout/></RequireAdminAuth>}>` altında ~80 rota; eski rotalar için `<Navigate replace>`; `*` → `AdminShellPage` fallback.
- **Layout:** `layouts/AdminLayout.tsx` — `AdminTopBar` + `AdminSidebar` (pin/hover, localStorage `admin-sidebar-pinned`) + `<Outlet/>` + mobil `AdminBottomNav` + `AdminMobileDrawer`. (docs/admin/ortak-yapilar.md hâlâ "AdminNavbar mega menü" diyor — doküman geride.)
- **Menü:** `lib/adminNavConfig.ts` — `AdminNavItem = Leaf | Group{children: Leaf|Divider}`; 10 grup; `lib/adminNavIcons.ts` Lucide eşlemesi. `seed-rbac.ts` permission ağacı bu menüyle 1:1 (sayfa bazlı).
- **API istemcisi:** `lib/api.ts` — `resolveApiBase()` (VITE_API_URL → prod hostname → `:4000/api`), `API_ORIGIN`, `resolveMediaUrl`, `ApiError{status,kind}` sınıflandırması, `request<T>` (Bearer, JSON, 204/boş gövde), 401 (auth dışı) → storage temizle + `/login`; `api.get/post/patch/put/delete/upload(XHR progress)`, `fetchBlob/fetchBlobGet`.
- **Hook'lar:** `hooks/useApi.ts` (`useApi<T>(path|null)` AbortController + refetch; `useMutation(method, path|fn)`), `hooks/useAdminListPanel.ts` (liste + yan panel draft + delete onayı state makinesi).
- **Tip adaptörleri:** `lib/apiTypes.ts` — `ApiCategory → CategoryRow` gibi `apiXToRow/xRowToApi`, `statusToFront/Back` (UPPERCASE↔lowercase). Feature bazlı API dosyaları `features/siparisler/api.ts` (`toQueryString`, `fetchOrders(params)`…), `features/*/mockData.ts` artık yalnızca tip/label/default.
- **Paylaşılan bileşenler** (`features/components/`): AdminToolbar (debounce arama + filtre slotu), AdminScrollTable, AdminStatusBadge, AdminSummaryStrip (KPI), AdminFormAside (sticky footer), AdminTabPanel, AdminFilterPills, AdminEmptyState, AdminConfirmModal, SortableTableHead, InlineActions, BulkActions, ColumnManager, Pagination, MonthCalendar. `components/ui/`: RichTextEditor (tiptap), ToggleSwitch, ConfirmDialog, PromptDialog. `features/medya/MediaPickerModal`. `lib/tableStyles.ts` (`th/td/tdText`), `lib/toast.ts`, `lib/utils.ts` (`cn`, `slugify` TR).
- **Sayfa deseni** (örn. `pages/urunler/AdminUrunlerKategorilerPage.tsx`): `useState(search/filter/loading/saving/error)` + `useAdminListPanel` + `useCallback fetch → api.get → setItems(map adapter)` + `useMemo filtered/summary` + `AdminToolbar/AdminFilterPills/AdminSummaryStrip/AdminScrollTable/AdminFormAside/AdminConfirmModal`. Ayarlar sayfası (`pages/ayarlar/AdminAyarlarPage.tsx`, 758 satır): sekmeli form, `useApi('/settings/admin')`, `PUT /settings/:group`, MediaPicker ile logo/favicon.
- **Yetki:** Yalnız rol düzeyi (ADMIN/EDITOR) — sidebar'da permission bazlı gizleme **DOĞRULANMADI** (AdminSidebar'da "permission" geçmiyor).

**Bağdam admin iskeleti önerisi:** `AdminApp` + `AdminAuthContext` (tercihen cookie + refresh) + `router.tsx` (RequireAdminAuth) + `AdminLayout/TopBar/Sidebar/BottomNav/MobileDrawer` + `adminNavConfig` (Özet, Katalog[Ürünler, Kategoriler, Markalar], Siparişler[Liste, Ödeme Bekleyen, İptal, Havale/EFT, İade], Kargo, Finans[Fatura, Kuponlar, Hediye Kartı], Üyeler, İçerik[Blog, SSS, Yorumlar, Sayfalar], Mesajlaşma[Ticket, Toplu Mail, Şablonlar, Mail Log], Medya, Ayarlar[Genel, Entegrasyonlar, İşlem Geçmişi], Sistem[Sağlık, Hata Günlüğü, Incident]) + `lib/api.ts`, `hooks/*`, `features/components/*`, `lib/apiTypes.ts` birebir kopya; eğitim/operasyon/aile-dizimi/ai-chat sayfaları alınmaz.

---

## 5. Statik → Dinamik Geçiş Dersleri (docs/arsiv + sistem-durumu)

**Sıra (gerçekleşen):**
1. `urunler-dinamiklestirme.md` (9 aşama): Aşama 0 `PrismaService/PrismaModule` + migrate/generate → kategoriler → markalar → fiziksel ürünler → eğitimler → dönem/müfredat → seanslar → slot/randevu → **en son** 8 admin sayfası API'ye → seed + migration. Yani **backend modülleri önce, frontend en son**.
2. `siparisler-dinamiklestirme.md` (18 aşama): Prisma şema (14 model + 14 enum) → `packages/shared/src/types/order.ts` → DTO'lar → OrdersService → Controller → Module → FE `features/siparisler/api.ts` → mockData label/style map'leri UPPERCASE'e → filtreli liste sayfası API tabanlı yeniden yazım (~500 satır → 11 satır wrapper + `defaultParams`) → alt sayfalar → detay modal/sayfa → bildirimler/havale/iade → yeni sipariş → derleme kontrolü → runtime doğrulama.
3. `operasyon-dinamiklestirme.md` (10 aşama): backend (enrollments, certificates, session-slots genişletme) → API build → `apiTypes.ts` genişletme → 4 sayfa tek tek → type-check (0 yeni hata).
4. `admin-dinamiklestirme.md` (13 faz planı): önerilen öncelik **Faz 1 RBAC → Faz 2 Auth (admin+web login) → Faz 10 web ürün sayfaları → Faz 11 sepet/sipariş → dashboard → kargo → üyeler → medya → ayarlar (public endpoint + SiteSettingsContext) → içerik → mesajlaşma → hesabım → ek (kupon, fatura, iletişim)**. `sistem-durumu.md`: 13 faz tamamlandı, Faz 10 "atlandı (UI ekibi aktif)" sonra ayrıca yapıldı.

**Nerede geri dönüldü / ne değişti (kanıt):**
- DB motoru: ilk aşamalar MySQL ("MySQL kurulumu", `database.config.ts` port 3306, `docs/api/README.md` "Prisma 6 (MySQL)") → production PostgreSQL'e geçildi. Ders: sunucuda yalnız PG 14 var, Bağdam baştan PostgreSQL.
- Admin navigasyon: `AdminNavbar` mega-menü → `AdminSidebar + TopBar + BottomNav` (docs geride kaldı).
- Sipariş alt sayfaları konsolide edildi (router'daki `Navigate` redirect'leri: `odeme-kaydi-yok→odeme-bekleyen`, `hatali-odeme→odeme-problemleri`, `telefon-talepleri→telefon-siparisleri`); A3 spec sıfırdan yazıldı (`A3-RESET-ANALIZ.md`, `*.OLD.md`).
- `Brand` → `Instructor` yeniden adlandırıldı ama admin rotası `urunler/markalar` kaldı.
- Kupon/Hediye kartı: envanterde "UI yok" iken sonradan `promosyon/*` eklendi; Ayarlar "karma" (API + mock default) dönemi yaşandı.
- `sections.tsx` 4800 satırlık monolit sonradan bölündü; web `accountMockStore.ts` kaldırıldı.
- Spec disiplini (`docs/flows/*`, "spec = ideal tasarım, kod spec'e uyar") dinamikleştirme SONRASI, ödeme bug'ları sonrası eklendi.
- JWT süreleri docs'ta 7d/30d, kodda 15m/7d; API docs "Settings @Public" derken kod `@Roles('ADMIN')` — dokümanlar kodun gerisinde kaldı.

**Öğrenilen kalıplar:** mockData'yı silme, tip/label/default olarak tut; enum'lar her katmanda UPPERCASE; Prisma Decimal API'den string gelir (`formatTryDecimal` ikisini de kabul eder); pnpm'de `@prisma/client` çift sürüm sorunu (typescript override + deploy.sh cache temizliği); her faz sonunda `tsc --noEmit` (API+web+admin); "API bağlantısı yapıldıktan sonra mockData temizle, 401 → logout, her mutasyon toast + onay modalı" teknik kuralları.

---

## 6. Riskler & Öğrenilmiş Dersler

| Konu | Kanıt | Bağdam kararı/önerisi |
|---|---|---|
| **Tek DB kuralı** (local dev SSH tüneli ile prod DB, `prisma migrate dev` prod'a karşı, `db push` yasak) | copilot-instructions.md; `docs/audit/test-data-isolation-report.md`: her `pnpm test` prod'a yazdı → **163 test siparişi + 1 test ürünü** prod'da; `jest-global-setup.ts` guard'ı sonradan eklendi; `a2/a3/a6/a7` test raporları "Local API → Production DB" ortamında koşuldu | **Artı:** tek şema, drift yok, seed/migration tek yerde, gerçek veriyle test, admin veri değişikliği anında yansır. **Eksi:** test/dev verisi prod'a sızar, yanlış `migrate dev` prod'u bozar, lokal hata prod'u kilitleyebilir, birden fazla geliştirici imkânsız. **Öneri:** Bağdam'da aynı sunucuda `bagdam_db` (prod) + `bagdam_dev_db` (tünel üzerinden dev/test) ikilisi; `migrate dev` yalnız dev DB'ye, prod'a sadece `migrate deploy` (deploy.sh). Jest guard'ını ilk günden ekle. |
| **Secret yönetimi** | Audit FINAL: `JWT_SECRET=dev-secret-uyanisakademi-2026` zayıf; git geçmişinde DB şifresi/PayTR/Gmail app password; `seed.ts` sabit admin şifresi + kişisel e-posta; `encryptValue` anahtar yoksa plaintext yazar; `buildUnsubscribeUrl` fallback secret | Repo PUBLIC → `.env` asla commit; seed admin'i env'den (`SEED_ADMIN_EMAIL/PASSWORD`) veya rastgele üretip bir kez yaz; `SETTINGS_ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET` REQUIRED; `.env.example` yalnız anahtar adları. |
| **Migration disiplini** | deploy.sh migrate→build sırası (F-INFRA-16: "DB ileri, kod geri" riski), rollback/SHA kaydı yok, pre-migrate dump yok; citext migration için ayrı precheck workflow gerekti | Bağdam deploy.sh: build → (pg_dump -Fc) → migrate deploy → pm2 reload; `.last-deploy-sha` kaydet; kırıcı migration'larda dry-run (BEGIN/ROLLBACK) kalıbını kullan. |
| **PM2 cluster** | instances 2; cron yalnız instance 0 (doğru); `max_restarts 20` + fatal handler yeni PrismaClient → connection leak (F-INFRA-05, sonra tek paylaşımlı client ile düzeltildi); pm2-logrotate repo'da yok (sunucuda kurulu) | Bağdam başlangıçta `instances: 1` (yük düşük, 11 GB RAM paylaşımlı) veya 2 + `NODE_APP_INSTANCE` kilidi; `env_file` + `env{NODE_ENV,PORT:5010}`; `kill_timeout 8000`, `enableShutdownHooks`. |
| **DB bağlantı havuzu** | F-INFRA-04: `DATABASE_URL` connection_limit yok; Prisma default cpu*2+1 (8 vCPU → 17/instance); PG `max_connections 100` floovent (3 prod + staging) + uyanisakademi (2 instance) ile paylaşılıyor | `DATABASE_URL=...?connection_limit=5&pool_timeout=20` ile başla. |
| **Cache** | `CacheModule` in-memory, cluster instance'ları arasında paylaşılmaz → settings PUT sonrası diğer instance'ta 5 dk stale; dashboard stats cache yok; sunucuda Redis YOK | Tek instance ise sorun yok; 2 instance ise kısa TTL (60 s) veya settings için her istekte DB (tablo küçük). |
| **Audit log retention** | F-INFRA-08 KRİTİK: LogCleanupScheduler audit_logs'u 90 günde siliyordu (KVKK/finans) | Bağdam: system_logs/cron_logs temizle, audit_logs asla. |
| **RBAC** | Permission tabloları var, API'de enforce yok; members/categories/instructors'ta rol guard'ı eksikti (P0-01, sonra düzeltildi) | Her controller'a class-level `@Roles` + `@Audited`; permission ağacını ya enforce et ya V1'de alma. Admin'de token localStorage'da (XSS riski). |
| **Public endpoint sızıntıları** | Public events/cohorts zoom passcode leak (R6-01), `/health/detailed` alan adı leak (R6-11) | Public select projection'ları açıkça yaz; health public sürüm alan adı vermez. |
| **Prod DB'ye yazan test + prod URL'ye bağlanan subdomain** | `resolveApiBase` `endsWith('uyanisakademi.com.tr')` → staging de prod API'ye | Bağdam `resolveApiBase`: tam hostname eşleşmesi veya build-time `VITE_API_URL` zorunlu. |
| **Dokümantasyon drift'i** | ortak-yapilar/api README/sayfa-envanteri kodun gerisinde; sunucu IP'si eski | Tek "sistem durumu" dosyası + YAPILACAKLAR.md konvansiyonu iyi; her faz sonunda güncelle. |
| **Medya** | Upload'lar `process.cwd()/uploads` → PM2 `cwd apps/api` ile tutarlı; yedek tar'ına giriyor | Aynı; nginx `client_max_body_size` ile Multer limitini eşle. |
| **Mail** | SMTP ayarı DB'de, MailLog idempotency, DISABLE_MAIL; DMARC/DKIM eksikti | Bağdam için ilk günden SPF/DKIM/DMARC; `DISABLE_MAIL=true` dev default. |

---

## 7. Somut Alıntı Adayları (dosya → ne alınır)

**Kök / ops**
- `UA/pnpm-workspace.yaml`, `UA/turbo.json`, `UA/package.json` (scripts + `pnpm.overrides.typescript`, `prisma.seed`) → aynen (paket adları `@bagdam/*`).
- `UA/deploy.sh` → aynen, yollar `/opt/bagdam`, filtreler `@bagdam/api|web|admin`, **migrate'i build'den sonraya al + pg_dump + SHA kaydı ekle**.
- `UA/ecosystem.config.js` → `bagdam-api`, `PORT 5010`, `instances 1`, log `/opt/bagdam/logs/`.
- `UA/.github/workflows/deploy.yml` → branch `main`, script `bash /opt/bagdam/deploy.sh`; `precheck-citext.yml` kalıbı gerekirse.
- `UA/.env.example` → anahtar adları şablon olarak.
- `UA/.github/copilot-instructions.md` → proje kuralları şablonu (tek DB bölümü Bağdam kararına göre yeniden yazılır).

**database/**
- `UA/database/schema.prisma` → §2.3 tablosundaki modeller + `ProductStatus, UserRole, Gender, AddressUsage, AddressParty, OrderStatus, PaymentStatus, PaymentMethod, OrderSource, PackingStatus, InstallmentStatus, TransferStatus, ShipmentStatus, CargoProviderKey, ShippingCalcMethod, InvoiceType, InvoiceStatus, RefundStatus, ReturnStatus, OrderLineStatus, CancelRequestStatus, DiscountType, GiftCardStatus, ContentStatus, TicketStatus, TicketPriority, EmailStatus` enum'ları; payments partial unique index migration (`20260505100000_payments_gatewayref_paid_partial_unique`).
- `UA/database/seeds/{seed-settings,seed-email-templates,seed-tr-address,seed-cargo,seed-rbac}.ts` → uyarla (marka/adres/firma değerleri); `seed.ts` admin bloğunu env tabanlı yaz.

**apps/api/src**
- `main.ts`, `app.module.ts`, `config/{env-validator,jwt.config,cookie.config}.ts`
- `common/`: `prisma.{service,module}.ts`, `request-context.ts`, `middleware/request-id.middleware.ts`, `filters/all-exceptions.filter.ts`, `interceptors/{timeout,request-logger,audit-log}.interceptor.ts`, `decorators/*`, `guards/{jwt-auth,roles,csrf}.guard.ts`, `dto/pagination-query.dto.ts`, `crypto.util.ts`, `search.util.ts`, `shipping-config.util.ts`, `mail.{module,service}.ts` (çekirdek), `cron-log.{module,service}.ts`, `helpers/audit-context.ts`, `validators/tc-kimlik.validator.ts`
- `modules/auth/*`, `modules/settings/*`, `modules/media/*`, `modules/pricing/*`, `modules/orders/{order-status-transitions,order-timeout.scheduler,fulfillment-retry.scheduler,orders.controller,orders.service(kısaltılmış)}.ts` + dto, `modules/payment/gateways/*` (+ `paytr.*` gerekiyorsa), `modules/cart/*`, `modules/coupons/*`, `modules/gift-cards/*`, `modules/products/*`, `modules/categories/*`, `modules/instructors/*` (→ brands), `modules/users/*` (roles.controller dâhil), `modules/members/*`, `modules/shipping/*` (Yurtiçi kullanılacaksa), `modules/invoice/*` (e-fatura planlıysa), `modules/email-templates/*`, `modules/messaging/*` (ticket/contact/subscribers), `modules/content/*`, `modules/testimonials/*`, `modules/audit/*`, `modules/system-logs/*`, `modules/health/*`, `modules/dashboard/*`, `modules/address-ref/*`, `modules/sitemap/*`
- `src/__tests__/jest-global-setup.ts` (prod DB guard) + `__tests__/security/*` şablonları.

**packages/shared**
- `package.json`, `tsconfig.build.json`, `src/index.ts` barrel; `src/types/{user,product,order,shipping,ticket,blog,media}.ts`; `src/contracts/mesafeli-satis.ts` (mesafeli satış sözleşmesi şablonu — Bağdam metniyle).

**apps/admin/src**
- `AdminApp.tsx`, `app/router.tsx` (RequireAdminAuth kalıbı), `layouts/AdminLayout.tsx`, `components/{AdminTopBar,AdminSidebar,AdminBottomNav,AdminMobileDrawer,AdminErrorBoundary,Toaster}.tsx`, `components/ui/*`, `contexts/{AdminAuthContext,ConfirmContext}.tsx`, `hooks/{useApi,useAdminListPanel}.ts`, `lib/{api,apiTypes,adminNavConfig,adminNavIcons,tableStyles,toast,utils}.ts`, `features/components/*` (16 dosya), `features/medya/MediaPickerModal.tsx`, örnek sayfalar: `pages/urunler/{AdminUrunlerKategorilerPage,AdminUrunlerListePage,AdminUrunlerFormPage}.tsx`, `pages/siparisler/{AdminSiparislerListePage,AdminSiparisDetayPage}.tsx` + `features/siparisler/api.ts`, `pages/ayarlar/*`, `pages/entegrasyonlar/*`, `pages/medya/*`, `pages/kullanicilar/*`, `pages/sistem/*`, `pages/auth/AdminLoginPage.tsx`, `pages/dashboard/AdminDashboardPage.tsx`.

**apps/web/src**
- `lib/api.ts` (cookie + CSRF + `tryRefresh` + `forceLogout`), `contexts/{AuthContext,CartContext,SiteSettingsContext,ConfirmContext}.tsx`, `lib/pageRoutes.ts`, `components/seo/*`.

**docs**
- `docs/flows/_AKIS-SABLONU.md` + `_AKIS-HARITASI.md` yapısı, `A1-sepet.md`, `A2-checkout-odeme.md`, `A3-siparis-yonetimi.md`, `A6`, `A7`, `I1-site-ayarlari.md`, `I2`, `I6`, `P1-fiyat-hesaplama.md` → Bağdam spec'leri için şablon; `docs/monitoring-rehberi.md`, `docs/deployment-plani.md` (sunucu bilgileri güncellenerek), `YAPILACAKLAR.md` konvansiyonu.
