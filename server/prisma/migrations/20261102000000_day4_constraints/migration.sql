-- Additive Day 4 indexes. Preserve the already-applied foundation migration.
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "BranchAccess_tenantId_membershipId_idx" ON "BranchAccess"("tenantId","membershipId");
CREATE INDEX "MenuItem_tenantId_branchId_categoryId_idx" ON "MenuItem"("tenantId","branchId","categoryId");
CREATE INDEX "DiningSession_tenantId_branchId_tableId_openedAt_idx" ON "DiningSession"("tenantId","branchId","tableId","openedAt");
CREATE INDEX "Order_tenantId_branchId_diningSessionId_createdAt_idx" ON "Order"("tenantId","branchId","diningSessionId","createdAt");
CREATE INDEX "OrderItem_tenantId_branchId_menuItemId_idx" ON "OrderItem"("tenantId","branchId","menuItemId");
-- Canonical slugs prevent case variants. Hash fields are SHA-256 hex, not raw tokens.
ALTER TABLE "Tenant" ADD CONSTRAINT "tenant_slug_canonical" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "QrCode" ADD CONSTRAINT "qr_secret_sha256_hex" CHECK ("secretHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "GuestSession" ADD CONSTRAINT "guest_token_sha256_hex" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Order" ADD CONSTRAINT "order_request_sha256_hex" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');
