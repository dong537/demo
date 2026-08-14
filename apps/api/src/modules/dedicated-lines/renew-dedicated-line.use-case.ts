import { Injectable } from '@nestjs/common';
import { LedgerEntryType, prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireUserContext } from '../../common/auth/auth-context';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { SkuQuoteUseCase } from '../catalog/domain';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';
import { buildManagedLineProjectionRequest } from '../dedicated-line-projections/build-managed-line-projection-request';
import { WalletRepository } from '../wallet/wallet.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RenewDedicatedLineUseCase {
  constructor(
    private readonly quote: SkuQuoteUseCase,
    private readonly walletRepository: WalletRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(ctx: AuthenticatedContext, lineId: string, body: unknown) {
    requireUserContext(ctx);
    const input = parseInput(body);
    const wallet = await this.walletRepository.getWalletByUserId(ctx.ownerId, ctx.siteId, ctx.tenantId);
    const scopedLine = await prisma.dedicated_lines.findFirst({
      where: { id: lineId, siteId: ctx.siteId, tenantId: ctx.tenantId ?? '', userId: ctx.ownerId },
      include: { sku: { select: { code: true } } },
    });
    if (!scopedLine) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);
    assertRenewable(scopedLine.status);
    const quote = await this.quote.execute({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId!,
      userId: ctx.ownerId,
      skuCode: scopedLine.sku.code,
      durationDays: input.durationDays,
      quantity: 1,
      currency: wallet.currency,
    });
    const ledgerKey = `dedicated-line-renewal:${ctx.siteId}:${ctx.tenantId}:${ctx.ownerId}:${input.idempotencyKey}`;

    return prisma.$transaction(async (tx) => {
      const line = await tx.dedicated_lines.findFirst({
        where: { id: lineId, siteId: ctx.siteId, tenantId: ctx.tenantId ?? '', userId: ctx.ownerId },
        include: {
          sku: { select: { code: true } },
          inboundProfile: { select: { inboundTag: true } },
          exitAssignment: { include: { residentialExit: { select: { expiresAt: true, status: true, endpointCiphertext: true, credentialCiphertext: true } } } },
          projections: { select: { id: true, nodeId: true } },
        },
      });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);
      assertRenewable(line.status);
      const existing = await tx.ledger_entries.findUnique({ where: { idempotencyKey: ledgerKey } });
      if (existing) {
        await this.walletRepository.debitWalletTx(tx, wallet.id, quote.totalPrice, quote.currency, LedgerEntryType.RENEWAL, line.id, 'dedicated_line_renewal', ledgerKey);
        return toResult(line, quote.totalPrice, quote.currency, true);
      }
      const assignment = line.exitAssignment;
      if (!assignment || assignment.status !== 'ACTIVE' || assignment.residentialExit.status !== 'ASSIGNED') {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_assignment_missing', 422);
      }
      const now = Date.now();
      const baseExpiry = Math.max(line.expiresAt?.getTime() ?? 0, now);
      const expiresAt = new Date(baseExpiry + input.durationDays * DAY_MS);
      if (!assignment.residentialExit.expiresAt || expiresAt.getTime() > assignment.residentialExit.expiresAt.getTime()) {
        throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'dedicated_line_exit_expiry_insufficient', 422);
      }
      await this.walletRepository.debitWalletTx(
        tx,
        wallet.id,
        quote.totalPrice,
        quote.currency,
        LedgerEntryType.RENEWAL,
        line.id,
        'dedicated_line_renewal',
        ledgerKey,
      );
      const desiredVersion = line.desiredVersion + 1;
      const request = buildManagedLineProjectionRequest({
        desiredVersion,
        inboundTag: line.inboundProfile.inboundTag,
        protocol: line.protocol,
        clientEmail: line.clientEmail,
        clientIdentityCiphertext: line.clientIdentityCiphertext,
        lineStatus: 'PROVISIONING',
        expiresAt,
        quotaBytes: line.quotaBytes,
        uplinkLimitBps: line.uplinkLimitBps,
        downlinkLimitBps: line.downlinkLimitBps,
        maxConnections: line.maxConnections,
        ipLimit: line.ipLimit,
        endpointCiphertext: assignment.residentialExit.endpointCiphertext,
        credentialCiphertext: assignment.residentialExit.credentialCiphertext,
      }, this.config.get('APP_ENCRYPTION_KEY'));
      const desiredHash = managedLineProjectionDesiredHash(request);
      await tx.dedicated_lines.update({ where: { id: line.id }, data: { status: 'PROVISIONING', desiredVersion, expiresAt } });
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
            tenantId: ctx.tenantId,
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
      return toResult({ ...line, status: 'PROVISIONING', desiredVersion, expiresAt }, quote.totalPrice, quote.currency, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function parseInput(body: unknown): { durationDays: number; idempotencyKey: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_renewal_body_invalid', 400);
  const value = body as Record<string, unknown>;
  const durationDays = value['durationDays'];
  const idempotencyKey = value['idempotencyKey'];
  if (!Number.isInteger(durationDays) || (durationDays as number) < 1 || (durationDays as number) > 3650) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 1 || idempotencyKey.trim().length > 200) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'idempotency_key_invalid', 400);
  }
  return { durationDays: durationDays as number, idempotencyKey: idempotencyKey.trim() };
}

function assertRenewable(status: string): void {
  if (!['PROVISIONING', 'ACTIVE', 'DEGRADED', 'MIGRATING_AWAITING_ROUTE_IMPORT'].includes(status)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_not_renewable', 422);
  }
}

function toResult(line: { id: string; status: string; expiresAt: Date | null; desiredVersion: number }, amount: string, currency: string, replayed: boolean) {
  return { lineId: line.id, status: line.status, expiresAt: line.expiresAt, desiredVersion: line.desiredVersion, charged: { amount, currency }, replayed };
}
