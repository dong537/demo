import { describe, expect, it } from 'vitest';
import { getProviderResourceSaleability } from './provider-saleability-policy';

describe('managed provider resource saleability policy', () => {
  it('does not hard-limit Proxy-Seller countries in the saleability policy', () => {
    expect(getProviderResourceSaleability({ providerCode: 'PR', code: 'SG:6928' })).toMatchObject({
      managed: true,
      countryCode: 'SG',
      saleable: true,
      reason: null,
    });
    expect(getProviderResourceSaleability({ providerCode: 'PR', code: 'HK:6928' })).toMatchObject({
      managed: true,
      countryCode: 'HK',
      saleable: true,
      reason: null,
    });
  });

  it('does not require an IPIPD recommended marker or fixed country list', () => {
    expect(getProviderResourceSaleability({
      providerCode: 'IPIPD',
      code: 'GB:line-london-standard',
      name: 'United Kingdom London Standard',
    })).toMatchObject({
      managed: true,
      countryCode: 'GB',
      saleable: true,
      reason: null,
    });
    expect(getProviderResourceSaleability({
      providerCode: 'IPIPD',
      code: 'SG:1502372021504507904|cidr=203.0.113.0/24',
      name: 'Singapore',
      providerResourceId: '1502372021504507904|cidr=203.0.113.0/24',
    })).toMatchObject({
      managed: true,
      countryCode: 'SG',
      saleable: true,
      reason: null,
    });
    expect(getProviderResourceSaleability({
      providerCode: 'IPIPD',
      code: 'HK:line-hk',
      name: 'Hong Kong',
    })).toMatchObject({
      managed: true,
      countryCode: 'HK',
      saleable: true,
      reason: null,
    });
  });

  it('does not hard-limit 985Proxy countries in the saleability policy', () => {
    expect(getProviderResourceSaleability({ providerCode: 'NINE_EIGHT_FIVE', code: 'TW:shared' })).toMatchObject({
      managed: true,
      countryCode: 'TW',
      saleable: true,
      reason: null,
    });
    expect(getProviderResourceSaleability({ providerCode: 'NINE_EIGHT_FIVE', code: 'HK:shared' })).toMatchObject({
      managed: true,
      countryCode: 'HK',
      saleable: true,
      reason: null,
    });
    expect(getProviderResourceSaleability({ providerCode: 'NINE_EIGHT_FIVE', code: 'ID:shared' })).toMatchObject({
      managed: true,
      countryCode: 'ID',
      saleable: true,
      reason: null,
    });
  });

  it('does not manage non-native upstream API resources', () => {
    expect(getProviderResourceSaleability({ providerCode: 'UPSTREAM_API', code: 'US:line' })).toMatchObject({
      managed: false,
      countryCode: 'US',
      saleable: true,
      reason: null,
    });
  });
});
