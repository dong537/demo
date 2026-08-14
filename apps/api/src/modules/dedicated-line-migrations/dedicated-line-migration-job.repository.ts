import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertLeaseCompletion } from '../external-work/domain';

export const MIGRATION_JOB_KINDS = [
  'VERIFY_DEDICATED_LINE_MIGRATION',
  'DELETE_DEDICATED_LINE_PROJECTION',
  'CLEANUP_DEDICATED_LINE_MIGRATION',
] as const;

export type DedicatedLineMigrationJobKind = typeof MIGRATION_JOB_KINDS[number];
export type DedicatedLineMigrationJob = Prisma.external_jobsGetPayload<Record<string, never>>;

export type ProjectionDeleteWork = {
  projectionId: string;
  projectionKey: string;
  desiredVersion: number;
  nodeBaseUrl: string;
  nodeApiCredentialCiphertext: string;
};

@Injectable()
export class DedicatedLineMigrationJobRepository {
  async enqueueRunnableJobs(limit = 20): Promise<number> {
    const migrations = await prisma.dedicated_line_migrations.findMany({
      where: {
        OR: [
          { phase: 'VERIFY', status: 'ACTIVE' },
          { phase: 'CLEANUP', status: { in: ['ACTIVE', 'CANCELLED'] } },
        ],
      },
      include: {
        nodes: { where: { role: 'TARGET' }, select: { projectionId: true } },
        projections: { select: { id: true, desiredVersion: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    let created = 0;
    for (const migration of migrations) {
      if (migration.phase === 'VERIFY') {
        created += await this.enqueueMigrationJob(migration, 'VERIFY_DEDICATED_LINE_MIGRATION', {
          stage: migration.type === 'EXIT_ONLY' ? 'CUTOVER' : 'CANARY',
        });
        continue;
      }
      if (!migration.committedAt) {
        const targetProjectionIds = new Set(migration.nodes.map((node) => node.projectionId).filter((id): id is string => Boolean(id)));
        for (const projection of migration.projections.filter((item) => targetProjectionIds.has(item.id))) {
          created += await this.enqueueProjectionDeleteJob(migration, projection.id, projection.desiredVersion + 1);
        }
      }
      created += await this.enqueueMigrationJob(migration, 'CLEANUP_DEDICATED_LINE_MIGRATION', {});
    }
    return created;
  }

  async findQueued(limit = 20): Promise<Array<Pick<DedicatedLineMigrationJob, 'id'>>> {
    const now = new Date();
    return prisma.external_jobs.findMany({
      where: {
        kind: { in: [...MIGRATION_JOB_KINDS] },
        status: { in: ['QUEUED', 'RETRYING'] },
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
  }

  async claimRunnableJob(jobId: string, workerId: string, leaseMs = 60_000): Promise<DedicatedLineMigrationJob | null> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.external_jobs.updateMany({
        where: {
          id: jobId,
          kind: { in: [...MIGRATION_JOB_KINDS] },
          status: { in: ['QUEUED', 'RETRYING'] },
          nextRunAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          status: 'LEASED', attempt: { increment: 1 }, leaseOwner: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
        },
      });
      if (claimed.count !== 1) return null;
      return tx.external_jobs.findUniqueOrThrow({ where: { id: jobId } });
    });
  }

  async recoverExpiredLeases(): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const expired = await tx.external_jobs.findMany({
        where: { kind: { in: [...MIGRATION_JOB_KINDS] }, status: 'LEASED', leaseExpiresAt: { lt: now } },
        select: { id: true, attempt: true, maxAttempts: true, aggregateType: true, aggregateId: true, payload: true },
      });
      let recovered = 0;
      const retryIds = expired.filter((job) => job.attempt < job.maxAttempts).map((job) => job.id);
      if (retryIds.length > 0) {
        const retried = await tx.external_jobs.updateMany({
          where: { id: { in: retryIds }, status: 'LEASED', leaseExpiresAt: { lt: now } },
          data: {
            status: 'RETRYING', nextRunAt: now, leaseOwner: null, leaseExpiresAt: null,
            lastErrorCode: 'MIGRATION_JOB_LEASE_EXPIRED', lastErrorDetail: { reasonKey: 'idempotent_migration_job_retry' },
          },
        });
        recovered += retried.count;
      }
      for (const job of expired.filter((item) => item.attempt >= item.maxAttempts)) {
        const failed = await tx.external_jobs.updateMany({
          where: { id: job.id, status: 'LEASED', leaseExpiresAt: { lt: now } },
          data: {
            status: 'FAILED', completedAt: now, leaseOwner: null, leaseExpiresAt: null,
            lastErrorCode: 'MIGRATION_JOB_LEASE_ATTEMPTS_EXHAUSTED',
            lastErrorDetail: { reasonKey: 'migration_job_lease_attempts_exhausted' },
          },
        });
        if (failed.count !== 1) continue;
        recovered += 1;
        const migrationId = migrationIdFromJob(job);
        if (migrationId) await tx.dedicated_line_migrations.updateMany({
          where: { id: migrationId, status: { in: ['ACTIVE', 'CANCELLED'] } },
          data: {
            status: 'NEEDS_OPERATOR', retryCount: { increment: 1 },
            lastErrorCode: 'MIGRATION_JOB_LEASE_ATTEMPTS_EXHAUSTED',
            lastErrorDetail: { reasonKey: 'migration_job_lease_attempts_exhausted' },
          },
        });
      }
      return recovered;
    });
  }

  async loadProjectionDeleteWork(job: DedicatedLineMigrationJob, workerId: string): Promise<ProjectionDeleteWork | null> {
    assertJobLease(job, workerId);
    if (job.kind !== 'DELETE_DEDICATED_LINE_PROJECTION' || job.aggregateType !== 'dedicated_line_projection') {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_delete_job_aggregate_invalid', 409);
    }
    const activeApply = await prisma.external_jobs.count({
      where: { aggregateId: job.aggregateId, kind: 'APPLY_DEDICATED_LINE_PROJECTION', status: 'LEASED' },
    });
    if (activeApply > 0) return null;
    await prisma.external_jobs.updateMany({
      where: { aggregateId: job.aggregateId, kind: 'APPLY_DEDICATED_LINE_PROJECTION', status: { in: ['QUEUED', 'RETRYING'] } },
      data: {
        status: 'FAILED', completedAt: new Date(), lastErrorCode: 'PROJECTION_DELETE_SCHEDULED',
        lastErrorDetail: { reasonKey: 'projection_delete_scheduled' },
      },
    });
    const projection = await prisma.dedicated_line_projections.findFirst({
      where: { id: job.aggregateId, siteId: job.siteId },
      include: { node: true },
    });
    if (!projection) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_projection_not_found', 404);
    if (projection.tenantId !== job.tenantId || projection.userId !== job.userId || projection.dedicatedLineId !== job.dedicatedLineId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'dedicated_line_projection_scope_violation', 403);
    }
    if (job.desiredVersion !== projection.desiredVersion + 1) {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_delete_desired_version_invalid', 409);
    }
    return {
      projectionId: projection.id,
      projectionKey: projection.projectionKey,
      desiredVersion: job.desiredVersion,
      nodeBaseUrl: projection.node.baseUrl,
      nodeApiCredentialCiphertext: projection.node.apiCredentialCiphertext,
    };
  }

  async markCompleted(job: DedicatedLineMigrationJob, workerId: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.external_jobs.updateMany({
      where: activeLeaseWhere(job, workerId, now),
      data: {
        status: 'COMPLETED', completedAt: now, leaseOwner: null, leaseExpiresAt: null,
        lastErrorCode: null, lastErrorDetail: Prisma.JsonNull,
      },
    });
    if (updated.count !== 1) staleMigrationLease();
  }

  async deferClaimed(job: DedicatedLineMigrationJob, workerId: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.external_jobs.updateMany({
      where: activeLeaseWhere(job, workerId, now),
      data: {
        status: 'RETRYING', attempt: { decrement: 1 }, nextRunAt: new Date(now.getTime() + 5_000),
        leaseOwner: null, leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) staleMigrationLease();
  }

  async markFailed(
    job: DedicatedLineMigrationJob,
    workerId: string,
    code: string,
    detail: Record<string, unknown>,
    options: { retry: boolean },
  ): Promise<'RETRYING' | 'FAILED' | 'NEEDS_OPERATOR'> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.external_jobs.findUnique({ where: { id: job.id } });
      if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'migration_job_not_found', 404);
      assertJobLease(current, workerId, job.desiredVersion);
      const status = options.retry
        ? (current.attempt >= current.maxAttempts ? 'FAILED' : 'RETRYING')
        : 'NEEDS_OPERATOR';
      const now = new Date();
      const updated = await tx.external_jobs.updateMany({
        where: activeLeaseWhere(current, workerId, now),
        data: {
          status,
          nextRunAt: status === 'RETRYING' ? new Date(now.getTime() + retryDelayMs(current.attempt)) : current.nextRunAt,
          completedAt: status === 'RETRYING' ? null : now,
          leaseOwner: null, leaseExpiresAt: null, lastErrorCode: code,
          lastErrorDetail: detail as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) staleMigrationLease();
      if (status !== 'RETRYING') {
        const migrationId = migrationIdFromJob(current);
        if (migrationId) await tx.dedicated_line_migrations.updateMany({
          where: { id: migrationId, status: { in: ['ACTIVE', 'CANCELLED'] } },
          data: { status: 'NEEDS_OPERATOR', lastErrorCode: code, lastErrorDetail: detail as Prisma.InputJsonObject, retryCount: { increment: 1 } },
        });
      }
      return status;
    });
  }

  private async enqueueMigrationJob(
    migration: MigrationJobOwner,
    kind: 'VERIFY_DEDICATED_LINE_MIGRATION' | 'CLEANUP_DEDICATED_LINE_MIGRATION',
    payload: Record<string, unknown>,
  ): Promise<number> {
    const key = `${kind.toLowerCase()}:${migration.id}:v${migration.targetLineVersion}`;
    const result = await prisma.external_jobs.createMany({
      data: [{
        siteId: migration.siteId, tenantId: migration.tenantId, userId: migration.userId,
        dedicatedLineId: migration.dedicatedLineId, kind, aggregateType: 'dedicated_line_migration',
        aggregateId: migration.id, desiredVersion: migration.targetLineVersion,
        idempotencyKey: key, dedupeKey: key, payload: { migrationId: migration.id, ...payload },
      }],
      skipDuplicates: true,
    });
    return result.count;
  }

  private async enqueueProjectionDeleteJob(migration: MigrationJobOwner, projectionId: string, desiredVersion: number): Promise<number> {
    const key = `delete_dedicated_line_projection:${migration.id}:${projectionId}:v${desiredVersion}`;
    const result = await prisma.external_jobs.createMany({
      data: [{
        siteId: migration.siteId, tenantId: migration.tenantId, userId: migration.userId,
        dedicatedLineId: migration.dedicatedLineId, kind: 'DELETE_DEDICATED_LINE_PROJECTION',
        aggregateType: 'dedicated_line_projection', aggregateId: projectionId, desiredVersion,
        idempotencyKey: key, dedupeKey: key, payload: { migrationId: migration.id },
      }],
      skipDuplicates: true,
    });
    return result.count;
  }
}

type MigrationJobOwner = {
  id: string;
  siteId: string;
  tenantId: string;
  userId: string;
  dedicatedLineId: string;
  targetLineVersion: number;
};

function assertJobLease(job: DedicatedLineMigrationJob, workerId: string, desiredVersion = job.desiredVersion): void {
  assertLeaseCompletion(job, { workerId, desiredVersion, now: new Date() });
}

function activeLeaseWhere(job: Pick<DedicatedLineMigrationJob, 'id' | 'desiredVersion'>, workerId: string, now: Date) {
  return { id: job.id, desiredVersion: job.desiredVersion, status: 'LEASED' as const, leaseOwner: workerId, leaseExpiresAt: { gt: now } };
}

function staleMigrationLease(): never {
  throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_job_lease_stale', 409);
}

function migrationIdFromJob(job: Pick<DedicatedLineMigrationJob, 'aggregateType' | 'aggregateId' | 'payload'>): string | null {
  if (job.aggregateType === 'dedicated_line_migration') return job.aggregateId;
  if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) return null;
  const migrationId = (job.payload as Record<string, unknown>)['migrationId'];
  return typeof migrationId === 'string' && migrationId.trim() ? migrationId : null;
}

function retryDelayMs(attempt: number): number {
  return Math.min(60_000, Math.max(1_000, 2 ** Math.min(attempt, 6) * 1_000));
}
