import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export function normalizeDnsHostname(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }

  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.length > 253) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }

  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !isDomainLabel(label))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }

  return hostname;
}

function isDomainLabel(label: string): boolean {
  return label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}
