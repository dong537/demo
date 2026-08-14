-- Bind synced resources, inventory, mappings, and fulfillment artifacts to the
-- concrete upstream account used at runtime. The value may reference either a
-- native provider account or an UPSTREAM_API account, so it intentionally has no
-- single-table foreign key.

ALTER TABLE "platform_resources" ADD COLUMN "upstreamAccountId" TEXT;
ALTER TABLE "inventory_snapshots" ADD COLUMN "upstreamAccountId" TEXT;
ALTER TABLE "resource_mappings" ADD COLUMN "upstreamAccountId" TEXT;
ALTER TABLE "fulfillment_jobs" ADD COLUMN "upstreamAccountId" TEXT;
ALTER TABLE "upstream_order_mirrors" ADD COLUMN "upstreamAccountId" TEXT;
ALTER TABLE "proxy_instances" ADD COLUMN "upstreamAccountId" TEXT;

DROP INDEX IF EXISTS "platform_resources_siteId_providerCode_code_ipType_key";
DROP INDEX IF EXISTS "resource_mappings_siteId_resourceId_providerCode_key";

CREATE UNIQUE INDEX "platform_resources_site_provider_account_code_iptype_key"
  ON "platform_resources"("siteId", "providerCode", "upstreamAccountId", "code", "ipType");

CREATE INDEX "platform_resources_site_provider_account_status_idx"
  ON "platform_resources"("siteId", "providerCode", "upstreamAccountId", "status");

CREATE UNIQUE INDEX "resource_mappings_site_resource_provider_account_key"
  ON "resource_mappings"("siteId", "resourceId", "providerCode", "upstreamAccountId");
