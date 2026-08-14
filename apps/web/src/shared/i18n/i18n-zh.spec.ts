import { describe, expect, it } from 'vitest';
import zh from './zh';

describe('zh translations', () => {
  it('keeps admin pricing copy centered on country and region', () => {
    expect(zh.resources.bulkPriceTitle).toBe('按国家和地区定价');
    expect(zh.resources.quickPriceTitle).toBe('国家 / 地区快捷定价');
  });

  it('keeps customer purchase labels plain', () => {
    expect(zh.customer.buy.countryRegion).toBe('国家 / 地区');
  });
});
