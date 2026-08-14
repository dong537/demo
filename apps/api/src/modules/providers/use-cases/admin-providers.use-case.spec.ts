import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppError } from '../../../common/errors/app-error';
import { ProvidersRepository, ProviderAccountRecord } from '../providers.repository';
import { ProviderRegistryService } from '../provider-registry.service';
import { ConfigService } from '../../../common/config/config.service';
import { ProviderAdapter, ProviderHealthResult, ProviderRuntimeConfig } from '../provider.types';
import { ListProvidersUseCase } from './list-providers.use-case';
import { HealthCheckProviderUseCase } from './health-check-provider.use-case';
import { decryptAesGcm, encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { ProvidersController } from '../providers.controller';

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
  Prisma: {},
}));

// 64 hex chars = 32-byte AES-256 key.
const ENC_KEY = 'a'.repeat(64);

function adminContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1',
    ownerType: 'PLATFORM_ADMIN',
    siteId: 'site-1',
    tenantId: null,
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

const now = new Date('2026-06-09T00:00:00.000Z');

function record(overrides: Partial<ProviderAccountRecord> = {}): ProviderAccountRecord {
  return {
    id: 'pa-1',
    siteId: 'site-1',
    tenantId: null,
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    credentialEncrypted: encryptAesGcm(JSON.stringify({ appId: 'x', appSecret: 'y' }), ENC_KEY),
    baseUrl: 'https://api.example.com',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: ['GB', 'HK'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function repoMock() {
  return {
    listForSite: vi.fn<ProvidersRepository['listForSite']>(),
    findForSite: vi.fn<ProvidersRepository['findForSite']>(),
    create: vi.fn<ProvidersRepository['create']>(),
    update: vi.fn<ProvidersRepository['update']>(),
    updateResourceSaleability: vi.fn<ProvidersRepository['updateResourceSaleability']>(),
    applyEnabledCountrySelectionToResources: vi.fn<ProvidersRepository['applyEnabledCountrySelectionToResources']>(),
    hideProviderAccountResources: vi.fn<ProvidersRepository['hideProviderAccountResources']>(),
  };
}

function registryMock(adapter: Partial<ProviderAdapter>) {
  return {
    getConfig: vi.fn(),
    getConfigForProviderAccount: vi.fn(),
    getAdapter: vi.fn(() => adapter as ProviderAdapter),
  };
}

function runtimeConfig(overrides: Partial<ProviderRuntimeConfig> = {}): ProviderRuntimeConfig {
  return {
    code: 'IPIPD',
    status: 'ACTIVE',
    siteId: 'site-1',
    upstreamAccountId: 'pa-1',
    baseUrl: 'https://api.example.com',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: ['GB', 'HK'],
    credential: { appId: 'x', appSecret: 'y' },
    ...overrides,
  };
}

function configMock() {
  return { get: vi.fn(() => ENC_KEY) };
}

beforeEach(() => {
  auditCreate.mockReset();
  auditCreate.mockResolvedValue(undefined);
});

describe('ListProvidersUseCase', () => {
  it('returns provider accounts without any credential field', async () => {
    const repo = repoMock();
    repo.listForSite.mockResolvedValue([record()]);
    const registry = registryMock({
      code: 'IPIPD',
      // IPIPD adapter implements none of the optional lifecycle methods.
    });
    const useCase = new ListProvidersUseCase(
      repo as unknown as ProvidersRepository,
      registry as unknown as ProviderRegistryService,
    );

    const result = await useCase.execute(adminContext());

    expect(repo.listForSite).toHaveBeenCalledWith('site-1');
    expect(result).toHaveLength(1);
    const item = result[0] as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('credentialEncrypted');
    expect(item).not.toHaveProperty('credential');
    expect(item.baseUrl).toBe('https://api.example.com');
    expect(item.capabilities).toEqual({
      inventorySync: true,
      renew: false,
      changePassword: false,
      switchIp: false,
    });
  });

  it('derives capabilities from the adapter optional methods', async () => {
    const repo = repoMock();
    repo.listForSite.mockResolvedValue([record({ providerCode: 'UPSTREAM_API', inventorySyncEnabled: false })]);
    const registry = registryMock({
      code: 'UPSTREAM_API',
      renewStaticProxy: vi.fn(),
      changeProxyPassword: vi.fn(),
      switchProxyIp: vi.fn(),
    });
    const useCase = new ListProvidersUseCase(
      repo as unknown as ProvidersRepository,
      registry as unknown as ProviderRegistryService,
    );

    const result = await useCase.execute(adminContext());

    expect(result[0].capabilities).toEqual({
      inventorySync: false,
      renew: true,
      changePassword: true,
      switchIp: true,
    });
  });

  it('rejects non-PLATFORM callers with PERMISSION_DENIED', async () => {
    const repo = repoMock();
    const useCase = new ListProvidersUseCase(
      repo as unknown as ProvidersRepository,
      registryMock({ code: 'IPIPD' }) as unknown as ProviderRegistryService,
    );

    await expect(
      useCase.execute(adminContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' })),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED, httpStatus: 403 });
    expect(repo.listForSite).not.toHaveBeenCalled();
  });
});

describe('HealthCheckProviderUseCase', () => {
  function build(
    adapter: Partial<ProviderAdapter>,
    configValue: ProviderRuntimeConfig | Error = runtimeConfig(),
    accountConfigValue: ProviderRuntimeConfig | Error = configValue,
  ) {
    const repo = repoMock();
    const registry = registryMock(adapter);
    if (configValue instanceof Error) {
      registry.getConfig.mockRejectedValue(configValue);
    } else {
      registry.getConfig.mockResolvedValue(configValue);
    }
    if (accountConfigValue instanceof Error) {
      registry.getConfigForProviderAccount.mockRejectedValue(accountConfigValue);
    } else {
      registry.getConfigForProviderAccount.mockResolvedValue(accountConfigValue);
    }
    const useCase = new HealthCheckProviderUseCase(
      repo as unknown as ProvidersRepository,
      registry as unknown as ProviderRegistryService,
    );
    return { useCase, repo, registry };
  }

  it('returns reachable=true and audits a successful probe', async () => {
    const healthy: ProviderHealthResult = { healthy: true, latencyMs: 42 };
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck: vi.fn().mockResolvedValue(healthy) });
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ accountId: 'pa-1', reachable: true, latencyMs: 42, reasonKey: null });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'provider.health_check', targetId: 'pa-1' }),
      }),
    );
  });

  it('returns the probe result when the audit write fails', async () => {
    const healthy: ProviderHealthResult = { healthy: true, latencyMs: 42 };
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck: vi.fn().mockResolvedValue(healthy) });
    repo.findForSite.mockResolvedValue(record());
    auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ accountId: 'pa-1', reachable: true, latencyMs: 42, reasonKey: null });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'provider.health_check', targetId: 'pa-1' }),
      }),
    );
  });

  it('maps an unhealthy probe (adapter returns healthy=false) to reachable=false', async () => {
    const unhealthy: ProviderHealthResult = { healthy: false, latencyMs: 10, error: 'HTTP 401' };
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck: vi.fn().mockResolvedValue(unhealthy) });
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ reachable: false, reasonKey: 'provider_unreachable', detail: 'HTTP 401' });
  });

  it('converges a thrown upstream timeout into a result instead of a 500', async () => {
    const healthCheck = vi.fn().mockRejectedValue(
      new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'upstream_timeout', 504),
    );
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck });
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result.reachable).toBe(false);
    expect(result.reasonKey).toBe('upstream_timeout');
    expect(auditCreate).toHaveBeenCalled();
  });

  it('preserves a stable adapter-reported reason for unhealthy probes', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ healthy: false, latencyMs: 10, error: 'network_error' });
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck });
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ reachable: false, reasonKey: 'network_error', detail: 'network_error' });
  });

  it('converges an unexpected (non-AppError) throw into provider_unreachable', async () => {
    const healthCheck = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck });
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ reachable: false, reasonKey: 'provider_unreachable', detail: 'socket hang up' });
  });

  it('converges a credential decrypt failure into credential_decrypt_failed', async () => {
    const healthCheck = vi.fn();
    const configError = new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck }, configError);
    repo.findForSite.mockResolvedValue(record());

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ reachable: false, reasonKey: 'credential_decrypt_failed', latencyMs: null });
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('resolves health checks against the exact provider account id', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ healthy: true, latencyMs: 42 });
    const accountConfig = runtimeConfig({
      siteId: 'site-1',
      upstreamAccountId: 'pa-1',
      credential: { appId: 'account-app', appSecret: 'account-secret' },
    });
    const { useCase, repo, registry } = build({ code: 'IPIPD', healthCheck }, runtimeConfig(), accountConfig);
    repo.findForSite.mockResolvedValue(record({ id: 'pa-1', tenantId: 'tenant-1' }));

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({ reachable: true, reasonKey: null });
    expect(registry.getConfigForProviderAccount).toHaveBeenCalledWith('IPIPD', 'site-1', 'pa-1');
    expect(healthCheck).toHaveBeenCalledWith(expect.objectContaining({
      upstreamAccountId: 'pa-1',
      credential: { appId: 'account-app', appSecret: 'account-secret' },
    }));
    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  it('converges a missing adapter into a non-500 health-check failure', async () => {
    const { useCase, repo, registry } = build({ code: 'IPIPD' });
    repo.findForSite.mockResolvedValue(record());
    registry.getAdapter.mockImplementation(() => {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'adapter_not_found', 500);
    });

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(result).toMatchObject({
      accountId: 'pa-1',
      providerCode: 'IPIPD',
      reachable: false,
      latencyMs: null,
      reasonKey: 'adapter_not_found',
      detail: 'adapter_not_found',
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
      data: expect.objectContaining({ action: 'provider.health_check', targetId: 'pa-1' }),
      }),
    );
  });

  it('uses the registry-selected runtime config instead of the raw row credentials', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ healthy: true, latencyMs: 42 });
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck }, runtimeConfig({
      status: 'ACTIVE',
      upstreamAccountId: 'fallback-account',
      baseUrl: 'https://fallback.example.com',
      credential: { appId: 'fallback-app', appSecret: 'fallback-secret' },
    }));
    repo.findForSite.mockResolvedValue(record({ status: 'DISABLED', credentialEncrypted: 'not-a-valid-ciphertext' }));

    const result = await useCase.execute(adminContext(), 'pa-1');

    expect(healthCheck).toHaveBeenCalledWith(expect.objectContaining({
      upstreamAccountId: 'fallback-account',
      baseUrl: 'https://fallback.example.com',
      credential: { appId: 'fallback-app', appSecret: 'fallback-secret' },
    }));
    expect(result).toMatchObject({ reachable: true, reasonKey: null });
  });

  it('returns NOT_FOUND for an id outside the caller site (no existence leak)', async () => {
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck: vi.fn() });
    repo.findForSite.mockResolvedValue(null);

    await expect(useCase.execute(adminContext(), 'other-site-account')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'provider_account_not_found',
      httpStatus: 404,
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects non-PLATFORM callers before reading the account', async () => {
    const { useCase, repo } = build({ code: 'IPIPD', healthCheck: vi.fn() });

    await expect(
      useCase.execute(adminContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), 'pa-1'),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED, httpStatus: 403 });
    expect(repo.findForSite).not.toHaveBeenCalled();
  });
});

