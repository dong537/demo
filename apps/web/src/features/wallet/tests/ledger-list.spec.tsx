import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LedgerListFeature } from '../ledger-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'ledger.reverse.reason') return `退回流水 ${values?.ledgerId}`;
      if (key === 'ledger.reverse.button') return '退回这笔';
      if (key === 'ledger.adjust.submit') return '确认修改';
      if (key === 'ledger.adjust.credit') return '增加 (+)';
      if (key === 'ledger.reasonValue.payment_order_confirmed') return '充值到账';
      if (key === 'ledger.reasonValue.static_proxy_order') return '购买静态代理';
      if (key === 'ledger.reasonValue.fulfillment_failed_refund') return '购买失败退款';
      if (key === 'ledger.reasonFallback.expense') return '余额支出';
      return key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => 'idem-1' },
  });
});

describe('admin ledger list operations', () => {
  it('does not query or render a fake empty ledger before a user id is selected', () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(<LedgerListFeature />);

    expect(screen.getByText('ledger.userIdPlaceholder')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads a user ledger immediately when an initial user id is provided', async () => {
    const calls: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      calls.push(path);
      if (path === '/api/wallet/user-1') return Promise.resolve(wallet());
      if (path.startsWith('/api/wallet/user-1/ledger')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [ledgerEntry({ id: 'ledger-1', amount: '-18.5', relatedId: 'order-1' })],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<LedgerListFeature initialUserId="user-1" />);

    expect(await screen.findByText('order-1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ledger.userIdPlaceholder')).toHaveValue('user-1');
    expect(calls).toContain('/api/wallet/user-1');
    expect(calls.some((path) => path.startsWith('/api/wallet/user-1/ledger'))).toBe(true);
  });

  it('reverses a ledger row through the audited wallet adjust endpoint', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (path === '/api/wallet/user-1') return Promise.resolve(wallet());
      if (path.startsWith('/api/wallet/user-1/ledger')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [ledgerEntry({ id: 'ledger-1', amount: '-18.5', relatedId: 'order-1' })],
        });
      }
      if (path === '/api/wallet/user-1/adjust' && init?.method === 'POST') {
        return Promise.resolve({ ...wallet(), available: '118.50' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<LedgerListFeature />);

    fireEvent.change(screen.getByPlaceholderText('ledger.userIdPlaceholder'), {
      target: { value: 'user-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));

    expect(await screen.findByText('order-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退回这笔' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: '增加 (+)' })).toBeChecked();
    expect(within(dialog).getByRole('spinbutton')).toHaveValue('18.50');
    expect(within(dialog).getByRole('textbox')).toHaveValue('退回流水 ledger-1');

    fireEvent.click(within(dialog).getByRole('button', { name: '确认修改' }));
    const submitButtons = await screen.findAllByRole('button', { name: '确认修改' });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/wallet/user-1/adjust')).toBe(true),
    );
    const adjustCall = calls.find((call) => call.path === '/api/wallet/user-1/adjust')!;
    expect(JSON.parse(adjustCall.init?.body as string)).toEqual({
      direction: 'credit',
      amount: '18.5',
      currency: 'USD',
      reason: '退回流水 ledger-1',
      idempotencyKey: 'idem-1',
    });
  });

  it('shows plain-language ledger reasons instead of backend reason keys', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/wallet/user-1') return Promise.resolve(wallet());
      if (path.startsWith('/api/wallet/user-1/ledger')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 4,
          items: [
            ledgerEntry({ id: 'ledger-deposit', amount: '1000', relatedId: 'order-1', reason: 'payment_order_confirmed', type: 'DEPOSIT' }),
            ledgerEntry({ id: 'ledger-debit', amount: '-28', relatedId: 'order-2', reason: 'static_proxy_order', type: 'DEBIT' }),
            ledgerEntry({ id: 'ledger-refund', amount: '28', relatedId: 'order-3', reason: 'fulfillment_failed_refund', type: 'REFUND' }),
            ledgerEntry({ id: 'ledger-unknown', amount: '-5', relatedId: 'order-4', reason: 'unknown_machine_reason', type: 'DEBIT' }),
          ],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<LedgerListFeature initialUserId="user-1" />);

    expect(await screen.findByText('充值到账')).toBeInTheDocument();
    expect(screen.getByText('购买静态代理')).toBeInTheDocument();
    expect(screen.getByText('购买失败退款')).toBeInTheDocument();
    expect(screen.getByText('余额支出')).toBeInTheDocument();
    expect(screen.queryByText('payment_order_confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('static_proxy_order')).not.toBeInTheDocument();
    expect(screen.queryByText('fulfillment_failed_refund')).not.toBeInTheDocument();
    expect(screen.queryByText('unknown_machine_reason')).not.toBeInTheDocument();
  });

  it('opens the related order fulfillment detail from a ledger row', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/wallet/user-1') return Promise.resolve(wallet());
      if (path.startsWith('/api/wallet/user-1/ledger')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [ledgerEntry({ id: 'ledger-1', amount: '-18.5', relatedId: 'order-1' })],
        });
      }
      if (path === '/api/orders/order-1/fulfillment') {
        return Promise.resolve({
          taskStatus: 'COMPLETED',
          upstreamImage: 'provider-image',
          proxies: [],
          operationLogs: [],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<LedgerListFeature />);

    fireEvent.change(screen.getByPlaceholderText('ledger.userIdPlaceholder'), {
      target: { value: 'user-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));

    fireEvent.click(await screen.findByRole('button', { name: 'order-1' }));

    expect(await screen.findByText('adminOrders.fulfillment.title')).toBeInTheDocument();
    expect(await screen.findByText('provider-image')).toBeInTheDocument();
  });
});

function wallet() {
  return {
    id: 'wallet-1',
    userId: 'user-1',
    available: '100.00',
    frozen: '0.00',
    currency: 'USD',
    updatedAt: '2026-06-09T00:00:00.000Z',
  };
}

function ledgerEntry(input: { id: string; amount: string; relatedId: string | null; reason?: string; type?: string }) {
  return {
    id: input.id,
    type: input.type ?? 'DEBIT',
    amount: input.amount,
    balanceAfter: '81.50',
    currency: 'USD',
    relatedId: input.relatedId,
    reason: input.reason ?? 'order debit',
    createdAt: '2026-06-09T00:00:00.000Z',
  };
}
