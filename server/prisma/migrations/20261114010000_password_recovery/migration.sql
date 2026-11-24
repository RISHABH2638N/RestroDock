ALTER TABLE "User"
  ADD COLUMN "resetTokenHash" CHAR(64),
  ADD COLUMN "resetExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "resetRequestedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "User_resetTokenHash_key" ON "User"("resetTokenHash");
