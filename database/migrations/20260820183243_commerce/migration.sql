-- 0003_commerce (F7 1. gün, ADR-0013): F2b modelleri — Cart, Order, OrderLine, PaymentMethod, Payment, Refund, WebhookEvent,
-- Subscription, SubscriptionCycle, CycleItem, SubscriptionEvent, SubscriptionCancellation + minimal Coupon/CouponRedemption
-- (kullanıcı kararı; UI P2) + Consent.orderId → orders FK (additive). Prisma üretimi; tüm an alanları TIMESTAMPTZ(3).
-- Ham SQL tamamlayıcısı 0004_raw_commerce: "orders_orderNo_seq" RESTART 1001, "payments_provider_pid_succeeded" kısmi benzersiz indeks.

-- CreateEnum
CREATE TYPE "CouponKind" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('ALL', 'SINGLE', 'BOX');

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "boxDraft" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "userId" TEXT,
    "subscriptionId" TEXT,
    "customerName" VARCHAR(120) NOT NULL,
    "customerEmail" VARCHAR(160) NOT NULL,
    "customerPhone" VARCHAR(30) NOT NULL,
    "zoneId" TEXT,
    "deliveryDateId" TEXT,
    "deliveryDay" "DeliveryDay" NOT NULL,
    "deliveryOn" DATE NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "billingParty" "BillingParty" NOT NULL DEFAULT 'INDIVIDUAL',
    "billingName" VARCHAR(200),
    "billingTaxNo" VARCHAR(11),
    "billingTaxOffice" VARCHAR(100),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "couponCode" VARCHAR(40),
    "paidAt" TIMESTAMPTZ(3),
    "invoiceNo" VARCHAR(40),
    "invoicePdfPath" VARCHAR(255),
    "note" TEXT,
    "adminNote" TEXT,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderLineKind" NOT NULL,
    "productId" TEXT,
    "tierSlug" VARCHAR(40),
    "name" VARCHAR(160) NOT NULL,
    "unit" VARCHAR(40),
    "qty" DECIMAL(8,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 1,
    "pref" VARCHAR(60),
    "lotCode" VARCHAR(40),
    "metadata" JSONB,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerCustomerKey" VARCHAR(120) NOT NULL,
    "providerCardToken" VARCHAR(120) NOT NULL,
    "bin" VARCHAR(8),
    "last4" VARCHAR(4) NOT NULL,
    "brand" VARCHAR(30),
    "holderName" VARCHAR(120),
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'CHECKOUT',
    "conversationId" VARCHAR(80) NOT NULL,
    "providerPaymentId" VARCHAR(120),
    "providerToken" VARCHAR(160),
    "paymentMethodId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "is3ds" BOOLEAN NOT NULL DEFAULT true,
    "isMerchantInitiated" BOOLEAN NOT NULL DEFAULT false,
    "linkToken" VARCHAR(64),
    "linkExpiresAt" TIMESTAMPTZ(3),
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "failureCode" VARCHAR(40),
    "failureMessage" VARCHAR(255),
    "rawResponse" JSONB,
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(255),
    "providerRefundId" VARCHAR(120),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "isOneTime" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 1,
    "deliveryDay" "DeliveryDay" NOT NULL,
    "zoneId" TEXT NOT NULL,
    "addressId" TEXT,
    "paymentMethodId" TEXT,
    "itemPrefs" JSONB NOT NULL DEFAULT '{}',
    "chargeStrategy" "ChargeStrategy" NOT NULL DEFAULT 'MERCHANT_INITIATED',
    "discountBoxesLeft" INTEGER NOT NULL DEFAULT 2,
    "nextBoxDiscountPct" INTEGER,
    "skipsUsed" INTEGER NOT NULL DEFAULT 0,
    "skipsResetAt" TIMESTAMPTZ(3),
    "failedCycles" INTEGER NOT NULL DEFAULT 0,
    "contractDocId" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "nextDeliveryOn" DATE,
    "nextCutoffAt" TIMESTAMPTZ(3),
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cycles" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "cycleNo" INTEGER NOT NULL,
    "deliveryDateId" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "skipSource" "SkipSource",
    "boxPrice" DECIMAL(12,2),
    "extrasTotal" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "shippingFee" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "prepaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "deltaOrderId" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "skippedAt" TIMESTAMPTZ(3),
    "paymentDueAt" TIMESTAMPTZ(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(3),

    CONSTRAINT "subscription_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_items" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "source" "CycleItemSource" NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "swapOfProductId" VARCHAR(40),
    "pref" VARCHAR(60),
    "qty" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "unit" VARCHAR(40),
    "label" VARCHAR(80),
    "unitPrice" DECIMAL(12,2),
    "lotCode" VARCHAR(40),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cycle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "cycleId" TEXT,
    "type" "SubEventType" NOT NULL,
    "actor" VARCHAR(10) NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cancellations" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "reason" "CancelReason",
    "reasonText" TEXT,
    "retentionOffered" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "CancelOutcome" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "refundAmount" DECIMAL(12,2),
    "refundDueAt" TIMESTAMPTZ(3),

    CONSTRAINT "subscription_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" CITEXT NOT NULL,
    "kind" "CouponKind" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "minSubtotal" DECIMAL(12,2),
    "appliesTo" "CouponScope" NOT NULL DEFAULT 'ALL',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_deliveryOn_status_idx" ON "orders"("deliveryOn", "status");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_conversationId_key" ON "payments"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_linkToken_key" ON "payments"("linkToken");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_providerPaymentId_idx" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventType_providerRef_key" ON "webhook_events"("provider", "eventType", "providerRef");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_status_nextCutoffAt_idx" ON "subscriptions"("status", "nextCutoffAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycles_orderId_key" ON "subscription_cycles"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycles_deltaOrderId_key" ON "subscription_cycles"("deltaOrderId");

-- CreateIndex
CREATE INDEX "subscription_cycles_status_deliveryDateId_idx" ON "subscription_cycles"("status", "deliveryDateId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycles_subscriptionId_cycleNo_key" ON "subscription_cycles"("subscriptionId", "cycleNo");

-- CreateIndex
CREATE INDEX "cycle_items_cycleId_idx" ON "cycle_items"("cycleId");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_createdAt_idx" ON "subscription_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_cancellations_subscriptionId_requestedAt_idx" ON "subscription_cancellations"("subscriptionId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_idx" ON "coupon_redemptions"("couponId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_userId_idx" ON "coupon_redemptions"("userId");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryDateId_fkey" FOREIGN KEY ("deliveryDateId") REFERENCES "delivery_dates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "box_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_deliveryDateId_fkey" FOREIGN KEY ("deliveryDateId") REFERENCES "delivery_dates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_deltaOrderId_fkey" FOREIGN KEY ("deltaOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_items" ADD CONSTRAINT "cycle_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "subscription_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_items" ADD CONSTRAINT "cycle_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_items" ADD CONSTRAINT "cycle_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "product_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cancellations" ADD CONSTRAINT "subscription_cancellations_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
