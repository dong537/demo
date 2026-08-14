export const PROVIDER_CODES = ['IPIPD', 'NINE_EIGHT_FIVE', 'PR', 'UPSTREAM_API'] as const;

export type ProviderCode = (typeof PROVIDER_CODES)[number];

export const PROVIDER_LABELS: Record<ProviderCode, string> = {
  IPIPD: 'ipmigo 平台',
  NINE_EIGHT_FIVE: '985 平台',
  PR: 'PR 平台',
  UPSTREAM_API: '通用上游',
};

export const PROVIDER_OPTIONS = PROVIDER_CODES.map((value) => ({
  value,
  label: PROVIDER_LABELS[value],
}));

const CUSTOMER_CHANNEL_LABELS: Record<ProviderCode, string> = {
  IPIPD: '优选线路',
  NINE_EIGHT_FIVE: '优选线路',
  PR: '合作线路',
  UPSTREAM_API: '供应线路',
};

export function formatProviderLabel(providerCode?: string | null): string {
  if (!providerCode) return '-';
  return PROVIDER_LABELS[providerCode as ProviderCode] ?? providerCode;
}

export function formatCustomerChannelLabel(providerCode?: string | null): string {
  if (!providerCode) return '供应线路';
  return CUSTOMER_CHANNEL_LABELS[providerCode as ProviderCode] ?? '其他线路';
}
