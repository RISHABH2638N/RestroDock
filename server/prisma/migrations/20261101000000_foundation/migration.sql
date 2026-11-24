-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('DRAFT', 'TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RESTAURANT_ADMIN', 'MANAGER', 'CHEF', 'WORKER', 'CASHIER');

-- CreateEnum
CREATE TYPE "DiningState" AS ENUM ('OPEN', 'BILL_REQUESTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'AWAITING_REVIEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('NOT_HANDED_OFF', 'HANDED_TO_POS', 'SETTLEMENT_PENDING', 'EXTERNALLY_SETTLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "tenantId" UUID NOT NULL,
    "planCode" VARCHAR(40) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "endsAt" TIMESTAMPTZ(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "orderingPaused" BOOLEAN NOT NULL DEFAULT true,
    "billingMode" VARCHAR(40) NOT NULL DEFAULT 'EXTERNAL_POS_MANUAL',
    "kitchenSource" VARCHAR(40) NOT NULL DEFAULT 'RESTRODOCK',

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchAccess" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,

    CONSTRAINT "BranchAccess_pkey" PRIMARY KEY ("tenantId","branchId","membershipId")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "available" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantTable" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "seats" INTEGER NOT NULL,

    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrCode" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "state" "DiningState" NOT NULL DEFAULT 'OPEN',
    "pinHash" VARCHAR(255),
    "pinExpiresAt" TIMESTAMPTZ(3),
    "failedJoinAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DiningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "diningSessionId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "mobileCiphertext" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "diningSessionId" UUID NOT NULL,
    "guestSessionId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_REVIEW',
    "estimatedTotalMinor" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "nameSnapshot" VARCHAR(160) NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingHandoff" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "diningSessionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'NOT_HANDED_OFF',
    "summarySnapshot" JSONB NOT NULL,
    "externalBillReference" VARCHAR(160),
    "staffConfirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "actorReference" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resourceReference" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_id_key" ON "Membership"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_tenantId_branchId_id_key" ON "MenuCategory"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_tenantId_branchId_name_key" ON "MenuCategory"("tenantId", "branchId", "name");

-- CreateIndex
CREATE INDEX "MenuItem_tenantId_branchId_available_idx" ON "MenuItem"("tenantId", "branchId", "available");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_tenantId_branchId_id_key" ON "MenuItem"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_tenantId_branchId_id_key" ON "RestaurantTable"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_tenantId_branchId_label_key" ON "RestaurantTable"("tenantId", "branchId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_secretHash_key" ON "QrCode"("secretHash");

-- CreateIndex
CREATE INDEX "QrCode_tenantId_branchId_tableId_idx" ON "QrCode"("tenantId", "branchId", "tableId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningSession_tenantId_branchId_id_key" ON "DiningSession"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tenantId_branchId_diningSessionId_id_key" ON "GuestSession"("tenantId", "branchId", "diningSessionId", "id");

-- CreateIndex
CREATE INDEX "Order_tenantId_branchId_status_createdAt_idx" ON "Order"("tenantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_branchId_id_key" ON "Order"("tenantId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_guestSessionId_idempotencyKey_key" ON "Order"("tenantId", "guestSessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_branchId_orderId_idx" ON "OrderItem"("tenantId", "branchId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingHandoff_tenantId_branchId_diningSessionId_revision_key" ON "BillingHandoff"("tenantId", "branchId", "diningSessionId", "revision");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_branchId_createdAt_idx" ON "AuditEvent"("tenantId", "branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchAccess" ADD CONSTRAINT "BranchAccess_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchAccess" ADD CONSTRAINT "BranchAccess_tenantId_membershipId_fkey" FOREIGN KEY ("tenantId", "membershipId") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_tenantId_branchId_categoryId_fkey" FOREIGN KEY ("tenantId", "branchId", "categoryId") REFERENCES "MenuCategory"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_tenantId_branchId_tableId_fkey" FOREIGN KEY ("tenantId", "branchId", "tableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_tenantId_branchId_tableId_fkey" FOREIGN KEY ("tenantId", "branchId", "tableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_tenantId_branchId_diningSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "diningSessionId") REFERENCES "DiningSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_diningSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "diningSessionId") REFERENCES "DiningSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_diningSessionId_guestSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "diningSessionId", "guestSessionId") REFERENCES "GuestSession"("tenantId", "branchId", "diningSessionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_branchId_menuItemId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuItemId") REFERENCES "MenuItem"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingHandoff" ADD CONSTRAINT "BillingHandoff_tenantId_branchId_diningSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "diningSessionId") REFERENCES "DiningSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial indexes / CHECK constraints. Keep these in migrations.
CREATE UNIQUE INDEX "one_active_session_per_table" ON "DiningSession" ("tenantId", "branchId", "tableId") WHERE state IN ('OPEN', 'BILL_REQUESTED');
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_price_nonnegative" CHECK ("priceMinor" >= 0);
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_currency_inr" CHECK (currency = 'INR');
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "table_seats_positive" CHECK (seats > 0);
ALTER TABLE "DiningSession" ADD CONSTRAINT "session_attempts_nonnegative" CHECK ("failedJoinAttempts" >= 0);
ALTER TABLE "DiningSession" ADD CONSTRAINT "session_expiry_valid" CHECK ("expiresAt" > "openedAt");
ALTER TABLE "DiningSession" ADD CONSTRAINT "session_closed_timestamp" CHECK ((state = 'CLOSED') = ("closedAt" IS NOT NULL));
ALTER TABLE "Order" ADD CONSTRAINT "order_total_nonnegative" CHECK ("estimatedTotalMinor" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_version_positive" CHECK (version > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "line_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "line_price_nonnegative" CHECK ("unitPriceMinor" >= 0);
ALTER TABLE "BillingHandoff" ADD CONSTRAINT "handoff_revision_positive" CHECK (revision > 0);
ALTER TABLE "BillingHandoff" ADD CONSTRAINT "settlement_needs_reference" CHECK (status != 'EXTERNALLY_SETTLED' OR ("externalBillReference" IS NOT NULL AND length(trim("externalBillReference")) > 0 AND "staffConfirmedAt" IS NOT NULL));
ALTER TABLE "Branch" ADD CONSTRAINT "v1_manual_pos_ownership" CHECK ("billingMode" = 'EXTERNAL_POS_MANUAL' AND "kitchenSource" = 'RESTRODOCK');
