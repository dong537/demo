import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurrentUserCache,
  fetchCurrentAdmin,
  fetchCurrentCustomer,
} from './current-user';
import * as client from '../api/client';

const CUSTOMER = {
  ownerId: 'user-1',
  ownerType: 'USER' as const,
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
};

const ADMIN = {
  ownerId: 'admin-1',
  ownerType: 'TENANT_ADMIN' as const,
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  clearCurrentUserCache();
});

describe('current user auth cache', () => {
  it('reuses the customer auth request while the token is unchanged', async () => {
    sessionStorage.setItem('user_token', 'token-1');
    const spy = vi.spyOn(client, 'userApiRequest').mockResolvedValue(CUSTOMER);

    const [first, second] = await Promise.all([fetchCurrentCustomer(), fetchCurrentCustomer()]);
    const third = await fetchCurrentCustomer();

    expect(first).toEqual(CUSTOMER);
    expect(second).toEqual(CUSTOMER);
    expect(third).toEqual(CUSTOMER);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refetches customer auth when the token changes', async () => {
    const spy = vi.spyOn(client, 'userApiRequest').mockResolvedValue(CUSTOMER);

    sessionStorage.setItem('user_token', 'token-1');
    await fetchCurrentCustomer();

    sessionStorage.setItem('user_token', 'token-2');
    await fetchCurrentCustomer();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reuses the admin auth request while the token is unchanged', async () => {
    sessionStorage.setItem('admin_token', 'admin-token-1');
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue(ADMIN);

    await fetchCurrentAdmin();
    await fetchCurrentAdmin();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
