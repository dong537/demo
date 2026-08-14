import { describe, expect, it } from 'vitest';
import {
  assertProviderCredential,
  formatCliError,
  isCliUsageError,
  parseCredentialJson,
  redactSecrets,
} from '../provider-ops.validation';
import { normalizeProviderBaseUrl } from '../provider-base-url';

describe('provider ops CLI validation', () => {
  it('normalizes native provider base urls before storing them', () => {
    expect(normalizeProviderBaseUrl('IPIPD', 'https://api.ipipd.cn/openapi/v2/')).toBe('https://api.ipipd.cn');
    expect(normalizeProviderBaseUrl('IPIPD', 'https://api.sandbox.ipipd.cn/openapi/v2/')).toBe('https://api.sandbox.ipipd.cn');
    expect(normalizeProviderBaseUrl('IPIPD', 'https://api.sandbox.ipipd.cn/api/openapi/v2')).toBe('https://api.sandbox.ipipd.cn');
    expect(normalizeProviderBaseUrl('IPIPD', 'https://sandbox.ipipd.cn/api/openapi/v2')).toBe('https://api.sandbox.ipipd.cn');
    expect(normalizeProviderBaseUrl('NINE_EIGHT_FIVE', 'https://open-api.985proxy.com/res_static/')).toBe('https://open-api.985proxy.com');
    expect(normalizeProviderBaseUrl('PR', 'https://proxy-seller.com/personal/api/v1/plain-key')).toBe('https://proxy-seller.com/personal/api/v1');
  });

  it('accepts and narrows IPIPD credential fields', () => {
    const credential = assertProviderCredential(
      'IPIPD',
      parseCredentialJson('{"appId":" APP ","appSecret":" SECRET ","extra":"ignored"}'),
    );

    expect(credential).toEqual({ appId: 'APP', appSecret: 'SECRET' });
  });

  it('accepts api key or username/password native credentials', () => {
    expect(assertProviderCredential('NINE_EIGHT_FIVE', { apikey: 'key', zoneId: 'zone-1', password: 'ignored' })).toEqual({
      apikey: 'key',
      zoneId: 'zone-1',
    });
    expect(assertProviderCredential('PR', { username: 'user', password: 'pass' })).toEqual({ username: 'user', password: 'pass' });
  });

  it('marks malformed credential JSON as CLI usage error', () => {
    let thrown: unknown;
    try {
      parseCredentialJson('{"apikey":""}');
    } catch (error) {
      thrown = error;
    }

    expect(isCliUsageError(thrown)).toBe(true);
    expect(formatCliError(thrown)).toBe('VALIDATION_ERROR: cli_invalid_argument');
  });

  it('redacts credential-like values from error text', () => {
    expect(redactSecrets('apikey=abc123&password=pw "appSecret":"raw" username=bob token=tok credential=blob')).toBe(
      'apikey=[REDACTED]&password=[REDACTED] "appSecret":"[REDACTED]" username=[REDACTED] token=[REDACTED] credential=[REDACTED]',
    );
  });
});
