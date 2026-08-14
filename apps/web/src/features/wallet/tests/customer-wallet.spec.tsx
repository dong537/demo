import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerWalletOverviewFeature } from '../customer-wallet-overview.feature';
import { CustomerLedgerListFeature } from '../customer-ledger-list.feature';
import { CreatePaymentOrderFeature } from '../create-payment-order.feature';
import * as client from '../../../shared/api/client';
import { ApiError } from '../../../shared/api/client';
import { clearCurrentUserCache } from '../../../shared/auth/current-user';
import { formatDateTime } from '../../../shared/time/time';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'customer.ledger.transactionNo') return `交易号尾号 ${values?.id}`;
      const labels: Record<string, string> = {
        'customer.ledger.record': '流水说明',
        'customer.ledger.direction.credit': '收入',
        'customer.ledger.direction.debit': '支出',
        'customer.ledger.direction.neutral': '调整',
        'customer.ledger.reasonValue.payment_order_confirmed': '充值到账',
        'customer.ledger.reasonValue.static_proxy_order': '购买静态代理',
        'customer.ledger.reasonValue.fulfillment_failed_refund': '购买失败退款',
        'customer.ledger.reasonFallback.income': '余额入账',
        'customer.ledger.reasonFallback.expense': '余额支出',
        'customer.ledger.reasonFallback.neutral': '余额调整',
        'customer.ledger.typeUnknown': '余额变动',
        'ledger.typeValue.DEPOSIT': '充值入账',
        'ledger.typeValue.DEBIT': '消费扣款',
        'ledger.typeValue.REFUND': '失败退款',
        'ledger.balanceAfter': '余额',
        'customer.topup.reason.generic': '充值单暂时无法提交',
      };
      return labels[key] ?? key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return { invalidateSpy, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCurrentUserCache();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => 'idem-1' },
  });
});

