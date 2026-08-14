ALTER TABLE "tenants" ADD COLUMN "ownerUserId" TEXT;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tenants_siteId_ownerUserId_idx" ON "tenants"("siteId", "ownerUserId");

ALTER TABLE "price_templates" ADD COLUMN "tenantId" TEXT;

ALTER TABLE "price_templates"
  ADD CONSTRAINT "price_templates_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "price_templates_siteId_tenantId_idx" ON "price_templates"("siteId", "tenantId");
