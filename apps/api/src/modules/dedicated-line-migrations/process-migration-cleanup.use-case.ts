import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertMigrationTransition } from './domain';

export type MigrationCleanupResult =
  | { status: 'WAITING'; migrationId: string }
  | { status: 'COMPLETED'; migrationId: string; migrationStatus: 'COMPLETED' | 'CANCELLED' };

@Injectable()
export class ProcessMigrationCleanupUseCase {
  async execute(migrationId: string): Promise<MigrationCleanupResult> {
    return prisma.$transaction(async (tx) => {
      const migration = await tx.dedicated_line_migrations.findUnique({ where: { id: migrationId }, include: { nodes: true } });
      if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      if (migration.status === 'COMPLETED' || (migration.status === 'CANCELLED' && migration.finishedAt !== null)) {
        return { status: 'COMPLETED', migrationId: migration.id, migrationStatus: migration.status };
      }
      if (migration.phase !== 'CLEANUP' || !['ACTIVE', 'CANCELLED'].includes(migration.status)) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_phase_invalid', 409);
      }
      const line = await tx.dedicated_lines.findUnique({
        where: { id: migration.dedicatedLineId },
        select: { desiredVersion: true, status: true, activeMigrationId: true, exitAssignment: { select: { residentialExitId: true } } },
      });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);

      const committed = migration.committedAt !== null;
      const sourceNodes = migration.nodes.filter((node) => node.role === 'SOURCE');
      const targetNodes = migration.nodes.filter((node) => node.role === 'TARGET');
      const sourceProjectionIds = projectionIds(sourceNodes);
      const targetProjectionIds = projectionIds(targetNodes);
      const deleteProjectionIds = committed ? sourceProjectionIds : targetProjectionIds;
      if (committed && sourceProjectionIds.length !== sourceNodes.length) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'migration_source_projection_link_missing', 500);
      }
      if (!committed && targetProjectionIds.length !== targetNodes.length) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'migration_target_projection_link_missing', 500);
      }
      if (!await remoteDeletesCompleted(tx, migration.id, deleteProjectionIds)) {
        return { status: 'WAITING', migrationId: migration.id };
      }

      if (committed) {
        if (
          line.activeMigrationId !== migration.id
          || line.desiredVersion !== migration.targetLineVersion
          || line.status !== 'ACTIVE'
          || (migration.targetExitId !== null && line.exitAssignment?.residentialExitId !== migration.targetExitId)
        ) {
          return { status: 'WAITING', migrationId: migration.id };
        }
        const targetProjections = targetProjectionIds.length === 0 ? [] : await tx.dedicated_line_projections.findMany({
          where: { id: { in: targetProjectionIds } },
          select: { id: true, status: true, desiredVersion: true, observedVersion: true, migrationId: true },
        });
        if (
          targetProjections.length !== targetProjectionIds.length
          || targetProjections.some((projection) =>
            projection.migrationId !== null
            || projection.status !== 'READY'
            || projection.desiredVersion !== migration.targetLineVersion
            || projection.observedVersion !== migration.targetLineVersion,
          )
        ) {
          return { status: 'WAITING', migrationId: migration.id };
        }

        const targetNodeIds = new Set(migration.nodes.filter((node) => node.role === 'TARGET').map((node) => node.nodeId));
        const sourceOnlyNodes = migration.nodes.filter((node) => node.role === 'SOURCE' && !targetNodeIds.has(node.nodeId));
        for (const node of sourceOnlyNodes) {
          await tx.control_nodes.updateMany({ where: { id: node.nodeId, allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: 1 } } });
        }
        if (migration.targetExitId && migration.targetExitId !== migration.sourceExitId) {
          await tx.residential_exits.updateMany({ where: { id: migration.sourceExitId, status: 'ASSIGNED' }, data: { status: 'RELEASED' } });
        }
      } else {
        for (const node of migration.nodes.filter((item) => item.role === 'TARGET' && item.reservationStatus === 'RESERVED' && item.reservedUnits > 0)) {
          await tx.control_nodes.updateMany({ where: { id: node.nodeId, allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: node.reservedUnits } } });
        }
        if (migration.targetExitId) {
          await tx.residential_exits.updateMany({ where: { id: migration.targetExitId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
        }
      }

      await tx.dedicated_line_migration_nodes.updateMany({
        where: { migrationId: migration.id, reservationStatus: 'RESERVED' },
        data: { reservationStatus: 'RELEASED', releasedAt: new Date() },
      });
      if (deleteProjectionIds.length > 0) {
        await tx.dedicated_line_projections.deleteMany({ where: { id: { in: deleteProjectionIds } } });
      }
      const next = assertMigrationTransition(
        { type: migration.type, phase: migration.phase, status: migration.status },
        { type: 'CLEANUP_COMPLETED' },
      );
      const completed = await tx.dedicated_line_migrations.updateMany({
        where: { id: migration.id, phase: 'CLEANUP', status: migration.status },
        data: { phase: next.phase, status: next.status, finishedAt: new Date(), lastErrorCode: null, lastErrorDetail: Prisma.JsonNull },
      });
      if (completed.count !== 1) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_cleanup_raced', 409);
      await tx.dedicated_lines.updateMany({ where: { id: migration.dedicatedLineId, activeMigrationId: migration.id }, data: { activeMigrationId: null } });
      await tx.audit_logs.create({
        data: {
          siteId: migration.siteId,
          tenantId: migration.tenantId,
          actorType: 'SYSTEM',
          actorId: 'dedicated-line-migration-worker',
          targetType: 'dedicated_line_migration',
          targetId: migration.id,
          action: 'dedicated_line.migration.cleanup',
          requestId: `migration-cleanup:${migration.id}:v${migration.targetLineVersion}`,
          meta: {
            committed,
            fromStatus: migration.status,
            status: next.status,
            deletedProjectionCount: deleteProjectionIds.length,
          },
        },
      });
      return { status: 'COMPLETED', migrationId: migration.id, migrationStatus: next.status as 'COMPLETED' | 'CANCELLED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function projectionIds(nodes: Array<{ projectionId: string | null }>): string[] {
  return nodes.map((node) => node.projectionId).filter((id): id is string => Boolean(id));
}

async function remoteDeletesCompleted(tx: Prisma.TransactionClient, migrationId: string, projectionIdsToDelete: string[]): Promise<boolean> {
  if (projectionIdsToDelete.length === 0) return true;
  const jobs = await tx.external_jobs.findMany({
    where: {
      kind: 'DELETE_DEDICATED_LINE_PROJECTION',
      aggregateId: { in: projectionIdsToDelete },
      payload: { path: ['migrationId'], equals: migrationId },
    },
    select: { aggregateId: true, status: true },
  });
  const completed = new Set(jobs.filter((job) => job.status === 'COMPLETED').map((job) => job.aggregateId));
  return projectionIdsToDelete.every((projectionId) => completed.has(projectionId));
}
