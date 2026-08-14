import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildProxyBatchLifecyclePath,
  buildProxyExportPath,
  buildProxyLifecyclePath,
  CustomerProxyListFeature,
} from '../proxy-list.feature';
import {
  buildStaticProxyOrderBody,
  buildStaticProxyQuotePath,
  BuyStaticProxyFeature,
  matchesResourceSearch,
} from '../buy-static-proxy.feature';
import * as client from '../../../shared/api/client';
import { formatCustomerChannelLabel, formatProviderLabel } from '../../../shared/provider/provider-labels';
import { formatResourceLocationZh } from '../../../shared/resource/resource-labels';
import { formatDateTime } from '../../../shared/time/time';

const mockI18nLanguage = vi.hoisted(() => ({ current: 'zh-CN' }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'customer.proxies.batchResult.errorMeta') {
        return '处理失败';
      }
      if (key === 'customer.buy.ipCount') {
        return mockI18nLanguage.current.startsWith('en')
          ? `${values?.count ?? 0} IPs`
          : `${values?.count ?? 0} 个代理`;
      }
      if (key === 'customer.buy.reason.out_of_stock') return '当前上游库存不足';
      if (key === 'customer.proxies.reason.proxy_query_failed') return '代理列表读取失败';
      if (key === 'customer.proxies.reason.renew_not_supported') return '该代理暂不支持续费';
      return key;
    },
    i18n: {
      get resolvedLanguage() {
        return mockI18nLanguage.current;
      },
      get language() {
        return mockI18nLanguage.current;
      },
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

type ResourceLabelInput = Parameters<typeof formatResourceLocationZh>[0] & { id?: string };

function resourceLocationLabel(resource: ResourceLabelInput) {
  return formatResourceLocationZh(resource);
}

function resolveBuyResourceRequest(path: string, resources: Array<Record<string, unknown>>) {
  if (!path.startsWith('/api/resources')) return null;
  const url = new URL(`https://example.test${path}`);
  const search = url.searchParams.get('search') ?? '';
  const visibleResources = resources
    .filter(isTestPurchaseVisibleResource)
    .filter((resource) => matchesResourceSearch(resource as unknown as Parameters<typeof matchesResourceSearch>[0], search));
  if (url.pathname === '/api/resources/countries') {
    const countries = new Map<string, { countryCode: string; totalResources: number; availableStock: number }>();
    for (const resource of visibleResources) {
      const countryCode = String(resource.countryCode ?? String(resource.code ?? '').slice(0, 2)).toUpperCase();
      const current = countries.get(countryCode) ?? { countryCode, totalResources: 0, availableStock: 0 };
      current.totalResources += 1;
      const stock = Number(resource.stock ?? 0);
      if (Number.isFinite(stock) && stock > 0 && resource.inventoryIsStale !== true) current.availableStock += stock;
      countries.set(countryCode, current);
    }
    return { items: [...countries.values()] };
  }
  const countryCode = url.searchParams.get('countryCode');
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
  const countryResources = visibleResources.filter((resource) => {
    if (!countryCode) return true;
    const code = String(resource.countryCode ?? resource.code ?? '').toUpperCase();
    const normalizedCountryCode = countryCode.toUpperCase();
    return code === normalizedCountryCode || code.startsWith(`${normalizedCountryCode}:`);
  });
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: countryResources.length,
    items: countryResources.slice(start, start + pageSize),
  };
}

function isTestPurchaseVisibleResource(resource: Record<string, unknown>) {
  if (resource.status && resource.status !== 'ACTIVE') return false;
  if (resource.isVisible === false) return false;
  if (resource.isSaleable === false) return false;
  return typeof resource.unitPrice === 'string' && resource.unitPrice.trim() !== '';
}

function findVisibleTextNodes(text: string | RegExp) {
  return screen.findAllByText((_, element) => {
    const textContent = element?.textContent ?? '';
    return typeof text === 'string' ? textContent.includes(text) : text.test(textContent);
  });
}

function expectSimplifiedOrderSummary() {
  expect(document.querySelector('.ipx-selected-resource-summary')).not.toBeNull();
  expect(document.querySelector('.ipx-selected-resource-grid')).toBeNull();
  expect(document.querySelector('.ipx-selected-resource-summary .ipx-detail-pill')).toBeNull();
  expect(document.querySelector('.ipx-order-selected .ipx-detail-pill')).toBeNull();
}

async function waitForAutoAssignedResource() {
  await waitFor(() => {
    expect(document.querySelector('.ipx-buy-auto-panel')).not.toBeNull();
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    expect(document.querySelector('.ipx-buy-auto-panel .ipx-detail-pill')).toBeNull();
    expectSimplifiedOrderSummary();
  });
}

