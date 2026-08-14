import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedContext } from '../../common/auth/auth-context';
import { ApiV1CompatController } from './api-v1-compat.controller';

const userContext: AuthenticatedContext = {
  ownerId: 'user-1',
  ownerType: 'USER',
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
  requestId: 'request-1',
};

function createController() {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'LEGACY_API_V1_ENABLED') return 'true';
      if (key === 'LEGACY_API_SITE_ID') return 'site-1';
      return '';
    }),
  };
  const catalog = {
    findSku: vi.fn().mockResolvedValue(null),
    listSaleableSkusForBuyer: vi.fn(),
  };
  const quote = { execute: vi.fn() };
  const createOrder = { execute: vi.fn() };
  const wallet = {
    getWalletByUserId: vi.fn().mockResolvedValue({ available: { toString: () => '100.00' }, currency: 'CNY' }),
  };

  const controller = new ApiV1CompatController(
    config as never,
    {} as never,
    {} as never,
    {} as never,
    catalog as never,
    quote as never,
    {} as never,
    createOrder as never,
    {} as never,
    {} as never,
    {} as never,
    wallet as never,
  );

  return { controller, catalog, quote, createOrder, wallet };
}

describe('ApiV1CompatController', () => {
  it('quotes through the canonical catalog use case with authenticated buyer scope', async () => {
    const { controller, quote } = createController();
    quote.execute.mockResolvedValue({
      skuCode: 'SV',
      durationDays: 30,
      unitPrice: '100.00',
      totalPrice: '100.00',
      currency: 'CNY',
    });

    const result = await controller.dedicatedPreview(userContext, {
      skuCode: 'sv',
      durationDays: 30,
      country: 'hk',
      protocol: 'vless',
    });

    expect(quote.execute).toHaveBeenCalledWith({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skuCode: 'SV',
      durationDays: 30,
      quantity: 1,
      currency: 'CNY',
    });
    expect(result).toMatchObject({ chargeAmount: '100.00', finalPrice: '100.00', currency: 'CNY' });
  });

  it('maps legacy purchase input into the canonical order use case without bypassing it', async () => {
    const { controller, createOrder } = createController();
    createOrder.execute.mockResolvedValue({
      status: 'QUEUED',
      orderId: 'order-1',
      reservationId: 'reservation-1',
      jobId: 'job-1',
      skuCode: 'ZB',
      countryCode: 'HK',
      quantity: 1,
      replayed: false,
    });

    const result = await controller.dedicatedPurchase(userContext, {
      skuCode: 'zb',
      durationDays: 60,
      country: 'hk',
      protocol: 'vmess',
    }, 'request-idempotency-key');

    expect(createOrder.execute).toHaveBeenCalledWith(userContext, {
      skuCode: 'ZB',
      countryCode: 'HK',
      quantity: 1,
      durationDays: 60,
      currency: 'CNY',
      idempotencyKey: 'request-idempotency-key',
    });
    expect(result).toMatchObject({
      status: 'reserved',
      pending: true,
      proxyId: 'order-1',
      orderNo: 'order-1',
    });
  });
});
