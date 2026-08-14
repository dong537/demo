import Decimal from 'decimal.js';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export function toDecimalString(value: string | number | Decimal): string {
  return new Decimal(value).toFixed();
}

export function addMoney(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed();
}

export function subtractMoney(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toFixed();
}

export function isPositive(value: string): boolean {
  return new Decimal(value).greaterThan(0);
}

export function isNonNegative(value: string): boolean {
  return new Decimal(value).greaterThanOrEqualTo(0);
}

export function assertCurrency(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'CURRENCY_NOT_SUPPORTED', 422, `Expected ${expected}, got ${actual}`);
  }
}
