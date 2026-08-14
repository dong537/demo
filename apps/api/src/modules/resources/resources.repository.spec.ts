import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import type { Prisma } from '@ipeasy/db';
import { ResourcesRepository } from './resources.repository';

type ResourceRowFixture = Prisma.platform_resourcesGetPayload<{
  include: {
    inventory_snapshots: true;
    resource_mappings: true;
  };
}>;

vi.mock('@ipeasy/db', () => ({
  prisma: {
    platform_resources: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    provider_accounts: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    upstream_api_accounts: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user_resource_price_overrides: {
      findMany: vi.fn(),
    },
    user_price_bindings: {
      findUnique: vi.fn(),
    },
    users: {
      findFirst: vi.fn(),
    },
    price_overrides: {
      findMany: vi.fn(),
    },
    price_templates: {
      findFirst: vi.fn(),
    },
    price_rules: {
      findMany: vi.fn(),
    },
  },
  ResourceStatus: {},
  ResourceType: {},
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.platform_resources.count).mockResolvedValue(1001);
  vi.mocked(prisma.platform_resources.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.provider_accounts.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.upstream_api_accounts.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
    resourceRow('resource-page-3-a', 'US:line-a'),
    resourceRow('resource-page-3-b', 'SG:line-b'),
  ]);
  vi.mocked(prisma.provider_accounts.findMany).mockResolvedValue([
    currentProviderAccountRow('IPIPD', 'pa-ipipd'),
    currentProviderAccountRow('NINE_EIGHT_FIVE', 'pa-985'),
    currentProviderAccountRow('PR', 'pa-pr'),
  ] as never);
  vi.mocked(prisma.upstream_api_accounts.findMany).mockResolvedValue([
    { id: 'ua-1', tenantId: null, status: 'ACTIVE' },
  ] as never);
  vi.mocked(prisma.platform_resources.upsert).mockResolvedValue(resourceRow('resource-upsert', 'TW:shared'));
  vi.mocked(prisma.platform_resources.updateMany).mockResolvedValue({ count: 0 });
  vi.mocked(prisma.user_resource_price_overrides.findMany).mockResolvedValue([]);
  vi.mocked(prisma.user_price_bindings.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.users.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([]);
  vi.mocked(prisma.price_templates.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.price_rules.findMany).mockResolvedValue([]);
});

