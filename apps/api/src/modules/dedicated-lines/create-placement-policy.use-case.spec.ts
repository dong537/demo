import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    node_groups: { findFirst },
    inbound_profiles: { findFirst },
    control_nodes: { findMany },
    tenants: { findFirst },
    users: { findFirst },
    service_skus: { findFirst },
    line_placement_policies: { create },
    audit_logs: { create: auditCreate },
  }));
  return { findFirst, findMany, create, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

import { CreatePlacementPolicyUseCase } from './create-placement-policy.use-case';

function context(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null,
    scopes: [], requestId: 'request-1', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findFirst
    .mockResolvedValueOnce({ id: 'group-1' })
    .mockResolvedValueOnce({ id: 'inbound-1', nodeGroupId: 'group-1' });
  db.findMany.mockResolvedValue([{ id: 'node-a' }, { id: 'node-b' }]);
  db.create.mockResolvedValue({ id: 'policy-1', allowedNodes: [] });
});

const input = {
  nodeGroupId: 'group-1', inboundProfileId: 'inbound-1', allowedNodeIds: ['node-a', 'node-b'],
  targetReplicaCount: 2, minReadyReplicaCount: 1, maxUnitsPerNode: 10,
};

describe('CreatePlacementPolicyUseCase', () => {
  it('creates the policy, explicit node allowlist, and audit row in one transaction', async () => {
    await new CreatePlacementPolicyUseCase().execute(context(), input);

    expect(db.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowedNodes: { create: [{ siteId: 'site-1', nodeId: 'node-a' }, { siteId: 'site-1', nodeId: 'node-b' }] },
      }),
    }));
    expect(db.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'dedicated_line_placement_policy.create', actorId: 'admin-1' }),
    }));
  });

  it('rejects an empty allowlist before opening a transaction', async () => {
    await expect(new CreatePlacementPolicyUseCase().execute(context(), { ...input, allowedNodeIds: [] }))
      .rejects.toMatchObject({ reasonKey: 'placement_allowed_nodes_required', httpStatus: 400 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects nodes outside the active group or tenant scope', async () => {
    db.findMany.mockResolvedValue([{ id: 'node-a' }]);
    await expect(new CreatePlacementPolicyUseCase().execute(context(), input))
      .rejects.toMatchObject({ reasonKey: 'placement_allowed_node_invalid', httpStatus: 422 });
    expect(db.create).not.toHaveBeenCalled();
  });

  it('requires enough allowed nodes for the requested replica count', async () => {
    db.findMany.mockResolvedValue([{ id: 'node-a' }]);
    await expect(new CreatePlacementPolicyUseCase().execute(context(), { ...input, targetReplicaCount: 2, allowedNodeIds: ['node-a'] }))
      .rejects.toMatchObject({ reasonKey: 'placement_allowed_nodes_insufficient', httpStatus: 422 });
  });

  it('rejects non-operator callers', async () => {
    await expect(new CreatePlacementPolicyUseCase().execute(context({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), input))
      .rejects.toMatchObject({ httpStatus: 403 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
