ALTER TABLE "GuestSession"
 ADD COLUMN "requiresWaiterConfirmation" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "waiterConfirmedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "guest_one_confirmed_owner" ON "GuestSession" ("tenantId","branchId","diningSessionId")
 WHERE "requiresWaiterConfirmation" AND "waiterConfirmedAt" IS NOT NULL;

ALTER TABLE "DiningSession" ADD COLUMN "waiterConfirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiningSession" DROP CONSTRAINT "entry_pin_material";
ALTER TABLE "DiningSession" ADD CONSTRAINT "entry_pin_material" CHECK (
 NOT "entryOnly" OR
 (state='CLOSED' AND "pinHash" IS NULL AND "pinExpiresAt" IS NULL) OR
 (state='OPEN' AND (
  ("waiterConfirmation" AND "checkoutPilot" AND "singleGuest" AND "pinHash" IS NULL AND "pinExpiresAt" IS NULL) OR
  (NOT "waiterConfirmation" AND "pinHash" IS NOT NULL AND "pinHash" ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$'
   AND "pinExpiresAt" IS NOT NULL AND "pinExpiresAt"<="expiresAt" AND "failedJoinAttempts"<=5)
 ))
);
