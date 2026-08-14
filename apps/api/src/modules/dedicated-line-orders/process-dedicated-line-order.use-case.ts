import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import type { ProviderCode, ProviderBuyResult, StaticProxyBuyInput } from '../providers/provider.types';
import { allowsAny } from '../../common/config/allowlist';
import { ConfigService } from '../../common/config/config.service';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  DedicatedLineOrderJob,
  DedicatedLineOrderRepository,
  exitIdentityFingerprint,
} from './dedicated-line-order.repository';
import { managedLineProjectionDesiredHash } from '../dedicated-line-projections/domain';

export type DedicatedLineOrderExecutionResult =
  | { status: 'NOOP'; jobId: string }
  | { status: 'COMPLETED'; jobId: string; reservationId: string; exits: number }
  | { status: 'RETRYING'; jobId: string; attempts: number; upstreamOrderId: string }
  | { status: 'NEEDS_OPERATOR'; jobId: string; error: string };

type DedicatedLineOrderRequest = {
  durationDays: number;
  currency: string;
  protocol: 'SOCKS5';
  providerResourceId: string;
  placementPolicyId: string;
  inboundProfileId: string;
  inboundTag: string;
  lineProtocol: 'VLESS' | 'VMESS' | 'MIXED';
  maxReplicaFanout: number;
  regionCode?: string;
  businessType?: string;
};

@Injectable()
export class ProcessDedicatedLineOrderUseCase {
  constructor(
    private readonly jobs: DedicatedLineOrderRepository,
    private readonly providers: ProviderRegistryService,
    private readonly config: ConfigService,
  ) {}

  async execute(jobId: string, workerId = 'dedicated-line-worker'): Promise<DedicatedLineOrderExecutionResult> {
    const job = await this.jobs.claimRunnableJob(jobId, workerId);
    if (!job) return { status: 'NOOP', jobId };

    try {
      const request = parseRequest(job);
      const providerCode = requiredString(job.payload, 'providerCode') as ProviderCode;
      const providerAccountId = requiredString(job.payload, 'providerAccountId');
      const skuId = requiredString(job.payload, 'skuId');
      const countryCode = requiredString(job.payload, 'countryCode').toUpperCase();
      const quantity = requiredPositiveInteger(job.payload, 'quantity');
      const reservationId = requiredString(job.payload, 'reservationId');
      const config = await this.providers.getConfigForProviderAccount(providerCode, job.siteId, providerAccountId);

      if (config.status === 'DISABLED') {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 503);
      }
      if (this.config.get('DEDICATED_LINE_ORDER_EXECUTION_ENABLED') !== 'true') {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'dedicated_line_order_execution_disabled', 503);
      }
      if (!allowsAny([
        { value: config.code, allowlist: this.config.get('DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST') },
        { value: config.upstreamAccountId, allowlist: this.config.get('DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST') },
      ])) {
        throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'dedicated_line_provider_not_allowed', 503);
      }

      const adapter = this.providers.getAdapter(providerCode);
      const payload = asJsonObject(job.payload);
      const upstreamOrderId = optionalString(payload['upstreamOrderId']);
      const buyInput: StaticProxyBuyInput = {
        countryCode,
        regionCode: request.regionCode,
        quantity,
        durationDays: request.durationDays,
        ipType: 'NATIVE',
        protocol: request.protocol,
        currency: request.currency,
        providerResourceId: request.providerResourceId,
        businessType: request.businessType,
        idempotencyKey: job.dedupeKey,
      };
      const result = upstreamOrderId
        ? await adapter.queryOrder({ upstreamOrderId, protocol: request.protocol, countryCode }, config)
        : await adapter.buyStaticProxy(buyInput, config);

      if (result.status === 'FAILED') {
        const status = await this.jobs.markFailed(job, workerId, ErrorCode.UPSTREAM_ERROR, {
          reason: result.failReason ?? 'provider_order_failed',
        }, { retry: true, releaseReservation: true });
        return status === 'RETRYING'
          ? { status, jobId: job.id, attempts: job.attempt, upstreamOrderId: upstreamOrderId ?? '' }
          : { status: 'NEEDS_OPERATOR', jobId: job.id, error: result.failReason ?? 'provider_order_failed' };
      }
      if (result.status === 'PENDING' || result.proxies.length === 0) {
        if (!result.upstreamOrderId) {
          await this.jobs.markFailed(job, workerId, 'UPSTREAM_ORDER_ID_MISSING', {
            reason: 'provider_accepted_without_order_id',
          }, { retry: false, releaseReservation: false });
          return { status: 'NEEDS_OPERATOR', jobId: job.id, error: 'provider_accepted_without_order_id' };
        }
        await this.jobs.saveUpstreamOrderId(job, workerId, result.upstreamOrderId, nextPollAt());
        return { status: 'RETRYING', jobId: job.id, attempts: job.attempt, upstreamOrderId: result.upstreamOrderId };
      }

      assertDelivery(result, countryCode, quantity, request.protocol);
      const encryptionKey = this.config.get('APP_ENCRYPTION_KEY');
      const lines = result.proxies.map((proxy, index) => createLinePlan({
        job,
        proxy,
        index,
        encryptionKey,
        request,
        providerCode,
        providerAccountId,
      }));
      const persisted = await this.jobs.persistCompletedOrder({
        jobId: job.id,
        workerId,
        desiredVersion: job.desiredVersion,
        reservationId,
        providerCode,
        providerAccountId,
        skuId,
        countryCode,
        placementPolicyId: request.placementPolicyId,
        inboundTag: request.inboundTag,
        exits: lines,
      });
      if (persisted.status === 'NEEDS_OPERATOR') {
        return { status: 'NEEDS_OPERATOR', jobId: job.id, error: persisted.reasonKey };
      }
      return { status: 'COMPLETED', jobId: job.id, reservationId, exits: result.proxies.length };
    } catch (error: unknown) {
      const detail = errorContext(error);
      const code = error instanceof AppError ? error.code : ErrorCode.UPSTREAM_ERROR;
      const isKnownNoPurchaseFailure = code === ErrorCode.UPSTREAM_OUT_OF_STOCK || code === ErrorCode.UPSTREAM_DISABLED;
      const status = await this.jobs.markFailed(
        job,
        workerId,
        String(code),
        detail,
        { retry: isKnownNoPurchaseFailure, releaseReservation: isKnownNoPurchaseFailure },
      );
      return {
        status: status === 'RETRYING' ? 'RETRYING' : 'NEEDS_OPERATOR',
        jobId: job.id,
        ...(status === 'RETRYING' ? { attempts: job.attempt, upstreamOrderId: '' } : { error: detail.error }),
      } as DedicatedLineOrderExecutionResult;
    }
  }
}

