import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderListFeature } from '../order-list.feature';
import {
  AdminOrderOperations,
  buildAdminOrderOperationPath,
  getAvailableAdminOrderOperations,
} from '../admin-order-operations.feature';
import * as client from '../../../shared/api/client';
import { formatProviderLabel } from '../../../shared/provider/provider-labels';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      open: vi.fn(),
      destroy: vi.fn(),
      config: vi.fn(),
      useMessage: actual.message.useMessage,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'adminOrders.operations.resultStatus') return `status:${values?.status}`;
      if (key === 'adminOrders.operations.resultFulfillmentJob') return `job:${values?.id}`;
      if (key === 'adminOrders.operations.resultWallet') return `wallet:${values?.available}:${values?.currency}`;
      if (key === 'adminOrders.failureReasons.provider_down') return '上游线路暂时不可用';
      return key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { queryClient, invalidateSpy, ...view };
}

async function openOrderOperation(operationButtonKey: string) {
  fireEvent.click(await screen.findAllByRole('button', { name: 'adminOrders.operations.more' }).then((buttons) => buttons[0]!));
  fireEvent.click(await screen.findByText(operationButtonKey));
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockReset();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('admin order operation contracts', () => {
  it('builds encoded admin order operation paths', () => {
    expect(buildAdminOrderOperationPath('order 1', 'retry-fulfillment')).toBe('/api/orders/order%201/retry-fulfillment');
  });

  it('shows only valid operations for each order status', () => {
    expect(getAvailableAdminOrderOperations('FAILED')).toEqual(['retry-fulfillment', 'refund', 'manual-complete']);
    expect(getAvailableAdminOrderOperations('PENDING')).toEqual(['refund', 'manual-complete']);
    expect(getAvailableAdminOrderOperations('FULFILLING')).toEqual(['refund', 'manual-complete']);
    expect(getAvailableAdminOrderOperations('COMPLETED')).toEqual([]);
    expect(getAvailableAdminOrderOperations('REFUNDED')).toEqual([]);
  });

  it('does not render an empty more-actions menu for rows without operations', () => {
    renderWithQuery(<AdminOrderOperations order={{ id: 'order-completed', status: 'COMPLETED' }} />);

    expect(screen.queryByRole('button', { name: 'adminOrders.operations.more' })).not.toBeInTheDocument();
  });

  it('keeps the more-actions menu accessible and routes colliding keys correctly', async () => {
    const extraClick = vi.fn();
    renderWithQuery(
      <AdminOrderOperations
        order={{ id: 'order-failed', status: 'FAILED' }}
        extraItems={[
          {
            key: 'refund',
            label: 'extra refund action',
            onClick: extraClick,
          },
        ]}
      />,
    );

    const moreButton = screen.getByRole('button', { name: 'adminOrders.operations.more' });
    expect(moreButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moreButton);
    expect(moreButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(await screen.findByText('extra refund action'));

    expect(extraClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('adminOrders.operations.refund.title')).not.toBeInTheDocument();
    await waitFor(() => expect(moreButton).toHaveAttribute('aria-expanded', 'false'));

    fireEvent.click(moreButton);
    fireEvent.click(await screen.findByText('adminOrders.operations.refund.button'));

    expect(await screen.findByText('adminOrders.operations.refund.title')).toBeInTheDocument();
    expect(extraClick).toHaveBeenCalledTimes(1);
  });

  it('renders failure operations and hides invalid completed-order operations', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 2,
      items: [failedOrder(), completedOrder()],
    });

    renderWithQuery(<OrderListFeature />);

    expect(await screen.findByText('order-failed')).toBeInTheDocument();
    expect(screen.getByText('order-completed')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.orderNo')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.tenantUser')).toBeInTheDocument();
    expect(screen.queryByText('adminOrders.source')).not.toBeInTheDocument();
    expect(screen.getByText('adminOrders.productLocation')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.amount')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.statusFlow')).toBeInTheDocument();
    expect(screen.getAllByText('日本').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(formatProviderLabel('IPIPD'))).toBeInTheDocument();
    expect(screen.getByText('UP-1001')).toBeInTheDocument();
    expect(screen.queryByText('job-failed-1')).not.toBeInTheDocument();
    expect(screen.getAllByText('分站 A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('reseller-a').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('adminOrders.tenantOwner: owner@example.com')).not.toBeInTheDocument();
    expect(screen.getAllByText('buyer@example.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FAILED').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('provider_down')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'adminOrders.operations.more' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'adminOrders.operations.more' })[0]!);
    expect(await screen.findByText('adminOrders.viewDetail')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.viewLedger')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.operations.retry-fulfillment.button')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.operations.refund.button')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.operations.manual-complete.button')).toBeInTheDocument();
  });

  it('keeps the order list focused on filters and table data', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [failedOrder()],
    });

    renderWithQuery(<OrderListFeature />);

    expect(await screen.findByText('order-failed')).toBeInTheDocument();
    expect(screen.queryByText('adminOrders.description')).not.toBeInTheDocument();
    expect(screen.queryByText('adminOrders.sourceTruth')).not.toBeInTheDocument();
    expect(screen.queryByText('adminOrders.operationTruth')).not.toBeInTheDocument();
    expect(screen.queryByText('adminOrders.operationMenuOnly')).not.toBeInTheDocument();
    expect(screen.queryByText('adminOrders.backendOwnsState')).not.toBeInTheDocument();
  });

  it('opens the selected customer ledger records from an order row', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [failedOrder()],
    });

    renderWithQuery(<OrderListFeature />);

    fireEvent.click(await screen.findAllByRole('button', { name: 'adminOrders.operations.more' }).then((buttons) => buttons[0]!));
    fireEvent.click(await screen.findByText('adminOrders.viewLedger'));

    expect(navigateMock).toHaveBeenCalledWith({
      href: '/admin/wallet?userId=user-1',
    });
  });

  it('shows operation logs in the order detail drawer', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/orders?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [failedOrder()],
        });
      }
      if (path === '/api/orders/order-failed/fulfillment') {
        return Promise.resolve({
          taskStatus: 'FAILED',
          upstreamImage: 'IPIPD',
          proxies: [],
          operationLogs: [{
            id: 'audit-1',
            action: 'order.admin_create',
            actorType: 'ADMIN_USER',
            actorId: 'admin-1',
            reason: 'customer requested assisted purchase',
            requestId: 'req-1',
            meta: { targetUserId: 'user-1', reasonKey: 'provider_down' },
            createdAt: '2026-06-08T01:00:00.000Z',
          }],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<OrderListFeature />);

    fireEvent.click(await screen.findAllByRole('button', { name: 'adminOrders.operations.more' }).then((buttons) => buttons[0]!));
    fireEvent.click(await screen.findByText('adminOrders.viewDetail'));

    expect(await screen.findByText('adminOrders.fulfillment.operationLogs')).toBeInTheDocument();
    expect(screen.getByText('order.admin_create')).toBeInTheDocument();
    expect(screen.getByText('ADMIN_USER')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByText('customer requested assisted purchase')).toBeInTheDocument();
    expect(screen.getByText('上游线路暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.fulfillment.technicalDetailRecorded')).toBeInTheDocument();
    expect(screen.queryByText('reasonKey: provider_down')).not.toBeInTheDocument();
  });

  it('keeps order detail drawer usable when fulfillment detail has no operation logs field', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/orders?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [failedOrder()],
        });
      }
      if (path === '/api/orders/order-failed/fulfillment') {
        return Promise.resolve({
          taskStatus: 'FAILED',
          upstreamImage: 'IPIPD',
          proxies: [],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<OrderListFeature />);

    fireEvent.click(await screen.findAllByRole('button', { name: 'adminOrders.operations.more' }).then((buttons) => buttons[0]!));
    fireEvent.click(await screen.findByText('adminOrders.viewDetail'));

    expect(await screen.findByText('adminOrders.fulfillment.operationLogs')).toBeInTheDocument();
    expect(screen.getByText('adminOrders.fulfillment.noOperationLogs')).toBeInTheDocument();
  });

  it('posts retry fulfillment and refreshes admin order server state', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (path.startsWith('/api/orders?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [failedOrder()],
        });
      }
      if (path === '/api/orders/order-failed/retry-fulfillment' && init?.method === 'POST') {
        return Promise.resolve({ orderId: 'order-failed', status: 'PENDING', fulfillmentJobId: 'job-1' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    const { invalidateSpy } = renderWithQuery(<OrderListFeature />);

    await openOrderOperation('adminOrders.operations.retry-fulfillment.button');
    expect(await screen.findByText('adminOrders.operations.retry-fulfillment.title')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('adminOrders.operations.reasonPlaceholder'), { target: { value: 'retry after provider recovery' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => expect(calls.some((call) => call.path === '/api/orders/order-failed/retry-fulfillment')).toBe(true));
    const retryCall = calls.find((call) => call.path === '/api/orders/order-failed/retry-fulfillment')!;
    expect(retryCall.init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(retryCall.init?.body as string)).toEqual({ reason: 'retry after provider recovery' });
    expect(await screen.findByText('job:job-1')).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-orders'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['order-fulfillment', 'order-failed'] });

    fireEvent.click(screen.getByRole('button', { name: 'adminOrders.operations.done' }));
    await waitFor(() => expect(screen.queryByText('adminOrders.operations.retry-fulfillment.title')).not.toBeInTheDocument());
  });

  it('requires a reason before refunding an order', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/orders?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [failedOrder()],
        });
      }
      if (path === '/api/orders/order-failed/refund' && init?.method === 'POST') {
        return Promise.resolve({
          orderId: 'order-failed',
          status: 'REFUNDED',
          wallet: { available: '120.00', currency: 'CNY' },
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<OrderListFeature />);

    await openOrderOperation('adminOrders.operations.refund.button');
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    expect(await screen.findByText('adminOrders.operations.reasonRequired')).toBeInTheDocument();
    expect(spy.mock.calls.some(([path]) => path === '/api/orders/order-failed/refund')).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('adminOrders.operations.reasonPlaceholder'), { target: { value: 'customer refund' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/orders/order-failed/refund')).toBe(true));
    const refundCall = spy.mock.calls.find(([path]) => path === '/api/orders/order-failed/refund')!;
    expect(JSON.parse(refundCall[1]?.body as string)).toEqual({ reason: 'customer refund' });
    expect(await screen.findByText('wallet:120.00:CNY')).toBeInTheDocument();
  });

  it('shows backend reason keys for manual-complete failures', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/orders?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [failedOrder()],
        });
      }
      if (path === '/api/orders/order-failed/manual-complete' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('VALIDATION_ERROR', 'order_already_refunded'));
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<OrderListFeature />);

    await openOrderOperation('adminOrders.operations.manual-complete.button');
    fireEvent.change(screen.getByPlaceholderText('adminOrders.operations.reasonPlaceholder'), { target: { value: 'offline delivery verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    expect(await screen.findByText('order_already_refunded')).toBeInTheDocument();
  });
});

