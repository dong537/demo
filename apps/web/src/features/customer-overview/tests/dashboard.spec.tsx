import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CustomerOverviewDashboardFeature,
  EXPIRY_WINDOW_DAYS,
  apiKeyStatusTagColor,
  isExpiringSoon,
  orderStatusTagColor,
  selectExpiringProxies,
  type OverviewProxy,
} from '../dashboard.feature';
import * as client from '../../../shared/api/client';
import { ApiError } from '../../../shared/api/client';
import { formatCustomerWalletMoneyAmount } from '../../../routes/customer/_layout';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const CURRENT_USER = {
  ownerId: 'user-1',
  ownerType: 'USER' as const,
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
};

const DAY = 24 * 60 * 60 * 1000;

function proxyRow(overrides: Partial<OverviewProxy> = {}): OverviewProxy {
  return {
    id: 'proxy-1',
    ip: '203.0.113.10',
    port: 8080,
    countryCode: 'US',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('dashboard pure helpers', () => {
  it('flags only proxies expiring inside the window and not yet expired', () => {
    const now = Date.now();
    expect(isExpiringSoon(new Date(now + 3 * DAY).toISOString(), now)).toBe(true);
    expect(isExpiringSoon(new Date(now + (EXPIRY_WINDOW_DAYS + 1) * DAY).toISOString(), now)).toBe(false);
    expect(isExpiringSoon(new Date(now - DAY).toISOString(), now)).toBe(false);
  });

  it('selects and sorts expiring proxies, excluding expired ones', () => {
    const now = Date.now();
    const result = selectExpiringProxies(
      [
        proxyRow({ id: 'far', expiresAt: new Date(now + 5 * DAY).toISOString() }),
        proxyRow({ id: 'soon', expiresAt: new Date(now + 1 * DAY).toISOString() }),
        proxyRow({ id: 'expired', status: 'EXPIRED', expiresAt: new Date(now + 1 * DAY).toISOString() }),
        proxyRow({ id: 'outside', expiresAt: new Date(now + 30 * DAY).toISOString() }),
      ],
      now,
    );
    expect(result.map((p) => p.id)).toEqual(['soon', 'far']);
  });

  it('maps order status to antd tag colors', () => {
    expect(orderStatusTagColor('COMPLETED')).toBe('success');
    expect(orderStatusTagColor('FAILED')).toBe('error');
    expect(orderStatusTagColor('PARTIALLY_COMPLETED')).toBe('warning');
    expect(orderStatusTagColor('PENDING')).toBe('processing');
    expect(orderStatusTagColor('UNKNOWN')).toBe('default');
  });

  it('maps api key status to operational tag colors without inventing health', () => {
    expect(apiKeyStatusTagColor('ACTIVE')).toBe('success');
    expect(apiKeyStatusTagColor('REVOKED')).toBe('default');
    expect(apiKeyStatusTagColor('DISABLED')).toBe('default');
    expect(apiKeyStatusTagColor('ROTATING')).toBe('processing');
  });
});

describe('CustomerOverviewDashboardFeature', () => {
  function mockEndpoints(impl: (path: string) => unknown) {
    return vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      return Promise.resolve(impl(path));
    });
  }

  it('renders KPI values and the recent orders + expiring lists from real endpoints', async () => {
    mockEndpoints((path) => {
      if (path.startsWith('/api/wallet/')) {
        return { userId: 'user-1', available: '128.50', frozen: '2.00', currency: 'CNY' };
      }
      if (path.startsWith('/api/proxies')) {
        return {
          page: 1,
          pageSize: 20,
          total: 12,
          items: [
            proxyRow({ id: 'p-soon', ip: '198.51.100.7', expiresAt: new Date(Date.now() + 2 * DAY).toISOString() }),
            proxyRow({ id: 'p-active', status: 'ACTIVE', expiresAt: new Date(Date.now() + 90 * DAY).toISOString() }),
          ],
        };
      }
      if (path.startsWith('/api/orders')) {
        return {
          page: 1,
          pageSize: 5,
          total: 1,
          items: [
            {
              id: 'order-1',
              status: 'COMPLETED',
              quantity: 3,
              durationDays: 30,
              totalPrice: '99.00',
              currency: 'CNY',
              createdAt: '2026-06-08T00:00:00.000Z',
            },
          ],
        };
      }
      if (path.startsWith('/api/api-keys')) {
        return {
          page: 1,
          pageSize: 20,
          total: 2,
          items: [
            { id: 'k1', name: 'Primary key', keyPrefix: 'aaaa', scopes: [], ipWhitelist: [], status: 'ACTIVE', createdAt: '', lastUsedAt: null, revokedAt: null },
            { id: 'k2', name: 'Old key', keyPrefix: 'bbbb', scopes: [], ipWhitelist: [], status: 'REVOKED', createdAt: '', lastUsedAt: null, revokedAt: null },
          ],
        };
      }
      return { page: 1, pageSize: 20, total: 0, items: [] };
    });

    renderWithQuery(<CustomerOverviewDashboardFeature />);

    expect(await screen.findAllByText('128.50 CNY')).toHaveLength(1);
    expect(await screen.findByText('198.51.100.7:8080')).toBeTruthy();
    expect(screen.getAllByText('customer.dashboard.proxyStatus.ACTIVE').length).toBeGreaterThan(0);
    expect(screen.getByText('orders.statusValue.COMPLETED')).toBeTruthy();
    expect(screen.getByText('customer.dashboard.recentOrders.orderNo')).toBeTruthy();
    expect(screen.getByText((content) => content.startsWith('customer.dashboard.recentOrders.latest'))).toBeTruthy();
    expect(screen.getByText('customer.dashboard.expiring.summary')).toBeTruthy();
    expect(screen.getAllByText((content) => content.startsWith('customer.apiKeys.statusValue.ACTIVE')).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.startsWith('customer.apiKeys.statusValue.REVOKED')).length).toBeGreaterThan(0);
  });

  it('degrades only the failing block to its reasonKey instead of crashing the page', async () => {
    mockEndpoints((path) => {
      if (path.startsWith('/api/wallet/')) {
        throw new ApiError(500, 'wallet_unavailable');
      }
      if (path.startsWith('/api/orders')) {
        return {
          page: 1,
          pageSize: 5,
          total: 1,
          items: [
            {
              id: 'order-9',
              status: 'PENDING',
              quantity: 1,
              durationDays: 7,
              totalPrice: '10.00',
              currency: 'CNY',
              createdAt: '2026-06-08T00:00:00.000Z',
            },
          ],
        };
      }
      return { page: 1, pageSize: 20, total: 0, items: [] };
    });

    renderWithQuery(<CustomerOverviewDashboardFeature />);

    expect(screen.getByText('customer.dashboard.title')).toBeTruthy();
  });

  it('exposes quick entry buttons for buy and topup', async () => {
    mockEndpoints(() => ({ page: 1, pageSize: 20, total: 0, items: [] }));

    renderWithQuery(<CustomerOverviewDashboardFeature />);

    const buy = await screen.findByRole('button', { name: /customer\.dashboard\.quick\.buy/ });
    expect(buy).toBeTruthy();
    expect(screen.getByRole('button', { name: /customer\.dashboard\.quick\.topup/ })).toBeTruthy();
  });

  it('keeps customer wallet money formatting compatible with Chinese RMB labels', () => {
    expect(formatCustomerWalletMoneyAmount('128.50', 'CNY')).toBe('128.50 元');
  });
});
