import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertLeaseCompletion } from '../external-work/domain';
import { assertMigrationTransition } from '../dedicated-line-migrations/domain';

export const DEDICATED_LINE_PROJECTION_JOB_KIND = 'APPLY_DEDICATED_LINE_PROJECTION';

export type DedicatedLineProjectionJob = Prisma.external_jobsGetPayload<Record<string, never>>;

export type DedicatedLineProjectionWork = {
  projectionId: string;
  projectionKey: string;
  desiredVersion: number;
  desiredHash: string;
  nodeId: string;
  nodeStatus: 'ACTIVE' | 'DRAINING' | 'DISABLED';
  nodeBaseUrl: string;
  nodeApiCredentialCiphertext: string;
  inboundTag: string;
  inboundIsActive: boolean;
  inboundControlNodeId: string | null;
  lineStatus: 'PENDING_PAYMENT' | 'QUEUED' | 'PROVISIONING' | 'ACTIVE' | 'DEGRADED' | 'SUSPENDED' | 'EXPIRED' | 'MIGRATING_AWAITING_ROUTE_IMPORT' | 'CANCELLING' | 'CANCELLED' | 'FAILED';
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
  clientEmail: string;
  clientIdentityCiphertext: string;
  expiresAt: Date | null;
  quotaBytes: bigint | null;
  uplinkLimitBps: bigint | null;
  downlinkLimitBps: bigint | null;
  maxConnections: number | null;
  ipLimit: number | null;
  exitStatus: 'AVAILABLE' | 'RESERVED' | 'ASSIGNED' | 'QUARANTINED' | 'EXPIRED' | 'RELEASED';
  migrationId: string | null;
  migrationTargetExit: boolean;
  exitCountryCode: string;
  exitExpiresAt: Date | null;
  endpointCiphertext: string;
  credentialCiphertext: string;
};

@Injectable()
export class DedicatedLineProjectionRepository {
  async findQueued(limit = 20): Promise<Array<Pick<DedicatedLineProjectionJob, 'id'>>> {
    const now = new Date();
    return prisma.external_jobs.findMany({
      where: {
        kind: DEDICATED_LINE_PROJECTION_JOB_KIND,
        status: { in: ['QUEUED', 'RETRYING'] },
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
  }

  async claimRunnableJob(jobId: string, workerId: string, leaseMs = 60_000): Promise<DedicatedLineProjectionJob | null> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.external_jobs.updateMany({
        where: {
          id: jobId,
          kind: DEDICATED_LINE_PROJECTION_JOB_KIND,
          status: { in: ['QUEUED', 'RETRYING'] },
          nextRunAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          status: 'LEASED',
          attempt: { increment: 1 },
          leaseOwner: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
        },
      });
      if (claimed.count !== 1) return null;
      const job = await tx.external_jobs.findUniqueOrThrow({ where: { id: jobId } });
      await tx.dedicated_line_projections.updateMany({
        where: { id: job.aggregateId, desiredVersion: job.desiredVersion },
        data: { status: 'APPLYING', lastErrorCode: null, lastErrorDetail: Prisma.JsonNull },
      });
      return job;
    });
  }

