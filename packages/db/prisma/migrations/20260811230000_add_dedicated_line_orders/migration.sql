CREATE TABLE "dedicated_line_orders" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "skuCode" TEXT NOT NULL,
  "skuName" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "regionCode" TEXT,
  "businessType" TEXT,
  "durationDays" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(20,8) NOT NULL,
  "totalPrice" DECIMAL(20,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "priceSource" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dedicated_line_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dedicated_line_orders_values_valid" CHECK (
    "durationDays" > 0
    AND "quantity" > 0
    AND "unitPrice" >= 0
    AND "totalPrice" >= 0
    AND "contractVersion" > 0
    AND length(btrim("skuCode")) > 0
    AND length(btrim("skuName")) > 0
    AND length(btrim("currency")) > 0
    AND length(btrim("priceSource")) > 0
    AND length(btrim("idempotencyKey")) > 0
    AND "countryCode" ~ '^[A-Z]{2}$'
  )
);

ALTER TABLE "stock_reservations" ADD COLUMN "dedicatedLineOrderId" TEXT;
ALTER TABLE "external_jobs" ADD COLUMN "dedicatedLineOrderId" TEXT;
ALTER TABLE "dedicated_lines" ADD COLUMN "dedicatedLineOrderId" TEXT;

CREATE UNIQUE INDEX "dedicated_line_orders_scoped_idempotency_key"
  ON "dedicated_line_orders"("siteId", "tenantId", "userId", "idempotencyKey");
CREATE INDEX "dedicated_line_orders_siteId_tenantId_userId_createdAt_idx"
  ON "dedicated_line_orders"("siteId", "tenantId", "userId", "createdAt");
CREATE INDEX "dedicated_line_orders_siteId_tenantId_skuId_createdAt_idx"
  ON "dedicated_line_orders"("siteId", "tenantId", "skuId", "createdAt");
CREATE UNIQUE INDEX "stock_reservations_dedicatedLineOrderId_key"
  ON "stock_reservations"("dedicatedLineOrderId");
CREATE UNIQUE INDEX "external_jobs_dedicatedLineOrderId_key"
  ON "external_jobs"("dedicatedLineOrderId");
CREATE INDEX "dedicated_lines_dedicatedLineOrderId_status_idx"
  ON "dedicated_lines"("dedicatedLineOrderId", "status");

ALTER TABLE "dedicated_line_orders"
  ADD CONSTRAINT "dedicated_line_orders_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dedicated_line_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dedicated_line_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dedicated_line_orders_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_dedicatedLineOrderId_fkey" FOREIGN KEY ("dedicatedLineOrderId") REFERENCES "dedicated_line_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_jobs"
  ADD CONSTRAINT "external_jobs_dedicatedLineOrderId_fkey" FOREIGN KEY ("dedicatedLineOrderId") REFERENCES "dedicated_line_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dedicated_lines"
  ADD CONSTRAINT "dedicated_lines_dedicatedLineOrderId_fkey" FOREIGN KEY ("dedicatedLineOrderId") REFERENCES "dedicated_line_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