function parseRequest(payload: DedicatedLineOrderJob): DedicatedLineOrderRequest {
  const request = asJsonObject(asJsonObject(payload.payload)['request']);
  const protocol = requiredString(request, 'protocol');
  if (protocol !== 'SOCKS5') throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_requires_socks5', 400);
  const maxReplicaFanout = requiredPositiveInteger(request, 'maxReplicaFanout');
  return {
    durationDays: requiredPositiveInteger(request, 'durationDays'),
    currency: requiredString(request, 'currency'),
    protocol,
    providerResourceId: requiredString(request, 'providerResourceId'),
    placementPolicyId: requiredString(request, 'placementPolicyId'),
    inboundProfileId: requiredString(request, 'inboundProfileId'),
    inboundTag: requiredString(request, 'inboundTag'),
    lineProtocol: requiredLineProtocol(request),
    maxReplicaFanout,
    regionCode: optionalString(request['regionCode']),
    businessType: optionalString(request['businessType']),
  };
}

function requiredLineProtocol(request: Record<string, unknown>): 'VLESS' | 'VMESS' | 'MIXED' {
  const protocol = requiredString(request, 'lineProtocol');
  if (protocol !== 'VLESS' && protocol !== 'VMESS' && protocol !== 'MIXED') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_lineProtocol_invalid', 400);
  }
  return protocol;
}

function assertDelivery(result: ProviderBuyResult, countryCode: string, quantity: number, protocol: 'SOCKS5'): void {
  if (result.proxies.length !== quantity) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'dedicated_line_proxy_count_mismatch', 502);
  }
  for (const proxy of result.proxies) {
    if (proxy.countryCode.trim().toUpperCase() !== countryCode || proxy.protocol !== protocol) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'dedicated_line_exit_country_or_protocol_mismatch', 502);
    }
    if (!proxy.ip || !Number.isInteger(proxy.port) || proxy.port < 1 || !proxy.username || !proxy.password) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'dedicated_line_exit_credentials_invalid', 502);
    }
    if (!(proxy.expiresAt instanceof Date) || proxy.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'dedicated_line_exit_expiry_invalid', 502);
    }
  }
}

