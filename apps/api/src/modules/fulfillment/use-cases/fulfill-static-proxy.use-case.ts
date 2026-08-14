import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { prisma, Prisma } from '@ipeasy/db';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ProviderBuyResult, ProviderCode, StaticProxyBuyInput } from '../../providers/provider.types';
import { WalletRepository } from '../../wallet/wallet.repository';
import { FulfillmentRepository } from '../fulfillment.repository';
import { ProxiesRepository } from '../../proxies/proxies.repository';
import { ConfigService } from '../../../common/config/config.service';
import { allowsAny } from '../../../common/config/allowlist';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

type JsonObject = Record<string, unknown>;
type Resource = NonNullable<Awaited<ReturnType<typeof prisma.platform_resources.findUnique>>>;
export type FulfillmentExecutionResult =
  | { status: 'NOOP'; jobId: string }
  | { status: 'COMPLETED'; jobId: string; orderId: string }
  | { status: 'RETRYING'; jobId: string; orderId: string; attempts: number; error: string }
  | { status: 'FAILED_REFUNDED'; jobId: string; orderId: string; attempts: number; error: string };

@Injectable()
export class FulfillStaticProxyUseCase {
  constructor(
    private readonly fulfillmentRepo: FulfillmentRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly walletRepo: WalletRepository,
    private readonly proxiesRepo: ProxiesRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(jobId: string): Promise<FulfillmentExecutionResult> {
    const job = await this.fulfillmentRepo.claimRunnableJob(jobId);
    if (!job) return { status: 'NOOP', jobId };

    const order = await prisma.orders.findUnique({ where: { id: job.orderId } });
    if (!order) {
      await this.fulfillmentRepo.updateJobStatus(job.id, 'FAILED', {
        attempts: job.attempts + 1,
        lastError: 'order_not_found',
      });
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'fulfillment_order_not_found', 500);
    }

    try {
      const providerCode = job.providerCode as ProviderCode;
      // Get resource for provider input and account binding.
      const resource = await prisma.platform_resources.findUnique({ where: { id: order.resourceId } });
      if (!resource || resource.siteId !== order.siteId) {
        throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
      }
      const boundUpstreamAccountId = job.upstreamAccountId ?? resource.upstreamAccountId ?? null;
      const providerConfig = boundUpstreamAccountId
        ? await this.providerRegistry.getConfigForProviderAccount(providerCode, order.siteId, boundUpstreamAccountId)
        : await this.providerRegistry.getConfig(providerCode, order.siteId, order.tenantId);

      if (providerConfig.status === 'DISABLED') {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 503);
      }
      if (this.config.get('PROVIDER_FULFILLMENT_EXECUTION_ENABLED') !== 'true') {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_fulfillment_execution_disabled', 503);
      }
      const fulfillmentAllowed = allowsAny([
        { value: providerConfig.code, allowlist: this.config.get('PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST') },
        { value: providerConfig.upstreamAccountId, allowlist: this.config.get('PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST') },
      ]);
      if (!fulfillmentAllowed) {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_not_allowed_for_fulfillment', 503);
      }

      const upstreamAccountId = boundUpstreamAccountId ?? providerConfig.upstreamAccountId ?? null;

      // Resolve the upstream resource id (IPIPD lineId / 985Proxy "CC:type")
      // from resource_mappings so the adapter orders the exact upstream line.
      const mapping = await prisma.resource_mappings.findFirst({
        where: {
          siteId: order.siteId,
          resourceId: order.resourceId,
          providerCode: job.providerCode,
          ...(upstreamAccountId !== null ? { upstreamAccountId } : {}),
        },
        orderBy: { weight: 'desc' },
      });

      const quoteSnapshot = asJsonObject(order.quoteSnapshot);
      const businessType =
        typeof quoteSnapshot['businessType'] === 'string'
          ? quoteSnapshot['businessType']
          : mapping?.providerResourceId;

      const buyInput: StaticProxyBuyInput = {
        countryCode: orderResourceCountryCode(resource),
        regionCode: orderResourceRegion(resource, mapping?.providerResourceId),
        quantity: order.quantity,
        durationDays: order.durationDays,
        currency: order.currency,
        ipType: resource.ipType === 'BOTH' ? 'NATIVE' : (resource.ipType as 'NATIVE' | 'BROADCAST'),
        protocol: resource.protocol === 'BOTH' ? 'HTTP' : (resource.protocol as 'HTTP' | 'SOCKS5'),
        providerResourceId: mapping?.providerResourceId,
        businessType,
        idempotencyKey: order.idempotencyKey,
      };

      const adapter = this.providerRegistry.getAdapter(providerCode);
      const existingMirror = await prisma.upstream_order_mirrors.findFirst({
        where: {
          orderId: order.id,
          fulfillmentJobId: job.id,
          providerCode,
          ...(upstreamAccountId !== null ? { upstreamAccountId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      const buyResult = existingMirror
        ? await adapter.queryOrder({
            upstreamOrderId: existingMirror.upstreamOrderId,
            protocol: buyInput.protocol === 'SOCKS5' ? 'SOCKS5' : 'HTTP',
            countryCode: buyInput.countryCode,
          }, providerConfig)
        : await createUpstreamOrderMirror(
            await adapter.buyStaticProxy(buyInput, providerConfig),
            order,
            job.id,
            providerCode,
            upstreamAccountId,
          );

      if (buyResult.status === 'FAILED') {
        throw new AppError(ErrorCode.UPSTREAM_ERROR, buyResult.failReason ?? 'upstream_order_failed', 502);
      }
      if (buyResult.status === 'PENDING' || buyResult.proxies.length === 0) {
        throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_order_pending', 502);
      }
      if (buyResult.proxies.length !== order.quantity) {
        throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_proxy_count_mismatch', 502);
      }

      const encKey = this.config.get('APP_ENCRYPTION_KEY');

      await prisma.$transaction(async (tx) => {
        const mirror = await tx.upstream_order_mirrors.findFirst({
          where: {
            orderId: order.id,
            fulfillmentJobId: job.id,
            providerCode,
            upstreamOrderId: buyResult.upstreamOrderId,
            ...(upstreamAccountId !== null ? { upstreamAccountId } : {}),
          },
        });
        if (!mirror) {
          throw new AppError(ErrorCode.INTERNAL_ERROR, 'upstream_order_mirror_missing', 500);
        }
        await tx.upstream_order_mirrors.update({
          where: { id: mirror.id },
          data: {
            status: buyResult.status,
            rawResponse: { proxiesCount: buyResult.proxies.length },
          },
        });

        const proxyData = buyResult.proxies.map((p) => ({
          id: randomUUID(),
          siteId: order.siteId,
          tenantId: order.tenantId,
          userId: order.userId,
          orderId: order.id,
          upstreamOrderMirrorId: mirror.id,
          upstreamProxyId: p.upstreamProxyId,
          providerCode,
          upstreamAccountId,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: encryptAesGcm(p.password, encKey),
          protocol: p.protocol as 'HTTP' | 'SOCKS5',
          countryCode: p.countryCode,
          regionCode: orderResourceRegion(resource, mapping?.providerResourceId),
          ipType: (resource!.ipType === 'BOTH' ? 'NATIVE' : resource!.ipType) as 'NATIVE' | 'BROADCAST',
          status: 'ACTIVE' as const,
          expiresAt: p.expiresAt,
          businessType,
        }));

        await this.proxiesRepo.createMany(tx, proxyData);
        await tx.orders.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
        await tx.fulfillment_jobs.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), attempts: { increment: 1 } } });
      });
      return { status: 'COMPLETED', jobId: job.id, orderId: order.id };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = job.attempts + 1;

      if (newAttempts >= job.maxAttempts) {
        const wallet = await this.walletRepo.getWalletByUserId(order.userId, order.siteId, order.tenantId);
        await prisma.$transaction(async (tx) => {
          await this.walletRepo.creditWalletTx(
            tx,
            wallet.id,
            order.totalPrice.toString(),
            order.currency,
            'REFUND',
            order.id,
            'fulfillment_failed_refund',
            fulfillmentRefundLedgerKey(order),
          );
          await tx.orders.update({ where: { id: order.id }, data: { status: 'FAILED', failReason: errorMsg } });
          await tx.fulfillment_jobs.update({
            where: { id: job.id },
            data: { status: 'FAILED', attempts: newAttempts, lastError: errorMsg, completedAt: new Date() },
          });
          await tx.audit_logs.create({
            data: {
              siteId: order.siteId,
              tenantId: order.tenantId,
              actorType: 'SYSTEM',
              actorId: 'worker',
              targetType: 'orders',
              targetId: order.id,
              action: 'order.fulfillment_failed',
              requestId: randomUUID(),
              meta: { jobId, attempts: newAttempts, error: errorMsg },
            },
          });
        });
        return { status: 'FAILED_REFUNDED', jobId: job.id, orderId: order.id, attempts: newAttempts, error: errorMsg };
      } else {
        await this.fulfillmentRepo.updateJobStatus(jobId, 'RETRYING', {
          attempts: newAttempts,
          lastError: errorMsg,
          scheduledAt: nextRetryAt(newAttempts),
        });
        return { status: 'RETRYING', jobId: job.id, orderId: order.id, attempts: newAttempts, error: errorMsg };
      }
    }
  }
}

