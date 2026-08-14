import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentListFeature } from '../payment-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'payments.statusValue.PENDING': '待确认',
        'payments.statusValue.CONFIRMING': '确认中',
        'payments.statusValue.COMPLETED': '已到账',
        'payments.statusValue.FAILED': '未成功',
        'payments.statusValue.REFUNDED': '已退回',
        'payments.statusValue.UNKNOWN': '未知状态',
        'payments.channelValue.MANUAL': '人工确认',
        'payments.channelValue.UNKNOWN': '未知渠道',
        'payments.reason.payment_already_confirmed': '这笔支付单已经确认，不能重复确认',
        'payments.reason.generic': '支付单确认失败，请刷新后重试',
        'users.statusValue.ACTIVE': '正常',
        'users.statusValue.UNKNOWN': '未知状态',
      };
      return translations[key] ?? key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, invalidateSpy, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('PaymentListFeature', () => {
  it('loads pending recharge applications by default from the real payments endpoint', async () => {
    const calls: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      calls.push(path);
      if (String(path).startsWith('/api/payments')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [paymentOrder()],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<PaymentListFeature />);

    expect(await screen.findByText('100.00 CNY')).toBeInTheDocument();
    expect(screen.getByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('人工确认')).toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    expect(calls[0]).toContain('/api/payments?');
    expect(calls[0]).toContain('status=PENDING');
  });

  it('shows the payment customer account information instead of only the user id', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (String(path).startsWith('/api/payments')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [paymentOrder()],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<PaymentListFeature />);

    expect(await screen.findByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getByText('Alice / 13800138000')).toBeInTheDocument();
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'payments.confirmBtn' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('customer@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('Alice / 13800138000')).toBeInTheDocument();
  });

  it('confirms a pending recharge and invalidates list plus pending count', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (String(path).startsWith('/api/payments') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [paymentOrder()],
        });
      }
      if (path === '/api/payments/pay-1/confirm' && init?.method === 'POST') {
        return Promise.resolve({});
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    const { invalidateSpy } = renderWithQuery(<PaymentListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'payments.confirmBtn' }));
    const dialog = await screen.findByRole('dialog');
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'bank received' } });
    await waitFor(() => expect(textarea.value).toBe('bank received'));
    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => expect(calls.some((call) => call.path === '/api/payments/pay-1/confirm')).toBe(true));
    expect(JSON.parse(calls.find((call) => call.path === '/api/payments/pay-1/confirm')?.init?.body as string)).toEqual({
      reason: 'bank received',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments', 'pending-count'] });
  });

  it('trims the confirmation reason before posting', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (String(path).startsWith('/api/payments') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [paymentOrder()],
        });
      }
      if (path === '/api/payments/pay-1/confirm' && init?.method === 'POST') {
        return Promise.resolve({});
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<PaymentListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'payments.confirmBtn' }));
    const dialog = await screen.findByRole('dialog');
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  bank received  ' } });
    await waitFor(() => expect(textarea.value).toBe('  bank received  '));
    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => expect(calls.some((call) => call.path === '/api/payments/pay-1/confirm')).toBe(true));
    expect(JSON.parse(calls.find((call) => call.path === '/api/payments/pay-1/confirm')?.init?.body as string)).toEqual({
      reason: 'bank received',
    });
  });

  it('shows a readable confirmation failure instead of the backend reasonKey', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (String(path).startsWith('/api/payments') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [paymentOrder()],
        });
      }
      if (path === '/api/payments/pay-1/confirm' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('VALIDATION_ERROR', 'payment_already_confirmed'));
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<PaymentListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'payments.confirmBtn' }));
    const dialog = await screen.findByRole('dialog');
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'bank received' } });
    fireEvent.submit(textarea.closest('form')!);

    expect(await screen.findByText('这笔支付单已经确认，不能重复确认')).toBeInTheDocument();
    expect(screen.queryByText('payment_already_confirmed')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

function paymentOrder() {
  return {
    id: 'pay-1',
    userId: 'user-1',
    user: {
      id: 'user-1',
      email: 'customer@example.com',
      name: 'Alice',
      phone: '13800138000',
      status: 'ACTIVE',
    },
    amount: '100.00',
    currency: 'CNY',
    channel: 'MANUAL',
    status: 'PENDING',
    createdAt: '2026-06-11T00:00:00.000Z',
  };
}
