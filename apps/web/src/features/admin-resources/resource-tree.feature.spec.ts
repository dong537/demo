import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildBulkPriceOverrideBodies,
  buildResourceSaleabilityPayload,
  buildResourcePayload,
  formatUnsaleableReason,
  groupResourcesForAdminResourceList,
  groupResourcesForBulkPricing,
  ResourceTreeFeature,
} from './resource-tree.feature';
import * as client from '../../shared/api/client';
import { formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
const mockTranslations: Record<string, string> = {
  'resources.modifyPrice': 'modify-price',
  'resources.saleSettings': '设置售卖',
  'resources.saveSaleSettings': '保存售卖设置',
  'resources.saleSettingsSourceTitle': '同步资源信息',
  'resources.resourceTrace': '资源编号',
  'resources.resourceCost': 'cost',
  'resources.resourceCostMixed': 'mixed cost',
  'resources.resourceCostRange': '{{min}} - {{max}}',
  'resources.resourceCostPartialKnown': 'partial {{cost}}',
  'resources.resourceCostListMore': '{{costs}} and {{count}} costs',
  'resources.resourceCostMissing': '未提供',
  'resources.resourcePrice': '价格',
  'resources.resourcePriceRange': '{{min}} - {{max}}',
  'resources.resourceGroupCountLabel': '{{label}} {{count}}/{{total}}',
  'resources.resourceGroupNone': '无{{label}}',
  'resources.resourceGroupMixedIpType': '多种类型',
  'resources.resourceGroupMixedProtocol': '多种协议',
  'resources.isSaleable': '是否可售',
  'resources.saleable': '可售',
  'resources.unsaleable': '不可售',
  'resources.visible': '可见',
  'resources.hidden': '隐藏',
  'resources.unsaleableReason': '不可售原因',
  'resources.unsaleableReasonRequired': '请选择不可售原因',
  'resources.salesSection': '销售设置',
  'resources.quickPriceLoading': '正在加载可定价资源',
  'resources.quickPriceLoadFailed': '可定价资源加载失败',
  'resources.quickPriceSelectedTitle': '已选择 / 已定价商品',
  'resources.quickPriceAvailableTitle': '平台可用资源',
  'resources.quickPriceProviderAvailableTitle': '{{provider}} - 可用资源',
  'resources.quickPriceProductTitle': '选择商品',
  'resources.quickPriceProductTitleIdle': '选择商品',
  'resources.quickPriceSelectedEmpty': '先从下方选择一个地区商品',
  'resources.quickPriceCountryOption': '{{regions}} 个地区 · {{resources}} 个商品',
  'resources.quickPriceRegionOption': '{{resources}} 个商品 · 成本 {{cost}}',
  'resources.quickPriceSelectedOption': '{{resources}} 个商品 · 成本 {{cost}} · 售价 {{price}}',
  'resources.quickPriceUnlist': '下架',
  'resources.quickAutoSelectTitle': '系统自动选择',
  'resources.quickDefaultAutoSelectTitle': '默认自动选择',
  'resources.bulkRegionEmpty': '请先选择国家',
  'resources.providerFilter': '按平台筛选',
  'resources.allProviders': '全部平台',
  'resources.detailResourcesTitle': '底层资源',
  'resources.showDetailResources': '查看底层资源',
  'resources.hideDetailResources': '收起底层资源',
  'resources.bulkResourceCount': '{{count}} 个资源',
  'resources.bulkRegionUnlistSuccess': '商品已下架',
  'resources.summary.groupedCurrentPage': '本页 {{groups}} 类 / {{resources}} 个资源',
  'resources.unsaleableReasons.provider_sale_disabled': '已手动关闭售卖',
  'resources.unsaleableReasons.price_missing': '缺少上游成本或售价配置',
  'resources.unsaleableReasons.provider_country_not_supported': '当前上游没有这个旧商品，请选择同步出来的具体地区资源',
  'resources.unsaleableReasons.inventory_empty': '上游没有返回可用库存',
  'resources.reason.generic': '操作没有完成，请检查商品配置后重试',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      let text = mockTranslations[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, ui));
}

async function openResourceDetails() {
  fireEvent.click(await screen.findByRole('button', { name: '查看底层资源' }));
}

type TextQueryScope = Pick<typeof screen, 'findAllByText'>;

async function clickQuickPriceOption(
  scope: TextQueryScope,
  label: Parameters<typeof screen.findAllByText>[0],
) {
  const matches = await scope.findAllByText(label);
  const button = matches
    .map((element) => element.closest('button.ipx-buy-option-card') as HTMLButtonElement | null)
    .find((element): element is HTMLButtonElement => Boolean(element));
  expect(button).toBeTruthy();
  fireEvent.click(button!);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

function resourceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resource-fixture',
    parentId: null,
    type: 'COUNTRY',
    code: 'SG',
    name: 'Singapore',
    displayName: 'Singapore',
    providerCode: 'PR',
    ipType: 'NATIVE',
    protocol: 'SOCKS5',
    status: 'ACTIVE',
    sortOrder: 1,
    isVisible: true,
    isSaleable: true,
    unsaleableReason: null,
    stock: 8,
    ...overrides,
  };
}

type ResourceFixture = ReturnType<typeof resourceFixture> & {
  countryCode?: string;
  upstreamResourceId?: string;
  unitPrice?: string;
  priceCurrency?: string;
  upstreamCost?: string;
  upstreamCostCurrency?: string;
};

function quickPriceSummary(resources: ResourceFixture[], overrides: Partial<{
  page: number;
  pageSize: number;
}> = {}) {
  const countries = new Map<string, ResourceFixture[]>();
  for (const resource of resources) {
    const countryCode = String(resource.countryCode ?? resource.code).slice(0, 2).toUpperCase();
    countries.set(countryCode, [...(countries.get(countryCode) ?? []), resource]);
  }
  return {
    page: overrides.page ?? 1,
    pageSize: overrides.pageSize ?? 20,
    total: countries.size,
    totalResources: resources.length,
    items: [...countries.entries()].map(([countryCode, countryResources]) => ({
      countryCode,
      totalResources: countryResources.length,
      regionCount: 1,
      pricedCount: countryResources.filter((resource) => resource.unitPrice).length,
      costGroupCount: new Set(countryResources.map((resource) => `${resource.upstreamCostCurrency ?? 'CNY'}:${resource.upstreamCost ?? 'missing'}`)).size,
    })),
  };
}

