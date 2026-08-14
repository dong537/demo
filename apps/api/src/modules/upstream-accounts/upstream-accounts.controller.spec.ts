import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpstreamApiAdapter } from '../providers/adapters/upstream-api.adapter';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { SyncInventoryUseCase } from '../resources/use-cases/sync-inventory.use-case';
import { ResourcesRepository } from '../resources/resources.repository';
import { UpstreamAccountsController } from './upstream-accounts.controller';
import { UpstreamAccountsRepository } from './upstream-accounts.repository';

function adminContext() {
  return {
    siteId: 'site-1',
    tenantId: 'tenant-1',
    ownerType: 'TENANT_ADMIN' as const,
    ownerId: 'admin-1',
    scopes: [],
    requestId: 'request-1',
  };
}

function upstreamAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upstream-account-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    name: 'tenant upstream',
    baseUrl: 'https://upstream.example.com',
    apiKeyEncrypted: 'ciphertext',
    timeoutMs: 15000,
    status: 'ACTIVE',
    inventorySyncEnabled: true,
    createdAt: new Date('2026-06-11T00:00:00.000Z'),
    updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    ...overrides,
  };
}

function createController(options: {
  account?: ReturnType<typeof upstreamAccount> | null;
  syncError?: unknown;
  registryError?: unknown;
  healthError?: unknown;
} = {}) {
  const repo = {
    findById: vi.fn().mockResolvedValue(options.account === undefined ? upstreamAccount() : options.account),
    update: vi.fn().mockImplementation((_id, data) => Promise.resolve(upstreamAccount({
      ...(data as Record<string, unknown>),
      apiKeyEncrypted: (data as Record<string, unknown>)['apiKeyEncrypted'] ?? 'ciphertext',
      updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    }))),
  } as unknown as UpstreamAccountsRepository;
  const syncInventory = {
    execute: vi.fn().mockImplementation(() => {
      if (options.syncError) return Promise.reject(options.syncError);
      return Promise.resolve({
        attempted: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
        synced: 1,
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        upstreamRawStatus: 'SUCCESS',
        countries: ['SG'],
      });
    }),
  } as unknown as SyncInventoryUseCase;
  const registry = {
    getConfigForUpstreamAccountById: vi.fn().mockImplementation(() => {
      if (options.registryError) return Promise.reject(options.registryError);
      return Promise.resolve({
        code: 'UPSTREAM_API',
        status: 'ACTIVE',
        siteId: 'site-1',
        upstreamAccountId: 'upstream-account-1',
        baseUrl: 'https://upstream.example.com',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: [],
        credential: { apiKey: 'plain-key' },
      });
    }),
  } as unknown as ProviderRegistryService;
  const resourcesRepo = {
    hideUpstreamAccountResources: vi.fn().mockResolvedValue({ count: 2 }),
  } as unknown as ResourcesRepository;
  const controller = new UpstreamAccountsController(
    repo,
    {
      healthCheck: vi.fn().mockImplementation(() => {
        if (options.healthError) return Promise.reject(options.healthError);
        return Promise.resolve({ healthy: true, latencyMs: 18 });
      }),
    } as unknown as UpstreamApiAdapter,
    registry,
    { get: vi.fn(() => 'a'.repeat(64)) } as never,
    syncInventory,
    resourcesRepo,
  );
  return { controller, repo, syncInventory, registry, resourcesRepo };
}

describe('UpstreamAccountsController inventory sync', () => {
  it('updates upstream account routing data without returning encrypted credentials', async () => {
    const { controller, repo, resourcesRepo } = createController();

    const result = await controller.update(adminContext(), 'upstream-account-1', {
      name: 'new supply',
      baseUrl: 'https://new-upstream.example.com',
      apiKey: 'new-key',
      timeoutMs: 30000,
      inventorySyncEnabled: true,
    });

    expect(repo.update).toHaveBeenCalledWith('upstream-account-1', expect.objectContaining({
      name: 'new supply',
      baseUrl: 'https://new-upstream.example.com',
      timeoutMs: 30000,
      inventorySyncEnabled: true,
      apiKeyEncrypted: expect.any(String),
    }));
    expect(result).toMatchObject({
      id: 'upstream-account-1',
      name: 'new supply',
      baseUrl: 'https://new-upstream.example.com',
      inventorySyncEnabled: true,
    });
    expect(resourcesRepo.hideUpstreamAccountResources).toHaveBeenCalledWith(
      'site-1',
      'UPSTREAM_API',
      'upstream-account-1',
      'provider_config_changed',
    );
    expect(result).not.toHaveProperty('apiKeyEncrypted');
  });

  it('normalizes upstream API base URLs before saving to avoid duplicate res_static paths', async () => {
    const { controller, repo } = createController();

    await controller.update(adminContext(), 'upstream-account-1', {
      baseUrl: 'https://new-upstream.example.com/res_static/?debug=1',
    });

    expect(repo.update).toHaveBeenCalledWith('upstream-account-1', expect.objectContaining({
      baseUrl: 'https://new-upstream.example.com',
    }));
  });

  it('does not let tenant admins edit public upstream accounts', async () => {
    const { controller, repo } = createController({
      account: upstreamAccount({ tenantId: null }),
    });

    await expect(controller.update(adminContext(), 'upstream-account-1', {
      baseUrl: 'https://new-upstream.example.com',
    })).rejects.toMatchObject({
      reasonKey: 'insufficient_permissions',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('delegates upstream account inventory sync to the shared use case', async () => {
    const { controller, syncInventory } = createController();

    const result = await controller.syncInventory(adminContext(), 'upstream-account-1');

    expect(result).toMatchObject({ synced: 1, countries: ['SG'] });
    expect(syncInventory.execute).toHaveBeenCalledWith(
      'site-1',
      'UPSTREAM_API',
      'tenant-1',
      'upstream-account-1',
    );
  });

  it('surfaces empty upstream inventory instead of returning synced zero', async () => {
    const error = new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_empty', 502);
    const { controller } = createController({ syncError: error });

    await expect(controller.syncInventory(adminContext(), 'upstream-account-1')).rejects.toMatchObject({
      reasonKey: 'inventory_empty',
    });
  });

  it('resolves upstream account connectivity tests through the registry using the exact account id', async () => {
    const { controller, registry } = createController();

    const result = await controller.test(adminContext(), 'upstream-account-1');

    expect(result).toMatchObject({
      healthy: true,
      latencyMs: 18,
    });
    expect(registry.getConfigForUpstreamAccountById).toHaveBeenCalledWith('site-1', 'upstream-account-1');
  });

  it('returns an unhealthy probe result when connectivity throws an AppError', async () => {
    const { controller } = createController({
      healthError: new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'upstream_timeout', 504),
    });

    const result = await controller.test(adminContext(), 'upstream-account-1');

    expect(result).toMatchObject({
      healthy: false,
      error: 'upstream_timeout',
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('returns an unhealthy probe result when registry credential resolution fails', async () => {
    const { controller } = createController({
      registryError: new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500),
    });

    const result = await controller.test(adminContext(), 'upstream-account-1');

    expect(result).toMatchObject({
      healthy: false,
      error: 'credential_decrypt_failed',
    });
  });

  it('does not sync an account outside the tenant scope', async () => {
    const { controller, syncInventory } = createController({
      account: upstreamAccount({ tenantId: 'other-tenant' }),
    });

    await expect(controller.syncInventory(adminContext(), 'upstream-account-1')).rejects.toMatchObject({
      reasonKey: 'insufficient_permissions',
    });
    expect(syncInventory.execute).not.toHaveBeenCalled();
  });
});
