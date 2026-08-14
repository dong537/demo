import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ResourcesController } from './resources.controller';
import { ResourcesRepository } from './resources.repository';
import { SyncInventorySummary, SyncInventoryUseCase } from './use-cases/sync-inventory.use-case';

const syncSummary: SyncInventorySummary = {
  attempted: 2,
  created: 1,
  updated: 1,
  skipped: 0,
  failed: 0,
  synced: 2,
  syncedAt: new Date('2026-06-13T00:00:00.000Z'),
  upstreamRawStatus: 'SUCCESS',
  countries: ['SG', 'TH'],
};

describe('ResourcesController inventory sync', () => {
  it('passes tenant scope to provider inventory sync', async () => {
    const repo = {
      findProviderAccountTenant: vi.fn().mockResolvedValue('tenant-1'),
    } as unknown as ResourcesRepository;
    const syncInventory = {
      execute: vi.fn().mockResolvedValue(syncSummary),
    } as unknown as SyncInventoryUseCase;
    const controller = new ResourcesController(repo, syncInventory);

    await controller.syncInventoryHandler(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'TENANT_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      { providerCode: 'PR', accountId: 'provider-account-1' },
    );

    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'PR', 'tenant-1', 'provider-account-1');
  });

  it('rejects tenant sync for a provider account owned by another tenant', async () => {
    const repo = {
      findProviderAccountTenant: vi.fn().mockResolvedValue('tenant-2'),
    } as unknown as ResourcesRepository;
    const syncInventory = {
      execute: vi.fn().mockResolvedValue(syncSummary),
    } as unknown as SyncInventoryUseCase;
    const controller = new ResourcesController(repo, syncInventory);

    await expect(controller.syncInventoryHandler(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'TENANT_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      { providerCode: 'PR', accountId: 'provider-account-2' },
    )).rejects.toMatchObject({
      code: ErrorCode.TENANT_SCOPE_VIOLATION,
      reasonKey: 'tenant_access_denied',
    });

    expect(syncInventory.execute).not.toHaveBeenCalled();
  });

  it('uses the resource provider and current tenant for row-level sync', async () => {
    const repo = {
      findByIdInSite: vi.fn().mockResolvedValue({
        id: 'resource-1',
        providerCode: 'NINE_EIGHT_FIVE',
        upstreamAccountId: 'provider-account-985',
      }),
    } as unknown as ResourcesRepository;
    const syncInventory = {
      execute: vi.fn().mockResolvedValue(syncSummary),
    } as unknown as SyncInventoryUseCase;
    const controller = new ResourcesController(repo, syncInventory);

    await controller.syncResourceInventory(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'TENANT_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      'resource-1',
    );

    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'NINE_EIGHT_FIVE', 'tenant-1', 'provider-account-985');
  });

  it('lets admins write a real inventory snapshot for a resource', async () => {
    const latest = {
      id: 'snapshot-1',
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'PR',
      stock: 93,
      capturedAt: new Date('2026-06-17T00:00:00.000Z'),
      freshnessTtlSeconds: 3600,
      isStale: false,
    };
    const repo = {
      findByIdInSite: vi.fn().mockResolvedValue({
        id: 'resource-1',
        providerCode: 'PR',
      }),
      upsertInventorySnapshot: vi.fn().mockResolvedValue(latest),
      getLatestInventory: vi.fn().mockResolvedValue(latest),
    } as unknown as ResourcesRepository;
    const controller = new ResourcesController(repo, {} as SyncInventoryUseCase);

    const result = await controller.updateInventory(
      {
        siteId: 'site-1',
        tenantId: null,
        ownerType: 'PLATFORM_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      'resource-1',
      { stock: 93, freshnessTtlSeconds: 3600 },
    );

    expect(repo.upsertInventorySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'PR',
      stock: 93,
      freshnessTtlSeconds: 3600,
    }));
    expect(result).toBe(latest);
  });

  it('rejects invalid manual inventory stock values', async () => {
    const repo = {
      findByIdInSite: vi.fn().mockResolvedValue({
        id: 'resource-1',
        providerCode: 'PR',
      }),
      upsertInventorySnapshot: vi.fn(),
    } as unknown as ResourcesRepository;
    const controller = new ResourcesController(repo, {} as SyncInventoryUseCase);

    await expect(controller.updateInventory(
      {
        siteId: 'site-1',
        tenantId: null,
        ownerType: 'PLATFORM_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      'resource-1',
      { stock: -1 },
    )).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'inventory_stock_invalid',
    });
    expect(repo.upsertInventorySnapshot).not.toHaveBeenCalled();
  });

  it('denies manual inventory writes for customer users', async () => {
    const repo = {
      upsertInventorySnapshot: vi.fn(),
    } as unknown as ResourcesRepository;
    const controller = new ResourcesController(repo, {} as SyncInventoryUseCase);

    await expect(controller.updateInventory(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'USER',
        ownerId: 'user-1',
        scopes: [],
        requestId: 'request-1',
      },
      'resource-1',
      { stock: 10 },
    )).rejects.toBeInstanceOf(AppError);
    expect(repo.upsertInventorySnapshot).not.toHaveBeenCalled();
  });
});

describe('ResourcesController priceable catalog group saleability', () => {
  it('delegates group unlisting to the repository with tenant and provider scope', async () => {
    const repo = {
      updatePriceableCatalogGroupSaleability: vi.fn().mockResolvedValue({
        updated: 2,
        resourceIds: ['resource-a', 'resource-b'],
      }),
    } as unknown as ResourcesRepository;
    const controller = new ResourcesController(repo, {} as SyncInventoryUseCase);

    await controller.updatePriceableCatalogGroupSaleability(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'TENANT_ADMIN',
        ownerId: 'admin-1',
        scopes: [],
        requestId: 'request-1',
      },
      {
        countryCode: 'US',
        regionKey: 'new-york',
        costGroupKey: 'cost-low',
        providerCode: 'IPIPD',
        saleable: false,
      },
    );

    expect(repo.updatePriceableCatalogGroupSaleability).toHaveBeenCalledWith('site-1', {
      countryCode: 'US',
      regionKey: 'new-york',
      costGroupKey: 'cost-low',
      autoSelect: undefined,
      providerCode: 'IPIPD',
      tenantId: 'tenant-1',
    }, false);
  });

  it('rejects customer users when unlisting a quick pricing group', async () => {
    const repo = {
      updatePriceableCatalogGroupSaleability: vi.fn(),
    } as unknown as ResourcesRepository;
    const controller = new ResourcesController(repo, {} as SyncInventoryUseCase);

    expect(() => controller.updatePriceableCatalogGroupSaleability(
      {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerType: 'USER',
        ownerId: 'user-1',
        scopes: [],
        requestId: 'request-1',
      },
      {
        countryCode: 'US',
        regionKey: 'new-york',
        costGroupKey: 'cost-low',
        saleable: false,
      },
    )).toThrow(AppError);
    expect(repo.updatePriceableCatalogGroupSaleability).not.toHaveBeenCalled();
  });
});
