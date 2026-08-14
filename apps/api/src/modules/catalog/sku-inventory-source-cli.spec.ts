import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  skuFindUnique: vi.fn(),
  skuUpsert: vi.fn(),
  skuUpdateMany: vi.fn(),
  transaction: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@ipeasy/db', () => ({
  prisma: {
    service_skus: {
      findUnique: db.skuFindUnique,
      upsert: db.skuUpsert,
      updateMany: db.skuUpdateMany,
    },
    $transaction: db.transaction,
    $disconnect: db.disconnect,
  },
}));

import { seedLineSkus, setLineSkuInventorySource } from './sku-inventory-source.service';

beforeEach(() => {
  vi.clearAllMocks();
  db.skuFindUnique.mockResolvedValue(null);
  db.skuUpdateMany.mockResolvedValue({ count: 1 });
  db.transaction.mockImplementation(async (callback) => callback({
    service_skus: {
      findUnique: db.skuFindUnique,
      upsert: db.skuUpsert,
      updateMany: db.skuUpdateMany,
    },
  }));
});

describe('dedicated-line SKU inventory source service', () => {
  it('seeds SV and ZB without inventing a provider mapping', async () => {
    await expect(seedLineSkus('site-1')).resolves.toEqual({ upserted: 2, codes: ['SV', 'ZB'] });

    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(db.skuUpsert).toHaveBeenCalledTimes(2);
    for (const [args] of db.skuUpsert.mock.calls) {
      expect(args.create.capabilities).not.toHaveProperty('inventorySource');
      expect(args.update.capabilities).not.toHaveProperty('inventorySource');
    }
  });

  it('applies one explicit real mapping to both default SKUs', async () => {
    await seedLineSkus('site-1', {
      providerCode: 'NINE_EIGHT_FIVE',
      providerResourceIds: ['HK:premium', 'TW:premium'],
    });

    expect(db.skuUpsert).toHaveBeenCalledTimes(2);
    for (const [args] of db.skuUpsert.mock.calls) {
      expect(args.create.capabilities.inventorySource).toEqual({
        providerCode: 'NINE_EIGHT_FIVE',
        providerResourceIds: ['HK:premium', 'TW:premium'],
      });
    }
  });

  it('preserves a valid configured mapping when reseeding defaults', async () => {
    db.skuFindUnique.mockResolvedValue({
      capabilities: {
        delivery: 'dedicated-line',
        customPolicy: { mode: 'strict' },
        inventorySource: { providerCode: 'PR', providerResourceIds: ['SG:6928'] },
      },
    });

    await seedLineSkus('site-1');

    expect(db.skuUpsert.mock.calls[0]?.[0]?.update.capabilities.inventorySource).toEqual({
      providerCode: 'PR', providerResourceIds: ['SG:6928'],
    });
    expect(db.skuUpsert.mock.calls[0]?.[0]?.update.capabilities.customPolicy).toEqual({ mode: 'strict' });
  });

  it('fails the whole reseed transaction when a later existing mapping is incomplete', async () => {
    db.skuFindUnique
      .mockResolvedValueOnce({ capabilities: { delivery: 'dedicated-line' } })
      .mockResolvedValueOnce({
        capabilities: { delivery: 'dedicated-line', inventorySource: { providerCode: 'PR' } },
      });

    await expect(seedLineSkus('site-1')).rejects.toThrow('inventory_source_incomplete');
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('fails visibly when the target SKU does not exist', async () => {
    await expect(setLineSkuInventorySource({
      siteId: 'site-1', code: 'SV', providerCode: 'PR', providerResourceIds: ['SG:6928'],
    })).rejects.toThrow('SKU not found: SV');
    expect(db.skuUpdateMany).not.toHaveBeenCalled();
  });

  it('sets one SKU mapping while preserving its other capabilities', async () => {
    db.skuFindUnique.mockResolvedValueOnce({
      id: 'sku-sv',
      capabilities: { delivery: 'dedicated-line', supportsMultiNodePlacement: true },
    });

    await expect(setLineSkuInventorySource({
      siteId: 'site-1', code: 'SV', providerCode: ' pr ', providerResourceIds: [' SG:6928 ', 'SG:6928'],
    })).resolves.toEqual({ updated: true });

    expect(db.skuUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sku-sv',
        capabilities: { equals: { delivery: 'dedicated-line', supportsMultiNodePlacement: true } },
      },
      data: {
        capabilities: {
          delivery: 'dedicated-line',
          supportsMultiNodePlacement: true,
          inventorySource: { providerCode: 'PR', providerResourceIds: ['SG:6928'] },
        },
      },
    });
  });

  it('does not attach an inventory source to a non-dedicated SKU', async () => {
    db.skuFindUnique.mockResolvedValueOnce({ id: 'sku-static', capabilities: { delivery: 'static-proxy' } });

    await expect(setLineSkuInventorySource({
      siteId: 'site-1', code: 'STATIC', providerCode: 'PR', providerResourceIds: ['SG:6928'],
    })).rejects.toThrow('sku_not_dedicated_line');
    expect(db.skuUpdateMany).not.toHaveBeenCalled();
  });

  it('does not rewrite an identical mapping', async () => {
    db.skuFindUnique.mockResolvedValueOnce({
      id: 'sku-sv',
      capabilities: {
        delivery: 'dedicated-line',
        inventorySource: { providerCode: 'PR', providerResourceIds: ['SG:6928'] },
      },
    });

    await expect(setLineSkuInventorySource({
      siteId: 'site-1', code: 'SV', providerCode: 'PR', providerResourceIds: ['SG:6928'],
    })).resolves.toEqual({ updated: false });
    expect(db.skuUpdateMany).not.toHaveBeenCalled();
  });

  it('fails instead of overwriting capabilities changed by another writer', async () => {
    db.skuFindUnique.mockResolvedValueOnce({
      id: 'sku-sv',
      capabilities: { delivery: 'dedicated-line', supportsMultiNodePlacement: true },
    });
    db.skuUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(setLineSkuInventorySource({
      siteId: 'site-1', code: 'SV', providerCode: 'PR', providerResourceIds: ['SG:6928'],
    })).rejects.toThrow('sku_capabilities_changed');
  });

  it('supports independent mappings for SV and ZB', async () => {
    db.skuFindUnique
      .mockResolvedValueOnce({ id: 'sku-sv', capabilities: { delivery: 'dedicated-line' } })
      .mockResolvedValueOnce({ id: 'sku-zb', capabilities: { delivery: 'dedicated-line' } });

    await setLineSkuInventorySource({
      siteId: 'site-1', code: 'SV', providerCode: 'PR', providerResourceIds: ['SG:6928'],
    });
    await setLineSkuInventorySource({
      siteId: 'site-1', code: 'ZB', providerCode: 'IPIPD', providerResourceIds: ['zb-1'],
    });

    expect(db.skuUpdateMany.mock.calls[0]?.[0]?.data.capabilities.inventorySource).toEqual({
      providerCode: 'PR', providerResourceIds: ['SG:6928'],
    });
    expect(db.skuUpdateMany.mock.calls[1]?.[0]?.data.capabilities.inventorySource).toEqual({
      providerCode: 'IPIPD', providerResourceIds: ['zb-1'],
    });
  });
});
