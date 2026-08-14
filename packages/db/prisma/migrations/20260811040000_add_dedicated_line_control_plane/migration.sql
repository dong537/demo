-- CreateEnum
CREATE TYPE "DedicatedLineStatus" AS ENUM ('PENDING_PAYMENT', 'QUEUED', 'PROVISIONING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'EXPIRED', 'MIGRATING_AWAITING_ROUTE_IMPORT', 'CANCELLING', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DedicatedLineProtocol" AS ENUM ('VLESS', 'VMESS', 'MIXED');

-- CreateEnum
CREATE TYPE "PlacementMode" AS ENUM ('ACTIVE_ACTIVE', 'HOT_STANDBY');

-- CreateEnum
CREATE TYPE "ControlNodeStatus" AS ENUM ('ACTIVE', 'DRAINING', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProjectionStatus" AS ENUM ('PENDING', 'APPLYING', 'READY', 'FAILED', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "ResidentialExitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'QUARANTINED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ExitAssignmentStatus" AS ENUM ('ACTIVE', 'RELEASING', 'RELEASED');

-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExternalJobStatus" AS ENUM ('QUEUED', 'LEASED', 'RETRYING', 'COMPLETED', 'FAILED', 'NEEDS_OPERATOR');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'LEASED', 'RETRYING', 'PUBLISHED', 'FAILED', 'NEEDS_OPERATOR');

-- CreateTable
CREATE TABLE "service_skus" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" JSONB NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_price_rules" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_price_overrides" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sku_price_overrides" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sku_price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residential_exits" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "providerAccountId" TEXT,
    "providerCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "endpointCiphertext" TEXT NOT NULL,
    "credentialCiphertext" TEXT NOT NULL,
    "identityFingerprint" TEXT NOT NULL,
    "maxReplicaFanout" INTEGER NOT NULL DEFAULT 1,
    "status" "ResidentialExitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "quarantineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "residential_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_health_observations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "residentialExitId" TEXT NOT NULL,
    "dedicatedLineId" TEXT,
    "reachable" BOOLEAN NOT NULL,
    "observedIp" TEXT,
    "observedCountryCode" TEXT,
    "latencyMs" INTEGER,
    "failureType" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_health_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_groups" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_nodes" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "nodeGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiCredentialCiphertext" TEXT NOT NULL,
    "apiCredentialFingerprint" TEXT NOT NULL,
    "status" "ControlNodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "capacityUnits" INTEGER NOT NULL,
    "allocatedUnits" INTEGER NOT NULL DEFAULT 0,
    "lastHealthyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_profiles" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nodeGroupId" TEXT NOT NULL,
    "controlNodeId" TEXT,
    "code" TEXT NOT NULL,
    "protocol" "DedicatedLineProtocol" NOT NULL,
    "inboundTag" TEXT NOT NULL,
    "listenPort" INTEGER NOT NULL,
    "transportConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_placement_policies" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "skuId" TEXT,
    "nodeGroupId" TEXT NOT NULL,
    "inboundProfileId" TEXT NOT NULL,
    "mode" "PlacementMode" NOT NULL DEFAULT 'ACTIVE_ACTIVE',
    "targetReplicaCount" INTEGER NOT NULL,
    "minReadyReplicaCount" INTEGER NOT NULL,
    "maxUnitsPerNode" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_placement_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_lines" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "inboundProfileId" TEXT NOT NULL,
    "status" "DedicatedLineStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "countryCode" TEXT NOT NULL,
    "protocol" "DedicatedLineProtocol" NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "clientIdentityCiphertext" TEXT NOT NULL,
    "clientIdentityFingerprint" TEXT NOT NULL,
    "desiredVersion" INTEGER NOT NULL DEFAULT 1,
    "quotaBytes" BIGINT,
    "uplinkLimitBps" BIGINT,
    "downlinkLimitBps" BIGINT,
    "maxConnections" INTEGER,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedicated_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_placements" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "policyId" TEXT,
    "nodeGroupId" TEXT NOT NULL,
    "mode" "PlacementMode" NOT NULL,
    "targetReplicaCount" INTEGER NOT NULL,
    "minReadyReplicaCount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignmentFingerprint" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedicated_line_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_placement_nodes" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dedicated_line_placement_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_projections" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "projectionKey" TEXT NOT NULL,
    "status" "ProjectionStatus" NOT NULL DEFAULT 'PENDING',
    "desiredVersion" INTEGER NOT NULL,
    "observedVersion" INTEGER,
    "desiredHash" TEXT NOT NULL,
    "observedHash" TEXT,
    "nodeExternalId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorDetail" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "lastObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedicated_line_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_exit_assignments" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "residentialExitId" TEXT NOT NULL,
    "status" "ExitAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "dedicated_line_exit_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_imports" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "importedBy" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_route_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_routes" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeImportId" TEXT NOT NULL,
    "dedicatedLineId" TEXT,
    "sourceRouteId" TEXT NOT NULL,
    "entranceGroupCode" TEXT NOT NULL,
    "protocol" "DedicatedLineProtocol" NOT NULL,
    "listenPort" INTEGER NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_domains" (
    "id" TEXT NOT NULL,
    "deliveryRouteId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_route_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_targets" (
    "id" TEXT NOT NULL,
    "deliveryRouteId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_route_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_inventory_snapshots" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "providerResourceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "sourceVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dedicated_line_inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventorySnapshotId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_jobs" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "dedicatedLineId" TEXT,
    "kind" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "desiredVersion" INTEGER NOT NULL,
    "status" "ExternalJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastErrorCode" TEXT,
    "lastErrorDetail" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "dedicatedLineId" TEXT,
    "topic" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "desiredVersion" INTEGER NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastErrorCode" TEXT,
    "lastErrorDetail" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_skus_siteId_isActive_isVisible_sortOrder_idx" ON "service_skus"("siteId", "isActive", "isVisible", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "service_skus_siteId_code_key" ON "service_skus"("siteId", "code");

-- CreateIndex
CREATE INDEX "sku_price_rules_lookup_idx" ON "sku_price_rules"("siteId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "sku_price_rules_scope_tier_key" ON "sku_price_rules"("siteId", "templateId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE INDEX "sku_price_overrides_lookup_idx" ON "sku_price_overrides"("siteId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "sku_price_overrides_scope_tier_key" ON "sku_price_overrides"("siteId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE INDEX "user_sku_price_overrides_lookup_idx" ON "user_sku_price_overrides"("siteId", "tenantId", "userId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "user_sku_price_overrides_scope_tier_key" ON "user_sku_price_overrides"("siteId", "userId", "skuId", "durationDays", "minQty");

-- CreateIndex
CREATE INDEX "residential_exits_siteId_tenantId_countryCode_status_expire_idx" ON "residential_exits"("siteId", "tenantId", "countryCode", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "residential_exits_siteId_providerAccountId_status_idx" ON "residential_exits"("siteId", "providerAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "residential_exits_provider_identity_key" ON "residential_exits"("siteId", "providerCode", "providerAccountId", "identityFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "residential_exits_siteId_identityFingerprint_key" ON "residential_exits"("siteId", "identityFingerprint");

-- CreateIndex
CREATE INDEX "exit_health_observations_siteId_residentialExitId_observedA_idx" ON "exit_health_observations"("siteId", "residentialExitId", "observedAt");

-- CreateIndex
CREATE INDEX "exit_health_observations_siteId_tenantId_userId_dedicatedLi_idx" ON "exit_health_observations"("siteId", "tenantId", "userId", "dedicatedLineId", "freshUntil");

-- CreateIndex
CREATE INDEX "node_groups_siteId_tenantId_regionCode_isActive_idx" ON "node_groups"("siteId", "tenantId", "regionCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "node_groups_siteId_code_key" ON "node_groups"("siteId", "code");

-- CreateIndex
CREATE INDEX "control_nodes_siteId_tenantId_nodeGroupId_status_idx" ON "control_nodes"("siteId", "tenantId", "nodeGroupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "control_nodes_siteId_code_key" ON "control_nodes"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "control_nodes_siteId_apiCredentialFingerprint_key" ON "control_nodes"("siteId", "apiCredentialFingerprint");

-- CreateIndex
CREATE INDEX "inbound_profiles_siteId_nodeGroupId_protocol_isActive_idx" ON "inbound_profiles"("siteId", "nodeGroupId", "protocol", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_profiles_siteId_nodeGroupId_code_key" ON "inbound_profiles"("siteId", "nodeGroupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_profiles_siteId_controlNodeId_inboundTag_key" ON "inbound_profiles"("siteId", "controlNodeId", "inboundTag");

-- CreateIndex
CREATE INDEX "line_placement_policies_siteId_tenantId_userId_skuId_isActi_idx" ON "line_placement_policies"("siteId", "tenantId", "userId", "skuId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "line_placement_policies_siteId_nodeGroupId_inboundProfileId_idx" ON "line_placement_policies"("siteId", "nodeGroupId", "inboundProfileId");

-- CreateIndex
CREATE INDEX "dedicated_lines_siteId_tenantId_userId_status_idx" ON "dedicated_lines"("siteId", "tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "dedicated_lines_siteId_status_expiresAt_idx" ON "dedicated_lines"("siteId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_lines_siteId_tenantId_userId_idempotencyKey_key" ON "dedicated_lines"("siteId", "tenantId", "userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_lines_siteId_clientIdentityFingerprint_key" ON "dedicated_lines"("siteId", "clientIdentityFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_lines_siteId_inboundProfileId_clientEmail_key" ON "dedicated_lines"("siteId", "inboundProfileId", "clientEmail");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_placements_dedicatedLineId_key" ON "dedicated_line_placements"("dedicatedLineId");

-- CreateIndex
CREATE INDEX "dedicated_line_placements_siteId_tenantId_userId_nodeGroupI_idx" ON "dedicated_line_placements"("siteId", "tenantId", "userId", "nodeGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_placements_siteId_dedicatedLineId_version_key" ON "dedicated_line_placements"("siteId", "dedicatedLineId", "version");

-- CreateIndex
CREATE INDEX "dedicated_line_placement_nodes_siteId_tenantId_userId_nodeI_idx" ON "dedicated_line_placement_nodes"("siteId", "tenantId", "userId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_placement_nodes_placementId_nodeId_key" ON "dedicated_line_placement_nodes"("placementId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_placement_nodes_placementId_ordinal_key" ON "dedicated_line_placement_nodes"("placementId", "ordinal");

-- CreateIndex
CREATE INDEX "dedicated_line_projections_siteId_tenantId_userId_status_idx" ON "dedicated_line_projections"("siteId", "tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "dedicated_line_projections_nodeId_status_desiredVersion_idx" ON "dedicated_line_projections"("nodeId", "status", "desiredVersion");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_projections_dedicatedLineId_nodeId_key" ON "dedicated_line_projections"("dedicatedLineId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_projections_siteId_projectionKey_key" ON "dedicated_line_projections"("siteId", "projectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_projections_nodeId_nodeExternalId_key" ON "dedicated_line_projections"("nodeId", "nodeExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_exit_assignments_dedicatedLineId_key" ON "dedicated_line_exit_assignments"("dedicatedLineId");

-- CreateIndex
CREATE INDEX "dedicated_line_exit_assignments_siteId_tenantId_userId_stat_idx" ON "dedicated_line_exit_assignments"("siteId", "tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "dedicated_line_exit_assignments_residentialExitId_status_idx" ON "dedicated_line_exit_assignments"("residentialExitId", "status");

-- CreateIndex
CREATE INDEX "delivery_route_imports_siteId_sourceName_capturedAt_idx" ON "delivery_route_imports"("siteId", "sourceName", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_imports_siteId_sourceName_sourceVersion_key" ON "delivery_route_imports"("siteId", "sourceName", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_imports_siteId_sourceFingerprint_key" ON "delivery_route_imports"("siteId", "sourceFingerprint");

-- CreateIndex
CREATE INDEX "delivery_routes_siteId_tenantId_userId_dedicatedLineId_isCu_idx" ON "delivery_routes"("siteId", "tenantId", "userId", "dedicatedLineId", "isCurrent");

-- CreateIndex
CREATE INDEX "delivery_routes_siteId_entranceGroupCode_listenPort_sourceV_idx" ON "delivery_routes"("siteId", "entranceGroupCode", "listenPort", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_routes_routeImportId_sourceRouteId_key" ON "delivery_routes"("routeImportId", "sourceRouteId");

-- CreateIndex
CREATE INDEX "delivery_route_domains_hostname_port_idx" ON "delivery_route_domains"("hostname", "port");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_domains_deliveryRouteId_hostname_port_key" ON "delivery_route_domains"("deliveryRouteId", "hostname", "port");

-- CreateIndex
CREATE INDEX "delivery_route_targets_nodeId_targetPort_targetVersion_idx" ON "delivery_route_targets"("nodeId", "targetPort", "targetVersion");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_targets_deliveryRouteId_nodeId_targetPort_ta_key" ON "delivery_route_targets"("deliveryRouteId", "nodeId", "targetPort", "targetVersion");

-- CreateIndex
CREATE INDEX "dedicated_line_inventory_snapshots_siteId_providerCode_skuI_idx" ON "dedicated_line_inventory_snapshots"("siteId", "providerCode", "skuId", "countryCode", "capturedAt");

-- CreateIndex
CREATE INDEX "dedicated_line_inventory_snapshots_siteId_expiresAt_idx" ON "dedicated_line_inventory_snapshots"("siteId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "line_inventory_snapshot_version_key" ON "dedicated_line_inventory_snapshots"("siteId", "providerAccountId", "skuId", "countryCode", "providerResourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "stock_reservations_siteId_providerAccountId_skuId_countryCo_idx" ON "stock_reservations"("siteId", "providerAccountId", "skuId", "countryCode", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "stock_reservations_inventorySnapshotId_status_idx" ON "stock_reservations"("inventorySnapshotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_scoped_idempotency_key" ON "stock_reservations"("siteId", "tenantId", "userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "external_jobs_status_nextRunAt_leaseExpiresAt_idx" ON "external_jobs"("status", "nextRunAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "external_jobs_siteId_tenantId_userId_aggregateType_aggregat_idx" ON "external_jobs"("siteId", "tenantId", "userId", "aggregateType", "aggregateId", "desiredVersion");

-- CreateIndex
CREATE UNIQUE INDEX "external_jobs_siteId_idempotencyKey_key" ON "external_jobs"("siteId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "external_jobs_siteId_dedupeKey_key" ON "external_jobs"("siteId", "dedupeKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_nextRunAt_leaseExpiresAt_idx" ON "outbox_events"("status", "nextRunAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "outbox_events_siteId_tenantId_userId_aggregateType_aggregat_idx" ON "outbox_events"("siteId", "tenantId", "userId", "aggregateType", "aggregateId", "desiredVersion");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_siteId_idempotencyKey_key" ON "outbox_events"("siteId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_siteId_dedupeKey_key" ON "outbox_events"("siteId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "service_skus" ADD CONSTRAINT "service_skus_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_price_rules" ADD CONSTRAINT "sku_price_rules_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_price_rules" ADD CONSTRAINT "sku_price_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "price_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_price_rules" ADD CONSTRAINT "sku_price_rules_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_price_overrides" ADD CONSTRAINT "sku_price_overrides_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_price_overrides" ADD CONSTRAINT "sku_price_overrides_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sku_price_overrides" ADD CONSTRAINT "user_sku_price_overrides_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sku_price_overrides" ADD CONSTRAINT "user_sku_price_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sku_price_overrides" ADD CONSTRAINT "user_sku_price_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sku_price_overrides" ADD CONSTRAINT "user_sku_price_overrides_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residential_exits" ADD CONSTRAINT "residential_exits_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residential_exits" ADD CONSTRAINT "residential_exits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residential_exits" ADD CONSTRAINT "residential_exits_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_health_observations" ADD CONSTRAINT "exit_health_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_health_observations" ADD CONSTRAINT "exit_health_observations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_health_observations" ADD CONSTRAINT "exit_health_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_health_observations" ADD CONSTRAINT "exit_health_observations_residentialExitId_fkey" FOREIGN KEY ("residentialExitId") REFERENCES "residential_exits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_health_observations" ADD CONSTRAINT "exit_health_observations_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_groups" ADD CONSTRAINT "node_groups_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_groups" ADD CONSTRAINT "node_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_nodes" ADD CONSTRAINT "control_nodes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_nodes" ADD CONSTRAINT "control_nodes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_nodes" ADD CONSTRAINT "control_nodes_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "node_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_profiles" ADD CONSTRAINT "inbound_profiles_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_profiles" ADD CONSTRAINT "inbound_profiles_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "node_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_profiles" ADD CONSTRAINT "inbound_profiles_controlNodeId_fkey" FOREIGN KEY ("controlNodeId") REFERENCES "control_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "node_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policies" ADD CONSTRAINT "line_placement_policies_inboundProfileId_fkey" FOREIGN KEY ("inboundProfileId") REFERENCES "inbound_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_inboundProfileId_fkey" FOREIGN KEY ("inboundProfileId") REFERENCES "inbound_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "line_placement_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placements" ADD CONSTRAINT "dedicated_line_placements_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "node_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placement_nodes" ADD CONSTRAINT "dedicated_line_placement_nodes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placement_nodes" ADD CONSTRAINT "dedicated_line_placement_nodes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placement_nodes" ADD CONSTRAINT "dedicated_line_placement_nodes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placement_nodes" ADD CONSTRAINT "dedicated_line_placement_nodes_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "dedicated_line_placements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_placement_nodes" ADD CONSTRAINT "dedicated_line_placement_nodes_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_exit_assignments" ADD CONSTRAINT "dedicated_line_exit_assignments_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_exit_assignments" ADD CONSTRAINT "dedicated_line_exit_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_exit_assignments" ADD CONSTRAINT "dedicated_line_exit_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_exit_assignments" ADD CONSTRAINT "dedicated_line_exit_assignments_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_exit_assignments" ADD CONSTRAINT "dedicated_line_exit_assignments_residentialExitId_fkey" FOREIGN KEY ("residentialExitId") REFERENCES "residential_exits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_imports" ADD CONSTRAINT "delivery_route_imports_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_routeImportId_fkey" FOREIGN KEY ("routeImportId") REFERENCES "delivery_route_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_domains" ADD CONSTRAINT "delivery_route_domains_deliveryRouteId_fkey" FOREIGN KEY ("deliveryRouteId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_targets" ADD CONSTRAINT "delivery_route_targets_deliveryRouteId_fkey" FOREIGN KEY ("deliveryRouteId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_targets" ADD CONSTRAINT "delivery_route_targets_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_inventory_snapshots" ADD CONSTRAINT "dedicated_line_inventory_snapshots_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_inventory_snapshots" ADD CONSTRAINT "dedicated_line_inventory_snapshots_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_inventory_snapshots" ADD CONSTRAINT "dedicated_line_inventory_snapshots_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventorySnapshotId_fkey" FOREIGN KEY ("inventorySnapshotId") REFERENCES "dedicated_line_inventory_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "service_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_jobs" ADD CONSTRAINT "external_jobs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_jobs" ADD CONSTRAINT "external_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_jobs" ADD CONSTRAINT "external_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_jobs" ADD CONSTRAINT "external_jobs_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants that must hold even when a writer bypasses the API.
ALTER TABLE "service_skus"
  ADD CONSTRAINT "service_skus_code_not_blank" CHECK (length(btrim("code")) > 0),
  ADD CONSTRAINT "service_skus_contract_version_positive" CHECK ("contractVersion" > 0);
ALTER TABLE "sku_price_rules"
  ADD CONSTRAINT "sku_price_rules_values_valid" CHECK ("durationDays" > 0 AND "minQty" > 0 AND "unitPrice" >= 0);
ALTER TABLE "sku_price_overrides"
  ADD CONSTRAINT "sku_price_overrides_values_valid" CHECK ("durationDays" > 0 AND "minQty" > 0 AND "unitPrice" >= 0);
ALTER TABLE "user_sku_price_overrides"
  ADD CONSTRAINT "user_sku_price_overrides_values_valid" CHECK ("durationDays" > 0 AND "minQty" > 0 AND "unitPrice" >= 0);
ALTER TABLE "control_nodes"
  ADD CONSTRAINT "control_nodes_capacity_positive" CHECK ("capacityUnits" > 0 AND "allocatedUnits" >= 0 AND "allocatedUnits" <= "capacityUnits");
ALTER TABLE "inbound_profiles"
  ADD CONSTRAINT "inbound_profiles_port_valid" CHECK ("listenPort" BETWEEN 1 AND 65535);
ALTER TABLE "line_placement_policies"
  ADD CONSTRAINT "line_placement_policies_replica_bounds" CHECK ("targetReplicaCount" > 0 AND "minReadyReplicaCount" > 0 AND "minReadyReplicaCount" <= "targetReplicaCount" AND "maxUnitsPerNode" > 0);
ALTER TABLE "dedicated_line_placements"
  ADD CONSTRAINT "dedicated_line_placements_replica_bounds" CHECK ("targetReplicaCount" > 0 AND "minReadyReplicaCount" > 0 AND "minReadyReplicaCount" <= "targetReplicaCount");
ALTER TABLE "dedicated_line_placement_nodes"
  ADD CONSTRAINT "dedicated_line_placement_nodes_ordinal_positive" CHECK ("ordinal" >= 0);
ALTER TABLE "dedicated_lines"
  ADD CONSTRAINT "dedicated_lines_desired_version_positive" CHECK ("desiredVersion" > 0),
  ADD CONSTRAINT "dedicated_lines_limits_non_negative" CHECK (("quotaBytes" IS NULL OR "quotaBytes" >= 0) AND ("uplinkLimitBps" IS NULL OR "uplinkLimitBps" >= 0) AND ("downlinkLimitBps" IS NULL OR "downlinkLimitBps" >= 0) AND ("maxConnections" IS NULL OR "maxConnections" > 0));
ALTER TABLE "residential_exits"
  ADD CONSTRAINT "residential_exits_fanout_positive" CHECK ("maxReplicaFanout" > 0);
ALTER TABLE "delivery_routes"
  ADD CONSTRAINT "delivery_routes_port_valid" CHECK ("listenPort" BETWEEN 1 AND 65535);
ALTER TABLE "delivery_route_domains"
  ADD CONSTRAINT "delivery_route_domains_port_valid" CHECK ("port" BETWEEN 1 AND 65535);
ALTER TABLE "delivery_route_targets"
  ADD CONSTRAINT "delivery_route_targets_port_valid" CHECK ("targetPort" BETWEEN 1 AND 65535);
ALTER TABLE "dedicated_line_inventory_snapshots"
  ADD CONSTRAINT "dedicated_line_inventory_snapshots_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "dedicated_line_inventory_snapshots"
  ADD CONSTRAINT "dedicated_line_inventory_snapshots_reserved_quantity_valid" CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity");
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0);