describe('CustomerWalletOverviewFeature', () => {
  it('shows permission alert instead of empty/default balance', async () => {
    vi.spyOn(client, 'userApiRequest').mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED'));
    renderWithQuery(<CustomerWalletOverviewFeature />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('permissionDenied');
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows error alert instead of zero balance when API fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR'));
    renderWithQuery(<CustomerWalletOverviewFeature />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('reads current user before requesting wallet balance', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({
        ownerId: 'user-123',
        ownerType: 'USER',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        scopes: [],
      })
      .mockResolvedValueOnce({
        userId: 'user-123',
        available: '88.50',
        frozen: '1.00',
        currency: 'CNY',
      });

    renderWithQuery(<CustomerWalletOverviewFeature />);

    expect(await screen.findByText('88.50 CNY')).toBeTruthy();
    expect(screen.queryByText('1.00 CNY')).toBeNull();
    expect(screen.queryByText('customer.overview.composition')).toBeNull();
    expect(screen.queryByText('customer.overview.availableRatio')).toBeNull();
    expect(screen.queryByText('customer.overview.accountId')).toBeNull();
    expect(screen.queryByText('customer.overview.currency')).toBeNull();
    expect(screen.queryByText('customer.overview.statusSummary')).toBeNull();
    expect(screen.queryByText('customer.overview.source')).toBeNull();
    expect(screen.getByText('customer.overview.topupBtn')).toBeTruthy();
    expect(screen.getByText('refresh')).toBeTruthy();
    expect(spy).toHaveBeenNthCalledWith(1, '/api/auth/me');
    expect(spy).toHaveBeenNthCalledWith(2, '/api/wallet/user-123');
  });
});

describe('CustomerLedgerListFeature', () => {
  it('combines real ledger fields and page direction totals for scanability', async () => {
    vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({
        ownerId: 'user-123',
        ownerType: 'USER',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        scopes: [],
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 20,
        total: 3,
        items: [
          {
            id: '8fad61c3-959a-49a5-b17b-12345678',
            type: 'DEPOSIT',
            amount: '100',
            balanceAfter: '100',
            currency: 'CNY',
            reason: 'payment_order_confirmed',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: '28d268db-aaf9-4bd2-a521-87654321',
            type: 'DEBIT',
            amount: '-28',
            balanceAfter: '72',
            currency: 'CNY',
            reason: 'static_proxy_order',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          {
            id: '02a09bc9-34a1-4b9a-a5b5-abcdef12',
            type: 'REFUND',
            amount: '28',
            balanceAfter: '100',
            currency: 'CNY',
            reason: 'fulfillment_failed_refund',
            createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      });

    renderWithQuery(<CustomerLedgerListFeature />);

    expect(await screen.findAllByText('100.00 CNY')).not.toHaveLength(0);
    expect(screen.getAllByText('-28.00 CNY')).not.toHaveLength(0);
    expect(screen.getByText('余额: 72.00 CNY')).toBeTruthy();
    expect(screen.getAllByText('收入')).not.toHaveLength(0);
    expect(screen.getByText('支出')).toBeTruthy();
    expect(screen.getByText('充值')).toBeTruthy();
    expect(screen.getByText('消费')).toBeTruthy();
    expect(screen.getByText('退款')).toBeTruthy();
    expect(screen.getByText('充值到账')).toBeTruthy();
    expect(screen.getByText('购买静态代理')).toBeTruthy();
    expect(screen.getByText('购买失败退款')).toBeTruthy();
    expect(screen.getByText('交易号尾号 12345678')).toBeTruthy();
    expect(screen.getByText('交易号尾号 87654321')).toBeTruthy();
    expect(screen.getByText('交易号尾号 abcdef12')).toBeTruthy();
    expect(screen.queryByText('payment_order_confirmed')).toBeNull();
    expect(screen.queryByText('static_proxy_order')).toBeNull();
    expect(screen.queryByText('fulfillment_failed_refund')).toBeNull();
    expect(screen.queryByText('ledger.direction.credit')).toBeNull();
    expect(screen.queryByText('8fad61c3-959a-49a5-b17b-12345678')).toBeNull();
    expect(screen.getByText(formatDateTime('2026-01-01T00:00:00.000Z'))).toBeTruthy();
    expect(screen.getByText(formatDateTime('2026-01-02T00:00:00.000Z'))).toBeTruthy();
    expect(screen.getAllByText('余额: 100.00 CNY')).not.toHaveLength(0);
  });
});

describe('CreatePaymentOrderFeature', () => {
  it('blocks submit when amount is zero', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({
        ownerId: 'user-123',
        ownerType: 'USER',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        scopes: [],
      })
      .mockResolvedValueOnce({ currency: 'CNY' });
    renderWithQuery(<CreatePaymentOrderFeature />);
    const user = userEvent.setup();

    await screen.findByText('customer.topup.title');
    const amountInput = document.querySelector('input[role="spinbutton"]') as HTMLInputElement;
    await user.type(amountInput, '0');
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(await screen.findByText('customer.topup.amountInvalid')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('blocks submit when amount is negative', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({
        ownerId: 'user-123',
        ownerType: 'USER',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        scopes: [],
      })
      .mockResolvedValueOnce({ currency: 'CNY' });
    renderWithQuery(<CreatePaymentOrderFeature />);
    const user = userEvent.setup();

    await screen.findByText('customer.topup.title');
    const amountInput = document.querySelector('input[role="spinbutton"]') as HTMLInputElement;
    await user.type(amountInput, '-1');
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(await screen.findByText('customer.topup.amountInvalid')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('submits a real top-up request and invalidates wallet server state without editing balance locally', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-123',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-123') return Promise.resolve({ currency: 'CNY' });
      if (path === '/api/payments' && init?.method === 'POST') {
        return Promise.resolve({
          id: 'pay-1',
          amount: '300.00',
          currency: 'CNY',
          status: 'PENDING',
        });
      }
      return Promise.reject(new ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });
    const { invalidateSpy } = renderWithQuery(<CreatePaymentOrderFeature />);
    const user = userEvent.setup();

    await screen.findByText('customer.topup.title');
    await user.click(screen.getByText('300'));
    await user.click(screen.getByRole('button', { name: 'submit' }));

    await screen.findByText('pay-1');
    const paymentCall = calls.find((call) => call.path === '/api/payments');
    expect(paymentCall).toBeTruthy();
    expect(JSON.parse(paymentCall?.init?.body as string)).toEqual({
      amount: '300.00',
      currency: 'CNY',
      channel: 'MANUAL',
      idempotencyKey: 'idem-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customer-wallet', 'user-123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customer-ledger', 'user-123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    expect(screen.queryByText('300.00 CNY')).toBeTruthy();
  });

  it('keeps recharge failures visible and does not render the submitted result state', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-123',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-123') return Promise.resolve({ currency: 'CNY' });
      if (path === '/api/payments' && init?.method === 'POST') {
        return Promise.reject(new ApiError('VALIDATION_ERROR', 'payment_channel_unavailable'));
      }
      return Promise.reject(new ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });
    renderWithQuery(<CreatePaymentOrderFeature />);
    const user = userEvent.setup();

    await screen.findByText('customer.topup.title');
    await user.click(screen.getByText('100'));
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(await screen.findByText('充值单暂时无法提交')).toBeTruthy();
    expect(screen.queryByText('payment_channel_unavailable')).toBeNull();
    expect(screen.queryByText('customer.topup.successTitle')).toBeNull();
  });
});
