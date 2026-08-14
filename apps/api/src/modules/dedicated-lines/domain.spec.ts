import { describe, expect, it } from 'vitest';
import {
  assertDedicatedLineTransition,
  assertDesiredVersion,
  createPlacement,
  evaluateReplicaReadiness,
  assertDedicatedLineScope,
  replacePlacementNodes,
} from './domain';

describe('dedicated line state machine', () => {
  it('allows provisioning to become active after every target replica is ready', () => {
    expect(() => assertDedicatedLineTransition('PROVISIONING', 'ACTIVE')).not.toThrow();
  });

  it('rejects a terminal cancelled line returning to provisioning', () => {
    expect(() => assertDedicatedLineTransition('CANCELLED', 'PROVISIONING')).toThrowError(
      expect.objectContaining({ reasonKey: 'dedicated_line_transition_invalid' }),
    );
  });

  it('rejects a stale worker desired version', () => {
    expect(() => assertDesiredVersion(4, 3)).toThrowError(
      expect.objectContaining({ reasonKey: 'dedicated_line_desired_version_stale' }),
    );
  });

  it('rejects a line read outside its site, tenant, or user scope', () => {
    expect(() =>
      assertDedicatedLineScope(
        { siteId: 'site-a', tenantId: 'tenant-a', userId: 'user-a' },
        { siteId: 'site-a', tenantId: 'tenant-b', userId: 'user-a' },
      ),
    ).toThrowError(expect.objectContaining({ reasonKey: 'dedicated_line_scope_violation' }));
  });
});

describe('dedicated line placement', () => {
  it('requires target replicas to be positive and min ready to fit within the target', () => {
    expect(() => createPlacement({ targetReplicaCount: 0, minReadyReplicaCount: 0, nodeIds: [] })).toThrowError(
      expect.objectContaining({ reasonKey: 'placement_replica_count_invalid' }),
    );
    expect(() =>
      createPlacement({ targetReplicaCount: 2, minReadyReplicaCount: 3, nodeIds: ['node-a', 'node-b'] }),
    ).toThrowError(expect.objectContaining({ reasonKey: 'placement_min_ready_invalid' }));
  });

  it('requires exactly one distinct assigned node per target replica', () => {
    expect(() =>
      createPlacement({ targetReplicaCount: 2, minReadyReplicaCount: 1, nodeIds: ['node-a', 'node-a'] }),
    ).toThrowError(expect.objectContaining({ reasonKey: 'placement_nodes_invalid' }));
  });

  it('reports active only when all target replicas are ready', () => {
    expect(evaluateReplicaReadiness({ targetReplicaCount: 3, minReadyReplicaCount: 2, readyReplicaCount: 3 })).toBe(
      'ACTIVE',
    );
  });

  it('reports degraded when the minimum is ready but redundancy is incomplete', () => {
    expect(evaluateReplicaReadiness({ targetReplicaCount: 3, minReadyReplicaCount: 2, readyReplicaCount: 2 })).toBe(
      'DEGRADED',
    );
  });

  it('reports failed when readiness is below the delivery minimum', () => {
    expect(evaluateReplicaReadiness({ targetReplicaCount: 3, minReadyReplicaCount: 2, readyReplicaCount: 1 })).toBe(
      'FAILED',
    );
  });

  it('does not silently change assigned nodes without an explicit migration', () => {
    const placement = createPlacement({
      targetReplicaCount: 2,
      minReadyReplicaCount: 1,
      nodeIds: ['node-a', 'node-b'],
    });

    expect(() => replacePlacementNodes(placement, ['node-a', 'node-c'], 'RECONCILE')).toThrowError(
      expect.objectContaining({ reasonKey: 'placement_change_requires_migration' }),
    );
    expect(replacePlacementNodes(placement, ['node-a', 'node-c'], 'MIGRATION').nodeIds).toEqual([
      'node-a',
      'node-c',
    ]);
  });
});
