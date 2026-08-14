import { describe, expect, it } from 'vitest';
import { assertMigrationTransition, computeNodeDelta } from './domain';

describe('dedicated line migration domain', () => {
  it('keeps shared nodes and reserves/releases only the set difference', () => {
    expect(computeNodeDelta(['node-a', 'node-b'], ['node-b', 'node-c'])).toEqual({
      retained: ['node-b'],
      reserve: ['node-c'],
      release: ['node-a'],
    });
  });

  it('rejects duplicate node ids before capacity accounting', () => {
    expect(() => computeNodeDelta(['node-a'], ['node-b', 'node-b'])).toThrowError(
      expect.objectContaining({ reasonKey: 'migration_nodes_duplicate' }),
    );
  });

  it('moves node and full migrations through canary verification and cutover', () => {
    const canary = assertMigrationTransition(
      { type: 'FULL', phase: 'PREPARE', status: 'ACTIVE' },
      { type: 'TARGET_PROJECTIONS_READY' },
    );
    expect(canary).toEqual({ type: 'FULL', phase: 'CANARY_ROUTE', status: 'ACTIVE' });

    const verify = assertMigrationTransition(canary, { type: 'CANARY_ROUTE_IMPORTED' });
    expect(verify.phase).toBe('VERIFY');

    const cutover = assertMigrationTransition(verify, { type: 'SMOKE_VERIFIED' });
    expect(cutover.phase).toBe('CUTOVER_ROUTE');

    const commit = assertMigrationTransition(cutover, { type: 'CUTOVER_ROUTE_IMPORTED' });
    expect(commit.phase).toBe('COMMIT');
  });

  it('moves exit-only migrations directly from prepared projections to verification', () => {
    const verify = assertMigrationTransition(
      { type: 'EXIT_ONLY', phase: 'PREPARE', status: 'ACTIVE' },
      { type: 'TARGET_PROJECTIONS_READY' },
    );
    expect(verify).toEqual({ type: 'EXIT_ONLY', phase: 'VERIFY', status: 'ACTIVE' });
    expect(assertMigrationTransition(verify, { type: 'SMOKE_VERIFIED' })).toEqual({
      type: 'EXIT_ONLY', phase: 'COMMIT', status: 'ACTIVE',
    });
  });

  it('rejects commit before cutover evidence', () => {
    expect(() => assertMigrationTransition(
      { type: 'FULL', phase: 'VERIFY', status: 'ACTIVE' },
      { type: 'COMMIT' },
    )).toThrowError(expect.objectContaining({ reasonKey: 'migration_phase_invalid' }));
  });

  it('keeps cleanup visible after commit and completes only after cleanup succeeds', () => {
    const cleanup = assertMigrationTransition(
      { type: 'NODE_ONLY', phase: 'COMMIT', status: 'ACTIVE' },
      { type: 'COMMIT' },
    );
    expect(cleanup).toEqual({ type: 'NODE_ONLY', phase: 'CLEANUP', status: 'ACTIVE' });
    expect(assertMigrationTransition(cleanup, { type: 'CLEANUP_COMPLETED' })).toEqual({
      type: 'NODE_ONLY', phase: 'CLEANUP', status: 'COMPLETED',
    });
  });

  it('requires operator rollback after an external route was imported', () => {
    expect(assertMigrationTransition(
      { type: 'NODE_ONLY', phase: 'VERIFY', status: 'ACTIVE' },
      { type: 'CANCEL' },
    )).toEqual({ type: 'NODE_ONLY', phase: 'ROLLBACK', status: 'NEEDS_OPERATOR' });

    expect(assertMigrationTransition(
      { type: 'NODE_ONLY', phase: 'ROLLBACK', status: 'NEEDS_OPERATOR' },
      { type: 'ROLLBACK_ROUTE_IMPORTED' },
    )).toEqual({ type: 'NODE_ONLY', phase: 'CLEANUP', status: 'ACTIVE' });
  });

  it('cancels before any external route evidence exists', () => {
    expect(assertMigrationTransition(
      { type: 'FULL', phase: 'PREPARE', status: 'ACTIVE' },
      { type: 'CANCEL' },
    )).toEqual({ type: 'FULL', phase: 'CLEANUP', status: 'CANCELLED' });
  });

  it('cancels EXIT_ONLY verification without demanding a rollback route', () => {
    expect(assertMigrationTransition(
      { type: 'EXIT_ONLY', phase: 'VERIFY', status: 'ACTIVE' },
      { type: 'CANCEL' },
    )).toEqual({ type: 'EXIT_ONLY', phase: 'CLEANUP', status: 'CANCELLED' });
  });

  it('does not allow a committed migration to be cancelled', () => {
    expect(() => assertMigrationTransition(
      { type: 'FULL', phase: 'CLEANUP', status: 'ACTIVE' },
      { type: 'CANCEL' },
    )).toThrowError(expect.objectContaining({ reasonKey: 'migration_already_committed' }));
  });
});
