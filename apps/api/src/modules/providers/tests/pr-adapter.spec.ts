import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from 'node:zlib';
import { deflateRawSync } from 'node:zlib';
import { PrAdapter } from '../adapters/pr.adapter';
import { ProviderRuntimeConfig } from '../provider.types';

function runtimeConfig(): ProviderRuntimeConfig {
  return {
    code: 'PR',
    status: 'ACTIVE',
    baseUrl: 'https://proxy-seller.com/personal/api/v1',
    timeoutMs: 100,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: { apikey: 'test-api-key' },
  };
}

describe('PrAdapter SOCKS5 upstream proxy', () => {
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

  it('uses direct fetch when Proxy-Seller SOCKS5 URL is not configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }));

    const result = await new PrAdapter().healthCheck(runtimeConfig());

    expect(result.healthy).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://proxy-seller.com/personal/api/v1/test-api-key/reference/list/resident',
      expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('does not duplicate the API key when an older base URL already includes it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }));

    await new PrAdapter().healthCheck({
      ...runtimeConfig(),
      baseUrl: 'https://proxy-seller.com/personal/api/v1/test-api-key/',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://proxy-seller.com/personal/api/v1/test-api-key/reference/list/resident',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not fall back to direct fetch when configured SOCKS5 URL is invalid', async () => {
    process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL'] = 'not-a-url';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await new PrAdapter().healthCheck(runtimeConfig());

    expect(result.healthy).toBe(false);
    expect(result.error).toContain('proxy_seller_socks_url_invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks health check unhealthy when resident tariffs are missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference(undefined)), { status: 200 }));

    const result = await new PrAdapter().healthCheck(runtimeConfig());

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('proxy_seller_tarifs_empty');
  });

  it('exposes the resident reference endpoint failure instead of reporting a false healthy result', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('down', { status: 503 }));

    const result = await new PrAdapter().healthCheck(runtimeConfig());

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('HTTP 503');
  });

  it('syncs inventory from Proxy-Seller raw resident geo array responses', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ code: 'SG', name: 'Singapore', regions: [] }, { code: 'ZZ', count: 99 }]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items).toEqual([
      {
        countryCode: 'SG',
        countryName: 'Singapore',
        regionCode: undefined,
        stock: 0,
        ipType: 'NATIVE',
        protocol: 'BOTH',
        providerResourceId: 'SG:6928',
        upstreamCost: 1.99,
        upstreamCostCurrency: 'USD',
      },
      {
        countryCode: 'ZZ',
        countryName: 'ZZ',
        regionCode: undefined,
        stock: 99,
        ipType: 'NATIVE',
        protocol: 'BOTH',
        providerResourceId: 'ZZ:6928',
        upstreamCost: 1.99,
        upstreamCostCurrency: 'USD',
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://proxy-seller.com/personal/api/v1/test-api-key/order/calc',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paymentId: 1, tarifId: '6928', coupon: '' }),
      }),
    );
  });

  it('syncs inventory from Proxy-Seller envelope data item responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          data: { items: [{ countryCode: 'TH', available: '8' }, { countryCode: 'HK', available: 99 }] },
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items.map((item) => [item.countryCode, item.stock, item.providerResourceId])).toEqual([
      ['TH', 8, 'TH:6928'],
      ['HK', 99, 'HK:6928'],
    ]);
  });

  it('syncs inventory from Proxy-Seller country keyed object responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          data: { SG: { count: 12 }, BR: { quantity: '4' }, HK: { count: 99 } },
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items.map((item) => [item.countryCode, item.stock])).toEqual([
      ['SG', 12],
      ['BR', 4],
      ['HK', 99],
    ]);
  });

  it('normalizes Proxy-Seller alpha-3 and country name geo responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          data: {
            items: [
              { country_alpha3: 'SGP', available: 6 },
              { country: 'Netherlands', available: '5' },
              { countryAlpha3: 'HKG', available: 99 },
            ],
          },
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items.map((item) => [item.countryCode, item.stock, item.providerResourceId])).toEqual([
      ['SG', 6, 'SG:6928'],
      ['NL', 5, 'NL:6928'],
      ['HK', 99, 'HK:6928'],
    ]);
  });

  it('syncs inventory from Proxy-Seller zipped resident geo responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(zipJson('geo.json', JSON.stringify([{ code: 'SG', count: 7 }])), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items[0]?.countryCode).toBe('SG');
    expect(result.items[0]?.stock).toBe(7);
    expect(result.items[0]?.providerResourceId).toBe('SG:6928');
  });

  it('counts Proxy-Seller geo tree leaves when resident geo has no direct stock fields', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            code: 'CA',
            name: 'Canada',
            regions: [
              {
                code: 2127,
                name: 'Ontario',
                cities: [
                  { name: 'Woodstock', isps: ['Comwave Telecom', 'Videotron Ltee'] },
                  { name: 'Gloucester', isps: ['Comwave Telecom'] },
                ],
              },
            ],
          },
        ]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference('6928')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items.map((item) => item.providerResourceId)).toEqual([
      'CA:6928:Ontario:Woodstock:Comwave Telecom',
      'CA:6928:Ontario:Woodstock:Videotron Ltee',
      'CA:6928:Ontario:Gloucester:Comwave Telecom',
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        countryCode: 'CA',
        countryName: 'Canada',
        stock: 1,
        regionCode: 'Ontario - Woodstock - Comwave Telecom',
      }),
      expect.objectContaining({
        countryCode: 'CA',
        countryName: 'Canada',
        stock: 1,
        regionCode: 'Ontario - Woodstock - Videotron Ltee',
      }),
      expect.objectContaining({
        countryCode: 'CA',
        countryName: 'Canada',
        stock: 1,
        regionCode: 'Ontario - Gloucester - Comwave Telecom',
      }),
    ]);
  });

  it('fails loudly when Proxy-Seller resident reference has no tarif id', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ code: 'SG', count: 7 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentReference(undefined)), { status: 200 }));

    await expect(new PrAdapter().syncInventory(runtimeConfig())).rejects.toThrow('proxy_seller_tarifs_empty');
  });

  it('buys resident package and creates a deliverable Proxy-Seller list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        data: { orderId: 12345 },
        errors: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        data: {
          id: 561,
          title: 'ipeasy-12345-SG',
          login: 'proxy-login',
          password: 'proxy-password',
          rotation: '-1',
          geo: { country: 'SG' },
          export: { ports: 10000, ext: 'txt' },
        },
        errors: [],
      }), { status: 200 }));

    const result = await new PrAdapter().buyStaticProxy({
      countryCode: 'SG',
      quantity: 1,
      durationDays: 30,
      currency: 'CNY',
      ipType: 'NATIVE',
      protocol: 'SOCKS5',
      providerResourceId: 'SG:6928',
      idempotencyKey: 'order-1',
    }, runtimeConfig());

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://proxy-seller.com/personal/api/v1/test-api-key/order/make',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paymentId: 1, tarifId: '6928', coupon: '' }),
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://proxy-seller.com/personal/api/v1/test-api-key/resident/list/add',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'ipeasy-12345-SG',
          whitelist: '',
          geo: { country: 'SG' },
          export: { ports: 1, ext: 'txt' },
          rotation: -1,
        }),
      }),
    );
    expect(result).toEqual({
      upstreamOrderId: '12345',
      status: 'COMPLETED',
      failReason: undefined,
      proxies: [{
        upstreamProxyId: '561:10000',
        ip: 'res.proxy-seller.com',
        port: 10000,
        username: 'proxy-login',
        password: 'proxy-password',
        protocol: 'SOCKS5',
        expiresAt: expect.any(Date),
        countryCode: 'SG',
      }],
    });
  });

  it('keeps Proxy-Seller order pending when the created list only echoes the requested port count', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        data: { orderId: 12345 },
        errors: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        data: {
          id: 561,
          title: 'ipeasy-12345-SG',
          login: 'proxy-login',
          password: 'proxy-password',
          geo: { country: 'SG' },
          export: { ports: 1, ext: 'txt' },
        },
        errors: [],
      }), { status: 200 }));

    const result = await new PrAdapter().buyStaticProxy({
      countryCode: 'SG',
      quantity: 1,
      durationDays: 30,
      currency: 'CNY',
      ipType: 'NATIVE',
      protocol: 'SOCKS5',
      providerResourceId: 'SG:6928',
      idempotencyKey: 'order-1',
    }, runtimeConfig());

    expect(result.status).toBe('PENDING');
    expect(result.proxies).toEqual([]);
  });

  it('uses order/calc as the resident upstream cost source', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ code: 'SG', count: 1 }]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        data: {
          items: {
            tarifs: [{ id: '6928', name: '500 Mb', personal: false, price: '2.50', currency: 'USD' }],
            target: [],
          },
        },
        errors: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(residentCalc('1.99', 'USD')), { status: 200 }));

    const result = await new PrAdapter().syncInventory(runtimeConfig());

    expect(result.items.every((item) => item.upstreamCost === 1.99 && item.upstreamCostCurrency === 'USD')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://proxy-seller.com/personal/api/v1/test-api-key/order/calc',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paymentId: 1, tarifId: '6928', coupon: '' }),
      }),
    );
  });
});

function residentReference(id: string | undefined): Record<string, unknown> {
  return {
    status: 'success',
    data: {
      items: {
        tarifs: id === undefined ? [{ name: '500 Mb' }] : [{ id, name: '500 Mb', personal: false }],
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

function zipJson(fileName: string, content: string): Buffer {
  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  const contentBuffer = Buffer.from(content, 'utf8');
  const compressed = deflateRawSync(contentBuffer);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(crc32(contentBuffer), 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(contentBuffer.length, 22);
  header.writeUInt16LE(fileNameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, fileNameBuffer, compressed]);
}
