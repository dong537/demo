-- CreateEnum
CREATE TYPE "LineDomainRole" AS ENUM ('PRIMARY', 'BACKUP');

-- CreateEnum
CREATE TYPE "LineDomainStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "DedicatedLineMigrationType" AS ENUM ('NODE_ONLY', 'EXIT_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "DedicatedLineMigrationPhase" AS ENUM ('PREPARE', 'CANARY_ROUTE', 'VERIFY', 'CUTOVER_ROUTE', 'COMMIT', 'CLEANUP', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "DedicatedLineMigrationStatus" AS ENUM ('ACTIVE', 'NEEDS_OPERATOR', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DedicatedLineMigrationNodeRole" AS ENUM ('SOURCE', 'TARGET');

-- CreateEnum
CREATE TYPE "MigrationNodeReservationStatus" AS ENUM ('RESERVED', 'RELEASED');

-- CreateEnum
CREATE TYPE "MigrationSmokeStage" AS ENUM ('CANARY', 'CUTOVER', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "DeliveryRouteStage" AS ENUM ('INITIAL', 'CANARY', 'CUTOVER', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "MigrationRecommendationStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

-- DropIndex
DROP INDEX "dedicated_line_projections_dedicatedLineId_nodeId_key";

-- AlterTable
ALTER TABLE "dedicated_lines" ADD COLUMN     "activeMigrationId" TEXT;

-- AlterTable
ALTER TABLE "dedicated_line_projections" ADD COLUMN     "migrationId" TEXT;

-- AlterTable
ALTER TABLE "delivery_routes" ADD COLUMN     "isStaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "migrationId" TEXT,
ADD COLUMN     "migrationStage" "DeliveryRouteStage";

-- CreateTable
CREATE TABLE "line_placement_policy_nodes" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_placement_policy_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_domains" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "role" "LineDomainRole" NOT NULL,
    "status" "LineDomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "retiredReason" TEXT,

    CONSTRAINT "dedicated_line_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_domain_binding_operations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dedicated_line_domain_binding_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_migrations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "type" "DedicatedLineMigrationType" NOT NULL,
    "phase" "DedicatedLineMigrationPhase" NOT NULL DEFAULT 'PREPARE',
    "status" "DedicatedLineMigrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceLineVersion" INTEGER NOT NULL,
    "targetLineVersion" INTEGER NOT NULL,
    "sourcePlacementId" TEXT NOT NULL,
    "targetPlacementId" TEXT,
    "sourceExitId" TEXT NOT NULL,
    "targetExitId" TEXT,
    "canaryRouteImportId" TEXT,
    "cutoverRouteImportId" TEXT,
    "rollbackRouteImportId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorDetail" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "committedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedicated_line_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_migration_nodes" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "role" "DedicatedLineMigrationNodeRole" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "reservationStatus" "MigrationNodeReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "projectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "dedicated_line_migration_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_smoke_observations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "stage" "MigrationSmokeStage" NOT NULL,
    "hostname" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "observedIp" TEXT,
    "observedCountryCode" TEXT,
    "latencyMs" INTEGER,
    "failureType" TEXT,
    "failureDetail" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedicated_line_smoke_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_node_health_observations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "projectionKey" TEXT,
    "reachable" BOOLEAN NOT NULL,
    "observedVersion" INTEGER,
    "observedHash" TEXT,
    "latencyMs" INTEGER,
    "failureType" TEXT,
    "failureDetail" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_node_health_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_migration_recommendations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedicatedLineId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "incidentVersion" INTEGER NOT NULL,
    "status" "MigrationRecommendationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "migrationId" TEXT,

    CONSTRAINT "dedicated_line_migration_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedicated_line_migration_recommendation_nodes" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dedicated_line_migration_recommendation_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "line_placement_policy_nodes_siteId_nodeId_idx" ON "line_placement_policy_nodes"("siteId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "line_placement_policy_nodes_policyId_nodeId_key" ON "line_placement_policy_nodes"("policyId", "nodeId");

-- CreateIndex
CREATE INDEX "dedicated_line_domains_siteId_dedicatedLineId_status_role_idx" ON "dedicated_line_domains"("siteId", "dedicatedLineId", "status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_domains_siteId_hostname_port_key" ON "dedicated_line_domains"("siteId", "hostname", "port");

-- CreateIndex
CREATE INDEX "dedicated_line_domain_binding_operations_siteId_tenantId_us_idx" ON "dedicated_line_domain_binding_operations"("siteId", "tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_domain_binding_operations_siteId_dedicatedLi_key" ON "dedicated_line_domain_binding_operations"("siteId", "dedicatedLineId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "dedicated_line_migrations_siteId_tenantId_userId_status_pha_idx" ON "dedicated_line_migrations"("siteId", "tenantId", "userId", "status", "phase");

-- CreateIndex
CREATE INDEX "dedicated_line_migrations_dedicatedLineId_status_createdAt_idx" ON "dedicated_line_migrations"("dedicatedLineId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_migrations_siteId_idempotencyKey_key" ON "dedicated_line_migrations"("siteId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "dedicated_line_migration_nodes_nodeId_reservationStatus_idx" ON "dedicated_line_migration_nodes"("nodeId", "reservationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_migration_nodes_migrationId_nodeId_role_key" ON "dedicated_line_migration_nodes"("migrationId", "nodeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_migration_nodes_migrationId_role_ordinal_key" ON "dedicated_line_migration_nodes"("migrationId", "role", "ordinal");

-- CreateIndex
CREATE INDEX "dedicated_line_smoke_observations_siteId_dedicatedLineId_mi_idx" ON "dedicated_line_smoke_observations"("siteId", "dedicatedLineId", "migrationId", "stage", "observedAt");

-- CreateIndex
CREATE INDEX "control_node_health_observations_siteId_nodeId_observedAt_idx" ON "control_node_health_observations"("siteId", "nodeId", "observedAt");

-- CreateIndex
CREATE INDEX "dedicated_line_migration_recommendations_siteId_tenantId_us_idx" ON "dedicated_line_migration_recommendations"("siteId", "tenantId", "userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_migration_recommendations_dedicatedLineId_so_key" ON "dedicated_line_migration_recommendations"("dedicatedLineId", "sourceNodeId", "incidentVersion");

-- CreateIndex
CREATE INDEX "dedicated_line_migration_recommendation_nodes_siteId_nodeId_idx" ON "dedicated_line_migration_recommendation_nodes"("siteId", "nodeId", "eligible");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_migration_recommendation_nodes_recommendatio_key" ON "dedicated_line_migration_recommendation_nodes"("recommendationId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_lines_activeMigrationId_key" ON "dedicated_lines"("activeMigrationId");

-- CreateIndex
CREATE UNIQUE INDEX "dedicated_line_projections_dedicatedLineId_nodeId_desiredVe_key" ON "dedicated_line_projections"("dedicatedLineId", "nodeId", "desiredVersion");

-- AddForeignKey
ALTER TABLE "line_placement_policy_nodes" ADD CONSTRAINT "line_placement_policy_nodes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policy_nodes" ADD CONSTRAINT "line_placement_policy_nodes_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "line_placement_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_placement_policy_nodes" ADD CONSTRAINT "line_placement_policy_nodes_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_lines" ADD CONSTRAINT "dedicated_lines_activeMigrationId_fkey" FOREIGN KEY ("activeMigrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_projections" ADD CONSTRAINT "dedicated_line_projections_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domains" ADD CONSTRAINT "dedicated_line_domains_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domains" ADD CONSTRAINT "dedicated_line_domains_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domain_binding_operations" ADD CONSTRAINT "dedicated_line_domain_binding_operations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domain_binding_operations" ADD CONSTRAINT "dedicated_line_domain_binding_operations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domain_binding_operations" ADD CONSTRAINT "dedicated_line_domain_binding_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_domain_binding_operations" ADD CONSTRAINT "dedicated_line_domain_binding_operations_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_sourceExitId_fkey" FOREIGN KEY ("sourceExitId") REFERENCES "residential_exits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_targetExitId_fkey" FOREIGN KEY ("targetExitId") REFERENCES "residential_exits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_canaryRouteImportId_fkey" FOREIGN KEY ("canaryRouteImportId") REFERENCES "delivery_route_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_cutoverRouteImportId_fkey" FOREIGN KEY ("cutoverRouteImportId") REFERENCES "delivery_route_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migrations" ADD CONSTRAINT "dedicated_line_migrations_rollbackRouteImportId_fkey" FOREIGN KEY ("rollbackRouteImportId") REFERENCES "delivery_route_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_nodes" ADD CONSTRAINT "dedicated_line_migration_nodes_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_nodes" ADD CONSTRAINT "dedicated_line_migration_nodes_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_smoke_observations" ADD CONSTRAINT "dedicated_line_smoke_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_smoke_observations" ADD CONSTRAINT "dedicated_line_smoke_observations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_smoke_observations" ADD CONSTRAINT "dedicated_line_smoke_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_smoke_observations" ADD CONSTRAINT "dedicated_line_smoke_observations_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_smoke_observations" ADD CONSTRAINT "dedicated_line_smoke_observations_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_node_health_observations" ADD CONSTRAINT "control_node_health_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_node_health_observations" ADD CONSTRAINT "control_node_health_observations_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_dedicatedLineId_fkey" FOREIGN KEY ("dedicatedLineId") REFERENCES "dedicated_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendations" ADD CONSTRAINT "dedicated_line_migration_recommendations_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "dedicated_line_migrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendation_nodes" ADD CONSTRAINT "dedicated_line_migration_recommendation_nodes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendation_nodes" ADD CONSTRAINT "dedicated_line_migration_recommendation_nodes_recommendati_fkey" FOREIGN KEY ("recommendationId") REFERENCES "dedicated_line_migration_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedicated_line_migration_recommendation_nodes" ADD CONSTRAINT "dedicated_line_migration_recommendation_nodes_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "control_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
