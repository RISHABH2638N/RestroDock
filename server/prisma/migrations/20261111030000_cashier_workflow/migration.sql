ALTER TABLE "DiningSession" ADD COLUMN "billRequestedAt" TIMESTAMPTZ(3);
ALTER TABLE "BillingHandoff" ADD COLUMN "paymentMethod" VARCHAR(8);
ALTER TABLE "BillingHandoff" ADD CONSTRAINT "handoff_payment_method"
 CHECK ("paymentMethod" IS NULL OR ("paymentMethod" IN ('CASH','UPI') AND status='EXTERNALLY_SETTLED'));
