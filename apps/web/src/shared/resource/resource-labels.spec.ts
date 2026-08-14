import { describe, expect, it } from 'vitest';
import { formatRegionNameEn, formatRegionNameZh, formatResourceLocationEn, formatResourceLocationZh } from './resource-labels';

describe('resource labels', () => {
  it('keeps plain country products at country level in zh and en', () => {
    const zhCountry = formatRegionNameZh({ countryCode: 'US' });
    const enCountry = formatRegionNameEn({ countryCode: 'US' });

    expect(formatResourceLocationZh({ code: 'US_STATIC', countryCode: 'US', name: 'US Static' })).toMatchObject({
      country: zhCountry,
      city: null,
      line: null,
      detail: null,
      title: zhCountry,
    });

    expect(formatResourceLocationZh({ code: 'US', countryCode: 'US', displayName: 'US Static' })).toMatchObject({
      country: zhCountry,
      city: null,
      line: null,
      detail: null,
      title: zhCountry,
    });

    expect(formatResourceLocationEn({ code: 'US_STATIC', countryCode: 'US', name: 'US Static' })).toMatchObject({
      country: enCountry,
      city: null,
      line: null,
      detail: null,
      title: enCountry,
    });

    expect(formatResourceLocationEn({ code: 'US', countryCode: 'US', displayName: 'US Static' })).toMatchObject({
      country: enCountry,
      city: null,
      line: null,
      detail: null,
      title: enCountry,
    });
  });
});
