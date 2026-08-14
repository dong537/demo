import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildResourceOverrideBody,
  ResourceOverrideFeature,
} from '../resource-override.feature';
import { PricingCenterFeature } from '../pricing-center.feature';
import { buildQuoteSandboxBody, QuoteSandboxFeature } from '../quote-sandbox.feature';
import { buildMatrixOverrideBody, PricingMatrixFeature } from '../pricing-matrix.feature';
import * as client from '../../../shared/api/client';
import { ApiError } from '../../../shared/api/client';
import { formatIpTypeZh, formatResourceLocationZh } from '../../../shared/resource/resource-labels';

const TRANSLATED_PRICING_REASON_TEXT: Record<string, string> = {
  'pricing.reason.unit_price_invalid': '请输入有效的价格',
  'pricing.reason.insufficient_permissions': '当前账号没有权限执行这个操作',
  'pricing.reason.no_price_rule': '这个商品还没有设置价格',
  'pricing.reason.resource_catalog_unavailable': '资源目录暂时不可用',
  'pricing.reason.generic': '操作暂时没有完成，请稍后重试',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => TRANSLATED_PRICING_REASON_TEXT[key] ?? key,
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const RESOURCES = {
  page: 1,
  pageSize: 20,
  total: 2,
  items: [
    { id: 'res-1', code: 'US_STATIC', name: 'US Static', providerCode: 'IPIPD', ipType: 'NATIVE' },
    { id: 'res-2', code: 'UK_STATIC', name: 'UK Static', providerCode: 'NINE_EIGHT_FIVE', ipType: 'BROADCAST' },
  ],
};
const FIRST_RESOURCE_OPTION = `${formatResourceLocationZh(RESOURCES.items[0]).title} / ${formatIpTypeZh(RESOURCES.items[0].ipType)}`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});
async function openSelectAndPick(selectorIndex: number, optionText: string) {
  const selectors = document.querySelectorAll('.ant-select-selector');
  fireEvent.mouseDown(selectors[selectorIndex] as HTMLElement);
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

describe('pricing builders', () => {
  it('builds matrix override body with the pricing override contract', () => {
    expect(buildMatrixOverrideBody('res-1', 30, 18.5, 'CNY')).toEqual({
      resourceId: 'res-1',
      durationDays: 30,
      unitPrice: '18.5',
      currency: 'CNY',
    });
  });

  it('builds resource override body with the fixed pricing duration', () => {
    expect(
      buildResourceOverrideBody({ resourceId: 'res-1', unitPrice: 12.5, currency: 'CNY' }),
    ).toEqual({ resourceId: 'res-1', durationDays: 30, unitPrice: '12.5', currency: 'CNY' });
  });

  it('builds quote sandbox body with numeric duration and quantity', () => {
    expect(
      buildQuoteSandboxBody({
        tenantId: 't1',
        userId: 'u1',
        resourceId: 'res-1',
        durationDays: 30,
        quantity: 5,
        currency: 'CNY',
      }),
    ).toEqual({
      tenantId: 't1',
      userId: 'u1',
      resourceId: 'res-1',
      durationDays: 30,
      quantity: 5,
      currency: 'CNY',
    });
  });
});

describe('PricingMatrixFeature', () => {
  it('keeps the pricing center focused on matrix and sandbox tabs', () => {
    renderWithQuery(<PricingCenterFeature />);

    expect(screen.getByText('pricing.center.title')).toBeInTheDocument();
    expect(screen.getByText('pricing.center.tabs.matrix')).toBeInTheDocument();
    expect(screen.getByText('pricing.center.tabs.sandbox')).toBeInTheDocument();
    expect(screen.queryByText('pricing.center.priorityNotice')).not.toBeInTheDocument();
    expect(screen.queryByText('pricing.center.priorityDescription')).not.toBeInTheDocument();
    expect(screen.queryByText('pricing.center.tabs.overrides')).not.toBeInTheDocument();
  });

  it('loads the matrix and saves changed override prices', async () => {
    const bodies: Record<string, unknown>[] = [];
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      paths.push(path);
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-1',
            code: 'JP_TOKYO',
            name: 'Japan Tokyo',
            displayName: '日本东京',
            providerCode: 'IPIPD',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 12,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '15.00',
            currency: 'CNY',
            upstreamCost: '9.50',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        bodies.push(JSON.parse(init.body as string));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);
    await screen.findByText(/日本/);
    expect(screen.queryByText('pricing.matrix.priorityNotice')).not.toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.priced')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.saleableCount')).toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.inStock')).not.toBeInTheDocument();
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('pageSize=20'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('pageSize=1000'))).toBe(false);
    expect(paths.some((path) => path.startsWith('/api/pricing/templates'))).toBe(false);
    expect(screen.getByText('ipmigo 平台')).toBeInTheDocument();
    expect(screen.getAllByText('pricing.matrix.residentialType.native').length).toBeGreaterThan(0);
    expect(screen.getByText('pricing.matrix.currentPrice')).toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.stock')).not.toBeInTheDocument();
    expect(screen.getByText('15.00 CNY')).toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.upstreamCost')).not.toBeInTheDocument();
    expect(screen.queryByText('9.50 CNY')).not.toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.margin')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('pricing.matrix.overridePrice'), { target: { value: '18.5' } });
    fireEvent.click(screen.getByRole('button', { name: /pricing.matrix.saveAll/ }));

    await waitFor(() =>
      expect(bodies).toEqual([
        { resourceId: 'res-1', durationDays: 30, unitPrice: '18.5', currency: 'CNY' },
      ]),
    );
  });

  it('saves one matrix row through the modify price action', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-1',
            code: 'JP_TOKYO',
            name: 'Japan Tokyo',
            displayName: '日本东京',
            providerCode: 'IPIPD',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 12,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '15.00',
            currency: 'CNY',
            upstreamCost: '9.50',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        body = JSON.parse(init.body as string);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);
    await screen.findByText(/日本/);
    fireEvent.change(screen.getByLabelText('pricing.matrix.overridePrice'), { target: { value: '18.5' } });
    fireEvent.click(screen.getByRole('button', { name: /pricing.matrix.modifyPrice/ }));

    await waitFor(() =>
      expect(body).toEqual({ resourceId: 'res-1', durationDays: 30, unitPrice: '18.5', currency: 'CNY' }),
    );
  });

  it('shows a readable matrix price failure instead of resource id and backend reason key', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-fail',
            code: 'US_FAIL',
            name: 'United States',
            displayName: '美国',
            providerCode: 'IPIPD',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 10,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '15.00',
            currency: 'CNY',
          }],
        });
      }
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        return Promise.reject(new ApiError('VALIDATION_ERROR', 'unit_price_invalid'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);
    await screen.findByText('美国');
    fireEvent.change(screen.getByLabelText('pricing.matrix.overridePrice'), { target: { value: '18.5' } });
    fireEvent.click(screen.getByRole('button', { name: /pricing.matrix.saveAll/ }));

    expect(await screen.findByText('请输入有效的价格')).toBeInTheDocument();
    expect(screen.queryByText('res-fail: unit_price_invalid')).not.toBeInTheDocument();
  });

  it('syncs upstream inventory from the pricing matrix toolbar', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path, init });
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-1',
            code: 'JP_TOKYO',
            name: 'Japan Tokyo',
            displayName: '日本东京',
            providerCode: 'IPIPD',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 12,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '15.00',
            currency: 'CNY',
            upstreamCost: '9.50',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 1,
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          synced: 1,
          syncedAt: '2026-06-10T00:00:00.000Z',
          upstreamRawStatus: 'success',
          countries: ['JP'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);

    await screen.findByText(/日本/);
    fireEvent.click(screen.getByRole('button', { name: /pricing.matrix.syncUpstream/ }));
    await screen.findAllByText('ipmigo 平台');
    const dropdownItem = document.querySelector('.ant-dropdown-menu-title-content') as HTMLElement;
    fireEvent.click(dropdownItem);

    await waitFor(() => {
      const syncCall = calls.find((call) => call.path === '/api/resources/sync-inventory');
      expect(syncCall?.init?.method).toBe('POST');
      expect(JSON.parse(syncCall?.init?.body as string)).toEqual({ providerCode: 'IPIPD' });
    });
    expect(await screen.findByText('pricing.matrix.syncResultTitle')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncAttempted')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncCreated')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncUpdated')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncSkipped')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncFailed')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncCountries')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncStatusReady')).toBeInTheDocument();
  });

  it('rejects legacy count-only upstream sync responses', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-1',
            code: 'JP_TOKYO',
            name: 'Japan Tokyo',
            displayName: '日本东京',
            providerCode: 'IPIPD',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 12,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '15.00',
            currency: 'CNY',
          }],
        });
      }
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({ synced: 1 });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);

    await screen.findByText(/日本/);
    fireEvent.click(screen.getByRole('button', { name: /pricing.matrix.syncUpstream/ }));
    await screen.findAllByText('ipmigo 平台');
    const dropdownItem = document.querySelector('.ant-dropdown-menu-title-content') as HTMLElement;
    fireEvent.click(dropdownItem);

    expect(await screen.findByText('操作暂时没有完成，请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText('invalid_sync_inventory_response')).not.toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.syncResultTitle')).not.toBeInTheDocument();
  });

  it('renders global prices without upstream cost or margin information in the pricing matrix', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            resourceId: 'res-2',
            code: 'TW_STATIC',
            name: 'Taiwan Static',
            displayName: '台湾',
            providerCode: 'NINE_EIGHT_FIVE',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            isSaleable: true,
            stock: 8,
            inventoryCapturedAt: '2026-06-10T00:00:00.000Z',
            inventoryIsStale: false,
            overridePrice: null,
            effectivePrice: '20.00',
            currency: 'CNY',
            upstreamCost: '12.00',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<PricingMatrixFeature />);

    await screen.findByText('中国台湾');
    expect(screen.getByText('985 平台')).toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.quality.stable')).not.toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.currentPrice')).toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.upstreamCost')).not.toBeInTheDocument();
    expect(screen.queryByText('12.00 CNY')).not.toBeInTheDocument();
    expect(screen.queryByText('pricing.matrix.margin')).not.toBeInTheDocument();
    expect(screen.queryByText('40.0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('20.00 CNY').length).toBeGreaterThan(0);
  });
});

