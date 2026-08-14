import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { IpipdAdapter } from '../adapters/ipipd.adapter';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import { PrAdapter } from '../adapters/pr.adapter';
import { UpstreamApiAdapter } from '../adapters/upstream-api.adapter';
import { ProviderRuntimeConfig, StaticProxyBuyInput } from '../provider.types';
import { AppError } from '../../../common/errors/app-error';

function baseInput(overrides: Partial<StaticProxyBuyInput> = {}): StaticProxyBuyInput {
  return {
    countryCode: 'JP',
    quantity: 1,
    durationDays: 30,
    currency: 'CNY',
    ipType: 'NATIVE',
    protocol: 'HTTP',
    idempotencyKey: 'test-buy-fixed-key',
    ...overrides,
  };
}

describe('buildBuyRequest upstream order request structure', () => {
  describe('IPIPD', () => {
    const adapter = new IpipdAdapter();

    it('uses providerResourceId as lineId when resource mapping exists', () => {
      const req = adapter.buildBuyRequest(baseInput({ providerResourceId: '1487484105317814272' }));
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/openapi/v2/static/orders/create');
      expect(req.body).toEqual({
        lineId: '1487484105317814272',
        quantity: 1,
        days: 30,
        orderNo: 'test-buy-fixed-key',
        isTest: false,
        sync: true,
      });
    });

    it('uses encoded providerResourceId as lineId and cidr for network resources', () => {
      const req = adapter.buildBuyRequest(baseInput({ providerResourceId: '1487484105317814272|cidr=192.168.104.0%2F24' }));
      expect(req.body).toEqual({
        lineId: '1487484105317814272',
        cidr: '192.168.104.0/24',
        quantity: 1,
        days: 30,
        orderNo: 'test-buy-fixed-key',
        isTest: false,
        sync: true,
      });
    });

    it('uses alpha-3 country path and requires businessType when no lineId exists', () => {
      const req = adapter.buildBuyRequest(baseInput({ countryCode: 'JP', businessType: 'BT_CODE', regionCode: 'TYO' }));
      expect(req.body).toMatchObject({
        countryCode: 'JPN',
        cityCode: 'TYO',
        businessType: 'BT_CODE',
        ispType: 1,
        quantity: 1,
        days: 30,
      });
    });

    it('throws VALIDATION_ERROR when country path has no businessType', () => {
      expect(() => adapter.buildBuyRequest(baseInput({ countryCode: 'JP' }))).toThrow(AppError);
    });
  });

  describe('985Proxy (NINE_EIGHT_FIVE)', () => {
    const adapter = new NineEightFiveAdapter();
    const originalStaticZone = process.env['UPSTREAM_985PROXY_STATIC_ZONE'];

    beforeEach(() => {
      delete process.env['UPSTREAM_985PROXY_STATIC_ZONE'];
    });

    afterEach(() => {
      if (originalStaticZone === undefined) {
        delete process.env['UPSTREAM_985PROXY_STATIC_ZONE'];
      } else {
        process.env['UPSTREAM_985PROXY_STATIC_ZONE'] = originalStaticZone;
      }
    });

    it('resolves encoded CC:type from providerResourceId first', () => {
      const req = adapter.buildBuyRequest(
        baseInput({ countryCode: 'TW', businessType: 'TW:shared', providerResourceId: 'HK:premium' }),
      );
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/res_static/buy');
      expect(req.body).toEqual({
        static_proxy_type: 'premium',
        time_period: 30,
        pay_type: 'balance',
        buy_data: [{ country: 'HK', city: '', count: 1 }],
      });
    });

    it('keeps businessType as fallback for encoded CC:type', () => {
      const req = adapter.buildBuyRequest(baseInput({ countryCode: 'HK', businessType: 'HK:premium' }));
      expect(req.body).toEqual({
        static_proxy_type: 'premium',
        time_period: 30,
        pay_type: 'balance',
        buy_data: [{ country: 'HK', city: '', count: 1 }],
      });
    });

    it('defaults to premium and uses regionCode as city', () => {
      const req = adapter.buildBuyRequest(baseInput({ countryCode: 'TW', regionCode: 'Taipei', quantity: 3 }));
      expect(req.body).toMatchObject({
        static_proxy_type: 'premium',
        buy_data: [{ country: 'TW', city: 'Taipei', count: 3 }],
      });
    });

    it('adds configured static zone to official buy payload', () => {
      process.env['UPSTREAM_985PROXY_STATIC_ZONE'] = '4sd72p1bvlha';

      const req = adapter.buildBuyRequest(baseInput({ countryCode: 'TW' }));

      expect(req.body).toEqual({
        static_proxy_type: 'premium',
        time_period: 30,
        pay_type: 'balance',
        zone: '4sd72p1bvlha',
        buy_data: [{ country: 'TW', city: '', count: 1 }],
      });
    });

    it('uses the provider account zone before the legacy environment zone', () => {
      process.env['UPSTREAM_985PROXY_STATIC_ZONE'] = 'env-zone';

      const req = adapter.buildBuyRequest(
        baseInput({ countryCode: 'TW' }),
        nineEightFiveConfig({ apikey: 'key', zoneId: 'account-zone' }),
      );

      expect(req.body).toEqual({
        static_proxy_type: 'premium',
        time_period: 30,
        pay_type: 'balance',
        zone: 'account-zone',
        buy_data: [{ country: 'TW', city: '', count: 1 }],
      });
    });
  });

  describe('Proxy-Seller (PR)', () => {
    const adapter = new PrAdapter();

    it('uses businessType as tarifId', () => {
      const req = adapter.buildBuyRequest(baseInput({ businessType: 'tarif-123' }));
      expect(req.method).toBe('POST');
      expect(req.path).toBe('order/make');
      expect(req.body).toEqual({ paymentId: 1, tarifId: 'tarif-123', coupon: '' });
    });

    it('resolves encoded country tariff from providerResourceId first', () => {
      const req = adapter.buildBuyRequest(
        baseInput({ businessType: 'tarif-from-business-type', providerResourceId: 'SG:6928' }),
      );
      expect(req.body).toEqual({ paymentId: 1, tarifId: '6928', coupon: '' });
    });

    it('throws VALIDATION_ERROR when tarifId is missing', () => {
      expect(() => adapter.buildBuyRequest(baseInput())).toThrow(AppError);
    });
  });

  describe('UPSTREAM_API', () => {
    const adapter = new UpstreamApiAdapter();

    it('uses 985-compatible public resource and order fields', () => {
      const req = adapter.buildBuyRequest(baseInput({ providerResourceId: 'RS_11111111111141118111111111111111', quantity: 2 }));
      expect(req.path).toBe('/res_static/buy');
      expect(req.body).toEqual({
        resource_id: 'RS_11111111111141118111111111111111',
        quantity: 2,
        duration_days: 30,
        currency: 'CNY',
        idempotency_key: 'test-buy-fixed-key',
      });
    });

    it('requires resource mapping for reseller upstream buys', () => {
      expect(() => adapter.buildBuyRequest(baseInput())).toThrow(AppError);
    });
  });
});

function nineEightFiveConfig(credential: Record<string, string> = { apikey: 'key' }): ProviderRuntimeConfig {
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
