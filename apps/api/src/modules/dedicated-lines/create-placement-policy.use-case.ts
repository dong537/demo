import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class CreatePlacementPolicyUseCase {
  async execute(ctx: AuthenticatedContext, input: unknown) {
    requireOperatorContext(ctx);
    const value = object(input);
    const nodeGroupId = token(value.nodeGroupId, 'placement_node_group_required');
    const inboundProfileId = token(value.inboundProfileId, 'placement_inbound_profile_required');
    const allowedNodeIds = nodeIdList(value.allowedNodeIds);
    const tenantId = optionalToken(value.tenantId);
    const userId = optionalToken(value.userId);
    const skuId = optionalToken(value.skuId);
    const targetReplicaCount = positiveInt(value.targetReplicaCount, 'placement_replica_count_invalid');
    const minReadyReplicaCount = positiveInt(value.minReadyReplicaCount, 'placement_min_ready_invalid');
    if (minReadyReplicaCount > targetReplicaCount) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_min_ready_invalid', 422);
    }
    const maxUnitsPerNode = positiveInt(value.maxUnitsPerNode, 'placement_max_units_invalid');
    const priority = value.priority === undefined ? 100 : nonNegativeInt(value.priority, 'placement_priority_invalid');

    return prisma.$transaction(async (tx) => {
      const [group, inbound, nodes, tenant, user, sku] = await Promise.all([
        tx.node_groups.findFirst({ where: { id: nodeGroupId, siteId: ctx.siteId, isActive: true } }),
        tx.inbound_profiles.findFirst({ where: { id: inboundProfileId, siteId: ctx.siteId, isActive: true } }),
        tx.control_nodes.findMany({
          where: {
            id: { in: allowedNodeIds },
            siteId: ctx.siteId,
            nodeGroupId,
            status: 'ACTIVE',
            OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
          },
          select: { id: true },
        }),
        tenantId ? tx.tenants.findFirst({ where: { id: tenantId, siteId: ctx.siteId }, select: { id: true } }) : null,
        userId ? tx.users.findFirst({ where: { id: userId, siteId: ctx.siteId, ...(tenantId ? { tenantId } : {}) }, select: { id: true } }) : null,
        skuId ? tx.service_skus.findFirst({ where: { id: skuId, siteId: ctx.siteId }, select: { id: true } }) : null,
      ]);

      if (!group || !inbound) throw new AppError(ErrorCode.NOT_FOUND, 'placement_reference_not_found', 404);
      if (inbound.nodeGroupId !== nodeGroupId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_inbound_group_mismatch', 422);
      }
      if (tenantId && !tenant) throw new AppError(ErrorCode.NOT_FOUND, 'placement_tenant_not_found', 404);
      if (userId && !user) throw new AppError(ErrorCode.NOT_FOUND, 'placement_user_not_found', 404);
      if (skuId && !sku) throw new AppError(ErrorCode.NOT_FOUND, 'placement_sku_not_found', 404);
      if (nodes.length !== allowedNodeIds.length) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_allowed_node_invalid', 422);
      }
      if (allowedNodeIds.length < targetReplicaCount) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_allowed_nodes_insufficient', 422);
      }

      const row = await tx.line_placement_policies.create({
        data: {
          siteId: ctx.siteId,
          tenantId,
          userId,
          skuId,
          nodeGroupId,
          inboundProfileId,
          mode: value.mode === 'HOT_STANDBY' ? 'HOT_STANDBY' : 'ACTIVE_ACTIVE',
          targetReplicaCount,
          minReadyReplicaCount,
          maxUnitsPerNode,
          priority,
          allowedNodes: { create: allowedNodeIds.map((nodeId) => ({ siteId: ctx.siteId, nodeId })) },
        },
        include: { allowedNodes: { include: { node: true } } },
      });
      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId,
          actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'line_placement_policy',
          targetId: row.id,
          action: 'dedicated_line_placement_policy.create',
          reason: optionalToken(value.reason),
          requestId: ctx.requestId,
          meta: { allowedNodeIds, nodeGroupId, inboundProfileId, targetReplicaCount },
        },
      });
      return row;
    });
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'control_plane_body_invalid', 400);
  }
  return value as Record<string, unknown>;
}

function token(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return value.trim();
}

function optionalToken(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : token(value, 'control_plane_token_invalid');
}

function nodeIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_allowed_nodes_required', 400);
  }
  const ids = value.map((item) => token(item, 'placement_allowed_node_invalid'));
  if (new Set(ids).size !== ids.length) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'placement_allowed_nodes_duplicate', 422);
  }
  return ids;
}

function positiveInt(value: unknown, reasonKey: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value as number;
}

function nonNegativeInt(value: unknown, reasonKey: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value as number;
}
