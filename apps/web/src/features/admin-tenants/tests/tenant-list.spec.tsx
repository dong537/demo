import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantListFeature } from '../tenant-list.feature';
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

describe('tenant list feature', () => {
  it('omits the admin setup tutorial and keeps the create action available', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });

    renderWithQuery(<TenantListFeature />);

    expect(await screen.findByText('tenants.title')).toBeInTheDocument();
    expect(screen.queryByText('tenants.setupGuide.title')).not.toBeInTheDocument();
    expect(screen.queryByText('tenants.setupGuide.notice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tenants.create/ }));

    expect(navigateMock).toHaveBeenCalledWith({ to: '/admin/tenants/new' });
  });

  it('keeps tenant row operations behind one dropdown and calls real suspend endpoint', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (init?.method === 'PUT') return Promise.resolve({});
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [
          {
            id: 'tenant-1',
            name: 'Tenant One',
            code: 'tenant-one',
            status: 'ACTIVE',
            customerCount: 0,
            totalBalance: '0',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      });
    });

    renderWithQuery(<TenantListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: /tenants.operations.more/ }));
    fireEvent.click(await screen.findByText('tenants.suspend'));

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith('/api/tenants/tenant-1/status', {
        method: 'PUT',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
    });
  });
});
