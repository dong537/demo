import { afterEach, describe, expect, it, vi } from 'vitest';
import { FederatedUpstreamAdapter } from './federated-upstream.adapter';
import { ProviderRegistryService } from '../providers/provider-registry.service';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FederatedUpstreamAdapter', () => {
  it('scans real normalized wallet, inventory, and 30-day prices from a 365 platform', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/wallet')) return response({ data: { available: '88.5', currency: 'CNY' } });
      if (url.includes('/inventory')) return response({ data: [{ sku: { code: 'SV' }, countryCode: 'HK', availableQuantity: 5 }] });
      if (url.includes('/skus')) return response({ data: [{ code: 'SV', name: 'Short Video' }] });
      if (url.includes('/quote')) return response({ data: { unitPrice: '28', currency: 'CNY' } });
      return response({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FederatedUpstreamAdapter({} as ProviderRegistryService);

    const result = await adapter.scan({
      kind: 'PLATFORM_365',
      baseUrl: 'https://upstream.example.com',
      credentials: { apiKey: 'secret' },
      timeoutMs: 5000,
      siteId: 'site-1',
    });

    expect(result.balanceAmount).toBe('88.5');
    expect(result.balanceUnit).toBe('CNY');
    expect(result.inventory).toEqual([expect.objectContaining({ countryCode: 'HK', availableQuantity: 5 })]);
    expect(result.prices).toEqual([{ skuCode: 'SV', durationDays: 30, unitPrice: '28', currency: 'CNY' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/openapi/dedicated/quote?'),
      expect.objectContaining({ headers: expect.objectContaining({ apikey: 'secret' }) }),
    );
  });

  it('fails the platform scan when price scope or quote resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/wallet')) return response({ data: { available: '88.5', currency: 'CNY' } });
      if (url.includes('/inventory')) return response({ data: [] });
      if (url.includes('/skus')) return response({ data: [{ code: 'SV' }] });
      return response({ code: 'PERMISSION_DENIED' }, 403);
    }));
    const adapter = new FederatedUpstreamAdapter({} as ProviderRegistryService);

    await expect(adapter.scan({
      kind: 'PLATFORM_365',
      baseUrl: 'https://upstream.example.com',
      credentials: { apiKey: 'secret' },
      timeoutMs: 5000,
      siteId: 'site-1',
    })).rejects.toMatchObject({ reasonKey: 'federated_upstream_http_error', httpStatus: 502 });
  });

  it('uses the existing 985 adapter for live stock and cost, then reads remaining traffic', async () => {
    const syncInventory = vi.fn().mockResolvedValue({
      providerCode: 'NINE_EIGHT_FIVE',
      syncedAt: new Date(),
      items: [{
        countryCode: 'HK',
        countryName: 'Hong Kong',
        stock: 7,
        protocol: 'BOTH',
        ipType: 'NATIVE',
        providerResourceId: 'HK:premium',
        upstreamCost: 12,
        upstreamCostCurrency: 'CNY',
      }],
    });
    const registry = { getAdapter: vi.fn().mockReturnValue({ syncInventory }) } as unknown as ProviderRegistryService;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code: 0, data: { remaining_traffic: 1024 } })));
    const adapter = new FederatedUpstreamAdapter(registry);

    const result = await adapter.scan({
      kind: 'NINE_EIGHT_FIVE',
      baseUrl: 'https://open-api.985proxy.com',
      credentials: { apiKey: 'secret', apikey: 'secret', zoneId: 'zone-1' },
      timeoutMs: 5000,
      siteId: 'site-1',
    });

    expect(result.balanceAmount).toBe('1024');
    expect(result.balanceUnit).toBe('BYTES');
    expect(result.inventory).toEqual([expect.objectContaining({ countryCode: 'HK', stock: 7 })]);
    expect(result.prices).toEqual([expect.objectContaining({ countryCode: 'HK', unitPrice: 12, currency: 'CNY' })]);
    expect(syncInventory).toHaveBeenCalledWith(expect.objectContaining({ credential: { apikey: 'secret', zoneId: 'zone-1' } }));
  });

  it('reads IPIPD account balance with the same signed account path as the provider adapter', async () => {
    const syncInventory = vi.fn().mockResolvedValue({ providerCode: 'IPIPD', syncedAt: new Date(), items: [] });
    const registry = { getAdapter: vi.fn().mockReturnValue({ syncInventory }) } as unknown as ProviderRegistryService;
    const fetchMock = vi.fn().mockResolvedValue(response({
      success: true,
      code: 'SUCCESS',
      data: { balance: 42, currency: 'CNY' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FederatedUpstreamAdapter(registry);

    const result = await adapter.scan({
      kind: 'IPIPD',
      baseUrl: 'https://sandbox.ipipd.cn',
      credentials: { appId: 'app-id', appSecret: 'app-secret' },
      timeoutMs: 5000,
      siteId: 'site-1',
    });

    expect(result.balanceAmount).toBe('42');
    expect(result.balanceUnit).toBe('CNY');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sandbox.ipipd.cn/openapi/v2/account',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-AppId': 'app-id', 'X-API-Signature': expect.any(String) }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
