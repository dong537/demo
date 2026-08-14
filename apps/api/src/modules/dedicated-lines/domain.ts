import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type DedicatedLineStatus =
  | 'PENDING_PAYMENT'
  | 'QUEUED'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'DEGRADED'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'MIGRATING_AWAITING_ROUTE_IMPORT'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'FAILED';

const ALLOWED_TRANSITIONS: Record<DedicatedLineStatus, ReadonlySet<DedicatedLineStatus>> = {
  PENDING_PAYMENT: new Set(['QUEUED', 'CANCELLED', 'FAILED']),
  QUEUED: new Set(['PROVISIONING', 'CANCELLING', 'FAILED']),
  PROVISIONING: new Set(['ACTIVE', 'DEGRADED', 'MIGRATING_AWAITING_ROUTE_IMPORT', 'CANCELLING', 'FAILED']),
  ACTIVE: new Set(['DEGRADED', 'SUSPENDED', 'EXPIRED', 'MIGRATING_AWAITING_ROUTE_IMPORT', 'CANCELLING']),
  DEGRADED: new Set(['ACTIVE', 'SUSPENDED', 'EXPIRED', 'MIGRATING_AWAITING_ROUTE_IMPORT', 'CANCELLING', 'FAILED']),
  SUSPENDED: new Set(['PROVISIONING', 'ACTIVE', 'DEGRADED', 'EXPIRED', 'CANCELLING']),
  EXPIRED: new Set(['PROVISIONING', 'CANCELLING']),
  MIGRATING_AWAITING_ROUTE_IMPORT: new Set(['ACTIVE', 'DEGRADED', 'CANCELLING', 'FAILED']),
  CANCELLING: new Set(['CANCELLED', 'FAILED']),
  CANCELLED: new Set(),
  FAILED: new Set(['QUEUED', 'CANCELLING', 'CANCELLED']),
};

export function assertDedicatedLineTransition(from: DedicatedLineStatus, to: DedicatedLineStatus): void {
  if (from === to || ALLOWED_TRANSITIONS[from].has(to)) return;

  throw new AppError(
    ErrorCode.VALIDATION_ERROR,
    'dedicated_line_transition_invalid',
    409,
    `Dedicated line cannot transition from ${from} to ${to}`,
  );
}

export function assertDesiredVersion(currentDesiredVersion: number, workerDesiredVersion: number): void {
  if (currentDesiredVersion === workerDesiredVersion) return;

  throw new AppError(
    ErrorCode.IDEMPOTENCY_CONFLICT,
    'dedicated_line_desired_version_stale',
    409,
    `Expected desired version ${currentDesiredVersion}, got ${workerDesiredVersion}`,
  );
}

export interface DedicatedLineScope {
  siteId: string;
  tenantId: string;
  userId: string;
}

export function assertDedicatedLineScope(line: DedicatedLineScope, requested: DedicatedLineScope): void {
  if (
    line.siteId !== requested.siteId ||
    line.tenantId !== requested.tenantId ||
    line.userId !== requested.userId
  ) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'dedicated_line_scope_violation', 404);
  }
}

export interface LinePlacement {
  targetReplicaCount: number;
  minReadyReplicaCount: number;
  nodeIds: readonly string[];
}

export type PlacementChangeReason = 'RECONCILE' | 'MIGRATION';
export type ReplicaReadinessStatus = 'ACTIVE' | 'DEGRADED' | 'FAILED';

export function createPlacement(input: LinePlacement): LinePlacement {
  if (!Number.isInteger(input.targetReplicaCount) || input.targetReplicaCount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_replica_count_invalid', 400);
  }
  if (
    !Number.isInteger(input.minReadyReplicaCount) ||
    input.minReadyReplicaCount < 1 ||
    input.minReadyReplicaCount > input.targetReplicaCount
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_min_ready_invalid', 400);
  }

  const distinctNodeIds = new Set(input.nodeIds);
  if (distinctNodeIds.size !== input.targetReplicaCount || distinctNodeIds.size !== input.nodeIds.length) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_nodes_invalid', 400);
  }

  return {
    targetReplicaCount: input.targetReplicaCount,
    minReadyReplicaCount: input.minReadyReplicaCount,
    nodeIds: [...input.nodeIds],
  };
}

export function replacePlacementNodes(
  placement: LinePlacement,
  nodeIds: readonly string[],
  reason: PlacementChangeReason,
): LinePlacement {
  const nodesChanged = placement.nodeIds.length !== nodeIds.length || placement.nodeIds.some((id, index) => id !== nodeIds[index]);
  if (nodesChanged && reason !== 'MIGRATION') {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'placement_change_requires_migration', 409);
  }

  return createPlacement({ ...placement, nodeIds });
}

export function evaluateReplicaReadiness(input: {
  targetReplicaCount: number;
  minReadyReplicaCount: number;
  readyReplicaCount: number;
}): ReplicaReadinessStatus {
  createPlacement({
    targetReplicaCount: input.targetReplicaCount,
    minReadyReplicaCount: input.minReadyReplicaCount,
    nodeIds: Array.from({ length: input.targetReplicaCount }, (_, index) => String(index)),
  });
  if (!Number.isInteger(input.readyReplicaCount) || input.readyReplicaCount < 0 || input.readyReplicaCount > input.targetReplicaCount) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_ready_count_invalid', 400);
  }
  if (input.readyReplicaCount === input.targetReplicaCount) return 'ACTIVE';
  if (input.readyReplicaCount >= input.minReadyReplicaCount) return 'DEGRADED';
  return 'FAILED';
}
