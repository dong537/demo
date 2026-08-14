import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { PricingRepository } from './pricing.repository';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    service_skus: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    price_templates: {
      findFirst: vi.fn(),
    },
    sku_price_rules: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    sku_price_overrides: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    user_sku_price_overrides: {
      upsert: vi.fn(),
    },
    users: {
      findFirst: vi.fn(),
    },
  },
}));

describe('PricingRepository dedicated SKU pricing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the global template and site overrides for dedicated SKUs', async () => {
    vi.mocked(prisma.service_skus.findMany).mockResolvedValue([
      { id: 'sku-sv', siteId: 'site-1', code: 'SV', name: 'Short Video', description: null },
      { id: 'sku-zb', siteId: 'site-1', code: 'ZB', name: 'Live Streaming', description: null },
    ] as never);
    vi.mocked(prisma.price_templates.findFirst).mockResolvedValue({ id: 'template-global', name: 'Global', isDefault: true } as never);
    vi.mocked(prisma.sku_price_rules.findMany).mockResolvedValue([
      { id: 'rule-sv', skuId: 'sku-sv', durationDays: 30, minQty: 1, unitPrice: { toString: () => '30' }, currency: 'CNY' },
    ] as never);
    vi.mocked(prisma.sku_price_overrides.findMany).mockResolvedValue([
      { id: 'override-zb', skuId: 'sku-zb', durationDays: 30, minQty: 1, unitPrice: { toString: () => '40' }, currency: 'CNY' },
    ] as never);

    const result = await new PricingRepository().listDedicatedSkuPricing('site-1');

    expect(result).toEqual({
      templateId: 'template-global',
      items: [
        expect.objectContaining({ code: 'SV', templateRules: [expect.objectContaining({ unitPrice: '30' })], globalOverrides: [] }),
        expect.objectContaining({ code: 'ZB', templateRules: [], globalOverrides: [expect.objectContaining({ unitPrice: '40' })] }),
      ],
    });
  });

  it('writes a global SKU override and a user-scoped SKU override through validated seams', async () => {
    vi.mocked(prisma.service_skus.findFirst).mockResolvedValue({ id: 'sku-sv', siteId: 'site-1', code: 'SV', capabilities: { delivery: 'dedicated-line' } } as never);
    vi.mocked(prisma.users.findFirst).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(prisma.sku_price_overrides.upsert).mockResolvedValue({ id: 'override-1' } as never);
    vi.mocked(prisma.user_sku_price_overrides.upsert).mockResolvedValue({ id: 'user-override-1' } as never);

    const repository = new PricingRepository();
    await repository.upsertDedicatedSkuOverride({ siteId: 'site-1', skuId: 'sku-sv', durationDays: 30, minQty: 1, unitPrice: '35', currency: 'CNY' });
    await repository.upsertUserDedicatedSkuOverride({ siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', skuId: 'sku-sv', durationDays: 30, minQty: 1, unitPrice: '25', currency: 'CNY' });

    expect(prisma.sku_price_overrides.upsert).toHaveBeenCalledOnce();
    expect(prisma.user_sku_price_overrides.upsert).toHaveBeenCalledOnce();
  });
});
