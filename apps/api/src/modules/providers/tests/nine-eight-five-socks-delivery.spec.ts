import { describe, expect, it, vi } from 'vitest';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import type { ProviderRuntimeConfig, StaticProxyBuyInput } from '../provider.types';

describe('NineEightFiveAdapter SOCKS5 delivery', () => {
  it('keeps the requested SOCKS5 protocol and prefers port_socks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        msg: 'success',
        data: {
          order_no: 'upstream-1',
          proxy_list: [{
            ip: '203.0.113.9',
            port: 7000,
            port_socks: 1080,
            username: 'line-user',
            password: 'line-pass',
            country: 'HK',
            expire_time: '2100-01-01T00:00:00.000Z',
          }],
        },
      }),
    }));

    const result = await new NineEightFiveAdapter().buyStaticProxy(input(), config());

    expect(result.proxies[0]).toMatchObject({ protocol: 'SOCKS5', port: 1080, countryCode: 'HK' });
    vi.unstubAllGlobals();
  });

  it('uses the requested country when the order result omits zone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        msg: 'success',
        data: {
          status: 'pending',
          proxy_list: [{
            ip: '203.0.113.10',
            port: 1081,
            username: 'u',
            password: 'p',
            expire_time: '2100-01-01T00:00:00.000Z',
          }],
        },
      }),
    }));

    const result = await new NineEightFiveAdapter().queryOrder(
      { upstreamOrderId: 'upstream-2', protocol: 'SOCKS5', countryCode: 'HK' },
      config(),
    );

    expect(result.proxies[0]?.countryCode).toBe('HK');
    vi.unstubAllGlobals();
  });
});

function input(): StaticProxyBuyInput {
  return {
    countryCode: 'HK',
    quantity: 1,
    durationDays: 30,
    ipType: 'NATIVE',
    protocol: 'SOCKS5',
    currency: 'CNY',
    providerResourceId: 'HK:premium',
    idempotencyKey: 'order-key',
  };
}

function config(): ProviderRuntimeConfig {
  return {
    code: 'NINE_EIGHT_FIVE',
    status: 'ACTIVE',
    baseUrl: 'https://open-api.985proxy.com',
    timeoutMs: 1_000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: { apikey: 'test-key' },
  };
}
