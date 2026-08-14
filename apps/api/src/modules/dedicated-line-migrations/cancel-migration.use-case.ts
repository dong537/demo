import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { assertMigrationTransition } from './domain';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class CancelDedicatedLineMigrationUseCase {
  async execute(ctx: AuthenticatedContext, migrationId: string) {
    requireOperatorContext(ctx);
    return prisma.$transaction(async (tx) => {
      const migration = await tx.dedicated_line_migrations.findFirst({ where: { id: migrationId, siteId: ctx.siteId }, include: { nodes: true } });
      if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      const next = assertMigrationTransition({ type: migration.type, phase: migration.phase, status: migration.status }, { type: 'CANCEL' });
      if (next.status === 'CANCELLED') {
        const targetNodeIds = migration.nodes.filter((node) => node.role === 'TARGET' && node.reservationStatus === 'RESERVED').map((node) => node.nodeId);
        if (targetNodeIds.length > 0) {
          await tx.control_nodes.updateMany({ where: { id: { in: targetNodeIds }, allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: 1 } } });
        }
        await tx.dedicated_line_migration_nodes.updateMany({ where: { migrationId: migration.id, role: 'TARGET', reservationStatus: 'RESERVED' }, data: { reservationStatus: 'RELEASED', releasedAt: new Date() } });
        const projections = await tx.dedicated_line_projections.findMany({ where: { migrationId: migration.id }, select: { id: true } });
        if (projections.length > 0) {
          await tx.external_jobs.deleteMany({ where: { aggregateId: { in: projections.map((projection) => projection.id) }, status: { in: ['QUEUED', 'RETRYING'] } } });
          await tx.dedicated_line_projections.deleteMany({ where: { id: { in: projections.map((projection) => projection.id) } } });
        }
        if (migration.targetExitId) await tx.residential_exits.updateMany({ where: { id: migration.targetExitId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
      }
      await tx.dedicated_line_migrations.update({ where: { id: migration.id }, data: { phase: next.phase, status: next.status } });
      if (next.status === 'CANCELLED') await tx.dedicated_lines.update({ where: { id: migration.dedicatedLineId }, data: { activeMigrationId: null } });
      return { migrationId: migration.id, phase: next.phase, status: next.status };
    });
  }
}
