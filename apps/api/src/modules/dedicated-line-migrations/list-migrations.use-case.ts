import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { MigrationAllowedAction } from './domain';

@Injectable()
export class ListDedicatedLineMigrationsUseCase {
  async list(ctx: AuthenticatedContext, lineId: string) {
    requireOperatorContext(ctx);
    const rows = await prisma.dedicated_line_migrations.findMany({
      where: { siteId: ctx.siteId, dedicatedLineId: lineId },
      orderBy: { createdAt: 'desc' },
      include: {
        nodes: { include: { node: { select: { id: true, code: true, regionCode: true } } }, orderBy: [{ role: 'asc' }, { ordinal: 'asc' }] },
        smokeObservations: { orderBy: { observedAt: 'desc' }, take: 10 },
        dedicatedLine: { select: { id: true, status: true, desiredVersion: true, domains: { where: { status: 'ACTIVE' }, select: { hostname: true, port: true, role: true } } } },
        canaryRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } },
        cutoverRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } },
        rollbackRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } },
      },
    });
    return rows.map((row) => serialize(row));
  }

  async get(ctx: AuthenticatedContext, migrationId: string) {
    requireOperatorContext(ctx);
    const row = await prisma.dedicated_line_migrations.findFirst({ where: { id: migrationId, siteId: ctx.siteId }, include: { nodes: { include: { node: { select: { id: true, code: true, regionCode: true } } }, orderBy: [{ role: 'asc' }, { ordinal: 'asc' }] }, smokeObservations: { orderBy: { observedAt: 'desc' } }, dedicatedLine: { select: { id: true, status: true, desiredVersion: true, domains: { where: { status: 'ACTIVE' }, select: { hostname: true, port: true, role: true } } } }, canaryRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } }, cutoverRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } }, rollbackRouteImport: { select: { id: true, sourceName: true, sourceVersion: true, capturedAt: true } } } });
    return row ? serialize(row) : null;
  }
}

type MigrationListRow = {
  id: string;
  dedicatedLineId: string;
  type: 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL';
  phase: string;
  status: string;
  sourceLineVersion: number;
  targetLineVersion: number;
  sourceExitId: string;
  targetExitId: string | null;
  sourcePlacementId: string;
  targetPlacementId: string | null;
  createdAt: Date;
  updatedAt: Date;
  committedAt: Date | null;
  finishedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: unknown;
  retryCount: number;
  nodes: Array<{ nodeId: string; role: string; reservationStatus: string; projectionId: string | null; node: { id: string; code: string; regionCode: string } }>;
  smokeObservations: Array<{ id: string; stage: string; hostname: string; verified: boolean; observedIp: string | null; observedCountryCode: string | null; latencyMs: number | null; failureType: string | null; observedAt: Date; freshUntil: Date }>;
  dedicatedLine: { id: string; status: string; desiredVersion: number; domains: Array<{ hostname: string; port: number; role: string }> };
  canaryRouteImport: { id: string; sourceName: string; sourceVersion: string; capturedAt: Date } | null;
  cutoverRouteImport: { id: string; sourceName: string; sourceVersion: string; capturedAt: Date } | null;
  rollbackRouteImport: { id: string; sourceName: string; sourceVersion: string; capturedAt: Date } | null;
};

function serialize(row: MigrationListRow) {
  const actions: MigrationAllowedAction[] = [];
  if (row.status === 'ACTIVE') {
    if (row.phase === 'CANARY_ROUTE') actions.push('IMPORT_CANARY');
    if (row.phase === 'VERIFY') actions.push('QUEUE_VERIFY');
    if (row.phase === 'CUTOVER_ROUTE') actions.push('IMPORT_CUTOVER');
    if (row.phase === 'COMMIT') actions.push('COMMIT');
    if (row.phase === 'PREPARE' || row.phase === 'CANARY_ROUTE' || row.phase === 'VERIFY') actions.push('CANCEL');
  }
  if (row.status === 'NEEDS_OPERATOR' && row.phase === 'ROLLBACK') actions.push('IMPORT_ROLLBACK');
  if (row.status === 'NEEDS_OPERATOR' && ['PREPARE', 'VERIFY', 'CLEANUP'].includes(row.phase)) actions.push('RETRY');
  return {
    id: row.id, lineId: row.dedicatedLineId, type: row.type, phase: row.phase, status: row.status,
    sourceLineVersion: row.sourceLineVersion, targetLineVersion: row.targetLineVersion,
    sourceExitId: row.sourceExitId, targetExitId: row.targetExitId, sourcePlacementId: row.sourcePlacementId, targetPlacementId: row.targetPlacementId,
    sourceNodes: row.nodes.filter((node) => node.role === 'SOURCE').map((node) => ({ id: node.nodeId, code: node.node.code, regionCode: node.node.regionCode, reservationStatus: node.reservationStatus })),
    targetNodes: row.nodes.filter((node) => node.role === 'TARGET').map((node) => ({ id: node.nodeId, code: node.node.code, regionCode: node.node.regionCode, reservationStatus: node.reservationStatus, projectionId: node.projectionId })),
    domains: row.dedicatedLine.domains,
    smokeObservations: row.smokeObservations.map((smoke) => ({ id: smoke.id, stage: smoke.stage, hostname: smoke.hostname, verified: smoke.verified, observedIp: smoke.observedIp, observedCountryCode: smoke.observedCountryCode, latencyMs: smoke.latencyMs, failureType: smoke.failureType, observedAt: smoke.observedAt, freshUntil: smoke.freshUntil })),
    routes: { canary: row.canaryRouteImport, cutover: row.cutoverRouteImport, rollback: row.rollbackRouteImport },
    allowedActions: actions,
    lastErrorCode: row.lastErrorCode, lastErrorDetail: row.lastErrorDetail, retryCount: row.retryCount,
    createdAt: row.createdAt, updatedAt: row.updatedAt, committedAt: row.committedAt, finishedAt: row.finishedAt,
  };
}
