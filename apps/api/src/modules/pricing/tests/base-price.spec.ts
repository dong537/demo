import { describe, expect, it } from 'vitest';
import { getBaseStaticProxyPrice, resourceCountryCode } from '../base-price';

describe('base static proxy price', () => {
  it('prices upstream city-line resources by country code', () => {
    expect(resourceCountryCode('US:line-us-ny-recommended')).toBe('US');
    expect(getBaseStaticProxyPrice({
      code: 'US:line-us-ny-recommended',
      providerCode: 'IPIPD',
      durationDays: 30,
      currency: 'CNY',
    })).toEqual({ unitPrice: '39', currency: 'CNY', source: 'DEFAULT_TEMPLATE' });
  });

  it('uses provider base price when a synced country is not in the country table', () => {
    expect(getBaseStaticProxyPrice({
      code: 'ZZ:provider-line',
      providerCode: 'PR',
      durationDays: 30,
      currency: 'CNY',
    })).toEqual({ unitPrice: '39', currency: 'CNY', source: 'DEFAULT_TEMPLATE' });
  });

  it('does not quote unsupported currency through the base price rule', () => {
    expect(getBaseStaticProxyPrice({
      code: 'SG',
      providerCode: 'PR',
      durationDays: 30,
      currency: 'USD',
    })).toBeNull();
  });
});
