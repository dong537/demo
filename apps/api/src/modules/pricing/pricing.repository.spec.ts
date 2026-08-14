import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { PricingRepository } from './pricing.repository';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    platform_resources: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    provider_accounts: {
      findMany: vi.fn(),
    },
    upstream_api_accounts: {
      findMany: vi.fn(),
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
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.provider_accounts.findMany).mockResolvedValue([
    { id: 'pa-ipipd', tenantId: null, providerCode: 'IPIPD', status: 'ACTIVE' },
    { id: 'pa-pr', tenantId: null, providerCode: 'PR', status: 'ACTIVE' },
  ] as never);
  vi.mocked(prisma.upstream_api_accounts.findMany).mockResolvedValue([
    { id: 'ua-1', tenantId: null, status: 'ACTIVE' },
  ] as never);
});

describe('PricingRepository matrix summary', () => {
  it('summarizes provider resources with lightweight group and count queries', async () => {
    vi.mocked(prisma.platform_resources.groupBy).mockResolvedValue([
      { providerCode: 'IPIPD', _count: { _all: 454 } },
      { providerCode: 'PR', _count: { _all: 113017 } },
    ] as never);
    vi.mocked(prisma.platform_resources.count)
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(9 as never)
      .mockResolvedValueOnce(8 as never)
      .mockResolvedValueOnce(11 as never)
      .mockResolvedValueOnce(12 as never)
      .mockResolvedValueOnce(13 as never);
    const repo = new PricingRepository();

    const result = await repo.listMatrixSummary('site-1', { durationDays: '30', currency: 'CNY' });

    expect(prisma.platform_resources.groupBy).toHaveBeenCalledWith({
      by: ['providerCode'],
      where: {
        siteId: 'site-1',
        type: { not: 'COUNTRY' },
        status: { not: 'DISABLED' },
        AND: [
          {
            OR: [
              { providerCode: 'IPIPD', upstreamAccountId: 'pa-ipipd' },
              { providerCode: 'PR', upstreamAccountId: 'pa-pr' },
              { providerCode: 'UPSTREAM_API', upstreamAccountId: 'ua-1' },
            ],
          },
        ],
      },
      _count: { _all: true },
      orderBy: { providerCode: 'asc' },
    });
    expect(result).toEqual([
      { providerCode: 'IPIPD', total: 454, enabled: 10, synced: 9, priced: 8 },
      { providerCode: 'PR', total: 113017, enabled: 11, synced: 12, priced: 13 },
    ]);
    expect(prisma.platform_resources.count).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        type: { not: 'COUNTRY' },
        status: { not: 'DISABLED' },
        providerCode: 'IPIPD',
        AND: [
          {
            OR: [
              { providerCode: 'IPIPD', upstreamAccountId: 'pa-ipipd' },
              { providerCode: 'PR', upstreamAccountId: 'pa-pr' },
              { providerCode: 'UPSTREAM_API', upstreamAccountId: 'ua-1' },
            ],
          },
        ],
        OR: [
          { price_overrides: { some: { siteId: 'site-1', durationDays: 30, currency: 'CNY' } } },
          {
            price_rules: {
              some: {
                siteId: 'site-1',
                durationDays: 30,
                minQty: { lte: 1 },
                currency: 'CNY',
                template: { tenantId: null, isDefault: true },
              },
            },
          },
        ],
      },
    });
  });
});

describe('PricingRepository matrix list', () => {
  it('can return only concrete non-archived resources for provider configuration', async () => {
    vi.mocked(prisma.platform_resources.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.price_templates.findFirst).mockResolvedValue(null as never);
    const repo = new PricingRepository();

    const result = await repo.listMatrix('site-1', {
      providerCode: 'IPIPD',
      configurableOnly: 'true',
      durationDays: 30,
      currency: 'CNY',
    });

    expect(prisma.platform_resources.count).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        providerCode: 'IPIPD',
        type: { not: 'COUNTRY' },
        status: { not: 'DISABLED' },
        AND: [
          {
            OR: [
              { providerCode: 'IPIPD', upstreamAccountId: 'pa-ipipd' },
            ],
          },
        ],
      },
    });
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        siteId: 'site-1',
        providerCode: 'IPIPD',
        type: { not: 'COUNTRY' },
        status: { not: 'DISABLED' },
        AND: [
          {
            OR: [
              { providerCode: 'IPIPD', upstreamAccountId: 'pa-ipipd' },
            ],
          },
        ],
      },
    }));
    expect(result.items).toEqual([]);
  });

  it('can skip totals and inventory snapshots for background provider setup pages', async () => {
    vi.mocked(prisma.platform_resources.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.price_templates.findFirst).mockResolvedValue(null as never);
    const repo = new PricingRepository();

    const result = await repo.listMatrix('site-1', {
      providerCode: 'IPIPD',
      configurableOnly: 'true',
      includeTotal: 'false',
      withInventory: 'false',
      page: 2,
      pageSize: 20,
      durationDays: 30,
      currency: 'CNY',
    });

    expect(prisma.platform_resources.count).not.toHaveBeenCalled();
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
    }));
    expect(prisma.platform_resources.findMany).toHaveBeenCalledWith(expect.not.objectContaining({
      include: expect.objectContaining({
        inventory_snapshots: expect.anything(),
      }),
    }));
    expect(result).toMatchObject({ page: 2, pageSize: 20, total: 20, items: [] });
  });
});
