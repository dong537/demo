import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppError } from '../../../common/errors/app-error';
import { ResourcesRepository } from '../../resources/resources.repository';
import { SyncInventoryUseCase } from '../../resources/use-cases/sync-inventory.use-case';
import { PricingRepository } from '../pricing.repository';
import { QuoteInput } from '../domain';
import { QuoteUseCase } from './quote.use-case';
import { isManagedStaticProxyProviderCode } from '../base-price';

const input: QuoteInput = {
  siteId: 'site-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  resourceId: 'resource-1',
  durationDays: 30,
  quantity: 2,
  currency: 'CNY',
};

const priceResult = {
  unitPrice: '12.5',
  currency: 'CNY',
  source: 'DEFAULT_TEMPLATE' as const,
};

describe('QuoteUseCase inventory freshness', () => {
  it('lets configured prices override managed static proxy base prices', async () => {
    expect(isManagedStaticProxyProviderCode('IPIPD')).toBe(true);
    const { useCase, pricingRepo } = buildUseCase({
      resource: { providerCode: 'IPIPD', code: 'HK:line-hk-recommended' },
      snapshot: { stock: 5, isStale: false },
      priceResult: { unitPrice: '18.5', currency: 'CNY', source: 'RESOURCE_OVERRIDE' as const },
    });

    const result = await useCase.execute(input);

    expect(result).toMatchObject({
      unitPrice: '18.5',
      totalPrice: '37',
      priceSource: 'RESOURCE_OVERRIDE',
      isSaleable: true,
    });
    expect(pricingRepo.getPriceForUser).toHaveBeenCalledOnce();
  });

  it('falls back to the managed static proxy base price when no configured price exists', async () => {
    const { useCase, pricingRepo } = buildUseCase({
      resource: { providerCode: 'IPIPD', code: 'HK:line-hk-recommended' },
      snapshot: { stock: 5, isStale: false },
      priceResult: null,
    });

    const result = await useCase.execute(input);

    expect(result).toMatchObject({
      unitPrice: '39',
      totalPrice: '78',
      priceSource: 'DEFAULT_TEMPLATE',
      isSaleable: true,
    });
    expect(pricingRepo.getPriceForUser).toHaveBeenCalledOnce();
  });

  it('quotes with a fresh buyable inventory snapshot without syncing upstream', async () => {
    const { useCase, pricingRepo, syncInventory } = buildUseCase({
      snapshot: { stock: 5, isStale: false },
    });

    const result = await useCase.execute(input);

    expect(result).toMatchObject({
      unitPrice: '12.5',
      totalPrice: '25',
      isSaleable: true,
    });
    expect(pricingRepo.getPriceForUser).toHaveBeenCalledOnce();
    expect(syncInventory.execute).not.toHaveBeenCalled();
  });

  it('refreshes a fresh snapshot when the current provider config changed after it was captured', async () => {
    const staleByConfigCapturedAt = new Date('2026-06-25T00:00:00.000Z');
    const { useCase, resourcesRepo, syncInventory } = buildUseCase({
      snapshots: [
        { stock: 5, isStale: false, capturedAt: staleByConfigCapturedAt },
        { stock: 9, isStale: false, capturedAt: new Date('2026-06-26T00:00:00.000Z') },
      ],
      requiresRefreshForProviderConfig: true,
    });

    await expect(useCase.execute(input)).resolves.toMatchObject({
      totalPrice: '25',
      isSaleable: true,
    });

    expect(syncInventory.requiresRefreshForProviderConfig).toHaveBeenCalledWith(
      'site-1',
      'UPSTREAM_API',
      'tenant-1',
      staleByConfigCapturedAt,
      null,
    );
    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'UPSTREAM_API', 'tenant-1', null);
    expect(resourcesRepo.getLatestInventory).toHaveBeenCalledTimes(2);
  });

  it('syncs upstream once when the current snapshot is stale, then quotes from the fresh snapshot', async () => {
    const { useCase, resourcesRepo, syncInventory } = buildUseCase({
      snapshots: [
        { stock: 0, isStale: true },
        { stock: 7, isStale: false },
      ],
    });

    await expect(useCase.execute(input)).resolves.toMatchObject({
      totalPrice: '25',
      isSaleable: true,
    });

    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'UPSTREAM_API', 'tenant-1', null);
    expect(resourcesRepo.getLatestInventory).toHaveBeenCalledTimes(2);
  });

  it('keeps returning a visible stale inventory error when upstream sync writes no fresh snapshot', async () => {
    const { useCase } = buildUseCase({
      snapshots: [null, null],
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_ERROR,
      reasonKey: 'inventory_stale',
    });
  });

  it('propagates upstream sync failures instead of treating stale inventory as buyable', async () => {
    const upstreamError = new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502);
    const { useCase } = buildUseCase({
      snapshot: { stock: 0, isStale: true },
      syncError: upstreamError,
    });

    await expect(useCase.execute(input)).rejects.toBe(upstreamError);
  });

  it('rejects strict-stock provider inventory with stock zero', async () => {
    const { useCase, pricingRepo } = buildUseCase({
      snapshot: { stock: 0, isStale: false },
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_OUT_OF_STOCK,
      reasonKey: 'out_of_stock',
    });
    expect(pricingRepo.getPriceForUser).not.toHaveBeenCalled();
  });

  it('rejects hidden or disabled resources before inventory and pricing lookup', async () => {
    const { useCase, resourcesRepo, pricingRepo } = buildUseCase({
      resource: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
      snapshot: { stock: 5, isStale: false },
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_OUT_OF_STOCK,
      reasonKey: 'provider_country_disabled',
    });
    expect(resourcesRepo.getLatestInventory).not.toHaveBeenCalled();
    expect(pricingRepo.getPriceForUser).not.toHaveBeenCalled();
  });

  it('rejects resources from a previous upstream account before inventory and pricing lookup', async () => {
    const { useCase, resourcesRepo, pricingRepo, syncInventory } = buildUseCase({
      resource: { upstreamAccountId: 'old-account' },
      activeUpstreamAccountId: 'new-account',
      snapshot: { stock: 5, isStale: false },
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_OUT_OF_STOCK,
      reasonKey: 'upstream_resource_not_returned',
    });

    expect(syncInventory.resolveActiveUpstreamAccountId).toHaveBeenCalledWith('site-1', 'UPSTREAM_API', 'tenant-1');
    expect(resourcesRepo.getLatestInventory).not.toHaveBeenCalled();
    expect(pricingRepo.getPriceForUser).not.toHaveBeenCalled();
  });

  it('rejects country grouping resources as non-purchasable', async () => {
    const { useCase, pricingRepo, resourcesRepo } = buildUseCase({
      resource: { providerCode: 'IPIPD', code: 'UA', type: 'COUNTRY' },
      snapshot: { stock: 5, isStale: false },
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'resource_not_purchasable',
    });

    expect(resourcesRepo.getLatestInventory).not.toHaveBeenCalled();
    expect(pricingRepo.getPriceForUser).not.toHaveBeenCalled();
    expect(resourcesRepo.hasProviderMapping).toHaveBeenCalledWith('site-1', 'resource-1', 'IPIPD');
  });

  it('allows mapped country-level upstream resources to quote as concrete products', async () => {
    const { useCase, pricingRepo, resourcesRepo } = buildUseCase({
      resource: { providerCode: 'NINE_EIGHT_FIVE', code: 'HK', type: 'COUNTRY' },
      mappingExists: true,
      snapshot: { stock: 5, isStale: false },
      priceResult: { unitPrice: '29', currency: 'CNY', source: 'RESOURCE_OVERRIDE' as const },
    });

    await expect(useCase.execute(input)).resolves.toMatchObject({
      unitPrice: '29',
      totalPrice: '58',
      isSaleable: true,
    });

    expect(resourcesRepo.hasProviderMapping).toHaveBeenCalledWith('site-1', 'resource-1', 'NINE_EIGHT_FIVE');
    expect(resourcesRepo.getLatestInventory).toHaveBeenCalledOnce();
    expect(pricingRepo.getPriceForUser).toHaveBeenCalledOnce();
  });

  it('rejects Proxy-Seller fresh zero inventory without re-syncing upstream', async () => {
    const { useCase, pricingRepo, syncInventory } = buildUseCase({
      resource: { providerCode: 'PR', code: 'SG' },
      snapshot: { stock: 0, isStale: false },
    });

    await expect(useCase.execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_OUT_OF_STOCK,
      reasonKey: 'out_of_stock',
    });
    expect(pricingRepo.getPriceForUser).not.toHaveBeenCalled();
    expect(syncInventory.execute).not.toHaveBeenCalled();
  });

  it('rejects managed provider quotes with unsupported currency without upstream sync when no configured price exists', async () => {
    const { useCase, resourcesRepo, syncInventory } = buildUseCase({
      resource: { providerCode: 'IPIPD', code: 'HK:line-hk-recommended' },
      snapshot: { stock: 9, isStale: false },
      priceResult: null,
    });

    await expect(useCase.execute({ ...input, currency: 'USD' })).rejects.toMatchObject({
      code: ErrorCode.CURRENCY_NOT_SUPPORTED,
      reasonKey: 'currency_not_supported',
    });

    expect(resourcesRepo.getLatestInventory).toHaveBeenCalledOnce();
    expect(syncInventory.execute).not.toHaveBeenCalled();
  });

  it('syncs Proxy-Seller stale snapshots before allowing quotes', async () => {
    const { useCase, resourcesRepo, syncInventory } = buildUseCase({
      resource: { providerCode: 'PR', code: 'CA' },
      snapshots: [
        { stock: 0, isStale: true },
        { stock: 9, isStale: false },
      ],
    });

    await expect(useCase.execute(input)).resolves.toMatchObject({
      totalPrice: '25',
      isSaleable: true,
    });
    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'PR', 'tenant-1', null);
    expect(resourcesRepo.getLatestInventory).toHaveBeenCalledTimes(2);
  });

  it('propagates Proxy-Seller sync failures instead of treating stale inventory as buyable', async () => {
    const upstreamError = new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
    const { useCase, syncInventory } = buildUseCase({
      resource: { providerCode: 'PR', code: 'CA' },
      snapshot: { stock: 0, isStale: true },
      syncError: upstreamError,
    });

    await expect(useCase.execute(input)).rejects.toBe(upstreamError);
    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'PR', 'tenant-1', null);
  });
});

