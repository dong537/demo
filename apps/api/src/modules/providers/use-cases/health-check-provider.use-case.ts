import { Injectable, Logger } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { ProvidersRepository, ProviderAccountRecord } from '../providers.repository';
import { ProviderRegistryService } from '../provider-registry.service';
import { ProviderHealthCheckResultDto } from '../dto';
import { ProviderRuntimeConfig } from '../provider.types';
import { requireProviderAdmin } from '../admin-access';

/**
 * Runs a live connectivity probe against one provider account (PLATFORM_ADMIN
 * only). The result is never persisted — this is an on-demand probe.
 *
 * Error model:
 *  - permission / ownership errors throw (403 / NOT_FOUND) BEFORE the probe, so
 *    a cross-site id is indistinguishable from a missing one.
 *  - any failure of the probe itself (decrypt, adapter lookup, unreachable,
 *    timeout, upstream, unsafe base URL) converges into `reachable: false` +
 *    a stable `reasonKey`.
 *    It must never surface as a 500.
 */
@Injectable()
export class HealthCheckProviderUseCase {
  private readonly logger = new Logger(HealthCheckProviderUseCase.name);

  constructor(
    private readonly repo: ProvidersRepository,
    private readonly registry: ProviderRegistryService,
  ) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<ProviderHealthCheckResultDto> {
    requireProviderAdmin(ctx);

    const account = await this.repo.findForSite(ctx.siteId, id);
    if (!account) {
      throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    }

    const base = {
      accountId: account.id,
      providerCode: account.providerCode,
      checkedAt: new Date(),
    };

    let runtimeConfig: ProviderRuntimeConfig;
    try {
      runtimeConfig = await this.registry.getConfigForProviderAccount(account.providerCode, account.siteId, account.id);
    } catch (error) {
      this.logger.warn(
        `provider.health_check config resolution failed for account ${account.id}: ${formatAuditError(error)}`,
      );
      return { ...base, ...mapProbeError(error), latencyMs: null };
    }

    const result = await this.probe(account, runtimeConfig);
    await this.tryWriteAudit(ctx, account, result);
    return result;
  }

  private async probe(account: ProviderAccountRecord, runtimeConfig: ProviderRuntimeConfig): Promise<ProviderHealthCheckResultDto> {
    const base = {
      accountId: account.id,
      providerCode: account.providerCode,
      checkedAt: new Date(),
    };

    let adapter;
    try {
      adapter = this.registry.getAdapter(account.providerCode);
    } catch (error) {
      this.logger.warn(
        `provider.health_check adapter lookup failed for account ${account.id}: ${formatAuditError(error)}`,
      );
      return { ...base, ...mapProbeError(error), latencyMs: null };
    }

    const start = Date.now();
    try {
      const health = await adapter.healthCheck(runtimeConfig);
      return {
        ...base,
        reachable: health.healthy,
        latencyMs: health.latencyMs,
        reasonKey: health.healthy ? null : normalizeProbeReasonKey(health.error),
        detail: health.error ?? null,
      };
    } catch (error) {
      return { ...base, ...mapProbeError(error), latencyMs: Date.now() - start };
    }
  }

  private async writeAudit(
    ctx: AuthenticatedContext,
    account: ProviderAccountRecord,
    result: ProviderHealthCheckResultDto,
  ): Promise<void> {
    await prisma.audit_logs.create({
      data: {
        siteId: account.siteId,
        tenantId: account.tenantId,
        actorType: 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'provider_account',
        targetId: account.id,
        action: 'provider.health_check',
        requestId: requestIdStorage.getStore() ?? ctx.requestId,
        meta: { providerCode: account.providerCode, reachable: result.reachable } as Prisma.InputJsonObject,
      },
    });
  }

  private async tryWriteAudit(
    ctx: AuthenticatedContext,
    account: ProviderAccountRecord,
    result: ProviderHealthCheckResultDto,
  ): Promise<void> {
    try {
      await this.writeAudit(ctx, account, result);
    } catch (error) {
      this.logger.warn(
        `provider.health_check audit write failed for account ${account.id}: ${formatAuditError(error)}`,
      );
    }
  }
}

/**
 * Maps a thrown probe error into the result shape. Connectivity-class failures
 * keep their reasonKey; anything unexpected converges to `provider_unreachable`
 * so the endpoint never 500s on a probe.
 */
function mapProbeError(error: unknown): Pick<ProviderHealthCheckResultDto, 'reachable' | 'reasonKey' | 'detail'> {
  if (error instanceof AppError) {
    return { reachable: false, reasonKey: error.reasonKey, detail: error.message };
  }
  return {
    reachable: false,
    reasonKey: 'provider_unreachable',
    detail: error instanceof Error ? error.message : String(error),
  };
}

function normalizeProbeReasonKey(error: string | null | undefined): string {
  const reason = error?.trim();
  if (!reason) return 'provider_unreachable';
  if (/^HTTP \d{3}$/i.test(reason)) return 'provider_unreachable';
  if (/^[a-z][a-z0-9_]*$/i.test(reason)) return reason;
  return 'provider_unreachable';
}

function formatAuditError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
