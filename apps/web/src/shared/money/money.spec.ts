import { describe, expect, it } from 'vitest';
import { formatMoneyAmount, parseMoneyAmount } from './money';

describe('money helpers', () => {
  it('parses finite numeric amounts', () => {
    expect(parseMoneyAmount('28.5')).toBe(28.5);
    expect(parseMoneyAmount(0)).toBe(0);
    expect(parseMoneyAmount(null)).toBeNull();
    expect(parseMoneyAmount('not-a-number')).toBeNull();
  });

  it('formats numeric amounts with two decimals and currency code', () => {
    expect(formatMoneyAmount('28.5', 'CNY')).toBe('28.50 CNY');
    expect(formatMoneyAmount(7, 'USD')).toBe('7.00 USD');
  });

  it('keeps non-numeric visible values instead of hiding them', () => {
    expect(formatMoneyAmount('pending', 'CNY')).toBe('pending CNY');
    expect(formatMoneyAmount('', 'CNY')).toBeNull();
  });
});
