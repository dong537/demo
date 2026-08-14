import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type DedicatedLinePlacementPlan = {
  policyId: string;
  inboundProfileId: string;
  inboundTag: string;
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
  targetReplicaCount: number;
  minReadyReplicaCount: number;
  maxUnitsPerNode: number;
  allowedNodeIds: string[];
};

@Injectable()
export class DedicatedLinePlacementRepository {
  async resolveForOrder(input: {
    siteId: string;
    tenantId: string;
    userId: string;
    skuId: string;
    quantity: number;
  }): Promise<DedicatedLinePlacementPlan> {
    const policies = await prisma.line_placement_policies.findMany({
      where: {
        siteId: input.siteId,
        isActive: true,
        AND: [
          { OR: [{ tenantId: null }, { tenantId: input.tenantId }] },
          { OR: [{ userId: null }, { userId: input.userId }] },
          { OR: [{ skuId: null }, { skuId: input.skuId }] },
        ],
        inboundProfile: { isActive: true },
        nodeGroup: { isActive: true },
      },
      include: { inboundProfile: true, allowedNodes: { select: { nodeId: true } } },
    });
    const policy = policies.sort((left, right) =>
      left.priority - right.priority || specificity(right) - specificity(left) || left.id.localeCompare(right.id),
    )[0];
    if (!policy) throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_placement_policy_missing', 422);
    if (
      policy.targetReplicaCount < 1
      || policy.minReadyReplicaCount < 1
      || policy.minReadyReplicaCount > policy.targetReplicaCount
      || policy.maxUnitsPerNode < 1
    ) {
      throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_placement_policy_invalid', 422);
    }
    const allowedNodeIds = policy.allowedNodes.map((entry) => entry.nodeId);
    if (allowedNodeIds.length === 0 || allowedNodeIds.length < policy.targetReplicaCount) {
      throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_placement_allowed_nodes_missing', 422);
    }
    if (policy.inboundProfile.nodeGroupId !== policy.nodeGroupId) {
      throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_inbound_group_mismatch', 422);
    }

    const nodes = await prisma.control_nodes.findMany({
      where: {
        siteId: input.siteId,
        nodeGroupId: policy.nodeGroupId,
        id: { in: allowedNodeIds },
        status: 'ACTIVE',
        AND: [
          { OR: [{ tenantId: null }, { tenantId: input.tenantId }] },
          ...(policy.inboundProfile.controlNodeId ? [{ id: policy.inboundProfile.controlNodeId }] : []),
        ],
      },
      orderBy: [{ allocatedUnits: 'asc' }, { code: 'asc' }],
    });
    const remaining = new Map(nodes.map((node) => [
      node.id,
      Math.max(0, Math.min(node.capacityUnits, policy.maxUnitsPerNode) - node.allocatedUnits),
    ]));
    for (let line = 0; line < input.quantity; line += 1) {
      const selected = nodes
        .filter((node) => (remaining.get(node.id) ?? 0) > 0)
        .sort((left, right) =>
          utilization(left) - utilization(right)
          || (remaining.get(right.id) ?? 0) - (remaining.get(left.id) ?? 0)
          || left.code.localeCompare(right.code),
        )
        .slice(0, policy.targetReplicaCount);
      if (selected.length !== policy.targetReplicaCount) {
        throw new AppError(ErrorCode.CONTROL_NODE_CAPACITY_EXHAUSTED, 'dedicated_line_control_node_capacity_exhausted', 422);
      }
      selected.forEach((node) => remaining.set(node.id, (remaining.get(node.id) ?? 0) - 1));
    }
    return {
      policyId: policy.id,
      inboundProfileId: policy.inboundProfileId,
      inboundTag: policy.inboundProfile.inboundTag,
      protocol: policy.inboundProfile.protocol,
      targetReplicaCount: policy.targetReplicaCount,
      minReadyReplicaCount: policy.minReadyReplicaCount,
      maxUnitsPerNode: policy.maxUnitsPerNode,
      allowedNodeIds,
    };
  }
}

function specificity(policy: { tenantId: string | null; userId: string | null; skuId: string | null }): number {
  return Number(policy.tenantId !== null) + Number(policy.userId !== null) + Number(policy.skuId !== null);
}

function utilization(node: { allocatedUnits: number; capacityUnits: number }): number {
  return node.capacityUnits > 0 ? node.allocatedUnits / node.capacityUnits : Number.POSITIVE_INFINITY;
}
