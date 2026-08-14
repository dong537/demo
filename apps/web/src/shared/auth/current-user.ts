import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, userApiRequest } from '../api/client';

export interface CurrentUser {
  ownerId: string;
  ownerType: 'USER' | 'TENANT_ADMIN' | 'PLATFORM_ADMIN' | 'SYSTEM';
  siteId: string;
  tenantId: string | null;
  scopes: string[];
}

type AuthArea = 'admin' | 'customer';
type AuthTokenKey = 'admin_token' | 'user_token';

interface CurrentUserCacheEntry {
  token: string;
  expiresAt: number;
  promise?: Promise<CurrentUser>;
  data?: CurrentUser;
}

const AUTH_CACHE_TTL_MS = 5 * 60_000;
const currentUserCache: Partial<Record<AuthArea, CurrentUserCacheEntry>> = {};

function authTokenKey(area: AuthArea): AuthTokenKey {
  return area === 'admin' ? 'admin_token' : 'user_token';
}

export function clearCurrentUserCache(area?: AuthArea) {
  if (area) {
    delete currentUserCache[area];
    return;
  }
  delete currentUserCache.admin;
  delete currentUserCache.customer;
}

export function getCurrentUserQueryKey(area: AuthArea) {
  return ['auth', 'me', area, sessionStorage.getItem(authTokenKey(area)) ?? ''];
}

export async function fetchCurrentCustomer(): Promise<CurrentUser> {
  return fetchCachedCurrentUser('customer', () => userApiRequest<CurrentUser>('/api/auth/me'), (current) => {
    if (current.ownerType !== 'USER') {
      throw new ApiError('PERMISSION_DENIED', 'insufficient_permissions');
    }
  });
}

export async function fetchCurrentAdmin(): Promise<CurrentUser> {
  return fetchCachedCurrentUser('admin', () => apiRequest<CurrentUser>('/api/auth/me'), (current) => {
    if (current.ownerType !== 'TENANT_ADMIN' && current.ownerType !== 'PLATFORM_ADMIN') {
      throw new ApiError('PERMISSION_DENIED', 'insufficient_permissions');
    }
  });
}

export function useCurrentCustomer() {
  return useQuery({
    queryKey: getCurrentUserQueryKey('customer'),
    queryFn: fetchCurrentCustomer,
    staleTime: AUTH_CACHE_TTL_MS,
  });
}

export function useCurrentAdmin() {
  return useQuery({
    queryKey: getCurrentUserQueryKey('admin'),
    queryFn: fetchCurrentAdmin,
    staleTime: AUTH_CACHE_TTL_MS,
  });
}

async function fetchCachedCurrentUser(
  area: AuthArea,
  fetcher: () => Promise<CurrentUser>,
  validate: (current: CurrentUser) => void,
): Promise<CurrentUser> {
  const token = sessionStorage.getItem(authTokenKey(area)) ?? '';
  const cached = currentUserCache[area];
  const now = Date.now();

  if (cached?.token === token && cached.data && cached.expiresAt > now) {
    return cached.data;
  }
  if (cached?.token === token && cached.promise) {
    return cached.promise;
  }

  const promise = fetcher()
    .then((current) => {
      validate(current);
      currentUserCache[area] = {
        token,
        data: current,
        expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
      };
      return current;
    })
    .catch((error) => {
      delete currentUserCache[area];
      throw error;
    });

  currentUserCache[area] = {
    token,
    promise,
    expiresAt: now + AUTH_CACHE_TTL_MS,
  };

  return promise;
}