describe('ResourcesRepository public saleable listing', () => {
  it('paginates public resources in the database before resolving current-page prices', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(3);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-visible-c', 'TH:line-c'),
    ]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-visible-c',
        durationDays: 30,
        unitPrice: { toString: () => '12' } as unknown as never,
        currency: 'USD',
      } as never,
    ]);

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 2,
      pageSize: 1,
      durationDays: 30,
      currency: 'USD',
      search: 'line',
    });

    expect(result).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-visible-c',
      unitPrice: '12',
      priceCurrency: 'USD',
    });
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ inventory_snapshots: expect.anything() }),
    }));
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: expect.arrayContaining([
              { type: { not: 'COUNTRY' } },
              { resource_mappings: { some: { siteId: 'site-1' } } },
            ]),
          },
        ]),
      }),
      skip: 1,
      take: 1,
    }));
    expect(prisma.price_overrides.findMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        resourceId: { in: ['resource-visible-c'] },
        durationDays: 30,
      },
    });
  });

  it('keeps public country-only resources out of the purchasable catalog', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(0);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      type: 'COUNTRY',
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(result.items).toEqual([]);
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: 'COUNTRY',
        AND: expect.arrayContaining([
          {
            OR: expect.arrayContaining([
              { type: { not: 'COUNTRY' } },
              { resource_mappings: { some: { siteId: 'site-1' } } },
            ]),
          },
        ]),
      }),
    }));
  });

  it('allows mapped country-level upstream resources into the saleable catalog filter', async () => {
    const mappedCountry = resourceRow('resource-hk-country-upstream', 'HK', {
      type: 'COUNTRY',
      mapped: true,
      providerResourceId: 'HK',
      stock: 12,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
    });
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([mappedCountry]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([]);
    const repo = new ResourcesRepository();

    const result = await repo.listPriceableCatalog('site-1', { durationDays: 30 });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: expect.arrayContaining([
              { type: { not: 'COUNTRY' } },
              { resource_mappings: { some: { siteId: 'site-1' } } },
            ]),
          },
        ]),
      }),
    }));
    expect(result.items[0]).toMatchObject({
      id: 'resource-hk-country-upstream',
      countryCode: 'HK',
      upstreamResourceId: 'HK',
    });
  });

  it('summarizes priceable resources by country without returning full catalog rows to the client', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('us-ny-low', 'US:new-york', { upstreamCost: '18.50', upstreamCostCurrency: 'CNY', mapped: true }),
      resourceRow('us-la-low', 'US:los-angeles', { upstreamCost: '18.50', upstreamCostCurrency: 'CNY', mapped: true }),
      resourceRow('in-mumbai', 'IN:mumbai', { upstreamCost: '20.00', upstreamCostCurrency: 'CNY', mapped: true }),
    ]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'us-ny-low',
        durationDays: 30,
        unitPrice: { toString: () => '49.5' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);

    const result = await repo.listPriceableCatalogSummary('site-1', { durationDays: 30, pageSize: 20 });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
      totalResources: 3,
    });
    expect(result.items).toEqual([
      {
        countryCode: 'IN',
        totalResources: 1,
        regionCount: 1,
        pricedCount: 0,
        costGroupCount: 1,
      },
      {
        countryCode: 'US',
        totalResources: 2,
        regionCount: 1,
        pricedCount: 1,
        costGroupCount: 1,
      },
    ]);
  });

  it('groups priceable resources by country, region, and upstream cost for backend-owned bulk pricing', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('us-ny-low', 'US:new-york', { upstreamCost: '18.50', upstreamCostCurrency: 'CNY', mapped: true }),
      resourceRow('us-ny-high', 'US:new-york', { upstreamCost: '20.00', upstreamCostCurrency: 'CNY', mapped: true }),
    ]);

    const result = await repo.listPriceableCatalogGroups('site-1', { countryCode: 'US', durationDays: 30 });

    expect(result).toMatchObject({
      countryCode: 'US',
      total: 2,
      totalResources: 2,
    });
    expect(result.items.map((item) => ({
      countryCode: item.countryCode,
      regionKey: item.regionKey,
      resourceCount: item.resourceCount,
      upstreamCost: item.upstreamCost,
      autoSelect: item.autoSelect,
    }))).toEqual([
      {
        countryCode: 'US',
        regionKey: 'new-york',
        resourceCount: 1,
        upstreamCost: '18.50',
        autoSelect: false,
      },
      {
        countryCode: 'US',
        regionKey: 'new-york',
        resourceCount: 1,
        upstreamCost: '20.00',
        autoSelect: false,
      },
    ]);

    const selectedIds = await repo.findPriceableCatalogGroupResourceIds('site-1', {
      countryCode: 'US',
      regionKey: result.items[0]!.regionKey,
      costGroupKey: result.items[0]!.costGroupKey,
    });
    expect(selectedIds).toEqual(['us-ny-low']);
  });

  it('unlists every real resource in a priceable catalog group on the backend', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('us-ny-low-a', 'US:new-york', { upstreamCost: '18.50', upstreamCostCurrency: 'CNY', mapped: true }),
      resourceRow('us-ny-low-b', 'US:new-york', { upstreamCost: '18.50', upstreamCostCurrency: 'CNY', mapped: true }),
      resourceRow('us-ny-high', 'US:new-york', { upstreamCost: '20.00', upstreamCostCurrency: 'CNY', mapped: true }),
    ]);
    vi.mocked(prisma.platform_resources.updateMany).mockResolvedValue({ count: 2 });

    const groups = await repo.listPriceableCatalogGroups('site-1', { countryCode: 'US', durationDays: 30 });
    const targetGroup = groups.items.find((item) => item.upstreamCost === '18.50');
    const result = await repo.updatePriceableCatalogGroupSaleability('site-1', {
      countryCode: 'US',
      regionKey: targetGroup?.regionKey,
      costGroupKey: targetGroup?.costGroupKey,
    }, false);

    expect(result).toEqual({
      updated: 2,
      resourceIds: ['us-ny-low-a', 'us-ny-low-b'],
    });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        id: { in: ['us-ny-low-a', 'us-ny-low-b'] },
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_sale_disabled',
      },
    });
  });

  it('expands customer Chinese city search into database resource fields', async () => {
    const repo = new ResourcesRepository();

    await repo.list('site-1', {
      publicOnly: true,
      page: 1,
      pageSize: 300,
      durationDays: 30,
      currency: 'CNY',
      search: '纽约',
    });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { displayName: { contains: 'New York', mode: 'insensitive' } },
          { code: { contains: ':NY', mode: 'insensitive' } },
          { code: { contains: 'USANY', mode: 'insensitive' } },
        ]),
      }),
    }));
  });

  it('expands customer Chinese country search without broad code contains matches', async () => {
    const repo = new ResourcesRepository();

    await repo.list('site-1', {
      publicOnly: true,
      page: 1,
      pageSize: 300,
      durationDays: 30,
      currency: 'CNY',
      search: '\u65b0\u52a0\u5761',
    });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { code: { startsWith: 'SG', mode: 'insensitive' } },
          { displayName: { contains: 'Singapore', mode: 'insensitive' } },
        ]),
      }),
    }));
    expect(prisma.platform_resources.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { code: { contains: 'SG', mode: 'insensitive' } },
        ]),
      }),
    }));
  });

  it('uses startsWith for two-letter country code aliases', async () => {
    const repo = new ResourcesRepository();

    await repo.list('site-1', {
      publicOnly: true,
      page: 1,
      pageSize: 300,
      durationDays: 30,
      currency: 'CNY',
      search: 'US',
    });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { code: { startsWith: 'US', mode: 'insensitive' } },
          { displayName: { contains: 'United States', mode: 'insensitive' } },
        ]),
      }),
    }));
    expect(prisma.platform_resources.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { code: { contains: 'US', mode: 'insensitive' } },
        ]),
      }),
    }));
  });

  it('scopes public resources by country code before pagination', async () => {
    vi.mocked(prisma.platform_resources.findMany)
      .mockResolvedValueOnce([
        resourceRow('resource-at-region', 'AT:6928:Lower Austria:Telekom Austria', { type: 'REGION' }),
        resourceRow('resource-ca-region', 'CA:6928:Ontario:Woodstock:Comwave Telecom', { type: 'REGION' }),
      ])
      .mockResolvedValueOnce([
        resourceRow('resource-at-region', 'AT:6928:Lower Austria:Telekom Austria', { type: 'REGION' }),
      ]);
    const repo = new ResourcesRepository();

    await repo.list('site-1', {
      publicOnly: true,
      page: 1,
      pageSize: 1,
      durationDays: 30,
      currency: 'CNY',
      countryCode: 'AT',
    });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: [
              { code: { equals: 'AT', mode: 'insensitive' } },
              { code: { startsWith: 'AT:', mode: 'insensitive' } },
            ],
          },
        ]),
      }),
      skip: 0,
      take: 1,
    }));
  });

  it('builds country summaries without loading inventory snapshots for every resource', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-sg-a', 'SG:line-a', { type: 'REGION' }),
      resourceRow('resource-sg-b', 'SG:line-b', { type: 'REGION' }),
      resourceRow('resource-th', 'TH:line-a', { type: 'REGION' }),
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.listPublicCountries('site-1', { search: 'SG' });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        code: true,
        providerCode: true,
        ipType: true,
      }),
    }));
    expect(prisma.platform_resources.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        inventory_snapshots: expect.anything(),
      }),
    }));
    expect(result.items).toEqual([
      { countryCode: 'SG', totalResources: 2, availableStock: 0 },
      { countryCode: 'TH', totalResources: 1, availableStock: 0 },
    ]);
  });

  it('returns the admin priceable catalog without display pagination', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(2);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-at-lower-austria', 'AT:6928:Lower Austria:Telekom Austria', {
        stock: 5,
        capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      }),
      resourceRow('resource-sg-line', 'SG:line-sg', {
        stock: 8,
        capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      }),
    ]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-at-lower-austria',
        durationDays: 30,
        unitPrice: { toString: () => '49' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.listPriceableCatalog('site-1', { durationDays: 30 });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        siteId: 'site-1',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        AND: expect.arrayContaining([
          {
            OR: expect.arrayContaining([
              { type: { not: 'COUNTRY' } },
              { resource_mappings: { some: { siteId: 'site-1' } } },
            ]),
          },
          expect.objectContaining({
            OR: expect.arrayContaining([
              { providerCode: 'IPIPD', upstreamAccountId: 'pa-ipipd' },
            ]),
          }),
        ]),
      }),
    }));
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({
        inventory_snapshots: expect.anything(),
      }),
    }));
    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(result.items[0]).toMatchObject({
      id: 'resource-at-lower-austria',
      unitPrice: '49',
      priceCurrency: 'CNY',
    });
  });

  it('allows the dedicated priceable catalog to return larger setup pages', async () => {
    const repo = new ResourcesRepository();

    const result = await repo.listPriceableCatalog('site-1', { page: 2, pageSize: 500, durationDays: 30 });

    expect(result).toMatchObject({
      page: 2,
      pageSize: 500,
      total: 1001,
    });
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 500,
      take: 500,
    }));
  });

  it('keeps configured public resources visible when local inventory needs realtime quote refresh', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-stale-tw', 'TW', {
        stock: 0,
        isStale: true,
        capturedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-stale-tw',
      stock: 0,
      inventoryIsStale: true,
      unitPrice: '39',
      priceCurrency: 'CNY',
    });
  });

  it('uses configured prices for managed static proxy resources before the 39 CNY base price', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-ipipd-hk', 'HK:line-hk-recommended', {
        stock: 12,
        capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      }),
    ]);
    vi.mocked(prisma.user_resource_price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        userId: 'user-1',
        resourceId: 'resource-ipipd-hk',
        durationDays: 30,
        unitPrice: { toString: () => '10' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-ipipd-hk',
        durationDays: 30,
        unitPrice: { toString: () => '28' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-ipipd-hk',
      unitPrice: '10',
      priceCurrency: 'CNY',
    });
  });

  it('uses global resource override prices for managed static proxy resources before the base price', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-pr-ca', 'CA:6928:Ontario:Woodstock:Comwave Telecom', {
        stock: 8,
        capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      }),
    ]);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-pr-ca',
        durationDays: 30,
        unitPrice: { toString: () => '48.5' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-pr-ca',
      unitPrice: '48.5',
      priceCurrency: 'CNY',
    });
  });

  it('uses global resource override prices for customer-owned tenants', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany)
      .mockResolvedValueOnce([
        resourceRow('resource-pr-ca', 'CA:6928:Ontario:Woodstock:Comwave Telecom', {
          stock: 8,
          capturedAt: new Date('2026-06-18T00:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        resourceRow('resource-pr-ca', 'CA:6928:Ontario:Woodstock:Comwave Telecom', {
          stock: 8,
          capturedAt: new Date('2026-06-18T00:00:00.000Z'),
        }),
      ]);
    vi.mocked(prisma.users.findFirst).mockResolvedValue({
      tenantId: 'tenant-1',
      tenant: { ownerUserId: 'owner-user-1' },
    } as never);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-pr-ca',
        durationDays: 30,
        unitPrice: { toString: () => '18' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-pr-ca',
      unitPrice: '18',
      priceCurrency: 'CNY',
    });
  });

  it('inherits public prices from the same-provider country resource when a concrete line has no direct override', async () => {
    const lineResource = resourceRow('resource-ua-line', 'UA:6928:Kyiv:Provider', {
      stock: 8,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      type: 'REGION',
    });
    const countryResource = resourceRow('resource-ua-country', 'UA', {
      stock: 8,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      type: 'COUNTRY',
    });
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany)
      .mockResolvedValueOnce([lineResource])
      .mockResolvedValueOnce([lineResource]);
    vi.mocked(prisma.platform_resources.findFirst).mockImplementation((async (args: unknown) => {
      const where = (args as { where?: { id?: string; type?: string; code?: string } }).where;
      if (where?.id === 'resource-ua-line') return lineResource;
      if (where?.type === 'COUNTRY' && where?.code === 'UA') return countryResource;
      return null;
    }) as never);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-ua-country',
        durationDays: 30,
        unitPrice: { toString: () => '10' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-ua-line',
      unitPrice: '10',
      priceCurrency: 'CNY',
    });
    expect(prisma.price_overrides.findMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        resourceId: { in: ['resource-ua-line', 'resource-ua-country'] },
        durationDays: 30,
      },
    });
  });

  it('inherits public prices from a parent region before falling back to the country resource', async () => {
    const networkResource = resourceRow('resource-ua-network', 'UA:6928:Kyiv:Provider:Subnet', {
      stock: 8,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      type: 'ZONE',
      parentId: 'resource-ua-region',
    });
    const regionResource = resourceRow('resource-ua-region', 'UA:6928:Kyiv:Provider', {
      stock: 8,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      type: 'REGION',
      parentId: 'resource-ua-country',
    });
    const countryResource = resourceRow('resource-ua-country', 'UA', {
      stock: 8,
      capturedAt: new Date('2026-06-18T00:00:00.000Z'),
      type: 'COUNTRY',
    });
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany)
      .mockResolvedValueOnce([networkResource])
      .mockResolvedValueOnce([networkResource]);
    vi.mocked(prisma.platform_resources.findFirst).mockImplementation((async (args: unknown) => {
      const where = (args as { where?: { id?: string; type?: string; code?: string } }).where;
      if (where?.id === 'resource-ua-network') return networkResource;
      if (where?.id === 'resource-ua-region') return regionResource;
      if (where?.id === 'resource-ua-country') return countryResource;
      if (where?.type === 'COUNTRY' && where?.code === 'UA') return countryResource;
      return null;
    }) as never);
    vi.mocked(prisma.price_overrides.findMany).mockResolvedValue([
      {
        siteId: 'site-1',
        resourceId: 'resource-ua-region',
        durationDays: 30,
        unitPrice: { toString: () => '22' } as unknown as never,
        currency: 'CNY',
      } as never,
    ]);
    const repo = new ResourcesRepository();

    const result = await repo.list('site-1', {
      publicOnly: true,
      userId: 'user-1',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'resource-ua-network',
      unitPrice: '22',
      priceCurrency: 'CNY',
    });
    expect(prisma.price_overrides.findMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        resourceId: { in: ['resource-ua-network', 'resource-ua-region', 'resource-ua-country'] },
        durationDays: 30,
      },
    });
  });

  it('exposes upstream cost only in the admin resource listing', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(1);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([
      resourceRow('resource-cost', 'CA:6928:Ontario:Woodstock:Comwave Telecom', {
        stock: 8,
        capturedAt: new Date('2026-06-18T00:00:00.000Z'),
        upstreamCost: '12.34',
        upstreamCostCurrency: 'USD',
      }),
    ]);
    const repo = new ResourcesRepository();

    const adminResult = await repo.list('site-1', {
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });
    expect(adminResult.items[0]).toMatchObject({
      id: 'resource-cost',
      costGroupKey: expect.stringMatching(/^cost-/),
      upstreamCost: '12.34',
      upstreamCostCurrency: 'USD',
    });

    const publicResult = await repo.list('site-1', {
      publicOnly: true,
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });
    expect(publicResult.items[0]).toMatchObject({
      id: 'resource-cost',
      costGroupKey: expect.stringMatching(/^cost-/),
      unitPrice: '39',
      priceCurrency: 'CNY',
    });
    expect(publicResult.items[0].upstreamCost).toBeUndefined();
    expect(publicResult.items[0].upstreamCostCurrency).toBeUndefined();
  });

  it('filters the admin resource list to the current upstream account so legacy PR rows stay hidden', async () => {
    const repo = new ResourcesRepository();

    await repo.list('site-1', {
      providerCode: 'PR',
      page: 1,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        siteId: 'site-1',
        providerCode: 'PR',
        AND: expect.arrayContaining([
          {
            OR: [
              { providerCode: 'PR', upstreamAccountId: 'pa-pr' },
            ],
          },
        ]),
      }),
    }));
  });
});

