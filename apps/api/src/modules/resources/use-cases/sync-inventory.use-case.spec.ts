import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ProviderAdapter, ProviderRuntimeConfig } from '../../providers/provider.types';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ResourcesRepository } from '../resources.repository';
import { SyncInventoryUseCase } from './sync-inventory.use-case';

describe('SyncInventoryUseCase', () => {
  beforeEach(() => {
    process.env['DATABASE_INVENTORY_FRESHNESS_MS'] = '7200000';
  });

  it('syncs every upstream resource from the selected provider account config', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'IPIPD',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-1',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['GB'],
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'IPIPD',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'IPIPD',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [
          {
            countryCode: 'GB',
            countryName: 'United Kingdom',
            stock: 12,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-gb',
            upstreamCost: '8.8',
            upstreamCostCurrency: 'USD',
          },
          {
            countryCode: 'HK',
            countryName: 'Hong Kong',
            stock: 7,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-hk',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn(),
      getConfigForProviderAccount: vi.fn().mockResolvedValue(runtimeConfig),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn().mockResolvedValue(null),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 1 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn().mockResolvedValue({ count: 0 }),
      upsertSyncedResource: vi.fn()
        .mockResolvedValueOnce({ id: 'resource-gb' })
        .mockResolvedValueOnce({ id: 'resource-hk' }),
      update: vi.fn().mockResolvedValue({}),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'IPIPD', null, 'pa-1');

    expect(result).toEqual({
      attempted: 2,
      created: 2,
      updated: 0,
      skipped: 1,
      failed: 0,
      synced: 2,
      syncedAt: new Date('2026-06-11T00:00:00.000Z'),
      upstreamRawStatus: 'SUCCESS',
      countries: ['GB', 'HK'],
    });
    expect(registry.getConfigForProviderAccount).toHaveBeenCalledWith('IPIPD', 'site-1', 'pa-1');
    expect(registry.getConfig).not.toHaveBeenCalled();
    expect(adapter.syncInventory).toHaveBeenCalledWith(runtimeConfig);
    expect(repo.disableResourcesOutsideCoverage).toHaveBeenCalledWith('site-1', 'IPIPD', 'pa-1', [
      { code: 'GB:line-gb', ipType: 'NATIVE' },
      { code: 'HK:line-hk', ipType: 'NATIVE' },
    ]);
    expect(repo.hideResourcesFromOtherUpstreamAccounts).toHaveBeenCalledWith('site-1', 'IPIPD', 'pa-1');
    expect(repo.upsertSyncedResource).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'pa-1',
      code: 'GB:line-gb',
      name: 'United Kingdom',
      type: 'REGION',
      providerResourceId: 'line-gb',
      upstreamCost: '8.8',
      upstreamCostCurrency: 'USD',
    }));
    expect(repo.upsertInventorySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      resourceId: 'resource-gb',
      providerCode: 'IPIPD',
      upstreamAccountId: 'pa-1',
      stock: 12,
      freshnessTtlSeconds: 7200,
    }));
    expect(repo.upsertSyncedResource).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      providerCode: 'IPIPD',
      code: 'HK:line-hk',
      name: 'Hong Kong',
      type: 'REGION',
      providerResourceId: 'line-hk',
      saleabilityOverride: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    }));
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('preserves a manually closed concrete resource while refreshing its upstream cost and inventory', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'IPIPD',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-1',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['GB'],
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'IPIPD',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'IPIPD',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [
          {
            countryCode: 'GB',
            countryName: 'United Kingdom',
            stock: 12,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-gb',
            upstreamCost: '9.1',
            upstreamCostCurrency: 'USD',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn(),
      getConfigForProviderAccount: vi.fn().mockResolvedValue(runtimeConfig),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn().mockResolvedValue({ id: 'resource-1', unsaleableReason: 'provider_sale_disabled' }),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 0 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn().mockResolvedValue({ count: 0 }),
      upsertSyncedResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
      update: vi.fn().mockResolvedValue({}),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'IPIPD', null, 'pa-1');

    expect(result.synced).toBe(1);
    expect(repo.upsertSyncedResource).toHaveBeenCalledWith(expect.objectContaining({
      code: 'GB:line-gb',
      upstreamCost: '9.1',
      upstreamCostCurrency: 'USD',
      saleabilityOverride: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_sale_disabled',
      },
    }));
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('uses selected upstream API account config when account id is provided', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'UPSTREAM_API',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'upstream-account-1',
      baseUrl: 'https://upstream.example.com',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['SG'],
      credential: { apiKey: 'secret' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'UPSTREAM_API',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'UPSTREAM_API',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [
          {
            countryCode: 'SG',
            countryName: 'Singapore',
            stock: 21,
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            providerResourceId: 'sg-line-1',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn(),
      getConfigForProviderAccount: vi.fn().mockResolvedValue(runtimeConfig),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn().mockResolvedValue(null),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 1 }),
      hideResourcesOutsideCurrentSync: vi.fn().mockResolvedValue({ count: 0 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn().mockResolvedValue({ count: 0 }),
      upsertSyncedResource: vi.fn().mockResolvedValue({ id: 'resource-sg' }),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'UPSTREAM_API', 'tenant-1', 'upstream-account-1');

    expect(result.synced).toBe(1);
    expect(registry.getConfigForProviderAccount).toHaveBeenCalledWith('UPSTREAM_API', 'site-1', 'upstream-account-1');
    expect(registry.getConfig).not.toHaveBeenCalled();
    expect(adapter.syncInventory).toHaveBeenCalledWith(runtimeConfig);
    expect(repo.upsertSyncedResource).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: 'UPSTREAM_API',
      upstreamAccountId: 'upstream-account-1',
      code: 'SG:sg-line-1',
    }));
    expect(repo.hideResourcesOutsideCurrentSync).toHaveBeenCalledWith('site-1', 'UPSTREAM_API', 'upstream-account-1', [
      { code: 'SG:sg-line-1', ipType: 'NATIVE' },
    ]);
    expect(repo.hideResourcesFromOtherUpstreamAccounts).toHaveBeenCalledWith('site-1', 'UPSTREAM_API', 'upstream-account-1');
    expect(repo.disableResourcesOutsideCoverage).not.toHaveBeenCalled();
  });

  it('fails visibly when upstream returns no inventory items', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'PR',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-pr',
      baseUrl: 'https://proxy-seller.com/personal/api/v1',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['SG'],
      credential: { apikey: 'secret' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'PR',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'PR',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [],
      }),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn(),
      disableResourcesOutsideCoverage: vi.fn(),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn(),
      upsertSyncedResource: vi.fn(),
      upsertInventorySnapshot: vi.fn(),
      upsertMapping: vi.fn(),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    await expect(useCase.execute('site-1', 'PR')).rejects.toMatchObject({
      reasonKey: 'inventory_empty',
    });
    expect(repo.upsertSyncedResource).not.toHaveBeenCalled();
    expect(repo.disableResourcesOutsideCoverage).not.toHaveBeenCalled();
  });

  it('writes longer Proxy-Seller inventory freshness even when the global ttl is five minutes', async () => {
    process.env['DATABASE_INVENTORY_FRESHNESS_MS'] = '300000';
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'PR',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-pr',
      baseUrl: 'https://proxy-seller.com/personal/api/v1',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['SG'],
      credential: { apikey: 'secret' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'PR',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'PR',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [
          {
            countryCode: 'SG',
            countryName: 'Singapore',
            stock: 12,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'SG:6928:Singapore:Singtel',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn().mockResolvedValue(null),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 0 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn().mockResolvedValue({ count: 0 }),
      upsertSyncedResource: vi.fn().mockResolvedValue({ id: 'resource-sg' }),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    await expect(useCase.execute('site-1', 'PR')).resolves.toMatchObject({ synced: 1 });

    expect(repo.upsertInventorySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: 'PR',
      upstreamAccountId: 'pa-pr',
      freshnessTtlSeconds: 6 * 60 * 60,
    }));
  });

  it('syncs live native resources as hidden when no countries are enabled', async () => {
    const syncedAt = new Date('2026-06-11T00:00:00.000Z');
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'IPIPD',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-1',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: [],
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'IPIPD',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'IPIPD',
        syncedAt,
        items: [
          {
            countryCode: 'GB',
            countryName: 'United Kingdom',
            stock: 12,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-gb',
          },
          {
            countryCode: 'JP',
            countryName: 'Japan',
            stock: 7,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-jp',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn(),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 2 }),
      hideResourcesOutsideEnabledCountries: vi.fn().mockResolvedValue({ count: 2 }),
      hideResourcesFromOtherUpstreamAccounts: vi.fn().mockResolvedValue({ count: 0 }),
      upsertSyncedResource: vi.fn()
        .mockResolvedValueOnce({ id: 'resource-gb' })
        .mockResolvedValueOnce({ id: 'resource-jp' }),
      update: vi.fn(),
      upsertInventorySnapshot: vi.fn(),
      upsertMapping: vi.fn(),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'IPIPD');

    expect(result).toEqual({
      attempted: 2,
      created: 2,
      updated: 0,
      skipped: 2,
      failed: 0,
      synced: 2,
      syncedAt,
      upstreamRawStatus: 'SUCCESS',
      countries: ['GB', 'JP'],
    });
    expect(repo.hideResourcesOutsideEnabledCountries).not.toHaveBeenCalled();
    expect(repo.disableResourcesOutsideCoverage).toHaveBeenCalledWith('site-1', 'IPIPD', 'pa-1', [
      { code: 'GB:line-gb', ipType: 'NATIVE' },
      { code: 'JP:line-jp', ipType: 'NATIVE' },
    ]);
    expect(repo.hideResourcesFromOtherUpstreamAccounts).toHaveBeenCalledWith('site-1', 'IPIPD', 'pa-1');
    expect(repo.upsertSyncedResource).toHaveBeenCalledTimes(2);
    expect(repo.upsertSyncedResource).toHaveBeenNthCalledWith(1, expect.objectContaining({
      code: 'GB:line-gb',
      upstreamAccountId: 'pa-1',
      saleabilityOverride: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    }));
    expect(repo.upsertSyncedResource).toHaveBeenNthCalledWith(2, expect.objectContaining({
      code: 'JP:line-jp',
      upstreamAccountId: 'pa-1',
      saleabilityOverride: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    }));
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.upsertInventorySnapshot).toHaveBeenCalledTimes(2);
    expect(repo.upsertMapping).toHaveBeenCalledTimes(2);
  });

  it('does not disable or rewrite resources when upstream sync fails', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'PR',
      status: 'ACTIVE',
      siteId: 'site-1',
      upstreamAccountId: 'pa-pr',
      baseUrl: 'https://proxy-seller.com/personal/api/v1',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['SG'],
      credential: { apikey: 'secret' },
    };
    const upstreamError = new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502);
    const adapter: Partial<ProviderAdapter> = {
      code: 'PR',
      syncInventory: vi.fn().mockRejectedValue(upstreamError),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn(),
      disableResourcesOutsideCoverage: vi.fn(),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn(),
      upsertSyncedResource: vi.fn(),
      upsertInventorySnapshot: vi.fn(),
      upsertMapping: vi.fn(),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    await expect(useCase.execute('site-1', 'PR')).rejects.toBe(upstreamError);
    expect(repo.upsertSyncedResource).not.toHaveBeenCalled();
    expect(repo.upsertInventorySnapshot).not.toHaveBeenCalled();
    expect(repo.upsertMapping).not.toHaveBeenCalled();
    expect(repo.disableResourcesOutsideCoverage).not.toHaveBeenCalled();
  });

  it('keeps multiple upstream lines under one country as separate resources', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'IPIPD',
      status: 'ACTIVE',
      siteId: 'site-1',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['US'],
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    };
    const adapter: Partial<ProviderAdapter> = {
      code: 'IPIPD',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'IPIPD',
        syncedAt: new Date('2026-06-11T00:00:00.000Z'),
        items: [
          {
            countryCode: 'US',
            countryName: 'United States',
            regionCode: 'New York Recommended',
            stock: 93,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-us-ny-recommended',
            upstreamCost: '7',
            upstreamCostCurrency: 'CNY',
          },
          {
            countryCode: 'US',
            countryName: 'United States',
            regionCode: 'New York Standard',
            stock: 4728,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'line-us-ny-standard',
            upstreamCost: '14',
            upstreamCostCurrency: 'CNY',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn().mockResolvedValue(null),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 1 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn(),
      upsertSyncedResource: vi.fn()
        .mockResolvedValueOnce({ id: 'resource-us-recommended' })
        .mockResolvedValueOnce({ id: 'resource-us-standard' }),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'IPIPD');

    expect(result.synced).toBe(2);
    expect(result.countries).toEqual(['US']);
    expect(repo.disableResourcesOutsideCoverage).toHaveBeenCalledWith('site-1', 'IPIPD', null, [
      { code: 'US:line-us-ny-recommended', ipType: 'NATIVE' },
      { code: 'US:line-us-ny-standard', ipType: 'NATIVE' },
    ]);
    expect(repo.findSyncedResource).toHaveBeenNthCalledWith(1, 'site-1', 'IPIPD', null, 'US:line-us-ny-recommended', 'NATIVE');
    expect(repo.findSyncedResource).toHaveBeenNthCalledWith(2, 'site-1', 'IPIPD', null, 'US:line-us-ny-standard', 'NATIVE');
    expect(repo.upsertSyncedResource).toHaveBeenNthCalledWith(1, expect.objectContaining({
      code: 'US:line-us-ny-recommended',
      name: 'United States-New York Recommended',
      type: 'REGION',
      upstreamCost: '7',
    }));
    expect(repo.upsertSyncedResource).toHaveBeenNthCalledWith(2, expect.objectContaining({
      code: 'US:line-us-ny-standard',
      name: 'United States-New York Standard',
      type: 'REGION',
      upstreamCost: '14',
    }));
    expect(repo.upsertMapping).toHaveBeenNthCalledWith(1, expect.objectContaining({
      resourceId: 'resource-us-recommended',
      providerResourceId: 'line-us-ny-recommended',
    }));
    expect(repo.upsertMapping).toHaveBeenNthCalledWith(2, expect.objectContaining({
      resourceId: 'resource-us-standard',
      providerResourceId: 'line-us-ny-standard',
    }));
  });

  it('keeps Proxy-Seller detailed leaf resources separate and does not revive legacy country rows', async () => {
    const runtimeConfig: ProviderRuntimeConfig = {
      code: 'PR',
      status: 'ACTIVE',
      siteId: 'site-1',
      baseUrl: 'https://proxy-seller.com/personal/api/v1',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['CA'],
      credential: { apikey: 'secret' },
    };
    const syncedAt = new Date('2026-06-19T00:00:00.000Z');
    const adapter: Partial<ProviderAdapter> = {
      code: 'PR',
      syncInventory: vi.fn().mockResolvedValue({
        providerCode: 'PR',
        syncedAt,
        items: [
          {
            countryCode: 'CA',
            countryName: 'Canada',
            regionCode: 'Ontario - Woodstock - Comwave Telecom',
            stock: 1,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
            upstreamCost: '6.9',
            upstreamCostCurrency: 'USD',
          },
          {
            countryCode: 'CA',
            countryName: 'Canada',
            regionCode: 'Ontario - Gloucester - Comwave Telecom',
            stock: 2,
            ipType: 'NATIVE',
            protocol: 'BOTH',
            providerResourceId: 'CA:6928:Ontario:Gloucester:Comwave Telecom',
            upstreamCost: '6.9',
            upstreamCostCurrency: 'USD',
          },
        ],
      }),
    };
    const registry = {
      getConfig: vi.fn().mockResolvedValue(runtimeConfig),
      getConfigForProviderAccount: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(adapter),
    };
    const repo = {
      findSyncedResource: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'resource-ca-legacy' }),
      disableResourcesOutsideCoverage: vi.fn().mockResolvedValue({ count: 1 }),
      hideResourcesOutsideEnabledCountries: vi.fn(),
      hideResourcesFromOtherUpstreamAccounts: vi.fn(),
      upsertSyncedResource: vi.fn()
        .mockResolvedValueOnce({ id: 'resource-ca-woodstock' })
        .mockResolvedValueOnce({ id: 'resource-ca-gloucester' })
        .mockResolvedValueOnce({ id: 'resource-ca-legacy' }),
      upsertInventorySnapshot: vi.fn().mockResolvedValue({}),
      upsertMapping: vi.fn().mockResolvedValue({}),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      repo as unknown as ResourcesRepository,
    );

    const result = await useCase.execute('site-1', 'PR');

    expect(result.synced).toBe(2);
    expect(repo.findSyncedResource).toHaveBeenNthCalledWith(1, 'site-1', 'PR', null, 'CA:6928:Ontario:Woodstock:Comwave Telecom', 'NATIVE');
    expect(repo.findSyncedResource).toHaveBeenNthCalledWith(2, 'site-1', 'PR', null, 'CA:6928:Ontario:Gloucester:Comwave Telecom', 'NATIVE');
    expect(repo.upsertInventorySnapshot).toHaveBeenNthCalledWith(1, expect.objectContaining({
      resourceId: 'resource-ca-woodstock',
      stock: 1,
      capturedAt: syncedAt,
    }));
    expect(repo.upsertInventorySnapshot).toHaveBeenNthCalledWith(2, expect.objectContaining({
      resourceId: 'resource-ca-gloucester',
      stock: 2,
      capturedAt: syncedAt,
    }));
    expect(repo.disableResourcesOutsideCoverage).toHaveBeenCalledWith('site-1', 'PR', null, [
      { code: 'CA:6928:Ontario:Woodstock:Comwave Telecom', ipType: 'NATIVE' },
      { code: 'CA:6928:Ontario:Gloucester:Comwave Telecom', ipType: 'NATIVE' },
    ]);
    expect(repo.upsertSyncedResource).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'CA',
      type: 'COUNTRY',
    }));
  });

  it('requires quote refresh when the current provider account changed after the inventory snapshot', async () => {
    const registry = {
      getConfig: vi.fn().mockResolvedValue({
        code: 'IPIPD',
        status: 'ACTIVE',
        siteId: 'site-1',
        upstreamAccountId: 'pa-1',
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
        baseUrl: 'https://api.ipipd.cn',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: ['GB'],
        credential: { appId: 'app-1', appSecret: 'secret-1' },
      } satisfies ProviderRuntimeConfig),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      {} as unknown as ResourcesRepository,
    );

    await expect(useCase.requiresRefreshForProviderConfig(
      'site-1',
      'IPIPD',
      null,
      new Date('2026-06-25T00:00:00.000Z'),
    )).resolves.toBe(true);
    expect(registry.getConfig).toHaveBeenCalledWith('IPIPD', 'site-1', null);
  });

  it('does not require quote refresh when a fresh snapshot is newer than the provider config', async () => {
    const registry = {
      getConfig: vi.fn().mockResolvedValue({
        code: 'IPIPD',
        status: 'ACTIVE',
        siteId: 'site-1',
        upstreamAccountId: 'pa-1',
        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
        baseUrl: 'https://api.ipipd.cn',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: ['GB'],
        credential: { appId: 'app-1', appSecret: 'secret-1' },
      } satisfies ProviderRuntimeConfig),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      {} as unknown as ResourcesRepository,
    );

    await expect(useCase.requiresRefreshForProviderConfig(
      'site-1',
      'IPIPD',
      null,
      new Date('2026-06-25T00:00:00.000Z'),
    )).resolves.toBe(false);
  });

  it('requires quote refresh when the effective provider config is not usable', async () => {
    const registry = {
      getConfig: vi.fn().mockResolvedValue({
        code: 'IPIPD',
        status: 'DISABLED',
        siteId: 'site-1',
        upstreamAccountId: 'pa-1',
        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
        baseUrl: 'https://api.ipipd.cn',
        timeoutMs: 15000,
        inventorySyncEnabled: false,
        enabledCountryCodes: ['GB'],
        credential: {},
      } satisfies ProviderRuntimeConfig),
    };
    const useCase = new SyncInventoryUseCase(
      registry as unknown as ProviderRegistryService,
      {} as unknown as ResourcesRepository,
    );

    await expect(useCase.requiresRefreshForProviderConfig(
      'site-1',
      'IPIPD',
      null,
      new Date('2026-06-25T00:00:00.000Z'),
    )).resolves.toBe(true);
  });
});