function createLinePlan(input: {
  job: DedicatedLineOrderJob;
  proxy: ProviderBuyResult['proxies'][number];
  index: number;
  encryptionKey: string;
  request: DedicatedLineOrderRequest;
  providerCode: string;
  providerAccountId: string;
}) {
  const lineId = deterministicUuid(input.encryptionKey, `${input.job.id}:line:${input.index}`);
  const clientEmail = `line-${lineId}@365proxy.internal`;
  const identity = input.request.lineProtocol === 'MIXED'
    ? {
      user: `line-${lineId.slice(0, 18)}`,
      password: deterministicSecret(input.encryptionKey, `${input.job.id}:password:${input.index}`),
    }
    : { id: deterministicUuid(input.encryptionKey, `${input.job.id}:client:${input.index}`) };
  const projectionRequest = {
    desiredVersion: input.job.desiredVersion,
    inboundTag: input.request.inboundTag,
    protocol: input.request.lineProtocol,
    client: input.request.lineProtocol === 'MIXED'
      ? { email: clientEmail, user: identity.user, password: identity.password }
      : { email: clientEmail, id: identity.id },
    egress: {
      host: input.proxy.ip,
      port: input.proxy.port,
      username: input.proxy.username,
      password: input.proxy.password,
    },
    lifecycle: {
      enabled: true,
      expiresAtMs: input.proxy.expiresAt.getTime(),
      trafficLimitBytes: 0,
      ipLimit: 0,
      uplinkLimitBps: 0,
      downlinkLimitBps: 0,
      maxConnections: 0,
    },
  } as const;
  return {
    lineId,
    inboundProfileId: input.request.inboundProfileId,
    protocol: input.request.lineProtocol,
    clientEmail,
    clientIdentityCiphertext: encryptAesGcm(JSON.stringify(identity), input.encryptionKey),
    clientIdentityFingerprint: createHash('sha256')
      .update([input.job.siteId, input.request.lineProtocol, JSON.stringify(identity)].join('\0'))
      .digest('hex'),
    projectionDesiredHash: managedLineProjectionDesiredHash(projectionRequest),
    providerProxyId: input.proxy.upstreamProxyId ?? null,
    endpointCiphertext: encryptAesGcm(JSON.stringify({ host: input.proxy.ip, port: input.proxy.port, protocol: input.proxy.protocol }), input.encryptionKey),
    credentialCiphertext: encryptAesGcm(JSON.stringify({ username: input.proxy.username, password: input.proxy.password }), input.encryptionKey),
    identityFingerprint: exitIdentityFingerprint(
      input.job.siteId,
      input.providerCode,
      input.providerAccountId,
      input.proxy.upstreamProxyId ?? null,
      input.proxy.ip,
      input.proxy.port,
    ),
    maxReplicaFanout: input.request.maxReplicaFanout,
    expiresAt: input.proxy.expiresAt,
  };
}

function deterministicUuid(key: string, purpose: string): string {
  const bytes = createHmac('sha256', key).update(purpose).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicSecret(key: string, purpose: string): string {
  return createHmac('sha256', key).update(purpose).digest('base64url');
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, key: string): string {
  const record = asJsonObject(value);
  const candidate = record[key];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `dedicated_line_${key}_required`, 400);
  }
  return candidate.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredPositiveInteger(value: unknown, key: string): number {
  const record = asJsonObject(value);
  const candidate = record[key];
  if (!Number.isInteger(candidate) || (candidate as number) < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `dedicated_line_${key}_invalid`, 400);
  }
  return candidate as number;
}

function nextPollAt(): Date {
  return new Date(Date.now() + 5_000);
}

function errorContext(error: unknown): { error: string; code?: string; reasonKey?: string; details?: unknown } {
  if (!error || typeof error !== 'object') return { error: String(error) };
  const record = error as Record<string, unknown>;
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(typeof record['code'] === 'string' ? { code: record['code'] } : {}),
    ...(typeof record['reasonKey'] === 'string' ? { reasonKey: record['reasonKey'] } : {}),
    ...(record['details'] !== undefined ? { details: record['details'] } : {}),
  };
}