describe('ResourceOverrideFeature', () => {
  it('posts to /api/pricing/overrides with the correct body shape', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources')) return Promise.resolve(RESOURCES);
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        body = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ResourceOverrideFeature />);
    await screen.findByText('pricing.override.submit');
    expect(screen.getAllByText('pricing.override.priorityNotice').length).toBeGreaterThan(0);
    await openSelectAndPick(0, FIRST_RESOURCE_OPTION);
    fireEvent.change(screen.getByLabelText('pricing.override.unitPrice'), { target: { value: '12.5' } });

    fireEvent.click(screen.getByRole('button', { name: 'pricing.override.submit' }));

    await waitFor(() =>
      expect(body).toEqual({ resourceId: 'res-1', durationDays: 30, unitPrice: '12.5', currency: 'CNY' }),
    );
  });

  it('blocks submit and shows validation when no resource is selected', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue(RESOURCES);

    renderWithQuery(<ResourceOverrideFeature />);
    await screen.findByText('pricing.override.submit');
    fireEvent.click(screen.getByRole('button', { name: 'pricing.override.submit' }));

    expect(await screen.findByText('pricing.override.resourceRequired')).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => c[0] === '/api/pricing/overrides')).toBe(false);
  });

  it('shows a readable override failure instead of the backend reason key', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources')) return Promise.resolve(RESOURCES);
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        return Promise.reject(new ApiError('VALIDATION_ERROR', 'unit_price_invalid'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ResourceOverrideFeature />);
    await screen.findByText('pricing.override.submit');
    await openSelectAndPick(0, FIRST_RESOURCE_OPTION);
    fireEvent.change(screen.getByLabelText('pricing.override.unitPrice'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'pricing.override.submit' }));

    expect(await screen.findByText('请输入有效的价格')).toBeInTheDocument();
    expect(screen.queryByText('unit_price_invalid')).not.toBeInTheDocument();
  });

  it('shows a readable resource loading failure instead of the backend reason key', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources')) {
        return Promise.reject(new ApiError('PERMISSION_DENIED', 'insufficient_permissions'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ResourceOverrideFeature />);

    expect(await screen.findByText('当前账号没有权限执行这个操作')).toBeInTheDocument();
    expect(screen.queryByText('insufficient_permissions')).not.toBeInTheDocument();
  });
});

