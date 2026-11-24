ALTER TABLE "DiningSession"
    ADD COLUMN "checkoutPilot" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "checkout_pilot_requires_entry_session" CHECK (NOT "checkoutPilot" OR "entryOnly");
ALTER TABLE "OrderItem"
    ADD COLUMN "portionNameSnapshot" VARCHAR(80),
    ADD COLUMN "portionPriceMinor" INTEGER,
    ADD COLUMN "addOnSnapshots" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "preparationNote" VARCHAR(200) NOT NULL DEFAULT '',
    ADD CONSTRAINT "order_portion_price_valid" CHECK ("portionPriceMinor" >= 0 AND "portionPriceMinor" <= "unitPriceMinor"),
    ADD CONSTRAINT "order_add_on_snapshots_array" CHECK (jsonb_typeof("addOnSnapshots") = 'array');
