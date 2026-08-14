import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantDetailFeature } from '../tenant-detail.feature';
import * as client from '../../../shared/api/client';
import * as currentUser from '../../../shared/auth/current-user';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../admin-users/user-list.feature', () => ({
  UserListFeature: () => <div data-testid="tenant-users-tab" />,
}));

vi.mock('../../admin-orders/order-list.feature', () => ({
  OrderListFeature: () => <div data-testid="tenant-orders-tab" />,
}));

vi.mock('../tenant-brand.feature', () => ({
  TenantBrandFeature: () => <div data-testid="tenant-brand-tab" />,
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockReset();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
  vi.spyOn(currentUser, 'useCurrentAdmin').mockReturnValue({
    data: {
      ownerId: 'admin-1',
      ownerType: 'PLATFORM_ADMIN',
      siteId: 'site-1',
      tenantId: null,
      scopes: [],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof currentUser.useCurrentAdmin>);
});

describe('tenant detail feature', () => {
  it('uses a single action dropdown for real mutations without duplicating brand navigation', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (init?.method === 'PUT') return Promise.resolve({});
      expect(path).toBe('/api/tenants/tenant-1');
      return Promise.resolve({
        id: 'tenant-1',
        name: 'Tenant One',
        code: 'tenant-one',
        status: 'ACTIVE',
        totalBalance: '0',
        customerCount: 0,
        orderCount: 0,
        monthlyOrders: 0,
        createdAt: '2026-06-01T00:00:00.000Z',
      });
    });

    renderWithQuery(<TenantDetailFeature tenantId="tenant-1" />);

    expect(await screen.findByText('Tenant One')).toBeInTheDocument();
    expect(screen.queryByText('tenants.tabProviderAccounts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tenants.operations.more/ }));
    expect(screen.queryByText('tenantBrand.title')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText('tenants.suspend'));

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith('/api/tenants/tenant-1/status', {
        method: 'PUT',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
    });
  });
});