describe('ResourcesRepository upstream cost sync', () => {
  it('clears stale upstream cost when the current upstream response has no cost', async () => {
    const repo = new ResourcesRepository();

    await repo.upsertSyncedResource({
      siteId: 'site-1',
      providerCode: 'NINE_EIGHT_FIVE',
      upstreamAccountId: 'pa-985',
      code: 'TW:shared',
      name: 'Taiwan',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      upstreamCost: null,
      upstreamCostCurrency: null,
    });

    expect(prisma.platform_resources.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        upstreamCost: null,
        upstreamCostCurrency: null,
      }),
      update: expect.objectContaining({
        upstreamCost: null,
        upstreamCostCurrency: null,
      }),
    }));
  });

  it('trims upstream cost strings before persisting them', async () => {
    const repo = new ResourcesRepository();

    await repo.upsertSyncedResource({
      siteId: 'site-1',
      providerCode: 'UPSTREAM_API',
      upstreamAccountId: 'upstream-api-account',
      code: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
      name: 'Canada',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      upstreamCost: ' 8.80 ',
      upstreamCostCurrency: 'usd',
    });

    const args = vi.mocked(prisma.platform_resources.upsert).mock.calls[0]?.[0];
    expect(String((args as { create: { upstreamCost: unknown }; update: { upstreamCost: unknown } }).create.upstreamCost)).toBe('8.8');
    expect(String((args as { create: { upstreamCost: unknown }; update: { upstreamCost: unknown } }).update.upstreamCost)).toBe('8.8');
  });

  it('does not require an IPIPD recommended marker when applying managed provider saleability', async () => {
    const repo = new ResourcesRepository();

    await repo.upsertSyncedResource({
      siteId: 'site-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'pa-ipipd',
      code: 'GB:1487484105317814272',
      name: 'United Kingdom',
      displayName: 'United Kingdom',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      providerResourceId: 'line-gb-standard',
      upstreamCost: '8.8',
      upstreamCostCurrency: 'CNY',
    });

    expect(prisma.platform_resources.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      }),
      update: expect.objectContaining({
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      }),
    }));
  });

  it('applies explicit saleability state during synced resource upsert', async () => {
    const repo = new ResourcesRepository();

    await repo.upsertSyncedResource({
      siteId: 'site-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'pa-ipipd',
      code: 'HK:line-hk',
      name: 'Hong Kong',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      providerResourceId: 'line-hk',
      saleabilityOverride: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    });

    expect(prisma.platform_resources.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      }),
      update: expect.objectContaining({
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      }),
    }));
  });
});

