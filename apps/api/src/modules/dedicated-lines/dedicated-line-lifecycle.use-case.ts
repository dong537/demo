import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireUserContext } from '../../common/auth/auth-context';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { buildManagedLineProjectionRequest } from '../dedicated-line-projections/build-managed-line-projection-request';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';
import { assertDedicatedLineTransition, type DedicatedLineStatus } from './domain';

export type DedicatedLineLifecycleAction = 'suspend' | 'resume';

@Injectable()
export class DedicatedLineLifecycleUseCase {
  constructor(private readonly config: ConfigService) {}

  async execute(ctx: AuthenticatedContext, lineId: string, action: DedicatedLineLifecycleAction) {
    requireUserContext(ctx);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);

    return prisma.$transaction(async (tx) => {
      const line = await tx.dedicated_lines.findFirst({
        where: { id: lineId, siteId: ctx.siteId, tenantId, userId: ctx.ownerId },
        include: {
          inboundProfile: { select: { inboundTag: true } },
          exitAssignment: { include: { residentialExit: { select: { status: true, expiresAt: true, endpointCiphertext: true, credentialCiphertext: true } } } },
          projections: { select: { id: true, nodeId: true } },
        },
      });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);

      const target = action === 'suspend' ? 'SUSPENDED' : 'PROVISIONING';
      if (isAlreadyTarget(action, line.status)) return toResult(line, true);
      assertDedicatedLineTransition(line.status as DedicatedLineStatus, target);
      if (action === 'resume') assertResumable(line);

      const assignment = line.exitAssignment;
      if (!assignment || assignment.status !== 'ACTIVE' || assignment.residentialExit.status !== 'ASSIGNED') {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_assignment_missing', 422);
      }
      const desiredVersion = line.desiredVersion + 1;
      const request = buildManagedLineProjectionRequest({
        desiredVersion,
        inboundTag: line.inboundProfile.inboundTag,
        protocol: line.protocol,
        clientEmail: line.clientEmail,
        clientIdentityCiphertext: line.clientIdentityCiphertext,
        lineStatus: target,
        expiresAt: line.expiresAt,
        quotaBytes: line.quotaBytes,
        uplinkLimitBps: line.uplinkLimitBps,
        downlinkLimitBps: line.downlinkLimitBps,
        maxConnections: line.maxConnections,
        ipLimit: line.ipLimit,
        endpointCiphertext: assignment.residentialExit.endpointCiphertext,
        credentialCiphertext: assignment.residentialExit.credentialCiphertext,
      }, this.config.get('APP_ENCRYPTION_KEY'));
      const desiredHash = managedLineProjectionDesiredHash(request);

      await tx.dedicated_lines.update({
        where: { id: line.id },
        data: { status: target, desiredVersion, suspendedAt: action === 'suspend' ? new Date() : null },
      });
      await tx.dedicated_line_projections.updateMany({
        where: { dedicatedLineId: line.id },
        data: {
          desiredVersion,
          desiredHash,
          observedVersion: null,
          observedHash: null,
          nodeExternalId: null,
          status: 'PENDING',
          lastErrorCode: null,
          lastErrorDetail: Prisma.JsonNull,
        },
      });
      for (const projection of line.projections) {
        const jobKey = `projection:${line.id}:${projection.nodeId}:v${desiredVersion}`;
        await tx.external_jobs.create({
          data: {
            siteId: ctx.siteId,
            tenantId,
            userId: ctx.ownerId,
            dedicatedLineId: line.id,
            kind: 'APPLY_DEDICATED_LINE_PROJECTION',
            aggregateType: 'dedicated_line_projection',
            aggregateId: projection.id,
            desiredVersion,
            idempotencyKey: jobKey,
            dedupeKey: jobKey,
            payload: { projectionKey: `${line.id}:${projection.nodeId}` },
          },
        });
      }
      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId,
          actorType: 'USER',
          actorId: ctx.ownerId,
          targetType: 'dedicated_lines',
          targetId: line.id,
          action: `dedicated_line.${action}`,
          requestId: ctx.requestId,
          meta: { desiredVersion, status: target },
        },
      });
      return toResult({ ...line, status: target, desiredVersion }, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function isAlreadyTarget(action: DedicatedLineLifecycleAction, status: string): boolean {
  if (action === 'suspend') return status === 'SUSPENDED';
  return ['PROVISIONING', 'ACTIVE', 'DEGRADED', 'MIGRATING_AWAITING_ROUTE_IMPORT'].includes(status);
}

function assertResumable(line: {
  expiresAt: Date | null;
  exitAssignment: { residentialExit: { status: string; expiresAt: Date | null } } | null;
}): void {
  if (!line.expiresAt || line.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_expired', 422);
  }
  if (!line.exitAssignment?.residentialExit.expiresAt || line.exitAssignment.residentialExit.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_expired', 422);
  }
}

function toResult(line: { id: string; status: string; desiredVersion: number; expiresAt: Date | null }, replayed: boolean) {
  return { lineId: line.id, status: line.status, desiredVersion: line.desiredVersion, expiresAt: line.expiresAt, replayed };
}
