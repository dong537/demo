CREATE TYPE "FederatedUpstreamKind" AS ENUM ('PLATFORM_365', 'NINE_EIGHT_FIVE', 'IPIPD');
CREATE TYPE "FederatedUpstreamStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "FederatedScanStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "federated_upstream_connections" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "FederatedUpstreamKind" NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "credentialEncrypted" TEXT NOT NULL,
    "credentialFingerprint" TEXT NOT NULL,
    "status" "FederatedUpstreamStatus" NOT NULL DEFAULT 'ACTIVE',
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "lastScannedAt" TIMESTAMP(3),
    "lastScanStatus" "FederatedScanStatus",
    "lastScanErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "federated_upstream_connections_timeout_check" CHECK ("timeoutMs" >= 1000 AND "timeoutMs" <= 120000),
    CONSTRAINT "federated_upstream_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "federated_upstream_scans" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "FederatedScanStatus" NOT NULL,
    "balanceAmount" DECIMAL(20,8),
    "balanceUnit" TEXT,
    "inventory" JSONB NOT NULL,
    "prices" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "federated_upstream_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "federated_upstream_connections_siteId_tenantId_name_key"
ON "federated_upstream_connections"("siteId", "tenantId", "name");
CREATE INDEX "federated_upstream_connections_siteId_tenantId_kind_status_idx"
ON "federated_upstream_connections"("siteId", "tenantId", "kind", "status");
CREATE INDEX "federated_upstream_scans_siteId_tenantId_connectionId_capturedAt_idx"
ON "federated_upstream_scans"("siteId", "tenantId", "connectionId", "capturedAt");
CREATE INDEX "federated_upstream_scans_siteId_tenantId_status_expiresAt_idx"
ON "federated_upstream_scans"("siteId", "tenantId", "status", "expiresAt");

ALTER TABLE "federated_upstream_connections"
ADD CONSTRAINT "federated_upstream_connections_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "federated_upstream_connections"
ADD CONSTRAINT "federated_upstream_connections_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "federated_upstream_scans"
ADD CONSTRAINT "federated_upstream_scans_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "federated_upstream_scans"
ADD CONSTRAINT "federated_upstream_scans_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "federated_upstream_scans"
ADD CONSTRAINT "federated_upstream_scans_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "federated_upstream_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
