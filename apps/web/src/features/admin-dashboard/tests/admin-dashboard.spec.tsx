import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminDashboardFeature } from '../admin-dashboard.feature';
import * as client from '../../../shared/api/client';
import { clearCurrentUserCache } from '../../../shared/auth/current-user';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCurrentUserCache('admin');
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('AdminDashboardFeature', () => {
  it('renders platform dashboard KPIs from real admin endpoints', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      paths.push(String(path));
      if (path === '/api/auth/me') {
        return Promise.resolve({ ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null, scopes: [] });
      }
      if (path.startsWith('/api/tenants')) return Promise.resolve({ page: 1, pageSize: 20, total: 2, items: [] });
      if (path.startsWith('/api/users')) return Promise.resolve({ page: 1, pageSize: 20, total: 9, items: [{ id: 'u1', email: 'a@example.com', status: 'ACTIVE' }] });
      if (path.startsWith('/api/orders')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 4,
          items: [{ id: 'order-1', status: 'PENDING', totalPrice: '88.00', currency: 'CNY', quantity: 2, createdAt: '2026-06-10T00:00:00.000Z' }],
        });
      }
      if (path.startsWith('/api/proxies')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 7,
          items: [{ id: 'p1', status: 'ACTIVE', providerCode: 'IPIPD', countryCode: 'JP', createdAt: '2026-06-10T00:00:00.000Z' }],
        });
      }
      if (path.startsWith('/api/resources')) return Promise.resolve({ page: 1, pageSize: 20, total: 3, items: [{ id: 'r1', status: 'ACTIVE', isSaleable: true, stock: 12, inventoryIsStale: false }] });
      if (path === '/api/providers') return Promise.resolve([{ id: 'pa-1', providerCode: 'IPIPD', status: 'ACTIVE' }]);
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<AdminDashboardFeature />);

    expect(await screen.findByText('adminDashboard.title')).toBeInTheDocument();
    expect(paths.some((path) => path.startsWith('/api/tenants'))).toBe(true);
    expect(await screen.findByText('adminDashboard.metrics.todayRevenue')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.metrics.totalIp')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.summary.title')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.recentOrders.title')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.charts.userDistribution')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.charts.providerDistribution')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.charts.orderStatus')).toBeInTheDocument();
    expect(screen.getByText('ipmigo 平台')).toBeInTheDocument();
    expect(screen.queryByText(/adminDashboard\.metrics\.todayDelta/)).not.toBeInTheDocument();
    expect(screen.queryByText('adminDashboard.table.sales')).not.toBeInTheDocument();
    expect(screen.queryByText('adminDashboard.summary.knownStock')).not.toBeInTheDocument();
    expect(screen.queryByText('adminDashboard.ops.resourcesWithKnownStock')).not.toBeInTheDocument();
    expect(screen.queryByText('adminDashboard.ops.staleResources')).not.toBeInTheDocument();
    expect(paths.some((path) => path === '/api/providers')).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/users'))).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/orders'))).toBe(true);
  });

  it('does not call platform provider health for tenant admins', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      paths.push(String(path));
      if (path === '/api/auth/me') {
        return Promise.resolve({ ownerId: 'admin-1', ownerType: 'TENANT_ADMIN', siteId: 'site-1', tenantId: 'tenant-1', scopes: [] });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<AdminDashboardFeature />);

    expect(await screen.findByText('adminDashboard.title')).toBeInTheDocument();
    expect(paths.some((path) => path === '/api/providers')).toBe(false);
    expect(paths.some((path) => path.startsWith('/api/tenants'))).toBe(false);
    expect(paths.some((path) => path.includes('tenantId=tenant-1'))).toBe(true);
  });
});
