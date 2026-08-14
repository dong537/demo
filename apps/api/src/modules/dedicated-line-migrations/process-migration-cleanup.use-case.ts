import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { assertMigrationTransition } from './domain';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class ProcessMigrationCleanupUseCase {
  async execute(migrationId: string) {
    return prisma.$transaction(async (tx) => {
      const migration = await tx.dedicated_line_migrations.findUnique({ where: { id: migrationId }, include: { nodes: true } });
      if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      const line = await tx.dedicated_lines.findUnique({ where: { id: migration.dedicatedLineId }, select: { desiredVersion: true, exitAssignment: { select: { residentialExitId: true } } } });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);
      const committed = migration.committedAt !== null;
      for (const node of migration.nodes.filter((item) => item.reservationStatus === 'RESERVED')) {
        await tx.dedicated_line_migration_nodes.update({ where: { id: node.id }, data: { reservationStatus: 'RELEASED', releasedAt: new Date() } });
        if (!committed) await tx.control_nodes.updateMany({ where: { id: node.nodeId, allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: 1 } } });
      }
      if (!committed && migration.targetExitId) await tx.residential_exits.updateMany({ where: { id: migration.targetExitId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
      const targetProjectionIds = (await tx.dedicated_line_projections.findMany({ where: { migrationId: migration.id }, select: { id: true } })).map((projection) => projection.id);
      if (targetProjectionIds.length > 0) {
        await tx.external_jobs.deleteMany({ where: { aggregateId: { in: targetProjectionIds }, status: { in: ['QUEUED', 'RETRYING'] } } });
        if (!committed) await tx.dedicated_line_projections.deleteMany({ where: { id: { in: targetProjectionIds } } });
      }
      const next = assertMigrationTransition({ type: migration.type, phase: migration.phase, status: migration.status }, { type: 'CLEANUP_COMPLETED' });
      await tx.dedicated_line_migrations.update({ where: { id: migration.id }, data: { phase: next.phase, status: next.status, finishedAt: new Date() } });
      await tx.dedicated_lines.update({ where: { id: migration.dedicatedLineId }, data: { activeMigrationId: null } });
      return { migrationId: migration.id, phase: next.phase, status: next.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
