import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { IpipdAdapter } from '../adapters/ipipd.adapter';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import type { ProviderRuntimeConfig, StaticProxyBuyInput } from '../provider.types';

const FUTURE_EXPIRY_MS = '4102444800000';
const FUTURE_EXPIRY_SECONDS = '4102444800';
const FUTURE_EXPIRY_ISO = '2100-01-01T00:00:00.000Z';
const FUTURE_EXPIRY_985_UTC = '2100-01-01 00:00:00';
const INVALID_EXPIRY_ERROR = {
  code: ErrorCode.UPSTREAM_ERROR,
  reasonKey: 'provider_delivery_expiry_invalid',
  httpStatus: 502,
} satisfies Partial<AppError>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IPIPD delivery contract', () => {
  it('preserves a requested SOCKS5 protocol in the synchronous buy response', async () => {
    mockIpipdOrder({ protocol: 3, expiresAt: FUTURE_EXPIRY_MS });

    const result = await new IpipdAdapter().buyStaticProxy(ipipdBuyInput(), runtimeConfig('IPIPD'));

    expect(result.proxies[0]?.protocol).toBe('SOCKS5');
  });

  it('preserves an explicit SOCKS5 protocol when querying an order', async () => {
    mockIpipdOrderPage({ protocol: undefined, expiresAt: FUTURE_EXPIRY_MS });

    const result = await new IpipdAdapter().queryOrder(
      { upstreamOrderId: 'ipipd-order-1', protocol: 'SOCKS5' },
      runtimeConfig('IPIPD'),
    );

    expect(result.proxies[0]?.protocol).toBe('SOCKS5');
  });

  it('rejects a verifiable upstream protocol that conflicts with the request', async () => {
    mockIpipdOrder({ protocol: 'HTTP', expiresAt: FUTURE_EXPIRY_MS });

    await expect(
      new IpipdAdapter().buyStaticProxy(ipipdBuyInput(), runtimeConfig('IPIPD')),
    ).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_ERROR,
      reasonKey: 'provider_delivery_protocol_mismatch',
      httpStatus: 502,
    } satisfies Partial<AppError>);
  });

  it.each([
    ['epoch seconds', FUTURE_EXPIRY_SECONDS],
    ['epoch milliseconds', FUTURE_EXPIRY_MS],
  ])('parses a future %s delivery expiry without changing its instant', async (_case, expiresAt) => {
    mockIpipdOrder({ expiresAt });

    const result = await new IpipdAdapter().buyStaticProxy(ipipdBuyInput(), runtimeConfig('IPIPD'));

    expect(result.proxies[0]?.expiresAt).toEqual(new Date(Number(FUTURE_EXPIRY_MS)));
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-date'],
    ['out-of-range', '999999999999999999999'],
    ['non-future', '946684800000'],
  ])('rejects a %s delivery expiry', async (_case, expiresAt) => {
    mockIpipdOrder({ expiresAt });

    await expect(
      new IpipdAdapter().buyStaticProxy(ipipdBuyInput(), runtimeConfig('IPIPD')),
    ).rejects.toMatchObject(INVALID_EXPIRY_ERROR);
  });
});

