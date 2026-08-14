import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_NAME, formatBrandName, resolveBrandName } from './brand-display';

describe('brand display', () => {
  it('normalizes the legacy public brand name for display only', () => {
    expect(formatBrandName('IPIPD')).toBe('ipmigo');
    expect(formatBrandName('IPIPD 管理端')).toBe('ipmigo 管理端');
    expect(formatBrandName('Custom Brand')).toBe('Custom Brand');
  });

  it('resolves the first usable display brand with the ipmigo fallback', () => {
    expect(resolveBrandName([undefined, '  ', 'IPIPD'])).toBe('ipmigo');
    expect(resolveBrandName([])).toBe(DEFAULT_BRAND_NAME);
  });
});
