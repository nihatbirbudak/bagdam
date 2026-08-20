-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'LOW', 'SOLD_OUT', 'OUT_OF_SEASON');

-- CreateEnum
CREATE TYPE "DeliveryDay" AS ENUM ('SALI', 'PERSEMBE', 'CUMARTESI');

-- CreateEnum
CREATE TYPE "DeliveryDateStatus" AS ENUM ('OPEN', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('SINGLE', 'BOX_ONE_TIME', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "OrderLineKind" AS ENUM ('PRODUCT', 'BOX', 'EXTRA');

-- CreateEnum
CREATE TYPE "BillingParty" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('SCHEDULED', 'LOCKED', 'AWAITING_PAYMENT', 'SKIPPED', 'CHARGED', 'UNPAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CycleItemSource" AS ENUM ('TEMPLATE', 'SWAP', 'EXTRA', 'CART_MERGE');

-- CreateEnum
CREATE TYPE "SkipSource" AS ENUM ('USER', 'OPS', 'UNPAID');

-- CreateEnum
CREATE TYPE "ChargeStrategy" AS ENUM ('MERCHANT_INITIATED', 'PAYMENT_LINK');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('IYZICO', 'PAYTR', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('CHECKOUT', 'CYCLE_CHARGE', 'DELTA', 'RETRY', 'LINK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_3DS', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIAL_REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "LegalKind" AS ENUM ('PRIVACY', 'TERMS', 'DISTANCE_SALES', 'DELIVERY', 'RETURNS', 'KVKK', 'COOKIE', 'COOKIE_SETTINGS', 'PREINFO', 'SUBSCRIPTION_CONTRACT', 'MARKETING_CONSENT');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('PREINFO_ACK', 'CONTRACT_ACK', 'SUBSCRIPTION_CONTRACT_ACK', 'KVKK_ACK', 'MARKETING_EMAIL', 'MARKETING_SMS', 'COOKIE_ANALYTICS', 'COOKIE_MARKETING');

-- CreateEnum
CREATE TYPE "IysStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('PRICE', 'VARIETY', 'DELIVERY_DAYS', 'OTHER');

-- CreateEnum
CREATE TYPE "CancelOutcome" AS ENUM ('PENDING', 'RETENTION_ACCEPTED', 'CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SubEventType" AS ENUM ('CREATED', 'ACTIVATED', 'TIER_CHANGED', 'FREQ_CHANGED', 'DAY_CHANGED', 'PREF_CHANGED', 'SWAP', 'EXTRA_ADDED', 'EXTRA_REMOVED', 'CART_MERGED', 'SKIP', 'UNSKIP', 'LOCKED', 'AWAITING_PAYMENT', 'CHARGED', 'DELTA_CHARGED', 'PAYMENT_FAILED', 'RETRY', 'UNPAID', 'CARD_UPDATED', 'CANCEL_REQUESTED', 'RETENTION_OFFERED', 'RETENTION_USED', 'CANCELLED', 'COMPLETED', 'PAUSED', 'RESUMED', 'ADMIN_NOTE');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" VARCHAR(120),
    "phone" VARCHAR(30),
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "refreshTokenHash" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMPTZ(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "prefs" JSONB,
    "retentionOfferUsedAt" TIMESTAMPTZ(3),
    "firstBoxesPromoUsedAt" TIMESTAMPTZ(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 49,
    "freeThreshold" DECIMAL(12,2),
    "capacityPerDay" INTEGER NOT NULL DEFAULT 999,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_dates" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "day" "DeliveryDay" NOT NULL,
    "date" DATE NOT NULL,
    "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "status" "DeliveryDateStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "delivery_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "line" VARCHAR(500) NOT NULL,
    "zoneId" TEXT NOT NULL,
    "zip" VARCHAR(10),
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "legacyTab" VARCHAR(20),
    "label" VARCHAR(60) NOT NULL,
    "panelNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "village" VARCHAR(80),
    "district" VARCHAR(80) NOT NULL DEFAULT 'Urla',
    "story" TEXT,
    "photoMediaId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "producers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "group" VARCHAR(40),
    "producerId" TEXT,
    "metaNote" VARCHAR(80),
    "price" DECIMAL(12,2) NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 1,
    "unit" VARCHAR(40) NOT NULL,
    "boxAmount" VARCHAR(60),
    "extraOptions" JSONB,
    "description" TEXT NOT NULL,
    "storageText" TEXT,
    "allergenText" VARCHAR(120),
    "freshnessNote" VARCHAR(120),
    "prefLabel" VARCHAR(40),
    "prefOptions" TEXT[],
    "prefDefault" INTEGER,
    "isFresh" BOOLEAN NOT NULL DEFAULT false,
    "season" VARCHAR(40),
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "pairWithBox" BOOLEAN NOT NULL DEFAULT false,
    "pairOrder" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "alt" VARCHAR(160),
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "producerId" TEXT,
    "lotCode" VARCHAR(40) NOT NULL,
    "harvestDate" DATE,
    "bestBefore" DATE,
    "tastingNote" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_tiers" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "note" VARCHAR(160),
    "imageMediaId" TEXT,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "box_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_templates" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "curatorName" VARCHAR(60),
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "box_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyLabel" VARCHAR(60) NOT NULL,
    "isSwappable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "box_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wholesale_leads" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "businessName" VARCHAR(160),
    "phone" VARCHAR(30),
    "note" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "ip" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wholesale_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "readMinutes" INTEGER NOT NULL DEFAULT 4,
    "titleHtml" TEXT NOT NULL,
    "excerpt" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "coverMediaId" TEXT,
    "relatedSlugs" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "kind" "LegalKind" NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL,
    "leadHtml" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "showInNav" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestKey" VARCHAR(64),
    "orderId" TEXT,
    "kind" "ConsentKind" NOT NULL,
    "documentId" TEXT,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(20) NOT NULL DEFAULT 'HS_WEB',
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "iysStatus" "IysStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "iysSyncedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_content" (
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "schema" JSONB NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_content_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "thumbPath" VARCHAR(255),
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" VARCHAR(160),
    "folder" VARCHAR(80) NOT NULL DEFAULT 'genel',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" VARCHAR(160),
    "action" VARCHAR(20) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(60),
    "summary" VARCHAR(255),
    "oldValues" JSONB,
    "newValues" JSONB,
    "requestId" VARCHAR(60),
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_logs" (
    "id" TEXT NOT NULL,
    "to" VARCHAR(160) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "templateSlug" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(60),
    "status" "MailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "messageId" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "mail_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "action" VARCHAR(40),
    "message" TEXT NOT NULL,
    "requestId" VARCHAR(60),
    "userId" TEXT,
    "metadata" JSONB,
    "fingerprint" VARCHAR(64),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_logs" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,

    CONSTRAINT "cron_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "users"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_slug_key" ON "delivery_zones"("slug");

-- CreateIndex
CREATE INDEX "delivery_dates_date_status_idx" ON "delivery_dates"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_dates_zoneId_date_key" ON "delivery_dates"("zoneId", "date");

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "producers_slug_key" ON "producers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_status_isFresh_idx" ON "products"("status", "isFresh");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_productId_lotCode_key" ON "product_lots"("productId", "lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "box_tiers_slug_key" ON "box_tiers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "box_templates_tierId_weekStart_key" ON "box_templates"("tierId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "box_template_items_templateId_productId_key" ON "box_template_items"("templateId", "productId");

-- CreateIndex
CREATE INDEX "wholesale_leads_status_createdAt_idx" ON "wholesale_leads"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_status_publishedAt_idx" ON "posts"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "legal_documents_kind_isCurrent_idx" ON "legal_documents"("kind", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_slug_version_key" ON "legal_documents"("slug", "version");

-- CreateIndex
CREATE INDEX "consents_userId_kind_idx" ON "consents"("userId", "kind");

-- CreateIndex
CREATE INDEX "consents_orderId_idx" ON "consents"("orderId");

-- CreateIndex
CREATE INDEX "settings_group_idx" ON "settings"("group");

-- CreateIndex
CREATE INDEX "media_files_folder_idx" ON "media_files"("folder");

-- CreateIndex
CREATE INDEX "audit_logs_module_entityId_idx" ON "audit_logs"("module", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mail_logs_templateSlug_entityId_key" ON "mail_logs"("templateSlug", "entityId");

-- CreateIndex
CREATE INDEX "system_logs_level_lastSeenAt_idx" ON "system_logs"("level", "lastSeenAt");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- CreateIndex
CREATE INDEX "cron_logs_name_startedAt_idx" ON "cron_logs"("name", "startedAt");

-- AddForeignKey
ALTER TABLE "delivery_dates" ADD CONSTRAINT "delivery_dates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producers" ADD CONSTRAINT "producers_photoMediaId_fkey" FOREIGN KEY ("photoMediaId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_tiers" ADD CONSTRAINT "box_tiers_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_templates" ADD CONSTRAINT "box_templates_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "box_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_template_items" ADD CONSTRAINT "box_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "box_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_template_items" ADD CONSTRAINT "box_template_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
