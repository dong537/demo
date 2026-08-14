import { resourceCountryCode } from '../pricing/base-price';

export type ManagedNativeProviderCode = 'PR' | 'IPIPD' | 'NINE_EIGHT_FIVE';

export const MANAGED_NATIVE_PROVIDER_CODES: readonly ManagedNativeProviderCode[] = [
  'PR',
  'IPIPD',
  'NINE_EIGHT_FIVE',
];

export const MANAGED_RESOURCE_PRICE_30D = '39';
export const MANAGED_RESOURCE_PRICE_CURRENCY = 'CNY';

// Initial operator recommendations only; live upstream resources are not hard-limited by this list.
export const MANAGED_RESOURCE_SALEABLE_COUNTRIES: Record<ManagedNativeProviderCode, readonly string[]> = {
  PR: ['SG', 'TH', 'PL', 'BR', 'TR', 'IL', 'NL', 'IN', 'CA', 'AT', 'RO', 'LV', 'UA'],
  IPIPD: ['GB', 'FR', 'DE', 'IT', 'ES', 'JP', 'VN', 'KR', 'AE', 'ZA'],
  NINE_EIGHT_FIVE: ['TW', 'PH', 'MY', 'AU', 'HK'],
};

export type ProviderResourceSaleability = {
  managed: boolean;
  countryCode: string;
  saleable: boolean;
  reason: string | null;
};

export type ProviderResourceSaleabilityInput = {
  providerCode: string;
  code: string;
  name?: string | null;
  displayName?: string | null;
  providerResourceId?: string | null;
};

export function getProviderResourceSaleability(input: ProviderResourceSaleabilityInput): ProviderResourceSaleability {
  if (!isManagedNativeProviderCode(input.providerCode)) {
    return {
      managed: false,
      countryCode: resourceCountryCode(input.code),
      saleable: true,
      reason: null,
    };
  }

  return {
    managed: true,
    countryCode: resourceCountryCode(input.code),
    saleable: true,
    reason: null,
  };
}

export function isManagedNativeProviderCode(value: string): value is ManagedNativeProviderCode {
  return (MANAGED_NATIVE_PROVIDER_CODES as readonly string[]).includes(value);
}
