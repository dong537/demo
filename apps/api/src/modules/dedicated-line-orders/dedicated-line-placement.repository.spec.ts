import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  policyFindMany: vi.fn(),
  nodeFindMany: vi.fn(),
}));

vi.mock('@ipeasy/db', () => ({
  prisma: {
    line_placement_policies: { findMany: db.policyFindMany },
    control_nodes: { findMany: db.nodeFindMany },
  },
}));

import { DedicatedLinePlacementRepository } from './dedicated-line-placement.repository';

beforeEach(() => {
  vi.clearAllMocks();
  db.policyFindMany.mockResolvedValue([{
    id: 'policy-1', inboundProfileId: 'inbound-1', nodeGroupId: 'group-1', mode: 'ACTIVE_ACTIVE',
    targetReplicaCount: 2, minReadyReplicaCount: 1, maxUnitsPerNode: 10, priority: 1,
    inboundProfile: { id: 'inbound-1', nodeGroupId: 'group-1', controlNodeId: null, inboundTag: 'sv', protocol: 'VLESS' },
    allowedNodes: [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
  }]);
  db.nodeFindMany.mockResolvedValue([
    { id: 'node-a', code: 'a', capacityUnits: 10, allocatedUnits: 0 },
    { id: 'node-b', code: 'b', capacityUnits: 10, allocatedUnits: 0 },
  ]);
});

describe('DedicatedLinePlacementRepository', () => {
  it('limits capacity lookup to policy allowlisted nodes', async () => {
    const result = await new DedicatedLinePlacementRepository().resolveForOrder({
      siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', skuId: 'sku-1', quantity: 1,
    });

    expect(db.nodeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['node-a', 'node-b'] } }),
    }));
    expect(result.allowedNodeIds).toEqual(['node-a', 'node-b']);
  });

  it('fails closed for historical policies without an allowlist', async () => {
    db.policyFindMany.mockResolvedValueOnce([{
      id: 'policy-legacy', inboundProfileId: 'inbound-1', nodeGroupId: 'group-1', mode: 'ACTIVE_ACTIVE',
      targetReplicaCount: 1, minReadyReplicaCount: 1, maxUnitsPerNode: 10, priority: 1,
      inboundProfile: { id: 'inbound-1', nodeGroupId: 'group-1', controlNodeId: null, inboundTag: 'sv', protocol: 'VLESS' },
      allowedNodes: [],
    }]);

    await expect(new DedicatedLinePlacementRepository().resolveForOrder({
      siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', skuId: 'sku-1', quantity: 1,
    })).rejects.toMatchObject({ reasonKey: 'dedicated_line_placement_allowed_nodes_missing', httpStatus: 422 });
    expect(db.nodeFindMany).not.toHaveBeenCalled();
  });
});
