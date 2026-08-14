import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { ProvidersRepository } from './providers.repository';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from './provider-account-order';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    platform_resources: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    provider_accounts: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (writes: unknown[]) => Promise.all(writes as Promise<unknown>[])),
  },
  Prisma: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.platform_resources.update).mockResolvedValue({} as never);
  vi.mocked(prisma.platform_resources.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.provider_accounts.update).mockResolvedValue(providerAccountRow() as never);
});

function providerAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-1',
    siteId: 'site-1',
    tenantId: null,
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    credentialEncrypted: 'cipher',
    baseUrl: 'https://api.ipipd.cn',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ProvidersRepository resource sale selection projection', () => {
  it('projects enabled provider countries to every synced resource without bypassing native sale policy', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'gb-recommended',
        code: 'GB:line-recommended',
        name: 'United Kingdom Recommended',
        displayName: 'United Kingdom Recommended',
        unsaleableReason: null,
      },
      {
        id: 'gb-standard',
        code: 'GB:line-standard',
        name: 'United Kingdom Standard',
        displayName: 'United Kingdom Standard',
        unsaleableReason: null,
      },
      {
        id: 'jp-recommended',
        code: 'JP:line-recommended',
        name: 'Japan Recommended',
        displayName: 'Japan Recommended',
        unsaleableReason: null,
      },
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.applyEnabledCountrySelectionToResources('site-1', 'IPIPD', ['GB']);

    expect(result).toEqual({ updated: 3, saleable: 2, hidden: 1 });
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        providerCode: 'IPIPD',
        OR: [
          { status: { not: 'DISABLED' } },
          { unsaleableReason: { in: ['provider_country_disabled', 'provider_country_not_supported', 'provider_sale_disabled'] } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        status: true,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: true,
        resource_mappings: {
          select: { providerResourceId: true },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended', 'gb-standard'] } },
      data: {
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
    });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['jp-recommended'] } },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    });
  });

  it('treats an empty native provider country selection as no saleable countries', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'gb-recommended',
        code: 'GB:line-recommended',
        name: 'United Kingdom Recommended',
        displayName: 'United Kingdom Recommended',
        unsaleableReason: null,
      },
      {
        id: 'jp-recommended',
        code: 'JP:line-recommended',
        name: 'Japan Recommended',
        displayName: 'Japan Recommended',
        unsaleableReason: null,
      },
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.applyEnabledCountrySelectionToResources('site-1', 'IPIPD', []);

    expect(result).toEqual({ updated: 2, saleable: 0, hidden: 2 });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended', 'jp-recommended'] } },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    });
  });

  it('re-enables selected recommended lines that were hidden by previous provider country settings', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'gb-recommended',
        code: 'GB:line-recommended',
        name: 'United Kingdom Recommended',
        displayName: 'United Kingdom Recommended',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
        resource_mappings: [],
      },
      {
        id: 'gb-other-recommended',
        code: 'GB:line-recommended-other',
        name: 'United Kingdom Recommended Other',
        displayName: 'United Kingdom Recommended Other',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: null,
        resource_mappings: [],
      },
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.applyEnabledCountrySelectionToResources('site-1', 'IPIPD', ['GB']);

    expect(result).toEqual({ updated: 2, saleable: 2, hidden: 0 });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended', 'gb-other-recommended'] } },
      data: {
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
    });
  });

  it('keeps manually disabled resources hidden when the provider country remains enabled', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'gb-recommended-manual-off',
        code: 'GB:line-recommended',
        name: 'United Kingdom Recommended',
        displayName: 'United Kingdom Recommended',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_sale_disabled',
        resource_mappings: [],
      },
      {
        id: 'gb-recommended-live',
        code: 'GB:line-recommended-other',
        name: 'United Kingdom Recommended Other',
        displayName: 'United Kingdom Recommended Other',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        resource_mappings: [],
      },
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.applyEnabledCountrySelectionToResources('site-1', 'IPIPD', ['GB']);

    expect(result).toEqual({ updated: 2, saleable: 1, hidden: 1 });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended-live'] } },
      data: {
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
    });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended-manual-off'] } },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_sale_disabled',
      },
    });
  });

  it('re-enables selected resources previously disabled by unsupported-country cleanup', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'gb-recommended',
        code: 'GB:line-recommended',
        name: 'United Kingdom Recommended',
        displayName: 'United Kingdom Recommended',
        status: 'DISABLED',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_not_supported',
        resource_mappings: [],
      },
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.applyEnabledCountrySelectionToResources('site-1', 'IPIPD', ['GB']);

    expect(result).toEqual({ updated: 1, saleable: 1, hidden: 0 });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', id: { in: ['gb-recommended'] } },
      data: {
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
    });
  });

  it('does not require a recommended marker in the IPIPD provider resource mapping', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      {
        id: 'sg-mapped-cidr',
        code: 'SG:1502372021504507904|cidr=203.0.113.0/24',
        name: 'Singapore',
        displayName: 'Singapore',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
        resource_mappings: [{ providerResourceId: '1502372021504507904|cidr=203.0.113.0/24' }],
      },
    ] as never);
    const repo = new ProvidersRepository();

    const plan = await repo.planEnabledCountrySelectionToResources('site-1', 'IPIPD', ['SG']);

    expect(plan).toMatchObject({
      total: 1,
      saleable: 1,
      hidden: 0,
      changed: 1,
      saleableIds: ['sg-mapped-cidr'],
    });
  });

  it('lists only the current saved account per scope for inventory sync', async () => {
    vi.mocked(prisma.provider_accounts.findMany).mockResolvedValue([
      providerAccountRow({
        id: 'ipipd-current-off',
        providerCode: 'IPIPD',
        inventorySyncEnabled: false,
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
      providerAccountRow({
        id: 'ipipd-old-on',
        providerCode: 'IPIPD',
        inventorySyncEnabled: true,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      providerAccountRow({
        id: 'pr-current-on',
        providerCode: 'PR',
        inventorySyncEnabled: true,
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
      providerAccountRow({
        id: 'pr-old-on',
        providerCode: 'PR',
        inventorySyncEnabled: true,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      providerAccountRow({
        id: 'nef-current-disabled',
        providerCode: 'NINE_EIGHT_FIVE',
        status: 'DISABLED',
        inventorySyncEnabled: true,
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
    ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.listInventorySyncEnabled();

    expect(prisma.provider_accounts.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        siteId: true,
        tenantId: true,
        providerCode: true,
        status: true,
        inventorySyncEnabled: true,
        enabledCountryCodes: true,
      },
      orderBy: [{ siteId: 'asc' }, { tenantId: 'asc' }, { providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
    });
    expect(result.map((row) => row.id)).toEqual(['pr-current-on']);
  });
});

describe('ProvidersRepository resource saleability direct updates', () => {
  it('rebuilds provider country selection from the final saleable resource set', async () => {
    vi.mocked(prisma.provider_accounts.findFirst)
      .mockResolvedValueOnce(providerAccountRow({ enabledCountryCodes: [] }) as never);
    vi.mocked(prisma.provider_accounts.update)
      .mockResolvedValue(providerAccountRow({ enabledCountryCodes: ['GB', 'SG'] }) as never);
    vi.mocked(prisma.platform_resources.findMany)
      .mockResolvedValueOnce([
        {
          id: 'gb-recommended',
          code: 'GB:line-recommended',
          name: 'United Kingdom Recommended',
          displayName: 'United Kingdom Recommended',
          status: 'ACTIVE',
          isVisible: true,
          isSaleable: true,
          unsaleableReason: null,
          resource_mappings: [{ providerResourceId: 'line-gb-recommended' }],
        },
        {
          id: 'gb-standard',
          code: 'GB:line-standard',
          name: 'United Kingdom Standard',
          displayName: 'United Kingdom Standard',
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_sale_disabled',
          resource_mappings: [{ providerResourceId: 'line-gb-standard' }],
        },
        {
          id: 'hk-close',
          code: 'HK:line-recommended',
          name: 'Hong Kong Recommended',
          displayName: 'Hong Kong Recommended',
          status: 'ACTIVE',
          isVisible: true,
          isSaleable: true,
          unsaleableReason: null,
          resource_mappings: [{ providerResourceId: 'line-hk-recommended' }],
        },
        {
          id: 'sg-enable',
          code: 'SG:line-standard',
          name: 'Singapore Standard',
          displayName: 'Singapore Standard',
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_country_disabled',
          resource_mappings: [{ providerResourceId: 'line-sg-standard' }],
        },
      ] as never);
    const repo = new ProvidersRepository();

    const result = await repo.updateResourceSaleability('site-1', 'pa-1', [
      { resourceId: 'hk-close', saleable: false },
      { resourceId: 'sg-enable', saleable: true },
    ]);

    expect(prisma.platform_resources.update).toHaveBeenCalledWith({
      where: { id: 'sg-enable' },
      data: {
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
    });
    expect(prisma.platform_resources.update).toHaveBeenCalledWith({
      where: { id: 'hk-close' },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_sale_disabled',
      },
    });
    expect(prisma.provider_accounts.update).toHaveBeenCalledWith({
      where: { id: 'pa-1' },
      data: { enabledCountryCodes: ['GB', 'SG'] },
    });
    expect(result).toMatchObject({
      updated: 2,
      enabledCountryCodes: ['GB', 'SG'],
      account: expect.objectContaining({ enabledCountryCodes: ['GB', 'SG'] }),
    });
  });
});
