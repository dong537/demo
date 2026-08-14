import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { buildManagedLineProjectionRequest } from '../dedicated-line-projections/build-managed-line-projection-request';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';

const PRISMA_INT_MAX = 2_147_483_647;
const MUTABLE_STATUSES = new Set([
  'PROVISIONING',
  'ACTIVE',
  'DEGRADED',
  'SUSPENDED',
  'MIGRATING_AWAITING_ROUTE_IMPORT',
]);

export type DedicatedLineLimits = {
  trafficLimitBytes: number;
  uplinkLimitBps: number;
  downlinkLimitBps: number;
  maxConnections: number;
  ipLimit: number;
};

type UpdateDedicatedLineLimitsInput = DedicatedLineLimits & { reason: string };

@Injectable()
export class UpdateDedicatedLineLimitsUseCase {
  constructor(private readonly config: ConfigService) {}

  async execute(ctx: AuthenticatedContext, lineId: string, body: unknown) {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
    }
    const input = parseInput(body);
    const requestId = requestIdStorage.getStore() ?? ctx.requestId;
    const where = {
      id: lineId,
      siteId: ctx.siteId,
      ...(ctx.ownerType === 'TENANT_ADMIN' ? { tenantId: ctx.tenantId ?? '' } : {}),
    };

    return prisma.$transaction(async (tx) => {
      const line = await tx.dedicated_lines.findFirst({
        where,
        include: {
          inboundProfile: { select: { inboundTag: true } },
          exitAssignment: {
            include: {
              residentialExit: {
                select: {
                  status: true,
                  endpointCiphertext: true,
                  credentialCiphertext: true,
                },
              },
            },
          },
          projections: { select: { id: true, nodeId: true } },
        },
      });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);
      if (!MUTABLE_STATUSES.has(line.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_limits_not_mutable', 422);
      }
      if (line.projections.length === 0) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_projection_missing', 422);
      }
      const assignment = line.exitAssignment;
      if (!assignment || assignment.status !== 'ACTIVE' || assignment.residentialExit.status !== 'ASSIGNED') {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_assignment_missing', 422);
      }

      const previous = limitsFromLine(line);
      if (sameLimits(previous, input)) {
        return { lineId: line.id, desiredVersion: line.desiredVersion, limits: previous, replayed: true };
      }

      const desiredVersion = line.desiredVersion + 1;
      const request = buildManagedLineProjectionRequest({
        desiredVersion,
        inboundTag: line.inboundProfile.inboundTag,
        protocol: line.protocol,
        clientEmail: line.clientEmail,
        clientIdentityCiphertext: line.clientIdentityCiphertext,
        lineStatus: line.status,
        expiresAt: line.expiresAt,
        quotaBytes: BigInt(input.trafficLimitBytes),
        uplinkLimitBps: BigInt(input.uplinkLimitBps),
        downlinkLimitBps: BigInt(input.downlinkLimitBps),
        maxConnections: input.maxConnections,
        ipLimit: input.ipLimit,
        endpointCiphertext: assignment.residentialExit.endpointCiphertext,
        credentialCiphertext: assignment.residentialExit.credentialCiphertext,
      }, this.config.get('APP_ENCRYPTION_KEY'));
      const desiredHash = managedLineProjectionDesiredHash(request);

      await tx.dedicated_lines.update({
        where: { id: line.id },
        data: {
          quotaBytes: BigInt(input.trafficLimitBytes),
          uplinkLimitBps: BigInt(input.uplinkLimitBps),
          downlinkLimitBps: BigInt(input.downlinkLimitBps),
          maxConnections: input.maxConnections,
          ipLimit: input.ipLimit,
          desiredVersion,
        },
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
            siteId: line.siteId,
            tenantId: line.tenantId,
            userId: line.userId,
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
      const limits = withoutReason(input);
      await tx.audit_logs.create({
        data: {
          siteId: line.siteId,
          tenantId: line.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'dedicated_lines',
          targetId: line.id,
          action: 'dedicated_line.limits.update',
          reason: input.reason,
          requestId,
          meta: { previous, next: limits, desiredVersion },
        },
      });

      return { lineId: line.id, desiredVersion, limits, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function parseInput(body: unknown): UpdateDedicatedLineLimitsInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_limits_body_invalid', 400);
  }
  const input = body as Record<string, unknown>;
  return {
    trafficLimitBytes: safeInteger(input['trafficLimitBytes'], Number.MAX_SAFE_INTEGER, 'dedicated_line_traffic_limit_invalid'),
    uplinkLimitBps: safeInteger(input['uplinkLimitBps'], Number.MAX_SAFE_INTEGER, 'dedicated_line_uplink_limit_invalid'),
    downlinkLimitBps: safeInteger(input['downlinkLimitBps'], Number.MAX_SAFE_INTEGER, 'dedicated_line_downlink_limit_invalid'),
    maxConnections: safeInteger(input['maxConnections'], PRISMA_INT_MAX, 'dedicated_line_connection_limit_invalid'),
    ipLimit: safeInteger(input['ipLimit'], PRISMA_INT_MAX, 'dedicated_line_ip_limit_invalid'),
    reason: requiredReason(input['reason']),
  };
}

function safeInteger(value: unknown, maximum: number, reasonKey: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return value as number;
}

function requiredReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'reason_required', 400);
  }
  return value.trim();
}

function limitsFromLine(line: {
  quotaBytes: bigint | null;
  uplinkLimitBps: bigint | null;
  downlinkLimitBps: bigint | null;
  maxConnections: number | null;
  ipLimit: number | null;
}): DedicatedLineLimits {
  return {
    trafficLimitBytes: safeDatabaseLimit(line.quotaBytes),
    uplinkLimitBps: safeDatabaseLimit(line.uplinkLimitBps),
    downlinkLimitBps: safeDatabaseLimit(line.downlinkLimitBps),
    maxConnections: line.maxConnections ?? 0,
    ipLimit: line.ipLimit ?? 0,
  };
}

function safeDatabaseLimit(value: bigint | null): number {
  const normalized = value ?? 0n;
  if (normalized < 0n || normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_limit_out_of_range', 422);
  }
  return Number(normalized);
}

function sameLimits(left: DedicatedLineLimits, right: DedicatedLineLimits): boolean {
  return left.trafficLimitBytes === right.trafficLimitBytes &&
    left.uplinkLimitBps === right.uplinkLimitBps &&
    left.downlinkLimitBps === right.downlinkLimitBps &&
    left.maxConnections === right.maxConnections &&
    left.ipLimit === right.ipLimit;
}

function withoutReason(input: UpdateDedicatedLineLimitsInput): DedicatedLineLimits {
  return {
    trafficLimitBytes: input.trafficLimitBytes,
    uplinkLimitBps: input.uplinkLimitBps,
    downlinkLimitBps: input.downlinkLimitBps,
    maxConnections: input.maxConnections,
    ipLimit: input.ipLimit,
  };
}
