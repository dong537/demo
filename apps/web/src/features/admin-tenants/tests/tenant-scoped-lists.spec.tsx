import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserListFeature } from '../../admin-users/user-list.feature';
import { OrderListFeature } from '../../admin-orders/order-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('tenant scoped admin lists', () => {
  it('passes tenantId when listing reseller users', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(<UserListFeature tenantId="tenant-1" hideTitle />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toContain('/api/users?');
    expect(spy.mock.calls[0][0]).toContain('tenantId=tenant-1');
  });

  it('passes tenantId when listing reseller orders', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(<OrderListFeature tenantId="tenant-1" hideTitle />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toContain('/api/orders?');
    expect(spy.mock.calls[0][0]).toContain('tenantId=tenant-1');
  });

  it('passes userId when filtering admin orders by customer', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(<OrderListFeature hideTitle />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('adminOrders.userIdFilter'), {
      target: { value: 'user-1' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('adminOrders.userIdFilter'), {
      key: 'Enter',
      code: 'Enter',
    });

    await waitFor(() => expect(spy.mock.calls.some(([path]) => path.includes('userId=user-1'))).toBe(true));
  });
});