function buildUseCase(options: {
  resource?: Partial<{
    providerCode: string;
    code: string;
    type: 'COUNTRY' | 'REGION' | 'ZONE';
    status: 'ACTIVE' | 'HIDDEN' | 'DISABLED';
    isVisible: boolean;
    isSaleable: boolean;
    unsaleableReason: string | null;
    upstreamAccountId: string | null;
  }>;
  activeUpstreamAccountId?: string | null;
  snapshot?: { stock: number; isStale: boolean; capturedAt?: Date } | null;
  snapshots?: Array<{ stock: number; isStale: boolean; capturedAt?: Date } | null>;
  mappingExists?: boolean;
  syncError?: Error;
  requiresRefreshForProviderConfig?: boolean;
  priceResult?: { unitPrice: string; currency: string; source: 'USER_OVERRIDE' | 'USER_TEMPLATE' | 'TENANT_DEFAULT_TEMPLATE' | 'RESOURCE_OVERRIDE' | 'DEFAULT_TEMPLATE' } | null;
}) {
  const snapshots = options.snapshots ?? [options.snapshot ?? { stock: 5, isStale: false }];
  const resourcesRepo = {
    findByIdInSite: vi.fn().mockResolvedValue({
      id: 'resource-1',
      siteId: 'site-1',
      providerCode: 'UPSTREAM_API',
      code: 'JP',
      type: 'REGION',
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
      unsaleableReason: null,
      upstreamAccountId: null,
      ...options.resource,
    }),
    getLatestInventory: vi.fn(),
    hasProviderMapping: vi.fn().mockResolvedValue(options.mappingExists ?? false),
  };
  for (const snapshot of snapshots) {
    resourcesRepo.getLatestInventory.mockResolvedValueOnce(snapshot);
  }

  const pricingRepo = {
    getPriceForUser: vi.fn().mockResolvedValue(options.priceResult === undefined ? priceResult : options.priceResult),
  };
  const syncInventory = {
    execute: options.syncError
      ? vi.fn().mockRejectedValue(options.syncError)
      : vi.fn().mockResolvedValue({ synced: 1 }),
    requiresRefreshForProviderConfig: vi.fn().mockResolvedValue(options.requiresRefreshForProviderConfig ?? false),
    resolveActiveUpstreamAccountId: vi.fn().mockResolvedValue(options.activeUpstreamAccountId ?? options.resource?.upstreamAccountId ?? null),
  };

  return {
    useCase: new QuoteUseCase(
      pricingRepo as unknown as PricingRepository,
      resourcesRepo as unknown as ResourcesRepository,
      syncInventory as unknown as SyncInventoryUseCase,
    ),
    pricingRepo,
    resourcesRepo,
    syncInventory,
  };
}