describe('ResourcesRepository synced resource cleanup', () => {
  it('archives resources by code and IP type after a native provider sync', async () => {
    const repo = new ResourcesRepository();

    await repo.disableResourcesOutsideCoverage('site-1', 'IPIPD', 'pa-1', [
      { code: 'US:line-1', ipType: 'NATIVE' },
      { code: 'US:line-1', ipType: 'NATIVE' },
      { code: 'US:line-2', ipType: 'BROADCAST' },
    ]);

    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        providerCode: 'IPIPD',
        upstreamAccountId: 'pa-1',
        status: { not: 'DISABLED' },
        NOT: {
          OR: [
            { ipType: 'NATIVE', code: { in: ['US:line-1'] } },
            { ipType: 'BROADCAST', code: { in: ['US:line-2'] } },
          ],
        },
      },
      data: {
        status: 'DISABLED',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_not_supported',
      },
    });
  });

  it('hides generic upstream resources by code and IP type after account switching', async () => {
    const repo = new ResourcesRepository();

    await repo.hideResourcesOutsideCurrentSync('site-1', 'UPSTREAM_API', 'ua-1', [
      { code: 'SG:line-1', ipType: 'NATIVE' },
    ]);

    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        providerCode: 'UPSTREAM_API',
        upstreamAccountId: 'ua-1',
        status: { not: 'DISABLED' },
        NOT: {
          OR: [
            { ipType: 'NATIVE', code: { in: ['SG:line-1'] } },
          ],
        },
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'upstream_resource_not_returned',
      },
    });
  });

  it('keeps resources for every current provider account when hiding old account resources', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.provider_accounts.findMany).mockResolvedValue([
      { id: 'pa-global-current', tenantId: null, status: 'ACTIVE' },
      { id: 'pa-global-old', tenantId: null, status: 'ACTIVE' },
      { id: 'pa-tenant-current', tenantId: 'tenant-1', status: 'ACTIVE' },
      { id: 'pa-tenant-old', tenantId: 'tenant-1', status: 'ACTIVE' },
      { id: 'pa-disabled-current', tenantId: 'tenant-2', status: 'DISABLED' },
    ] as never);

    await repo.hideResourcesFromOtherUpstreamAccounts('site-1', 'IPIPD', 'pa-global-current');

    expect(prisma.provider_accounts.findMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', providerCode: 'IPIPD' },
      select: {
        id: true,
        tenantId: true,
        status: true,
      },
      orderBy: expect.any(Array),
    });
    expect(prisma.platform_resources.updateMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        providerCode: 'IPIPD',
        status: { not: 'DISABLED' },
        OR: [
          { upstreamAccountId: { notIn: ['pa-global-current', 'pa-tenant-current'] } },
          { upstreamAccountId: null },
        ],
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'upstream_resource_not_returned',
      },
    });
  });

  it('looks up provider account tenant without reading credentials', async () => {
    const repo = new ResourcesRepository();
    vi.mocked(prisma.provider_accounts.findFirst).mockResolvedValue({ tenantId: 'tenant-1' } as never);

    await expect(repo.findProviderAccountTenant('site-1', 'IPIPD', 'pa-1')).resolves.toBe('tenant-1');

    expect(prisma.provider_accounts.findFirst).toHaveBeenCalledWith({
      where: { id: 'pa-1', siteId: 'site-1', providerCode: 'IPIPD' },
      select: { tenantId: true },
    });
  });
});

