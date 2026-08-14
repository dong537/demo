-- AlterTable
ALTER TABLE "provider_accounts" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "provider_accounts_siteId_tenantId_providerCode_status_idx" ON "provider_accounts"("siteId", "tenantId", "providerCode", "status");

-- AddForeignKey
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
