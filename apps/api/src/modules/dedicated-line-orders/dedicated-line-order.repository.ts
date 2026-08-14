import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { prisma, LedgerEntryType } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertLeaseCompletion } from '../external-work/domain';
import { WalletRepository } from '../wallet/wallet.repository';

const ORDER_JOB_KIND = 'PROVIDER_DEDICATED_LINE_ORDER';

export type DedicatedLineOrderJob = Prisma.external_jobsGetPayload<Record<string, never>>;

export type PersistDedicatedLineOrderInput = {
  jobId: string;
  workerId: string;
  desiredVersion: number;
  reservationId: string;
  providerCode: string;
  providerAccountId: string;
  skuId: string;
  countryCode: string;
  placementPolicyId: string;
  inboundTag: string;
  exits: Array<{
    lineId: string;
    inboundProfileId: string;
    protocol: 'VLESS' | 'VMESS' | 'MIXED';
    clientEmail: string;
    clientIdentityCiphertext: string;
    clientIdentityFingerprint: string;
    projectionDesiredHash: string;
    providerProxyId: string | null;
    endpointCiphertext: string;
    credentialCiphertext: string;
    identityFingerprint: string;
    maxReplicaFanout: number;
    expiresAt: Date;
  }>;
};

@Injectable()
export class DedicatedLineOrderRepository {
  constructor(private readonly walletRepository: WalletRepository) {}

