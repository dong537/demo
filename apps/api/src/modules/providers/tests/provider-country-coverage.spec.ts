import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { IpipdAdapter } from '../adapters/ipipd.adapter';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import { PrAdapter } from '../adapters/pr.adapter';
import { providerCountryCodes } from '../provider-country-coverage';
import { ProviderRuntimeConfig } from '../provider.types';

describe('provider country coverage', () => {
  const originalSocksUrl = process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL'];

  beforeEach(() => {
    delete process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSocksUrl === undefined) {
      delete process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL'];
    } else {
      process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL'] = originalSocksUrl;
    }
  });

  it('keeps native provider default coverage aligned with the operator saleable product pool', () => {
    expect(providerCountryCodes('PR')).toEqual(['SG', 'TH', 'PL', 'BR', 'TR', 'IL', 'NL', 'IN', 'CA', 'AT', 'RO', 'LV', 'UA']);
    expect(providerCountryCodes('IPIPD')).toEqual(['GB', 'FR', 'DE', 'IT', 'ES', 'JP', 'VN', 'KR', 'AE', 'ZA']);
    expect(providerCountryCodes('NINE_EIGHT_FIVE')).toEqual(['TW', 'PH', 'MY', 'AU', 'HK']);
  });

  it('keeps every Proxy-Seller inventory country that can be normalized', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ code: 'SG', count: 12 }, { code: 'HK', count: 99 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig('PR'));

    expect(result.items.map((item) => item.countryCode)).toEqual(['SG', 'HK']);
    expect(result.items.every((item) => item.upstreamCost === 1.99 && item.upstreamCostCurrency === 'USD')).toBe(true);
  });

  it('keeps every IPIPD inventory country that can be normalized', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {
            size: 200,
            current: 0,
            total: 2,
            offset: 0,
            records: [
              { id: 'line-gb', countryCode: 'GBR', active: true, quantity: 5, cityCode: 'LON', businessTypeCode: 'WEB' },
              { id: 'line-jp', countryCode: 'JPN', active: true, status: 0, quantity: 99 },
            ],
          },
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      ),
    );

    const result = await new IpipdAdapter().syncInventory(runtimeConfig('IPIPD'));

    expect(result.items.map((item) => item.countryCode)).toEqual(['GB', 'JP']);
    expect(result.items.map((item) => item.countryName)).toEqual(['United Kingdom', 'Japan']);
    expect(result.items.map((item) => item.stock)).toEqual([5, 99]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.ipipd.cn/openapi/v2/static/lines');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ current: 0, size: 200 });
  });

  it('reports IPIPD authentication failures as a credential problem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }));

    const result = await new IpipdAdapter().healthCheck(runtimeConfig('IPIPD'));

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('upstream_auth_failed');
  });

  it('maps the legacy IPIPD sandbox host to the official sandbox API host', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.sandbox.ipipd.cn/openapi/v2/account');
      const headers = init?.headers as Record<string, string>;
      const signed = `GET/openapi/v2/account${headers['X-API-Timestamp']}${headers['X-API-Nonce']}`;
      expect(headers['X-API-Signature']).toBe(createHmac('sha256', 'test-app-secret').update(signed).digest('hex'));
      return new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {},
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      );
    });

    const result = await new IpipdAdapter().healthCheck({
      ...runtimeConfig('IPIPD'),
      baseUrl: 'https://sandbox.ipipd.cn/',
    });

    expect(result.healthy).toBe(true);
  });

  it('does not duplicate the IPIPD API prefix when an older base URL already includes it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {},
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      ),
    );

    await new IpipdAdapter().healthCheck({
      ...runtimeConfig('IPIPD'),
      baseUrl: 'https://api.ipipd.cn/openapi/v2/',
    });
    await new IpipdAdapter().healthCheck({
      ...runtimeConfig('IPIPD'),
      baseUrl: 'https://sandbox.ipipd.cn/openapi/v2/',
    });
    await new IpipdAdapter().healthCheck({
      ...runtimeConfig('IPIPD'),
      baseUrl: 'https://sandbox.ipipd.cn/api/openapi/v2/',
    });

    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      'https://api.ipipd.cn/openapi/v2/account',
      'https://api.sandbox.ipipd.cn/openapi/v2/account',
      'https://api.sandbox.ipipd.cn/openapi/v2/account',
    ]);
  });

  it('uses the official IPIPD sandbox host without the legacy API mount', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.sandbox.ipipd.cn/openapi/v2/account');
      const headers = init?.headers as Record<string, string>;
      const signed = `GET/openapi/v2/account${headers['X-API-Timestamp']}${headers['X-API-Nonce']}`;
      expect(headers['X-API-Signature']).toBe(createHmac('sha256', 'test-app-secret').update(signed).digest('hex'));
      return new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {},
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      );
    });

    await new IpipdAdapter().healthCheck({
      ...runtimeConfig('IPIPD'),
      baseUrl: 'https://api.sandbox.ipipd.cn/api/openapi/v2/',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('expands IPIPD static line cidrs into network-level inventory items', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {
            size: 200,
            current: 0,
            total: 1,
            offset: 0,
            records: [
              {
                id: 'line-sg-1',
                countryCode: 'SGP',
                active: true,
                status: 0,
                quantity: 1506,
                cityCode: 'SGPSINSIN',
                tag: 'RECOMMENDED',
                businessTypeCode: 'shopee',
                price: 50,
                currency: 'CNY',
                cidrs: [
                  { cidr: '192.168.104.0/24', availableCount: 248 },
                  { cidr: '192.168.105.0/24', availableCount: 0 },
                ],
              },
            ],
          },
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      ),
    );

    const result = await new IpipdAdapter().syncInventory(runtimeConfig('IPIPD'));

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => [item.providerResourceId, item.networkCidr, item.stock])).toEqual([
      ['line-sg-1|cidr=192.168.104.0%2F24', '192.168.104.0/24', 248],
      ['line-sg-1|cidr=192.168.105.0%2F24', '192.168.105.0/24', 0],
    ]);
    expect(result.items[0]).toMatchObject({
      countryCode: 'SG',
      regionCode: 'SGPSINSIN RECOMMENDED shopee',
      upstreamCost: 50,
      upstreamCostCurrency: 'CNY',
    });
  });

  it('paginates IPIPD static inventory until the upstream page is exhausted', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `line-gb-${index + 1}`,
      countryCode: 'GBR',
      active: true,
      status: 0,
      quantity: index + 1,
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            code: 'SUCCESS',
            message: 'ok',
            data: {
              size: 200,
              current: 0,
              total: 201,
              offset: 0,
              records: firstPage,
            },
            timestamp: '2026-06-10T00:00:00Z',
            traceId: 'test',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            code: 'SUCCESS',
            message: 'ok',
            data: {
              size: 200,
              current: 1,
              total: 201,
              offset: 200,
              records: [
                { id: 'line-jp', countryCode: 'JP', active: true, status: 0, quantity: 9 },
              ],
            },
            timestamp: '2026-06-10T00:00:00Z',
            traceId: 'test',
          }),
          { status: 200 },
        ),
      );

    const result = await new IpipdAdapter().syncInventory(runtimeConfig('IPIPD'));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(201);
    expect(result.items[0]?.countryCode).toBe('GB');
    expect(result.items[200]?.countryCode).toBe('JP');
  });

  it('queries IPIPD orders with zero-based pagination', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {
            size: 10,
            current: 0,
            total: 1,
            offset: 0,
            records: [
              {
                orderNo: 'ORD-1',
                status: 3,
                instances: [
                  {
                    proxyId: 'proxy-1',
                    ip: '203.0.113.10',
                    port: 8000,
                    username: 'user',
                    password: 'pass',
                    countryCode: 'JPN',
                    expiresAt: '4102444800000',
                  },
                ],
              },
            ],
          },
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      ),
    );

    const result = await new IpipdAdapter().queryOrder({ upstreamOrderId: 'ORD-1' }, runtimeConfig('IPIPD'));

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.ipipd.cn/openapi/v2/static/orders');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ orderNo: 'ORD-1', current: 0, size: 10 });
    expect(result.upstreamOrderId).toBe('ORD-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.proxies[0]).toMatchObject({
      upstreamProxyId: 'proxy-1',
      countryCode: 'JP',
    });
  });

  it('maps IPIPD returned/refunded order statuses as failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          code: 'SUCCESS',
          message: 'ok',
          data: {
            size: 10,
            current: 0,
            total: 1,
            offset: 0,
            records: [{ orderNo: 'ORD-REFUNDED', status: 6 }],
          },
          timestamp: '2026-06-10T00:00:00Z',
          traceId: 'test',
        }),
        { status: 200 },
      ),
    );

    const result = await new IpipdAdapter().queryOrder({ upstreamOrderId: 'ORD-REFUNDED' }, runtimeConfig('IPIPD'));

    expect(result.status).toBe('FAILED');
  });

  it('keeps every 985Proxy inventory country that can be normalized', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: [{ country_code: 'ID', stock: 3 }, { country_code: 'HK', stock: 99 }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));

    const result = await new NineEightFiveAdapter().syncInventory(runtimeConfig('NINE_EIGHT_FIVE'));

    expect(result.items.map((item) => item.countryCode)).toEqual(['ID', 'HK']);
    expect(result.items[0]?.providerResourceId).toBe('ID:shared');
  });
});

function runtimeConfig(code: 'IPIPD' | 'NINE_EIGHT_FIVE' | 'PR'): ProviderRuntimeConfig {
  return {
    code,
    status: 'ACTIVE',
    baseUrl: code === 'IPIPD' ? 'https://api.ipipd.cn' : code === 'NINE_EIGHT_FIVE' ? 'https://open-api.985proxy.com' : 'https://proxy-seller.com/personal/api/v1',
    timeoutMs: 100,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: code === 'IPIPD' ? { appId: 'test-app-id', appSecret: 'test-app-secret' } : { apikey: 'test-api-key' },
  };
}

function residentReference(id: string): Record<string, unknown> {
  return {
    status: 'success',
    data: {
      items: {
        tarifs: [{ id, name: '500 Mb', personal: false }],
        target: [],
      },
    },
    errors: [],
  };
}

function residentCalc(price: string | number, currency: string): Record<string, unknown> {
  return {
    status: 'success',
    data: {
      warning: '',
      balance: 4.42,
      total: price,
      quantity: 1,
      currency,
      discount: 0,
      price,
    },
    errors: [],
  };
}
