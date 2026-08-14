import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

interface DeliveryExpiryOptions {
  timezoneLessUtc?: boolean;
}

export function requireFutureDeliveryExpiry(value: unknown, options: DeliveryExpiryOptions = {}): Date {
  const text = typeof value === 'string' ? value.trim() : '';
  const timestamp = parseTimestamp(text, options);
  const expiresAt = new Date(timestamp);
  if (!Number.isFinite(timestamp) || !Number.isFinite(expiresAt.getTime()) || timestamp <= Date.now()) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'provider_delivery_expiry_invalid', 502);
  }
  return expiresAt;
}

function parseTimestamp(text: string, options: DeliveryExpiryOptions): number {
  if (/^\d{10}$/.test(text)) return Number(text) * 1_000;
  if (/^\d{13}$/.test(text)) return Number(text);
  if (options.timezoneLessUtc && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}Z`);
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return Date.parse(text);
  return Number.NaN;
}
