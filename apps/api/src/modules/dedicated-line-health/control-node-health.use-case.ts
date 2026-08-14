import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { ManagedLineProjectionAdapter } from '../dedicated-line-projections/managed-line-projection.adapter';

@Injectable()
export class ProcessControlNodeHealthUseCase {
  constructor(private readonly adapter: ManagedLineProjectionAdapter) {}

  async execute(limit = 50): Promise<{ nodes: number; observations: number; recommendations: number }> {
    const nodes = await prisma.control_nodes.findMany({
      where: { status: { in: ['ACTIVE', 'DRAINING'] }, projections: { some: { migrationId: null } } },
      include: { projections: { where: { migrationId: null }, select: { projectionKey: true, dedicatedLineId: true, desiredVersion: true, desiredHash: true, dedicatedLine: { include: { placement: { include: { policy: { include: { allowedNodes: true } } } } } } } } },
      orderBy: { code: 'asc' },
      take: limit,
    });
    let observations = 0;
    let recommendations = 0;
    for (const node of nodes) {
      for (const projection of node.projections) {
        let reachable = false;
        let observedVersion: number | null = null;
        let observedHash: string | null = null;
        let latencyMs: number | null = null;
        let failureType: string | null = null;
        let failureDetail: Prisma.InputJsonObject | undefined;
        const started = Date.now();
        try {
          const response = await this.adapter.get(node, projection.projectionKey);
          latencyMs = Date.now() - started;
          observedVersion = response.observedVersion;
          observedHash = response.observedHash;
          reachable = response.observedVersion === projection.desiredVersion && response.observedHash === projection.desiredHash;
          if (!reachable) failureType = 'PROJECTION_DRIFT';
        } catch (error: unknown) {
          latencyMs = Date.now() - started;
          failureType = 'CONTROL_NODE_UNREACHABLE';
          failureDetail = { message: error instanceof Error ? error.message.slice(0, 500) : String(error) };
        }
        await prisma.$transaction(async (tx) => {
          await tx.control_node_health_observations.create({ data: { siteId: node.siteId, nodeId: node.id, projectionKey: projection.projectionKey, reachable, observedVersion, observedHash, latencyMs, failureType, failureDetail } });
          if (reachable) {
            await tx.control_nodes.update({ where: { id: node.id }, data: { lastHealthyAt: new Date() } });
            return;
          }
          const placement = projection.dedicatedLine.placement;
          if (!placement?.policy) return;
          const allowedNodeIds = placement.policy.allowedNodes.map((entry) => entry.nodeId).filter((id) => id !== node.id);
          if (allowedNodeIds.length === 0) return;
          const candidates = await tx.control_nodes.findMany({ where: { id: { in: allowedNodeIds }, siteId: node.siteId, status: 'ACTIVE' }, orderBy: [{ allocatedUnits: 'asc' }, { code: 'asc' }], select: { id: true, allocatedUnits: true, capacityUnits: true } });
          const eligible = candidates.filter((candidate) => candidate.allocatedUnits < Math.min(candidate.capacityUnits, placement.policy!.maxUnitsPerNode));
          const existing = await tx.dedicated_line_migration_recommendations.findFirst({ where: { dedicatedLineId: projection.dedicatedLineId, sourceNodeId: node.id, incidentVersion: projection.desiredVersion, status: 'ACTIVE' }, select: { id: true } });
          if (existing) return;
          await tx.dedicated_line_migration_recommendations.create({ data: { siteId: node.siteId, tenantId: projection.dedicatedLine.tenantId, userId: projection.dedicatedLine.userId, dedicatedLineId: projection.dedicatedLineId, sourceNodeId: node.id, incidentVersion: projection.desiredVersion, reasonCode: failureType ?? 'CONTROL_NODE_UNHEALTHY', reasonDetail: failureDetail, candidates: { create: candidates.map((candidate, rank) => ({ siteId: node.siteId, nodeId: candidate.id, rank, eligible: eligible.some((item) => item.id === candidate.id), reasonCode: eligible.some((item) => item.id === candidate.id) ? null : 'CAPACITY_EXHAUSTED' })) } } });
          recommendations += 1;
        });
        observations += 1;
      }
    }
    return { nodes: nodes.length, observations, recommendations };
  }
}
