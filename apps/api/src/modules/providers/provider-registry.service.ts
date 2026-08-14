import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { ConfigService } from '../../common/config/config.service';
import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { ProviderCode, ProviderAdapter, ProviderRuntimeConfig } from './provider.types';
import { UpstreamLogRepository, CreateUpstreamLogInput } from './upstream-log.repository';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY, CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY } from './provider-account-order';

@Injectable()
export class ProviderRegistryService {
  constructor(
    private readonly config: ConfigService,
    private readonly upstreamLogRepo: UpstreamLogRepository,
    private readonly adapters: ProviderAdapter[],
  ) {}

  async getConfig(providerCode: ProviderCode, siteId?: string, tenantId?: string | null): Promise<ProviderRuntimeConfig> {
    if (providerCode === 'UPSTREAM_API') {
      if (!siteId) return disabledUpstreamApiConfig(undefined);
      const config = await this.getConfigForUpstreamAccount(siteId, tenantId ?? null);
      return config ?? disabledUpstreamApiConfig(siteId);
    }

    const account = await findProviderAccount(providerCode, siteId, tenantId);

    if (!account || account.status === 'DISABLED') {
      return {
        code: providerCode,
        status: 'DISABLED',
        siteId: account?.siteId ?? siteId,
        upstreamAccountId: account?.id,
        updatedAt: account?.updatedAt,
        baseUrl: account?.baseUrl ?? '',
        timeoutMs: account?.timeoutMs ?? 15000,
        inventorySyncEnabled: account?.inventorySyncEnabled ?? false,
        enabledCountryCodes: account?.enabledCountryCodes ?? [],
        credential: {},
      };
    }

    const encryptionKey = this.config.get('APP_ENCRYPTION_KEY');
    let credential: Record<string, string>;
    try {
      credential = JSON.parse(decryptAesGcm(account.credentialEncrypted, encryptionKey)) as Record<string, string>;
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    }

    return {
      code: providerCode,
      status: 'ACTIVE',
      siteId: account.siteId,
      upstreamAccountId: account.id,
      updatedAt: account.updatedAt,
      baseUrl: account.baseUrl,
      timeoutMs: account.timeoutMs,
      inventorySyncEnabled: account.inventorySyncEnabled,
      enabledCountryCodes: account.enabledCountryCodes,
      credential,
    };
  }

  async getConfigForProviderAccount(providerCode: ProviderCode, siteId: string, accountId: string): Promise<ProviderRuntimeConfig> {
    if (providerCode === 'UPSTREAM_API') {
      return this.getConfigForUpstreamAccountById(siteId, accountId);
    }

    const account = await prisma.provider_accounts.findFirst({
      where: { id: accountId, siteId, providerCode },
    });

    if (!account || account.status === 'DISABLED') {
      return {
        code: providerCode,
        status: 'DISABLED',
        siteId: account?.siteId ?? siteId,
        upstreamAccountId: account?.id ?? accountId,
        updatedAt: account?.updatedAt,
        baseUrl: account?.baseUrl ?? '',
        timeoutMs: account?.timeoutMs ?? 15000,
        inventorySyncEnabled: account?.inventorySyncEnabled ?? false,
        enabledCountryCodes: account?.enabledCountryCodes ?? [],
        credential: {},
      };
    }

    const encryptionKey = this.config.get('APP_ENCRYPTION_KEY');
    let credential: Record<string, string>;
    try {
      credential = JSON.parse(decryptAesGcm(account.credentialEncrypted, encryptionKey)) as Record<string, string>;
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    }

    return {
      code: providerCode,
      status: 'ACTIVE',
      siteId: account.siteId,
      upstreamAccountId: account.id,
      updatedAt: account.updatedAt,
      baseUrl: account.baseUrl,
      timeoutMs: account.timeoutMs,
      inventorySyncEnabled: account.inventorySyncEnabled,
      enabledCountryCodes: account.enabledCountryCodes,
      credential,
    };
  }

