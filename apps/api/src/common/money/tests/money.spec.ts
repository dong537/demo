import { describe, it, expect } from 'vitest';
import { toDecimalString, addMoney, subtractMoney, isPositive, assertCurrency } from '../money';
import { AppError } from '../../errors/app-error';
import { ErrorCode } from '../../errors/error-codes';

describe('money utils', () => {
  it('toDecimalString 正常转换', () => {
    expect(toDecimalString('100.50')).toBe('100.5');
    expect(toDecimalString(0)).toBe('0');
  });

  it('addMoney 精度正确（避免 0.1+0.2 浮点误差）', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3');
    expect(addMoney('100', '50.5')).toBe('150.5');
  });

  it('subtractMoney 精度正确', () => {
    expect(subtractMoney('1', '0.9')).toBe('0.1');
    expect(subtractMoney('100', '50.5')).toBe('49.5');
  });

  it('isPositive(0) → false', () => {
    expect(isPositive('0')).toBe(false);
    expect(isPositive('-1')).toBe(false);
    expect(isPositive('0.01')).toBe(true);
  });

  it('assertCurrency CNY vs USD → throw CURRENCY_NOT_SUPPORTED', () => {
    expect(() => assertCurrency('USD', 'CNY')).toThrow(AppError);
    try {
      assertCurrency('USD', 'CNY');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.CURRENCY_NOT_SUPPORTED);
    }
    expect(() => assertCurrency('CNY', 'CNY')).not.toThrow();
  });
});