  async findQueued(limit = 20): Promise<Array<Pick<DedicatedLineOrderJob, 'id'>>> {
    const now = new Date();
    return prisma.external_jobs.findMany({
      where: {
        kind: ORDER_JOB_KIND,
        status: { in: ['QUEUED', 'RETRYING'] },
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
  }

  async claimRunnableJob(jobId: string, workerId: string, leaseMs = 60_000): Promise<DedicatedLineOrderJob | null> {
    const now = new Date();
    const result = await prisma.external_jobs.updateMany({
      where: {
        id: jobId,
        kind: ORDER_JOB_KIND,
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
    if (result.count !== 1) return null;
    return prisma.external_jobs.findUnique({ where: { id: jobId } });
  }

  async recoverExpiredLeases(): Promise<number> {
    const result = await prisma.external_jobs.updateMany({
      where: {
        kind: ORDER_JOB_KIND,
        status: 'LEASED',
        leaseExpiresAt: { lt: new Date() },
      },
      data: {
        status: 'NEEDS_OPERATOR',
        lastErrorCode: 'EXTERNAL_CALL_LEASE_EXPIRED',
        lastErrorDetail: { reason: 'remote_order_may_have_been_accepted' },
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count;
  }

  async saveUpstreamOrderId(
    job: DedicatedLineOrderJob,
    workerId: string,
    upstreamOrderId: string,
    retryAt: Date,
  ): Promise<void> {
    assertLease(job, workerId);
    const payload = asJsonObject(job.payload);
    const result = await prisma.external_jobs.updateMany({
      where: { id: job.id, status: 'LEASED', leaseOwner: workerId, desiredVersion: job.desiredVersion },
      data: {
        status: 'RETRYING',
        nextRunAt: retryAt,
        payload: { ...payload, upstreamOrderId },
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'UPSTREAM_ORDER_PENDING',
        lastErrorDetail: { upstreamOrderId },
      },
    });
    if (result.count !== 1) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_job_lease_lost', 409);
  }

  async persistCompletedOrder(input: PersistDedicatedLineOrderInput): Promise<{ status: 'COMPLETED' } | { status: 'NEEDS_OPERATOR'; reasonKey: string }> {
    try {
      await prisma.$transaction(async (tx) => {
      const job = await tx.external_jobs.findUnique({ where: { id: input.jobId } });
      if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'external_job_not_found', 404);
      assertLease(job, input.workerId, input.desiredVersion);
      if (job.aggregateType !== 'stock_reservation' || job.aggregateId !== input.reservationId) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_job_aggregate_mismatch', 409);
      }

      const reservation = await tx.stock_reservations.findUnique({ where: { id: input.reservationId } });
      if (!reservation) throw new AppError(ErrorCode.NOT_FOUND, 'stock_reservation_not_found', 404);
      if (reservation.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'stock_reservation_not_active', 409);
      }
      if (reservation.expiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'stock_reservation_expired', 422);
      }

      const policy = await loadPlacementPolicy(tx, job.siteId, job.tenantId, job.userId, input.skuId, input.placementPolicyId);
      if (!policy || policy.inboundProfileId !== input.exits[0]?.inboundProfileId || policy.inboundTag !== input.inboundTag) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_placement_policy_changed', 422);
      }
      if (job.tenantId === null || job.userId === null) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_scope_missing', 422);
      }
      if (!job.dedicatedLineOrderId) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_order_snapshot_missing', 422);
      }
      for (const exit of input.exits) {
        if (
          exit.inboundProfileId !== policy.inboundProfileId
          || exit.protocol !== policy.protocol
          || exit.maxReplicaFanout !== policy.targetReplicaCount
        ) {
          throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_placement_contract_changed', 422);
        }
      }
      const allocatedNodes = await allocateProjectionNodes(tx, {
        siteId: job.siteId,
        tenantId: job.tenantId,
        policy,
        lineCount: input.exits.length,
      });

      for (const [index, exit] of input.exits.entries()) {
        const residentialExit = await tx.residential_exits.create({
          data: {
            siteId: job.siteId,
            tenantId: job.tenantId,
            providerAccountId: input.providerAccountId,
            providerCode: input.providerCode,
            countryCode: input.countryCode,
            endpointCiphertext: exit.endpointCiphertext,
            credentialCiphertext: exit.credentialCiphertext,
            identityFingerprint: exit.identityFingerprint,
            maxReplicaFanout: exit.maxReplicaFanout,
            status: 'ASSIGNED',
            expiresAt: exit.expiresAt,
          },
        });
        const line = await tx.dedicated_lines.create({
          data: {
            id: exit.lineId,
            siteId: job.siteId,
            tenantId: job.tenantId!,
            userId: job.userId!,
            skuId: input.skuId,
            dedicatedLineOrderId: job.dedicatedLineOrderId,
            inboundProfileId: exit.inboundProfileId,
            status: 'PROVISIONING',
            countryCode: input.countryCode,
            protocol: exit.protocol,
            clientEmail: exit.clientEmail,
            clientIdentityCiphertext: exit.clientIdentityCiphertext,
            clientIdentityFingerprint: exit.clientIdentityFingerprint,
            desiredVersion: job.desiredVersion,
            expiresAt: exit.expiresAt,
            idempotencyKey: `${reservation.id}:${index}`,
          },
        });
        const nodeIds = allocatedNodes[index] ?? [];
        await tx.dedicated_line_placements.create({
          data: {
            siteId: job.siteId,
            tenantId: job.tenantId!,
            userId: job.userId!,
            dedicatedLineId: line.id,
            policyId: policy.id,
            nodeGroupId: policy.nodeGroupId,
            mode: policy.mode,
            targetReplicaCount: policy.targetReplicaCount,
            minReadyReplicaCount: policy.minReadyReplicaCount,
            assignmentFingerprint: createHash('sha256').update(nodeIds.join('\0')).digest('hex'),
            changeReason: 'RECONCILE',
            nodes: {
              create: nodeIds.map((nodeId, ordinal) => ({
                siteId: job.siteId,
                tenantId: job.tenantId!,
                userId: job.userId!,
                nodeId,
                ordinal,
              })),
            },
          },
        });
        const projections = nodeIds.map((nodeId) => ({
          siteId: job.siteId,
          tenantId: job.tenantId!,
          userId: job.userId!,
          dedicatedLineId: line.id,
          nodeId,
          projectionKey: `${line.id}:${nodeId}`,
          desiredVersion: job.desiredVersion,
          desiredHash: exit.projectionDesiredHash,
        }));
        await tx.dedicated_line_projections.createMany({ data: projections });
        for (const projection of projections) {
          const jobKey = `projection:${projection.dedicatedLineId}:${projection.nodeId}:v${projection.desiredVersion}`;
          await tx.external_jobs.create({
            data: {
              siteId: job.siteId,
              tenantId: job.tenantId,
              userId: job.userId,
              dedicatedLineId: line.id,
              kind: 'APPLY_DEDICATED_LINE_PROJECTION',
              aggregateType: 'dedicated_line_projection',
              aggregateId: (await tx.dedicated_line_projections.findUniqueOrThrow({ where: { siteId_projectionKey: { siteId: job.siteId, projectionKey: projection.projectionKey } }, select: { id: true } })).id,
              desiredVersion: job.desiredVersion,
              idempotencyKey: jobKey,
              dedupeKey: jobKey,
              payload: { projectionKey: projection.projectionKey },
            },
          });
        }
        await tx.dedicated_line_exit_assignments.create({
          data: {
            siteId: job.siteId,
            tenantId: job.tenantId!,
            userId: job.userId!,
            dedicatedLineId: line.id,
            residentialExitId: residentialExit.id,
            status: 'ACTIVE',
          },
        });
      }
      await tx.stock_reservations.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
      await tx.external_jobs.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorDetail: Prisma.JsonNull,
        },
      });
      });
      return { status: 'COMPLETED' };
    } catch (error: unknown) {
      if (error instanceof AppError && (error.code === ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED || error.code === ErrorCode.DEDICATED_LINE_CONFIG_INVALID)) {
        await persistPurchasedExitsForOperator(input, error.reasonKey);
        return { status: 'NEEDS_OPERATOR', reasonKey: error.reasonKey };
      }
      throw error;
    }
  }

  async markFailed(
    job: DedicatedLineOrderJob,
    workerId: string,
    code: string,
    detail: Record<string, unknown>,
    options: { retry: boolean; releaseReservation: boolean },
  ): Promise<'RETRYING' | 'FAILED' | 'NEEDS_OPERATOR'> {
    assertLease(job, workerId);
    if (options.retry && job.attempt < job.maxAttempts) {
      const retryAt = new Date(Date.now() + retryDelayMs(job.attempt));
      const result = await prisma.external_jobs.updateMany({
        where: { id: job.id, status: 'LEASED', leaseOwner: workerId, desiredVersion: job.desiredVersion },
        data: {
          status: job.attempt >= job.maxAttempts ? 'FAILED' : 'RETRYING',
          nextRunAt: retryAt,
          lastErrorCode: code,
          lastErrorDetail: detail as Prisma.InputJsonObject,
          completedAt: job.attempt >= job.maxAttempts ? new Date() : null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (result.count !== 1) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_job_lease_lost', 409);
      return 'RETRYING';
    }

    await prisma.$transaction(async (tx) => {
      const result = await tx.external_jobs.updateMany({
        where: { id: job.id, status: 'LEASED', leaseOwner: workerId, desiredVersion: job.desiredVersion },
        data: {
          status: 'NEEDS_OPERATOR',
          lastErrorCode: code,
          lastErrorDetail: detail as Prisma.InputJsonObject,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (result.count !== 1) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_job_lease_lost', 409);
      if (options.releaseReservation) {
        await releaseReservationTx(tx, job.aggregateId);
        await refundReservationTx(tx, job.aggregateId, this.walletRepository);
      }
    });
    return options.retry ? 'FAILED' : 'NEEDS_OPERATOR';
  }

  async releaseReservation(job: DedicatedLineOrderJob): Promise<void> {
    await prisma.$transaction((tx) => releaseReservationTx(tx, job.aggregateId));
  }
}

type PlacementPolicyRow = {
  id: string;
  inboundProfileId: string;
  nodeGroupId: string;
  mode: 'ACTIVE_ACTIVE' | 'HOT_STANDBY';
  targetReplicaCount: number;
  minReadyReplicaCount: number;
  maxUnitsPerNode: number;
  allowedNodeIds: string[];
  inboundTag: string;
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
};

async function loadPlacementPolicy(
  tx: Prisma.TransactionClient,
  siteId: string,
  tenantId: string | null,
  userId: string | null,
  skuId: string,
  policyId: string,
): Promise<PlacementPolicyRow | null> {
  if (!tenantId || !userId) return null;
  return tx.line_placement_policies.findFirst({
    where: {
      id: policyId,
      siteId,
      isActive: true,
      AND: [
        { OR: [{ tenantId: null }, { tenantId }] },
        { OR: [{ userId: null }, { userId }] },
        { OR: [{ skuId: null }, { skuId }] },
      ],
      inboundProfile: { isActive: true },
      nodeGroup: { isActive: true },
    },
    select: {
      id: true,
      inboundProfileId: true,
      nodeGroupId: true,
      mode: true,
      targetReplicaCount: true,
      minReadyReplicaCount: true,
      maxUnitsPerNode: true,
      allowedNodes: { select: { nodeId: true } },
      inboundProfile: { select: { inboundTag: true, protocol: true } },
    },
  }).then((row) => row ? {
    ...row,
    inboundTag: row.inboundProfile.inboundTag,
    protocol: row.inboundProfile.protocol,
    allowedNodeIds: row.allowedNodes.map((entry) => entry.nodeId),
  } : null);
}

async function allocateProjectionNodes(
  tx: Prisma.TransactionClient,
  input: { siteId: string; tenantId: string; policy: PlacementPolicyRow; lineCount: number },
): Promise<string[][]> {
  const nodes = await tx.control_nodes.findMany({
    where: {
      siteId: input.siteId,
      nodeGroupId: input.policy.nodeGroupId,
      id: { in: input.policy.allowedNodeIds },
      status: 'ACTIVE',
      OR: [{ tenantId: null }, { tenantId: input.tenantId }],
    },
    orderBy: [{ allocatedUnits: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, capacityUnits: true, allocatedUnits: true },
  });
  const remaining = new Map(nodes.map((node) => [
    node.id,
    Math.max(0, Math.min(node.capacityUnits, input.policy.maxUnitsPerNode) - node.allocatedUnits),
  ]));
  const result: string[][] = [];
  for (let lineIndex = 0; lineIndex < input.lineCount; lineIndex += 1) {
    const candidates = nodes
      .filter((node) => (remaining.get(node.id) ?? 0) > 0)
      .sort((left, right) =>
        (remaining.get(right.id) ?? 0) - (remaining.get(left.id) ?? 0) || left.code.localeCompare(right.code),
      )
      .slice(0, input.policy.targetReplicaCount);
    if (candidates.length !== input.policy.targetReplicaCount) {
      throw new AppError(ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED, 'dedicated_line_control_node_capacity_exhausted', 422);
    }
    const assigned: string[] = [];
    for (const node of candidates) {
      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE "control_nodes"
        SET "allocatedUnits" = "allocatedUnits" + 1
        WHERE "id" = ${node.id}
          AND "status" = 'ACTIVE'
          AND "allocatedUnits" < "capacityUnits"
          AND "allocatedUnits" < ${input.policy.maxUnitsPerNode}
      `);
      if (updated !== 1) {
        throw new AppError(ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED, 'dedicated_line_control_node_capacity_exhausted', 422);
      }
      remaining.set(node.id, (remaining.get(node.id) ?? 0) - 1);
      assigned.push(node.id);
    }
    result.push(assigned);
  }
  return result;
}

async function persistPurchasedExitsForOperator(input: PersistDedicatedLineOrderInput, reasonKey: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.external_jobs.findUnique({ where: { id: input.jobId } });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'external_job_not_found', 404);
    assertLease(job, input.workerId, input.desiredVersion);
    for (const exit of input.exits) {
      await tx.residential_exits.create({
        data: {
          siteId: job.siteId,
          tenantId: job.tenantId,
          providerAccountId: input.providerAccountId,
          providerCode: input.providerCode,
          countryCode: input.countryCode,
          endpointCiphertext: exit.endpointCiphertext,
          credentialCiphertext: exit.credentialCiphertext,
          identityFingerprint: exit.identityFingerprint,
          maxReplicaFanout: exit.maxReplicaFanout,
          expiresAt: exit.expiresAt,
        },
      });
    }
    await tx.stock_reservations.update({
      where: { id: input.reservationId },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    await tx.external_jobs.update({
      where: { id: job.id },
      data: {
        status: 'NEEDS_OPERATOR',
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'DEDICATED_LINE_ALLOCATION_NEEDS_OPERATOR',
        lastErrorDetail: { reasonKey },
      },
    });
  });
}

function assertLease(job: DedicatedLineOrderJob, workerId: string, desiredVersion = job.desiredVersion): void {
  assertLeaseCompletion(job, { workerId, desiredVersion, now: new Date() });
}

async function releaseReservationTx(tx: Prisma.TransactionClient, reservationId: string): Promise<void> {
  const reservation = await tx.stock_reservations.findUnique({ where: { id: reservationId } });
  if (!reservation || reservation.status !== 'ACTIVE') return;
  await tx.stock_reservations.update({
    where: { id: reservation.id },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });
  await tx.$executeRaw(Prisma.sql`
    UPDATE "dedicated_line_inventory_snapshots"
    SET "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${reservation.quantity})
    WHERE "id" = ${reservation.inventorySnapshotId}
  `);
}

async function refundReservationTx(
  tx: Prisma.TransactionClient,
  reservationId: string,
  walletRepository: WalletRepository,
): Promise<void> {
  const debit = await tx.ledger_entries.findFirst({
    where: { relatedId: reservationId, type: LedgerEntryType.DEBIT },
    orderBy: { createdAt: 'asc' },
  });
  if (!debit) return;
  const amount = debit.amount.toString();
  if (!amount.startsWith('-')) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'dedicated_line_debit_amount_invalid', 409);
  }
  await walletRepository.creditWalletTx(
    tx,
    debit.walletId,
    amount.slice(1),
    debit.currency,
    LedgerEntryType.REFUND,
    reservationId,
    'dedicated_line_order_refund',
    `dedicated-line-refund:${reservationId}`,
  );
}

function asJsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Prisma.InputJsonObject;
}

function retryDelayMs(attempt: number): number {
  return Math.min(60_000, Math.max(1_000, 2 ** Math.min(attempt, 6) * 1_000));
}

export function exitIdentityFingerprint(
  siteId: string,
  providerCode: string,
  providerAccountId: string,
  providerProxyId: string | null,
  ip: string,
  port: number,
): string {
  return createHash('sha256')
    .update([siteId, providerCode, providerAccountId, providerProxyId ?? `${ip}:${port}`].join('\0'))
    .digest('hex');
}