describe('985Proxy delivery contract', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-date'],
    ['non-future', '2000-01-01T00:00:00.000Z'],
  ])('rejects a %s delivery expiry', async (_case, expireTime) => {
    mockNineEightFiveOrder(expireTime);

    await expect(
      new NineEightFiveAdapter().buyStaticProxy(nineEightFiveBuyInput(), runtimeConfig('NINE_EIGHT_FIVE')),
    ).rejects.toMatchObject(INVALID_EXPIRY_ERROR);
  });

  it('accepts an explicit future expiry without changing it', async () => {
    mockNineEightFiveOrder(FUTURE_EXPIRY_ISO);

    const result = await new NineEightFiveAdapter().buyStaticProxy(
      nineEightFiveBuyInput(),
      runtimeConfig('NINE_EIGHT_FIVE'),
    );

    expect(result.proxies[0]?.expiresAt).toEqual(new Date(FUTURE_EXPIRY_ISO));
  });

  it.each([
    ['epoch seconds', FUTURE_EXPIRY_SECONDS],
    ['epoch milliseconds', FUTURE_EXPIRY_MS],
  ])('parses a future %s delivery expiry without changing its instant', async (_case, expiresAt) => {
    mockNineEightFiveOrder(expiresAt);

    const result = await new NineEightFiveAdapter().buyStaticProxy(
      nineEightFiveBuyInput(),
      runtimeConfig('NINE_EIGHT_FIVE'),
    );

    expect(result.proxies[0]?.expiresAt).toEqual(new Date(Number(FUTURE_EXPIRY_MS)));
  });

  it('treats the official timezone-less 985Proxy expiry format as UTC', async () => {
    mockNineEightFiveOrder(FUTURE_EXPIRY_985_UTC);

    const result = await new NineEightFiveAdapter().buyStaticProxy(
      nineEightFiveBuyInput(),
      runtimeConfig('NINE_EIGHT_FIVE'),
    );

    expect(result.proxies[0]?.expiresAt).toEqual(new Date(FUTURE_EXPIRY_ISO));
  });
});

function mockIpipdOrder(instance: { protocol?: unknown; expiresAt?: string }): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        success: true,
        code: 'SUCCESS',
        message: 'ok',
        data: {
          orderNo: 'ipipd-order-1',
          status: 3,
          instances: [ipipdInstance(instance)],
        },
        timestamp: '2026-08-14T00:00:00.000Z',
        traceId: 'trace-ipipd-buy',
      }),
      { status: 200 },
    ),
  );
}

function mockIpipdOrderPage(instance: { protocol?: unknown; expiresAt?: string }): void {
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
          records: [{
            orderNo: 'ipipd-order-1',
            status: 3,
            instances: [ipipdInstance(instance)],
          }],
        },
        timestamp: '2026-08-14T00:00:00.000Z',
        traceId: 'trace-ipipd-query',
      }),
      { status: 200 },
    ),
  );
}

function ipipdInstance(overrides: { protocol?: unknown; expiresAt?: string }) {
  return {
    proxyId: 'ipipd-proxy-1',
    ip: '203.0.113.10',
    port: 1080,
    username: 'line-user',
    password: 'line-pass',
    countryCode: 'HKG',
    ...overrides,
  };
}

function mockNineEightFiveOrder(expireTime: string | undefined): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          order_no: '985-order-1',
          proxy_list: [{
            proxy_id: '985-proxy-1',
            ip: '203.0.113.20',
            port_socks: 1080,
            username: 'line-user',
            password: 'line-pass',
            country: 'HK',
            expire_time: expireTime,
          }],
        },
      }),
      { status: 200 },
    ),
  );
}

function ipipdBuyInput(): StaticProxyBuyInput {
  return {
    countryCode: 'HK',
    quantity: 1,
    durationDays: 30,
    ipType: 'NATIVE',
    protocol: 'SOCKS5',
    currency: 'CNY',
    providerResourceId: 'ipipd-line-1',
    idempotencyKey: 'ipipd-order-key',
  };
}

function nineEightFiveBuyInput(): StaticProxyBuyInput {
  return {
    countryCode: 'HK',
    quantity: 1,
    durationDays: 30,
    ipType: 'NATIVE',
    protocol: 'SOCKS5',
    currency: 'CNY',
    providerResourceId: 'HK:premium',
    idempotencyKey: '985-order-key',
  };
}

function runtimeConfig(code: 'IPIPD' | 'NINE_EIGHT_FIVE'): ProviderRuntimeConfig {
  return {
    code,
    status: 'ACTIVE',
    baseUrl: code === 'IPIPD' ? 'https://api.ipipd.cn' : 'https://open-api.985proxy.com',
    timeoutMs: 1_000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: code === 'IPIPD'
      ? { appId: 'test-app-id', appSecret: 'test-app-secret' }
      : { apikey: 'test-api-key' },
  };
}
