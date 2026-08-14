import { describe, expect, it } from 'vitest';
import { CORS_ALLOWED_HEADERS, parseCorsOrigins } from './cors';

describe('cors config', () => {
  it('allows the public host header required by reseller site resolution', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('x-public-host');
  });

  it('parses comma-separated origins without blanks', () => {
    expect(parseCorsOrigins(' https://a.example.com, ,https://b.example.com ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});
