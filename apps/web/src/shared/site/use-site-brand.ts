import { useQuery } from '@tanstack/react-query';
import { userApiRequest } from '../api/client';
import { formatBrandName } from './brand-display';

export interface SiteBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
}

interface CurrentSiteResponse {
  site?: { name?: string; brandConfig?: SiteBrand | null } | null;
}

const SITE_BRAND_KEY = ['site', 'current', 'brand'] as const;

export function useSiteBrand() {
  return useQuery({
    queryKey: SITE_BRAND_KEY,
    queryFn: async (): Promise<SiteBrand> => {
      const data = await userApiRequest<CurrentSiteResponse>('/api/sites/current');
      const site = data.site ?? {};
      const brand = site.brandConfig ?? {};
      return { ...brand, name: formatBrandName(brand.name || site.name) };
    },
    staleTime: 5 * 60 * 1000,
  });
}
