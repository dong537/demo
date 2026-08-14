import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import {
  ProviderAdapter,
  ProviderCode,
  ProviderProxyLifecycleResult,
  ProviderRuntimeConfig,
  ProxyDelivery,
} from '../providers/provider.types';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProxyInstance } from './proxies.repository';
import { ProxyAuditService } from './proxy-audit.service';

export type ProxyLifecycleAction = 'renew' | 'changePassword' | 'switchIp';

interface LifecycleInput {
  proxyId: string;
  ctx: AuthenticatedContext;
  action: ProxyLifecycleAction;
  durationDays?: number;
  idempotencyKey?: string;
}

@Injectable()
export class ProxyLifecycleService {
  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly config: ConfigService,
    private readonly audit: ProxyAuditService,
  ) {}

  async execute(input: LifecycleInput): Promise<ProxyInstance> {
    if (!input.ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
    }

    let proxyForAudit: ProxyInstance | null = null;
    try {
      const proxy = await prisma.proxy_instances.findUnique({ where: { id: input.proxyId } });
      if (!proxy || proxy.userId !== input.ctx.ownerId || proxy.siteId !== input.ctx.siteId || proxy.tenantId !== input.ctx.tenantId) {
        throw new AppError(ErrorCode.NOT_FOUND, 'proxy_not_found', 404);
      }
      proxyForAudit = proxy;
      if (!proxy.upstreamProxyId) {
        throw new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, 'upstream_proxy_id_missing', 422);
      }

      const providerCode = proxy.providerCode as ProviderCode;
      const config = proxy.upstreamAccountId
        ? await this.providerRegistry.getConfigForProviderAccount(providerCode, proxy.siteId, proxy.upstreamAccountId)
        : providerCode === 'UPSTREAM_API'
          ? await this.providerRegistry.getConfigForUpstreamAccount(proxy.siteId, proxy.tenantId)
          : await this.providerRegistry.getConfig(providerCode, proxy.siteId, proxy.tenantId);
      if (!config || config.status === 'DISABLED') {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 422);
      }

      const adapter = this.providerRegistry.getAdapter(providerCode);
      const result = await executeAdapterAction(adapter, input.action, {
        upstreamProxyId: proxy.upstreamProxyId,
        durationDays: input.durationDays,
        idempotencyKey: input.idempotencyKey,
      }, config);

      const nextProxy = result.proxy
        ? await updateProxyDelivery(proxy.id, result.proxy, this.config.get('APP_ENCRYPTION_KEY'))
        : proxy;
      await this.audit.recordLifecycle(input.ctx, nextProxy, input.action, 'success', {
        ...lifecycleMeta(input),
        deliveryUpdated: Boolean(result.proxy),
      });

      return nextProxy;
    } catch (error: unknown) {
      if (proxyForAudit) {
        await this.recordLifecycleFailure(input, proxyForAudit, error);
      }
      throw error;
    }
  }

  private async recordLifecycleFailure(input: LifecycleInput, proxy: ProxyInstance, error: unknown): Promise<void> {
    await this.audit.recordLifecycle(input.ctx, proxy, input.action, 'failed', {
      ...lifecycleMeta(input),
      ...this.audit.errorMeta(error),
    });
  }
}

function lifecycleMeta(input: LifecycleInput): Record<string, unknown> {
  return {
    ...(input.durationDays === undefined ? {} : { durationDays: input.durationDays }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  };
}

function executeAdapterAction(
  adapter: ProviderAdapter,
  action: ProxyLifecycleAction,
  input: { upstreamProxyId: string; durationDays?: number; idempotencyKey?: string },
  config: ProviderRuntimeConfig,
): Promise<ProviderProxyLifecycleResult> {
  if (action === 'renew') {
    if (!adapter.renewStaticProxy) throw unsupported('renew_not_supported');
    return adapter.renewStaticProxy(input, config);
  }
  if (action === 'changePassword') {
    if (!adapter.changeProxyPassword) throw unsupported('change_password_not_supported');
    return adapter.changeProxyPassword(input, config);
  }
  if (!adapter.switchProxyIp) throw unsupported('switch_ip_not_supported');
  return adapter.switchProxyIp(input, config);
}

function unsupported(reasonKey: string): AppError {
  return new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, reasonKey, 501);
}

function updateProxyDelivery(proxyId: string, delivery: ProxyDelivery, encryptionKey: string): Promise<ProxyInstance> {
  const data = {
    ...(delivery.upstreamProxyId ? { upstreamProxyId: delivery.upstreamProxyId } : {}),
    ip: delivery.ip,
    port: delivery.port,
    username: delivery.username,
    password: encryptAesGcm(delivery.password, encryptionKey),
    protocol: delivery.protocol,
    countryCode: delivery.countryCode,
    expiresAt: delivery.expiresAt,
    status: 'ACTIVE' as const,
  };
  return prisma.proxy_instances.update({
    where: { id: proxyId },
    data,
  });
}
