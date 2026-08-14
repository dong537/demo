import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerSelfServiceResellerFeature, buildSelfServiceTenantBody } from '../self-service-reseller.feature';
import { ApiError, userApiRequest } from '../../../shared/api/client';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return {
    ...actual,
    userApiRequest: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('CustomerSelfServiceResellerFeature', () => {
  it('builds a trimmed self-service tenant payload', () => {
    expect(buildSelfServiceTenantBody({
      name: '  My Site  ',
      code: '  my-site  ',
    })).toEqual({
      name: 'My Site',
      code: 'my-site',
    });
  });

  it('creates a real customer-owned sub-site without switching to an admin token', async () => {
    vi.mocked(userApiRequest)
      .mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'reseller_not_created'))
      .mockResolvedValueOnce({
        tenant: { id: 'tenant-1', name: 'My Site', code: 'my-site' },
      })
      .mockResolvedValueOnce({
        tenant: { id: 'tenant-1', name: 'My Site', code: 'my-site', status: 'ACTIVE', customerCount: 0 },
        stats: { customerCount: 0, orderCount: 0, monthlyOrders: 0, templateCount: 0, balanceByCurrency: {} },
      });

    renderWithQueryClient(<CustomerSelfServiceResellerFeature />);

    expect(await screen.findByText('customer.reseller.flow.open')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.flow.products')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('customer.reseller.name'), { target: { value: 'My Site' } });
    fireEvent.change(screen.getByLabelText('customer.reseller.code'), { target: { value: 'my-site' } });
    fireEvent.click(screen.getByRole('button', { name: 'customer.reseller.submit' }));

    await waitFor(() => {
      expect(userApiRequest).toHaveBeenCalledWith('/api/tenants/self-service', {
        method: 'POST',
        body: JSON.stringify({
          name: 'My Site',
          code: 'my-site',
        }),
      });
    });
    expect(vi.mocked(userApiRequest).mock.calls.some((call) => String(call[0]).startsWith('/api/resources'))).toBe(false);
    expect(sessionStorage.getItem('admin_token')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalledWith({ to: '/admin/dashboard' });
  });
});
