import { describe, expect, it } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { ErrorCode } from '../../common/errors/error-codes';
import { ResStaticController } from '../openapi/res-static.controller';
import { OrdersController } from './orders.controller';

const USER_CONTEXT: AuthenticatedContext = {
  ownerId: 'user-1',
  ownerType: 'USER',
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
  requestId: 'request-1',
};

describe('legacy static proxy creation routes', () => {
  it('blocks the customer and admin order creation routes before invoking the legacy use case', async () => {
    const controller = new OrdersController({} as never, {} as never);

    await expect(controller.createStaticProxy(USER_CONTEXT, {} as never)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_DISABLED,
      reasonKey: 'static_proxy_purchase_disabled',
      httpStatus: 410,
    });
    await expect(controller.createStaticProxyForUser({
      ...USER_CONTEXT,
      ownerType: 'PLATFORM_ADMIN',
      tenantId: null,
    }, 'user-1', {} as never)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_DISABLED,
      reasonKey: 'static_proxy_purchase_disabled',
      httpStatus: 410,
    });
  });

  it('blocks OpenAPI buy even when the old request body is incomplete', async () => {
    const controller = new ResStaticController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.buy(USER_CONTEXT, {} as never)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_DISABLED,
      reasonKey: 'static_proxy_purchase_disabled',
      httpStatus: 410,
    });
  });
});