function quickPriceGroup(
  resource: ResourceFixture,
  overrides: Partial<{
    key: string;
    countryCode: string;
    regionKey: string;
    costGroupKey: string;
    resourceCount: number;
    pricedCount: number;
    unitPrice: string | null;
    priceCurrency: string | null;
    upstreamCost: string | null;
    upstreamCostCurrency: string | null;
    autoSelect: boolean;
  }> = {},
) {
  const countryCode = overrides.countryCode ?? String(resource.countryCode ?? resource.code).slice(0, 2).toUpperCase();
  const regionKey = overrides.regionKey ?? String(resource.code);
  const costGroupKey = overrides.costGroupKey ?? `cost-${String(resource.upstreamCost ?? 'missing')}`;
  return {
    key: overrides.key ?? `${countryCode}:${regionKey}:${costGroupKey}`,
    countryCode,
    regionKey,
    costGroupKey,
    resourceCount: overrides.resourceCount ?? 1,
    pricedCount: overrides.pricedCount ?? (resource.unitPrice ? 1 : 0),
    unitPrice: overrides.unitPrice ?? (resource.unitPrice as string | undefined) ?? null,
    priceCurrency: overrides.priceCurrency ?? (resource.priceCurrency as string | undefined) ?? null,
    upstreamCost: overrides.upstreamCost ?? (resource.upstreamCost as string | undefined) ?? null,
    upstreamCostCurrency: overrides.upstreamCostCurrency ?? (resource.upstreamCostCurrency as string | undefined) ?? null,
    autoSelect: overrides.autoSelect ?? false,
    sampleResource: resource,
  };
}

function quickPriceGroups(countryCode: string, groups: ReturnType<typeof quickPriceGroup>[]) {
  return {
    countryCode,
    page: 1,
    pageSize: 20,
    total: groups.length,
    totalResources: groups.reduce((sum, group) => sum + group.resourceCount, 0),
    items: groups,
  };
}