async function createUpstreamOrderMirror(
  buyResult: ProviderBuyResult,
  order: NonNullable<Awaited<ReturnType<typeof prisma.orders.findUnique>>>,
  fulfillmentJobId: string,
  providerCode: ProviderCode,
  upstreamAccountId: string | null,
): Promise<ProviderBuyResult> {
  await prisma.upstream_order_mirrors.create({
    data: {
      id: randomUUID(),
      siteId: order.siteId,
      orderId: order.id,
      fulfillmentJobId,
      providerCode,
      upstreamAccountId,
      upstreamOrderId: buyResult.upstreamOrderId,
      status: buyResult.status,
      rawResponse: { proxiesCount: buyResult.proxies.length },
    },
  });
  return buyResult;
}

function asJsonObject(value: Prisma.JsonValue): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function orderResourceRegion(resource: Resource, providerResourceId?: string | null): string | undefined {
  if (resource.providerCode === 'PR') {
    return extractPrResourceRegion(resource.code)
      ?? extractPrResourceRegion(providerResourceId ?? undefined)
      ?? extractPrResourceRegion(resource.displayName)
      ?? extractPrResourceRegion(resource.name);
  }
  if (resource.type !== 'REGION') return undefined;
  const parts = resource.code.split(':');
  return parts.length === 1 ? resource.code : undefined;
}

function extractPrResourceRegion(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return undefined;
  const detailParts = parts.slice(1);
  if (detailParts.length > 1 && /^\d+$/.test(detailParts[0] ?? '')) {
    detailParts.shift();
  }
  const region = detailParts.join(':').trim();
  return region || undefined;
}

function orderResourceCountryCode(resource: Resource): string {
  const [country] = resource.code.trim().toUpperCase().split(':');
  return country && /^[A-Z]{2}$/.test(country) ? country : resource.code;
}

function nextRetryAt(attempts: number): Date {
  const backoffSeconds = Math.min(300, attempts * 30);
  return new Date(Date.now() + backoffSeconds * 1000);
}

function fulfillmentRefundLedgerKey(order: NonNullable<Awaited<ReturnType<typeof prisma.orders.findUnique>>>): string {
  return `refund-${order.siteId}-${order.tenantId}-${order.userId}-${order.id}-${order.idempotencyKey}`;
}
