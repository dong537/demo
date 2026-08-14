import { ApiError } from '../api/client';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatCustomerError(
  error: unknown,
  t: Translate,
  namespace: string,
  fallbackKey = 'error',
): string {
  if (!(error instanceof ApiError)) return t(fallbackKey);
  const translationKey = `${namespace}.${error.reasonKey}`;
  const translated = t(translationKey);
  if (translated === translationKey || translated === error.reasonKey) {
    return error.reasonKey || t(fallbackKey);
  }
  return translated;
}
