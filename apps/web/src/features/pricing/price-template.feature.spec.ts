import { describe, expect, it } from 'vitest';
import { buildPriceRuleBody } from './price-template.feature';

describe('price template contracts', () => {
  it('builds price rule body with backend field names', () => {
    expect(buildPriceRuleBody({
      resourceId: 'resource-1',
      unitPrice: 12.5,
      currency: 'CNY',
      minQty: 2,
    })).toEqual({
      resourceId: 'resource-1',
      durationDays: 30,
      unitPrice: '12.5',
      currency: 'CNY',
      minQty: 2,
    });
  });
});
