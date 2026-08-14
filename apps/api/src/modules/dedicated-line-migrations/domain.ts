import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type MigrationType = 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL';

export type MigrationPhase =
  | 'PREPARE'
  | 'CANARY_ROUTE'
  | 'VERIFY'
  | 'CUTOVER_ROUTE'
  | 'COMMIT'
  | 'CLEANUP'
  | 'ROLLBACK';

export type MigrationStatus = 'ACTIVE' | 'NEEDS_OPERATOR' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export type MigrationAllowedAction =
  | 'IMPORT_CANARY'
  | 'QUEUE_VERIFY'
  | 'IMPORT_CUTOVER'
  | 'COMMIT'
  | 'RETRY'
  | 'CANCEL'
  | 'IMPORT_ROLLBACK';

export type MigrationState = {
  type: MigrationType;
  phase: MigrationPhase;
  status: MigrationStatus;
};

export type MigrationEvent =
  | { type: 'TARGET_PROJECTIONS_READY' }
  | { type: 'CANARY_ROUTE_IMPORTED' }
  | { type: 'SMOKE_VERIFIED' }
  | { type: 'CUTOVER_ROUTE_IMPORTED' }
  | { type: 'COMMIT' }
  | { type: 'CLEANUP_COMPLETED' }
  | { type: 'CANCEL' }
  | { type: 'ROLLBACK_ROUTE_IMPORTED' };

export function computeNodeDelta(sourceIds: readonly string[], targetIds: readonly string[]): {
  retained: string[];
  reserve: string[];
  release: string[];
} {
  assertUniqueNodeIds(sourceIds);
  assertUniqueNodeIds(targetIds);
  const source = new Set(sourceIds);
  const target = new Set(targetIds);
  return {
    retained: targetIds.filter((id) => source.has(id)),
    reserve: targetIds.filter((id) => !source.has(id)),
    release: sourceIds.filter((id) => !target.has(id)),
  };
}

export function assertMigrationTransition(state: MigrationState, event: MigrationEvent): MigrationState {
  if (event.type === 'CANCEL') return cancel(state);
  if (event.type === 'CLEANUP_COMPLETED' && state.phase === 'CLEANUP' && state.status === 'CANCELLED') return state;
  if (state.status !== 'ACTIVE' && !(state.status === 'NEEDS_OPERATOR' && event.type === 'ROLLBACK_ROUTE_IMPORTED')) {
    invalidTransition();
  }

  switch (event.type) {
    case 'TARGET_PROJECTIONS_READY':
      if (state.phase !== 'PREPARE') invalidTransition();
      return next(state, state.type === 'EXIT_ONLY' ? 'VERIFY' : 'CANARY_ROUTE');
    case 'CANARY_ROUTE_IMPORTED':
      if (state.type === 'EXIT_ONLY' || state.phase !== 'CANARY_ROUTE') invalidTransition();
      return next(state, 'VERIFY');
    case 'SMOKE_VERIFIED':
      if (state.phase !== 'VERIFY') invalidTransition();
      return next(state, state.type === 'EXIT_ONLY' ? 'COMMIT' : 'CUTOVER_ROUTE');
    case 'CUTOVER_ROUTE_IMPORTED':
      if (state.type === 'EXIT_ONLY' || state.phase !== 'CUTOVER_ROUTE') invalidTransition();
      return next(state, 'COMMIT');
    case 'COMMIT':
      if (state.phase !== 'COMMIT') invalidTransition();
      return next(state, 'CLEANUP');
    case 'CLEANUP_COMPLETED':
      if (state.phase !== 'CLEANUP') invalidTransition();
      return { ...state, status: 'COMPLETED' };
    case 'ROLLBACK_ROUTE_IMPORTED':
      if (state.phase !== 'ROLLBACK' || state.status !== 'NEEDS_OPERATOR') invalidTransition();
      return { ...state, phase: 'CLEANUP', status: 'ACTIVE' };
  }
}

function cancel(state: MigrationState): MigrationState {
  if (state.phase === 'COMMIT' || state.phase === 'CLEANUP') {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_already_committed', 409);
  }
  if (state.status !== 'ACTIVE') invalidTransition();
  if (state.phase === 'PREPARE' || state.phase === 'CANARY_ROUTE' || (state.type === 'EXIT_ONLY' && state.phase === 'VERIFY')) {
    return { ...state, phase: 'CLEANUP', status: 'CANCELLED' };
  }
  return { ...state, phase: 'ROLLBACK', status: 'NEEDS_OPERATOR' };
}

function next(state: MigrationState, phase: MigrationPhase): MigrationState {
  return { ...state, phase };
}

function assertUniqueNodeIds(nodeIds: readonly string[]): void {
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_nodes_duplicate', 400);
  }
}

function invalidTransition(): never {
  throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_phase_invalid', 409);
}
