import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { decryptAesGcm } from '../../../common/crypto/aes-gcm';
import { ConfigService } from '../../../common/config/config.service';
import { ProxiesRepository } from '../../proxies/proxies.repository';
import { CheckProxyDto, ProxyCheckResultDto } from '../dto';
import { PROXY_PROBER, ProxyProber } from '../proxy-prober';

@Injectable()
export class CheckProxyUseCase {
  constructor(
    private readonly proxiesRepo: ProxiesRepository,
    private readonly config: ConfigService,
    @Inject(PROXY_PROBER) private readonly prober: ProxyProber,
  ) {}

  async execute(ctx: AuthenticatedContext, dto: CheckProxyDto): Promise<ProxyCheckResultDto> {
    if (ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
    }
    if (!dto.proxyId || typeof dto.proxyId !== 'string' || dto.proxyId.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'proxy_id_required', 400);
    }

    const proxy = await this.proxiesRepo.findById(dto.proxyId);
    // Ownership is the SSRF boundary: only the caller's own proxy may be probed.
    if (
      !proxy ||
      proxy.userId !== ctx.ownerId ||
      proxy.tenantId !== ctx.tenantId ||
      proxy.siteId !== ctx.siteId
    ) {
      throw new AppError(ErrorCode.NOT_FOUND, 'proxy_not_found', 404);
    }

    const password = decryptAesGcm(proxy.password, this.config.get('APP_ENCRYPTION_KEY'));
    const outcome = await this.prober.probe({
      ip: proxy.ip,
      port: proxy.port,
      username: proxy.username,
      password,
      protocol: proxy.protocol,
    });

    let result: ProxyCheckResultDto;
    if (outcome.reachable) {
      result = { reachable: true, latencyMs: outcome.latencyMs, ...(outcome.exitIp ? { exitIp: outcome.exitIp } : {}) };
    } else {
      const timedOut = 'timedOut' in outcome && outcome.timedOut;
      result = {
        reachable: false,
        error: timedOut
          ? { code: 'PROXY_TIMEOUT', reasonKey: 'proxy_check_timeout' }
          : { code: 'PROXY_UNREACHABLE', reasonKey: 'proxy_unreachable' },
      };
    }

    await this.recordAudit(ctx, proxy.id, proxy.tenantId, proxy.protocol, result);
    return result;
  }

  private async recordAudit(
    ctx: AuthenticatedContext,
    proxyId: string,
    tenantId: string,
    protocol: string,
    result: ProxyCheckResultDto,
  ): Promise<void> {
    const requestId = requestIdStorage.getStore() ?? ctx.requestId ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId,
        actorType: 'USER',
        actorId: ctx.ownerId,
        targetType: 'proxy_instances',
        targetId: proxyId,
        action: 'proxy.check',
        reason: result.error?.reasonKey,
        requestId,
        meta: {
          protocol,
          reachable: result.reachable,
          ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
        },
      },
    });
  }
}
