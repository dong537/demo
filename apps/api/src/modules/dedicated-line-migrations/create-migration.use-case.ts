import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { computeNodeDelta, MigrationPhase, MigrationStatus } from './domain';
import { DedicatedLineMigrationSummary } from './dto';
import { ConfigService } from '../../common/config/config.service';
import { buildManagedLineProjectionRequest } from '../dedicated-line-projections/build-managed-line-projection-request';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';

@Injectable()
export class CreateDedicatedLineMigrationUseCase {
  constructor(private readonly config: ConfigService) {}
  async execute(ctx: AuthenticatedContext, lineId: string, body: unknown): Promise<DedicatedLineMigrationSummary> {
    requireOperatorContext(ctx);
    const input = normalizeInput(body);
    return prisma.$transaction(async (tx) => {
      const line = await tx.dedicated_lines.findFirst({
        where: { id: lineId, siteId: ctx.siteId },
        include: {
          inboundProfile: true,
          placement: { include: { nodes: true } },
          exitAssignment: { include: { residentialExit: true } },
          activeMigration: true,
        },
      });
      if (!line?.placement || !line.exitAssignment) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);
      const replay = await tx.dedicated_line_migrations.findUnique({
        where: { siteId_idempotencyKey: { siteId: ctx.siteId, idempotencyKey: input.idempotencyKey } },
        include: { nodes: true },
      });
      if (replay) {
        if (replay.dedicatedLineId !== line.id || replay.type !== input.type || replay.reason !== input.reason) {
          throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_idempotency_conflict', 409);
        }
        return summary(replay, replay.nodes);
      }
      if (line.activeMigration) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'line_migration_already_active', 409);
      const sourceNodeIds = line.placement.nodes.map((node) => node.nodeId);
      const targetNodeIds = input.type === 'EXIT_ONLY' ? sourceNodeIds : input.targetNodeIds;
      const delta = computeNodeDelta(sourceNodeIds, targetNodeIds);
      if (input.type === 'EXIT_ONLY') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_exit_only_staging_unsupported', 422);
      }
      if (delta.retained.length > 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_retained_node_staging_unsupported', 422);
      }
      const policy = line.placement.policyId
        ? await tx.line_placement_policies.findUnique({ where: { id: line.placement.policyId }, include: { allowedNodes: true } })
        : null;
      if (!policy || policy.allowedNodes.length === 0) throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'migration_placement_policy_missing', 422);
      const allowed = new Set(policy.allowedNodes.map((node) => node.nodeId));
      if (targetNodeIds.some((nodeId) => !allowed.has(nodeId))) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_target_node_not_allowed', 422);
      if (targetNodeIds.length !== line.placement.targetReplicaCount) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_target_replica_count_invalid', 422);
      const targetNodes = await tx.control_nodes.findMany({ where: { id: { in: targetNodeIds }, siteId: ctx.siteId, status: 'ACTIVE' }, select: { id: true, capacityUnits: true, allocatedUnits: true } });
      if (targetNodes.length !== targetNodeIds.length || targetNodes.some((node) => delta.reserve.includes(node.id) && Math.min(node.capacityUnits, policy.maxUnitsPerNode) - node.allocatedUnits < 1)) {
        throw new AppError(ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED, 'migration_target_node_capacity_exhausted', 422);
      }
      if (input.targetExitId) {
        const targetExit = await tx.residential_exits.findFirst({ where: {
          id: input.targetExitId, siteId: ctx.siteId, tenantId: line.tenantId, status: 'AVAILABLE', countryCode: line.countryCode,
          expiresAt: { gt: new Date() }, maxReplicaFanout: { gte: line.placement.targetReplicaCount },
        }, select: { id: true } });
        if (!targetExit) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_target_exit_invalid', 422);
        const reserved = await tx.residential_exits.updateMany({ where: { id: targetExit.id, status: 'AVAILABLE' }, data: { status: 'RESERVED' } });
        if (reserved.count !== 1) throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'migration_target_exit_unavailable', 422);
      }
      for (const nodeId of delta.reserve) {
        const updated = await tx.control_nodes.updateMany({ where: { id: nodeId, status: 'ACTIVE', allocatedUnits: { lt: policy.maxUnitsPerNode } }, data: { allocatedUnits: { increment: 1 } } });
        if (updated.count !== 1) throw new AppError(ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED, 'migration_target_node_capacity_exhausted', 422);
      }
      const migration = await tx.dedicated_line_migrations.create({
        data: {
          siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, dedicatedLineId: line.id, type: input.type,
          reason: input.reason, idempotencyKey: input.idempotencyKey, requestedBy: ctx.ownerId,
          sourceLineVersion: line.desiredVersion, targetLineVersion: line.desiredVersion + 1,
          sourcePlacementId: line.placement.id, sourceExitId: line.exitAssignment.residentialExitId,
          targetExitId: input.targetExitId,
          nodes: { create: [
            ...sourceNodeIds.map((nodeId, ordinal) => ({ nodeId, role: 'SOURCE' as const, ordinal, reservedUnits: 0, reservationStatus: 'RELEASED' as const })),
            ...targetNodeIds.map((nodeId, ordinal) => ({ nodeId, role: 'TARGET' as const, ordinal, reservedUnits: delta.reserve.includes(nodeId) ? 1 : 0, reservationStatus: delta.reserve.includes(nodeId) ? 'RESERVED' as const : 'RELEASED' as const })),
          ] },
        },
        include: { nodes: true },
      });
      const targetExitId = input.targetExitId ?? line.exitAssignment.residentialExitId;
      const targetExit = input.targetExitId ? await tx.residential_exits.findUnique({ where: { id: input.targetExitId } }) : line.exitAssignment.residentialExit;
      if (!targetExit) throw new AppError(ErrorCode.NOT_FOUND, 'migration_target_exit_not_found', 404);
      const targetRequest = buildManagedLineProjectionRequest({ desiredVersion: line.desiredVersion + 1, inboundTag: line.inboundProfile?.inboundTag ?? '', protocol: line.protocol, clientEmail: line.clientEmail, clientIdentityCiphertext: line.clientIdentityCiphertext, lineStatus: line.status, expiresAt: line.expiresAt, quotaBytes: line.quotaBytes, uplinkLimitBps: line.uplinkLimitBps, downlinkLimitBps: line.downlinkLimitBps, maxConnections: line.maxConnections, ipLimit: line.ipLimit, endpointCiphertext: targetExit.endpointCiphertext, credentialCiphertext: targetExit.credentialCiphertext }, this.config.get('APP_ENCRYPTION_KEY'));
      const targetHash = managedLineProjectionDesiredHash(targetRequest);
      const targetVersion = line.desiredVersion + 1;
      for (const nodeId of targetNodeIds) {
        const projection = await tx.dedicated_line_projections.create({
          data: {
            siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, dedicatedLineId: line.id, migrationId: migration.id,
            nodeId, projectionKey: `${line.id}:${nodeId}:v${targetVersion}`, desiredVersion: targetVersion, desiredHash: targetHash,
          },
        });
        await tx.dedicated_line_migration_nodes.update({ where: { migrationId_nodeId_role: { migrationId: migration.id, nodeId, role: 'TARGET' } }, data: { projectionId: projection.id } });
        const jobKey = `migration-projection:${migration.id}:${nodeId}:v${targetVersion}`;
        await tx.external_jobs.create({
          data: { siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, dedicatedLineId: line.id, kind: 'APPLY_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: projection.id, desiredVersion: targetVersion, idempotencyKey: jobKey, dedupeKey: jobKey, payload: { projectionKey: projection.projectionKey, migrationId: migration.id, exitId: targetExitId } },
        });
      }
      await tx.dedicated_lines.update({ where: { id: line.id }, data: { activeMigrationId: migration.id } });
      await tx.audit_logs.create({ data: { siteId: ctx.siteId, tenantId: line.tenantId, actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER', actorId: ctx.ownerId, targetType: 'dedicated_line_migration', targetId: migration.id, action: 'dedicated_line.migration.create', reason: input.reason, requestId: ctx.requestId, meta: { type: input.type, sourceNodeIds, targetNodeIds, sourceExitId: line.exitAssignment.residentialExitId, targetExitId: input.targetExitId } } });
      return summary(migration, migration.nodes);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function normalizeInput(body: unknown): { type: 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL'; targetNodeIds: string[]; targetExitId: string | null; reason: string; idempotencyKey: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_body_invalid', 400);
  const value = body as Record<string, unknown>;
  const type = value.type;
  if (type !== 'NODE_ONLY' && type !== 'EXIT_ONLY' && type !== 'FULL') throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_type_invalid', 400);
  const targetNodeIds = type === 'EXIT_ONLY' ? [] : stringList(value.targetNodeIds, 'migration_target_nodes_required');
  const targetExitId = type === 'NODE_ONLY' ? null : token(value.targetExitId, 'migration_target_exit_required');
  return { type, targetNodeIds, targetExitId, reason: token(value.reason, 'migration_reason_required'), idempotencyKey: token(value.idempotencyKey, 'migration_idempotency_required') };
}

function token(value: unknown, reasonKey: string): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400); return value.trim(); }
function stringList(value: unknown, reasonKey: string): string[] { if (!Array.isArray(value) || value.length === 0) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400); const result = value.map((item) => token(item, 'migration_target_node_invalid')); if (new Set(result).size !== result.length) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_target_nodes_duplicate', 422); return result; }
function summary(row: { id: string; dedicatedLineId: string; type: 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL'; phase: MigrationPhase; status: MigrationStatus; sourceExitId: string; targetExitId: string | null }, nodes: Array<{ nodeId: string; role: 'SOURCE' | 'TARGET' }>): DedicatedLineMigrationSummary { return { id: row.id, lineId: row.dedicatedLineId, type: row.type, phase: row.phase, status: row.status, sourceNodeIds: nodes.filter((node) => node.role === 'SOURCE').map((node) => node.nodeId), targetNodeIds: nodes.filter((node) => node.role === 'TARGET').map((node) => node.nodeId), sourceExitId: row.sourceExitId, targetExitId: row.targetExitId }; }