  async recoverExpiredLeases(): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const expired = await tx.external_jobs.findMany({
        where: {
          kind: DEDICATED_LINE_PROJECTION_JOB_KIND,
          status: 'LEASED',
          leaseExpiresAt: { lt: new Date() },
        },
        select: { id: true, aggregateId: true },
      });
      if (expired.length === 0) return 0;
      const ids = expired.map((job) => job.id);
      const projectionIds = expired.map((job) => job.aggregateId);
      await tx.external_jobs.updateMany({
        where: { id: { in: ids }, status: 'LEASED' },
        data: {
          status: 'RETRYING', nextRunAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
          lastErrorCode: 'PROJECTION_LEASE_EXPIRED', lastErrorDetail: { reasonKey: 'idempotent_projection_retry' },
        },
      });
      await tx.dedicated_line_projections.updateMany({
        where: { id: { in: projectionIds }, status: 'APPLYING' },
        data: {
          status: 'FAILED', retryCount: { increment: 1 }, lastErrorCode: 'PROJECTION_LEASE_EXPIRED',
          lastErrorDetail: { reasonKey: 'idempotent_projection_retry' },
        },
      });
      return expired.length;
    });
  }

  async loadClaimedWork(job: DedicatedLineProjectionJob, workerId: string): Promise<DedicatedLineProjectionWork> {
    assertLease(job, workerId);
    if (job.kind !== DEDICATED_LINE_PROJECTION_JOB_KIND || job.aggregateType !== 'dedicated_line_projection') {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'projection_job_aggregate_invalid', 409);
    }
    const projection = await prisma.dedicated_line_projections.findFirst({
      where: { id: job.aggregateId, siteId: job.siteId, desiredVersion: job.desiredVersion },
      include: {
        node: true,
        dedicatedLine: {
          include: {
            inboundProfile: true,
            exitAssignment: { include: { residentialExit: true } },
          },
        },
        migration: { include: { targetExit: true } },
      },
    });
    if (!projection) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_projection_not_found', 404);
    const line = projection.dedicatedLine;
    if (
      job.dedicatedLineId !== line.id
      || job.tenantId !== line.tenantId
      || job.userId !== line.userId
      || projection.tenantId !== line.tenantId
      || projection.userId !== line.userId
    ) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'dedicated_line_projection_scope_violation', 403);
    }
    const assignment = line.exitAssignment;
    const migrationTarget = projection.migration?.targetExit;
    if (projection.migrationId && !migrationTarget) {
      throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_migration_target_exit_missing', 500);
    }
    if (!projection.migrationId && (!assignment || assignment.status !== 'ACTIVE')) {
      throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_assignment_missing', 500);
    }
    const exit = migrationTarget ?? assignment!.residentialExit;
    return {
      projectionId: projection.id,
      projectionKey: projection.projectionKey,
      desiredVersion: projection.desiredVersion,
      desiredHash: projection.desiredHash,
      nodeId: projection.nodeId,
      nodeStatus: projection.node.status,
      nodeBaseUrl: projection.node.baseUrl,
      nodeApiCredentialCiphertext: projection.node.apiCredentialCiphertext,
      inboundTag: line.inboundProfile.inboundTag,
      inboundIsActive: line.inboundProfile.isActive,
      inboundControlNodeId: line.inboundProfile.controlNodeId,
      lineStatus: line.status,
      protocol: line.protocol,
      clientEmail: line.clientEmail,
      clientIdentityCiphertext: line.clientIdentityCiphertext,
      expiresAt: line.expiresAt,
      quotaBytes: line.quotaBytes,
      uplinkLimitBps: line.uplinkLimitBps,
      downlinkLimitBps: line.downlinkLimitBps,
      maxConnections: line.maxConnections,
      ipLimit: line.ipLimit,
      migrationId: projection.migrationId,
      migrationTargetExit: Boolean(migrationTarget),
      exitStatus: exit.status,
      exitCountryCode: exit.countryCode,
      exitExpiresAt: exit.expiresAt,
      endpointCiphertext: exit.endpointCiphertext,
      credentialCiphertext: exit.credentialCiphertext,
    };
  }

  async markReady(
    job: DedicatedLineProjectionJob,
    workerId: string,
    observed: { projectionId: string; observedVersion: number; observedHash: string; nodeExternalId: string },
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const current = await tx.external_jobs.findUnique({ where: { id: job.id } });
      if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'projection_job_not_found', 404);
      assertLease(current, workerId, job.desiredVersion);
      if (current.aggregateId !== observed.projectionId) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'projection_job_aggregate_mismatch', 409);
      }
      const updated = await tx.dedicated_line_projections.updateMany({
        where: { id: observed.projectionId, desiredVersion: job.desiredVersion },
        data: {
          status: 'READY', observedVersion: observed.observedVersion, observedHash: observed.observedHash,
          nodeExternalId: observed.nodeExternalId, lastErrorCode: null, lastErrorDetail: Prisma.JsonNull,
          lastAppliedAt: new Date(), lastObservedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'projection_desired_version_stale', 409);
      await tx.external_jobs.update({
        where: { id: current.id },
        data: {
          status: 'COMPLETED', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
          lastErrorCode: null, lastErrorDetail: Prisma.JsonNull,
        },
      });
      await updateLineReadiness(tx, current.dedicatedLineId);
      await advanceMigrationTargetReadiness(tx, migrationIdFromPayload(current.payload));
    });
  }

  async markFailed(
    job: DedicatedLineProjectionJob,
    workerId: string,
    code: string,
    detail: Record<string, unknown>,
    options: { retry: boolean },
  ): Promise<'RETRYING' | 'FAILED' | 'NEEDS_OPERATOR'> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.external_jobs.findUnique({ where: { id: job.id } });
      if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'projection_job_not_found', 404);
      assertLease(current, workerId, job.desiredVersion);
      const status = options.retry
        ? (current.attempt >= current.maxAttempts ? 'FAILED' : 'RETRYING')
        : 'NEEDS_OPERATOR';
      await tx.dedicated_line_projections.updateMany({
        where: { id: current.aggregateId, desiredVersion: current.desiredVersion },
        data: {
          status: 'FAILED', retryCount: { increment: 1 }, lastErrorCode: code,
          lastErrorDetail: detail as Prisma.InputJsonObject,
        },
      });
      await tx.external_jobs.update({
        where: { id: current.id },
        data: {
          status,
          nextRunAt: status === 'RETRYING' ? new Date(Date.now() + retryDelayMs(current.attempt)) : current.nextRunAt,
          completedAt: status === 'RETRYING' ? null : new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: code,
          lastErrorDetail: detail as Prisma.InputJsonObject,
        },
      });
      if (status !== 'RETRYING') await updateLineReadiness(tx, current.dedicatedLineId, true);
      return status;
    });
  }
}

