import Decimal from 'decimal.js';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export function assertSameCurrency(a: string, b: string): void {
  if (a !== b) {
    throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'currency_mismatch', 422, `Expected ${a}, got ${b}`);
  }
}

export function assertSufficientBalance(available: string, amount: string): void {
  if (new Decimal(available).lessThan(new Decimal(amount))) {
    throw new AppError(ErrorCode.WALLET_INSUFFICIENT_BALANCE, 'wallet_insufficient_balance', 422);
  }
}

export function assertPositiveAmount(amount: string): void {
  if (!new Decimal(amount).greaterThan(0)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'amount_must_be_positive', 400);
  }
}
