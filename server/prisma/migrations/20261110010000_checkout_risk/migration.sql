CREATE TYPE "OrderRiskSignal" AS ENUM ('LARGE_QUANTITY', 'HIGH_VALUE', 'TABLE_BURST', 'BRANCH_BURST', 'REPEATED_CART');
CREATE TYPE "OrderReviewReason" AS ENUM ('VERIFIED_AT_TABLE', 'DUPLICATE', 'UNVERIFIED', 'OTHER_RISK');

CREATE TABLE "CheckoutIntake" (
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "CheckoutIntake_pkey" PRIMARY KEY ("tenantId", "branchId"),
    CONSTRAINT "CheckoutIntake_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch" ("tenantId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "checkout_intake_version_positive" CHECK ("version" > 0)
);

ALTER TABLE "Order"
    ADD COLUMN "riskSignals" "OrderRiskSignal"[] NOT NULL DEFAULT ARRAY[]::"OrderRiskSignal"[],
    ADD COLUMN "reviewReason" "OrderReviewReason",
    ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
    ADD CONSTRAINT "order_review_fields_paired" CHECK (("reviewReason" IS NULL) = ("reviewedAt" IS NULL));

CREATE INDEX "Order_tenantId_branchId_createdAt_idx" ON "Order" ("tenantId", "branchId", "createdAt");