function failedOrder() {
  return {
    id: 'order-failed',
    tenantId: 'tenant-1',
    tenantCode: 'reseller-a',
    tenantName: '分站 A',
    tenantAdminId: 'tenant-admin-1',
    tenantAdminEmail: 'owner@example.com',
    userId: 'user-1',
    userEmail: 'buyer@example.com',
    type: 'STATIC_PROXY_BUY',
    status: 'FAILED',
    totalPrice: '30.00',
    currency: 'CNY',
    cost: null,
    resourceId: 'resource-1',
    resourceCode: 'JP',
    resourceName: '日本',
    quantity: 2,
    durationDays: 30,
    providerCode: 'IPIPD',
    upstreamOrderId: 'UP-1001',
    fulfillmentStatus: 'FAILED',
    fulfillmentJobId: 'job-failed-1',
    failureStage: 'FAILED',
    failureError: 'provider_down',
    createdAt: '2026-06-08T00:00:00.000Z',
  };
}

function completedOrder() {
  return {
    id: 'order-completed',
    tenantId: 'tenant-1',
    tenantCode: 'reseller-a',
    tenantName: '分站 A',
    tenantAdminId: 'tenant-admin-1',
    tenantAdminEmail: 'owner@example.com',
    userId: 'user-1',
    userEmail: 'buyer@example.com',
    type: 'STATIC_PROXY_BUY',
    status: 'COMPLETED',
    totalPrice: '30.00',
    currency: 'CNY',
    cost: null,
    resourceId: 'resource-2',
    resourceCode: 'SG',
    resourceName: '新加坡',
    quantity: 1,
    durationDays: 30,
    providerCode: 'PR',
    upstreamOrderId: 'UP-2001',
    fulfillmentStatus: 'COMPLETED',
    fulfillmentJobId: 'job-completed-1',
    failureStage: null,
    failureError: null,
    createdAt: '2026-06-08T00:00:00.000Z',
  };
}
