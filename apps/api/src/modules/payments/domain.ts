import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type PaymentOrderStatus = 'PENDING' | 'CONFIRMING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

export function assertCanConfirm(status: PaymentOrderStatus): void {
  if (status !== 'PENDING' && status !== 'CONFIRMING') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'payment_order_cannot_confirm', 400, `Cannot confirm order with status ${status}`);
  }
}

export function assertCanFail(status: PaymentOrderStatus): void {
  if (status !== 'PENDING' && status !== 'CONFIRMING') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'payment_order_cannot_fail', 400, `Cannot fail order with status ${status}`);
  }
}
