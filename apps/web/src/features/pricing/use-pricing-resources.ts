import { apiRequest, buildQuery } from '../../shared/api/client';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatIpTypeZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { usePriceableCatalog } from '../../shared/resource/use-priceable-catalog';
import { DEFAULT_PRICING_DURATION_DAYS } from './pricing-duration';

export interface PricingResource {
  id: string;
  code: string;
  name: string;
  displayName?: string | null;
  providerCode?: string | null;
  ipType?: string | null;
  countryCode?: string | null;
  upstreamResourceId?: string | null;
}

interface PricingResourcePage {
  page: number;
  pageSize: number;
  total: number;
  items: PricingResource[];
}

const PRICING_RESOURCE_PAGE_SIZE = 500;

export function usePricingResources() {
  return usePriceableCatalog<PricingResource>({
    queryKey: ['pricing-resources', DEFAULT_PRICING_DURATION_DAYS],
    pageSize: PRICING_RESOURCE_PAGE_SIZE,
    fetchPage: fetchPricingResourcesPage,
  });
}

export function toResourceOptions(items: PricingResource[]) {
  return items.map((resource) => {
    const label = formatPricingResourceLabel(resource);
    return {
      value: resource.id,
      label,
      searchText: [
        label,
        resource.code,
        resource.name,
        resource.displayName,
        resource.upstreamResourceId,
        resource.providerCode,
        formatProviderLabel(resource.providerCode),
      ].filter(Boolean).join(' '),
    };
  });
}

function formatPricingResourceLabel(resource: PricingResource): string {
  const location = formatResourceLocationZh(resource);
  const parts = [
    location.title,
    resource.ipType ? formatIpTypeZh(resource.ipType) : null,
  ].filter(Boolean);
  return parts.join(' / ');
}

function fetchPricingResourcesPage(page: number): Promise<PricingResourcePage> {
  return apiRequest<PricingResourcePage>(
    `/api/resources/priceable-catalog${buildQuery({
      page,
      pageSize: PRICING_RESOURCE_PAGE_SIZE,
      durationDays: DEFAULT_PRICING_DURATION_DAYS,
    })}`,
  );
}

export const PRICING_CURRENCY_OPTIONS = [
  { value: 'CNY', label: 'CNY' },
  { value: 'USD', label: 'USD' },
];
