import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_SKUS } from './sku-seed';

describe('default line SKU seed', () => {
  it('defines the first dedicated-line catalog as extensible SV and ZB contracts', () => {
    expect(DEFAULT_LINE_SKUS.map((sku) => sku.code)).toEqual(['SV', 'ZB']);
    expect(new Set(DEFAULT_LINE_SKUS.map((sku) => sku.code)).size).toBe(DEFAULT_LINE_SKUS.length);
    for (const sku of DEFAULT_LINE_SKUS) {
      expect(sku.isActive).toBe(true);
      expect(sku.isVisible).toBe(true);
      expect(sku.contractVersion).toBe(1);
      expect(sku.capabilities).toMatchObject({ delivery: 'dedicated-line' });
      expect(sku.capabilities).not.toHaveProperty('inventorySource');
    }
  });
});