describe('resource tree contracts', () => {
  it('loads active detail resources only after the compact resource list is opened', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.some(([path]) => String(path).startsWith('/api/resources?'))).toBe(false);

    await openResourceDetails();

    await vi.waitFor(() => expect(
      spy.mock.calls.some(([path]) => {
        const pathText = String(path);
        return pathText.startsWith('/api/resources?')
          && pathText.includes('pageSize=20')
          && pathText.includes('status=ACTIVE');
      }),
    ).toBe(true));
  });

  it('applies the provider filter to quick pricing and detail resource queries', async () => {
    const prResource = resourceFixture({ id: 'pr-sg', providerCode: 'PR', countryCode: 'SG', code: 'SG' });
    const ipipdResource = resourceFixture({ id: 'ipipd-jp', providerCode: 'IPIPD', countryCode: 'JP', code: 'JP' });
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const pathText = String(path);
      if (pathText.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        const url = new URL(pathText, 'https://local.test');
        return Promise.resolve(quickPriceSummary(url.searchParams.get('providerCode') === 'PR' ? [prResource] : [ipipdResource]));
      }
      if (pathText.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('SG', [quickPriceGroup(prResource)]));
      }
      if (pathText.startsWith('/api/resources?') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [prResource],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await screen.findAllByText('全部平台');

    const selector = screen.getAllByText('全部平台')[0].closest('.ant-select-selector') as HTMLElement;
    fireEvent.mouseDown(selector);
    fireEvent.click(await screen.findByText(formatProviderLabel('PR')));

    await vi.waitFor(() => expect(
      spy.mock.calls.some(([path]) => String(path).startsWith('/api/resources/priceable-catalog/summary') && String(path).includes('providerCode=PR')),
    ).toBe(true));
    await clickQuickPriceOption(screen, '新加坡');
    await vi.waitFor(() => expect(
      spy.mock.calls.some(([path]) => String(path).startsWith('/api/resources/priceable-catalog/groups') && String(path).includes('providerCode=PR')),
    ).toBe(true));

    await openResourceDetails();

    await vi.waitFor(() => expect(
      spy.mock.calls.some(([path]) => String(path).startsWith('/api/resources?') && String(path).includes('providerCode=PR')),
    ).toBe(true));
  });

  it('keeps the admin quick pricing selector aligned with the customer purchase layout', async () => {
    const austria = resourceFixture({
      id: 'pr-at',
      providerCode: 'PR',
      countryCode: 'AT',
      code: 'AT',
      upstreamCost: '12.00',
      upstreamCostCurrency: 'CNY',
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const pathText = String(path);
      if (pathText.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary([austria]));
      }
      if (pathText.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('AT', [quickPriceGroup(austria, { regionKey: 'vienna' })]));
      }
      return Promise.resolve({});
    });

    const { container } = renderWithQuery(React.createElement(ResourceTreeFeature));

    await vi.waitFor(() => expect(container.querySelector('.ipx-buy-region-grid')).toBeTruthy());
    const countryGrid = container.querySelector('.ipx-buy-region-grid') as HTMLElement;
    expect(countryGrid.closest('.ipx-purchase-main-col')).toBeTruthy();
    expect(countryGrid.style.gridTemplateColumns).toBe('');
    expect(container.querySelector('.ipx-buy-line-grid')).toBeNull();

    await clickQuickPriceOption(screen, '奥地利');
    await vi.waitFor(() => expect(container.querySelector('.ipx-buy-line-grid')).toBeTruthy());
    const lineGrid = container.querySelector('.ipx-buy-line-grid') as HTMLElement;
    expect(lineGrid.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(220px, 1fr))');
    expect(container.querySelector('.ipx-order-panel-col .ipx-order-panel')).toBeTruthy();

    const optionTitle = container.querySelector('.ipx-buy-option-card .ant-typography') as HTMLElement;
    expect(optionTitle.style.whiteSpace).toBe('nowrap');
    expect(optionTitle.style.wordBreak).toBe('keep-all');

    const optionSubtitle = container.querySelector('.ipx-buy-option-card .ant-typography-secondary') as HTMLElement;
    expect(optionSubtitle.style.wordBreak).toBe('keep-all');
  });

  it('does not expose manual product creation from the resource list toolbar', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));

    await screen.findByText('resources.bulkPriceTitle');
    expect(screen.queryByRole('button', { name: 'resources.createResource' })).not.toBeInTheDocument();
  });

  it('builds resource payload with backend field names and normalized values', () => {
    expect(buildResourcePayload({
      type: 'COUNTRY',
      code: ' US ',
      name: ' United States ',
      displayName: ' USA ',
      providerCode: 'UPSTREAM_API',
    })).toEqual({
      type: 'COUNTRY',
      code: 'US',
      name: 'United States',
      displayName: 'USA',
    });
  });

  it('translates known unsaleable reasons and hides unknown internal diagnostics', () => {
    const t = (key: string) => mockTranslations[key] ?? key;

    expect(formatUnsaleableReason('provider_country_not_supported', t)).toBe('当前上游没有这个旧商品，请选择同步出来的具体地区资源');
    expect(formatUnsaleableReason('unexpected_reason', t)).toBe('操作没有完成，请检查商品配置后重试');
  });

  it('adds fixed backend defaults only when creating resources', () => {
    expect(buildResourcePayload({
      type: 'COUNTRY',
      code: 'SG',
      name: 'Singapore',
      displayName: null,
      providerCode: 'PR',
    }, 'create')).toEqual({
      type: 'COUNTRY',
      code: 'SG',
      name: 'Singapore',
      displayName: null,
      providerCode: 'PR',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      status: 'ACTIVE',
      sortOrder: 0,
      isVisible: true,
      isSaleable: true,
    });
  });

  it('groups resources by country and region for bulk pricing', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'us-ny-rec-cidr-a',
        parentId: null,
        type: 'COUNTRY',
        code: 'US:line-ny-rec|cidr=192.168.104.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.104.0%2F24',
        name: 'United States-New York Recommended-192.168.104.0/24',
        displayName: 'United States-New York Recommended-192.168.104.0/24',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 10,
      },
      {
        id: 'us-ny-rec-cidr-b',
        parentId: null,
        type: 'COUNTRY',
        code: 'US:line-ny-rec|cidr=192.168.105.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.105.0%2F24',
        name: 'United States-New York Recommended-192.168.105.0/24',
        displayName: 'United States-New York Recommended-192.168.105.0/24',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 2,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 8,
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].regions).toHaveLength(1);
    expect(groups[0].regions[0].resources.map((resource) => resource.id)).toEqual(['us-ny-rec-cidr-a', 'us-ny-rec-cidr-b']);
    expect(groups[0].regions[0].label).toContain('纽约');
  });

  it('groups Proxy-Seller resources under a localized country and region for bulk pricing', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'at-tyrol-innsbruck',
        parentId: null,
        type: 'COUNTRY',
        code: 'AT:6928:Tyrol:Innsbruck:Telekom Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Tyrol:Innsbruck:Telekom Austria',
        name: 'Austria-Tyrol-Innsbruck-Telekom Austria',
        displayName: 'Austria-Tyrol-Innsbruck-Telekom Austria',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 3,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ countryCode: 'AT', label: '奥地利' });
    expect(groups[0].regions[0]).toMatchObject({ label: '蒂罗尔-因斯布鲁克' });
    expect(groups[0].regions[0].resources.map((resource) => resource.id)).toEqual(['at-tyrol-innsbruck']);
  });

  it('splits same-region Proxy-Seller resources into cost-based groups without exposing line labels', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'at-lower-austria-a',
        parentId: null,
        type: 'COUNTRY',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 3,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      },
      {
        id: 'at-lower-austria-b',
        parentId: null,
        type: 'COUNTRY',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 2,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 5,
        upstreamCost: '2.10',
        upstreamCostCurrency: 'USD',
      },
    ]);

    expect(groups[0]).toMatchObject({ countryCode: 'AT', label: '奥地利' });
    expect(groups[0].regions).toHaveLength(2);
    expect(groups[0].regions.map((region) => region.label)).toEqual([
      '下奥地利',
      '下奥地利',
    ]);
    expect(groups[0].regions[0].resources.map((resource) => resource.id)).toEqual(['at-lower-austria-a']);
    expect(groups[0].regions[1].resources.map((resource) => resource.id)).toEqual(['at-lower-austria-b']);
    expect(groups[0].regions[0].label).not.toMatch(/Lower Austria/i);
    expect(groups[0].regions[0].label).not.toMatch(/线路/);
  });

  it('groups admin resource list rows by provider, country, and cost', () => {
    const sameCostA = resourceFixture({
      id: 'at-lower-austria-a',
      code: 'AT:6928:Lower Austria',
      countryCode: 'AT',
      upstreamResourceId: 'AT:6928:Lower Austria',
      name: 'Austria-Lower Austria',
      displayName: 'Austria-Lower Austria',
      providerCode: 'PR',
      upstreamCost: '1.99',
      upstreamCostCurrency: 'USD',
    });
    const sameCostB = resourceFixture({
      id: 'at-telekom-austria',
      code: 'AT:6928:Telekom Austria',
      countryCode: 'AT',
      upstreamResourceId: 'AT:6928:Telekom Austria',
      name: 'Austria-Telekom Austria',
      displayName: 'Austria-Telekom Austria',
      providerCode: 'PR',
      sortOrder: 2,
      upstreamCost: '1.99',
      upstreamCostCurrency: 'USD',
    });
    const differentCost = resourceFixture({
      id: 'at-lower-austria-c',
      code: 'AT:6928:Lower Austria',
      countryCode: 'AT',
      upstreamResourceId: 'AT:6928:Lower Austria',
      name: 'Austria-Lower Austria',
      displayName: 'Austria-Lower Austria',
      providerCode: 'PR',
      sortOrder: 3,
      upstreamCost: '2.10',
      upstreamCostCurrency: 'USD',
    });

    const rows = groupResourcesForAdminResourceList([sameCostA, sameCostB, differentCost]);

    expect(rows).toHaveLength(2);
    expect(rows[0].resources.map((resource) => resource.id)).toEqual([
      'at-lower-austria-a',
      'at-telekom-austria',
    ]);
    expect(rows[0].regionLabel).toBe('下奥地利');
    expect(rows[1].resources.map((resource) => resource.id)).toEqual(['at-lower-austria-c']);
  });

  it('keeps English same-region pricing groups at the region label in English mode', () => {
    const groups = groupResourcesForBulkPricing([
      resourceFixture({
        id: 'at-lower-austria-a',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      }),
      resourceFixture({
        id: 'at-lower-austria-b',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '2.10',
        upstreamCostCurrency: 'USD',
      }),
    ], 'en-US');

    expect(groups[0]).toMatchObject({ countryCode: 'AT', label: 'Austria' });
    expect(groups[0].regions.map((region) => region.label)).toEqual([
      'Lower Austria',
      'Lower Austria',
    ]);
    expect(groups[0].regions[0].label).not.toMatch(/Line/);
  });

  it('uses English automatic pricing labels in English mode', () => {
    const groups = groupResourcesForBulkPricing([
      resourceFixture({
        id: 'at-lower-austria',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      }),
      resourceFixture({
        id: 'at-vienna',
        code: 'AT:6928:Vienna:Telekom Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Vienna:Telekom Austria',
        name: 'Austria-Vienna-Telekom Austria',
        displayName: 'Austria-Vienna-Telekom Austria',
        providerCode: 'PR',
        upstreamCost: '1.990',
        upstreamCostCurrency: 'USD',
      }),
    ], 'en');

    expect(groups[0]).toMatchObject({ countryCode: 'AT', label: 'Austria' });
    expect(groups[0].regions).toHaveLength(1);
    expect(groups[0].regions[0]).toMatchObject({
      label: 'Default automatic selection',
      autoSelect: true,
    });
  });

  it('collapses same-cost country regions into the default automatic pricing group', () => {
    const groups = groupResourcesForBulkPricing([
      resourceFixture({
        id: 'at-lower-austria',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      }),
      resourceFixture({
        id: 'at-vienna',
        code: 'AT:6928:Vienna:Telekom Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Vienna:Telekom Austria',
        name: 'Austria-Vienna-Telekom Austria',
        displayName: 'Austria-Vienna-Telekom Austria',
        providerCode: 'PR',
        upstreamCost: '1.990',
        upstreamCostCurrency: 'USD',
      }),
      resourceFixture({
        id: 'at-tyrol',
        code: 'AT:6928:Tyrol:Innsbruck',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Tyrol:Innsbruck',
        name: 'Austria-Tyrol-Innsbruck',
        displayName: 'Austria-Tyrol-Innsbruck',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ countryCode: 'AT', label: '奥地利' });
    expect(groups[0].regions).toHaveLength(1);
    expect(groups[0].regions[0]).toMatchObject({ label: '默认自动选择', autoSelect: true });
    expect(groups[0].regions[0].resources.map((resource) => resource.id)).toEqual([
      'at-lower-austria',
      'at-vienna',
      'at-tyrol',
    ]);
  });

  it('keeps country regions split when upstream costs differ', () => {
    const groups = groupResourcesForBulkPricing([
      resourceFixture({
        id: 'at-lower-austria',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      }),
      resourceFixture({
        id: 'at-vienna',
        code: 'AT:6928:Vienna',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Vienna',
        name: 'Austria-Vienna',
        displayName: 'Austria-Vienna',
        providerCode: 'PR',
        upstreamCost: '2.10',
        upstreamCostCurrency: 'USD',
      }),
    ]);

    expect(groups[0].regions).toHaveLength(2);
    expect(groups[0].regions.map((region) => region.label)).toEqual(expect.arrayContaining(['维也纳', '下奥地利']));
  });

  it('keeps mapped country-level upstream products available for bulk pricing', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'hk-985-country-sku',
        parentId: null,
        type: 'COUNTRY',
        code: 'HK',
        countryCode: 'HK',
        upstreamResourceId: '985-hk-country',
        name: 'Hong Kong',
        displayName: 'Hong Kong',
        providerCode: 'NINE_EIGHT_FIVE',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 8,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ countryCode: 'HK', label: '中国香港' });
    expect(groups[0].regions[0]).toMatchObject({ label: '香港' });
    expect(groups[0].regions[0].resources.map((resource) => resource.id)).toEqual(['hk-985-country-sku']);
  });

  it('keeps raw provider resource numbers out of the region and line grouping labels', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'at-tyrol-provider-resource',
        parentId: null,
        type: 'COUNTRY',
        code: 'AT:6928:Tyrol:126410',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Tyrol:126410',
        name: 'Austria-Tyrol-126410',
        displayName: 'Austria-Tyrol-126410',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 1,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      },
    ]);

    const region = groups[0].regions[0];
    expect(region.label).toBe('蒂罗尔');
    expect(region.label).not.toContain('资源');
    expect(region.resources.map((resource) => resource.code)).toEqual(['AT:6928:Tyrol:126410']);
  });

  it('does not leak raw Netherlands upstream paths in bulk pricing groups', () => {
    const groups = groupResourcesForBulkPricing([
      {
        id: 'nl-north-holland-odido',
        parentId: null,
        type: 'COUNTRY',
        code: 'NL:6928:North Holland:Wieringerwerf:Odido Netherlands',
        countryCode: 'NL',
        upstreamResourceId: 'NL:6928:North Holland:Wieringerwerf:Odido Netherlands',
        name: 'Netherlands-North Holland-Wieringerwerf-Odido Netherlands',
        displayName: 'Netherlands-North Holland-Wieringerwerf-Odido Netherlands',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 1,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
        stock: 3,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
      },
    ]);

    expect(groups[0]).toMatchObject({ countryCode: 'NL', label: '荷兰' });
    expect(groups[0].regions[0]).toMatchObject({ label: '北荷兰-维灵厄韦夫' });
    const visibleLabels = [
      groups[0].label,
      groups[0].regions[0].label,
    ].join(' ');
    expect(visibleLabels).not.toMatch(/North Holland|Wieringerwerf|Odido Netherlands/);
  });

  it('builds one price override body per selected bulk resource', () => {
    expect(buildBulkPriceOverrideBodies(['resource-a', 'resource-b'], 30, 48.5, 'CNY')).toEqual([
      { resourceId: 'resource-a', durationDays: 30, unitPrice: '48.5', currency: 'CNY' },
      { resourceId: 'resource-b', durationDays: 30, unitPrice: '48.5', currency: 'CNY' },
    ]);
  });

  it('renders Chinese region names with Chinese provider labels', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'TW',
            name: '',
            displayName: '',
            providerCode: 'NINE_EIGHT_FIVE',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 10,
          }],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();

    expect(await screen.findByText(formatProviderLabel('NINE_EIGHT_FIVE'))).toBeInTheDocument();
    expect(screen.getByText('1 个资源')).toBeInTheDocument();
    expect(screen.getAllByText(formatRegionNameZh({ code: 'TW', countryCode: 'TW' })).length).toBeGreaterThan(0);
    expect(screen.queryByText('Taiwan')).not.toBeInTheDocument();
  });

  it('keeps the compact product card traceable without noisy raw labels', async () => {
    const resource = resourceFixture({
      id: 'pr-resource-0',
      code: 'US:1498453449724006400',
      countryCode: 'US',
      name: 'US-USAVIRASH',
      displayName: 'US-USAVIRASH',
      providerCode: 'PR',
      isVisible: false,
      isSaleable: false,
      unsaleableReason: 'price_missing',
      stock: 0,
      inventoryCapturedAt: '2026-06-13T00:00:00.000Z',
      inventoryIsStale: true,
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary')) {
        return Promise.resolve(quickPriceSummary([resource]));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups')) {
        return Promise.resolve(quickPriceGroups('US', [quickPriceGroup(resource)]));
      }
      if (path.startsWith('/api/resources?')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [resource],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();

    const location = formatResourceLocationZh({
      id: 'pr-resource-0',
      code: 'US:1498453449724006400',
      countryCode: 'US',
      providerCode: 'PR',
      name: 'US-USAVIRASH',
      displayName: 'US-USAVIRASH',
    });
    expect(await screen.findByText('1 个资源')).toBeInTheDocument();
    expect(screen.getAllByText(location.country).length).toBeGreaterThan(0);
    expect(screen.getAllByText(location.city ?? location.detail ?? location.title).length).toBeGreaterThan(0);
    expect(screen.getByText(formatProviderLabel('PR'))).toBeInTheDocument();
    expect(screen.queryByText('美国 / 1498453449724006400')).not.toBeInTheDocument();
    expect(screen.queryByText('Ashburn')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.cityMissing')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.lineMissing')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.stock')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.inventory.stale')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.inventory.fresh')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.inventory.missing')).not.toBeInTheDocument();
    expect(screen.getByText('隐藏')).toBeInTheDocument();
    expect(screen.getByText('不可售')).toBeInTheDocument();
    expect(screen.getByText('缺少上游成本或售价配置')).toBeInTheDocument();
    expect(screen.queryByText('price_missing')).not.toBeInTheDocument();
  });

  it('keeps inventory snapshot metrics out of the admin resource list', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 765,
          items: [
            {
              id: 'resource-stale',
              parentId: null,
              type: 'COUNTRY',
              code: 'SG',
              name: 'Singapore',
              displayName: 'Singapore',
              providerCode: 'PR',
              ipType: 'NATIVE',
              protocol: 'SOCKS5',
              status: 'ACTIVE',
              sortOrder: 1,
              isVisible: true,
              isSaleable: true,
              unsaleableReason: null,
              stock: 0,
              inventoryCapturedAt: '2026-06-13T00:00:00.000Z',
              inventoryIsStale: true,
            },
            {
              id: 'resource-missing-stock',
              parentId: null,
              type: 'COUNTRY',
              code: 'TH',
              name: 'Thailand',
              displayName: 'Thailand',
              providerCode: 'IPIPD',
              ipType: 'NATIVE',
              protocol: 'SOCKS5',
              status: 'ACTIVE',
              sortOrder: 2,
              isVisible: true,
              isSaleable: true,
              unsaleableReason: null,
              stock: null,
              inventoryCapturedAt: null,
              inventoryIsStale: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();

    expect(await screen.findByText('resources.summary.total')).toBeInTheDocument();
    expect(screen.getByText('本页 2 类 / 2 个资源')).toBeInTheDocument();
    expect(screen.queryByText('resources.inventoryNeedsSync')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.zeroStockResources')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.summary.stale')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.summary.zeroStock')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.summary.saleReadyHint')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.activeOnPage')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.saleableOnPage')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.stockSnapshotsOnPage')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /resources\.operations\.more/ })[0]);
    expect(await screen.findByText('设置售卖')).toBeInTheDocument();
    expect(screen.queryByText('resources.inventory.title')).not.toBeInTheDocument();
  });

  it('renders same-country same-cost resources as one grouped admin row with visible region summary', async () => {
    const resources = [
      resourceFixture({
        id: 'at-lower-austria-a',
        code: 'AT:6928:Lower Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Lower Austria',
        name: 'Austria-Lower Austria',
        displayName: 'Austria-Lower Austria',
        providerCode: 'PR',
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
        unitPrice: '28.00',
        priceCurrency: 'CNY',
      }),
      resourceFixture({
        id: 'at-telekom-austria',
        code: 'AT:6928:Telekom Austria',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Telekom Austria',
        name: 'Austria-Telekom Austria',
        displayName: 'Austria-Telekom Austria',
        providerCode: 'PR',
        sortOrder: 2,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
        unitPrice: '28.00',
        priceCurrency: 'CNY',
      }),
      resourceFixture({
        id: 'at-magenta-telekom',
        code: 'AT:6928:Magenta Telekom',
        countryCode: 'AT',
        upstreamResourceId: 'AT:6928:Magenta Telekom',
        name: 'Austria-Magenta Telekom',
        displayName: 'Austria-Magenta Telekom',
        providerCode: 'PR',
        sortOrder: 3,
        upstreamCost: '1.99',
        upstreamCostCurrency: 'USD',
        unitPrice: '28.00',
        priceCurrency: 'CNY',
      }),
    ];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      const pathText = String(path);
      if (pathText.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary(resources));
      }
      if (pathText.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('AT', [
          quickPriceGroup(resources[0], { resourceCount: 3, pricedCount: 3, costGroupKey: 'cost-at' }),
        ]));
      }
      if (pathText.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 3,
          items: resources,
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();

    expect(await screen.findByText('本页 1 类 / 3 个资源')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /resources\.operations\.more/ })).toHaveLength(1);
    expect(screen.getAllByText('3 个资源').length).toBeGreaterThan(0);
    expect(screen.getByText(/下奥地利/)).toBeInTheDocument();
    expect(screen.getByText(/奥地利电信/)).toBeInTheDocument();
    expect(screen.getByText(/麦琴塔电信/)).toBeInTheDocument();
  });

  it('does not automatically sync stale inventory snapshots from the admin resource page', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/resources/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 2,
          created: 0,
          updated: 2,
          skipped: 0,
          failed: 0,
          synced: 2,
          syncedAt: '2026-06-18T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['SG'],
        });
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'SG',
            name: 'Singapore',
            displayName: 'Singapore',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 0,
            inventoryCapturedAt: '2026-06-13T00:00:00.000Z',
            inventoryIsStale: true,
          }],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    expect((await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }))).length).toBeGreaterThan(0);

    expect(
      spy.mock.calls.some((call) => (
        call[0] === '/api/resources/sync-inventory' &&
        call[1]?.method === 'POST' &&
        JSON.parse(String(call[1]?.body)).providerCode === 'PR'
      )),
    ).toBe(false);
  });

  it('syncs inventory from the row more actions menu', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'TW',
            name: 'Taiwan',
            displayName: 'Taiwan',
            providerCode: 'NINE_EIGHT_FIVE',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 10,
          }],
        });
      }
      if (path === '/api/resources/resource-1/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 2,
          created: 1,
          updated: 0,
          skipped: 1,
          failed: 0,
          synced: 1,
          syncedAt: '2026-06-13T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['TW'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'TW', countryCode: 'TW' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('resources.syncInventory'));

    await vi.waitFor(() => expect(
      spy.mock.calls.some(
        (call) => call[0] === '/api/resources/resource-1/sync-inventory' && call[1]?.method === 'POST',
      ),
    ).toBe(true));
  });

  it('keeps synced resource identity read-only when setting saleability', async () => {
    let updateBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'SG',
            name: 'Singapore',
            displayName: 'Singapore',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 8,
          }],
        });
      }
      if (path === '/api/resources/resource-1' && init?.method === 'PUT') {
        updateBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('设置售卖'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('resources.providerCode')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('resources.code')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('resources.name')).not.toBeInTheDocument();
    expect(within(dialog).getByText('新加坡')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '保存售卖设置' }));

    await vi.waitFor(() => expect(updateBody).toBeDefined());
    expect(updateBody).toEqual({
      isSaleable: true,
      unsaleableReason: null,
    });
  });

  it('builds a saleability-only resource update payload', () => {
    expect(buildResourceSaleabilityPayload({
      type: 'COUNTRY',
      code: 'SG',
      name: 'Singapore',
      isSaleable: false,
      unsaleableReason: ' provider_sale_disabled ',
    })).toEqual({
      isSaleable: false,
      unsaleableReason: 'provider_sale_disabled',
    });

    expect(buildResourceSaleabilityPayload({
      type: 'COUNTRY',
      code: 'SG',
      name: 'Singapore',
      isSaleable: true,
      unsaleableReason: 'provider_sale_disabled',
    })).toEqual({
      isSaleable: true,
      unsaleableReason: null,
    });
  });

  it('submits saleability changes from the resource edit form', async () => {
    let updateBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [resourceFixture({ id: 'resource-saleable-toggle' })],
        });
      }
      if (path === '/api/resources/resource-saleable-toggle' && init?.method === 'PUT') {
        updateBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('设置售卖'));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存售卖设置' }));

    await vi.waitFor(() => expect(updateBody).toBeDefined());
    expect(updateBody).toMatchObject({
      isSaleable: false,
      unsaleableReason: 'provider_sale_disabled',
    });
  });

  it('posts price overrides from the resource page', async () => {
    let overrideBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-price-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'SG',
            name: 'Singapore',
            displayName: 'Singapore',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 8,
            unitPrice: '39.00',
            priceCurrency: 'CNY',
            upstreamCost: '18.50',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        overrideBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('modify-price'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('modify-price')).toBeInTheDocument();
    expect(within(dialog).getByText(/cost.*18\.50\s*CNY/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '48.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'resources.resourceSavePrice' }));

    await vi.waitFor(() => expect(overrideBody).toBeDefined());
    expect(overrideBody).toEqual({
      resourceId: 'resource-price-1',
      durationDays: 30,
      unitPrice: '48.5',
      currency: 'CNY',
    });
  });

  it('quick prices every resource in the selected region from the resource page', async () => {
    let overrideBody: Record<string, unknown> | undefined;
    const resources = [
      resourceFixture({
        id: 'us-ny-rec-cidr-a',
        code: 'US:line-ny-rec|cidr=192.168.104.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.104.0%2F24',
        name: 'United States-New York Recommended-192.168.104.0/24',
        displayName: 'United States-New York Recommended-192.168.104.0/24',
        providerCode: 'IPIPD',
        unitPrice: '39.00',
        priceCurrency: 'CNY',
        upstreamCost: '18.50',
        upstreamCostCurrency: 'CNY',
      }),
      resourceFixture({
        id: 'us-ny-rec-cidr-b',
        code: 'US:line-ny-rec|cidr=192.168.105.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.105.0%2F24',
        name: 'United States-New York Recommended-192.168.105.0/24',
        displayName: 'United States-New York Recommended-192.168.105.0/24',
        providerCode: 'IPIPD',
        sortOrder: 2,
        unitPrice: '42.00',
        priceCurrency: 'CNY',
        upstreamCost: '18.50',
        upstreamCostCurrency: 'CNY',
      }),
    ];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary(resources));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('US', [
          quickPriceGroup(resources[0], {
            key: 'US:auto',
            regionKey: '__auto_select__',
            costGroupKey: 'cost-same',
            resourceCount: 2,
            pricedCount: 2,
            autoSelect: true,
          }),
        ]));
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 2,
          items: resources,
        });
      }
      if (path === '/api/pricing/resource-group-overrides' && init?.method === 'POST') {
        overrideBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await clickQuickPriceOption(screen, '美国');
    await screen.findAllByText(/18\.50\s*CNY/);
    expect(screen.getByText('resources.quickPriceTitle')).toBeInTheDocument();
    expect(screen.getByText('系统自动选择')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('resources.resourcePricePlaceholder'), { target: { value: '49.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'resources.quickSavePrice' }));

    await vi.waitFor(() => expect(overrideBody).toBeDefined());
    expect(overrideBody).toEqual({
      countryCode: 'US',
      regionKey: '__auto_select__',
      costGroupKey: 'cost-same',
      autoSelect: true,
      durationDays: 30,
      unitPrice: '49.5',
      currency: 'CNY',
    });
  });

  it('loads quick pricing through summary and country group pages instead of background-loading every resource', async () => {
    let overrideBody: Record<string, unknown> | undefined;
    const firstPageItems = Array.from({ length: 20 }, (_, index) => resourceFixture({
      id: `us-page-one-${index}`,
      code: `US:line-${index}`,
      countryCode: 'US',
      upstreamResourceId: `line-${index}`,
      name: `United States line ${index}`,
      displayName: `United States line ${index}`,
      providerCode: 'IPIPD',
      sortOrder: index,
      unitPrice: '39.00',
      priceCurrency: 'CNY',
      upstreamCost: '18.50',
      upstreamCostCurrency: 'CNY',
    }));
    const ukrainianResource = resourceFixture({
      id: 'ua-rivne',
      code: 'UA:6928:Rivne Oblast:Dubno:Eksintech',
      countryCode: 'UA',
      upstreamResourceId: 'UA:6928:Rivne Oblast:Dubno:Eksintech',
      name: 'Ukraine-Rivne Oblast-Dubno-Eksintech',
      displayName: 'Ukraine-Rivne Oblast-Dubno-Eksintech',
      sortOrder: 21,
      unitPrice: '42.00',
      priceCurrency: 'CNY',
      upstreamCost: '2.10',
      upstreamCostCurrency: 'USD',
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/pricing/resource-group-overrides' && init?.method === 'POST') {
        overrideBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        const url = new URL(String(path), 'https://local.test');
        const search = url.searchParams.get('search') ?? '';
        return Promise.resolve(search.includes('乌克兰')
          ? quickPriceSummary([ukrainianResource])
          : quickPriceSummary(firstPageItems));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        const url = new URL(String(path), 'https://local.test');
        const countryCode = url.searchParams.get('countryCode') ?? 'US';
        return Promise.resolve(countryCode === 'UA'
          ? quickPriceGroups('UA', [quickPriceGroup(ukrainianResource, { costGroupKey: 'cost-ua' })])
          : quickPriceGroups('US', [quickPriceGroup(firstPageItems[0], { resourceCount: 20, costGroupKey: 'cost-us' })]));
      }
      if (path.startsWith('/api/resources') && !init?.method) {
          return Promise.resolve({
            page: 1,
            pageSize: 20,
            total: 20,
            items: firstPageItems,
          });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    expect((await screen.findAllByText('美国')).length).toBeGreaterThan(0);
    const requestSpy = client.apiRequest as unknown as { mock: { calls: Array<[string, unknown?]> } };
    expect(requestSpy.mock.calls.some(([path]) => String(path).startsWith('/api/resources/priceable-catalog/groups'))).toBe(false);
    expect(requestSpy.mock.calls.some(([path]) => {
      const pathText = String(path);
      return pathText.startsWith('/api/resources/priceable-catalog')
        && pathText.includes('page=2')
        && pathText.includes('pageSize=500');
    })).toBe(false);
    expect(screen.queryByText('乌克兰')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rivne|Dubno|Eksintech/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('resources.bulkCountrySearchPlaceholder'), { target: { value: '乌克兰' } });
    expect((await screen.findAllByText('乌克兰')).length).toBeGreaterThan(0);
    await clickQuickPriceOption(screen, '乌克兰');
    await screen.findAllByText(/2\.10\s*USD/);
    fireEvent.change(screen.getByPlaceholderText('resources.resourcePricePlaceholder'), { target: { value: '58' } });
    fireEvent.click(screen.getByRole('button', { name: 'resources.quickSavePrice' }));

    await vi.waitFor(() => expect(overrideBody).toBeDefined());
    expect(overrideBody).toMatchObject({
      countryCode: 'UA',
      costGroupKey: 'cost-ua',
      durationDays: 30,
      unitPrice: '58',
      currency: 'CNY',
    });
  });

  it('invalidates quick pricing catalog after saving a price', async () => {
    const invalidatedQueries: unknown[] = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [resourceFixture()],
        });
      }
      if (path === '/api/pricing/overrides' && init?.method === 'POST') {
        return Promise.resolve({});
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [resourceFixture()],
        });
      }
      return Promise.resolve({});
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((options) => {
      invalidatedQueries.push(options);
      return originalInvalidateQueries(options as never);
    });

    render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ResourceTreeFeature)),
    );

    await openResourceDetails();
    await screen.findAllByText('新加坡');
    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('modify-price'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('resources.resourcePricePlaceholder'), { target: { value: '49.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'resources.resourceSavePrice' }));

    await vi.waitFor(() => {
      expect(
        invalidatedQueries.some((entry) => (
          Boolean(entry)
          && typeof entry === 'object'
          && Array.isArray((entry as { queryKey?: unknown }).queryKey)
          && JSON.stringify((entry as { queryKey: unknown[] }).queryKey) === JSON.stringify(['resources', 'quick-price-catalog'])
        )),
      ).toBe(true);
    });
  });

  it('filters countries before quick pricing the selected region', async () => {
    let overrideBody: Record<string, unknown> | undefined;
    const austria = resourceFixture({
      id: 'at-tyrol-innsbruck',
      code: 'AT:6928:Tyrol:Innsbruck:Telekom Austria',
      countryCode: 'AT',
      upstreamResourceId: 'AT:6928:Tyrol:Innsbruck:Telekom Austria',
      name: 'Austria-Tyrol-Innsbruck-Telekom Austria',
      displayName: 'Austria-Tyrol-Innsbruck-Telekom Austria',
      providerCode: 'PR',
      stock: 3,
      unitPrice: '39.00',
      priceCurrency: 'CNY',
      upstreamCost: '1.99',
      upstreamCostCurrency: 'USD',
    });
    const india = resourceFixture({
      id: 'in-mumbai-airtel',
      code: 'IN:line-mumbai-airtel|cidr=10.40.1.0%2F24',
      countryCode: 'IN',
      upstreamResourceId: 'line-mumbai-airtel|cidr=10.40.1.0%2F24',
      name: 'India-Mumbai Airtel-10.40.1.0/24',
      displayName: 'India-Mumbai Airtel-10.40.1.0/24',
      providerCode: 'IPIPD',
      sortOrder: 2,
      stock: 7,
      unitPrice: '42.00',
      priceCurrency: 'CNY',
      upstreamCost: '20.00',
      upstreamCostCurrency: 'CNY',
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        const url = new URL(String(path), 'https://local.test');
        const search = url.searchParams.get('search') ?? '';
        return Promise.resolve(search.includes('印度') ? quickPriceSummary([india]) : quickPriceSummary([austria, india]));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        const url = new URL(String(path), 'https://local.test');
        const countryCode = url.searchParams.get('countryCode') ?? 'AT';
        return Promise.resolve(countryCode === 'IN'
          ? quickPriceGroups('IN', [quickPriceGroup(india, { costGroupKey: 'cost-in' })])
          : quickPriceGroups('AT', [quickPriceGroup(austria, { costGroupKey: 'cost-at' })]));
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 2,
          items: [austria, india],
        });
      }
      if (path === '/api/pricing/resource-group-overrides' && init?.method === 'POST') {
        overrideBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    expect((await screen.findAllByText('奥地利')).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText('resources.bulkCountrySearchPlaceholder'), { target: { value: '印度' } });
    expect((await screen.findAllByText('印度')).length).toBeGreaterThan(0);
    await clickQuickPriceOption(screen, '印度');
    await screen.findAllByText(/20\.00\s*CNY/);
    fireEvent.change(screen.getByPlaceholderText('resources.resourcePricePlaceholder'), { target: { value: '51' } });
    fireEvent.click(screen.getByRole('button', { name: 'resources.quickSavePrice' }));

    await vi.waitFor(() => expect(overrideBody).toBeDefined());
    expect(overrideBody).toMatchObject({
      countryCode: 'IN',
      costGroupKey: 'cost-in',
      durationDays: 30,
      unitPrice: '51',
      currency: 'CNY',
    });
  });

  it('bulk prices the selected region and keeps cost visible', async () => {
    const overrideBodies: Record<string, unknown>[] = [];
    const lowCostResource = resourceFixture({
      id: 'us-ny-rec-cidr-a',
      code: 'US:line-ny-rec|cidr=192.168.104.0%2F24',
      countryCode: 'US',
      upstreamResourceId: 'line-ny-rec|cidr=192.168.104.0%2F24',
      name: 'United States-New York Recommended-192.168.104.0/24',
      displayName: 'United States-New York Recommended-192.168.104.0/24',
      providerCode: 'IPIPD',
      stock: 10,
      unitPrice: '39.00',
      priceCurrency: 'CNY',
      upstreamCost: '18.50',
      upstreamCostCurrency: 'CNY',
    });
    const highCostResource = resourceFixture({
      id: 'us-ny-rec-cidr-b',
      code: 'US:line-ny-rec|cidr=192.168.105.0%2F24',
      countryCode: 'US',
      upstreamResourceId: 'line-ny-rec|cidr=192.168.105.0%2F24',
      name: 'United States-New York Recommended-192.168.105.0/24',
      displayName: 'United States-New York Recommended-192.168.105.0/24',
      providerCode: 'IPIPD',
      sortOrder: 2,
      stock: 8,
      unitPrice: '42.00',
      priceCurrency: 'CNY',
      upstreamCost: '20.00',
      upstreamCostCurrency: 'CNY',
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary([lowCostResource, highCostResource]));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('US', [
          quickPriceGroup(lowCostResource, { key: 'US:low', regionKey: 'new-york', costGroupKey: 'cost-low' }),
          quickPriceGroup(highCostResource, { key: 'US:high', regionKey: 'new-york', costGroupKey: 'cost-high' }),
        ]));
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 2,
          items: [lowCostResource, highCostResource],
        });
      }
      if (path === '/api/pricing/resource-group-overrides' && init?.method === 'POST') {
        overrideBodies.push(JSON.parse(String(init.body)));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    expect((await screen.findAllByText('美国')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'resources.bulkPriceTitle' }));
    const dialog = await screen.findByRole('dialog');
    await clickQuickPriceOption(within(dialog), '美国');
    expect(within(dialog).queryByText(/线路\s*[12]/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(within(dialog).getAllByText('纽约').length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(within(dialog).getAllByText(/18\.50\s*CNY\s*-\s*20\.00\s*CNY/).length).toBeGreaterThan(0));
    expect(within(dialog).getAllByText(/18\.50\s*CNY/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/20\.00\s*CNY/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('已选择 / 已定价商品')).toBeInTheDocument();
    expect(within(dialog).getByText('选择商品')).toBeInTheDocument();
    expect(within(dialog).getByText('系统自动选择')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '49.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'resources.quickSavePrice' }));

    await vi.waitFor(() => expect(overrideBodies).toHaveLength(2));
    expect(overrideBodies).toEqual([
      {
        countryCode: 'US',
        regionKey: 'new-york',
        costGroupKey: 'cost-low',
        autoSelect: false,
        durationDays: 30,
        unitPrice: '49.5',
        currency: 'CNY',
      },
      {
        countryCode: 'US',
        regionKey: 'new-york',
        costGroupKey: 'cost-high',
        autoSelect: false,
        durationDays: 30,
        unitPrice: '49.5',
        currency: 'CNY',
      },
    ]);
  });

  it('unlists a configured quick pricing region through the backend group selector', async () => {
    const unlistBodies: Record<string, unknown>[] = [];
    const resource = resourceFixture({
      id: 'us-ny-rec-cidr-a',
      code: 'US:line-ny-rec|cidr=192.168.104.0%2F24',
      countryCode: 'US',
      upstreamResourceId: 'line-ny-rec|cidr=192.168.104.0%2F24',
      name: 'United States-New York Recommended-192.168.104.0/24',
      displayName: 'United States-New York Recommended-192.168.104.0/24',
      providerCode: 'IPIPD',
      unitPrice: '39.00',
      priceCurrency: 'CNY',
      upstreamCost: '18.50',
      upstreamCostCurrency: 'CNY',
    });
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary([resource]));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('US', [
          quickPriceGroup(resource, {
            key: 'US:ny',
            regionKey: 'new-york',
            costGroupKey: 'cost-low',
            pricedCount: 1,
          }),
        ]));
      }
      if (path === '/api/resources/priceable-catalog/group-saleability' && init?.method === 'POST') {
        unlistBodies.push(JSON.parse(String(init.body)));
        return Promise.resolve({ updated: 1, resourceIds: ['us-ny-rec-cidr-a'] });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await clickQuickPriceOption(screen, '美国');
    await screen.findByText('已选择 / 已定价商品');
    const unlistButtons = await screen.findAllByRole('button', { name: /下\s*架/ });
    const unlistButton = unlistButtons.find((element) => element.tagName.toLowerCase() === 'button');
    expect(unlistButton).toBeDefined();
    fireEvent.click(unlistButton!);

    await vi.waitFor(() => expect(unlistBodies).toHaveLength(1));
    expect(unlistBodies[0]).toEqual({
      countryCode: 'US',
      regionKey: 'new-york',
      costGroupKey: 'cost-low',
      autoSelect: false,
      saleable: false,
    });
  });

  it('quick pricing defaults to every resource in the selected region', async () => {
    let overrideBody: Record<string, unknown> | undefined;
    const resources = [
      resourceFixture({
        id: 'us-ny-rec-cidr-a',
        code: 'US:line-ny-rec|cidr=192.168.104.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.104.0%2F24',
        name: 'United States-New York Recommended-192.168.104.0/24',
        displayName: 'United States-New York Recommended-192.168.104.0/24',
        providerCode: 'IPIPD',
        unitPrice: '39.00',
        priceCurrency: 'CNY',
        upstreamCost: '18.50',
        upstreamCostCurrency: 'CNY',
      }),
      resourceFixture({
        id: 'us-ny-rec-cidr-b',
        code: 'US:line-ny-rec|cidr=192.168.105.0%2F24',
        countryCode: 'US',
        upstreamResourceId: 'line-ny-rec|cidr=192.168.105.0%2F24',
        name: 'United States-New York Recommended-192.168.105.0/24',
        displayName: 'United States-New York Recommended-192.168.105.0/24',
        providerCode: 'IPIPD',
        unitPrice: '42.00',
        priceCurrency: 'CNY',
        upstreamCost: '18.50',
        upstreamCostCurrency: 'CNY',
      }),
    ];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog/summary') && !init?.method) {
        return Promise.resolve(quickPriceSummary(resources));
      }
      if (path.startsWith('/api/resources/priceable-catalog/groups') && !init?.method) {
        return Promise.resolve(quickPriceGroups('US', [
          quickPriceGroup(resources[0], {
            key: 'US:auto',
            regionKey: '__auto_select__',
            costGroupKey: 'cost-same',
            resourceCount: 2,
            pricedCount: 2,
            autoSelect: true,
          }),
        ]));
      }
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 2,
          items: resources,
        });
      }
      if (path === '/api/pricing/resource-group-overrides' && init?.method === 'POST') {
        overrideBody = JSON.parse(String(init.body));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await clickQuickPriceOption(screen, '美国');
    await screen.findAllByText(/18\.50\s*CNY/);

    expect(screen.getByText('系统自动选择')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('resources.resourcePricePlaceholder'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'resources.quickSavePrice' }));

    await vi.waitFor(() => expect(overrideBody).toBeDefined());
    expect(overrideBody).toEqual({
      countryCode: 'US',
      regionKey: '__auto_select__',
      costGroupKey: 'cost-same',
      autoSelect: true,
      durationDays: 30,
      unitPrice: '55',
      currency: 'CNY',
    });
  });

  it('shows upstream cost in the resource price column', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path.startsWith('/api/resources')) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-cost-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'CA',
            name: 'Canada',
            displayName: 'Canada',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 8,
            unitPrice: '39.00',
            priceCurrency: 'CNY',
            upstreamCost: '18.50',
            upstreamCostCurrency: 'CNY',
          }],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    expect((await screen.findAllByText(/18\.50\s*CNY/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cost/).length).toBeGreaterThan(0);
  });

  it('shows the auditable inventory sync result from the backend response', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'SG',
            name: 'Singapore',
            displayName: 'Singapore',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 0,
          }],
        });
      }
      if (path === '/api/resources/resource-1/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 3,
          created: 1,
          updated: 1,
          skipped: 1,
          failed: 0,
          synced: 2,
          syncedAt: '2026-06-13T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['SG', 'TH'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('resources.syncInventory'));

    await vi.waitFor(() => expect(
      spy.mock.calls.some(
        (call) => call[0] === '/api/resources/resource-1/sync-inventory' && call[1]?.method === 'POST',
      ),
    ).toBe(true));
    expect(await screen.findByText('resources.syncResultTitle')).toBeInTheDocument();
    expect(screen.getByText('resources.syncCountries')).toBeInTheDocument();
  });

  it('keeps inventory sync failures visible on the resource page', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources') && !init?.method) {
        return Promise.resolve({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [{
            id: 'resource-1',
            parentId: null,
            type: 'COUNTRY',
            code: 'SG',
            name: 'Singapore',
            displayName: 'Singapore',
            providerCode: 'PR',
            ipType: 'NATIVE',
            protocol: 'SOCKS5',
            status: 'ACTIVE',
            sortOrder: 1,
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
            stock: 0,
          }],
        });
      }
      if (path === '/api/resources/resource-1/sync-inventory' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'inventory_empty'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(React.createElement(ResourceTreeFeature));
    await openResourceDetails();
    await screen.findAllByText(formatRegionNameZh({ code: 'SG', countryCode: 'SG' }));

    fireEvent.click(screen.getByRole('button', { name: /resources\.operations\.more/ }));
    fireEvent.click(await screen.findByText('resources.syncInventory'));

    expect(await screen.findByText('resources.syncFailedTitle')).toBeInTheDocument();
    expect(screen.getAllByText('上游没有返回可用库存').length).toBeGreaterThanOrEqual(1);
  });
});
