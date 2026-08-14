import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class RetryDedicatedLineMigrationUseCase {
  async execute(ctx: AuthenticatedContext, migrationId: string, body: unknown) {
    requireOperatorContext(ctx);
    const reason = retryReason(body);
    return prisma.$transaction(async (tx) => {
      const migration = await tx.dedicated_line_migrations.findFirst({
        where: { id: migrationId, siteId: ctx.siteId },
      });
      if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      if (migration.status !== 'NEEDS_OPERATOR') {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_retry_not_required', 409);
      }
      if (migration.phase === 'ROLLBACK') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_rollback_route_required', 422);
      }
      if (!['PREPARE', 'VERIFY', 'CLEANUP'].includes(migration.phase)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_retry_phase_invalid', 422);
      }

      const candidates = await tx.external_jobs.findMany({
        where: {
          dedicatedLineId: migration.dedicatedLineId,
          status: { in: ['FAILED', 'NEEDS_OPERATOR'] },
          kind: { in: [
            'APPLY_DEDICATED_LINE_PROJECTION',
            'VERIFY_DEDICATED_LINE_MIGRATION',
            'DELETE_DEDICATED_LINE_PROJECTION',
            'CLEANUP_DEDICATED_LINE_MIGRATION',
          ] },
        },
        select: { id: true, kind: true, aggregateType: true, aggregateId: true, payload: true },
      });
      const retryableKinds = migrationRetryableKinds(migration.phase, Boolean(migration.committedAt));
      const owned = candidates.filter((job) => retryableKinds.has(job.kind) && migrationIdFromJob(job) === migration.id);
      if (owned.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, 'migration_failed_job_not_found', 404);
      }
      const jobIds = owned.map((job) => job.id);
      const requeued = await tx.external_jobs.updateMany({
        where: { id: { in: jobIds }, status: { in: ['FAILED', 'NEEDS_OPERATOR'] } },
        data: {
          status: 'QUEUED', attempt: 0, nextRunAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
          completedAt: null, lastErrorCode: null, lastErrorDetail: Prisma.JsonNull,
        },
      });
      if (requeued.count !== jobIds.length) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_retry_job_conflict', 409);
      }
      const projectionIds = owned
        .filter((job) => job.kind === 'APPLY_DEDICATED_LINE_PROJECTION' && job.aggregateType === 'dedicated_line_projection')
        .map((job) => job.aggregateId);
      if (projectionIds.length > 0) await tx.dedicated_line_projections.updateMany({
        where: { id: { in: projectionIds }, dedicatedLineId: migration.dedicatedLineId },
        data: { status: 'PENDING', lastErrorCode: null, lastErrorDetail: Prisma.JsonNull },
      });
      if (migration.phase === 'CLEANUP' && migration.committedAt) await tx.dedicated_lines.updateMany({
        where: { id: migration.dedicatedLineId, activeMigrationId: migration.id, status: 'FAILED' },
        data: { status: 'PROVISIONING' },
      });
      const retryStatus = migration.phase === 'CLEANUP' && !migration.committedAt ? 'CANCELLED' : 'ACTIVE';
      await tx.dedicated_line_migrations.update({
        where: { id: migration.id },
        data: { status: retryStatus, lastErrorCode: null, lastErrorDetail: Prisma.JsonNull },
      });
      await tx.audit_logs.create({
        data: {
          siteId: migration.siteId, tenantId: migration.tenantId,
          actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER', actorId: ctx.ownerId,
          targetType: 'dedicated_line_migration', targetId: migration.id,
          action: 'dedicated_line.migration.retry', reason, requestId: ctx.requestId,
          meta: { phase: migration.phase, requeuedJobIds: jobIds },
        },
      });
      return { migrationId: migration.id, phase: migration.phase, status: retryStatus, requeuedJobs: requeued.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function migrationRetryableKinds(phase: string, committed: boolean): ReadonlySet<string> {
  if (phase === 'PREPARE') return new Set(['APPLY_DEDICATED_LINE_PROJECTION']);
  if (phase === 'VERIFY') return new Set(['VERIFY_DEDICATED_LINE_MIGRATION']);
  if (phase === 'CLEANUP' && committed) return new Set([
    'APPLY_DEDICATED_LINE_PROJECTION',
    'DELETE_DEDICATED_LINE_PROJECTION',
    'CLEANUP_DEDICATED_LINE_MIGRATION',
  ]);
  return new Set(['DELETE_DEDICATED_LINE_PROJECTION', 'CLEANUP_DEDICATED_LINE_MIGRATION']);
}

function migrationIdFromJob(job: { aggregateType: string; aggregateId: string; payload: Prisma.JsonValue }): string | null {
  if (job.aggregateType === 'dedicated_line_migration') return job.aggregateId;
  if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) return null;
  const value = (job.payload as Record<string, unknown>)['migrationId'];
  return typeof value === 'string' && value.trim() ? value : null;
}

function retryReason(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_retry_body_invalid', 400);
  }
  const value = (body as Record<string, unknown>)['reason'];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_retry_reason_required', 400);
  }
  return value.trim();
}
