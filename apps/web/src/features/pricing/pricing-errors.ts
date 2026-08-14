import { ApiError } from '../../shared/api/client';

export function getPricingReasonKey(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function formatPricingFailure(error: unknown, t: (key: string) => string): string {
  const reasonKey = getPricingReasonKey(error, t('error'));
  const key = `pricing.reason.${reasonKey}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return t('pricing.reason.generic');
}
