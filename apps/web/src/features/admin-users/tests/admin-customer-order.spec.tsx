import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserListFeature } from '../user-list.feature';
import {
  buildAdminCustomerOrderBody,
  buildAdminCustomerOrderPath,
} from '../admin-customer-order-drawer.feature';
import * as client from '../../../shared/api/client';

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
      if (key === 'users.assistedOrder.result') return `order:${values?.orderId}:${values?.status}`;
      if (key === 'users.assistedOrder.statusUnknown') return '状态待确认';
      if (key === 'users.assistedOrder.title') return `assisted:${values?.email}`;
      if (key === 'users.assistedOrder.stockValue') return `stock:${values?.count}`;
      if (key === 'users.assistedOrder.stockMissing') return 'stock-missing';
      if (key === 'users.assistedOrder.resourceSelect') return `select:${values?.name}`;
      if (key === 'users.assistedOrder.resourcePickerHint') return `show:${values?.count}/${values?.total}`;
      if (key === 'users.price.filteredResources') return `filtered:${values?.count}`;
      if (key === 'users.price.loadedResources') return `loaded:${values?.count}/${values?.total}`;
      if (key === 'resources.quickPriceCountries') return `countries:${values?.count}`;
      if (key === 'resources.quickPriceRegionCount') return `regions:${values?.regions}/resources:${values?.resources}`;
      if (key === 'resources.quickPriceLineCount') return `lines:${values?.lines}/resources:${values?.resources}`;
      if (key === 'users.assistedOrder.resourceCode') return 'resource-code';
      if (key === 'resources.resourceCountry') return 'country';
      if (key === 'resources.resourceCityLine') return 'city-line';
      if (key === 'resources.resourceCost') return 'cost';
      if (key === 'resources.resourceCostMissing') return 'cost-missing';
      if (key === 'resources.resourceCostRange') return `${values?.min} - ${values?.max}`;
      if (key === 'resources.resourceCostPartialKnown') return `partial ${values?.cost}`;
      if (key === 'resources.resourceCostListMore') return `${values?.costs} and ${values?.count} costs`;
      if (key === 'orders.statusValue.PENDING') return '待处理';
      if (key === 'users.reason.wallet_insufficient_balance') return '余额不足';
      if (key === 'users.reason.generic') return '操作没有完成';
      if (key === 'users.price.resourceLabel') {
        return `${values?.region} / ${values?.provider} / ${values?.ipType}`;
      }
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => 'uuid-1' },
  });
});

