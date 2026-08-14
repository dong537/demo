export const DEFAULT_BRAND_NAME = 'ipmigo';

const LEGACY_BRAND_NAME = /ipipd/gi;

export function formatBrandName(value?: string | null): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.replace(LEGACY_BRAND_NAME, DEFAULT_BRAND_NAME);
}

export function resolveBrandName(values: Array<string | null | undefined>, fallback = DEFAULT_BRAND_NAME): string {
  for (const value of values) {
    const displayName = formatBrandName(value);
    if (displayName) return displayName;
  }
  return fallback;
}
