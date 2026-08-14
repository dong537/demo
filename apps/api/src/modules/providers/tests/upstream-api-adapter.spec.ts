import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { UpstreamApiAdapter } from '../adapters/upstream-api.adapter';
import { ProviderRuntimeConfig } from '../provider.types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UpstreamApiAdapter 985-compatible envelope parsing', () => {
  it('preserves business error codes from non-2xx res_static envelopes', async () => {
    const adapter = new UpstreamApiAdapter();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'PRICE_MISSING', msg: 'no_price_rule', data: null }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(adapter.syncInventory(runtimeConfig())).rejects.toMatchObject({
      code: ErrorCode.PRICE_MISSING,
      message: 'no_price_rule',
    } satisfies Partial<AppError>);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://upstream.example.com/res_static/inventory');
  });

  it('treats a logical res_static failure in healthCheck as unhealthy even when HTTP is 200', async () => {
    const adapter = new UpstreamApiAdapter();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'PRICE_MISSING', msg: 'no_price_rule', data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await adapter.healthCheck(runtimeConfig());

    expect(result).toMatchObject({
      healthy: false,
      error: 'price_missing',
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://upstream.example.com/res_static/ip_list');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      status: 1,
      page: 1,
      page_size: 1,
    });
  });

  it('syncs inventory from res_static inventory records', async () => {
    const adapter = new UpstreamApiAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'success',
          data: [
            {
              resource_id: 'RS_123e4567e89b42d3a456426614174000',
              area_code: 'HK',
              area_name: 'Hong Kong',
              stock: 12,
              ip_type: 'NATIVE',
              protocol: 'BOTH',
              price: '8.8',
              currency: 'USD',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await adapter.syncInventory(runtimeConfig());

    expect(result.items).toEqual([
      {
        countryCode: 'HK',
        countryName: 'Hong Kong',
        stock: 12,
        ipType: 'NATIVE',
        protocol: 'BOTH',
        providerResourceId: 'RS_123e4567e89b42d3a456426614174000',
        upstreamCost: 8.8,
        upstreamCostCurrency: 'USD',
      },
    ]);
  });

  it('normalizes nested inventory records with compound area codes and lowercase fields', async () => {
    const adapter = new UpstreamApiAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            records: [
              {
                area_code: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
                area_name: 'Ontario - Woodstock - Comwave Telecom',
                country_name: 'Canada',
                stock: '12',
                ip_type: 'native',
                protocol: 'both',
                cost: ' 8.80 ',
                cost_currency: 'usd',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await adapter.syncInventory(runtimeConfig());

    expect(result.items).toEqual([
      {
        countryCode: 'CA',
        countryName: 'Canada',
        regionCode: 'Ontario - Woodstock - Comwave Telecom',
        stock: 12,
        ipType: 'NATIVE',
        protocol: 'BOTH',
        providerResourceId: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
        upstreamCost: 8.8,
        upstreamCostCurrency: 'USD',
      },
    ]);
  });

  it('maps buy responses from order_no and proxy_list', async () => {
    const adapter = new UpstreamApiAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            order_no: 'ORD_123e4567e89b42d3a456426614174000',
            status: 'COMPLETED',
            proxy_list: [
              {
                proxy_id: 'IP_upstream_proxy_1',
                ip: '203.0.113.10',
                port: 8000,
                username: 'u',
                password: 'p',
                protocol: 'HTTP',
                expire_time: '2026-07-08T00:00:00.000Z',
                country_code: 'HK',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await adapter.buyStaticProxy(
      {
        countryCode: 'HK',
        quantity: 1,
        durationDays: 30,
        currency: 'CNY',
        ipType: 'NATIVE',
        protocol: 'HTTP',
        providerResourceId: 'RS_123e4567e89b42d3a456426614174000',
        idempotencyKey: 'fixed-key',
      },
      runtimeConfig(),
    );

    expect(result).toEqual({
      upstreamOrderId: 'ORD_123e4567e89b42d3a456426614174000',
      status: 'COMPLETED',
      proxies: [
        {
          upstreamProxyId: 'IP_upstream_proxy_1',
          ip: '203.0.113.10',
          port: 8000,
          username: 'u',
          password: 'p',
          protocol: 'HTTP',
          expiresAt: new Date('2026-07-08T00:00:00.000Z'),
          countryCode: 'HK',
        },
      ],
      failReason: undefined,
    });
  });

  it('forwards renew requests to the upstream res_static API', async () => {
    const adapter = new UpstreamApiAdapter();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'success', data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(adapter.renewStaticProxy!(
      { upstreamProxyId: 'IP_upstream_proxy_1', durationDays: 30, idempotencyKey: 'renew-key' },
      runtimeConfig(),
    )).resolves.toEqual({});

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://upstream.example.com/res_static/renew');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      proxy_id: 'IP_upstream_proxy_1',
      duration_days: 30,
      idempotency_key: 'renew-key',
    });
  });

  it('preserves business error codes from lifecycle envelopes', async () => {
    const adapter = new UpstreamApiAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNSUPPORTED_CAPABILITY', msg: 'switch_ip_not_supported', data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(adapter.switchProxyIp!(
      { upstreamProxyId: 'IP_upstream_proxy_1' },
      runtimeConfig(),
    )).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_CAPABILITY,
      message: 'switch_ip_not_supported',
    } satisfies Partial<AppError>);
  });

  it('returns changed proxy details from change_auth responses', async () => {
    const adapter = new UpstreamApiAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            proxy: {
              proxy_id: 'IP_upstream_proxy_1',
              ip: '203.0.113.10',
              port: 8000,
              username: 'u2',
              password: 'p2',
              protocol: 'HTTP',
              expire_time: '2026-07-08T00:00:00.000Z',
              country_code: 'HK',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(adapter.changeProxyPassword!(
      { upstreamProxyId: 'IP_upstream_proxy_1' },
      runtimeConfig(),
    )).resolves.toEqual({
      proxy: {
        upstreamProxyId: 'IP_upstream_proxy_1',
        ip: '203.0.113.10',
        port: 8000,
        username: 'u2',
        password: 'p2',
        protocol: 'HTTP',
        expiresAt: new Date('2026-07-08T00:00:00.000Z'),
        countryCode: 'HK',
      },
    });
  });

  it('returns switched proxy details from switch_ip responses', async () => {
    const adapter = new UpstreamApiAdapter();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            proxy_list: [
              {
                proxy_id: 'IP_upstream_proxy_2',
                ip: '203.0.113.20',
                port: 8001,
                username: 'u3',
                password: 'p3',
                protocol: 'SOCKS5',
                expire_time: '2026-07-09T00:00:00.000Z',
                country_code: 'HK',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(adapter.switchProxyIp!(
      { upstreamProxyId: 'IP_upstream_proxy_1' },
      runtimeConfig(),
    )).resolves.toEqual({
      proxy: {
        upstreamProxyId: 'IP_upstream_proxy_2',
        ip: '203.0.113.20',
        port: 8001,
        username: 'u3',
        password: 'p3',
        protocol: 'SOCKS5',
        expiresAt: new Date('2026-07-09T00:00:00.000Z'),
        countryCode: 'HK',
      },
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://upstream.example.com/res_static/switch_ip');
  });
});

function runtimeConfig(): ProviderRuntimeConfig {
  return {
    code: 'UPSTREAM_API',
    status: 'ACTIVE',
    siteId: 'site-upstream-api',
    upstreamAccountId: 'upstream-api-account',
    baseUrl: 'https://upstream.example.com',
    timeoutMs: 1000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: { apiKey: 'plain-key' },
  };
}
