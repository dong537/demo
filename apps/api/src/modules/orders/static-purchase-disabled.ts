import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export function assertStaticProxyPurchaseDisabled(): never {
  throw new AppError(ErrorCode.PRODUCT_DISABLED, 'static_proxy_purchase_disabled', 410);
}