async function clickCountryOption(label: string) {
  const button = await waitFor((): HTMLButtonElement => {
    const candidate = Array.from(document.querySelectorAll('button.ipx-buy-option-card'))
      .find((element): element is HTMLButtonElement => {
        if (!(element instanceof HTMLButtonElement)) return false;
        return (element.textContent ?? '').includes(label);
      });
    expect(candidate).toBeTruthy();
    if (!candidate) throw new Error(`country option not found: ${label}`);
    return candidate;
  });
  fireEvent.click(button);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockI18nLanguage.current = 'zh-CN';
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

function resolveCustomerShellRequest(path: string) {
  if (path === '/api/auth/me') {
    return Promise.resolve({
      ownerId: 'user-1',
      ownerType: 'USER',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      scopes: [],
    });
  }
  if (path === '/api/wallet/user-1') {
    return Promise.resolve({ available: '100.00', currency: 'CNY' });
  }
  return null;
}

describe('customer proxy flow contracts', () => {
  it('lists customer proxies through the real /api/proxies endpoint', async () => {
    const spy = vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 0,
          items: [],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.some(([path]) => path.toString().startsWith('/api/proxies?'))).toBe(true);
    expect(spy.mock.calls.some(([path]) => path.toString().includes('/mine'))).toBe(false);
  });

  it('uses backend quote parameter names for static proxy purchase', () => {
    const path = buildStaticProxyQuotePath({
      resourceId: 'resource-1',
      durationDays: 30,
      quantity: 2,
      currency: 'CNY',
    });

    expect(path).toBe('/api/pricing/quote?resourceId=resource-1&durationDays=30&quantity=2&currency=CNY');
  });

  it('builds static proxy order body with resourceId and durationDays', () => {
    expect(buildStaticProxyOrderBody({
      resourceId: 'resource-1',
      durationDays: 30,
      quantity: 2,
      currency: 'CNY',
      idempotencyKey: 'key-1',
    })).toEqual({
      resourceId: 'resource-1',
      durationDays: 30,
      quantity: 2,
      currency: 'CNY',
      idempotencyKey: 'key-1',
    });
  });

  it('matches product search by name, Chinese region label, code, and provider', () => {
    const resource = {
      id: 'resource-fr',
      code: 'FR',
      name: 'France',
      displayName: 'France-Paris Recommended',
      countryCode: 'FR',
      upstreamResourceId: 'ipipd-fr-paris-rec',
      providerCode: 'IPIPD',
      protocol: 'BOTH',
      ipType: 'NATIVE',
      stock: 1101,
      inventoryIsStale: false,
      unitPrice: '10',
      priceCurrency: 'CNY',
    };

    expect(matchesResourceSearch(resource, 'not-present')).toBe(false);
    expect(matchesResourceSearch(resource, resourceLocationLabel(resource).country)).toBe(true);
    expect(matchesResourceSearch(resource, 'Paris Recommended')).toBe(true);
    expect(matchesResourceSearch(resource, 'ipipd-fr-paris-rec')).toBe(true);
    expect(matchesResourceSearch(resource, 'FR')).toBe(true);
    expect(matchesResourceSearch(resource, 'IPIPD')).toBe(true);
    expect(matchesResourceSearch(resource, '不存在')).toBe(false);
  });

  it('shows a simplified country-only summary in the static proxy purchase card', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-sg',
              code: 'SG:6928',
              name: 'Singapore',
              displayName: 'Singapore-Singapore Residential',
              countryCode: 'SG',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 12,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText(resourceLocationLabel({
      id: 'resource-sg',
      code: 'SG:6928',
      name: 'Singapore',
      displayName: 'Singapore-Singapore Residential',
      countryCode: 'SG',
      providerCode: 'PR',
    }).country)).length).toBeGreaterThan(0);
    expect(screen.getByText('customer.buy.lineTitle')).toBeInTheDocument();
    await waitForAutoAssignedResource();
    expectSimplifiedOrderSummary();
    expect(screen.queryByText(formatProviderLabel('PR'))).not.toBeInTheDocument();
    expect(screen.queryByText(/customer\.buy\.selectionCountry|customer\.buy\.selectionCity|customer\.buy\.selectionLine/)).not.toBeInTheDocument();
    expect(screen.queryByText(/customer\.buy\.stockAvailable/)).not.toBeInTheDocument();
    expect(screen.getByText('customer.buy.orderTitle')).toBeInTheDocument();
  });

  it('renders English resource labels and money units in English mode', async () => {
    mockI18nLanguage.current = 'en-US';
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path === '/api/resources/countries?durationDays=30&currency=CNY') {
        return Promise.resolve({ items: [{ countryCode: 'AT', totalResources: 1, availableStock: 12 }] });
      }
      if (path === '/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=AT') {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [
            {
              id: 'resource-at-lower-austria',
              code: 'AT:6928:Lower Austria',
              upstreamResourceId: 'AT:6928:Lower Austria',
              name: 'Austria-Lower Austria',
              displayName: 'Austria-Lower Austria',
              countryCode: 'AT',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 12,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
              costGroupKey: 'CNY:1',
            },
          ],
        });
      }
      if (path === '/api/pricing/quote?resourceId=resource-at-lower-austria&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '28', totalPrice: '28.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText('Austria')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Line 1')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('28.00 CNY')).length).toBeGreaterThan(0);
    expect(screen.queryByText('\u5965\u5730\u5229')).not.toBeInTheDocument();
    expect(screen.queryByText('28.00 \u5143')).not.toBeInTheDocument();
  });

  it('renders stable SKU titles without a random fallback label', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-sg-6928',
              code: 'SG:6928',
              name: 'Singapore',
              displayName: 'Singapore-Unknownville Beta',
              countryCode: 'SG',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 12,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '28', totalPrice: '28.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const sgCountry = resourceLocationLabel({
      id: 'resource-sg-6928',
      code: 'SG:6928',
      name: 'Singapore',
      displayName: 'Singapore-SingTel Business',
      countryCode: 'SG',
      providerCode: 'PR',
    }).country;
    expect((await screen.findAllByText(sgCountry)).length).toBeGreaterThan(0);
    expect(screen.getByText('customer.buy.lineTitle')).toBeInTheDocument();
    expect(screen.queryByText('customer.buy.randomNetwork')).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknownville/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-sg-6928&durationDays=30&quantity=1&currency=CNY'),
    );
  });

  it('shows the selected resource region in the summary detail pill', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-ny-rec',
              code: 'US:NY_REC',
              name: 'United States',
              displayName: 'United States-New York Recommended',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 30,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '21', totalPrice: '21.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());
    expectSimplifiedOrderSummary();
    expect(screen.getAllByText('美国').length).toBeGreaterThan(0);
    expect(screen.queryByText('customer.buy.selectionLine')).not.toBeInTheDocument();
  });

  it('renders Canadian Proxy-Seller region and carrier labels in Chinese on the purchase page', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-ca-mb',
              code: 'CA:6928:Manitoba:Lac du Bonnet:Commstream Communications',
              name: 'Canada-Manitoba - Lac du Bonnet - Commstream Communications',
              displayName: 'Canada-Manitoba - Lac du Bonnet - Commstream Communications',
              upstreamResourceId: 'CA:6928:Manitoba:Lac du Bonnet:Commstream Communications',
              countryCode: 'CA',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 1,
              inventoryIsStale: false,
              unitPrice: '39',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '39', totalPrice: '39.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const location = resourceLocationLabel({
      id: 'resource-ca-mb',
      code: 'CA:6928:Manitoba:Lac du Bonnet:Commstream Communications',
      countryCode: 'CA',
      providerCode: 'PR',
    });

    expect((await screen.findAllByText(location.country)).length).toBeGreaterThan(0);
    expect(screen.queryByText('网段 1')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());

    expectSimplifiedOrderSummary();
    expect(screen.queryByText(/Manitoba|Lac du Bonnet|Commstream Communications/i)).not.toBeInTheDocument();
  });

  it('renders upstream US city codes as Chinese city names in the purchase page', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-phx',
              code: 'US',
              name: 'USAARIPHX',
              displayName: null,
              countryCode: 'US',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 1,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '28', totalPrice: '28.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect(screen.queryByText('USAARIPHX')).not.toBeInTheDocument();
    expect(screen.queryByText('US:USAARIPHX')).not.toBeInTheDocument();
  });

  it('filters buyable products by product name from the purchase page search box', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-gb',
          code: 'GB',
          name: 'United Kingdom',
          displayName: null,
          countryCode: 'GB',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 464,
          inventoryIsStale: false,
          unitPrice: '10',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-fr',
          code: 'FR',
          name: 'France',
          displayName: null,
          countryCode: 'FR',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 1101,
          inventoryIsStale: false,
          unitPrice: '10',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText(resourceLocationLabel({
      id: 'resource-gb',
      code: 'GB',
      name: 'United Kingdom',
      displayName: null,
      countryCode: 'GB',
      providerCode: 'IPIPD',
    }).country)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(resourceLocationLabel({
      id: 'resource-fr',
      code: 'FR',
      name: 'France',
      displayName: null,
      countryCode: 'FR',
      providerCode: 'IPIPD',
    }).country).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText('customer.buy.productSearchPlaceholder'), {
      target: { value: 'France' },
    });

    await waitFor(() =>
      expect(paths.some((path) => path.includes('search=France'))).toBe(true),
    );
    expect(screen.queryByText(resourceLocationLabel({
      id: 'resource-gb',
      code: 'GB',
      name: 'United Kingdom',
      displayName: null,
      countryCode: 'GB',
      providerCode: 'IPIPD',
    }).country)).not.toBeInTheDocument();
    expect(screen.getAllByText(resourceLocationLabel({
      id: 'resource-fr',
      code: 'FR',
      name: 'France',
      displayName: null,
      countryCode: 'FR',
      providerCode: 'IPIPD',
    }).country).length).toBeGreaterThan(0);
  });

  it('keeps static proxy purchase duration fixed to 30 days', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-gb',
              code: 'GB',
              name: 'United Kingdom',
              displayName: null,
              countryCode: 'GB',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 464,
              inventoryIsStale: false,
              unitPrice: '10',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-gb&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(screen.getAllByText('30 customer.buy.days').length).toBeGreaterThan(0);
    expect(screen.queryByText('60customer.buy.days')).not.toBeInTheDocument();
    expect(screen.queryByText('90customer.buy.days')).not.toBeInTheDocument();
  });

  it('uses the pricing quote endpoint so admin prices take effect in the customer purchase page', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-sg',
          code: 'SG:6928',
          name: 'Singapore',
          displayName: 'Singapore-Singapore Residential',
          countryCode: 'SG',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 20,
          inventoryIsStale: false,
          unitPrice: '28.00',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 694,
          inventoryIsStale: false,
          unitPrice: '35.00',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-hk',
          code: 'HK',
          name: 'Hong Kong',
          displayName: null,
          countryCode: 'HK',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: null,
          inventoryIsStale: null,
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path.startsWith('/api/pricing/quote')) {
        const url = new URL(`https://example.test${path}`);
        const resourceId = url.searchParams.get('resourceId');
        if (resourceId === 'resource-sg') {
          return Promise.resolve({ unitPrice: '28.00', totalPrice: '28.00', currency: 'CNY' });
        }
        return Promise.resolve({ unitPrice: '35.00', totalPrice: '70.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);
    expect((await screen.findAllByText('菲律宾')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('新加坡').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText('新加坡')[0]!);
    expect(screen.getAllByText('新加坡').length).toBeGreaterThan(0);
    expect(screen.queryByText(/香港/)).not.toBeInTheDocument();
    expect(screen.queryByText('-- 元')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(paths.some((path) =>
        path.startsWith('/api/pricing/quote?resourceId=resource-sg&durationDays=30&quantity=1&currency=CNY'),
      )).toBe(true),
    );
    expect((await screen.findAllByText('28.00 元')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('菲律宾'));
    fireEvent.click(screen.getAllByText('菲律宾')[1]!);
    fireEvent.change(screen.getAllByRole('spinbutton').find((input) => !input.hasAttribute('disabled'))!, { target: { value: '2' } });

    await waitFor(() =>
      expect(paths.some((path) =>
        path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=2&currency=CNY',
      )).toBe(true),
    );
    expect(paths.some((path) =>
      path === '/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=PH',
    )).toBe(true);
    expect(await screen.findByText('70.00 元')).toBeInTheDocument();
  });

  it('quotes Proxy-Seller resources only when the latest inventory is positive and fresh', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-ca',
              code: 'CA:6928',
              name: 'Canada',
              displayName: null,
              countryCode: 'CA',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 7,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '28', totalPrice: '28.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText('加拿大')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ca&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(await screen.findByText('28.00 元')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled();
  });

  it('shows priced configured resources when current inventory is zero and lets quote verify stock', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-zero',
              code: 'PL',
              name: 'Poland',
              displayName: null,
              countryCode: 'PL',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 0,
              inventoryIsStale: false,
              unitPrice: '10',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.reject(new client.ApiError('UPSTREAM_OUT_OF_STOCK', 'out_of_stock'));
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitForAutoAssignedResource();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-zero&durationDays=30&quantity=1&currency=CNY'),
    );
    expect((await screen.findAllByText('当前上游库存不足')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/out_of_stock/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).toBeDisabled());
  });

  it('does not render resources that the backend filtered out for missing price', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-gb',
              code: 'GB',
              name: 'United Kingdom',
              displayName: null,
              countryCode: 'GB',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 464,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const gbLocation = resourceLocationLabel({
      id: 'resource-gb',
      code: 'GB',
      name: 'United Kingdom',
      displayName: null,
      countryCode: 'GB',
      providerCode: 'IPIPD',
    });
    expect((await screen.findAllByText(gbLocation.country)).length).toBeGreaterThan(0);
    expect(screen.queryByText('customer.buy.noPrice')).not.toBeInTheDocument();
    expect(screen.queryByText(/-- 元/)).not.toBeInTheDocument();
    expect(paths.some((path) => path === '/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=GB')).toBe(true);
  });

  it('hides stocked resources without a visible price instead of rendering placeholder prices', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-gb',
              code: 'GB',
              name: 'United Kingdom',
              displayName: null,
              countryCode: 'GB',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 464,
              inventoryIsStale: false,
              unitPrice: null,
              priceCurrency: null,
            },
            {
              id: 'resource-fr',
              code: 'FR',
              name: 'France',
              displayName: null,
              countryCode: 'FR',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 1101,
              inventoryIsStale: false,
              unitPrice: '10',
              priceCurrency: 'CNY',
            },
            {
              id: 'resource-sg',
              code: 'SG',
              name: 'Singapore',
              displayName: null,
              countryCode: 'SG',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 20,
              inventoryIsStale: false,
              unitPrice: '12',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '10', totalPrice: '10.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect(screen.queryByText(resourceLocationLabel({
      id: 'resource-gb',
      code: 'GB',
      name: 'United Kingdom',
      displayName: null,
      countryCode: 'GB',
      providerCode: 'IPIPD',
    }).country)).not.toBeInTheDocument();
    expect(screen.queryByText('-- 元')).not.toBeInTheDocument();
    expect(screen.queryByText('10 元')).not.toBeInTheDocument();
    expect(paths.some((path) => path.startsWith('/api/pricing/quote'))).toBe(false);
  });

  it('quotes priced stocked regions after selecting their country and SKU', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-us-ny',
          code: 'US:NY_REC',
          name: 'United States',
          displayName: 'United States-New York Recommended',
          countryCode: 'US',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 30,
          inventoryIsStale: false,
          unitPrice: '21',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '21', totalPrice: '21.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const usCountry = resourceLocationLabel({
      id: 'resource-us-ny',
      code: 'US:NY_REC',
      name: 'United States',
      displayName: 'United States-New York Recommended',
      countryCode: 'US',
      providerCode: 'IPIPD',
    }).country;
    expect((await findVisibleTextNodes(usCountry)).length).toBeGreaterThan(0);
    await clickCountryOption(usCountry);
    await waitForAutoAssignedResource();
    expect(screen.queryByText('网段 1')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-ny&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(await screen.findByText('21.00 元')).toBeInTheDocument();
    expect(screen.queryByText('customer.buy.notPurchasable')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.buy.staleInventory')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled();
  });

  it('groups upstream resources by country and automatically quotes the preferred product', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-ny-rec',
              code: 'US:NY_REC',
              name: 'United States',
              displayName: 'United States-New York Recommended',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 93,
              inventoryIsStale: false,
              unitPrice: '14',
              priceCurrency: 'CNY',
            },
            {
              id: 'resource-us-ny-normal',
              code: 'US:NY_NORMAL',
              name: 'United States',
              displayName: 'United States-New York Normal',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 4728,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        const url = new URL(`https://example.test${path}`);
        const resourceId = url.searchParams.get('resourceId');
        return Promise.resolve({
          unitPrice: resourceId === 'resource-us-ny-rec' ? '14' : '21',
          totalPrice: resourceId === 'resource-us-ny-rec' ? '14.00' : '21.00',
          currency: 'CNY',
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const usCountry = resourceLocationLabel({
      id: 'resource-us-ny-rec',
      code: 'US:NY_REC',
      name: 'United States',
      displayName: 'United States-New York Recommended',
      countryCode: 'US',
      providerCode: 'IPIPD',
    }).country;
    expect((await findVisibleTextNodes(usCountry)).length).toBeGreaterThan(0);
    await clickCountryOption(usCountry);

    await waitForAutoAssignedResource();
    expect(screen.queryByText('网段 1')).not.toBeInTheDocument();
    expect(screen.queryByText('网段 2')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-ny-rec&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths).not.toContain('/api/pricing/quote?resourceId=resource-us-ny-normal&durationDays=30&quantity=1&currency=CNY');
    expect(await screen.findByText('14.00 元')).toBeInTheDocument();
  });

  it('refreshes the quote when the current resource price changes in the resource list', async () => {
    let currentPrice = '28';
    const quotePaths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-sg',
              code: 'SG:6928',
              name: 'Singapore',
              displayName: 'Singapore-Singapore Residential',
              countryCode: 'SG',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 12,
              inventoryIsStale: false,
              unitPrice: currentPrice,
              priceCurrency: 'CNY',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        quotePaths.push(path);
        return Promise.resolve({ unitPrice: currentPrice, totalPrice: currentPrice, currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    const { queryClient } = renderWithQuery(<BuyStaticProxyFeature />);
    await waitFor(() => expect(quotePaths.length).toBeGreaterThan(0));
    expect(await screen.findByText('28.00 元')).toBeInTheDocument();

    currentPrice = '31';
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      await queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
    });

    await waitFor(() => expect(quotePaths.length).toBeGreaterThan(1));
    expect(await screen.findByText('31.00 元')).toBeInTheDocument();
  });

  it('sorts SKU purchase lines by the lowest configured price first', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-ny-normal',
              code: 'US',
              name: 'United States-New York Normal',
              displayName: 'United States-New York Normal',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 200,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
            },
            {
              id: 'resource-us-ny-rec',
              code: 'US',
              name: 'United States-New York Recommended',
              displayName: 'United States-New York Recommended',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 93,
              inventoryIsStale: false,
              unitPrice: '14',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        const url = new URL(`https://example.test${path}`);
        const resourceId = url.searchParams.get('resourceId');
        return Promise.resolve({
          unitPrice: resourceId === 'resource-us-ny-rec' ? '14' : '21',
          totalPrice: resourceId === 'resource-us-ny-rec' ? '14.00' : '21.00',
          currency: 'CNY',
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await findVisibleTextNodes(resourceLocationLabel({
      id: 'resource-us-ny-rec',
      code: 'US:NY_REC',
      name: 'United States',
      displayName: 'United States-New York Recommended',
      countryCode: 'US',
      providerCode: 'IPIPD',
    }).country)).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-ny-rec&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(await screen.findByText('14.00 元')).toBeInTheDocument();
    expect(screen.getByText('customer.buy.lineTitle')).toBeInTheDocument();
  });

  it('splits customer purchase lines by backend cost group and quotes the selected line', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-low-cost',
              code: 'US:line-low',
              name: 'United States',
              displayName: 'United States-New York Recommended',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 93,
              inventoryIsStale: false,
              unitPrice: '14',
              priceCurrency: 'CNY',
              costGroupKey: 'cost-low',
            },
            {
              id: 'resource-us-high-cost',
              code: 'US:line-high',
              name: 'United States',
              displayName: 'United States-New York Premium',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 88,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
              costGroupKey: 'cost-high',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        const url = new URL(`https://example.test${path}`);
        const resourceId = url.searchParams.get('resourceId');
        return Promise.resolve({
          unitPrice: resourceId === 'resource-us-low-cost' ? '14' : '21',
          totalPrice: resourceId === 'resource-us-low-cost' ? '14.00' : '21.00',
          currency: 'CNY',
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText('线路 1')).length).toBeGreaterThan(0);
    expect(screen.getByText('线路 2')).toBeInTheDocument();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-low-cost&durationDays=30&quantity=1&currency=CNY'),
    );

    fireEvent.click(screen.getByText('线路 2'));

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-high-cost&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(await screen.findByText('21.00 元')).toBeInTheDocument();
  });

  it('loads customer saleable resources from a fast first backend page', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path === '/api/resources/countries?durationDays=30&currency=CNY') {
        return Promise.resolve({
          items: [
            { countryCode: 'FR', totalResources: 1, availableStock: 1101 },
            { countryCode: 'SG', totalResources: 1, availableStock: 20 },
          ],
        });
      }
      if (path === '/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=FR') {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [
            {
              id: 'resource-fr',
              code: 'FR',
              name: 'France',
              displayName: null,
              countryCode: 'FR',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 1101,
              inventoryIsStale: false,
              unitPrice: '10',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '10', totalPrice: '10.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText(resourceLocationLabel({
      id: 'resource-fr',
      code: 'FR',
      name: 'France',
      displayName: null,
      countryCode: 'FR',
      providerCode: 'IPIPD',
    }).country)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('新加坡').length).toBeGreaterThan(0);
    expect(paths).toContain('/api/resources/countries?durationDays=30&currency=CNY');
    expect(paths).toContain('/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=FR');
    expect(screen.queryByText('customer.buy.resourceLoadHint')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.buy.snapshotNoticeTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.buy.quoteSourceHint')).not.toBeInTheDocument();
    expect(paths.some((path) => path.includes('page=2'))).toBe(false);
  });

  it('resets stale quote state when the customer moves to another resource page', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path === '/api/resources/countries?durationDays=30&currency=CNY') {
        return Promise.resolve({
          items: [
            { countryCode: 'SG', totalResources: 40, availableStock: 21 },
          ],
        });
      }
      if (path === '/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=SG') {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 40,
          items: [{
            id: 'resource-page-1',
            code: 'SG',
            name: 'Singapore',
            displayName: null,
            countryCode: 'SG',
            providerCode: 'PR',
            protocol: 'BOTH',
            ipType: 'NATIVE',
            stock: 12,
            inventoryIsStale: false,
            unitPrice: '39',
            priceCurrency: 'CNY',
          }],
        });
      }
      if (path === '/api/resources?page=2&pageSize=20&durationDays=30&currency=CNY&countryCode=SG') {
        return Promise.resolve({
          page: 2,
          pageSize: 20,
          total: 40,
          items: [{
            id: 'resource-page-2',
            code: 'SG:page-2',
            name: 'Singapore',
            displayName: null,
            countryCode: 'SG',
            providerCode: 'PR',
            protocol: 'BOTH',
            ipType: 'NATIVE',
            stock: 9,
            inventoryIsStale: false,
            unitPrice: '39',
            priceCurrency: 'CNY',
          }],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '39', totalPrice: '39.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect(await screen.findByText('39.00 元')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());

    fireEvent.click(screen.getByTitle('2'));

    await waitFor(() => expect(paths).toContain('/api/resources?page=2&pageSize=20&durationDays=30&currency=CNY&countryCode=SG'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).toBeDisabled());
  });

  it('creates a static proxy order and refreshes wallet state after purchase', async () => {
    const paths: string[] = [];
    let resolveOrder!: (value: unknown) => void;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, _init) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 694,
          inventoryIsStale: false,
          unitPrice: '35.00',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '35.00', totalPrice: '70.00', currency: 'CNY' });
      }
      if (path === '/api/orders/static-proxy') {
        return new Promise((resolve) => {
          resolveOrder = resolve;
        });
      }
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await clickCountryOption('菲律宾');
    await waitForAutoAssignedResource();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    expect(await screen.findByText('70.00 元')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'customer.buy.confirmBtn' }));

    await waitFor(() => expect(paths).toContain('/api/orders/static-proxy'));
    expect((await screen.findAllByText('customer.buy.orderSubmitting')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('customer.buy.orderSubmittingShort').length).toBeGreaterThan(0);
    resolveOrder({ orderId: 'order-1', status: 'PENDING' });
    await waitFor(() => expect(paths.filter((path) => path === '/api/wallet/user-1').length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('customer.buy.fulfillmentWaiting.title')).toBeInTheDocument();
    expect(screen.getByText('customer.buy.fulfillmentWaiting.stepUpstream')).toBeInTheDocument();
  });

  it('clears stale quotes and blocks purchase while a changed quantity is being requoted', async () => {
    const paths: string[] = [];
    let resolveSecondQuote!: (value: unknown) => void;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 694,
          inventoryIsStale: false,
          unitPrice: '35.00',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '35.00', totalPrice: '35.00', currency: 'CNY' });
      }
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=2&currency=CNY') {
        return new Promise((resolve) => {
          resolveSecondQuote = resolve;
        });
      }
      if (path === '/api/orders/static-proxy' && init?.method === 'POST') {
        return Promise.resolve({ orderId: 'order-1', status: 'PENDING' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await clickCountryOption('菲律宾');
    await waitForAutoAssignedResource();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY'),
    );
    expect((await screen.findAllByText('35.00 元')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).toBeDisabled();
    expect(paths).not.toContain('/api/orders/static-proxy');

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=2&currency=CNY'),
    );
    resolveSecondQuote({ unitPrice: '35.00', totalPrice: '70.00', currency: 'CNY' });
    expect(await screen.findByText('70.00 元')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());
  });

  it('starts requoting immediately after quantity changes without waiting for a debounce timer', async () => {
    const paths: string[] = [];
    let resolveSecondQuote!: (value: unknown) => void;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 694,
          inventoryIsStale: false,
          unitPrice: '35.00',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '35.00', totalPrice: '35.00', currency: 'CNY' });
      }
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=2&currency=CNY') {
        return new Promise((resolve) => {
          resolveSecondQuote = resolve;
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled();

    await act(async () => {
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    });

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=2&currency=CNY'),
    );
    expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).toBeDisabled();

    resolveSecondQuote({ unitPrice: '35.00', totalPrice: '70.00', currency: 'CNY' });
    expect(await screen.findByText('70.00 元')).toBeInTheDocument();
  });

  it('keeps checkout tied to the automatically assigned product instead of manual network switching', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-us-ny-rec',
              code: 'US',
              name: 'United States-New York Recommended',
              displayName: 'United States-New York Recommended',
              countryCode: 'US',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 20,
              inventoryIsStale: false,
              unitPrice: '14',
              priceCurrency: 'CNY',
            },
            {
              id: 'resource-us-ny-normal',
              code: 'US',
              name: 'United States-New York Normal',
              displayName: 'United States-New York Normal',
              countryCode: 'US',
              providerCode: 'PR',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 45,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path === '/api/pricing/quote?resourceId=resource-us-ny-rec&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '14', totalPrice: '14.00', currency: 'CNY' });
      }
      if (path === '/api/pricing/quote?resourceId=resource-us-ny-normal&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '21', totalPrice: '21.00', currency: 'CNY' });
      }
      if (path === '/api/orders/static-proxy' && init?.method === 'POST') {
        return Promise.resolve({ orderId: 'order-1', status: 'PENDING' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitForAutoAssignedResource();
    expect(document.querySelector('.ipx-buy-network-card')).toBeNull();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-ny-rec&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths).not.toContain('/api/pricing/quote?resourceId=resource-us-ny-normal&durationDays=30&quantity=1&currency=CNY');
    expect(await screen.findByText('14.00 元')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'customer.buy.confirmBtn' })).not.toBeDisabled());
  });

  it('shows priced configured resources while hiding unpriced resources', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: null,
          inventoryIsStale: null,
          unitPrice: '35',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-sg',
          code: 'SG',
          name: 'Singapore',
          displayName: null,
          countryCode: 'SG',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 0,
          inventoryIsStale: false,
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '35', totalPrice: '35.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect(screen.queryByText('-- 元')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths.filter((path) => path.includes('resourceId=resource-sg'))).toHaveLength(0);
    expect(await screen.findByText('35.00 元')).toBeInTheDocument();
  });

  it('quotes only the stocked priced SKU when hidden SKUs are returned by the API', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-ph',
          code: 'PH',
          name: 'Philippines',
          displayName: null,
          countryCode: 'PH',
          providerCode: 'NINE_EIGHT_FIVE',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 694,
          inventoryIsStale: false,
          unitPrice: '35',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-sg',
          code: 'SG',
          name: 'Singapore',
          displayName: null,
          countryCode: 'SG',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 0,
          inventoryIsStale: false,
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path === '/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '35', totalPrice: '35.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText('菲律宾')).length).toBeGreaterThan(0);
    expect(screen.queryByText('新加坡')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-ph&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths.filter((path) => path.includes('resourceId=resource-sg'))).toHaveLength(0);
    expect(await screen.findByText('35.00 元')).toBeInTheDocument();
    expect(screen.queryByText('customer.buy.quoteFingerprintValue')).not.toBeInTheDocument();
  });

  it('summarizes large SKU pools by country, SKU, priced lines, and stock status', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `resource-us-ny-${index}`,
          code: 'US',
          name: `United States-New York Line ${index + 1}`,
          displayName: `United States-New York Line ${index + 1}`,
          countryCode: 'US',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: index === 0 ? 0 : 100 + index,
          inventoryIsStale: index === 0,
          unitPrice: String(20 + index),
          priceCurrency: 'CNY',
        })),
        ...Array.from({ length: 16 }, (_, index) => ({
          id: `resource-us-la-${index}`,
          code: 'US',
          name: `United States-Los Angeles Line ${index + 1}`,
          displayName: `United States-Los Angeles Line ${index + 1}`,
          countryCode: 'US',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 50 + index,
          inventoryIsStale: false,
          unitPrice: String(30 + index),
          priceCurrency: 'CNY',
        })),
        {
          id: 'resource-us-unpriced',
          code: 'US',
          name: 'United States-Chicago Missing Price',
          displayName: 'United States-Chicago Missing Price',
          countryCode: 'US',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 88,
          inventoryIsStale: false,
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path.startsWith('/api/pricing/quote')) {
        return Promise.resolve({ unitPrice: '20', totalPrice: '20.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const usLocation = resourceLocationLabel({
      id: 'resource-us-phx',
      code: 'US',
      name: 'USAARIPHX',
      displayName: null,
      countryCode: 'US',
      providerCode: 'PR',
    });

    expect((await screen.findAllByText(usLocation.country)).length).toBeGreaterThan(0);
    expect(screen.getByText('customer.buy.regionTitle')).toBeInTheDocument();
    expect(screen.getByText('customer.buy.lineTitle')).toBeInTheDocument();
    await clickCountryOption(usLocation.country);
    await waitForAutoAssignedResource();
    await waitFor(() => expect(paths.some((path) => path.startsWith('/api/pricing/quote'))).toBe(true));
    expect(screen.getAllByText('customer.buy.checkoutReady').length).toBeGreaterThan(0);
    expect(screen.queryByText('customer.buy.realtimeConfirmHint')).not.toBeInTheDocument();
    expect(paths).toContain('/api/resources?page=1&pageSize=20&durationDays=30&currency=CNY&countryCode=US');
  });

  it('prefers stocked priced regions before zero-stock configured regions', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          items: [
            {
              id: 'resource-at',
              code: 'AT',
              name: 'Austria',
              displayName: null,
              countryCode: 'AT',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 0,
              inventoryIsStale: false,
              unitPrice: '21',
              priceCurrency: 'CNY',
            },
            {
              id: 'resource-fr',
              code: 'FR',
              name: 'France',
              displayName: null,
              countryCode: 'FR',
              providerCode: 'IPIPD',
              protocol: 'BOTH',
              ipType: 'NATIVE',
              stock: 1101,
              inventoryIsStale: false,
              unitPrice: '28',
              priceCurrency: 'CNY',
            },
          ],
        });
      }
      if (path.startsWith('/api/pricing/quote')) {
        const url = new URL(`https://example.test${path}`);
        const resourceId = url.searchParams.get('resourceId');
        return Promise.resolve({
          unitPrice: resourceId === 'resource-at' ? '21' : '28',
          totalPrice: resourceId === 'resource-at' ? '21.00' : '28.00',
          currency: 'CNY',
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    const zeroStockLocation = resourceLocationLabel({
      id: 'resource-at',
      code: 'AT',
      name: 'Austria',
      displayName: null,
      countryCode: 'AT',
      providerCode: 'IPIPD',
    });
    const stockedLocation = resourceLocationLabel({
      id: 'resource-fr',
      code: 'FR',
      name: 'France',
      displayName: null,
      countryCode: 'FR',
      providerCode: 'IPIPD',
    });

    expect((await screen.findAllByText(zeroStockLocation.country)).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-fr&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths).not.toContain('/api/pricing/quote?resourceId=resource-at&durationDays=30&quantity=1&currency=CNY');
    expect(await screen.findByText('28.00 元')).toBeInTheDocument();
    expect(screen.getAllByText(stockedLocation.country).length).toBeGreaterThan(0);
  });

  it('prefers a less-specific stocked resource over a specific zero-stock resource in the same line', async () => {
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      paths.push(path);
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-us-ny-zero',
          code: 'US:NY_ZERO',
          name: 'United States',
          displayName: 'United States-New York',
          countryCode: 'US',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 0,
          inventoryIsStale: false,
          unitPrice: '21',
          priceCurrency: 'CNY',
          costGroupKey: 'cost-same',
        },
        {
          id: 'resource-us-auto-fresh',
          code: 'US',
          name: 'United States',
          displayName: 'United States automatic',
          countryCode: 'US',
          providerCode: 'IPIPD',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          stock: 88,
          inventoryIsStale: false,
          unitPrice: '28',
          priceCurrency: 'CNY',
          costGroupKey: 'cost-same',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      if (path === '/api/pricing/quote?resourceId=resource-us-ny-zero&durationDays=30&quantity=1&currency=CNY') {
        return Promise.reject(new client.ApiError('UPSTREAM_OUT_OF_STOCK', 'out_of_stock'));
      }
      if (path === '/api/pricing/quote?resourceId=resource-us-auto-fresh&durationDays=30&quantity=1&currency=CNY') {
        return Promise.resolve({ unitPrice: '28', totalPrice: '28.00', currency: 'CNY' });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    await waitForAutoAssignedResource();
    await waitFor(() =>
      expect(paths).toContain('/api/pricing/quote?resourceId=resource-us-auto-fresh&durationDays=30&quantity=1&currency=CNY'),
    );
    expect(paths).not.toContain('/api/pricing/quote?resourceId=resource-us-ny-zero&durationDays=30&quantity=1&currency=CNY');
    expect(await screen.findByText('28.00 元')).toBeInTheDocument();
  });

  it('builds lifecycle and export paths through real proxy endpoints', () => {
    expect(buildProxyLifecyclePath('proxy 1', 'switch-ip')).toBe('/api/proxies/proxy%201/switch-ip');
    expect(buildProxyBatchLifecyclePath('batch-switch-ip')).toBe('/api/proxies/batch-switch-ip');
    expect(buildProxyExportPath('HTTP_URL')).toBe('/api/proxies/export?format=HTTP_URL');
  });

  it('opens proxy detail from the row action without calling lifecycle endpoints', async () => {
    const proxy = customerProxy();
    const spy = vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxy] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    expect(screen.queryByTestId('proxy-detail-modal')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'customer.proxies.detail' }));

    expect(await screen.findByText('customer.proxies.detailTitle')).toBeInTheDocument();
    expect(await screen.findByTestId('proxy-detail-modal')).toBeInTheDocument();
    expect(screen.getAllByText('customer.proxies.connectionInfo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('customer.proxies.connectionInfoDesc').length).toBeGreaterThan(0);
    expect(screen.getAllByText('203.0.113.10:8000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pass').length).toBeGreaterThan(0);
    expect(screen.getAllByText('http://user:pass@203.0.113.10:8000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('socks5://user:pass@203.0.113.10:8000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('customer.proxies.resourceInfo').length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatCustomerChannelLabel('PR')).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatProviderLabel('PR'))).not.toBeInTheDocument();
    expect(screen.queryAllByText('SOCKS5 / HTTP').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('原生 IP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('order-1').length).toBeGreaterThan(0);
    expect(screen.getByText('客户备注')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(proxy.createdAt))).toBeInTheDocument();
    expect(spy.mock.calls.some(([path, init]) => path.toString().includes('/switch-ip') || init?.method === 'POST')).toBe(false);
  });

  it('renders only the proxy list workspace before a row detail is opened', async () => {
    const activeProxy = customerProxy();
    const expiringProxy = customerProxy({
      id: 'proxy-2',
      ip: '203.0.113.11',
      countryCode: 'SG',
      status: 'EXPIRED',
      expiresAt: '2026-01-10T00:00:00.000Z',
    });
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 7, items: [activeProxy, expiringProxy] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    await screen.findAllByText('203.0.113.10:8000');
    expect(screen.queryByTestId('proxy-detail-modal')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.connectionInfo')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.description')).not.toBeInTheDocument();
    expect(screen.getByText('customer.proxies.currentPage')).toBeInTheDocument();
    expect(screen.getByText('customer.proxies.toolbarFilter')).toBeInTheDocument();
    expect(screen.getByText('customer.proxies.toolbarExport')).toBeInTheDocument();
    expect(screen.getByText('customer.proxies.toolbarSelection')).toBeInTheDocument();
    expect(screen.getAllByText('customer.proxies.credentialSummary').length).toBeGreaterThan(0);
    expect(screen.getByText('customer.proxies.sourceOrder')).toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.metricTotal')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.deliveryReadyCount')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.deliveryPendingCount')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.deliveryAttentionCount')).not.toBeInTheDocument();
    expect(screen.getByText('customer.proxies.allStatus (7)')).toBeInTheDocument();
    expect(screen.getByText('customer.proxies.normal (1)')).toBeInTheDocument();
    expect(screen.getByText('customer.proxies.expired (1)')).toBeInTheDocument();
  });

  it('keeps unsupported password and switch-ip actions hidden from customer rows', async () => {
    const proxy = customerProxy();
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxy] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    await screen.findAllByText('203.0.113.10:8000');
    expect(screen.queryByRole('button', { name: 'customer.proxies.changePassword' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'customer.proxies.switchIp' })).not.toBeInTheDocument();
  });

  it('keeps batch lifecycle actions disabled until proxies are selected', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [customerProxy()],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    const batchRenew = await screen.findByRole('button', { name: 'customer.proxies.batchRenew' });
    expect(batchRenew).toBeDisabled();

    fireEvent.click(screen.getAllByRole('checkbox')[1]!);

    expect(batchRenew).not.toBeDisabled();
    expect(screen.getByText('customer.proxies.selectedCount')).toBeInTheDocument();
  });

  it('surfaces proxy list backend failures instead of showing an empty table as success', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'proxy_query_failed'));
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    expect((await screen.findAllByText('代理列表读取失败')).length).toBeGreaterThan(0);
    expect(screen.queryByText('proxy_query_failed')).not.toBeInTheDocument();
    expect(screen.queryByText('customer.proxies.emptyTitle')).not.toBeInTheDocument();
  });

  it('uses the filtered proxy empty state when filters return no rows', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    fireEvent.change(await screen.findByPlaceholderText('customer.proxies.searchPlaceholder'), {
      target: { value: '203.0.113.200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));

    expect(await screen.findByText('customer.proxies.emptyFilteredDesc')).toBeInTheDocument();
  });

  it('calls the batch renew endpoint with selected proxy ids and shows mixed results', async () => {
    const proxyOne = customerProxy();
    const proxyTwo = customerProxy({
      id: 'proxy-2',
      ip: '203.0.113.11',
      username: 'user-2',
    });
    let batchBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 2, items: [proxyOne, proxyTwo] });
      }
      if (path === '/api/proxies/batch-renew' && init?.method === 'POST') {
        batchBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({
          totalCount: 2,
          successCount: 1,
          failureCount: 1,
          items: [
            { proxyId: 'proxy-1', success: true, proxy: { ...proxyOne, expiresAt: '2026-08-10T00:00:00.000Z' } },
            {
              proxyId: 'proxy-2',
              success: false,
              error: { code: 'UNSUPPORTED_CAPABILITY', reasonKey: 'renew_not_supported', httpStatus: 501 },
            },
          ],
        });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    await screen.findAllByText('203.0.113.10:8000');
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getAllByRole('checkbox')[2]!);
    fireEvent.click(screen.getByRole('button', { name: 'customer.proxies.batchRenew' }));

    await waitFor(() => expect(batchBody).toMatchObject({
      proxyIds: ['proxy-1', 'proxy-2'],
      durationDays: 30,
    }));
    expect(typeof batchBody?.idempotencyKey).toBe('string');
    expect(await screen.findByText('customer.proxies.batchResult.title')).toBeInTheDocument();
    expect(screen.getByText('该代理暂不支持续费')).toBeInTheDocument();
    expect(screen.queryByText('renew_not_supported')).not.toBeInTheDocument();
    expect(screen.queryByText('UNSUPPORTED_CAPABILITY / HTTP 501')).not.toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: 'customer.proxies.copyFormats' });
    fireEvent.click(copyButtons[copyButtons.length - 1]!);

    expect(await screen.findByText('customer.proxies.copyModal.title')).toBeInTheDocument();
  });

  it('shows all real proxy copy formats from the copy modal', async () => {
    const proxy = customerProxy();
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxy] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'customer.proxies.detail' }));
    const detailModal = await screen.findByTestId('proxy-detail-modal');
    fireEvent.click(within(detailModal).getByRole('button', { name: 'customer.proxies.copyFormats' }));

    expect(await screen.findByText('customer.proxies.copyModal.title')).toBeInTheDocument();
    const modal = screen.getByRole('dialog', { name: 'customer.proxies.copyModal.title' });
    expect(within(modal).getByText('customer.proxies.copyAllFormats')).toBeInTheDocument();
    expect(within(modal).getByText('customer.proxies.copyModal.endpoint')).toBeInTheDocument();
    expect(within(modal).getByText('203.0.113.10:8000')).toBeInTheDocument();
    expect(within(modal).getByText('203.0.113.10:8000:user:pass')).toBeInTheDocument();
    expect(within(modal).getByText('user:pass@203.0.113.10:8000')).toBeInTheDocument();
    expect(within(modal).getByText('http://user:pass@203.0.113.10:8000')).toBeInTheDocument();
    expect(within(modal).getByText('socks5://user:pass@203.0.113.10:8000')).toBeInTheDocument();
  });

  it('hides inactive or unsaleable products from the purchase page even when priced', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') {
        return Promise.resolve({
          ownerId: 'user-1',
          ownerType: 'USER',
          siteId: 'site-1',
          tenantId: 'tenant-1',
          scopes: [],
        });
      }
      if (path === '/api/wallet/user-1') {
        return Promise.resolve({ available: '100.00', currency: 'CNY' });
      }
      const resourceResponse = resolveBuyResourceRequest(path, [
        {
          id: 'resource-visible',
          code: 'SG:visible',
          name: 'Singapore',
          displayName: 'Singapore-Visible',
          countryCode: 'SG',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          status: 'ACTIVE',
          isVisible: true,
          isSaleable: true,
          stock: 12,
          inventoryIsStale: false,
          unitPrice: '28',
          priceCurrency: 'CNY',
        },
        {
          id: 'resource-hidden',
          code: 'HK:hidden',
          name: 'Hong Kong',
          displayName: 'Hong Kong Hidden',
          countryCode: 'HK',
          providerCode: 'PR',
          protocol: 'BOTH',
          ipType: 'NATIVE',
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          stock: 12,
          inventoryIsStale: false,
          unitPrice: '28',
          priceCurrency: 'CNY',
        },
      ]);
      if (resourceResponse) return Promise.resolve(resourceResponse);
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<BuyStaticProxyFeature />);

    expect((await screen.findAllByText('新加坡')).length).toBeGreaterThan(0);
    expect(screen.queryByText('中国香港')).not.toBeInTheDocument();
    expect(screen.queryByText('Hong Kong Hidden')).not.toBeInTheDocument();
  });

  it('does not expose batch password or switch IP endpoints in the customer list', async () => {
    const proxy = customerProxy();
    const paths: string[] = [];
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      const shell = resolveCustomerShellRequest(path);
      if (shell) return shell;
      paths.push(path);
      if (path.startsWith('/api/proxies?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxy] });
      }
      return Promise.reject(new client.ApiError('INTERNAL_ERROR', 'unexpected_request'));
    });

    renderWithQuery(<CustomerProxyListFeature />);

    await screen.findAllByText('203.0.113.10:8000');
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(screen.queryByRole('button', { name: 'customer.proxies.batchChangePassword' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'customer.proxies.batchSwitchIp' })).not.toBeInTheDocument();
    expect(paths).not.toContain('/api/proxies/batch-change-password');
    expect(paths).not.toContain('/api/proxies/batch-switch-ip');
  });
});

function customerProxy(overrides: Partial<ReturnType<typeof customerProxyBase>> = {}) {
  return {
    ...customerProxyBase(),
    ...overrides,
  };
}
function customerProxyBase() {
  return {
    id: 'proxy-1',
    ip: '203.0.113.10',
    port: 8000,
    username: 'user',
    password: 'pass',
    orderId: 'order-1',
    providerCode: 'PR',
    protocol: 'BOTH',
    countryCode: 'HK',
    regionCode: 'HK-Hong Kong-Recommended',
    ipType: 'NATIVE',
    status: 'ACTIVE',
    expiresAt: '2026-07-10T00:00:00.000Z',
    businessType: 'residential',
    userNote: '客户备注',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  };
}
