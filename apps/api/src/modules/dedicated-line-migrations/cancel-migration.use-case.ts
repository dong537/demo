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
        const projections = await tx.dedicated_line_projections.findMany({
          where: { migrationId: migration.id },
          select: { id: true, projectionKey: true, desiredVersion: true },
        });
        if (projections.length > 0) {
          await tx.external_jobs.deleteMany({ where: { aggregateId: { in: projections.map((projection) => projection.id) }, kind: 'APPLY_DEDICATED_LINE_PROJECTION', status: { in: ['QUEUED', 'RETRYING'] } } });
          for (const projection of projections) {
            const deleteVersion = projection.desiredVersion + 1;
            const deleteKey = `delete_dedicated_line_projection:${migration.id}:${projection.id}:v${deleteVersion}`;
            await tx.external_jobs.create({
              data: {
                siteId: migration.siteId,
                tenantId: migration.tenantId,
                userId: migration.userId,
                dedicatedLineId: migration.dedicatedLineId,
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
        const cleanupKey = `cleanup_dedicated_line_migration:${migration.id}:v${migration.targetLineVersion}`;
        await tx.external_jobs.create({
          data: {
            siteId: migration.siteId,
            tenantId: migration.tenantId,
            userId: migration.userId,
            dedicatedLineId: migration.dedicatedLineId,
            kind: 'CLEANUP_DEDICATED_LINE_MIGRATION',
            aggregateType: 'dedicated_line_migration',
            aggregateId: migration.id,
            desiredVersion: migration.targetLineVersion,
            idempotencyKey: cleanupKey,
            dedupeKey: cleanupKey,
            payload: { migrationId: migration.id },
          },
        });
      }
      const updated = await tx.dedicated_line_migrations.updateMany({
        where: { id: migration.id, phase: migration.phase, status: migration.status },
        data: { phase: next.phase, status: next.status },
      });
      if (updated.count !== 1) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_cancel_raced', 409);
      }
      await tx.audit_logs.create({
        data: {
          siteId: migration.siteId,
          tenantId: migration.tenantId,
          actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'dedicated_line_migration',
          targetId: migration.id,
          action: 'dedicated_line.migration.cancel',
          requestId: ctx.requestId,
          meta: {
            fromPhase: migration.phase,
            fromStatus: migration.status,
            phase: next.phase,
            status: next.status,
          },
        },
      });
      return { migrationId: migration.id, phase: next.phase, status: next.status };
    });
  }
}
