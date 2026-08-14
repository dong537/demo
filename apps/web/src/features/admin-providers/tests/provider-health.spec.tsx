import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ProviderHealthFeature,
  type ProviderAccountListItem,
  type ProviderHealthCheckResult,
} from '../provider-health.feature';
import * as client from '../../../shared/api/client';
import { formatResourceLocationZh } from '../../../shared/resource/resource-labels';
import { formatProviderLabel } from '../../../shared/provider/provider-labels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'providers.reason.generic': '上游操作没有完成',
      'providers.reason.insufficient_permissions': '当前账号没有权限',
      'providers.reason.inventory_empty': '上游没有返回可用库存',
      'providers.reason.upstream_timeout': '上游响应超时',
    }[key] ?? key),
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function clickProviderResourcePage(page: number) {
  const pageLink = document.querySelector<HTMLElement>(`.ipx-provider-resource-table .ant-pagination-item-${page} a`);
  expect(pageLink).toBeTruthy();
  fireEvent.click(pageLink!);
}

function providerRow(overrides: Partial<ProviderAccountListItem> = {}): ProviderAccountListItem {
  return {
    id: 'pa-1',
    providerCode: 'IPIPD',
    tenantId: null,
    status: 'ACTIVE',
    baseUrl: 'https://api.example.com',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: ['GB', 'HK'],
    availableCountries: [
      { code: 'GB', name: 'United Kingdom' },
      { code: 'HK', name: 'Hong Kong' },
    ],
    capabilities: { inventorySync: true, renew: false, changePassword: false, switchIp: false },
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function pricingMatrixResponse() {
  return {
    page: 1,
    pageSize: 20,
    total: 4,
    items: [
      {
        resourceId: 'res-gb-native',
        code: 'GB',
        name: 'United Kingdom',
        displayName: '英国原生住宅',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        isSaleable: true,
        stock: 18,
        inventoryCapturedAt: '2026-06-12T00:00:00.000Z',
        inventoryIsStale: false,
        overridePrice: '49.00',
        effectivePrice: '49.00',
        currency: 'CNY',
        upstreamCost: '30.00',
        upstreamCostCurrency: 'CNY',
      },
      {
        resourceId: 'res-hk-broadcast',
        code: 'HK',
        name: 'Hong Kong',
        displayName: '香港广播住宅',
        providerCode: 'IPIPD',
        ipType: 'BROADCAST',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        isSaleable: true,
        stock: 8,
        inventoryCapturedAt: '2026-06-12T00:00:00.000Z',
        inventoryIsStale: false,
        overridePrice: null,
        effectivePrice: '59.00',
        currency: 'CNY',
        upstreamCost: '34.00',
        upstreamCostCurrency: 'CNY',
      },
      {
        resourceId: 'res-us-virash',
        code: 'US:1498453449724006400',
        name: 'US-USAVIRASH',
        displayName: 'US-USAVIRASH',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        isSaleable: false,
        stock: 85,
        inventoryCapturedAt: '2026-06-12T00:00:00.000Z',
        inventoryIsStale: false,
        overridePrice: null,
        effectivePrice: '6.00',
        currency: 'CNY',
        upstreamCost: '3.00',
        upstreamCostCurrency: 'CNY',
      },
      {
        resourceId: 'res-sg-native',
        code: 'SG',
        name: 'Singapore',
        displayName: 'Singapore native residential',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        isSaleable: true,
        stock: 28,
        inventoryCapturedAt: '2026-06-12T00:00:00.000Z',
        inventoryIsStale: false,
        overridePrice: null,
        effectivePrice: null,
        currency: 'CNY',
        upstreamCost: '38.00',
        upstreamCostCurrency: 'CNY',
      },
    ],
  };
}

function duplicateRegionPricingMatrixResponse() {
  const line = pricingMatrixResponse().items[2];
  return {
    page: 1,
    pageSize: 20,
    total: 2,
    items: [
      {
        ...line,
        resourceId: 'res-us-1',
        code: 'US:1484931183170162688',
        stock: 707,
        overridePrice: null,
        effectivePrice: null,
        upstreamCost: '6.00',
      },
      {
        ...line,
        resourceId: 'res-us-2',
        code: 'US:1484931181727322112',
        stock: 732,
        overridePrice: null,
        effectivePrice: null,
        upstreamCost: '6.00',
      },
    ],
  };
}

function nineEightFivePricingMatrixResponse() {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    items: [{
      ...pricingMatrixResponse().items[0],
      resourceId: 'res-985-tw',
      code: 'TW',
      name: 'Taiwan',
      displayName: '台湾住宅',
      providerCode: 'NINE_EIGHT_FIVE',
      status: 'ACTIVE',
      isSaleable: true,
      overridePrice: '39.00',
      effectivePrice: '39.00',
      upstreamCost: '22.00',
    }],
  };
}

type PricingMatrixSummaryTestItem = Partial<{
  providerCode: ProviderAccountListItem['providerCode'];
  total: number;
  enabled: number;
  synced: number;
  priced: number;
}>;

function pricingMatrixSummaryResponse(items: PricingMatrixSummaryTestItem[] = [{}]) {
  return items.map((item) => ({
    providerCode: item.providerCode ?? 'IPIPD',
    total: item.total ?? 4,
    enabled: item.enabled ?? 3,
    synced: item.synced ?? 4,
    priced: item.priced ?? 3,
  }));
}

function mockProviderApis(provider: ProviderAccountListItem[] = [providerRow()]) {
  return vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
    if (path === '/api/providers' && !init?.method) return Promise.resolve(provider);
    if (String(path).startsWith('/api/pricing/matrix/summary')) {
      return Promise.resolve(pricingMatrixSummaryResponse(provider.map((item) => ({ providerCode: item.providerCode }))));
    }
    if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
    return Promise.resolve({});
  });
}

