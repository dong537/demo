import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertStaticProxyPurchaseDisabled } from './static-purchase-disabled';

describe('static proxy purchase gate', () => {
  it('returns an explicit gone/disabled error for every legacy creation caller', () => {
    expect(() => assertStaticProxyPurchaseDisabled()).toThrowError(
      new AppError(ErrorCode.PRODUCT_DISABLED, 'static_proxy_purchase_disabled', 410),
    );
  });
});
