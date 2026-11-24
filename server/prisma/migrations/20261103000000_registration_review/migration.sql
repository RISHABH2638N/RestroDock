-- Additive Day8.3 public application/review workflow. Prior migrations remain immutable.
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING','APPROVED','REJECTED','EXPIRED');
CREATE TABLE "RegistrationRequest" (
 "id" UUID NOT NULL,
 "restaurantName" VARCHAR(160) NOT NULL,
 "branchName" VARCHAR(160) NOT NULL,
 "ownerName" VARCHAR(100) NOT NULL,
 "email" VARCHAR(254) NOT NULL,
 "phone" VARCHAR(16) NOT NULL,
 "city" VARCHAR(100) NOT NULL,
 "address" VARCHAR(300) NOT NULL,
 "passwordHash" VARCHAR(255),
 "trackingHash" CHAR(64) NOT NULL,
 "payloadHash" CHAR(64) NOT NULL,
 "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "reviewedAt" TIMESTAMPTZ(3),
 "reviewedById" UUID,
 "ownershipConfirmed" BOOLEAN NOT NULL DEFAULT false,
 "reason" VARCHAR(500),
 "tenantId" UUID,
 "branchId" UUID,
 "applicantUserId" UUID,
 CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RegistrationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RegistrationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RegistrationRequest_tenantId_branchId_fkey" FOREIGN KEY ("tenantId","branchId") REFERENCES "Branch"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RegistrationRequest_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RegistrationRequest_trackingHash_key" ON "RegistrationRequest"("trackingHash");
CREATE UNIQUE INDEX "RegistrationRequest_applicantUserId_key" ON "RegistrationRequest"("applicantUserId");
CREATE INDEX "RegistrationRequest_status_createdAt_id_idx" ON "RegistrationRequest"("status","createdAt","id");
CREATE INDEX "RegistrationRequest_status_expiresAt_idx" ON "RegistrationRequest"("status","expiresAt");
CREATE INDEX "RegistrationRequest_email_idx" ON "RegistrationRequest"("email");
-- One live application per canonical email; completed history never reserves a new identity.
CREATE UNIQUE INDEX "RegistrationRequest_pending_email" ON "RegistrationRequest"("email") WHERE "status"='PENDING';
ALTER TABLE "RegistrationRequest" ADD CONSTRAINT "registration_bounds" CHECK (
  "version">0 AND "expiresAt">"createdAt" AND "email"=lower("email")
  AND ("passwordHash" IS NULL OR "passwordHash" ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$')
  AND "trackingHash" ~ '^[a-f0-9]{64}$' AND "payloadHash" ~ '^[a-f0-9]{64}$'
  AND ("reviewedAt" IS NULL OR "reviewedAt">="createdAt")
);
ALTER TABLE "RegistrationRequest" ADD CONSTRAINT "registration_state" CHECK (
 ("status"='PENDING' AND "passwordHash" IS NOT NULL AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND NOT "ownershipConfirmed" AND "reason" IS NULL AND "tenantId" IS NULL AND "branchId" IS NULL AND "applicantUserId" IS NULL)
 OR ("status"='APPROVED' AND "passwordHash" IS NULL AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "ownershipConfirmed" AND "reason" IS NULL AND "tenantId" IS NOT NULL AND "branchId" IS NOT NULL AND "applicantUserId" IS NOT NULL)
 OR ("status"='REJECTED' AND "passwordHash" IS NULL AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND NOT "ownershipConfirmed" AND "reason" IS NOT NULL AND length(trim("reason"))>=10 AND "tenantId" IS NULL AND "branchId" IS NULL AND "applicantUserId" IS NULL)
 OR ("status"='EXPIRED' AND "passwordHash" IS NULL AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND NOT "ownershipConfirmed" AND "reason" IS NULL AND "tenantId" IS NULL AND "branchId" IS NULL AND "applicantUserId" IS NULL)
);