function resourceRow(
  id: string,
  code: string,
  inventory: {
    stock?: number;
    isStale?: boolean;
    capturedAt?: Date;
    upstreamCost?: string | null;
    upstreamCostCurrency?: string | null;
    type?: 'COUNTRY' | 'REGION' | 'ZONE';
    parentId?: string | null;
    mapped?: boolean;
    providerResourceId?: string;
  } = {},
): ResourceRowFixture {
  return {
    id,
    siteId: 'site-1',
    upstreamAccountId: 'pa-ipipd',
    parentId: inventory.parentId ?? null,
    providerCode: 'IPIPD',
    code,
    name: code,
    displayName: code,
    type: inventory.type ?? 'REGION',
    ipType: 'NATIVE' as const,
    protocol: 'BOTH' as const,
    status: 'ACTIVE' as const,
    sortOrder: 0,
    isVisible: true,
    isSaleable: true,
    unsaleableReason: null,
    upstreamCost: decimalFixture(inventory.upstreamCost),
    upstreamCostCurrency: inventory.upstreamCostCurrency ?? null,
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    inventory_snapshots: [
      {
        id: `${id}-inventory`,
        siteId: 'site-1',
        resourceId: id,
        providerCode: 'IPIPD',
        upstreamAccountId: 'pa-ipipd',
        stock: inventory.stock ?? 50,
        capturedAt: inventory.capturedAt ?? new Date('2026-06-18T00:00:00.000Z'),
        freshnessTtlSeconds: 60 * 60 * 24 * 30,
        isStale: inventory.isStale ?? false,
      },
    ],
    resource_mappings: inventory.mapped
      ? [{
          id: `${id}-mapping`,
          siteId: 'site-1',
          resourceId: id,
          providerCode: 'IPIPD',
          upstreamAccountId: 'pa-ipipd',
          providerResourceId: inventory.providerResourceId ?? code,
          weight: 100,
        }]
      : [],
  };
}

function currentProviderAccountRow(providerCode: string, id: string) {
  return {
    id,
    tenantId: null,
    providerCode,
    status: 'ACTIVE',
  };
}

function decimalFixture(value: string | null | undefined): ResourceRowFixture['upstreamCost'] {
  if (value === null || value === undefined) return null;
  return { toString: () => String(value).trim() } as ResourceRowFixture['upstreamCost'];
}