  async getConfigForUpstreamAccountById(siteId: string, accountId: string): Promise<ProviderRuntimeConfig> {
    const account = await prisma.upstream_api_accounts.findFirst({
      where: { id: accountId, siteId },
    });

    if (!account || account.status === 'DISABLED') {
      return disabledUpstreamApiConfig(account?.siteId ?? siteId, account?.id ?? accountId, account ?? undefined);
    }

    const encryptionKey = this.config.get('APP_ENCRYPTION_KEY');
    let apiKey: string;
    try {
      apiKey = decryptAesGcm(account.apiKeyEncrypted, encryptionKey);
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    }

    return upstreamApiConfig(account, apiKey);
  }

  async getConfigForUpstreamAccount(siteId: string, tenantId?: string | null): Promise<ProviderRuntimeConfig | null> {
    const account =
      (tenantId
        ? await prisma.upstream_api_accounts.findFirst({
          where: { siteId, tenantId, status: 'ACTIVE' },
          orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
        })
        : null) ??
      (await prisma.upstream_api_accounts.findFirst({
        where: { siteId, tenantId: null, status: 'ACTIVE' },
        orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
      }));

    if (!account) return null;

    const encryptionKey = this.config.get('APP_ENCRYPTION_KEY');
    let apiKey: string;
    try {
      apiKey = decryptAesGcm(account.apiKeyEncrypted, encryptionKey);
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    }

    return upstreamApiConfig(account, apiKey);
  }

  getAdapter(code: ProviderCode): ProviderAdapter {
    const adapter = this.adapters.find((a) => a.code === code);
    if (!adapter) throw new AppError(ErrorCode.INTERNAL_ERROR, 'adapter_not_found', 500);
    return adapter;
  }

  async logUpstreamRequest(data: Omit<CreateUpstreamLogInput, never>): Promise<void> {
    await this.upstreamLogRepo.create(data);
  }
}

function upstreamApiConfig(
  account: NonNullable<Awaited<ReturnType<typeof prisma.upstream_api_accounts.findFirst>>>,
  apiKey: string,
): ProviderRuntimeConfig {
  return {
    code: 'UPSTREAM_API',
    status: 'ACTIVE',
    siteId: account.siteId,
    upstreamAccountId: account.id,
    updatedAt: account.updatedAt,
    baseUrl: account.baseUrl,
    timeoutMs: account.timeoutMs,
    inventorySyncEnabled: account.inventorySyncEnabled,
    enabledCountryCodes: [],
    credential: { apiKey },
  };
}

function disabledUpstreamApiConfig(
  siteId: string | undefined,
  accountId?: string,
  account?: { baseUrl?: string; timeoutMs?: number; inventorySyncEnabled?: boolean; updatedAt?: Date },
): ProviderRuntimeConfig {
  return {
    code: 'UPSTREAM_API',
    status: 'DISABLED',
    siteId,
    upstreamAccountId: accountId,
    updatedAt: account?.updatedAt,
    baseUrl: account?.baseUrl ?? '',
    timeoutMs: account?.timeoutMs ?? 15000,
    inventorySyncEnabled: account?.inventorySyncEnabled ?? false,
    enabledCountryCodes: [],
    credential: {},
  };
}

async function findProviderAccount(providerCode: ProviderCode, siteId?: string, tenantId?: string | null) {
  let tenantAccount: Awaited<ReturnType<typeof prisma.provider_accounts.findFirst>> = null;
  if (siteId && tenantId) {
    tenantAccount = await prisma.provider_accounts.findFirst({
      where: { siteId, tenantId, providerCode },
      orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY,
    });
    if (tenantAccount?.status === 'ACTIVE') return tenantAccount;
  }

  const siteAccount = await prisma.provider_accounts.findFirst({
    where: {
      providerCode,
      tenantId: null,
      ...(siteId ? { siteId } : {}),
    },
    orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY,
  });
  return siteAccount ?? tenantAccount;
}