async function clickCardSyncInventory() {
  const providerCard = screen.getByText(formatProviderLabel('IPIPD')).closest('.ant-card');
  expect(providerCard).toBeTruthy();
  const syncButton = within(providerCard as HTMLElement).getByRole('button', { name: /providers.syncInventory/ });
  await vi.waitFor(() => {
    expect(syncButton).not.toBeDisabled();
    expect(syncButton).not.toHaveClass('ant-btn-loading');
  });
  fireEvent.click(syncButton!);
}

function clickDrawerSyncInventory() {
  const syncText = screen.getAllByText('providers.syncInventory').find((node) => node.closest('button'));
  fireEvent.click(syncText!.closest('button')!);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('provider health feature', () => {
  it('renders provider rows without exposing any credential field', async () => {
    mockProviderApis();

    const { container } = renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));

    expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/credentialEncrypted/i);
  });

  it('loads the provider resource setup one server page at a time', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const url = String(path);
      paths.push(url);
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (url.startsWith('/api/pricing/matrix/summary')) {
        return Promise.resolve(pricingMatrixSummaryResponse());
      }
      if (url.startsWith('/api/pricing/matrix') && url.includes('page=1')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 21,
          items: [{
            ...pricingMatrixResponse().items[0],
            resourceId: 'res-first-page',
            displayName: 'First page resource',
          }],
        });
      }
      if (url.startsWith('/api/pricing/matrix') && url.includes('page=2')) {
        return Promise.resolve({
          page: 2,
          pageSize: 20,
          total: 21,
          items: [{
            ...pricingMatrixResponse().items[1],
            resourceId: 'res-second-page',
            displayName: 'Second page resource',
          }],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));

    expect(await screen.findByLabelText('providers.resourceToggle:GB')).toBeInTheDocument();
    expect(screen.queryByLabelText('providers.resourceToggle:HK')).not.toBeInTheDocument();
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('pageSize=20'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('providerCode=IPIPD'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('configurableOnly=true'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('page=2'))).toBe(false);
    clickProviderResourcePage(2);
    expect(await screen.findByLabelText('providers.resourceToggle:HK')).toBeInTheDocument();
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('page=2'))).toBe(true);
  });

  it('shows 985 resources even when the global first pricing page has another provider', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const url = String(path);
      paths.push(url);
      if (path === '/api/providers' && !init?.method) {
        return Promise.resolve([
          providerRow(),
          providerRow({
            id: 'pa-985',
            providerCode: 'NINE_EIGHT_FIVE',
            baseUrl: 'https://open-api.985proxy.com',
            enabledCountryCodes: ['TW'],
          }),
        ]);
      }
      if (url.startsWith('/api/pricing/matrix/summary')) {
        return Promise.resolve(pricingMatrixSummaryResponse([
          { providerCode: 'IPIPD' },
          { providerCode: 'NINE_EIGHT_FIVE', total: 1, enabled: 1, synced: 1, priced: 1 },
        ]));
      }
      if (url.startsWith('/api/pricing/matrix') && url.includes('providerCode=NINE_EIGHT_FIVE')) {
        return Promise.resolve(nineEightFivePricingMatrixResponse());
      }
      if (url.startsWith('/api/pricing/matrix')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [pricingMatrixResponse().items[0]],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText('985 平台');
    const providerCard = screen.getByText('985 平台').closest('.ant-card');
    expect(providerCard).toBeTruthy();
    await vi.waitFor(() => {
      expect(paths.some((path) => path.includes('/api/pricing/matrix/summary'))).toBe(true);
      expect(providerCard as HTMLElement).toHaveTextContent(/providers\.resourceAll\s*1/);
      expect(providerCard as HTMLElement).toHaveTextContent(/providers\.resourceEnabled\s*1/);
      expect(providerCard as HTMLElement).toHaveTextContent(/providers\.resourceSynced\s*1/);
      expect(providerCard as HTMLElement).toHaveTextContent(/providers\.resourcePriced\s*1/);
    });
    fireEvent.click(within(providerCard as HTMLElement).getByRole('button', { name: /providers.configureResources/ }));

    expect(await screen.findByLabelText('providers.resourceToggle:TW')).toBeInTheDocument();
    expect(screen.queryByLabelText('providers.resourceToggle:GB')).not.toBeInTheDocument();
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('providerCode=NINE_EIGHT_FIVE'))).toBe(true);
  });

  it('renders upstream line resources with Chinese region names in the configurator', async () => {
    mockProviderApis();

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));

    const line = formatResourceLocationZh(pricingMatrixResponse().items[2]);
    expect((await screen.findAllByText(line.country)).length).toBeGreaterThan(0);
    expect(await screen.findByText(line.detail!)).toBeInTheDocument();
    expect(await screen.findByText('US:1498453449724006400')).toBeInTheDocument();
  });

  it('shows every real provider resource returned by the matrix, not just enabled countries', async () => {
    mockProviderApis([providerRow({ enabledCountryCodes: ['GB'] })]);

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));

    expect(await screen.findByLabelText('providers.resourceToggle:GB')).toBeInTheDocument();
    expect(await screen.findByLabelText('providers.resourceToggle:HK')).toBeInTheDocument();
    expect(await screen.findByLabelText('providers.resourceToggle:SG')).toBeInTheDocument();
    expect(await screen.findByText('providers.resourceUnpriced')).toBeInTheDocument();
    expect(screen.getAllByText('providers.resourceSaleable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('providers.resourceUnsaleable').length).toBeGreaterThan(0);
  });

  it('calls the health-check endpoint and shows a reachable result with latency', async () => {
    const result: ProviderHealthCheckResult = {
      accountId: 'pa-1',
      providerCode: 'IPIPD',
      reachable: true,
      latencyMs: 42,
      reasonKey: null,
      detail: null,
      checkedAt: '2026-06-09T00:00:00.000Z',
    };
    const spy = vi
      .spyOn(client, 'apiRequest')
      .mockResolvedValueOnce([providerRow()])
      .mockResolvedValueOnce(pricingMatrixSummaryResponse())
      .mockResolvedValueOnce(result);

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));

    fireEvent.click(screen.getByRole('button', { name: /providers.healthCheck/ }));

    await screen.findAllByText(/42ms/);
    expect(
      spy.mock.calls.some(
        (c) => String(c[0]) === '/api/providers/pa-1/health-check',
      ),
    ).toBe(true);
    expect(screen.getAllByText(/42ms/).length).toBeGreaterThan(0);
  });

  it('shows a localized reason when a health check reports unreachable', async () => {
    const result: ProviderHealthCheckResult = {
      accountId: 'pa-1',
      providerCode: 'IPIPD',
      reachable: false,
      latencyMs: null,
      reasonKey: 'upstream_timeout',
      detail: 'timed out',
      checkedAt: '2026-06-09T00:00:00.000Z',
    };
    vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce([providerRow()])
      .mockResolvedValueOnce(pricingMatrixSummaryResponse())
      .mockResolvedValueOnce(result);

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));

    fireEvent.click(screen.getByRole('button', { name: /providers.healthCheck/ }));

    expect(await screen.findByText('上游响应超时')).toBeInTheDocument();
    expect(screen.queryByText('upstream_timeout')).not.toBeInTheDocument();
  });

  it('clears a stale reachable result when the next health check request fails', async () => {
    const reachable: ProviderHealthCheckResult = {
      accountId: 'pa-1',
      providerCode: 'IPIPD',
      reachable: true,
      latencyMs: 42,
      reasonKey: null,
      detail: null,
      checkedAt: '2026-06-09T00:00:00.000Z',
    };
    let healthCalls = 0;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/providers/pa-1/health-check' && init?.method === 'POST') {
        healthCalls += 1;
        return healthCalls === 1
          ? Promise.resolve(reachable)
          : Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'upstream_timeout'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));

    fireEvent.click(screen.getByRole('button', { name: /providers.healthCheck/ }));
    expect(await screen.findByText(/42ms/)).toBeInTheDocument();
    await vi.waitFor(() => expect(healthCalls).toBe(1));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /providers.healthCheck/ })).not.toHaveClass('ant-btn-loading'));

    fireEvent.click(screen.getByRole('button', { name: /providers.healthCheck/ }));
    await vi.waitFor(() => expect(healthCalls).toBe(2));

    expect(await screen.findByText('上游响应超时')).toBeInTheDocument();
    expect(screen.queryByText('upstream_timeout')).not.toBeInTheDocument();
    expect(screen.queryByText(/42ms/)).not.toBeInTheDocument();
  });

  it('saves editable provider configuration through PUT /api/providers/:id', async () => {
    let body: Record<string, unknown> | undefined;
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/providers/pa-1' && init?.method === 'PUT') {
        body = JSON.parse(init.body as string);
        return Promise.resolve(providerRow({ timeoutMs: 30000 }));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.change(screen.getByLabelText('providers.timeoutMs'), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: /providers.save/ }));

    await vi.waitFor(() => expect(body).toMatchObject({
      status: 'ACTIVE',
      baseUrl: 'https://api.example.com',
      timeoutMs: 30000,
      inventorySyncEnabled: true,
      enabledCountryCodes: ['GB', 'HK'],
    }));
    expect(spy.mock.calls.some((c) => c[0] === '/api/providers/pa-1')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('credential');
  });

  it('replaces the saved provider row and clears stale probe state after switching the base URL', async () => {
    const reachable: ProviderHealthCheckResult = {
      accountId: 'pa-1',
      providerCode: 'IPIPD',
      reachable: true,
      latencyMs: 42,
      reasonKey: null,
      detail: null,
      checkedAt: '2026-06-09T00:00:00.000Z',
    };
    let provider = providerRow();
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([provider]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/providers/pa-1/health-check' && init?.method === 'POST') return Promise.resolve(reachable);
      if (path === '/api/providers/pa-1' && init?.method === 'PUT') {
        provider = providerRow({
          baseUrl: 'https://sandbox.ipipd.cn',
          updatedAt: '2026-06-26T00:00:00.000Z',
        });
        return Promise.resolve(provider);
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.healthCheck/ }));
    expect(await screen.findByText(/42ms/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('providers.baseUrl'), { target: { value: 'https://sandbox.ipipd.cn' } });
    fireEvent.click(screen.getByRole('button', { name: /providers.save/ }));

    expect(await screen.findByDisplayValue('https://sandbox.ipipd.cn')).toBeInTheDocument();
    expect(screen.queryByText(/42ms/)).not.toBeInTheDocument();
  });

  it('updates saleable upstream resources from the resource setup drawer', async () => {
    let saleabilityBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/providers/pa-1/resources/saleability' && init?.method === 'PUT') {
        saleabilityBody = JSON.parse(init.body as string);
        return Promise.resolve(providerRow({ enabledCountryCodes: ['HK'] }));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    expect(await screen.findByLabelText('providers.resourceToggle:SG')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('providers.resourceToggle:GB'));
    fireEvent.click(screen.getByRole('button', { name: /providers.saveSaleableResources/ }));

    await vi.waitFor(() => expect(saleabilityBody).toEqual({
      items: [{ resourceId: 'res-gb-native', saleable: false }],
    }));
  });

  it('keeps saleability saves scoped to loaded provider pages while preserving server pagination', async () => {
    const saleabilityBodies: Record<string, unknown>[] = [];
    const paths: string[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const url = String(path);
      paths.push(url);
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow({ enabledCountryCodes: ['GB', 'HK'] })]);
      if (url.startsWith('/api/pricing/matrix/summary')) {
        return Promise.resolve(pricingMatrixSummaryResponse());
      }
      if (url.startsWith('/api/pricing/matrix') && url.includes('page=1')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 40,
          items: [{
            ...pricingMatrixResponse().items[0],
            resourceId: 'res-first-page',
            code: 'GB',
          }],
        });
      }
      if (url.startsWith('/api/pricing/matrix') && url.includes('page=2')) {
        return Promise.resolve({
          page: 2,
          pageSize: 20,
          total: 40,
          items: [{
            ...pricingMatrixResponse().items[1],
            resourceId: 'res-second-page',
            code: 'HK',
          }],
        });
      }
      if (path === '/api/providers/pa-1/resources/saleability' && init?.method === 'PUT') {
        saleabilityBodies.push(JSON.parse(init.body as string));
        return Promise.resolve(providerRow({ enabledCountryCodes: ['HK'] }));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    await screen.findByLabelText('providers.resourceToggle:GB');
    expect(screen.queryByLabelText('providers.resourceToggle:HK')).not.toBeInTheDocument();
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('page=2'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /providers.resourceClearAll/ }));
    fireEvent.click(screen.getByRole('button', { name: /providers.saveSaleableResources/ }));

    await vi.waitFor(() => {
      expect(saleabilityBodies[0]?.items).toEqual([
        { resourceId: 'res-first-page', saleable: false },
      ]);
    });
    clickProviderResourcePage(2);
    await screen.findByLabelText('providers.resourceToggle:HK');
    expect(paths.some((path) => path.includes('/api/pricing/matrix') && path.includes('page=2'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /providers.resourceClearAll/ }));
    fireEvent.click(screen.getByRole('button', { name: /providers.saveSaleableResources/ }));

    await vi.waitFor(() => {
      expect(saleabilityBodies[1]?.items).toEqual([
        { resourceId: 'res-second-page', saleable: false },
      ]);
    });
  });

  it('delegates country rebuild to the provider saleability endpoint', async () => {
    let saleabilityBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) {
        return Promise.resolve([providerRow({ enabledCountryCodes: [] })]);
      }
      if (String(path).startsWith('/api/pricing/matrix/summary')) {
        return Promise.resolve(pricingMatrixSummaryResponse());
      }
      if (String(path).startsWith('/api/pricing/matrix')) {
        return Promise.resolve(pricingMatrixResponse());
      }
      if (path === '/api/providers/pa-1/resources/saleability' && init?.method === 'PUT') {
        saleabilityBody = JSON.parse(init.body as string);
        return Promise.resolve(providerRow({ enabledCountryCodes: ['GB', 'SG'] }));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    await screen.findByLabelText('providers.resourceToggle:SG');
    fireEvent.click(screen.getByLabelText('providers.resourceToggle:HK'));
    fireEvent.click(screen.getByRole('button', { name: /providers.saveSaleableResources/ }));

    await vi.waitFor(() => expect(saleabilityBody).toEqual({
      items: [{ resourceId: 'res-hk-broadcast', saleable: false }],
    }));
  });

  it('does not create placeholder countries when no upstream resources are synced', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) {
        return Promise.resolve([providerRow({
          providerCode: 'PR',
          enabledCountryCodes: ['SG'],
          availableCountries: [{ code: 'SG', name: 'Singapore' }],
        })]);
      }
      if (String(path).startsWith('/api/pricing/matrix/summary')) {
        return Promise.resolve(pricingMatrixSummaryResponse([{ providerCode: 'PR', total: 0, enabled: 0, synced: 0, priced: 0 }]));
      }
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText('PR 平台');
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));

    expect((await screen.findAllByText('providers.resourceAll')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('providers.resourceToggle:SG')).not.toBeInTheDocument();
  });

  it('saves provider resource price through pricing overrides endpoint', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        body = JSON.parse(init.body as string);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    await screen.findByLabelText('providers.resourceToggle:SG');
    expect(screen.getByText(/providers\.resourceCost: 30\.00 CNY/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('providers.resourcePrice:GB'), { target: { value: '68.5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /providers.resourceSavePrice/ })[0]);

    await vi.waitFor(() => expect(body).toEqual({
      resourceId: 'res-gb-native',
      durationDays: 30,
      unitPrice: '68.5',
      currency: 'CNY',
    }));
  });

  it('keeps duplicate region resources as separate configurable upstream rows', async () => {
    const priceBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow({ enabledCountryCodes: ['US'] })]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(duplicateRegionPricingMatrixResponse());
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        priceBodies.push(JSON.parse(init.body as string));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));

    const priceInput = await screen.findByLabelText('providers.resourcePrice:US:1484931183170162688');
    expect(screen.getAllByLabelText(/providers\.resourcePrice:US:/)).toHaveLength(2);
    expect(screen.getAllByText('providers.resourceGroupCount')).toHaveLength(2);
    expect(screen.queryByText('providers.resourceStockTotal')).not.toBeInTheDocument();
    expect(screen.queryByText('providers.resourceStock')).not.toBeInTheDocument();

    fireEvent.change(priceInput, { target: { value: '28' } });
    fireEvent.click(screen.getAllByRole('button', { name: /providers.resourceSavePrice/ })[0]);

    await vi.waitFor(() => expect(priceBodies).toHaveLength(1));
    expect(priceBodies[0]).toMatchObject({ resourceId: 'res-us-1', unitPrice: '28' });
  });

  it('does not expose manual inventory snapshot editing in provider resource setup', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      calls.push({ path: String(path), init });
      if (path === '/api/providers' && !init?.method) return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    await screen.findByLabelText('providers.resourceToggle:SG');

    expect(screen.queryByLabelText('providers.resourceStock:GB')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /providers.resourceSaveStock/ })).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('/inventory') && call.init?.method === 'PUT')).toBe(false);
  });

  it('syncs inventory through the card sync button and real resources endpoint', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers') return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/resources/sync-inventory') {
        body = JSON.parse(init?.body as string);
        return Promise.resolve({
          attempted: 11,
          created: 3,
          updated: 8,
          skipped: 0,
          failed: 0,
          synced: 11,
          syncedAt: '2026-06-12T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['GB', 'HK'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    await clickCardSyncInventory();

    await vi.waitFor(() => expect(body).toEqual({ providerCode: 'IPIPD', accountId: 'pa-1' }));
    expect(await screen.findByText('providers.syncInventoryResult')).toBeInTheDocument();
    expect(screen.queryByText('providers.syncInventoryDetail')).not.toBeInTheDocument();
  });

  it('surfaces inventory sync failures instead of showing a success result', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/providers') return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/resources/sync-inventory') {
        return Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'inventory_empty'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    await clickCardSyncInventory();

    expect((await screen.findAllByText('上游没有返回可用库存')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('inventory_empty')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText('providers.syncInventoryResult')).not.toBeInTheDocument());
  });

  it('clears a stale inventory sync result when the next sync fails', async () => {
    let syncCalls = 0;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers') return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        syncCalls += 1;
        return syncCalls === 1
          ? Promise.resolve({
            attempted: 11,
            created: 3,
            updated: 8,
            skipped: 0,
            failed: 0,
            synced: 11,
            syncedAt: '2026-06-12T00:00:00.000Z',
            upstreamRawStatus: 'SUCCESS',
            countries: ['GB', 'HK'],
          })
          : Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'inventory_empty'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));

    await clickCardSyncInventory();
    expect(await screen.findByText('providers.syncInventoryResult')).toBeInTheDocument();

    await clickCardSyncInventory();

    expect((await screen.findAllByText('上游没有返回可用库存')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('inventory_empty')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText('providers.syncInventoryResult')).not.toBeInTheDocument());
  });

  it('syncs inventory from the resource setup drawer through the real resources endpoint', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers') return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/resources/sync-inventory') {
        body = JSON.parse(init?.body as string);
        return Promise.resolve({
          attempted: 11,
          created: 3,
          updated: 8,
          skipped: 0,
          failed: 0,
          synced: 11,
          syncedAt: '2026-06-12T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['GB', 'HK'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    clickDrawerSyncInventory();

    await vi.waitFor(() => expect(body).toEqual({ providerCode: 'IPIPD', accountId: 'pa-1' }));
  });

  it('shows drawer inventory sync failure reason without keeping a success result', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers') return Promise.resolve([providerRow()]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve(pricingMatrixSummaryResponse());
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'inventory_empty'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText(formatProviderLabel('IPIPD'));
    fireEvent.click(screen.getByRole('button', { name: /providers.configureResources/ }));
    clickDrawerSyncInventory();

    expect((await screen.findAllByText('providers.syncInventoryIssueTitle')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('上游没有返回可用库存').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('inventory_empty')).not.toBeInTheDocument();
    expect(screen.queryByText('providers.syncInventoryResult')).not.toBeInTheDocument();
  });

  it('creates a provider account through POST /api/providers', async () => {
    let body: Record<string, unknown> | undefined;
    let syncBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/providers' && !init?.method) return Promise.resolve([]);
      if (String(path).startsWith('/api/pricing/matrix/summary')) return Promise.resolve([]);
      if (String(path).startsWith('/api/pricing/matrix')) return Promise.resolve(pricingMatrixResponse());
      if (path === '/api/providers' && init?.method === 'POST') {
        body = JSON.parse(init.body as string);
        return Promise.resolve(providerRow({ providerCode: 'NINE_EIGHT_FIVE', baseUrl: 'https://open-api.985proxy.com' }));
      }
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        syncBody = JSON.parse(init.body as string);
        return Promise.resolve({
          attempted: 3,
          created: 3,
          updated: 0,
          skipped: 0,
          failed: 0,
          synced: 3,
          syncedAt: '2026-06-12T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['TW'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<ProviderHealthFeature />);
    await screen.findByText('providers.empty');
    fireEvent.click(screen.getByRole('button', { name: /providers.create/ }));
    fireEvent.mouseDown(screen.getByLabelText('providers.providerCode'));
    fireEvent.click(await screen.findByText('985 平台'));
    fireEvent.change(screen.getByLabelText('providerAccounts.credential.apikey'), { target: { value: 'key-1' } });
    fireEvent.change(screen.getByLabelText('providerAccounts.credential.zoneId'), { target: { value: 'zone-1' } });
    fireEvent.click(screen.getByRole('button', { name: /providers.createSubmit/ }));

    await vi.waitFor(() => expect(body).toMatchObject({
      providerCode: 'NINE_EIGHT_FIVE',
      status: 'ACTIVE',
      baseUrl: 'https://open-api.985proxy.com',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: [],
      credential: { apikey: 'key-1', zoneId: 'zone-1' },
    }));
    await vi.waitFor(() => expect(syncBody).toEqual({ providerCode: 'NINE_EIGHT_FIVE', accountId: 'pa-1' }));
  });

  it('shows a localized backend reason on list error', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(
      new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'),
    );

    renderWithQuery(<ProviderHealthFeature />);

    expect(await screen.findByText('当前账号没有权限')).toBeInTheDocument();
    expect(screen.queryByText('insufficient_permissions')).not.toBeInTheDocument();
  });
});
