DROP INDEX IF EXISTS "orders_idempotencyKey_key";

CREATE UNIQUE INDEX "orders_siteId_tenantId_userId_idempotencyKey_key"
ON "orders"("siteId", "tenantId", "userId", "idempotencyKey");