describe('ProvidersController write operations', () => {
  function build() {
    const repo = repoMock();
    const registry = registryMock({ code: 'IPIPD' });
    const controller = new ProvidersController(
      {} as ListProvidersUseCase,
      {} as HealthCheckProviderUseCase,
      repo as unknown as ProvidersRepository,
      registry as unknown as ProviderRegistryService,
      configMock() as unknown as ConfigService,
    );
    return { controller, repo, registry };
  }

  it('creates a platform provider account with encrypted credentials and no plaintext response', async () => {
    const { controller, repo } = build();
    repo.create.mockImplementation(async (data) => record({
      providerCode: data.providerCode,
      status: data.status,
      baseUrl: data.baseUrl,
      timeoutMs: data.timeoutMs ?? 15000,
      inventorySyncEnabled: data.inventorySyncEnabled ?? false,
      credentialEncrypted: data.credentialEncrypted,
    }));

    const result = await controller.create(adminContext(), {
      providerCode: 'IPIPD',
      status: 'ACTIVE',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      providerCode: 'IPIPD',
      status: 'ACTIVE',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
    }));
    const encrypted = repo.create.mock.calls[0][0].credentialEncrypted;
    expect(decryptAesGcm(encrypted, ENC_KEY)).toBe(JSON.stringify({ appId: 'app-1', appSecret: 'secret-1' }));
    expect(result).not.toHaveProperty('credentialEncrypted');
    expect(result).not.toHaveProperty('credential');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'provider_account.create', tenantId: null }),
    }));
  });

  it('stores only the runtime credential fields needed by the selected provider', async () => {
    const { controller, repo } = build();
    repo.create.mockImplementation(async (data) => record({
      providerCode: data.providerCode,
      baseUrl: data.baseUrl,
      credentialEncrypted: data.credentialEncrypted,
    }));

    await controller.create(adminContext(), {
      providerCode: 'NINE_EIGHT_FIVE',
      baseUrl: 'https://open-api.985proxy.com',
      credential: { apikey: ' key-1 ', zoneId: ' zone-1 ', appSecret: 'ignored' },
    });

    const encrypted = repo.create.mock.calls[0][0].credentialEncrypted;
    expect(decryptAesGcm(encrypted, ENC_KEY)).toBe(JSON.stringify({ apikey: 'key-1', zoneId: 'zone-1' }));
  });

  it('updates a provider account and preserves credentials when omitted', async () => {
    const { controller, repo } = build();
    repo.findForSite.mockResolvedValue(record());
    repo.update.mockResolvedValue(record({ baseUrl: 'https://new.example.com', timeoutMs: 30000 }));
    repo.applyEnabledCountrySelectionToResources.mockResolvedValue({ updated: 0, saleable: 0, hidden: 0 });
    repo.hideProviderAccountResources.mockResolvedValue({ count: 2 });

    const result = await controller.update(adminContext(), 'pa-1', {
      baseUrl: 'https://new.example.com',
      timeoutMs: 30000,
      inventorySyncEnabled: false,
    });

    expect(repo.update).toHaveBeenCalledWith('site-1', 'pa-1', {
      baseUrl: 'https://new.example.com',
      timeoutMs: 30000,
      inventorySyncEnabled: false,
    });
    expect(result.baseUrl).toBe('https://new.example.com');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'provider_account.update', targetId: 'pa-1' }),
    }));
  });

  it('merges partial credential edits with the existing encrypted credential before saving', async () => {
    const { controller, repo } = build();
    repo.findForSite.mockResolvedValue(record({
      providerCode: 'NINE_EIGHT_FIVE',
      credentialEncrypted: encryptAesGcm(JSON.stringify({ apikey: 'old-key', zoneId: 'old-zone' }), ENC_KEY),
    }));
    repo.update.mockImplementation(async (_siteId, _id, data) => record({
      providerCode: 'NINE_EIGHT_FIVE',
      credentialEncrypted: data.credentialEncrypted,
    }));
    repo.hideProviderAccountResources.mockResolvedValue({ count: 1 });

    await controller.update(adminContext(), 'pa-1', {
      credential: { zoneId: 'new-zone' },
    });

    const encrypted = repo.update.mock.calls[0][2].credentialEncrypted;
    expect(encrypted).toEqual(expect.any(String));
    expect(decryptAesGcm(encrypted!, ENC_KEY)).toBe(JSON.stringify({ apikey: 'old-key', zoneId: 'new-zone' }));
  });

  it('applies enabled country changes to synced provider resources', async () => {
    const { controller, repo } = build();
    repo.findForSite.mockResolvedValue(record());
    repo.update.mockResolvedValue(record({ enabledCountryCodes: ['GB', 'JP'] }));
    repo.applyEnabledCountrySelectionToResources.mockResolvedValue({ updated: 12, saleable: 8, hidden: 4 });

    await controller.update(adminContext(), 'pa-1', {
      enabledCountryCodes: ['GB', 'JP'],
    });

    expect(repo.applyEnabledCountrySelectionToResources).toHaveBeenCalledWith('site-1', 'IPIPD', ['GB', 'JP'], 'pa-1');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'provider_account.update',
        meta: expect.objectContaining({
          resourceSelection: { updated: 12, saleable: 8, hidden: 4 },
        }),
      }),
    }));
  });

  it('updates provider resource saleability through the provider-scoped endpoint', async () => {
    const { controller, repo } = build();
    repo.updateResourceSaleability.mockResolvedValue({
      account: record({ enabledCountryCodes: ['GB'] }),
      updated: 2,
      enabledCountryCodes: ['GB'],
    });

    const result = await controller.updateResourceSaleability(adminContext(), 'pa-1', {
      items: [
        { resourceId: ' res-gb ', saleable: true },
        { resourceId: 'res-hk', saleable: false },
        { resourceId: 'res-gb', saleable: false },
      ],
    });

    expect(repo.updateResourceSaleability).toHaveBeenCalledWith('site-1', 'pa-1', [
      { resourceId: 'res-gb', saleable: false },
      { resourceId: 'res-hk', saleable: false },
    ]);
    expect(result.enabledCountryCodes).toEqual(['GB']);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'provider_account.resource_saleability.update',
        targetId: 'pa-1',
        meta: expect.objectContaining({
          updated: 2,
          enabledCountryCodes: ['GB'],
        }),
      }),
    }));
  });

  it('rejects non-platform callers before creating provider accounts', async () => {
    const { controller, repo } = build();

    await expect(
      controller.create(adminContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), {
        providerCode: 'IPIPD',
        baseUrl: 'https://api.ipipd.cn',
        credential: { appId: 'app-1', appSecret: 'secret-1' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED, httpStatus: 403 });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
