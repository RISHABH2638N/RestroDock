-- Day 9+10. Applied migrations remain immutable; legacy sessions remain non-pilot.
ALTER TABLE "Branch" ADD COLUMN "tableRevision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "tableEntryPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RestaurantTable" ADD COLUMN "section" VARCHAR(80) NOT NULL DEFAULT 'Main', ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DiningSession" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "pinVersion" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "entryOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuestSession" ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Branch" ADD CONSTRAINT "table_revision_positive" CHECK ("tableRevision">0);
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "table_version_section" CHECK ("version">0 AND length(trim("section"))>0);
ALTER TABLE "DiningSession" ADD CONSTRAINT "entry_session_versions" CHECK ("version">0 AND "pinVersion">0);
ALTER TABLE "DiningSession" ADD CONSTRAINT "entry_pin_material" CHECK (NOT "entryOnly" OR ((state='CLOSED' AND "pinHash" IS NULL AND "pinExpiresAt" IS NULL) OR (state='OPEN' AND "pinHash" IS NOT NULL AND "pinHash" ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$' AND "pinExpiresAt" IS NOT NULL AND "pinExpiresAt"<="expiresAt" AND "failedJoinAttempts"<=5)));
-- Legacy data may contain multiple non-revoked QR hashes; keep only the newest before enforcing one current code.
WITH ranked AS (SELECT id,row_number() OVER (PARTITION BY "tenantId","branchId","tableId" ORDER BY "createdAt" DESC,id DESC) AS n FROM "QrCode" WHERE "revokedAt" IS NULL)
UPDATE "QrCode" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM ranked WHERE n>1);
CREATE UNIQUE INDEX "one_current_qr_per_table" ON "QrCode"("tenantId","branchId","tableId") WHERE "revokedAt" IS NULL;
CREATE INDEX "entry_session_expiry" ON "DiningSession"("tenantId","branchId","expiresAt") WHERE "entryOnly" AND state='OPEN';
CREATE INDEX "guest_expiry_cleanup" ON "GuestSession"("tenantId","branchId","expiresAt");
