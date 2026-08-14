import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertMigrationTransition } from './domain';
import { buildManagedLineProjectionRequest } from '../dedicated-line-projections/build-managed-line-projection-request';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';
import { ConfigService } from '../../common/config/config.service';

@Injectable()
export class CommitDedicatedLineMigrationUseCase {
  constructor(private readonly config: ConfigService) {}

  async execute(ctx: AuthenticatedContext, migrationId: string) {
    requireOperatorContext(ctx);
    return prisma.$transaction(async (tx) => {
      const migration = await tx.dedicated_line_migrations.findFirst({ where: { id: migrationId, siteId: ctx.siteId }, include: { targetExit: true, dedicatedLine: { include: { inboundProfile: true, placement: { include: { nodes: true } }, exitAssignment: { include: { residentialExit: true } } } }, nodes: true, smokeObservations: { where: { verified: true }, orderBy: { observedAt: 'desc' } }, cutoverRouteImport: { select: { id: true } } } });
      if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      const line = migration.dedicatedLine;
      if (line.desiredVersion !== migration.sourceLineVersion) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'line_version_conflict', 409);
      if (migration.type !== 'EXIT_ONLY' && !migration.cutoverRouteImport) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_cutover_route_missing', 422);
      const sourceNodes = migration.nodes.filter((node) => node.role === 'SOURCE').map((node) => node.nodeId);
      const sourceNodeIds = new Set(sourceNodes);
      const targetNodes = migration.nodes.filter((node) => node.role === 'TARGET').map((node) => node.nodeId);
      const targetNodeIds = new Set(targetNodes);
      const targetProjections = await tx.dedicated_line_projections.findMany({ where: { migrationId: migration.id }, select: { id: true, nodeId: true, projectionKey: true, status: true, desiredVersion: true, observedVersion: true } });
      if (
        targetProjections.length !== targetNodes.length
        || targetProjections.some((projection) =>
          !targetNodeIds.has(projection.nodeId)
          || projection.status !== 'READY'
          || projection.desiredVersion !== migration.targetLineVersion
          || projection.observedVersion !== migration.targetLineVersion,
        )
      ) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_target_projection_not_ready', 422);
      const currentProjections = await tx.dedicated_line_projections.findMany({
        where: { dedicatedLineId: line.id, migrationId: null },
        select: { id: true, nodeId: true, projectionKey: true, status: true, desiredVersion: true, observedVersion: true },
      });
      if (
        currentProjections.length !== sourceNodes.length
        || new Set(currentProjections.map((projection) => projection.nodeId)).size !== sourceNodeIds.size
        || currentProjections.some((projection) =>
          !sourceNodeIds.has(projection.nodeId)
          || !projection.projectionKey
          || projection.status !== 'READY'
          || projection.desiredVersion !== migration.sourceLineVersion
          || projection.observedVersion !== migration.sourceLineVersion,
        )
      ) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_source_projection_not_ready', 422);
      const smoke = migration.smokeObservations[0];
      if (!smoke || !smoke.verified || smoke.freshUntil.getTime() <= Date.now()) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_smoke_missing_or_stale', 422);
      assertMigrationTransition({ type: migration.type, phase: migration.phase, status: migration.status }, { type: 'COMMIT' });
      const targetVersion = migration.targetLineVersion;
      if (migration.type !== 'EXIT_ONLY') {
        await tx.dedicated_line_placements.update({ where: { id: line.placement!.id }, data: { version: targetVersion, assignmentFingerprint: `migration:${migration.id}`, changeReason: 'MIGRATION', nodes: { deleteMany: {}, create: targetNodes.map((nodeId, ordinal) => ({ siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, nodeId, ordinal })) } } });
      }
      if (migration.targetExitId) {
        await tx.dedicated_line_exit_assignments.update({ where: { id: line.exitAssignment!.id }, data: { residentialExitId: migration.targetExitId, releaseReason: `migration:${migration.id}` } });
        await tx.residential_exits.update({ where: { id: migration.targetExitId }, data: { status: 'ASSIGNED' } });
      }
      const targetExit = migration.targetExitId ? migration.targetExit : line.exitAssignment?.residentialExit;
      if (!targetExit) throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_assignment_missing', 500);
      const targetRequest = buildManagedLineProjectionRequest({
        desiredVersion: targetVersion,
        inboundTag: line.inboundProfile.inboundTag,
        protocol: line.protocol,
        clientEmail: line.clientEmail,
        clientIdentityCiphertext: line.clientIdentityCiphertext,
        lineStatus: 'ACTIVE',
        expiresAt: line.expiresAt,
        quotaBytes: line.quotaBytes,
        uplinkLimitBps: line.uplinkLimitBps,
        downlinkLimitBps: line.downlinkLimitBps,
        maxConnections: line.maxConnections,
        ipLimit: line.ipLimit,
        endpointCiphertext: targetExit.endpointCiphertext,
        credentialCiphertext: targetExit.credentialCiphertext,
      }, this.config.get('APP_ENCRYPTION_KEY'));
      const targetHash = managedLineProjectionDesiredHash(targetRequest);
      const currentRoutes = migration.type === 'EXIT_ONLY' ? [] : await tx.delivery_routes.findMany({ where: { dedicatedLineId: line.id, migrationId: migration.id, migrationStage: 'CUTOVER' }, select: { id: true } });
      if (migration.type !== 'EXIT_ONLY' && currentRoutes.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_cutover_route_missing', 422);
      }
      if (currentRoutes.length > 0) {
        await tx.delivery_routes.updateMany({ where: { dedicatedLineId: line.id, isCurrent: true }, data: { isCurrent: false } });
        await tx.delivery_routes.updateMany({ where: { id: { in: currentRoutes.map((route) => route.id) } }, data: { isCurrent: true, isStaged: false } });
      }
      const targetProjectionIds = targetProjections.map((projection) => projection.id);
      const currentProjectionIds = currentProjections.map((projection) => projection.id);
      if (currentProjectionIds.length > 0) {
        await tx.external_jobs.deleteMany({ where: { aggregateId: { in: currentProjectionIds }, kind: 'APPLY_DEDICATED_LINE_PROJECTION', status: { in: ['QUEUED', 'RETRYING'] } } });
        for (const projection of currentProjections) {
          await tx.dedicated_line_migration_nodes.update({
            where: { migrationId_nodeId_role: { migrationId: migration.id, nodeId: projection.nodeId, role: 'SOURCE' } },
            data: { projectionId: projection.id },
          });
          const deleteVersion = projection.desiredVersion + 1;
          const deleteKey = `delete_dedicated_line_projection:${migration.id}:${projection.id}:v${deleteVersion}`;
          await tx.external_jobs.create({
            data: {
              siteId: ctx.siteId,
              tenantId: line.tenantId,
              userId: line.userId,
              dedicatedLineId: line.id,
              kind: 'DELETE_DEDICATED_LINE_PROJECTION',
              aggregateType: 'dedicated_line_projection',
              aggregateId: projection.id,
              desiredVersion: deleteVersion,
              idempotencyKey: deleteKey,
              dedupeKey: deleteKey,
              payload: { migrationId: migration.id, projectionKey: projection.projectionKey, projectionDesiredVersion: projection.desiredVersion },
            },
          });
        }
      }
      for (const projection of targetProjections) {
        await tx.dedicated_line_projections.update({
          where: { id: projection.id },
          data: {
            migrationId: null,
            desiredVersion: targetVersion,
            desiredHash: targetHash,
            status: 'PENDING',
            observedVersion: null,
            observedHash: null,
            lastAppliedAt: null,
            lastObservedAt: null,
            lastErrorCode: null,
            lastErrorDetail: Prisma.JsonNull,
          },
        });
        const jobKey = `migration-commit-projection:${migration.id}:${projection.nodeId}:v${targetVersion}`;
        await tx.external_jobs.create({
          data: {
            siteId: ctx.siteId,
            tenantId: line.tenantId,
            userId: line.userId,
            dedicatedLineId: line.id,
            kind: 'APPLY_DEDICATED_LINE_PROJECTION',
            aggregateType: 'dedicated_line_projection',
            aggregateId: projection.id,
            desiredVersion: targetVersion,
            idempotencyKey: jobKey,
            dedupeKey: jobKey,
            payload: { projectionKey: projection.projectionKey, migrationId: migration.id, exitId: migration.targetExitId ?? line.exitAssignment?.residentialExitId },
          },
        });
      }
      const cleanupKey = `cleanup_dedicated_line_migration:${migration.id}:v${targetVersion}`;
      await tx.external_jobs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: line.tenantId,
          userId: line.userId,
          dedicatedLineId: line.id,
          kind: 'CLEANUP_DEDICATED_LINE_MIGRATION',
          aggregateType: 'dedicated_line_migration',
          aggregateId: migration.id,
          desiredVersion: targetVersion,
          idempotencyKey: cleanupKey,
          dedupeKey: cleanupKey,
          payload: { migrationId: migration.id },
        },
      });
      await tx.dedicated_lines.update({ where: { id: line.id }, data: { desiredVersion: targetVersion, activeMigrationId: migration.id, status: 'PROVISIONING' } });
      await tx.dedicated_line_migrations.update({ where: { id: migration.id }, data: { phase: 'CLEANUP', committedAt: new Date() } });
      await tx.audit_logs.create({ data: { siteId: ctx.siteId, tenantId: line.tenantId, actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER', actorId: ctx.ownerId, targetType: 'dedicated_line_migration', targetId: migration.id, action: 'dedicated_line.migration.commit', reason: migration.reason, requestId: ctx.requestId, meta: { targetVersion, targetNodes, targetExitId: migration.targetExitId, targetProjectionIds } } });
      return { migrationId: migration.id, phase: 'CLEANUP', status: 'ACTIVE' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