describe('QuoteSandboxFeature', () => {
  it.each([
    'USER_OVERRIDE',
    'USER_TEMPLATE',
    'TENANT_DEFAULT_TEMPLATE',
    'RESOURCE_OVERRIDE',
    'DEFAULT_TEMPLATE',
  ] as const)('posts to /api/pricing/quote-sandbox and renders %s quote source', async (priceSource) => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources')) return Promise.resolve(RESOURCES);
      if (path === '/api/pricing/quote-sandbox' && init?.method === 'POST') {
        body = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({
          unitPrice: '10.00',
          totalPrice: '50.00',
          currency: 'CNY',
          resourceId: 'res-1',
          durationDays: 30,
          quantity: 5,
          priceSource,
          isSaleable: true,
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<QuoteSandboxFeature />);

    const inputs = await screen.findAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'tenant-1' } });
    fireEvent.change(inputs[1]!, { target: { value: 'user-1' } });
    await openSelectAndPick(0, FIRST_RESOURCE_OPTION);
    fireEvent.click(screen.getByRole('button', { name: 'pricing.sandbox.submit' }));

    await waitFor(() =>
      expect(body).toMatchObject({
        tenantId: 'tenant-1',
        userId: 'user-1',
        resourceId: 'res-1',
        durationDays: 30,
        quantity: 1,
        currency: 'CNY',
      }),
    );

    expect(await screen.findByText('10.00 CNY')).toBeInTheDocument();
    expect(screen.getByText('50.00 CNY')).toBeInTheDocument();
    expect(screen.getAllByText(`pricing.sandbox.source.${priceSource}`).length).toBeGreaterThan(0);
  });

  it('shows a readable sandbox quote failure instead of the backend reason key', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources')) return Promise.resolve(RESOURCES);
      if (path === '/api/pricing/quote-sandbox' && init?.method === 'POST') {
        return Promise.reject(new ApiError('PRICE_MISSING', 'no_price_rule'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<QuoteSandboxFeature />);
    const inputs = await screen.findAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'tenant-1' } });
    fireEvent.change(inputs[1]!, { target: { value: 'user-1' } });
    await openSelectAndPick(0, FIRST_RESOURCE_OPTION);
    fireEvent.click(screen.getByRole('button', { name: 'pricing.sandbox.submit' }));

    expect(await screen.findByText('这个商品还没有设置价格')).toBeInTheDocument();
    expect(screen.queryByText('no_price_rule')).not.toBeInTheDocument();
  });

  it('shows a readable sandbox resource load failure instead of the backend reason key', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources')) {
        return Promise.reject(new ApiError('UPSTREAM_ERROR', 'resource_catalog_unavailable'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<QuoteSandboxFeature />);

    expect(await screen.findByText('资源目录暂时不可用')).toBeInTheDocument();
    expect(screen.queryByText('resource_catalog_unavailable')).not.toBeInTheDocument();
  });
});
