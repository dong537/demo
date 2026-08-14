import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResellerProductsFeature } from '../reseller-products.feature';
import { userApiRequest } from '../../../shared/api/client';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      return params?.count === undefined ? key : `${key} ${params.count}`;
    },
  }),
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
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration);
});

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResellerProductsFeature', () => {
  it('lists dedicated-line SKUs and saves a reseller product price through the real reseller endpoint', async () => {
    vi.mocked(userApiRequest)
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [
          {
            skuId: 'sku-sv',
            code: 'SV',
            name: 'Short Video Dedicated Line',
            description: 'Short-video routing contract',
            status: 'ACTIVE',
            availableInventory: 93,
            inventoryCapturedAt: '2026-06-13T00:00:00.000Z',
            inventoryIsStale: false,
            enabled: false,
            unitPrice: null,
            currency: null,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [],
      });

    renderWithQueryClient(<ResellerProductsFeature />);

    expect(await screen.findByText('Short Video Dedicated Line')).toBeInTheDocument();
    expect(screen.getByText('SV')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.products.mainSite')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.products.sourceTruth')).toBeInTheDocument();
    expect(screen.queryByText('IPIPD')).not.toBeInTheDocument();
    expect(screen.queryByText('Short-video routing contract')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '28' } });
    fireEvent.click(screen.getByRole('button', { name: /save$/i }));

    await waitFor(() => {
      expect(userApiRequest).toHaveBeenCalledWith('/api/customer/reseller/products', {
        method: 'POST',
        body: JSON.stringify({
          skuId: 'sku-sv',
          enabled: true,
          unitPrice: '28',
          currency: 'CNY',
        }),
      });
    });
    expect(vi.mocked(userApiRequest).mock.calls[0][0]).toBe('/api/customer/reseller/products?page=1&pageSize=20');
    expect(vi.mocked(userApiRequest).mock.calls.some((call) => String(call[0]).startsWith('/api/resources'))).toBe(false);
  });
});
