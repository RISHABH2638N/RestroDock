-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "menuRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "setupVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "description" VARCHAR(1000) NOT NULL DEFAULT '',
ADD COLUMN     "foodType" VARCHAR(20) NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "state" VARCHAR(20) NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "BranchSettings" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "displayName" VARCHAR(160),
    "address" VARCHAR(300),
    "contactEmail" VARCHAR(254),
    "contactPhone" VARCHAR(16),
    "businessHours" JSONB,
    "maxItemQuantity" INTEGER NOT NULL DEFAULT 10,
    "maxOrderQuantity" INTEGER NOT NULL DEFAULT 30,
    "maxOrderValueMinor" INTEGER NOT NULL DEFAULT 500000,
    "pinExpiryMinutes" INTEGER NOT NULL DEFAULT 15,
    "safetyConfigured" BOOLEAN NOT NULL DEFAULT false,
    "posConfigured" BOOLEAN NOT NULL DEFAULT false,
    "posName" VARCHAR(100),
    "posInstructions" VARCHAR(500),
    "assistanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "menuPhotosEnabled" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BranchSettings_pkey" PRIMARY KEY ("tenantId","branchId")
);

-- CreateTable
CREATE TABLE "BranchLogo" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,

    CONSTRAINT "BranchLogo_pkey" PRIMARY KEY ("tenantId","branchId")
);

-- CreateTable
CREATE TABLE "MenuPhoto" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,

    CONSTRAINT "MenuPhoto_pkey" PRIMARY KEY ("tenantId","branchId","menuItemId")
);

-- CreateTable
CREATE TABLE "MenuVariant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuAddon" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuImport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenuVariant_tenantId_branchId_menuItemId_name_key" ON "MenuVariant"("tenantId", "branchId", "menuItemId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MenuAddon_tenantId_branchId_menuItemId_name_key" ON "MenuAddon"("tenantId", "branchId", "menuItemId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MenuImport_tenantId_branchId_requestKey_key" ON "MenuImport"("tenantId", "branchId", "requestKey");

-- AddForeignKey
ALTER TABLE "BranchSettings" ADD CONSTRAINT "BranchSettings_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchLogo" ADD CONSTRAINT "BranchLogo_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuPhoto" ADD CONSTRAINT "MenuPhoto_tenantId_branchId_menuItemId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuItemId") REFERENCES "MenuItem"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuVariant" ADD CONSTRAINT "MenuVariant_tenantId_branchId_menuItemId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuItemId") REFERENCES "MenuItem"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuAddon" ADD CONSTRAINT "MenuAddon_tenantId_branchId_menuItemId_fkey" FOREIGN KEY ("tenantId", "branchId", "menuItemId") REFERENCES "MenuItem"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuImport" ADD CONSTRAINT "MenuImport_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant-scoped data and bounded editable monetary/resource settings.
ALTER TABLE "Branch" ADD CONSTRAINT "branch_revision_positive" CHECK ("setupVersion">0 AND "menuRevision">0);
ALTER TABLE "MenuCategory" ADD CONSTRAINT "category_sort_range" CHECK ("sortOrder" BETWEEN 0 AND 9999);
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_editor_state" CHECK (state IN ('DRAFT','PUBLISHED','ARCHIVED') AND "foodType" IN ('UNSPECIFIED','VEG','NON_VEG','EGG') AND source IN ('MANUAL','IMPORT'));
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_publish_review" CHECK (state!='PUBLISHED' OR (NOT "reviewRequired" AND "foodType"!='UNSPECIFIED' AND "priceMinor">0));
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_sort_range" CHECK ("sortOrder" BETWEEN 0 AND 9999);
ALTER TABLE "MenuVariant" ADD CONSTRAINT "variant_money_range" CHECK ("priceMinor" BETWEEN 1 AND 10000000 AND "sortOrder" BETWEEN 0 AND 9999);
ALTER TABLE "MenuAddon" ADD CONSTRAINT "addon_money_range" CHECK ("priceMinor" BETWEEN 0 AND 10000000 AND "sortOrder" BETWEEN 0 AND 9999);
ALTER TABLE "BranchSettings" ADD CONSTRAINT "settings_limits" CHECK ("maxItemQuantity" BETWEEN 1 AND 50 AND "maxOrderQuantity" BETWEEN "maxItemQuantity" AND 100 AND "maxOrderValueMinor" BETWEEN 100 AND 50000000 AND "pinExpiryMinutes" BETWEEN 5 AND 30);
ALTER TABLE "BranchSettings" ADD CONSTRAINT "settings_hours_array" CHECK ("businessHours" IS NULL OR jsonb_typeof("businessHours")='array');
ALTER TABLE "BranchLogo" ADD CONSTRAINT "logo_bounds" CHECK (octet_length(bytes) BETWEEN 1 AND 307200 AND width BETWEEN 1 AND 1200 AND height BETWEEN 1 AND 1200 AND sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "MenuPhoto" ADD CONSTRAINT "photo_bounds" CHECK (octet_length(bytes) BETWEEN 1 AND 307200 AND width BETWEEN 1 AND 1200 AND height BETWEEN 1 AND 1200 AND sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "MenuImport" ADD CONSTRAINT "import_bounds" CHECK ("itemCount" BETWEEN 1 AND 20 AND "payloadHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_editor_money_bound" CHECK ("priceMinor" BETWEEN 0 AND 10000000);
