import { afterEach, describe, expect, it, vi } from 'vitest';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import { ProviderRuntimeConfig } from '../provider.types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NineEightFiveAdapter inventory cost sync', () => {
  it('checks connectivity through the inventory endpoint instead of the purchased IP list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));

    const result = await new NineEightFiveAdapter().healthCheck(runtimeConfig());

    expect(result).toMatchObject({ healthy: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://open-api.985proxy.com/res_static/inventory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ static_proxy_type: 'premium' }),
      }),
    );
  });

  it('uses the provider account zone when probing and syncing inventory', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));
    const config = runtimeConfig({ zoneId: 'zone-a' });

    await new NineEightFiveAdapter().healthCheck(config);
    await new NineEightFiveAdapter().syncInventory(config);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://open-api.985proxy.com/res_static/inventory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ static_proxy_type: 'premium', zone: 'zone-a' }),
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://open-api.985proxy.com/res_static/inventory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ static_proxy_type: 'shared', zone: 'zone-a' }),
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://open-api.985proxy.com/res_static/inventory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ static_proxy_type: 'premium', zone: 'zone-a' }),
      }),
    );
  });

  it('does not duplicate res_static when an older base URL already includes it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));

    await new NineEightFiveAdapter().healthCheck({
      ...runtimeConfig(),
      baseUrl: 'https://open-api.985proxy.com/res_static/',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://open-api.985proxy.com/res_static/inventory',
      expect.objectContaining({ method: 'POST' }),
    );
  });


  it('uses the upstream inventory price as the resource cost', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: [
          { country_code: 'TW', stock: 3, price: 1.34 },
          { country_code: 'PH', stock: 4, price: '2.35' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));

    const result = await new NineEightFiveAdapter().syncInventory(runtimeConfig());

    expect(result.items).toEqual([
      expect.objectContaining({
        countryCode: 'TW',
        providerResourceId: 'TW:shared',
        stock: 3,
        upstreamCost: 1.34,
        upstreamCostCurrency: 'CNY',
      }),
      expect.objectContaining({
        countryCode: 'PH',
        providerResourceId: 'PH:shared',
        stock: 4,
        upstreamCost: 2.35,
        upstreamCostCurrency: 'CNY',
      }),
    ]);
  });

  it('returns null cost when the current upstream inventory response has no price', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: [{ country_code: 'AU', stock: 8 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: [] }), { status: 200 }));

    const result = await new NineEightFiveAdapter().syncInventory(runtimeConfig());

    expect(result.items[0]).toMatchObject({
      countryCode: 'AU',
      providerResourceId: 'AU:shared',
      stock: 8,
      upstreamCost: null,
      upstreamCostCurrency: 'CNY',
    });
  });
});

function runtimeConfig(credential: Record<string, string> = { apikey: 'plain-api-key' }): ProviderRuntimeConfig {
  return {
    code: 'NINE_EIGHT_FIVE',
    status: 'ACTIVE',
    baseUrl: 'https://open-api.985proxy.com',
    timeoutMs: 1000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential,
  };
}
