import { describe, it, expect } from 'vitest';
import { assertSufficientBalance, assertPositiveAmount, assertSameCurrency } from '../domain';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('wallet domain', () => {
  it('assertSufficientBalance: available < amount → throw WALLET_INSUFFICIENT_BALANCE', () => {
    expect(() => assertSufficientBalance('50', '100')).toThrow(AppError);
    try {
      assertSufficientBalance('50', '100');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.WALLET_INSUFFICIENT_BALANCE);
    }
  });

  it('assertSufficientBalance: available === amount → 通过', () => {
    expect(() => assertSufficientBalance('100', '100')).not.toThrow();
  });

  it('assertPositiveAmount(0) → throw VALIDATION_ERROR', () => {
    expect(() => assertPositiveAmount('0')).toThrow(AppError);
    try {
      assertPositiveAmount('0');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('assertPositiveAmount(-1) → throw VALIDATION_ERROR', () => {
    expect(() => assertPositiveAmount('-1')).toThrow(AppError);
    try {
      assertPositiveAmount('-1');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('assertSameCurrency(CNY, USD) → throw CURRENCY_NOT_SUPPORTED', () => {
    expect(() => assertSameCurrency('CNY', 'USD')).toThrow(AppError);
    try {
      assertSameCurrency('CNY', 'USD');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.CURRENCY_NOT_SUPPORTED);
    }
  });
});
