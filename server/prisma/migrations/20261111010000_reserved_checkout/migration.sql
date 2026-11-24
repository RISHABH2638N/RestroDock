ALTER TABLE "BranchSettings" ADD COLUMN "lastSeatingMinutes" INTEGER CHECK ("lastSeatingMinutes" IN (15,30));
ALTER TABLE "DiningSession" ADD COLUMN "singleGuest" BOOLEAN NOT NULL DEFAULT false;
