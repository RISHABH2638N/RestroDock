ALTER TABLE "Order"
    ADD COLUMN "kitchenNote" VARCHAR(240),
    ADD COLUMN "kitchenUpdatedAt" TIMESTAMPTZ(3);
