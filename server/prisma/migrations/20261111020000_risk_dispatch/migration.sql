ALTER TYPE "OrderReviewReason" ADD VALUE 'AUTO_DISPATCHED';

ALTER TABLE "BranchSettings"
 ADD COLUMN "approvalQuantity" INTEGER CHECK ("approvalQuantity" BETWEEN 1 AND 100),
 ADD COLUMN "approvalValueMinor" INTEGER CHECK ("approvalValueMinor" BETWEEN 1 AND 50000000);
