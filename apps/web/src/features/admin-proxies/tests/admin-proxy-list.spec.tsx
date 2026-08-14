import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminProxyListFeature, buildAdminProxyListPath } from '../proxy-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function proxyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proxy-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    orderId: 'order-1',
    resourceId: 'resource-1',
    providerCode: 'IPIPD',
    providerResourceId: 'US:residential',
    sourceCode: 'US-NY',
    ip: '203.0.113.5',
    port: 8080,
    protocol: 'http',
    countryCode: 'US',
    regionCode: null,
    ipType: 'STATIC',
    status: 'ACTIVE',
    expiresAt: '2026-07-08T00:00:00.000Z',
    businessType: null,
    userNote: null,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('admin proxy list feature', () => {
  it('builds list path with only backend-supported query params', () => {
    expect(buildAdminProxyListPath({ page: 1, pageSize: 20 })).toBe('/api/proxies?page=1&pageSize=20');
    expect(
      buildAdminProxyListPath({
        page: 2,
        pageSize: 20,
        search: '203.0.113.5',
        orderId: 'order-1',
        userId: 'user-1',
        countryCode: 'US',
        status: 'ACTIVE',
        from: '2026-06-01',
        to: '2026-07-01',
      }),
    ).toBe(
      '/api/proxies?page=2&pageSize=20&search=203.0.113.5&orderId=order-1&userId=user-1&countryCode=US&status=ACTIVE&from=2026-06-01&to=2026-07-01',
    );
  });

  it('passes search filter into the GET /api/proxies query', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [proxyRow()],
    });

    renderWithQuery(<AdminProxyListFeature />);
    await screen.findByText('203.0.113.5:8080');

    const search = screen.getByPlaceholderText('adminProxies.searchPlaceholder');
    fireEvent.change(search, { target: { value: 'order-1' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes('search=order-1'))).toBe(true),
    );
  });

  it('does not render any admin lifecycle/renew action (USER-only backend)', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [proxyRow()],
    });

    renderWithQuery(<AdminProxyListFeature />);
    await screen.findByText('203.0.113.5:8080');

    expect(screen.queryByText('adminProxies.renew')).not.toBeInTheDocument();
    expect(screen.queryByText('adminProxies.changePassword')).not.toBeInTheDocument();
    expect(screen.queryByText('adminProxies.switchIp')).not.toBeInTheDocument();
  });

  it('opens a read-only detail drawer from the row without an extra request', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [proxyRow()],
    });

    renderWithQuery(<AdminProxyListFeature />);
    await screen.findByText('203.0.113.5:8080');

    const callsBefore = spy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'adminProxies.viewDetail' }));

    expect(await screen.findByText('adminProxies.detailTitle')).toBeInTheDocument();
    expect(spy.mock.calls.length).toBe(callsBefore);
    expect(spy.mock.calls.every((c) => !/\/api\/proxies\/proxy-1$/.test(String(c[0])))).toBe(true);
    expect(screen.getByText('adminProxies.updatedAt')).toBeInTheDocument();
    expect(screen.getAllByText(/adminProxies.resourceId/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/adminProxies.providerResourceId/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/US:residential/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/adminProxies.sourceCode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/US-NY/).length).toBeGreaterThan(0);
  });

  it('shows the backend reasonKey on list error', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'));

    renderWithQuery(<AdminProxyListFeature />);

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
  });
});