describe('admin assisted customer order UI', () => {
  it('builds encoded endpoint paths and typed request bodies', () => {
    expect(buildAdminCustomerOrderPath('user 1')).toBe('/api/orders/users/user%201/static-proxy');
    expect(buildAdminCustomerOrderBody({
      resourceId: 'resource-1',
      quantity: 2,
      durationDays: 30,
      currency: 'CNY',
      businessType: ' telegram ',
      reason: ' customer asked ',
    }, 'key-1')).toEqual({
      resourceId: 'resource-1',
      quantity: 2,
      durationDays: 30,
      currency: 'CNY',
      businessType: 'telegram',
      idempotencyKey: 'key-1',
      reason: 'customer asked',
    });
  });

  it('opens from the user list and creates an assisted order through the real admin endpoint', async () => {
    const spy = mockAdminCustomerOrderApi();
    const { invalidateSpy } = renderWithQuery(<UserListFeature />);

    await openUserAction('users.assistedOrder.button');
    expect(await screen.findByText('assisted:buyer@example.com')).toBeInTheDocument();
    expect(await screen.findAllByText('100.00 CNY')).not.toHaveLength(0);

    await selectAssistedOrderResource('日本 日本');
    fireEvent.change(screen.getByPlaceholderText('users.assistedOrder.reasonPlaceholder'), {
      target: { value: 'customer requested phone support purchase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'users.assistedOrder.submit' }));

    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/orders/users/user-1/static-proxy')).toBe(true));
    const orderCall = spy.mock.calls.find(([path]) => path === '/api/orders/users/user-1/static-proxy')!;
    expect(orderCall[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(orderCall[1]?.body as string)).toEqual({
      resourceId: 'resource-1',
      quantity: 1,
      durationDays: 30,
      currency: 'CNY',
      idempotencyKey: 'admin-ui-uuid-1',
      reason: 'customer requested phone support purchase',
    });
    expect(await screen.findByText('order:order-1:待处理')).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-orders'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-wallet', 'user-1'] });
  });

  it('requires an operator reason before submitting', async () => {
    const spy = mockAdminCustomerOrderApi();
    renderWithQuery(<UserListFeature />);

    await openUserAction('users.assistedOrder.button');
    await selectAssistedOrderResource('日本 日本');
    fireEvent.click(screen.getByRole('button', { name: 'users.assistedOrder.submit' }));

    expect(await screen.findByText('users.assistedOrder.reasonRequired')).toBeInTheDocument();
    expect(spy.mock.calls.some(([path]) => path === '/api/orders/users/user-1/static-proxy')).toBe(false);
  });

  it('keeps stale or unknown-stock resources visible without showing inventory snapshot labels', async () => {
    mockAdminCustomerOrderApi({ includeUnavailableResources: true });
    renderWithQuery(<UserListFeature />);

    await openUserAction('users.assistedOrder.button');
    fireEvent.click(await screen.findByRole('button', { name: 'users.assistedOrder.resourceChoose' }));

    expect(await screen.findByRole('button', { name: 'select:日本 日本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'select:菲律宾 菲律宾' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'select:中国台湾 中国台湾' })).toBeInTheDocument();
    expect(screen.queryByText('stock-missing')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.inventory.stale')).not.toBeInTheDocument();
  });

  it('shows a readable assisted order failure instead of the backend reason key', async () => {
    const spy = mockAdminCustomerOrderApi({ failOrder: true });
    renderWithQuery(<UserListFeature />);

    await openUserAction('users.assistedOrder.button');
    await selectAssistedOrderResource('日本 日本');
    fireEvent.change(screen.getByPlaceholderText('users.assistedOrder.reasonPlaceholder'), {
      target: { value: 'customer requested phone support purchase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'users.assistedOrder.submit' }));

    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/orders/users/user-1/static-proxy')).toBe(true));
    expect(await screen.findByText('余额不足')).toBeInTheDocument();
    expect(screen.queryByText('wallet_insufficient_balance')).not.toBeInTheDocument();
  });

  it('opens wallet adjustment from the unified action area and posts the real adjust endpoint', async () => {
    const spy = mockAdminCustomerOrderApi();
    const { invalidateSpy } = renderWithQuery(<UserListFeature />);

    await openUserAction('users.operations.adjustWallet');
    expect(await screen.findByText('ledger.adjust.title')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('ledger.adjust.reasonPlaceholder'), {
      target: { value: 'customer recharge by support' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ledger.adjust.submit' }));
    const submitButtons = await screen.findAllByRole('button', { name: 'ledger.adjust.submit' });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/wallet/user-1/adjust')).toBe(true));
    const adjustCall = spy.mock.calls.find(([path]) => path === '/api/wallet/user-1/adjust')!;
    expect(adjustCall[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(adjustCall[1]?.body as string)).toEqual({
      direction: 'credit',
      amount: '50',
      currency: 'CNY',
      reason: 'customer recharge by support',
      idempotencyKey: 'uuid-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-wallet', 'user-1'] });
  });

  it('creates a customer user through the admin users endpoint', async () => {
    const spy = mockAdminCustomerOrderApi();
    const { invalidateSpy } = renderWithQuery(<UserListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'users.create.button' }));
    fireEvent.change(screen.getByPlaceholderText('users.create.emailPlaceholder'), {
      target: { value: 'created@example.com' },
    });
    await selectFirstDrawerOption('Tenant One / tenant-one');
    fireEvent.change(screen.getByPlaceholderText('users.create.passwordPlaceholder'), {
      target: { value: 'Customer123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'users.create.submit' }));

    await waitFor(() => expect(spy.mock.calls.some(([path, init]) => path === '/api/users' && init?.method === 'POST')).toBe(true));
    const createCall = spy.mock.calls.find(([path, init]) => path === '/api/users' && init?.method === 'POST')!;
    expect(JSON.parse(createCall[1]?.body as string)).toEqual({
      email: 'created@example.com',
      password: 'Customer123!',
      tenantId: 'tenant-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
  });

  it('posts real user operation endpoints from the row menu', async () => {
    const spy = mockAdminCustomerOrderApi();
    const { invalidateSpy } = renderWithQuery(<UserListFeature />);

    await openUserAction('users.operations.disable');
    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/users/user-1/status')).toBe(true));
    const statusCall = spy.mock.calls.find(([path]) => path === '/api/users/user-1/status')!;
    expect(statusCall[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(statusCall[1]?.body as string)).toEqual({ status: 'SUSPENDED' });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] }));

    await openUserAction('users.operations.resetPassword');
    fireEvent.change(screen.getByLabelText('users.password.newPassword'), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'users.operations.resetPassword' }));
    const resetConfirms = await screen.findAllByText('users.operations.resetPassword');
    fireEvent.click(resetConfirms[resetConfirms.length - 1]);
    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/users/user-1/reset-password')).toBe(true));
    const passwordCall = spy.mock.calls.find(([path]) => path === '/api/users/user-1/reset-password')!;
    expect(passwordCall[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(passwordCall[1]?.body as string)).toEqual({ password: 'NewPassword123!' });
    await waitFor(() => expect(screen.queryByLabelText('users.password.newPassword')).not.toBeInTheDocument());
  });

  it('sets user override pricing and impersonates through real endpoints', async () => {
    const spy = mockAdminCustomerOrderApi({ includeDisabledResources: true });
    const onImpersonated = vi.fn();
    renderWithQuery(<UserListFeature onImpersonated={onImpersonated} />);

    await openUserAction('users.operations.setPrice');
    expect((await screen.findAllByText('日本')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('新加坡')).length).toBeGreaterThan(0);
    expect(await screen.findByText('loaded:2/5')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy Unsaleable')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy Inactive')).not.toBeInTheDocument();
    expect((await screen.findAllByText(/cost/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('users.price.currency')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.stock')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('users.price.countrySearchPlaceholder'), { target: { value: 'SG' } });
    expect((await screen.findAllByText('countries:1')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('users.price.unitPrice'), { target: { value: '19.8' } });
    const saveButtons = await screen.findAllByRole('button', { name: 'users.price.submitBatch' });
    fireEvent.click(saveButtons[saveButtons.length - 1]);
    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/pricing/user-overrides')).toBe(true));
    const overrideBodies = spy.mock.calls
      .filter(([path]) => path === '/api/pricing/user-overrides')
      .map((call) => JSON.parse(call[1]?.body as string));
    expect(overrideBodies).toEqual([{
      tenantId: 'tenant-1',
      userId: 'user-1',
      resourceId: 'resource-2',
      durationDays: 30,
      unitPrice: '19.8',
      currency: 'CNY',
    }]);
    expect(spy.mock.calls.some(([path]) => path === '/api/pricing/user-template-bindings')).toBe(false);
    await waitFor(() => expect(screen.queryByText('users.price.priorityNotice')).not.toBeInTheDocument());

    await openUserAction('users.operations.impersonate');
    await waitFor(() => expect(spy.mock.calls.some(([path]) => path === '/api/users/user-1/impersonate')).toBe(true));
    await waitFor(() => expect(onImpersonated).toHaveBeenCalled());
    expect(sessionStorage.getItem('user_token')).toBe('impersonated-token');
  });

  it('selects current filtered saleable resources for user override pricing', async () => {
    const spy = mockAdminCustomerOrderApi({ includeDisabledResources: true });
    renderWithQuery(<UserListFeature />);

    await openUserAction('users.operations.setPrice');
    fireEvent.click(await screen.findByRole('button', { name: 'users.price.selectAllFiltered' }));
    fireEvent.change(screen.getByLabelText('users.price.unitPrice'), { target: { value: '12.5' } });
    const saveButtons = await screen.findAllByRole('button', { name: 'users.price.submitBatch' });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(spy.mock.calls.filter(([path]) => path === '/api/pricing/user-overrides')).toHaveLength(2));
    const overrideResourceIds = spy.mock.calls
      .filter(([path]) => path === '/api/pricing/user-overrides')
      .map((call) => JSON.parse(call[1]?.body as string).resourceId);
    expect(overrideResourceIds).toEqual(['resource-1', 'resource-2']);
  });
});

async function openUserAction(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'users.operations.menu' }));
  fireEvent.click(await screen.findByText(label));
}

async function selectFirstDrawerOption(optionText: string) {
  await waitFor(() => expect(document.querySelector('.ant-drawer-body .ant-select-selector')).toBeTruthy());
  const selector = document.querySelector('.ant-drawer-body .ant-select-selector') as HTMLElement;
  fireEvent.mouseDown(selector);
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

async function selectAssistedOrderResource(resourceText: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'users.assistedOrder.resourceChoose' }));
  fireEvent.click(await screen.findByRole('button', { name: `select:${resourceText}` }));
}

function mockAdminCustomerOrderApi(opts: { failOrder?: boolean; includeUnavailableResources?: boolean; includeDisabledResources?: boolean } = {}) {
  return vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
    if (path.startsWith('/api/tenants')) {
      return Promise.resolve({
        items: [{ id: 'tenant-1', name: 'Tenant One', code: 'tenant-one', status: 'ACTIVE' }],
      });
    }
    if (path === '/api/users' && init?.method === 'POST') {
      return Promise.resolve({
        id: 'user-created',
        email: 'created@example.com',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        kycStatus: 'NONE',
        createdAt: '2026-06-11T00:00:00.000Z',
      });
    }
    if (path.startsWith('/api/users')) {
      if (path === '/api/users/user-1/status' && init?.method === 'POST') {
        return Promise.resolve({ id: 'user-1', status: 'SUSPENDED' });
      }
      if (path === '/api/users/user-1/reset-password' && init?.method === 'POST') {
        return Promise.resolve({ id: 'user-1', status: 'ACTIVE' });
      }
      if (path === '/api/users/user-1/impersonate' && init?.method === 'POST') {
        return Promise.resolve({ token: 'impersonated-token', expiresAt: '2026-06-11T02:00:00.000Z' });
      }
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [{
          id: 'user-1',
          email: 'buyer@example.com',
          tenantId: 'tenant-1',
          status: 'ACTIVE',
          kycStatus: 'APPROVED',
          createdAt: '2026-06-08T00:00:00.000Z',
          wallet: { available: '100.00', frozen: '0.00', currency: 'CNY' },
          orderCount: 4,
          proxyCount: 22,
        }],
      });
    }
    if (path.startsWith('/api/resources')) {
      const resources = [{
        id: 'resource-1',
        code: 'JP',
        name: 'Japan',
        displayName: null,
        countryCode: 'JP',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: 50,
        inventoryIsStale: false,
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        upstreamCost: '5.50',
        upstreamCostCurrency: 'CNY',
      }, {
        id: 'resource-2',
        code: 'SG',
        name: 'Singapore',
        displayName: null,
        countryCode: 'SG',
        providerCode: 'PR',
        ipType: 'BROADCAST',
        protocol: 'SOCKS5',
        stock: 80,
        inventoryIsStale: false,
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        upstreamCost: '6.20',
        upstreamCostCurrency: 'CNY',
      }, ...(opts.includeUnavailableResources ? [{
        id: 'resource-stale',
        code: 'PH',
        name: 'Philippines',
        displayName: null,
        countryCode: 'PH',
        providerCode: 'NINE_EIGHT_FIVE',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: 18,
        inventoryIsStale: true,
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        upstreamCost: '4.90',
        upstreamCostCurrency: 'CNY',
      }, {
        id: 'resource-unknown',
        code: 'TW',
        name: 'Taiwan',
        displayName: null,
        countryCode: 'TW',
        providerCode: 'NINE_EIGHT_FIVE',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: null,
        inventoryIsStale: null,
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        upstreamCost: '7.10',
        upstreamCostCurrency: 'CNY',
      }] : []), ...(opts.includeDisabledResources ? [{
        id: 'resource-hidden',
        code: 'US:HIDDEN',
        name: 'Legacy Hidden',
        displayName: 'Legacy Hidden',
        countryCode: 'US',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: 10,
        inventoryIsStale: false,
        status: 'ACTIVE',
        isVisible: false,
        isSaleable: true,
        upstreamCost: '3.00',
        upstreamCostCurrency: 'CNY',
      }, {
        id: 'resource-unsaleable',
        code: 'US:UNSALEABLE',
        name: 'Legacy Unsaleable',
        displayName: 'Legacy Unsaleable',
        countryCode: 'US',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: 10,
        inventoryIsStale: false,
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: false,
        upstreamCost: '3.10',
        upstreamCostCurrency: 'CNY',
      }, {
        id: 'resource-inactive',
        code: 'US:INACTIVE',
        name: 'Legacy Inactive',
        displayName: 'Legacy Inactive',
        countryCode: 'US',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        stock: 10,
        inventoryIsStale: false,
        status: 'ARCHIVED',
        isVisible: true,
        isSaleable: true,
        upstreamCost: '3.20',
        upstreamCostCurrency: 'CNY',
      }] : [])];
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        total: resources.length,
        items: resources,
      });
    }
    if (path === '/api/wallet/user-1') {
      return Promise.resolve({
        id: 'wallet-1',
        userId: 'user-1',
        available: '100.00',
        frozen: '0.00',
        currency: 'CNY',
        updatedAt: '2026-06-11T00:00:00.000Z',
      });
    }
    if (path === '/api/wallet/user-1/adjust' && init?.method === 'POST') {
      return Promise.resolve({
        id: 'wallet-1',
        userId: 'user-1',
        available: '150.00',
        frozen: '0.00',
        currency: 'CNY',
        updatedAt: '2026-06-11T00:00:00.000Z',
      });
    }
    if (path === '/api/orders/users/user-1/static-proxy' && init?.method === 'POST') {
      return opts.failOrder
        ? Promise.reject(new client.ApiError('INSUFFICIENT_BALANCE', 'wallet_insufficient_balance'))
        : Promise.resolve({ orderId: 'order-1', status: 'PENDING' });
    }
    if (path === '/api/pricing/user-overrides' && init?.method === 'POST') {
      return Promise.resolve({ id: 'override-1' });
    }
    return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
  });
}