function assertLease(job: DedicatedLineProjectionJob, workerId: string, desiredVersion = job.desiredVersion): void {
  assertLeaseCompletion(job, { workerId, desiredVersion, now: new Date() });
}

async function updateLineReadiness(tx: Prisma.TransactionClient, dedicatedLineId: string | null, terminalFailure = false): Promise<void> {
  if (!dedicatedLineId) return;
  const line = await tx.dedicated_lines.findUnique({
    where: { id: dedicatedLineId },
    include: { placement: true, projections: { where: { migrationId: null }, select: { status: true, observedVersion: true, desiredVersion: true, migrationId: true } } },
  });
  if (!line?.placement || !['PROVISIONING', 'ACTIVE', 'DEGRADED'].includes(line.status)) return;
  const ready = line.projections.filter((projection) =>
    projection.status === 'READY' && projection.observedVersion === projection.desiredVersion,
  ).length;
  const routeCount = await tx.delivery_routes.count({ where: { dedicatedLineId: line.id, isCurrent: true } });
  const status = ready >= line.placement.minReadyReplicaCount && routeCount === 0
    ? 'MIGRATING_AWAITING_ROUTE_IMPORT'
    : ready >= line.placement.targetReplicaCount
      ? 'ACTIVE'
      : ready >= line.placement.minReadyReplicaCount
        ? 'DEGRADED'
        : terminalFailure
          ? (line.status === 'ACTIVE' ? 'DEGRADED' : 'FAILED')
          : 'PROVISIONING';
  await tx.dedicated_lines.update({ where: { id: line.id }, data: { status } });
}

function migrationIdFromPayload(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const migrationId = (payload as Record<string, unknown>).migrationId;
  return typeof migrationId === 'string' && migrationId.trim() ? migrationId : null;
}

async function advanceMigrationTargetReadiness(tx: Prisma.TransactionClient, migrationId: string | null): Promise<void> {
  if (!migrationId) return;
  const migrationTable = (tx as unknown as {
    dedicated_line_migrations?: {
      findUnique: (args: { where: { id: string }; select: { type: true; phase: true; status: true } }) => Promise<{ type: string; phase: string; status: string } | null>;
      update: (args: { where: { id: string }; data: { phase: string; status: string } }) => Promise<unknown>;
    };
  }).dedicated_line_migrations;
  const projectionTable = (tx.dedicated_line_projections as unknown as {
    findMany?: (args: { where: { migrationId: string }; select: { status: true; desiredVersion: true; observedVersion: true } }) => Promise<Array<{ status: string; desiredVersion: number; observedVersion: number | null }>>;
  });
  if (!migrationTable || typeof projectionTable.findMany !== 'function') return;
  const migration = await migrationTable.findUnique({ where: { id: migrationId }, select: { type: true, phase: true, status: true } });
  if (!migration || migration.phase !== 'PREPARE' || migration.status !== 'ACTIVE') return;
  const projections = await projectionTable.findMany({ where: { migrationId }, select: { status: true, desiredVersion: true, observedVersion: true } });
  if (projections.length === 0 || projections.some((projection) => projection.status !== 'READY' || projection.observedVersion !== projection.desiredVersion)) return;
  const next = assertMigrationTransition({ type: migration.type as 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL', phase: migration.phase as 'PREPARE', status: migration.status as 'ACTIVE' }, { type: 'TARGET_PROJECTIONS_READY' });
  await migrationTable.update({ where: { id: migrationId }, data: { phase: next.phase, status: next.status } });
}

function retryDelayMs(attempt: number): number {
  return Math.min(60_000, Math.max(1_000, 2 ** Math.min(attempt, 6) * 1_000));
}
