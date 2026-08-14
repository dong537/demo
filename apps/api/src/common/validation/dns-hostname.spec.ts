import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error';
import { normalizeDnsHostname } from './dns-hostname';

describe('normalizeDnsHostname', () => {
  it('trims and lowercases a valid DNS hostname', () => {
    expect(normalizeDnsHostname('  Web.Example.COM  ', 'domain_invalid')).toBe('web.example.com');
  });

  it.each([
    '',
    'localhost',
    'https://web.example.com',
    'web.example.com:443',
    'web.example.com/path',
    '*.example.com',
    '-web.example.com',
    'web-.example.com',
  ])('rejects invalid hostname %j', (value) => {
    expectReason(() => normalizeDnsHostname(value, 'domain_invalid'), 'domain_invalid');
  });

  it('rejects non-string values', () => {
    expectReason(() => normalizeDnsHostname(42, 'domain_invalid'), 'domain_invalid');
  });
});

function expectReason(fn: () => unknown, reasonKey: string): void {
  try {
    fn();
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).reasonKey).toBe(reasonKey);
  }
}
