import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { normalizeDeliveryRouteImport } from './delivery-route-import.domain';

@Injectable()
export class DeliveryRouteImportUseCase {
  async execute(ctx: AuthenticatedContext, body: unknown): Promise<{
    importId: string;
    sourceName: string;
    sourceVersion: string;
    routeCount: number;
    replayed: boolean;
    stage: 'INITIAL' | 'CANARY' | 'CUTOVER' | 'ROLLBACK';
    currentChanged: boolean;
  }> {
    requireOperatorContext(ctx);
    const input = asObject(body);
    const normalized = normalizeDeliveryRouteImport({
      sourceName: input['sourceName'],
      sourceVersion: input['sourceVersion'],
      capturedAt: input['capturedAt'],
      expiresAt: input['expiresAt'],
      routes: input['routes'],
      allowCanaryDomains: input['stage'] === 'CANARY',
    });
    const stage = input['stage'] === undefined ? 'INITIAL' : input['stage'];
    if (stage !== 'INITIAL' && stage !== 'CANARY' && stage !== 'CUTOVER' && stage !== 'ROLLBACK') throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_stage_invalid', 422);
    const migrationId = stage === 'INITIAL' ? null : token(input['migrationId'], 'route_import_migration_required');
    return prisma.$transaction(async (tx) => {
      const existing = await tx.delivery_route_imports.findUnique({
        where: { siteId_sourceName_sourceVersion: { siteId: ctx.siteId, sourceName: normalized.sourceName, sourceVersion: normalized.sourceVersion } },
        select: {
          id: true,
          sourceFingerprint: true,
          sourceName: true,
          sourceVersion: true,
          routes: { select: { id: true, migrationId: true, migrationStage: true } },
        },
      });
      if (existing) {
        if (existing.sourceFingerprint !== normalized.sourceFingerprint) {
          throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'route_import_source_version_conflict', 409);
        }
        const replayMatches = existing.routes.length > 0
          && existing.routes.every((route) => route.migrationId === migrationId && route.migrationStage === stage);
        if (!replayMatches) {
          throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'route_import_replay_contract_conflict', 409);
        }
        return { importId: existing.id, sourceName: existing.sourceName, sourceVersion: existing.sourceVersion, routeCount: existing.routes.length, replayed: true, stage, currentChanged: false };
      }
      const duplicateFingerprint = await tx.delivery_route_imports.findUnique({ where: { siteId_sourceFingerprint: { siteId: ctx.siteId, sourceFingerprint: normalized.sourceFingerprint } }, select: { id: true } });
      if (duplicateFingerprint) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'route_import_fingerprint_conflict', 409);
      }
      const routeImport = await tx.delivery_route_imports.create({
        data: {
          siteId: ctx.siteId,
          sourceName: normalized.sourceName,
          sourceVersion: normalized.sourceVersion,
          sourceFingerprint: normalized.sourceFingerprint,
          importedBy: ctx.ownerId,
          capturedAt: normalized.capturedAt,
          expiresAt: normalized.expiresAt,
        },
      });
      const migration = migrationId ? await tx.dedicated_line_migrations.findFirst({ where: { id: migrationId, siteId: ctx.siteId, status: { in: ['ACTIVE', 'NEEDS_OPERATOR'] } }, include: { nodes: true } }) : null;
      if (migrationId && !migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
      if (migration && !isStageAllowed(migration.phase, migration.status, stage)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_route_stage_invalid', 422);
      if (migration && (normalized.routes.length !== 1 || normalized.routes[0]?.dedicatedLineId !== migration.dedicatedLineId)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_route_line_mismatch', 422);
      }
      for (const route of normalized.routes) {
        const line = await tx.dedicated_lines.findFirst({
          where: { id: route.dedicatedLineId, siteId: ctx.siteId },
          include: { inboundProfile: true, placement: { include: { nodes: true } }, domains: { where: { status: 'ACTIVE' } }, projections: { select: { id: true, nodeId: true, status: true, desiredVersion: true, observedVersion: true, migrationId: true } } },
        });
        if (!line || !line.placement) throw new AppError(ErrorCode.NOT_FOUND, 'route_import_line_not_found', 404);
        if (line.protocol !== route.protocol || line.inboundProfile.listenPort !== route.listenPort) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_line_contract_mismatch', 422);
        }
        const migrationNodeRole = stage === 'ROLLBACK' ? 'SOURCE' : 'TARGET';
        const placementNodeIds = new Set(migration ? migration.nodes.filter((node) => node.role === migrationNodeRole).map((node) => node.nodeId) : line.placement.nodes.map((node) => node.nodeId));
        if (route.targets.some((target) => !placementNodeIds.has(target.nodeId))) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_not_in_placement', 422);
        }
        if (route.targets.some((target) => target.targetPort !== line.inboundProfile.listenPort)) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_port_mismatch', 422);
        }
        if (stage === 'INITIAL' && !sameOwnedDomains(line.domains, route.domains)) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_domains_not_owned', 422);
        }
        if (migration) validateMigrationRoute(migration, line, route, stage);
        if (stage === 'INITIAL') await tx.delivery_routes.updateMany({
          where: { siteId: ctx.siteId, dedicatedLineId: line.id, isCurrent: true },
          data: { isCurrent: false, validUntil: new Date() },
        });
        await tx.delivery_routes.create({
          data: {
            siteId: ctx.siteId,
            tenantId: line.tenantId,
            userId: line.userId,
            routeImportId: routeImport.id,
            dedicatedLineId: line.id,
            sourceRouteId: route.sourceRouteId,
            entranceGroupCode: route.entranceGroupCode,
            protocol: route.protocol,
            listenPort: route.listenPort,
            sourceVersion: route.sourceVersion,
            isCurrent: stage === 'INITIAL',
            isStaged: stage !== 'INITIAL',
            migrationId,
            migrationStage: stage,
            validFrom: route.validFrom,
            validUntil: route.validUntil,
            domains: { create: route.domains },
            targets: { create: route.targets },
          },
        });
        if (stage === 'INITIAL') {
          await settleLineStatus(tx, {
            id: line.id,
            status: line.status,
            desiredVersion: line.desiredVersion,
            placement: line.placement,
            projections: line.projections,
          });
        }
      }
      if (migration) {
        const migrationData = stage === 'CANARY'
          ? { canaryRouteImportId: routeImport.id, phase: 'VERIFY' as const }
          : stage === 'CUTOVER'
            ? { cutoverRouteImportId: routeImport.id, phase: 'COMMIT' as const }
            : { rollbackRouteImportId: routeImport.id, phase: 'CLEANUP' as const, status: 'ACTIVE' as const };
        await tx.dedicated_line_migrations.update({ where: { id: migration.id }, data: migrationData });
      }
      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: migration?.tenantId ?? null,
          actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'delivery_route_import',
          targetId: routeImport.id,
          action: 'dedicated_line.route_import',
          requestId: ctx.requestId,
          meta: {
            sourceName: normalized.sourceName,
            sourceVersion: normalized.sourceVersion,
            stage,
            migrationId,
            routeCount: normalized.routes.length,
          },
        },
      });
      return { importId: routeImport.id, sourceName: normalized.sourceName, sourceVersion: normalized.sourceVersion, routeCount: normalized.routes.length, replayed: false, stage, currentChanged: stage === 'INITIAL' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function sameOwnedDomains(owned: Array<{ hostname: string; port: number; role: string }>, imported: Array<{ hostname: string; port: number; isPrimary: boolean }>): boolean {
  const normalize = (domains: Array<{ hostname: string; port: number; role?: string; isPrimary?: boolean }>) => domains
    .map((domain) => `${domain.hostname}:${domain.port}:${domain.role ?? (domain.isPrimary ? 'PRIMARY' : 'BACKUP')}`).sort();
  return owned.length === imported.length && JSON.stringify(normalize(owned)) === JSON.stringify(normalize(imported));
}

function isStageAllowed(phase: string, status: string, stage: string): boolean {
  return (stage === 'CANARY' && phase === 'CANARY_ROUTE' && status === 'ACTIVE')
    || (stage === 'CUTOVER' && phase === 'CUTOVER_ROUTE' && status === 'ACTIVE')
    || (stage === 'ROLLBACK' && phase === 'ROLLBACK' && status === 'NEEDS_OPERATOR');
}

function validateMigrationRoute(migration: { type: string; sourceLineVersion: number; targetLineVersion: number; nodes: Array<{ nodeId: string; role: string; projectionId: string | null }> }, line: { domains: Array<{ hostname: string; port: number; role: string }>; projections: Array<{ id: string; nodeId: string; status: string; desiredVersion: number; observedVersion: number | null; migrationId: string | null }> }, route: { domains: Array<{ hostname: string; port: number; isPrimary: boolean }>; targets: Array<{ nodeId: string; targetVersion: string }> }, stage: string): void {
  const nodeRole = stage === 'ROLLBACK' ? 'SOURCE' : 'TARGET';
  const targetNodes = migration.nodes.filter((node) => node.role === nodeRole);
  const targetNodeIds = new Set(targetNodes.map((node) => node.nodeId));
  const routeNodeIds = new Set(route.targets.map((target) => target.nodeId));
  if (routeNodeIds.size !== targetNodeIds.size || [...targetNodeIds].some((nodeId) => !routeNodeIds.has(nodeId))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_set_mismatch', 422);
  }
  const expectedTargetVersion = `v${stage === 'ROLLBACK' ? migration.sourceLineVersion : migration.targetLineVersion}`;
  if (route.targets.some((target) => target.targetVersion !== expectedTargetVersion)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_version_mismatch', 422);
  }
  if (stage !== 'ROLLBACK') {
    const targetProjectionIds = new Set(targetNodes.map((node) => node.projectionId).filter((id): id is string => Boolean(id)));
    const targetProjections = line.projections.filter((projection) => targetProjectionIds.has(projection.id));
    if (
      targetProjectionIds.size !== targetNodes.length
      || targetProjections.length !== targetNodes.length
      || targetProjections.some((projection) => projection.status !== 'READY' || projection.observedVersion !== projection.desiredVersion)
    ) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_projection_not_ready', 422);
  } else {
    const sourceProjections = line.projections.filter((projection) =>
      targetNodeIds.has(projection.nodeId)
      && projection.migrationId === null
      && projection.desiredVersion === migration.sourceLineVersion,
    );
    if (
      sourceProjections.length !== targetNodes.length
      || sourceProjections.some((projection) => projection.status !== 'READY' || projection.observedVersion !== projection.desiredVersion)
    ) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_source_projection_not_ready', 422);
  }
  if (stage === 'CANARY') {
    if (route.domains.length !== 1 || route.domains[0]?.isPrimary) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_canary_domain_invalid', 422);
    const backup = line.domains.find((domain) => domain.role === 'BACKUP');
    if (!backup || route.domains[0]?.hostname !== backup.hostname || route.domains[0]?.port !== backup.port) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_canary_domain_invalid', 422);
  } else if (route.domains.length !== line.domains.length || route.domains.some((domain) => !line.domains.some((owned) => owned.hostname === domain.hostname && owned.port === domain.port && owned.role === (domain.isPrimary ? 'PRIMARY' : 'BACKUP')))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_domains_not_owned', 422);
  }
}

function token(value: unknown, reasonKey: string): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400); return value.trim(); }

async function settleLineStatus(tx: Prisma.TransactionClient, line: {
  id: string;
  status: string;
  desiredVersion: number;
  placement: { targetReplicaCount: number; minReadyReplicaCount: number };
  projections: Array<{ id?: string; status: string; desiredVersion: number; observedVersion: number | null; migrationId?: string | null }>;
}): Promise<void> {
  if (!['PROVISIONING', 'MIGRATING_AWAITING_ROUTE_IMPORT', 'DEGRADED', 'ACTIVE'].includes(line.status)) return;
  const ready = line.projections.filter((projection) =>
    projection.migrationId == null
    && projection.desiredVersion === line.desiredVersion
    && projection.status === 'READY'
    && projection.observedVersion === projection.desiredVersion,
  ).length;
  if (ready < line.placement.minReadyReplicaCount) return;
  await tx.dedicated_lines.update({ where: { id: line.id }, data: { status: ready >= line.placement.targetReplicaCount ? 'ACTIVE' : 'DEGRADED' } });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_body_invalid', 400);
  return value as Record<string, unknown>;
}
