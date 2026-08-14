import { describe, expect, it } from 'vitest';
import { selectPriceCandidate } from '../domain';

describe('pricing domain', () => {
  it('selects the first matching candidate by pricing priority', () => {
    const result = selectPriceCandidate(
      [
        { candidates: [], hasCurrencyMismatch: false },
        {
          candidates: [{ unitPrice: '20', currency: 'CNY', source: 'USER_TEMPLATE' }],
          hasCurrencyMismatch: true,
        },
        {
          candidates: [{ unitPrice: '10', currency: 'CNY', source: 'RESOURCE_OVERRIDE' }],
          hasCurrencyMismatch: true,
        },
      ],
      'CNY',
    );

    expect(result).toEqual({ unitPrice: '20', currency: 'CNY', source: 'USER_TEMPLATE' });
  });

  it('does not fall through when a higher-priority candidate has the wrong currency', () => {
    const result = selectPriceCandidate(
      [
        {
          candidates: [{ unitPrice: '20', currency: 'USD', source: 'USER_OVERRIDE' }],
          hasCurrencyMismatch: true,
        },
        {
          candidates: [{ unitPrice: '10', currency: 'CNY', source: 'DEFAULT_TEMPLATE' }],
          hasCurrencyMismatch: true,
        },
      ],
      'CNY',
    );

    expect(result).toBe('CURRENCY_MISMATCH');
  });
});
