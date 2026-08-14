import Decimal from 'decimal.js';
import type { PriceResult } from './pricing.repository';

const CURRENCY = 'CNY';

const BASE_30D_BY_COUNTRY: Record<string, string> = {
  GB: '39',
  FR: '39',
  DE: '39',
  IT: '39',
  ES: '39',
  JP: '39',
  KR: '39',
  VN: '39',
  AE: '39',
  ZA: '39',
  HK: '39',
  TW: '39',
  PH: '39',
  MY: '39',
  AU: '39',
  SG: '39',
  TH: '39',
  PL: '39',
  BR: '39',
  TR: '39',
  IL: '39',
  NL: '39',
  IN: '39',
  CA: '39',
  AT: '39',
  RO: '39',
  LV: '39',
  UA: '39',
};

const BASE_30D_BY_PROVIDER: Record<string, string> = {
  IPIPD: '39',
  NINE_EIGHT_FIVE: '39',
  PR: '39',
};

const DEFAULT_30D = '28';

const DURATION_MULTIPLIER: Record<number, number> = {
  30: 1,
  60: 1.9,
  90: 2.7,
};

export function isManagedStaticProxyProviderCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(BASE_30D_BY_PROVIDER, value);
}

export function getBaseStaticProxyPrice(input: {
  code: string;
  providerCode: string;
  durationDays: number;
  currency: string;
}): PriceResult | null {
  if (input.currency !== CURRENCY) return null;
  const countryCode = resourceCountryCode(input.code);
  const base = BASE_30D_BY_COUNTRY[countryCode] ?? BASE_30D_BY_PROVIDER[input.providerCode] ?? DEFAULT_30D;
  const multiplier = DURATION_MULTIPLIER[input.durationDays] ?? input.durationDays / 30;
  const unitPrice = new Decimal(base).mul(multiplier).toDecimalPlaces(2).toString();
  return { unitPrice, currency: CURRENCY, source: 'DEFAULT_TEMPLATE' };
}

export function resourceCountryCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  const [country] = trimmed.split(/[:\-_]/);
  if (country && /^[A-Z]{2}$/.test(country)) return country;
  return trimmed;
}
