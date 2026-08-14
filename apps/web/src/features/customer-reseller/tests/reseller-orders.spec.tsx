import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResellerOrdersFeature } from '../reseller-orders.feature';
import { userApiRequest } from '../../../shared/api/client';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return { ...actual, userApiRequest: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration);
});

it('renders the dedicated-line order projection without legacy proxy fields', async () => {
  vi.mocked(userApiRequest).mockResolvedValue({
    page: 1,
    pageSize: 20,
    total: 1,
    items: [{
      id: 'line-order-1',
      userId: 'customer-1',
      user: { email: 'customer@example.com' },
      sku: { code: 'SV', name: 'Short Video Dedicated Line' },
      countryCode: 'HK',
      regionCode: null,
      businessType: null,
      quantity: 2,
      durationDays: 30,
      unitPrice: '28',
      totalPrice: '56',
      currency: 'CNY',
      priceSource: 'TENANT_DEFAULT_TEMPLATE',
      contractVersion: 1,
      execution: {
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 5,
        lastErrorCode: null,
        createdAt: '2026-08-11T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
      },
      lineStatuses: {},
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-11T10:00:00.000Z',
    }],
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ResellerOrdersFeature /></QueryClientProvider>);

  expect(await screen.findByText('Short Video Dedicated Line')).toBeInTheDocument();
  expect(screen.getByText('SV')).toBeInTheDocument();
  expect(screen.getByText('HK')).toBeInTheDocument();
  expect(screen.getByText('56.00 CNY')).toBeInTheDocument();
  expect(screen.queryByText('STATIC_PROXY')).not.toBeInTheDocument();
  expect(vi.mocked(userApiRequest)).toHaveBeenCalledWith('/api/customer/reseller/orders?page=1&pageSize=20');
});
