import React, { useState } from 'react';
import { Alert, Button, Card, Col, Dropdown, Form, Input, InputNumber, Modal, Pagination, Row, Select, Space, Switch, Tag, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { DownOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { ListPage, type PageResult } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { PROVIDER_OPTIONS, formatProviderLabel } from '../../shared/provider/provider-labels';
import { DEFAULT_PRICING_DURATION_DAYS } from '../pricing/pricing-duration';
import {
  formatIpTypeZh,
  formatProtocolZh,
  formatRegionNameZh,
  formatResourceLocationEn,
  formatResourceLocationZh,
  type ResourceLocationLabel,
  formatResourceStatusZh,
  resourceStatusOptionsZh,
} from '../../shared/resource/resource-labels';
import { formatMoneyAmount, parseMoneyAmount } from '../../shared/money/money';
import { formatDateTime } from '../../shared/time/time';
import {
  formatDefaultAutoSelectLabel,
  isEnglishLanguage,
} from '../../shared/resource/resource-selection-labels';

interface ResourceDto {
  id: string;
  parentId: string | null;
  type: string;
  code: string;
  name: string;
  displayName: string | null;
  providerCode: string;
  ipType: string;
  protocol: string;
  status: string;
  sortOrder: number;
  isVisible: boolean;
  isSaleable: boolean;
  unsaleableReason: string | null;
  countryCode?: string;
  upstreamResourceId?: string | null;
  stock: number | null;
  unitPrice?: string | null;
  priceCurrency?: string | null;
  upstreamCost?: string | null;
  upstreamCostCurrency?: string | null;
  inventoryCapturedAt?: string | null;
  inventoryIsStale?: boolean | null;
}

interface ResourceFormValues {
  type: string;
  code: string;
  name: string;
  displayName?: string | null;
  providerCode?: string;
  isSaleable?: boolean;
  unsaleableReason?: string | null;
}

interface PriceFormValues {
  unitPrice: number | null;
  currency: string;
}

interface BulkPriceFormValues {
  unitPrice: number | null;
  currency: string;
}

interface SyncInventoryResult {
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  synced: number;
  syncedAt: string;
  upstreamRawStatus: string;
  countries: string[];
}

interface QuickPriceCountrySummary {
  countryCode: string;
  totalResources: number;
  regionCount: number;
  pricedCount: number;
  costGroupCount: number;
}

interface QuickPriceSummaryResult {
  page: number;
  pageSize: number;
  total: number;
  totalResources: number;
  items: QuickPriceCountrySummary[];
}

interface QuickPriceGroupDto {
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
  sampleResource: ResourceDto;
}

interface QuickPriceGroupsResult {
  countryCode: string;
  page: number;
  pageSize: number;
  total: number;
  totalResources: number;
  items: QuickPriceGroupDto[];
}

type SyncFeedback =
  | {
      type: 'success';
      resourceId: string;
      resourceName: string;
      result: SyncInventoryResult;
    }
  | {
      type: 'error';
      resourceId: string;
      resourceName: string;
      reasonKey: string;
    };

interface BulkPriceRegionGroup {
  key: string;
  label: string;
  baseLabel: string;
  countryCode: string;
  countryLabel: string;
  costKey: string;
  resources: ResourceDto[];
  resourceCount?: number;
  pricedCount?: number;
  unitPrice?: string | null;
  priceCurrency?: string | null;
  upstreamCost?: string | null;
  upstreamCostCurrency?: string | null;
  sampleResource?: ResourceDto;
  autoSelect?: boolean;
  regionKey?: string;
  selectors?: BulkPriceRegionSelector[];
}

interface BulkPriceRegionSelector {
  regionKey?: string;
  costGroupKey: string;
  autoSelect?: boolean;
}

interface BulkPriceCountryGroup {
  key: string;
  label: string;
  countryCode: string;
  resources: ResourceDto[];
  resourceCount?: number;
  pricedCount?: number;
  regionCount?: number;
  regions: BulkPriceRegionGroup[];
}

export interface ResourceGroupRow {
  id: string;
  countryCode: string;
  countryLabel: string;
  regionLabel: string;
  providerCode: string;
  costKey: string;
  resources: ResourceDto[];
  sampleResource: ResourceDto;
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

interface QuickPriceWorkspaceProps {
  t: Translate;
  form: FormInstance<BulkPriceFormValues>;
  countryGroups: BulkPriceCountryGroup[];
  countrySearch: string;
  countryPage: number;
  countryPageSize: number;
  countryTotal: number;
  countryLoading: boolean;
  selectedCountry: BulkPriceCountryGroup | null;
  regionGroups: BulkPriceRegionGroup[];
  regionPage: number;
  regionPageSize: number;
  regionTotal: number;
  regionLoading: boolean;
  selectedRegion: BulkPriceRegionGroup | null;
  selectedRegionTitle: string;
  providerLabel: string;
  selectedCount: number;
  pricedCount: number;
  costSummary: { label: string; hasCost: boolean } | null;
  saving: boolean;
  unlistingRegionKey?: string | null;
  onCountrySearchChange: (value: string) => void;
  onCountryPageChange: (page: number) => void;
  onCountrySelect: (group: BulkPriceCountryGroup) => void;
  onRegionPageChange: (page: number) => void;
  onRegionSelect: (group: BulkPriceRegionGroup) => void;
  onRegionUnlist?: (group: BulkPriceRegionGroup) => void;
  onFinish: (values: BulkPriceFormValues) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}

const DEFAULT_UNSALEABLE_REASON = 'provider_sale_disabled';
const QUICK_PRICE_SELECTOR_PAGE_SIZE = 20;
const QUICK_PRICE_AUTO_REGION_KEY_SUFFIX = '__auto_select__';
const CREATE_RESOURCE_DEFAULTS = {
  ipType: 'NATIVE',
  protocol: 'BOTH',
  status: 'ACTIVE',
  sortOrder: 0,
  isVisible: true,
  isSaleable: true,
} as const;

export function buildResourcePayload(values: ResourceFormValues, mode: 'create' | 'update' = 'update') {
  const saleability = values.isSaleable === undefined
    ? {}
    : {
        isSaleable: values.isSaleable,
        unsaleableReason: values.isSaleable
          ? null
          : values.unsaleableReason?.trim() || DEFAULT_UNSALEABLE_REASON,
      };
  const payload = {
    type: values.type,
    code: values.code.trim(),
    name: values.name.trim(),
    displayName: values.displayName?.trim() || null,
    ...saleability,
  };
  return mode === 'create'
    ? { ...payload, providerCode: values.providerCode, ...CREATE_RESOURCE_DEFAULTS, ...saleability }
    : payload;
}

export function buildResourceSaleabilityPayload(values: ResourceFormValues) {
  return {
    isSaleable: values.isSaleable ?? true,
    unsaleableReason: values.isSaleable === false
      ? values.unsaleableReason?.trim() || DEFAULT_UNSALEABLE_REASON
      : null,
  };
}

export function buildBulkPriceOverrideBodies(resourceIds: string[], durationDays: number, unitPrice: number, currency: string) {
  return resourceIds.map((resourceId) => ({
    resourceId,
    durationDays,
    unitPrice: String(unitPrice),
    currency,
  }));
}

function fetchQuickPriceSummary(page: number, search: string, providerCode?: string): Promise<QuickPriceSummaryResult> {
  return apiRequest<QuickPriceSummaryResult>(
    `/api/resources/priceable-catalog/summary${buildQuery({
      page,
      pageSize: QUICK_PRICE_SELECTOR_PAGE_SIZE,
      search,
      providerCode,
      durationDays: DEFAULT_PRICING_DURATION_DAYS,
    })}`,
  );
}

function fetchQuickPriceGroups(countryCode: string, page: number, providerCode?: string): Promise<QuickPriceGroupsResult> {
  return apiRequest<QuickPriceGroupsResult>(
    `/api/resources/priceable-catalog/groups${buildQuery({
      countryCode,
      page,
      pageSize: QUICK_PRICE_SELECTOR_PAGE_SIZE,
      providerCode,
      durationDays: DEFAULT_PRICING_DURATION_DAYS,
    })}`,
  );
}

export function ResourceTreeFeature() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm<ResourceFormValues>();
  const [priceForm] = Form.useForm<PriceFormValues>();
  const [quickPriceForm] = Form.useForm<BulkPriceFormValues>();
  const [bulkPriceForm] = Form.useForm<BulkPriceFormValues>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>('ACTIVE');
  const [providerFilter, setProviderFilter] = useState<string | undefined>(undefined);
  const [showResourceDetails, setShowResourceDetails] = useState(false);
  const [editingResource, setEditingResource] = useState<ResourceDto | null>(null);
  const [pricingResource, setPricingResource] = useState<ResourceDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkCountryKey, setBulkCountryKey] = useState<string | null>(null);
  const [bulkRegionKey, setBulkRegionKey] = useState<string | null>(null);
  const [bulkCountrySearch, setBulkCountrySearch] = useState('');
  const [bulkCountryPage, setBulkCountryPage] = useState(1);
  const [bulkRegionPage, setBulkRegionPage] = useState(1);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);
  const currentLanguage = i18n?.resolvedLanguage ?? i18n?.language;
  const formSaleableValue = Form.useWatch('isSaleable', form);

  const query = useQuery({
    queryKey: ['resources', page, pageSize, search, status, providerFilter],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: ResourceDto[] }>(
        `/api/resources${buildQuery({ page, pageSize, search, status, providerCode: providerFilter })}`,
      ),
    enabled: showResourceDetails,
  });

  const normalizedBulkCountrySearch = bulkCountrySearch.trim();
  const quickPriceSummaryQuery = useQuery({
    queryKey: ['resources', 'quick-price-catalog', 'summary', DEFAULT_PRICING_DURATION_DAYS, providerFilter, bulkCountryPage, normalizedBulkCountrySearch],
    queryFn: () => fetchQuickPriceSummary(bulkCountryPage, normalizedBulkCountrySearch, providerFilter),
  });
  const quickPriceCountryGroups = React.useMemo(
    () => (quickPriceSummaryQuery.data?.items ?? []).map((item) => toQuickPriceCountryGroup(item, currentLanguage)),
    [currentLanguage, quickPriceSummaryQuery.data?.items],
  );
  const selectedQuickPriceCountry = bulkCountryKey
    ? quickPriceCountryGroups.find((group) => group.key === bulkCountryKey) ?? null
    : null;
  const quickPriceGroupsQuery = useQuery({
    queryKey: ['resources', 'quick-price-catalog', 'groups', DEFAULT_PRICING_DURATION_DAYS, providerFilter, selectedQuickPriceCountry?.countryCode, bulkRegionPage],
    queryFn: () => fetchQuickPriceGroups(selectedQuickPriceCountry!.countryCode, bulkRegionPage, providerFilter),
    enabled: Boolean(bulkCountryKey && selectedQuickPriceCountry?.countryCode),
  });

  const syncMutation = useMutation({
    mutationFn: async (resourceId: string) => {
      const data: unknown = await apiRequest<SyncInventoryResult>(`/api/resources/${resourceId}/sync-inventory`, { method: 'POST' });
      if (!isSyncInventoryResult(data)) {
        throw new Error('invalid_sync_inventory_response');
      }
      return data;
    },
    onSuccess: (data, resourceId) => {
      const resource = (query.data?.items ?? []).find((item) => item.id === resourceId);
      const countries = formatSyncCountries(data.countries);
      setSyncFeedback({
        type: 'success',
        resourceId,
        resourceName: resource ? formatResourceDisplayName(resource) : resourceId,
        result: data,
      });
      if (isSyncInventoryIssue(data)) {
        message.warning(t('resources.syncNoRowsTitle'));
      } else {
        message.success(t('resources.syncSuccessWithDetail', {
          count: data.synced,
          attempted: data.attempted,
          skipped: data.skipped,
          countries,
        }));
      }
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error, resourceId) => {
      const reasonKey = error instanceof ApiError ? error.reasonKey : t('error');
      const resource = (query.data?.items ?? []).find((item) => item.id === resourceId);
      setSyncFeedback({
        type: 'error',
        resourceId,
        resourceName: resource ? formatResourceDisplayName(resource) : resourceId,
        reasonKey,
      });
      message.error(formatResourceFailure(reasonKey, t));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (values: ResourceFormValues) => {
      if (!editingResource) throw new Error('resource_not_found');
      return apiRequest(`/api/resources/${editingResource.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildResourceSaleabilityPayload(values)),
      });
    },
    onSuccess: () => {
      message.success(t('resources.saveSuccess'));
      setFormOpen(false);
      setEditingResource(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
  });

  const savePriceMutation = useMutation({
    mutationFn: async (values: PriceFormValues) => {
      if (!pricingResource) throw new Error('price_resource_missing');
      const unitPrice = values.unitPrice === null ? null : Number(values.unitPrice);
      if (unitPrice === null || !Number.isFinite(unitPrice)) {
        throw new Error('price_unit_invalid');
      }
      await apiRequest('/api/pricing/overrides', {
        method: 'POST',
        body: JSON.stringify({
          resourceId: pricingResource.id,
          durationDays: DEFAULT_PRICING_DURATION_DAYS,
          unitPrice: String(unitPrice),
          currency: values.currency,
        }),
      });
    },
    onSuccess: () => {
      message.success(t('resources.resourcePriceSaveSuccess'));
      setPriceOpen(false);
      setPricingResource(null);
      priceForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error) => {
      message.error(formatResourceFailure(error, t));
    },
  });

  const saveBulkPriceMutation = useMutation({
    mutationFn: async (values: BulkPriceFormValues) => {
      const unitPrice = values.unitPrice === null ? null : Number(values.unitPrice);
      if (unitPrice === null || !Number.isFinite(unitPrice)) {
        throw new Error('price_unit_invalid');
      }
      if (!selectedBulkCountry || !selectedBulkRegion) throw new Error('price_resources_missing');
      for (const selector of getBulkRegionSaveSelectors(selectedBulkRegion)) {
        await apiRequest('/api/pricing/resource-group-overrides', {
          method: 'POST',
          body: JSON.stringify({
            countryCode: selectedBulkCountry.countryCode,
            regionKey: selector.regionKey,
            costGroupKey: selector.costGroupKey,
            autoSelect: selector.autoSelect === true,
            providerCode: providerFilter,
            durationDays: DEFAULT_PRICING_DURATION_DAYS,
            unitPrice: String(unitPrice),
            currency: values.currency,
          }),
        });
      }
    },
    onSuccess: () => {
      message.success(t('resources.bulkPriceSaveSuccess'));
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error) => {
      message.error(formatResourceFailure(error, t));
    },
  });

  const unlistBulkRegionMutation = useMutation({
    mutationFn: async (region: BulkPriceRegionGroup) => {
      for (const selector of getBulkRegionSaveSelectors(region)) {
        await apiRequest('/api/resources/priceable-catalog/group-saleability', {
          method: 'POST',
          body: JSON.stringify({
            countryCode: region.countryCode,
            regionKey: selector.regionKey,
            costGroupKey: selector.costGroupKey,
            autoSelect: selector.autoSelect === true,
            providerCode: providerFilter,
            saleable: false,
          }),
        });
      }
    },
    onSuccess: () => {
      message.success(t('resources.bulkRegionUnlistSuccess'));
      setBulkRegionKey(null);
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error) => {
      message.error(formatResourceFailure(error, t));
    },
  });

  const openEdit = (resource: ResourceDto) => {
    saveMutation.reset();
    setEditingResource(resource);
    form.setFieldsValue({
      isSaleable: resource.isSaleable,
      unsaleableReason: resource.unsaleableReason ?? null,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    saveMutation.reset();
    setFormOpen(false);
    setEditingResource(null);
    form.resetFields();
  };

  function closePrice() {
    savePriceMutation.reset();
    setPriceOpen(false);
    setPricingResource(null);
    priceForm.resetFields();
  }

  function closeBulkPrice() {
    saveBulkPriceMutation.reset();
    setBulkPriceOpen(false);
    setBulkCountryKey(null);
    setBulkRegionKey(null);
    setBulkCountrySearch('');
    bulkPriceForm.resetFields();
  }

  const openPrice = (resource: ResourceDto) => {
    savePriceMutation.reset();
    setPricingResource(resource);
    priceForm.setFieldsValue({
      unitPrice: parseMoneyAmount(resource.unitPrice) ?? null,
      currency: resource.priceCurrency ?? 'CNY',
    });
    setPriceOpen(true);
  };

  const openBulkPrice = () => {
    saveBulkPriceMutation.reset();
    setBulkCountrySearch('');
    bulkPriceForm.setFieldsValue({ unitPrice: null, currency: 'CNY' });
    setBulkPriceOpen(true);
  };

  const columns: ColumnsType<ResourceGroupRow> = [
    {
      title: t('resources.catalog'),
      dataIndex: 'name',
      key: 'name',
      width: 320,
      render: (_: string, row) => {
        const regionText = formatResourceGroupRegionSummary(row, currentLanguage);
        return (
          <Space direction="vertical" size={6} style={{ width: '100%', minWidth: 0 }}>
            <Space direction="vertical" size={2}>
              <Typography.Text strong style={{ maxWidth: 280, fontSize: 15 }} ellipsis={{ tooltip: row.countryLabel }}>
                {row.countryLabel}
              </Typography.Text>
              {regionText ? (
                <Typography.Text type="secondary" style={{ maxWidth: 280, fontSize: 13, whiteSpace: 'normal' }}>
                  {regionText}
                </Typography.Text>
              ) : null}
            </Space>
            <Space size={8} wrap>
              <Tag color="geekblue">{t('resources.bulkResourceCount', { count: row.resources.length })}</Tag>
            </Space>
          </Space>
        );
      },
    },
    {
      title: t('resources.linePlatform'),
      dataIndex: 'providerCode',
      key: 'providerCode',
      width: 190,
      render: (value: string, row) => (
        <Space direction="vertical" size={4}>
          <Tag color="blue">{formatProviderLabel(value)}</Tag>
          <Space size={6} wrap>
            <Tag>{formatResourceGroupIpType(row, t)}</Tag>
            <Tag>{formatResourceGroupProtocol(row, t)}</Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: t('resources.resourcePrice'),
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 170,
      render: (_value: string | null, row) => {
        const region = toResourceGroupRegion(row);
        const price = summarizeBulkRegionPrice(region, t);
        const cost = summarizeBulkRegionCost(region, t);
        return (
          <Space direction="vertical" size={4}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {price.hasPrice ? price.label : '-'}
            </Typography.Text>
            <Space size={6} wrap>
              <Tag color={price.hasPrice ? 'green' : 'orange'} style={{ width: 'fit-content', marginInlineEnd: 0 }}>
                {price.hasPrice ? t('resources.resourcePriced') : t('resources.resourceUnpriced')}
              </Tag>
              <Tag color={cost.hasCost ? 'blue' : 'default'} style={{ width: 'fit-content', marginInlineEnd: 0 }}>
                {t('resources.resourceCost')}: {cost.label}
              </Tag>
            </Space>
          </Space>
        );
      },
    },
    {
      title: t('resources.salesState'),
      dataIndex: 'status',
      key: 'status',
      width: 190,
      render: (_value: string, row) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Tag color={getResourceGroupCount(row, (resource) => resource.status === 'ACTIVE') === row.resources.length ? 'green' : 'orange'}>
              {formatResourceGroupCount(row, (resource) => resource.status === 'ACTIVE', formatResourceStatusZh('ACTIVE'), t)}
            </Tag>
            <Tag color={getResourceGroupCount(row, (resource) => resource.isVisible) === row.resources.length ? 'blue' : 'default'}>
              {formatResourceGroupCount(row, (resource) => resource.isVisible, t('resources.visible'), t, t('resources.hidden'))}
            </Tag>
          </Space>
          <Space size={6} wrap>
            <Tag color={getResourceGroupCount(row, (resource) => resource.isSaleable) === row.resources.length ? 'green' : 'default'}>
              {formatResourceGroupCount(row, (resource) => resource.isSaleable, t('resources.saleable'), t, t('resources.unsaleable'))}
            </Tag>
            {getResourceGroupCount(row, (resource) => !resource.isSaleable) === row.resources.length
              && row.sampleResource.unsaleableReason ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {formatUnsaleableReason(row.sampleResource.unsaleableReason, t)}
              </Typography.Text>
            ) : null}
          </Space>
        </Space>
      ),
    },
    {
      title: t('resources.actions'),
      key: 'actions',
      width: 112,
      fixed: 'right',
      render: (_: unknown, row) => {
        const resource = row.sampleResource;
        return (
          <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'edit', label: t('resources.saleSettings') },
              { key: 'price', label: t('resources.modifyPrice'), disabled: !isPriceEditableResource(resource) },
              { key: 'sync', label: t('resources.syncInventory') },
            ],
            onClick: ({ key }) => {
              if (key === 'edit') openEdit(resource);
              if (key === 'price') openPrice(resource);
              if (key === 'sync') syncMutation.mutate(resource.id);
            },
          }}
        >
          <Button size="small" loading={syncMutation.isPending && syncMutation.variables === resource.id}>
            <Space size={4}>
              {t('resources.operations.more')}
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
        );
      },
    },
  ];

  const visibleItems = query.data?.items ?? [];
  const groupedVisibleItems = React.useMemo(
    () => groupResourcesForAdminResourceList(visibleItems, currentLanguage),
    [currentLanguage, visibleItems],
  );
  const groupedQuery = React.useMemo<UseQueryResult<PageResult<ResourceGroupRow>>>(
    () => ({
      ...query,
      data: query.data
        ? {
            ...query.data,
            items: groupedVisibleItems,
          }
        : undefined,
    }) as unknown as UseQueryResult<PageResult<ResourceGroupRow>>,
    [groupedVisibleItems, query],
  );
  const bulkCountryGroups = quickPriceCountryGroups;
  const visibleBulkCountryGroups = bulkCountryGroups;
  const bulkRegionGroups = React.useMemo(
    () => collapseBulkPriceRegionsByRegion(
      labelCostSplitRegions(
        (selectedQuickPriceCountry ? quickPriceGroupsQuery.data?.items ?? [] : [])
          .map((item) => toQuickPriceRegionGroup(item, currentLanguage)),
      ),
    ),
    [currentLanguage, quickPriceGroupsQuery.data?.items, selectedQuickPriceCountry],
  );
  React.useEffect(() => {
    if (!selectedQuickPriceCountry) {
      if (bulkRegionKey !== null) setBulkRegionKey(null);
      return;
    }
    if (bulkRegionGroups.some((group) => group.key === bulkRegionKey)) return;
    const firstRegion = bulkRegionGroups[0] ?? null;
    setBulkRegionKey(firstRegion?.key ?? null);
  }, [bulkRegionGroups, bulkRegionKey, selectedQuickPriceCountry]);
  const selectedBulkCountry = selectedQuickPriceCountry;
  const selectedBulkRegion = bulkRegionGroups.find((group) => group.key === bulkRegionKey)
    ?? bulkRegionGroups[0]
    ?? null;
  const providerFilterOptions = [
    { value: '', label: t('resources.allProviders') },
    ...PROVIDER_OPTIONS.map((option) => ({
      value: option.value,
      label: formatProviderLabel(option.value),
    })),
  ];
  React.useEffect(() => {
    const values = {
      unitPrice: parseMoneyAmount(selectedBulkRegion?.unitPrice ?? null) ?? null,
      currency: selectedBulkRegion?.priceCurrency ?? 'CNY',
    };
    quickPriceForm.setFieldsValue(values);
    bulkPriceForm.setFieldsValue(values);
  }, [bulkPriceForm, quickPriceForm, selectedBulkRegion?.key, selectedBulkRegion?.priceCurrency, selectedBulkRegion?.unitPrice]);
  const selectedBulkRegionTitle = selectedBulkRegion
    ? [selectedBulkCountry?.label, getBulkRegionDisplayLabel(selectedBulkRegion, t)].filter(Boolean).join(' - ')
    : t('resources.bulkRegion');
  const quickPriceCostSummary = selectedBulkRegion ? summarizeBulkRegionCost(selectedBulkRegion, t) : null;
  const quickPricePricedCount = selectedBulkRegion?.pricedCount ?? selectedBulkRegion?.resources.filter((resource) => parseMoneyAmount(resource.unitPrice) !== null).length ?? 0;
  const quickPriceSelectedCount = selectedBulkRegion?.resourceCount ?? selectedBulkRegion?.resources.length ?? 0;
  const selectBulkCountry = (group: BulkPriceCountryGroup) => {
    setBulkCountryKey(group.key);
    setBulkRegionKey(null);
    setBulkRegionPage(1);
  };
  const selectBulkRegion = (group: BulkPriceRegionGroup) => {
    setBulkRegionKey(group.key);
  };
  const changeProviderFilter = (value: string | undefined) => {
    setProviderFilter(value || undefined);
    setPage(1);
    setBulkCountryKey(null);
    setBulkRegionKey(null);
    setBulkCountryPage(1);
    setBulkRegionPage(1);
  };
  const refreshResourceData = () => {
    void quickPriceSummaryQuery.refetch();
    if (selectedQuickPriceCountry?.countryCode) {
      void quickPriceGroupsQuery.refetch();
    }
    if (showResourceDetails) {
      void query.refetch();
    }
  };
  const resourceDetailRowClassName = (row: ResourceGroupRow) => (
    row.resources.some((resource) => isResourceCoveredByQuickPriceSelection(resource, selectedBulkCountry, selectedBulkRegion, currentLanguage))
      ? 'ipx-resource-detail-row-selected'
      : ''
  );

  const renderQuickPriceWorkspace = (
    targetForm: FormInstance<BulkPriceFormValues>,
    onCancel?: () => void,
  ) => (
    <QuickPriceWorkspace
      t={t}
      form={targetForm}
      countryGroups={visibleBulkCountryGroups}
      countrySearch={bulkCountrySearch}
      countryPage={quickPriceSummaryQuery.data?.page ?? bulkCountryPage}
      countryPageSize={quickPriceSummaryQuery.data?.pageSize ?? QUICK_PRICE_SELECTOR_PAGE_SIZE}
      countryTotal={quickPriceSummaryQuery.data?.total ?? 0}
      countryLoading={quickPriceSummaryQuery.isFetching}
      selectedCountry={selectedBulkCountry}
      regionGroups={bulkRegionGroups}
      regionPage={quickPriceGroupsQuery.data?.page ?? bulkRegionPage}
      regionPageSize={quickPriceGroupsQuery.data?.pageSize ?? QUICK_PRICE_SELECTOR_PAGE_SIZE}
      regionTotal={quickPriceGroupsQuery.data?.total ?? 0}
      regionLoading={quickPriceGroupsQuery.isFetching}
      selectedRegion={selectedBulkRegion}
      selectedRegionTitle={selectedBulkRegionTitle}
      providerLabel={providerFilter ? formatProviderLabel(providerFilter) : t('resources.allProviders')}
      selectedCount={quickPriceSelectedCount}
      pricedCount={quickPricePricedCount}
      costSummary={quickPriceCostSummary}
      saving={saveBulkPriceMutation.isPending}
      unlistingRegionKey={unlistBulkRegionMutation.isPending ? unlistBulkRegionMutation.variables?.key ?? null : null}
      onCountrySearchChange={(value) => {
        setBulkCountrySearch(value);
        setBulkCountryKey(null);
        setBulkRegionKey(null);
        setBulkCountryPage(1);
        setBulkRegionPage(1);
      }}
      onCountryPageChange={(nextPage) => {
        setBulkCountryKey(null);
        setBulkRegionKey(null);
        setBulkCountryPage(nextPage);
        setBulkRegionPage(1);
      }}
      onCountrySelect={selectBulkCountry}
      onRegionPageChange={setBulkRegionPage}
      onRegionSelect={selectBulkRegion}
      onRegionUnlist={(group) => unlistBulkRegionMutation.mutate(group)}
      onFinish={(values) => saveBulkPriceMutation.mutate(values)}
      onSubmit={() => targetForm.submit()}
      onCancel={onCancel}
    />
  );

  const toolbar = (
    <Card className="ipx-resource-toolbar-card" variant="borderless" style={surfaceCardStyle({ marginBottom: 12 })} styles={{ body: { padding: 14 } }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshResourceData}
              loading={quickPriceSummaryQuery.isFetching || quickPriceGroupsQuery.isFetching || (showResourceDetails && query.isFetching)}
            >
              {t('refresh')}
            </Button>
            <Button onClick={openBulkPrice}>
              {t('resources.bulkPriceTitle')}
            </Button>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('resources.providerFilter')}
              style={{ width: 190 }}
              value={providerFilter ?? ''}
              onChange={changeProviderFilter}
              options={providerFilterOptions}
            />
          </Space>
        </div>
        <Space size={8} wrap>
          <Tag color={providerFilter ? 'blue' : undefined}>
            {providerFilter ? formatProviderLabel(providerFilter) : t('resources.allProviders')}
          </Tag>
          <Tag color="blue">{t('resources.quickPriceCountries', { count: quickPriceSummaryQuery.data?.total ?? 0 })}</Tag>
          <Tag>{t('resources.quickPriceTotalResources', { count: quickPriceSummaryQuery.data?.totalResources ?? 0 })}</Tag>
        </Space>
      </Space>
    </Card>
  );

  const quickPricePanel = (
    <Card className="ipx-resource-quick-price-card" variant="borderless" style={surfaceCardStyle({ marginBottom: 12 })} styles={{ body: { padding: 16 } }}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space align="center" size={10}>
            <span style={{ width: 4, height: 22, borderRadius: 999, background: '#1558ff', display: 'inline-block' }} />
            <Space direction="vertical" size={0}>
              <Typography.Text strong style={{ fontSize: 16, color: '#111827' }}>{t('resources.quickPriceTitle')}</Typography.Text>
            </Space>
          </Space>
          <Space size={8} wrap>
            <Tag color="blue">{t('resources.quickPriceCountries', { count: quickPriceSummaryQuery.data?.total ?? 0 })}</Tag>
            <Tag>{t('resources.quickPriceTotalResources', { count: quickPriceSummaryQuery.data?.totalResources ?? 0 })}</Tag>
            {quickPriceSummaryQuery.isFetching || quickPriceGroupsQuery.isFetching ? (
              <Tag color="processing">{t('resources.quickPriceLoading')}</Tag>
            ) : null}
          </Space>
        </div>
        {quickPriceSummaryQuery.isLoading ? (
          <Alert
            type="info"
            showIcon
            message={t('resources.quickPriceLoading')}
          />
        ) : quickPriceSummaryQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={t('resources.quickPriceLoadFailed')}
            description={formatResourceFailure(quickPriceSummaryQuery.error, t)}
          />
        ) : visibleBulkCountryGroups.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={t('resources.quickPriceEmpty')}
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {quickPriceGroupsQuery.isError && (
              <Alert
                type="error"
                showIcon
                message={t('resources.quickPriceLoadFailed')}
                description={formatResourceFailure(quickPriceGroupsQuery.error, t)}
              />
            )}
            {renderQuickPriceWorkspace(quickPriceForm)}
          </Space>
        )}
      </Space>
    </Card>
  );

  const resourceDetailsPanel = (
    <Card className="ipx-resource-detail-toggle-card" variant="borderless" style={surfaceCardStyle({ marginBottom: 12 })} styles={{ body: { padding: 14 } }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space size={8} wrap>
            <Typography.Text strong>{t('resources.detailResourcesTitle')}</Typography.Text>
            <Tag color={providerFilter ? 'blue' : undefined}>
              {providerFilter ? formatProviderLabel(providerFilter) : t('resources.allProviders')}
            </Tag>
            {showResourceDetails ? <Tag color="blue">{t('resources.summary.total', { total: query.data?.total ?? 0 })}</Tag> : null}
          </Space>
          <Button
            onClick={() => setShowResourceDetails((value) => !value)}
            loading={showResourceDetails && query.isFetching}
          >
            {showResourceDetails ? t('resources.hideDetailResources') : t('resources.showDetailResources')}
          </Button>
        </div>
        {showResourceDetails ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Input.Search
                placeholder={t('resources.searchPlaceholder')}
                onSearch={(v) => { setSearch(v.trim()); setPage(1); }}
                onChange={(event) => {
                  if (!event.target.value) {
                    setSearch('');
                    setPage(1);
                  }
                }}
                allowClear
                style={{ width: 260 }}
              />
              <Select
                placeholder={t('resources.statusFilter')}
                allowClear
                style={{ width: 170 }}
                value={status}
                onChange={(v) => { setStatus(v || undefined); setPage(1); }}
                options={[
                  { value: '', label: t('resources.allStatus') },
                  ...resourceStatusOptionsZh(),
                ]}
              />
            </Space>
            <Space size={8} wrap>
              {status ? <Tag color="processing">{t('resources.summary.statusFilter', { status: formatResourceStatusZh(status) })}</Tag> : null}
              {search ? <Tag>{t('resources.summary.keywordFilter', { keyword: search })}</Tag> : null}
              {status === 'ACTIVE' ? <Tag color="green">{t('resources.summary.activeDefault')}</Tag> : null}
              {status && status !== 'ACTIVE' ? <Tag color="orange">{t('resources.summary.archivedView')}</Tag> : null}
              <Tag>
                {t('resources.summary.groupedCurrentPage', {
                  groups: groupedVisibleItems.length,
                  resources: visibleItems.length,
                })}
              </Tag>
            </Space>
          </Space>
        ) : null}
      </Space>
    </Card>
  );

  return (
    <div className="ipx-resource-page">
      <PageHeader title={t('resources.title')} />
      {syncFeedback && (
        <Alert
          type={syncFeedback.type === 'success' ? getSyncResultAlertType(syncFeedback.result) : 'error'}
          showIcon
          closable
          onClose={() => setSyncFeedback(null)}
          style={{ marginBottom: 12, borderRadius: 8 }}
          message={(
            <Space size={8} wrap>
              <Typography.Text strong>
                {syncFeedback.type === 'success'
                  ? (isNoWriteSyncResult(syncFeedback.result) ? t('resources.syncIssueTitle') : t('resources.syncResultTitle'))
                  : t('resources.syncFailedTitle')}
              </Typography.Text>
              <Tag color={syncFeedback.type === 'success' ? (isNoWriteSyncResult(syncFeedback.result) ? 'orange' : 'green') : 'red'}>
                {syncFeedback.resourceName}
              </Tag>
              {syncFeedback.type === 'success' && isNoWriteSyncResult(syncFeedback.result) ? (
                <Tag color="orange">{t('resources.syncZeroWriteWarning')}</Tag>
              ) : null}
            </Space>
          )}
          description={syncFeedback.type === 'success'
            ? (
              <Space direction="vertical" size={8}>
                <Space size={[8, 8]} wrap>
                  <Tag>{t('resources.syncAttempted', { count: syncFeedback.result.attempted })}</Tag>
                  <Tag color="green">{t('resources.syncCreated', { count: syncFeedback.result.created })}</Tag>
                  <Tag color="blue">{t('resources.syncUpdated', { count: syncFeedback.result.updated })}</Tag>
                  <Tag color="orange">{t('resources.syncSkipped', { count: syncFeedback.result.skipped })}</Tag>
                  <Tag color={syncFeedback.result.failed > 0 ? 'red' : undefined}>
                    {t('resources.syncFailed', { count: syncFeedback.result.failed })}
                  </Tag>
                  <Tag color={syncFeedback.result.synced > 0 ? 'green' : 'orange'}>{t('providers.resourceSynced')}: {syncFeedback.result.synced}</Tag>
                  <Tag>{formatDateTime(syncFeedback.result.syncedAt)}</Tag>
                  <Tag>{formatUpstreamRawStatus(syncFeedback.result.upstreamRawStatus, t)}</Tag>
                  <Typography.Text type="secondary">
                    {t('resources.syncCountries', {
                      countries: formatSyncCountries(syncFeedback.result.countries),
                    })}
                  </Typography.Text>
                </Space>
              </Space>
            )
            : (
              <Space direction="vertical" size={4}>
                <Typography.Text type="danger" strong>
                  {formatResourceFailure(syncFeedback.reasonKey, t)}
                </Typography.Text>
              </Space>
            )}
        />
      )}
      {showResourceDetails && query.isFetching && !query.isLoading && (
        <Alert
          type="info"
          showIcon
          message={t('resources.refreshing')}
          style={{ marginBottom: 12, borderRadius: 8 }}
        />
      )}
      {toolbar}
      {quickPricePanel}
      {resourceDetailsPanel}
      {showResourceDetails ? (
        <ListPage
          query={groupedQuery}
          columns={columns}
          rowKey="id"
          rowClassName={resourceDetailRowClassName}
          pagination={{
            page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      ) : null}
      <Modal
        className="ipx-resource-form-modal"
        title={(
          <Space align="start" size={12}>
            <span
              style={{
                width: 4,
                height: 20,
                marginTop: 2,
                borderRadius: 999,
                background: '#003afe',
                display: 'inline-block',
              }}
            />
            <span>
              <Typography.Text strong style={{ fontSize: 18, display: 'block', color: '#101010' }}>
                {t('resources.saleSettings')}
              </Typography.Text>
            </span>
          </Space>
        )}
        open={formOpen}
        onCancel={closeForm}
        footer={null}
        width={760}
        styles={{ body: { paddingTop: 12, paddingBottom: 0 } }}
        >
        {saveMutation.error && (
          <Alert
            type="error"
            message={t('error')}
            description={formatResourceFailure(saveMutation.error, t)}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (!Object.prototype.hasOwnProperty.call(changed, 'isSaleable')) return;
            if (changed.isSaleable === true) {
              form.setFieldValue('unsaleableReason', null);
              return;
            }
            if (!form.getFieldValue('unsaleableReason')) {
              form.setFieldValue('unsaleableReason', DEFAULT_UNSALEABLE_REASON);
            }
          }}
          onFinish={(values: ResourceFormValues) => saveMutation.mutate(values)}
        >
          {editingResource ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('resources.saleSettingsSourceTitle')}
              description={(
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Typography.Text strong>{formatResourceLocationForLanguage(editingResource, currentLanguage).title}</Typography.Text>
                  <Space size={6} wrap>
                    <Tag color="blue">{formatProviderLabel(editingResource.providerCode)}</Tag>
                    <Tag>{formatIpTypeZh(editingResource.ipType)}</Tag>
                    <Tag>{formatProtocolZh(editingResource.protocol)}</Tag>
                    <Tag>{formatResourceStatusZh(editingResource.status)}</Tag>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: editingResource.code }}>
                    {t('resources.resourceTrace')}: {formatResourceTraceLabel(editingResource)}
                  </Typography.Text>
                </Space>
              )}
            />
          ) : null}

          <div
            style={{
              background: '#f7f7f7',
              border: '1px solid #ebebeb',
              borderRadius: 8,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <Typography.Text strong style={{ display: 'block', marginBottom: 14 }}>
              {t('resources.salesSection')}
            </Typography.Text>
            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Form.Item name="isSaleable" label={t('resources.isSaleable')} valuePropName="checked">
                  <Switch
                    checkedChildren={t('resources.saleable')}
                    unCheckedChildren={t('resources.unsaleable')}
                  />
                </Form.Item>
              </Col>
              {formSaleableValue === false ? (
                <Col xs={24} md={16}>
                  <Form.Item
                    name="unsaleableReason"
                    label={t('resources.unsaleableReason')}
                    rules={[{ required: true, message: t('resources.unsaleableReasonRequired') }]}
                  >
                    <Select
                      size="large"
                      options={[
                        {
                          value: DEFAULT_UNSALEABLE_REASON,
                          label: t(`resources.unsaleableReasons.${DEFAULT_UNSALEABLE_REASON}`),
                        },
                        {
                          value: 'not_saleable',
                          label: t('resources.unsaleableReasons.not_saleable'),
                        },
                        {
                          value: 'price_missing',
                          label: t('resources.unsaleableReasons.price_missing'),
                        },
                      ]}
                    />
                  </Form.Item>
                </Col>
              ) : null}
            </Row>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
              padding: '14px 0 16px',
              borderTop: '1px solid #ebebeb',
            }}
          >
            <Button onClick={closeForm}>{t('resources.cancel')}</Button>
            <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>
              {t('resources.saveSaleSettings')}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        className="ipx-resource-price-modal"
        title={(
          <Space align="start" size={12}>
            <span
              style={{
                width: 4,
                height: 20,
                marginTop: 2,
                borderRadius: 999,
                background: '#003afe',
                display: 'inline-block',
              }}
            />
            <span>
              <Typography.Text strong style={{ fontSize: 18, display: 'block', color: '#101010' }}>
                {t('resources.modifyPrice')}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {pricingResource ? formatResourceLocationForLanguage(pricingResource, currentLanguage).title : t('resources.resourcePrice')}
              </Typography.Text>
            </span>
          </Space>
        )}
        open={priceOpen}
        onCancel={closePrice}
        footer={null}
        width={520}
        styles={{ body: { paddingTop: 12, paddingBottom: 0 } }}
      >
        {savePriceMutation.error && (
          <Alert
            type="error"
            message={t('error')}
            description={formatResourceFailure(savePriceMutation.error, t)}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        {pricingResource ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('resources.priceCostSummary')}
            description={(
              <Space size={8} wrap>
                <Tag>{t('resources.resourceCost')}: {formatMoneyAmount(pricingResource.upstreamCost ?? null, pricingResource.upstreamCostCurrency ?? pricingResource.priceCurrency ?? 'CNY') ?? t('resources.resourceCostMissing')}</Tag>
                <Tag>{t('resources.resourcePrice')}: {formatMoneyAmount(pricingResource.unitPrice ?? null, pricingResource.priceCurrency ?? 'CNY') ?? '-'}</Tag>
              </Space>
            )}
          />
        ) : null}
        <Form<PriceFormValues>
          form={priceForm}
          layout="vertical"
          onFinish={(values) => savePriceMutation.mutate(values)}
        >
          <Row gutter={12}>
            <Col xs={24} md={14}>
              <Form.Item
                name="unitPrice"
                label={t('resources.resourcePrice')}
                rules={[{ required: true, message: t('resources.resourcePricePlaceholder') }]}
              >
                <InputNumber min={0} precision={2} size="large" style={{ width: '100%' }} placeholder={t('resources.resourcePricePlaceholder')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item
                name="currency"
                label={t('resources.currency')}
                rules={[{ required: true }]}
              >
                <Select
                  size="large"
                  options={[
                    { value: 'CNY', label: 'CNY' },
                    { value: 'USD', label: 'USD' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
              padding: '14px 0 16px',
              borderTop: '1px solid #ebebeb',
            }}
          >
            <Button onClick={closePrice}>{t('resources.cancel')}</Button>
            <Button type="primary" loading={savePriceMutation.isPending} onClick={() => priceForm.submit()}>
              {t('resources.resourceSavePrice')}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        className="ipx-resource-price-modal"
        title={(
          <Space align="start" size={12}>
            <span
              style={{
                width: 4,
                height: 20,
                marginTop: 2,
                borderRadius: 999,
                background: '#003afe',
                display: 'inline-block',
              }}
            />
            <span>
              <Typography.Text strong style={{ fontSize: 18, display: 'block', color: '#101010' }}>
                {t('resources.bulkPriceTitle')}
              </Typography.Text>
            </span>
          </Space>
        )}
        open={bulkPriceOpen}
        onCancel={closeBulkPrice}
        footer={null}
        width={1180}
        styles={{ body: { paddingTop: 12, paddingBottom: 0 } }}
      >
        {saveBulkPriceMutation.error && (
          <Alert
            type="error"
            message={t('error')}
            description={formatResourceFailure(saveBulkPriceMutation.error, t)}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        {quickPriceSummaryQuery.isLoading ? (
          <Alert
            type="info"
            showIcon
            message={t('resources.quickPriceLoading')}
            style={{ marginTop: 16 }}
          />
        ) : quickPriceSummaryQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={t('resources.quickPriceLoadFailed')}
            description={formatResourceFailure(quickPriceSummaryQuery.error, t)}
            style={{ marginTop: 16 }}
          />
        ) : visibleBulkCountryGroups.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={t('resources.quickPriceEmpty')}
            style={{ marginTop: 16 }}
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
            {quickPriceGroupsQuery.isError && (
              <Alert
                type="error"
                showIcon
                message={t('resources.quickPriceLoadFailed')}
                description={formatResourceFailure(quickPriceGroupsQuery.error, t)}
                style={{ marginBottom: 12 }}
              />
            )}
            {renderQuickPriceWorkspace(bulkPriceForm, closeBulkPrice)}
          </Space>
        )}
      </Modal>
    </div>
  );
}

function QuickPriceWorkspace({
  t,
  form,
  countryGroups,
  countrySearch,
  countryPage,
  countryPageSize,
  countryTotal,
  countryLoading,
  selectedCountry,
  regionGroups,
  regionPage,
  regionPageSize,
  regionTotal,
  regionLoading,
  selectedRegion,
  selectedRegionTitle,
  providerLabel,
  selectedCount,
  pricedCount,
  costSummary,
  saving,
  unlistingRegionKey,
  onCountrySearchChange,
  onCountryPageChange,
  onCountrySelect,
  onRegionPageChange,
  onRegionSelect,
  onRegionUnlist,
  onFinish,
  onSubmit,
  onCancel,
}: QuickPriceWorkspaceProps) {
  const selectedCountryCode = selectedRegion?.countryCode || selectedCountry?.countryCode || '';
  const costLabel = costSummary?.label ?? t('resources.resourceCostMissing');
  const selectedPriceSummary = selectedRegion ? summarizeBulkRegionPrice(selectedRegion, t) : null;
  const configuredRegionGroups = [
    ...(selectedRegion ? [selectedRegion] : []),
    ...regionGroups.filter((group) => isBulkRegionPriced(group) && group.key !== selectedRegion?.key),
  ];
  const configuredResourceCount = configuredRegionGroups.reduce((sum, group) => sum + getBulkRegionResourceCount(group), 0);
  const availableTitle = selectedCountry
    ? t('resources.quickPriceProductTitle')
    : t('resources.quickPriceProductTitleIdle');
  return (
    <div className="ipx-static-purchase-page">
      <Row className="ipx-buy-layout" gutter={[20, 20]} align="top">
        <Col xs={24} xl={16} xxl={17} className="ipx-purchase-main-col">
          <Space className="ipx-buy-selector-stack" direction="vertical" size={16} style={{ width: '100%' }}>
            <section className="ipx-buy-panel ipx-buy-region-panel">
              <div className="ipx-buy-panel-head">
                <div className="ipx-buy-title-row">
                  <Typography.Title level={4}>{t('resources.bulkCountry')}</Typography.Title>
                  <Input.Search
                    className="ipx-buy-region-search"
                    allowClear
                    enterButton={t('customer.buy.searchRegion')}
                    value={countrySearch}
                    placeholder={t('resources.bulkCountrySearchPlaceholder')}
                    onChange={(event) => onCountrySearchChange(event.target.value)}
                    onSearch={onCountrySearchChange}
                  />
                </div>
                <Space size={8} wrap className="ipx-buy-header-meta">
                  <Tag>{t('resources.quickPriceCountries', { count: countryTotal })}</Tag>
                  {countryLoading ? <Tag color="processing">{t('resources.quickPriceLoading')}</Tag> : null}
                </Space>
              </div>
              {countryGroups.length === 0 ? (
                <Alert type="info" showIcon message={t('resources.bulkCountrySearchEmpty')} />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div className="ipx-buy-card-grid ipx-buy-region-grid">
                    {countryGroups.map((group, index) => (
                      <QuickPriceOptionCard
                        key={`country:${group.key || group.countryCode}:${index}`}
                        active={selectedCountry?.key === group.key}
                        icon={countryFlagEmoji(group.countryCode)}
                        title={group.label}
                        subtitle={t('resources.quickPriceCountryOption', {
                          regions: group.regionCount ?? group.regions.length,
                          resources: group.resourceCount ?? group.resources.length,
                        })}
                        onClick={() => onCountrySelect(group)}
                      />
                    ))}
                  </div>
                  {countryTotal > countryPageSize ? (
                    <Pagination
                      size="small"
                      current={countryPage}
                      pageSize={countryPageSize}
                      total={countryTotal}
                      showSizeChanger={false}
                      onChange={onCountryPageChange}
                    />
                  ) : null}
                </Space>
              )}
            </section>

            <section className="ipx-buy-panel">
              <div className="ipx-buy-section-head">
                <Typography.Title level={4}>{availableTitle}</Typography.Title>
                <Space size={8} wrap>
                  {selectedCountry ? <Typography.Text type="secondary">{selectedCountry.label}</Typography.Text> : null}
                  <Tag>
                    {t('resources.quickPriceRegionCount', {
                      regions: regionGroups.length,
                      resources: selectedCountry?.resourceCount ?? selectedCountry?.resources.length ?? 0,
                    })}
                  </Tag>
                  <Tag>{providerLabel}</Tag>
                  {regionLoading ? <Tag color="processing">{t('resources.quickPriceLoading')}</Tag> : null}
                </Space>
              </div>
              {regionLoading && regionGroups.length === 0 ? (
                <Alert type="info" showIcon message={t('resources.quickPriceLoading')} />
              ) : regionGroups.length === 0 ? (
                <Alert type="info" showIcon message={t('resources.bulkRegionEmpty')} />
              ) : (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <div className="ipx-buy-card-grid ipx-buy-line-grid" style={adminQuickPriceRegionGridStyle}>
                    {regionGroups.map((group, index) => {
                      const costs = summarizeBulkRegionCost(group, t);
                      const title = getBulkRegionDisplayLabel(group, t);
                      const isAlreadySelectedOrPriced = selectedRegion?.key === group.key || isBulkRegionPriced(group);
                      return (
                        <QuickPriceOptionCard
                          key={`region:${group.key || group.regionKey || group.label}:${index}`}
                          active={selectedRegion?.key === group.key}
                          muted={isAlreadySelectedOrPriced}
                          title={title}
                          subtitle={t('resources.quickPriceRegionOption', {
                            resources: group.resourceCount ?? group.resources.length,
                            cost: costs.label,
                          })}
                          onClick={() => onRegionSelect(group)}
                        />
                      );
                    })}
                  </div>

                  {regionTotal > regionPageSize ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Pagination
                        size="small"
                        current={regionPage}
                        pageSize={regionPageSize}
                        total={regionTotal}
                        showSizeChanger={false}
                        onChange={onRegionPageChange}
                      />
                    </div>
                  ) : null}
                </Space>
              )}

              <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid #e4e8f1' }}>
                <div className="ipx-buy-section-head">
                  <Typography.Title level={4}>{t('resources.quickPriceSelectedTitle')}</Typography.Title>
                  <Tag>
                    {t('resources.quickPriceRegionCount', {
                      regions: configuredRegionGroups.length,
                      resources: configuredResourceCount,
                    })}
                  </Tag>
                </div>
                {configuredRegionGroups.length === 0 ? (
                  <Alert type="info" showIcon message={t('resources.quickPriceSelectedEmpty')} />
                ) : (
                  <div className="ipx-buy-card-grid" style={adminQuickPriceConfiguredGridStyle}>
                    {configuredRegionGroups.map((group, index) => {
                      const costs = summarizeBulkRegionCost(group, t);
                      const price = summarizeBulkRegionPrice(group, t);
                      const title = getBulkRegionDisplayLabel(group, t);
                      return (
                        <QuickPriceConfiguredCard
                          key={`configured:${group.key || group.regionKey || group.label}:${index}`}
                          active={selectedRegion?.key === group.key}
                          title={title}
                          subtitle={t('resources.quickPriceSelectedOption', {
                            resources: getBulkRegionResourceCount(group),
                            cost: costs.label,
                            price: price.label,
                          })}
                          editLabel={t('resources.modifyPrice')}
                          unlistLabel={t('resources.quickPriceUnlist')}
                          unlisting={unlistingRegionKey === group.key}
                          onEdit={() => onRegionSelect(group)}
                          onUnlist={onRegionUnlist ? () => onRegionUnlist(group) : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </Space>
        </Col>

        <Col xs={24} xl={8} xxl={7} className="ipx-order-panel-col">
          <Card
            variant="borderless"
            className={selectedRegion ? 'ipx-order-panel ipx-order-panel-ready' : 'ipx-order-panel'}
            style={{
              border: '1px solid #d8e3ff',
              borderRadius: 8,
              boxShadow: 'none',
              background: selectedRegion ? 'linear-gradient(180deg, #ffffff 0%, #f5f8ff 100%)' : '#ffffff',
            }}
            styles={{ body: { padding: 16 } }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space size={10} align="start">
                <span className="ipx-selected-resource-flag">{countryFlagEmoji(selectedCountryCode)}</span>
                <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                  <Typography.Title level={4} style={{ margin: 0, fontSize: 17 }}>
                    {t('resources.quickAutoSelectTitle')}
                  </Typography.Title>
                  <Typography.Text type="secondary" ellipsis={{ tooltip: selectedRegionTitle }}>
                    {selectedRegionTitle}
                  </Typography.Text>
                </Space>
              </Space>

              <div className="ipx-buy-auto-panel">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space size={6} wrap>
                    <Tag color="geekblue">{t('resources.bulkResourceCount', { count: selectedCount })}</Tag>
                    <Tag color={pricedCount > 0 ? 'green' : 'orange'}>{t('resources.resourcePricedCount', { count: pricedCount })}</Tag>
                    <Tag color={costSummary?.hasCost ? 'cyan' : 'default'}>
                      {t('resources.resourceCost')}: {costLabel}
                    </Tag>
                    {selectedPriceSummary ? (
                      <Tag color={selectedPriceSummary.hasPrice ? 'green' : 'orange'}>
                        {t('resources.resourcePrice')}: {selectedPriceSummary.label}
                      </Tag>
                    ) : null}
                  </Space>
                </Space>
              </div>

              <Form<BulkPriceFormValues>
                form={form}
                layout="vertical"
                initialValues={{ unitPrice: null, currency: 'CNY' }}
                onFinish={onFinish}
              >
                <Form.Item
                  name="unitPrice"
                  label={t('resources.resourcePrice')}
                  rules={[{ required: true, message: t('resources.resourcePricePlaceholder') }]}
                >
                  <InputNumber
                    min={0}
                    precision={2}
                    size="large"
                    style={{ width: '100%' }}
                    placeholder={t('resources.resourcePricePlaceholder')}
                  />
                </Form.Item>
                <Form.Item name="currency" label={t('resources.currency')} rules={[{ required: true }]}>
                  <Select
                    size="large"
                    options={[
                      { value: 'CNY', label: 'CNY' },
                      { value: 'USD', label: 'USD' },
                    ]}
                  />
                </Form.Item>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={saving}
                    disabled={selectedCount === 0}
                    onClick={onSubmit}
                  >
                    {t('resources.quickSavePrice', { count: selectedCount })}
                  </Button>
                  {onCancel ? <Button block onClick={onCancel}>{t('resources.cancel')}</Button> : null}
                </Space>
              </Form>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

const adminQuickPriceRegionGridStyle: React.CSSProperties = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const adminQuickPriceConfiguredGridStyle: React.CSSProperties = {
  gridTemplateColumns: '1fr',
  gap: 10,
};

const quickPriceOptionTitleStyle: React.CSSProperties = {
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
};

const quickPriceOptionSubtitleStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
};

function QuickPriceConfiguredCard({
  active,
  title,
  subtitle,
  editLabel,
  unlistLabel,
  unlisting,
  onEdit,
  onUnlist,
}: {
  active: boolean;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  editLabel: string;
  unlistLabel: string;
  unlisting?: boolean;
  onEdit: () => void;
  onUnlist?: () => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onEdit();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'ipx-buy-option-card',
        active ? 'ipx-buy-option-card-active' : '',
      ].filter(Boolean).join(' ')}
      aria-pressed={active}
      onClick={onEdit}
      onKeyDown={onKeyDown}
    >
      <span className="ipx-buy-option-copy">
        <Typography.Text strong ellipsis={{ tooltip: String(title) }} style={quickPriceOptionTitleStyle}>
          {title}
        </Typography.Text>
        <Typography.Text type="secondary" style={quickPriceOptionSubtitleStyle}>{subtitle}</Typography.Text>
      </span>
      <Space size={6} wrap onClick={(event) => event.stopPropagation()}>
        <Button size="small" onClick={onEdit}>{editLabel}</Button>
        {onUnlist ? (
          <Button size="small" danger loading={unlisting} onClick={onUnlist}>
            {unlistLabel}
          </Button>
        ) : null}
      </Space>
    </div>
  );
}

function QuickPriceOptionCard({
  active,
  muted,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  muted?: boolean;
  icon?: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        'ipx-buy-option-card',
        active ? 'ipx-buy-option-card-active' : '',
        muted ? 'ipx-buy-option-card-muted' : '',
      ].filter(Boolean).join(' ')}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon ? <span className="ipx-buy-option-icon">{icon}</span> : null}
      <span className="ipx-buy-option-copy">
        <Typography.Text strong ellipsis={{ tooltip: String(title) }} style={quickPriceOptionTitleStyle}>
          {title}
        </Typography.Text>
        <Typography.Text type="secondary" style={quickPriceOptionSubtitleStyle}>{subtitle}</Typography.Text>
      </span>
    </button>
  );
}

function countryFlagEmoji(countryCode?: string | null): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}

function formatResourceLocationForLanguage(
  resource: Parameters<typeof formatResourceLocationZh>[0],
  language?: string,
): ResourceLocationLabel {
  return isEnglishLanguage(language) ? formatResourceLocationEn(resource) : formatResourceLocationZh(resource);
}

function toQuickPriceCountryGroup(item: QuickPriceCountrySummary, language?: string): BulkPriceCountryGroup {
  const sample = makeCountrySampleResource(item.countryCode);
  return {
    key: item.countryCode,
    label: formatResourceLocationForLanguage(sample, language).country,
    countryCode: item.countryCode,
    resources: [],
    resourceCount: item.totalResources,
    pricedCount: item.pricedCount,
    regionCount: item.regionCount,
    regions: [],
  };
}

function toQuickPriceRegionGroup(item: QuickPriceGroupDto, language?: string): BulkPriceRegionGroup {
  const sampleResource = {
    ...item.sampleResource,
    unitPrice: item.unitPrice ?? item.sampleResource.unitPrice ?? null,
    priceCurrency: item.priceCurrency ?? item.sampleResource.priceCurrency ?? null,
    upstreamCost: item.upstreamCost ?? item.sampleResource.upstreamCost ?? null,
    upstreamCostCurrency: item.upstreamCostCurrency ?? item.sampleResource.upstreamCostCurrency ?? null,
  };
  const location = formatResourceLocationForLanguage(sampleResource, language);
  const label = item.autoSelect ? formatDefaultAutoSelectLabel(language) : getResourceRegionLabel(sampleResource, language);
  return {
    key: item.key,
    label,
    baseLabel: label,
    countryCode: item.countryCode,
    countryLabel: location.country,
    costKey: item.costGroupKey,
    resources: [sampleResource],
    resourceCount: item.resourceCount,
    pricedCount: item.pricedCount,
    unitPrice: item.unitPrice,
    priceCurrency: item.priceCurrency,
    upstreamCost: item.upstreamCost,
    upstreamCostCurrency: item.upstreamCostCurrency,
    sampleResource,
    autoSelect: item.autoSelect,
    regionKey: item.regionKey,
    selectors: [{
      regionKey: item.regionKey,
      costGroupKey: item.costGroupKey,
      autoSelect: item.autoSelect,
    }],
  };
}

function makeCountrySampleResource(countryCode: string): ResourceDto {
  return {
    id: countryCode,
    parentId: null,
    type: 'REGION',
    code: countryCode,
    name: countryCode,
    displayName: null,
    providerCode: 'IPIPD',
    ipType: 'NATIVE',
    protocol: 'BOTH',
    status: 'ACTIVE',
    sortOrder: 0,
    isVisible: true,
    isSaleable: true,
    unsaleableReason: null,
    countryCode,
    upstreamResourceId: null,
    stock: null,
    unitPrice: null,
    priceCurrency: null,
    upstreamCost: null,
    upstreamCostCurrency: null,
  };
}

export function groupResourcesForBulkPricing(resources: ResourceDto[], language?: string): BulkPriceCountryGroup[] {
  const countries = new Map<string, BulkPriceCountryGroup>();
  for (const resource of resources) {
    const countryCode = (resource.countryCode || resource.code.split(':')[0] || resource.code).slice(0, 2).toUpperCase();
    const location = formatResourceLocationForLanguage(resource, language);
    const countryKey = countryCode || location.country;
    let country = countries.get(countryKey);
    if (!country) {
      country = {
        key: countryKey,
        label: location.country,
        countryCode,
        resources: [],
        regions: [],
      };
      countries.set(countryKey, country);
    }
    country.resources.push(resource);

    const regionLabel = getResourceRegionLabel(resource, language);
    const costKey = getBulkPriceCostGroupKey(resource);
    const regionKey = `${countryKey}:${regionLabel}:${costKey}`;
    let region = country.regions.find((item) => item.key === regionKey);
    if (!region) {
      region = {
        key: regionKey,
        label: regionLabel,
        baseLabel: regionLabel,
        countryCode,
        countryLabel: location.country,
        costKey,
        resources: [],
      };
      country.regions.push(region);
    }
    region.resources.push(resource);
  }
  return [...countries.values()]
    .map((country) => normalizeBulkPriceCountryRegions(country, language))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

export function groupResourcesForAdminResourceList(resources: ResourceDto[], language?: string): ResourceGroupRow[] {
  const groups = new Map<string, ResourceGroupRow>();
  for (const resource of [...resources].sort(compareResourceRows)) {
    const countryCode = getResourceCountryCode(resource);
    const location = formatResourceLocationForLanguage(resource, language);
    const costKey = getBulkPriceCostGroupKey(resource);
    const key = [
      resource.providerCode,
      countryCode,
      costKey,
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.resources.push(resource);
      continue;
    }

    groups.set(key, {
      id: key,
      countryCode,
      countryLabel: location.country,
      regionLabel: getResourceRegionLabel(resource, language),
      providerCode: resource.providerCode,
      costKey,
      resources: [resource],
      sampleResource: resource,
    });
  }

  return [...groups.values()].sort((left, right) => {
    const locationCompare = left.countryLabel.localeCompare(right.countryLabel, 'zh-CN');
    if (locationCompare !== 0) return locationCompare;
    const providerCompare = formatProviderLabel(left.providerCode).localeCompare(formatProviderLabel(right.providerCode), 'zh-CN');
    if (providerCompare !== 0) return providerCompare;
    const costCompare = compareBulkPriceRegionCost(toResourceGroupRegion(left), toResourceGroupRegion(right));
    if (costCompare !== 0) return costCompare;
    return left.regionLabel.localeCompare(right.regionLabel, 'zh-CN');
  });
}

function compareResourceRows(left: ResourceDto, right: ResourceDto): number {
  const sortCompare = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  if (sortCompare !== 0) return sortCompare;
  return left.id.localeCompare(right.id);
}

function getResourceCountryCode(resource: ResourceDto): string {
  return (resource.countryCode || resource.code.split(':')[0] || resource.code).slice(0, 2).toUpperCase();
}

function toResourceGroupRegion(row: ResourceGroupRow): BulkPriceRegionGroup {
  return {
    key: row.id,
    label: row.regionLabel,
    baseLabel: row.regionLabel,
    countryCode: row.countryCode,
    countryLabel: row.countryLabel,
    costKey: row.costKey,
    resources: row.resources,
    sampleResource: row.sampleResource,
  };
}

function getResourceGroupCount(row: ResourceGroupRow, predicate: (resource: ResourceDto) => boolean): number {
  return row.resources.filter(predicate).length;
}

function formatResourceGroupCount(
  row: ResourceGroupRow,
  predicate: (resource: ResourceDto) => boolean,
  label: string,
  t: Translate,
  emptyLabel?: string,
): string {
  const count = getResourceGroupCount(row, predicate);
  if (count === row.resources.length) return label;
  if (count === 0) return emptyLabel ?? t('resources.resourceGroupNone', { label });
  return t('resources.resourceGroupCountLabel', { label, count, total: row.resources.length });
}

function formatResourceGroupIpType(row: ResourceGroupRow, t: Translate): string {
  const values = [...new Set(row.resources.map((resource) => resource.ipType))];
  return values.length === 1 ? formatIpTypeZh(values[0]!) : t('resources.resourceGroupMixedIpType');
}

function formatResourceGroupProtocol(row: ResourceGroupRow, t: Translate): string {
  const values = [...new Set(row.resources.map((resource) => resource.protocol))];
  return values.length === 1 ? formatProtocolZh(values[0]!) : t('resources.resourceGroupMixedProtocol');
}

function formatResourceGroupRegionSummary(row: ResourceGroupRow, language?: string): string | null {
  const labels = row.resources
    .map((resource) => getResourceRegionLabel(resource, language).trim())
    .filter((label) => label.length > 0 && label !== row.countryLabel);
  const uniqueLabels = [...new Set(labels)];
  return uniqueLabels.length > 0 ? uniqueLabels.join('、') : null;
}

function normalizeBulkPriceCountryRegions(country: BulkPriceCountryGroup, language?: string): BulkPriceCountryGroup {
  const sortedRegions = country.regions
    .map((region) => ({ ...region }))
    .sort(compareBulkPriceRegions);

  if (shouldCollapseCountryToAutoSelect(country, sortedRegions)) {
    const autoSelectLabel = formatDefaultAutoSelectLabel(language);
    return {
      ...country,
      regions: [{
        key: `${country.key}:${QUICK_PRICE_AUTO_REGION_KEY_SUFFIX}`,
        label: autoSelectLabel,
        baseLabel: autoSelectLabel,
        countryCode: country.countryCode,
        countryLabel: country.label,
        costKey: getBulkPriceCostGroupKey(country.resources[0]!),
        resources: [...country.resources],
        autoSelect: true,
      }],
    };
  }

  return {
    ...country,
    regions: labelCostSplitRegions(sortedRegions),
  };
}

function compareBulkPriceRegions(left: BulkPriceRegionGroup, right: BulkPriceRegionGroup): number {
  const labelCompare = `${left.countryLabel}-${left.baseLabel}`.localeCompare(`${right.countryLabel}-${right.baseLabel}`, 'zh-CN');
  if (labelCompare !== 0) return labelCompare;
  return compareBulkPriceRegionCost(left, right);
}

function compareBulkPriceRegionCost(left: BulkPriceRegionGroup, right: BulkPriceRegionGroup): number {
  const leftCost = getBulkPriceRegionCostSort(left);
  const rightCost = getBulkPriceRegionCostSort(right);
  if (leftCost.hasCost !== rightCost.hasCost) return leftCost.hasCost ? -1 : 1;
  const currencyCompare = leftCost.currency.localeCompare(rightCost.currency);
  if (currencyCompare !== 0) return currencyCompare;
  const amountCompare = leftCost.amount - rightCost.amount;
  if (amountCompare !== 0) return amountCompare;
  return left.key.localeCompare(right.key);
}

function getBulkPriceRegionCostSort(region: BulkPriceRegionGroup): { hasCost: boolean; currency: string; amount: number } {
  const resource = region.resources.find((item) => parseMoneyAmount(item.upstreamCost) !== null);
  if (!resource) return { hasCost: false, currency: '', amount: Number.POSITIVE_INFINITY };
  return {
    hasCost: true,
    currency: (resource.upstreamCostCurrency ?? resource.priceCurrency ?? 'CNY').trim().toUpperCase() || 'CNY',
    amount: parseMoneyAmount(resource.upstreamCost) ?? Number.POSITIVE_INFINITY,
  };
}

function labelCostSplitRegions(regions: BulkPriceRegionGroup[]): BulkPriceRegionGroup[] {
  return regions.map((region) => ({ ...region, label: region.baseLabel }));
}

function collapseBulkPriceRegionsByRegion(regions: BulkPriceRegionGroup[]): BulkPriceRegionGroup[] {
  const groups = new Map<string, BulkPriceRegionGroup>();
  for (const region of regions) {
    const key = getBulkPriceRegionCollapseKey(region);
    const selectors = getBulkRegionSaveSelectors(region);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...region,
        key,
        resources: [...region.resources],
        selectors,
      });
      continue;
    }

    existing.resources.push(...region.resources);
    existing.resourceCount = getBulkRegionResourceCount(existing) + getBulkRegionResourceCount(region);
    existing.pricedCount = getBulkRegionPricedCount(existing) + getBulkRegionPricedCount(region);
    existing.selectors = dedupeBulkRegionSelectors([...(existing.selectors ?? []), ...selectors]);
    existing.costKey = existing.selectors.length === 1 ? existing.selectors[0]!.costGroupKey : existing.costKey;
    const unitPrice = mergeMatchingScalar(existing.unitPrice, region.unitPrice);
    const upstreamCost = mergeMatchingScalar(existing.upstreamCost, region.upstreamCost);
    existing.unitPrice = unitPrice;
    existing.priceCurrency = unitPrice === undefined
      ? undefined
      : mergeMatchingScalar(existing.priceCurrency, region.priceCurrency);
    existing.upstreamCost = upstreamCost;
    existing.upstreamCostCurrency = upstreamCost === undefined
      ? undefined
      : mergeMatchingScalar(existing.upstreamCostCurrency, region.upstreamCostCurrency);
  }

  return [...groups.values()].sort(compareBulkPriceRegions);
}

function getBulkPriceRegionCollapseKey(region: BulkPriceRegionGroup): string {
  const regionKey = region.regionKey?.trim() || region.baseLabel.trim() || region.label.trim();
  return [
    region.autoSelect ? 'auto' : 'region',
    region.countryCode,
    regionKey,
  ].join('|');
}

function getBulkRegionResourceCount(region: BulkPriceRegionGroup): number {
  return region.resourceCount ?? region.resources.length;
}

function getBulkRegionPricedCount(region: BulkPriceRegionGroup): number {
  return region.pricedCount
    ?? region.resources.filter((resource) => parseMoneyAmount(resource.unitPrice ?? null) !== null).length;
}

function mergeMatchingScalar(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null | undefined {
  if (left === undefined || right === undefined) return undefined;
  return (left ?? null) === (right ?? null) ? left ?? null : undefined;
}

function getBulkRegionSaveSelectors(region: BulkPriceRegionGroup): BulkPriceRegionSelector[] {
  return dedupeBulkRegionSelectors(
    region.selectors?.length
      ? region.selectors
      : [{
          regionKey: region.regionKey,
          costGroupKey: region.costKey,
          autoSelect: region.autoSelect,
        }],
  );
}

function dedupeBulkRegionSelectors(selectors: BulkPriceRegionSelector[]): BulkPriceRegionSelector[] {
  const unique = new Map<string, BulkPriceRegionSelector>();
  for (const selector of selectors) {
    const key = [
      selector.autoSelect === true ? 'auto' : 'region',
      selector.regionKey ?? '',
      selector.costGroupKey,
    ].join('|');
    unique.set(key, selector);
  }
  return [...unique.values()];
}

function shouldCollapseCountryToAutoSelect(
  country: BulkPriceCountryGroup,
  regions: BulkPriceRegionGroup[],
): boolean {
  if (regions.length <= 1 || country.resources.length <= 1) return false;
  const costKeys = country.resources.map(getResourceCostKey);
  if (costKeys.some((key) => key === null)) return false;
  return new Set(costKeys).size === 1;
}

function getResourceCostKey(resource: ResourceDto): string | null {
  const amount = parseMoneyAmount(resource.upstreamCost);
  if (amount === null) return null;
  const currency = (resource.upstreamCostCurrency ?? resource.priceCurrency ?? 'CNY').trim() || 'CNY';
  return `${currency}:${amount}`;
}

function getBulkPriceCostGroupKey(resource: ResourceDto): string {
  return getResourceCostKey(resource) ?? 'cost-missing';
}

function isResourceCoveredByQuickPriceSelection(
  resource: ResourceDto,
  selectedCountry: BulkPriceCountryGroup | null,
  selectedRegion: BulkPriceRegionGroup | null,
  language?: string,
): boolean {
  if (!selectedCountry) return false;
  const countryCode = (resource.countryCode || resource.code.split(':')[0] || resource.code).slice(0, 2).toUpperCase();
  if (countryCode !== selectedCountry.countryCode) return false;
  if (!selectedRegion) return true;
  const selectors = getBulkRegionSaveSelectors(selectedRegion);
  if (selectedRegion.autoSelect || selectors.some((selector) => selector.autoSelect === true)) return true;
  if (!selectors.some((selector) => selector.costGroupKey === getBulkPriceCostGroupKey(resource))) return false;
  return getResourceRegionLabel(resource, language) === selectedRegion.baseLabel;
}

function getBulkRegionDisplayLabel(
  region: BulkPriceRegionGroup,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  return region.autoSelect ? t('resources.quickDefaultAutoSelectTitle') : region.label;
}

function isBulkRegionPriced(region: BulkPriceRegionGroup): boolean {
  if ((region.pricedCount ?? 0) > 0) return true;
  if (parseMoneyAmount(region.unitPrice ?? null) !== null) return true;
  return region.resources.some((resource) => parseMoneyAmount(resource.unitPrice ?? null) !== null);
}

function summarizeBulkRegionPrice(
  region: BulkPriceRegionGroup,
  t: (key: string, values?: Record<string, unknown>) => string,
): { label: string; hasPrice: boolean } {
  if (region.unitPrice !== undefined || region.priceCurrency !== undefined) {
    const amount = parseMoneyAmount(region.unitPrice ?? null);
    if (amount === null) return { label: t('resources.resourceUnpriced'), hasPrice: false };
    return {
      label: formatMoneyAmount(amount, region.priceCurrency ?? 'CNY') ?? String(amount),
      hasPrice: true,
    };
  }

  const knownPrices = region.resources
    .map((resource) => {
      const amount = parseMoneyAmount(resource.unitPrice ?? null);
      if (amount === null) return null;
      const currency = (resource.priceCurrency ?? 'CNY').trim().toUpperCase() || 'CNY';
      return {
        amount,
        currency,
        label: formatMoneyAmount(amount, currency) ?? `${amount} ${currency}`,
      };
    })
    .filter((price): price is { amount: number; currency: string; label: string } => price !== null);

  if (knownPrices.length === 0) return { label: t('resources.resourceUnpriced'), hasPrice: false };

  const currencies = [...new Set(knownPrices.map((price) => price.currency))];
  if (currencies.length === 1) {
    const currency = currencies[0]!;
    const amounts = [...new Set(knownPrices.map((price) => price.amount))].sort((left, right) => left - right);
    if (amounts.length === 1) return { label: knownPrices[0]!.label, hasPrice: true };
    return {
      label: t('resources.resourcePriceRange', {
        min: formatMoneyAmount(amounts[0]!, currency) ?? `${amounts[0]} ${currency}`,
        max: formatMoneyAmount(amounts[amounts.length - 1]!, currency) ?? `${amounts[amounts.length - 1]} ${currency}`,
      }),
      hasPrice: true,
    };
  }

  return {
    label: [...new Set(knownPrices.map((price) => price.label))].slice(0, 3).join(' / '),
    hasPrice: true,
  };
}

function getResourceRegionLabel(resource: ResourceDto, language?: string): string {
  const proxySeller = getProxySellerResourceProjection(resource, language);
  if (proxySeller) return proxySeller.regionLabel;
  const location = formatResourceLocationForLanguage(resource, language);
  const cidr = getResourceNetworkCidr(resource);
  const detailWithoutCidr = cidr && location.detail?.endsWith(`-${cidr}`)
    ? location.detail.slice(0, -cidr.length - 1)
    : location.detail;
  return location.city || detailWithoutCidr || location.country;
}

function getResourceNetworkCidr(resource: ResourceDto): string | null {
  const fromUpstream = parseIpipdUpstreamResource(resource.upstreamResourceId ?? null).cidr;
  if (fromUpstream) return fromUpstream;
  const source = [resource.code, resource.displayName, resource.name].filter(Boolean).join(' ');
  const match = source.match(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/);
  return match?.[0] ?? null;
}

function parseIpipdUpstreamResource(value?: string | null): { lineId: string | null; cidr: string | null } {
  const trimmed = value?.trim();
  if (!trimmed) return { lineId: null, cidr: null };
  const marker = '|cidr=';
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex < 0) return { lineId: trimmed || null, cidr: null };
  const lineId = trimmed.slice(0, markerIndex) || null;
  const encodedCidr = trimmed.slice(markerIndex + marker.length);
  if (!encodedCidr) return { lineId, cidr: null };
  try {
    return { lineId, cidr: decodeURIComponent(encodedCidr) };
  } catch {
    return { lineId, cidr: encodedCidr };
  }
}

function getProxySellerResourceProjection(resource: ResourceDto, language?: string): {
  regionLabel: string;
  networkKey: string;
  networkLabel: string;
} | null {
  if (resource.providerCode !== 'PR') return null;
  const countryCode = (resource.countryCode || resource.code.split(':')[0] || '').slice(0, 2).toUpperCase();
  const rawParts =
    parseProxySellerPathSegments(resource.upstreamResourceId, countryCode)
    ?? parseProxySellerPathSegments(resource.code, countryCode)
    ?? parseProxySellerPathSegments(resource.displayName, countryCode)
    ?? parseProxySellerPathSegments(resource.name, countryCode);
  if (!rawParts || rawParts.length === 0) return null;

  const location = formatResourceLocationForLanguage(resource, language);
  const parts = rawParts.map((part, index) => ({
    raw: part,
    label: localizeProxySellerPathPart(part, countryCode, index, language),
  }));
  const meaningfulParts = parts.filter((part) => !isProxySellerReferencePart(part.raw, part.label));
  if (meaningfulParts.length === 0) return null;
  const referencePart = [...parts].reverse().find((part) => isProxySellerReferencePart(part.raw, part.label));
  const regionParts = meaningfulParts.length >= 2 ? meaningfulParts.slice(0, -1) : meaningfulParts.slice(0, 1);
  const regionLabel = regionParts.map((part) => part.label).join('-') || location.country;
  const networkLabel = referencePart
    ? makeResourceReferenceLabel(referencePart.raw, language)
    : makeResourceReferenceLabel(resource.id, language);

  return {
    regionLabel,
    networkKey: resource.id,
    networkLabel,
  };
}

function isProxySellerReferencePart(raw: string, localizedLabel: string): boolean {
  const normalized = raw.trim();
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  const label = localizedLabel.trim();
  return label.startsWith('\u8d44\u6e90 ') || /^Resource\s+/i.test(label);
}

function parseProxySellerPathSegments(value?: string | null, countryCode?: string | null): string[] | null {
  const raw = value?.trim();
  if (!raw || !raw.includes(':')) return null;
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  const country = countryCode || parts[0]?.slice(0, 2).toUpperCase();
  if (!country || parts[0]?.toUpperCase() !== country) return null;
  const pathParts = parts.slice(1);
  if (pathParts.length > 1 && /^\d+$/.test(pathParts[0] ?? '')) pathParts.shift();
  return pathParts.length > 0 ? pathParts : null;
}

function localizeProxySellerPathPart(part: string, countryCode: string, index: number, language?: string): string {
  const localized = formatResourceLocationForLanguage({
    id: `${countryCode}-${index}`,
    code: `${countryCode}:${part}`,
    countryCode,
    providerCode: 'PR',
    name: `${countryCode}-${part}`,
    displayName: `${countryCode}-${part}`,
  }, language).detail?.trim();
  return localized || makeResourceReferenceLabel(part, language);
}

function makeResourceReferenceLabel(value: string, language?: string): string {
  const prefix = isEnglishLanguage(language) ? 'Resource' : '\u8d44\u6e90';
  return `${prefix} ${makeStableNumericSuffix(value)}`;
}

function makeStableNumericSuffix(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return String(hash).slice(-6).padStart(6, '0');
}

function summarizeResourceCosts(
  resources: ResourceDto[],
  t: (key: string, values?: Record<string, unknown>) => string,
): { label: string; hasCost: boolean } {
  const knownCosts = resources
    .map((resource) => {
      const amount = parseMoneyAmount(resource.upstreamCost);
      if (amount === null) return null;
      const currency = resource.upstreamCostCurrency ?? resource.priceCurrency ?? 'CNY';
      const label = formatMoneyAmount(amount, currency);
      return label ? { amount, currency, label } : null;
    })
    .filter((value): value is { amount: number; currency: string; label: string } => value !== null);
  if (knownCosts.length === 0) return { label: t('resources.resourceCostMissing'), hasCost: false };

  const missingCount = resources.length - knownCosts.length;
  const currencies = [...new Set(knownCosts.map((cost) => cost.currency))];
  let label: string;

  if (currencies.length === 1) {
    const currency = currencies[0]!;
    const amounts = [...new Set(knownCosts.map((cost) => cost.amount))].sort((left, right) => left - right);
    label = amounts.length === 1
      ? knownCosts[0]!.label
      : t('resources.resourceCostRange', {
        min: formatMoneyAmount(amounts[0]!, currency) ?? `${amounts[0]} ${currency}`,
        max: formatMoneyAmount(amounts[amounts.length - 1]!, currency) ?? `${amounts[amounts.length - 1]} ${currency}`,
      });
  } else {
    const uniqueLabels = [...new Set(knownCosts.map((cost) => cost.label))];
    label = uniqueLabels.slice(0, 3).join(' / ');
    if (uniqueLabels.length > 3) {
      label = t('resources.resourceCostListMore', { costs: label, count: uniqueLabels.length });
    }
  }

  return {
    label: missingCount > 0 ? t('resources.resourceCostPartialKnown', { cost: label }) : label,
    hasCost: true,
  };
}

function summarizeBulkRegionCost(
  region: BulkPriceRegionGroup,
  t: (key: string, values?: Record<string, unknown>) => string,
): { label: string; hasCost: boolean } {
  if (region.upstreamCost !== undefined || region.upstreamCostCurrency !== undefined) {
    const amount = parseMoneyAmount(region.upstreamCost ?? null);
    if (amount === null) return { label: t('resources.resourceCostMissing'), hasCost: false };
    return {
      label: formatMoneyAmount(amount, region.upstreamCostCurrency ?? region.priceCurrency ?? 'CNY') ?? String(amount),
      hasCost: true,
    };
  }
  return summarizeResourceCosts(region.resources, t);
}

function formatResourceDisplayName(resource: ResourceDto): string {
  return resource.displayName?.trim() || resource.name.trim() || formatResourceLocationZh(resource).title;
}

function formatResourceTraceLabel(resource: ResourceDto): string {
  if (resource.providerCode === 'PR' && resource.code.includes(':')) {
    const country = formatRegionNameZh({ countryCode: resource.countryCode || resource.code.split(':')[0] || '' });
    const parts = resource.code.split(':').map((part) => part.trim()).filter(Boolean);
    const tariff = parts.find((part, index) => index > 0 && /^\d+$/.test(part));
    return [country, tariff].filter(Boolean).join(' / ') || compactTraceValue(resource.code, 18);
  }
  const cidr = getResourceNetworkCidr(resource);
  if (cidr) return cidr;
  return compactTraceValue(resource.code, 18);
}

function compactTraceValue(value: string, visibleChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= visibleChars) return trimmed;
  return `${trimmed.slice(0, visibleChars)}...`;
}

function isPriceEditableResource(resource: ResourceDto): boolean {
  return resource.status === 'ACTIVE' && resource.isVisible && resource.isSaleable;
}

export function formatUnsaleableReason(reasonKey: string | null | undefined, t: (key: string) => string): string {
  if (!reasonKey) return '';
  const key = `resources.unsaleableReasons.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('resources.reason.generic') : translated;
}

function isSyncInventoryResult(value: unknown): value is SyncInventoryResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SyncInventoryResult>;
  return (
    typeof candidate.attempted === 'number' &&
    typeof candidate.created === 'number' &&
    typeof candidate.updated === 'number' &&
    typeof candidate.skipped === 'number' &&
    typeof candidate.failed === 'number' &&
    typeof candidate.synced === 'number' &&
    typeof candidate.syncedAt === 'string' &&
    typeof candidate.upstreamRawStatus === 'string' &&
    Array.isArray(candidate.countries)
  );
}

function isNoWriteSyncResult(result: SyncInventoryResult): boolean {
  return result.attempted === 0 || result.synced === 0;
}

function isSyncInventoryIssue(result: SyncInventoryResult): boolean {
  return isNoWriteSyncResult(result) || result.failed > 0;
}

function getSyncResultAlertType(result: SyncInventoryResult): 'success' | 'warning' {
  return isSyncInventoryIssue(result) ? 'warning' : 'success';
}

function getReasonKey(error: unknown): string {
  const apiError = error as ApiError | undefined;
  return apiError?.reasonKey || (error instanceof Error ? error.message : String(error));
}

function formatResourceFailure(error: unknown, t: (key: string) => string): string {
  const reasonKey = typeof error === 'string' ? error : getReasonKey(error);
  if (!reasonKey) return t('resources.reason.generic');

  const unsaleableKey = `resources.unsaleableReasons.${reasonKey}`;
  const unsaleableLabel = t(unsaleableKey);
  if (unsaleableLabel !== unsaleableKey) return unsaleableLabel;

  const reasonKeyPath = `resources.reason.${reasonKey}`;
  const reasonLabel = t(reasonKeyPath);
  return reasonLabel === reasonKeyPath ? t('resources.reason.generic') : reasonLabel;
}

function formatSyncCountries(countries: string[]): string {
  return countries.length > 0 ? countries.map((countryCode) => formatRegionNameZh({ countryCode })).join(', ') : '-';
}

function formatUpstreamRawStatus(status: string, t: (key: string) => string): string {
  const normalized = status.trim().toLowerCase();
  if (['ready', 'success', 'succeeded', 'ok'].includes(normalized)) return t('pricing.matrix.syncStatusReady');
  if (['failed', 'failure', 'error'].includes(normalized)) return t('pricing.matrix.syncStatusFailed');
  if (['pending', 'running', 'processing'].includes(normalized)) return t('pricing.matrix.syncStatusPending');
  return status;
}
