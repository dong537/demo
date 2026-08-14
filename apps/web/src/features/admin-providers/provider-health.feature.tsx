import React from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { FolderOpenOutlined, PlusOutlined, PoweroffOutlined, SaveOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, buildQuery } from '../../shared/api/client';
import type { ApiError } from '../../shared/api/client';
import { kpiCardStyle, surfaceCardStyle } from '../../shared/ui/surface';
import { PageHeader } from '../../shared/ui/page-header';
import { formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatMoneyAmount } from '../../shared/money/money';
import { formatDateTime } from '../../shared/time/time';

export interface ProviderCapabilities {
  inventorySync: boolean;
  renew: boolean;
  changePassword: boolean;
  switchIp: boolean;
}

export interface ProviderAccountListItem {
  id: string;
  providerCode: ProviderCode;
  tenantId: string | null;
  status: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  availableCountries: Array<{ code: string; name: string }>;
  capabilities: ProviderCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderHealthCheckResult {
  accountId: string;
  providerCode: ProviderCode;
  reachable: boolean;
  latencyMs: number | null;
  reasonKey: string | null;
  detail: string | null;
  checkedAt: string;
}

export interface ProviderSyncInventoryResult {
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

interface PricingMatrixItem {
  resourceId: string;
  code: string;
  name: string;
  displayName: string | null;
  providerCode: string;
  ipType: string;
  protocol: string;
  status: string;
  isSaleable: boolean;
  stock: number | null;
  inventoryCapturedAt: string | null;
  inventoryIsStale: boolean | null;
  overridePrice: string | null;
  effectivePrice: string | null;
  currency: string | null;
  upstreamCost: string | null;
  upstreamCostCurrency: string | null;
}

interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

interface ProviderPricingMatrixSummary {
  providerCode: ProviderCode;
  total: number;
  enabled: number;
  synced: number;
  priced: number;
}

type ProviderCode = 'IPIPD' | 'NINE_EIGHT_FIVE' | 'PR' | 'UPSTREAM_API';

interface ProviderFormValues {
  providerCode?: ProviderCode;
  status: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  appId?: string;
  appSecret?: string;
  apikey?: string;
  zoneId?: string;
}

const PROVIDER_NAME: Record<ProviderCode, string> = {
  IPIPD: 'ipmigo 平台',
  NINE_EIGHT_FIVE: '985 平台',
  PR: 'PR 平台',
  UPSTREAM_API: '通用上游',
};

const STATUS_COLOR: Record<ProviderAccountListItem['status'], string> = {
  ACTIVE: 'green',
  DISABLED: 'default',
};

const PROVIDER_MATRIX_PAGE_SIZE = 20;
const EMPTY_PROVIDER_RESOURCE_SUMMARY: ProviderResourceSummary = {
  total: 0,
  enabled: 0,
  synced: 0,
  priced: 0,
};

export function buildProviderUpdateBody(values: ProviderFormValues, providerCode: ProviderCode) {
  const credential = buildCredential(values, providerCode);
  return {
    status: values.status,
    baseUrl: values.baseUrl?.trim(),
    timeoutMs: Number(values.timeoutMs),
    inventorySyncEnabled: Boolean(values.inventorySyncEnabled),
    enabledCountryCodes: values.enabledCountryCodes ?? [],
    ...(credential ? { credential } : {}),
  };
}

function fetchProviderPricingMatrixPage(page: number, providerCode?: ProviderCode, search?: string): Promise<PageResult<PricingMatrixItem>> {
  return apiRequest<PageResult<PricingMatrixItem>>(
    `/api/pricing/matrix${buildQuery({
      durationDays: 30,
      currency: 'CNY',
      providerCode,
      search: search?.trim() || undefined,
      configurableOnly: 'true',
      includeTotal: 'true',
      withInventory: 'false',
      page,
      pageSize: PROVIDER_MATRIX_PAGE_SIZE,
    })}`,
  );
}

function fetchProviderPricingMatrixSummary(): Promise<ProviderPricingMatrixSummary[]> {
  return apiRequest<ProviderPricingMatrixSummary[]>(
    `/api/pricing/matrix/summary${buildQuery({
      durationDays: 30,
      currency: 'CNY',
    })}`,
  );
}

interface ProviderMatrixCatalogState {
  items: PricingMatrixItem[];
  total: number;
  pageSize: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

function useProviderMatrixCatalog(providerCode?: ProviderCode, search?: string, page = 1): ProviderMatrixCatalogState {
  const normalizedSearch = search?.trim() ?? '';
  const enabled = Boolean(providerCode);

  const pageQuery = useQuery({
    queryKey: ['pricing-matrix', 'provider-resource-config', providerCode, normalizedSearch, 'page', page],
    queryFn: () => fetchProviderPricingMatrixPage(page, providerCode, normalizedSearch),
    enabled,
  });
  const queryItems = pageQuery.data?.items;
  const items = React.useMemo(
    () => dedupeMatrixItemsByResourceId(Array.isArray(queryItems) ? queryItems : []),
    [queryItems],
  );
  const total = normalizeMatrixTotal(pageQuery.data?.total ?? 0, items.length);
  const pageSize = normalizeMatrixPageSize(pageQuery.data?.pageSize ?? PROVIDER_MATRIX_PAGE_SIZE);

  return {
    items,
    total,
    pageSize,
    isLoading: pageQuery.isLoading,
    isFetching: pageQuery.isFetching,
    isError: pageQuery.isError,
    error: pageQuery.error,
  };
}

export function ProviderHealthFeature() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [results, setResults] = React.useState<Record<string, ProviderHealthCheckResult>>({});
  const [syncResults, setSyncResults] = React.useState<Record<string, ProviderSyncInventoryResult>>({});
  const [syncErrors, setSyncErrors] = React.useState<Record<string, string>>({});
  const [actionErrors, setActionErrors] = React.useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const [configuringProvider, setConfiguringProvider] = React.useState<ProviderAccountListItem | null>(null);

  const query = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiRequest<ProviderAccountListItem[]>('/api/providers'),
  });

  const providerCodes = React.useMemo(
    () => [...new Set((query.data ?? []).map((provider) => provider.providerCode))],
    [query.data],
  );

  const providerSummaryQuery = useQuery({
    queryKey: ['pricing-matrix', 'provider-summary'],
    queryFn: fetchProviderPricingMatrixSummary,
    enabled: query.isSuccess && providerCodes.length > 0,
  });

  const healthCheck = useMutation({
    mutationFn: (id: string) =>
      apiRequest<ProviderHealthCheckResult>(`/api/providers/${encodeURIComponent(id)}/health-check`, { method: 'POST' }),
    onMutate: (id) => {
      setResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setActionErrors((prev) => ({ ...prev, [id]: '' }));
    },
    onSuccess: (data) => {
      setResults((prev) => ({ ...prev, [data.accountId]: data }));
      setActionErrors((prev) => ({ ...prev, [data.accountId]: '' }));
    },
    onError: (error, id) => {
      setResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setActionErrors((prev) => ({ ...prev, [id]: formatProviderReason(t, getReasonKey(error)) }));
    },
  });

  const saveProvider = useMutation({
    mutationFn: ({ provider, values }: { provider: ProviderAccountListItem; values: ProviderFormValues }) =>
      apiRequest<ProviderAccountListItem>(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: 'PUT',
        body: JSON.stringify(buildProviderUpdateBody(values, provider.providerCode)),
      }),
    onMutate: ({ provider }) => {
      setActionErrors((prev) => ({ ...prev, [provider.id]: '' }));
    },
    onSuccess: (updated, input) => {
      message.success(t('providers.saveSuccess'));
      queryClient.setQueryData<ProviderAccountListItem[]>(['providers'], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)) ?? current);
      setConfiguringProvider((current) => (current?.id === updated.id ? updated : current));
      setResults((prev) => {
        const next = { ...prev };
        delete next[input.provider.id];
        return next;
      });
      setSyncResults((prev) => {
        const next = { ...prev };
        delete next[input.provider.id];
        return next;
      });
      setSyncErrors((prev) => ({ ...prev, [input.provider.id]: '' }));
      setActionErrors((prev) => ({ ...prev, [input.provider.id]: '' }));
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      if (updated.status === 'ACTIVE' && updated.inventorySyncEnabled) {
        syncInventory.mutate(updated);
      }
    },
    onError: (error, input) => {
      setActionErrors((prev) => ({ ...prev, [input.provider.id]: formatProviderReason(t, getReasonKey(error)) }));
    },
  });

  const createProvider = useMutation({
    mutationFn: (values: ProviderFormValues) =>
      apiRequest<ProviderAccountListItem>('/api/providers', {
        method: 'POST',
        body: JSON.stringify(buildProviderCreateBody(values)),
      }),
    onSuccess: (created) => {
      message.success(t('providers.createSuccess'));
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      if (created.status === 'ACTIVE' && created.inventorySyncEnabled) {
        syncInventory.mutate(created);
      }
    },
  });

  const syncInventory = useMutation({
    mutationFn: async (provider: ProviderAccountListItem) => {
      const data: unknown = await apiRequest<ProviderSyncInventoryResult>('/api/resources/sync-inventory', {
        method: 'POST',
        body: JSON.stringify({ providerCode: provider.providerCode, accountId: provider.id }),
      });
      if (!isProviderSyncInventoryResult(data)) {
        throw new Error('invalid_sync_inventory_response');
      }
      return data;
    },
    onMutate: (provider) => {
      setSyncResults((prev) => {
        const next = { ...prev };
        delete next[provider.id];
        return next;
      });
      setSyncErrors((prev) => ({ ...prev, [provider.id]: '' }));
      setActionErrors((prev) => ({ ...prev, [provider.id]: '' }));
    },
    onSuccess: (data, provider) => {
      setSyncResults((prev) => ({ ...prev, [provider.id]: data }));
      setSyncErrors((prev) => ({ ...prev, [provider.id]: '' }));
      setActionErrors((prev) => ({ ...prev, [provider.id]: '' }));
      if (isSyncInventoryIssue(data)) {
        message.warning(t('providers.syncInventoryNoRows'));
      } else {
        message.success(t('providers.syncInventorySuccess', { count: data.synced }));
      }
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (error, provider) => {
      const reason = getReasonKey(error);
      const reasonText = formatProviderReason(t, reason);
      setSyncResults((prev) => {
        const next = { ...prev };
        delete next[provider.id];
        return next;
      });
      setSyncErrors((prev) => ({ ...prev, [provider.id]: reasonText }));
      setActionErrors((prev) => ({ ...prev, [provider.id]: reasonText }));
      message.error(reasonText);
    },
  });

  const savePrice = useMutation({
    mutationFn: async (input: { items: Array<{ resourceId: string; unitPrice: number }> }) => {
      for (const item of input.items) {
        await apiRequest('/api/pricing/overrides', {
          method: 'POST',
          body: JSON.stringify({
            resourceId: item.resourceId,
            durationDays: 30,
            unitPrice: String(item.unitPrice),
            currency: 'CNY',
          }),
        });
      }
    },
    onMutate: () => {
      message.destroy();
    },
    onSuccess: () => {
      message.success(t('providers.priceSaveSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
    },
    onError: (error) => {
      message.error(formatProviderReason(t, getReasonKey(error)));
    },
  });

  const saveSaleableResources = useMutation({
    mutationFn: async (input: { provider: ProviderAccountListItem; items: Array<{ resourceId: string; saleable: boolean }> }) => {
      return apiRequest<ProviderAccountListItem>(`/api/providers/${encodeURIComponent(input.provider.id)}/resources/saleability`, {
        method: 'PUT',
        body: JSON.stringify({ items: input.items }),
      });
    },
    onMutate: () => {
      message.destroy();
    },
    onSuccess: (updated) => {
      message.success(t('providers.saveSuccess'));
      queryClient.setQueryData<ProviderAccountListItem[]>(['providers'], (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)) ?? current);
      setConfiguringProvider((current) => (current?.id === updated.id ? updated : current));
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (error) => {
      message.error(formatProviderReason(t, getReasonKey(error)));
    },
  });

  const providerSummaryLoading = providerCodes.length > 0 && providerSummaryQuery.isLoading;
  const providerSummaryError = providerSummaryQuery.error;

  if (query.isLoading || providerSummaryLoading) return <Skeleton active />;

  if (query.error || providerSummaryError) {
    const apiErr = (query.error ?? providerSummaryError) as ApiError;
    const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatProviderReason(t, getReasonKey(query.error ?? providerSummaryError))}
        showIcon
      />
    );
  }

  const providers = query.data ?? [];
  const summaryByProvider = new Map<ProviderCode, ProviderResourceSummary>(
    (providerSummaryQuery.data ?? []).map((summary) => [
      summary.providerCode,
      {
        total: summary.total,
        enabled: summary.enabled,
        synced: summary.synced,
        priced: summary.priced,
      },
    ]),
  );
  const readyCount = providers.filter((item) => item.status === 'ACTIVE').length;
  const failedCount = Object.values(results).filter((item) => !item.reachable).length;
  const lastCheckedAt = latestCheckedAt(results);

  return (
    <Space className="ipx-provider-page" direction="vertical" size={18} style={{ width: '100%' }}>
      <PageHeader
        title={t('providers.configTitle')}
        extra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('providers.create')}
          </Button>
        )}
      />

      <Row className="ipx-provider-kpi-grid" gutter={[14, 14]} align="stretch">
        <Col xs={24} md={8}>
          <Kpi title={t('providers.ready')} value={readyCount} description={t('providers.readyHint')} />
        </Col>
        <Col xs={24} md={8}>
          <Kpi title={t('providers.failed')} value={failedCount} description={t('providers.failedHint')} accent="#f97316" />
        </Col>
        <Col xs={24} md={8}>
          <Kpi title={t('providers.lastChecked')} value={lastCheckedAt ? formatDateTime(lastCheckedAt) : '-'} description={t('providers.lastCheckedHint')} />
        </Col>
      </Row>

      {providers.length === 0 ? (
        <Card style={surfaceCardStyle()}>
          <Empty description={t('providers.empty')} />
        </Card>
      ) : (
        <div className="ipx-provider-config-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
          {providers.map((provider) => (
            <ProviderConfigCard
              key={provider.id}
              provider={provider}
              summary={summaryByProvider.get(provider.providerCode) ?? EMPTY_PROVIDER_RESOURCE_SUMMARY}
              result={results[provider.id]}
              syncResult={syncResults[provider.id]}
              syncError={syncErrors[provider.id]}
              actionError={actionErrors[provider.id]}
              checking={healthCheck.isPending && healthCheck.variables === provider.id}
              saving={saveProvider.isPending && saveProvider.variables?.provider.id === provider.id}
              syncing={syncInventory.isPending && syncInventory.variables?.id === provider.id}
              onHealthCheck={() => healthCheck.mutate(provider.id)}
              onSyncInventory={() => syncInventory.mutate(provider)}
              onSave={(values) => saveProvider.mutate({ provider, values })}
              onOpenResourceConfig={() => {
                setConfiguringProvider(provider);
              }}
            />
          ))}
        </div>
      )}

      <ProviderResourceConfigDrawer
        provider={configuringProvider}
        syncResult={configuringProvider ? syncResults[configuringProvider.id] : undefined}
        syncError={configuringProvider ? syncErrors[configuringProvider.id] : undefined}
        actionError={getProviderResourceActionError(t, saveSaleableResources.error, savePrice.error)}
        savingProvider={saveSaleableResources.isPending && saveSaleableResources.variables?.provider.id === configuringProvider?.id}
        savingPrice={savePrice.isPending}
        syncing={syncInventory.isPending && syncInventory.variables?.id === configuringProvider?.id}
        onClose={() => setConfiguringProvider(null)}
        onSyncInventory={(provider) => syncInventory.mutate(provider)}
        onSaveSaleableResources={(provider, items, onSaved) => saveSaleableResources.mutate({ provider, items }, { onSuccess: onSaved })}
        onSavePrices={(items, onSaved) => savePrice.mutate({ items }, { onSuccess: onSaved })}
      />

      <CreateProviderDrawer
        open={createOpen}
        creating={createProvider.isPending}
        error={createProvider.error}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createProvider.mutate(values)}
      />
    </Space>
  );
}

function Kpi({ title, value, description, accent }: { title: string; value: React.ReactNode; description?: React.ReactNode; accent?: string }) {
  return (
    <Card className="ipx-provider-kpi-card" style={kpiCardStyle(accent)} styles={{ body: { padding: 16 } }}>
      <Statistic title={title} value={typeof value === 'number' ? value : undefined} formatter={() => value} />
      {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
    </Card>
  );
}

function ProviderConfigCard({
  provider,
  summary,
  result,
  syncResult,
  syncError,
  actionError,
  checking,
  saving,
  syncing,
  onHealthCheck,
  onSyncInventory,
  onSave,
  onOpenResourceConfig,
}: {
  provider: ProviderAccountListItem;
  summary: ProviderResourceSummary;
  result?: ProviderHealthCheckResult;
  syncResult?: ProviderSyncInventoryResult;
  syncError?: string;
  actionError?: string;
  checking: boolean;
  saving: boolean;
  syncing: boolean;
  onHealthCheck: () => void;
  onSyncInventory: () => void;
  onSave: (values: ProviderFormValues) => void;
  onOpenResourceConfig: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ProviderFormValues>();
  const healthText = renderHealthText(t, provider, result, checking);

  React.useEffect(() => {
    form.setFieldsValue({
      status: provider.status,
      baseUrl: provider.baseUrl,
      timeoutMs: provider.timeoutMs,
      inventorySyncEnabled: provider.inventorySyncEnabled,
      enabledCountryCodes: provider.enabledCountryCodes,
      appId: undefined,
      appSecret: undefined,
      apikey: undefined,
      zoneId: undefined,
    });
  }, [form, provider]);

  return (
    <Card
      className="ipx-provider-config-card"
      style={surfaceCardStyle({ minHeight: '100%', borderRadius: 8 })}
      styles={{ body: { padding: 16 } }}
    >
      <Form form={form} layout="vertical" onFinish={onSave}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0, fontSize: 18 }}>{formatProviderName(provider.providerCode, t)}</Typography.Title>
          </div>
          <Tag color={STATUS_COLOR[provider.status]} style={{ marginInlineEnd: 0 }}>
            {provider.status === 'ACTIVE' ? t('providers.ready') : t('providers.statusDisabled')}
          </Tag>
        </div>

        <ProviderAccountOverview provider={provider} />

        <Form.Item
          name="baseUrl"
          label={t('providers.baseUrl')}
          extra={t('providers.routingConfigHint')}
          rules={[{ required: true, message: t('providers.baseUrlRequired') }]}
        >
          <Input placeholder="https://api.example.com" />
        </Form.Item>

        {renderCredentialFields(provider.providerCode, t, false)}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="status" label={t('providers.status')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ACTIVE', label: t('providers.statusActive') },
                { value: 'DISABLED', label: t('providers.statusDisabled') },
              ]}
            />
          </Form.Item>
          <Form.Item name="timeoutMs" label={t('providers.timeoutMs')} rules={[{ required: true, type: 'number', min: 1000, max: 120000 }]}>
            <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="inventorySyncEnabled" label={t('providers.capInventorySync')} valuePropName="checked" style={{ marginBottom: 14 }}>
          <Switch />
        </Form.Item>
        <Form.Item name="enabledCountryCodes" hidden>
          <Select mode="multiple" />
        </Form.Item>

        <ProviderResourceSummaryPanel summary={summary} onOpen={onOpenResourceConfig} />

        <ProviderHealthStatusPanel result={result} checking={checking} healthText={healthText} />
        <ProviderSyncResultPanel result={syncResult} error={syncError} />
        {actionError ? (
          <Alert
            type="error"
            showIcon
            message={t('error')}
            description={actionError}
            style={{ marginBottom: 14 }}
          />
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8, marginTop: 6 }}>
          <Button loading={checking} icon={<PoweroffOutlined />} onClick={onHealthCheck}>
            {t('providers.healthCheck')}
          </Button>
          <Button
            loading={syncing}
            disabled={!provider.capabilities.inventorySync}
            icon={<FolderOpenOutlined />}
            onClick={onSyncInventory}
          >
            {t('providers.syncInventory')}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
            {t('providers.save')}
          </Button>
        </div>
        {!provider.capabilities.inventorySync && (
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
            {t('providers.inventorySyncUnsupported')}
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}

function CreateProviderDrawer({
  open,
  creating,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  creating: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ProviderFormValues>();
  const providerCode = Form.useWatch('providerCode', form) ?? 'IPIPD';
  const apiErr = error as ApiError | undefined;

  React.useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      providerCode: 'IPIPD',
      status: 'ACTIVE',
      baseUrl: 'https://api.ipipd.cn',
      timeoutMs: 15000,
      inventorySyncEnabled: true,
      enabledCountryCodes: [],
      appId: undefined,
      appSecret: undefined,
      apikey: undefined,
      zoneId: undefined,
    });
  }, [form, open]);

  return (
    <Drawer
      title={t('providers.create')}
      open={open}
      width={520}
      destroyOnClose
      onClose={onClose}
      extra={
        <Button type="primary" loading={creating} onClick={() => form.submit()}>
          {t('providers.createSubmit')}
        </Button>
      }
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {apiErr ? <Alert type="error" showIcon message={t('error')} description={formatProviderReason(t, getReasonKey(apiErr))} /> : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          onValuesChange={(changed) => {
            if (!('providerCode' in changed)) return;
            form.setFieldsValue({
              baseUrl: defaultProviderBaseUrl(changed.providerCode),
              appId: undefined,
              appSecret: undefined,
              apikey: undefined,
              zoneId: undefined,
              enabledCountryCodes: [],
            });
          }}
        >
          <Form.Item name="providerCode" label={t('providers.providerCode')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'IPIPD', label: formatProviderName('IPIPD', t) },
                { value: 'NINE_EIGHT_FIVE', label: formatProviderName('NINE_EIGHT_FIVE', t) },
                { value: 'PR', label: formatProviderName('PR', t) },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label={t('providers.status')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ACTIVE', label: t('providers.statusActive') },
                { value: 'DISABLED', label: t('providers.statusDisabled') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label={t('providers.baseUrl')}
            extra={t('providers.routingConfigHint')}
            rules={[{ required: true, message: t('providers.baseUrlRequired') }]}
          >
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="timeoutMs" label={t('providers.timeoutMs')} rules={[{ required: true, type: 'number', min: 1000, max: 120000 }]}>
              <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="inventorySyncEnabled" label={t('providers.capInventorySync')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="enabledCountryCodes" hidden>
            <Select mode="multiple" />
          </Form.Item>
          {renderCredentialFields(providerCode, t, true)}
        </Form>
      </Space>
    </Drawer>
  );
}

function renderCredentialFields(providerCode: ProviderCode, t: (key: string) => string, required: boolean) {
  const requiredRule = required ? [{ required: true, message: t('providers.credentialRequired') }] : undefined;
  if (providerCode === 'IPIPD') {
    return (
      <>
        <Form.Item name="appId" label={t('providerAccounts.credential.appId')} rules={requiredRule}>
          <Input placeholder={t('providers.keepExistingCredential')} autoComplete="off" />
        </Form.Item>
        <Form.Item name="appSecret" label={t('providerAccounts.credential.appSecret')} rules={requiredRule}>
          <Input.Password placeholder={t('providers.keepExistingCredential')} autoComplete="new-password" />
        </Form.Item>
      </>
    );
  }
  if (providerCode === 'NINE_EIGHT_FIVE') {
    return (
      <>
        <Form.Item name="apikey" label={t('providerAccounts.credential.apikey')} rules={requiredRule}>
          <Input.Password placeholder={t('providers.keepExistingCredential')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="zoneId" label={t('providerAccounts.credential.zoneId')}>
          <Input placeholder={t('providers.keepExistingCredential')} autoComplete="off" />
        </Form.Item>
      </>
    );
  }
  return (
    <Form.Item name="apikey" label={t('providerAccounts.credential.apikey')} rules={requiredRule}>
      <Input.Password placeholder={t('providers.keepExistingCredential')} autoComplete="new-password" />
    </Form.Item>
  );
}

function renderHealthText(
  t: (key: string, values?: Record<string, unknown>) => string,
  provider: ProviderAccountListItem,
  result: ProviderHealthCheckResult | undefined,
  checking: boolean,
): string {
  if (checking) return t('providers.checking');
  if (!result) return t('providers.notChecked');
  if (result.reachable) {
    return result.latencyMs !== null
      ? t('providers.readyWithLatency', { latency: result.latencyMs })
      : t('providers.ready');
  }
  return result.reasonKey ? formatProviderReason(t, result.reasonKey) : t('providers.unreachable');
}

function ProviderAccountOverview({ provider }: { provider: ProviderAccountListItem }) {
  const { t } = useTranslation();
  return (
    <div style={{ borderRadius: 8, border: '1px solid #edf1f7', background: '#fbfdff', padding: '10px 12px', marginBottom: 12 }}>
      <Descriptions
        size="small"
        column={1}
        colon={false}
        styles={{
          label: { width: 112, color: '#6b7280' },
          content: { color: '#111827' },
        }}
        items={[
          { key: 'account', label: t('providers.accountName'), children: `${formatProviderName(provider.providerCode, t)} / ${provider.id}` },
          { key: 'endpoint', label: t('providers.baseUrl'), children: provider.baseUrl },
          { key: 'timeout', label: t('providers.timeoutMs'), children: `${provider.timeoutMs}ms` },
          { key: 'credential', label: t('providers.credentialRequired'), children: <CredentialSchemaTags providerCode={provider.providerCode} /> },
          {
            key: 'capabilities',
            label: t('providers.capInventorySync'),
            children: (
              <Space size={6} wrap>
                <Tag color={provider.capabilities.inventorySync ? 'green' : undefined}>{t('providers.syncInventory')}</Tag>
                <Tag color={provider.capabilities.renew ? 'blue' : undefined}>{t('providers.capRenew')}</Tag>
                <Tag color={provider.capabilities.changePassword ? 'blue' : undefined}>{t('providers.capChangePassword')}</Tag>
                <Tag color={provider.capabilities.switchIp ? 'blue' : undefined}>{t('providers.capSwitchIp')}</Tag>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}

function CredentialSchemaTags({ providerCode }: { providerCode: ProviderCode }) {
  const { t } = useTranslation();
  const labels = providerCode === 'IPIPD'
    ? [t('providerAccounts.credential.appId'), t('providerAccounts.credential.appSecret')]
    : providerCode === 'NINE_EIGHT_FIVE'
      ? [t('providerAccounts.credential.apikey'), t('providerAccounts.credential.zoneId')]
      : [t('providerAccounts.credential.apikey')];
  return (
    <Space size={6} wrap>
      {labels.map((label) => <Tag key={label}>{label}</Tag>)}
    </Space>
  );
}

function ProviderHealthStatusPanel({
  result,
  checking,
  healthText,
}: {
  result?: ProviderHealthCheckResult;
  checking: boolean;
  healthText: string;
}) {
  const { t } = useTranslation();
  const statusColor = result ? (result.reachable ? 'green' : 'red') : 'default';
  return (
    <div style={{ borderRadius: 8, border: '1px solid #e8e8e8', background: '#f7f7f7', padding: '10px 12px', marginBottom: 12 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Typography.Text strong>{t('providers.healthCheck')}</Typography.Text>
          <Tag color={statusColor}>{checking ? t('providers.checking') : healthText}</Tag>
        </Space>
        <Descriptions
          size="small"
          column={1}
          colon={false}
          styles={{ label: { width: 104, color: '#6b7280' } }}
          items={[
            { key: 'checkedAt', label: t('providers.lastChecked'), children: result ? formatDateTime(result.checkedAt) : '-' },
            { key: 'latency', label: t('providers.timeoutMs'), children: result?.latencyMs !== null && result?.latencyMs !== undefined ? `${result.latencyMs}ms` : '-' },
            { key: 'reason', label: t('providers.failed'), children: result && !result.reachable ? (result.reasonKey ? formatProviderReason(t, result.reasonKey) : t('providers.unreachable')) : '-' },
          ]}
        />
      </Space>
    </div>
  );
}

function ProviderSyncResultPanel({ result, error }: { result?: ProviderSyncInventoryResult; error?: string }) {
  const { t } = useTranslation();
  if (!result && !error) return null;
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('providers.syncInventoryIssueTitle')}
        description={<Typography.Text type="danger" strong>{error}</Typography.Text>}
        style={{ marginBottom: 14 }}
      />
    );
  }
  if (!result) return null;
  return (
    <Alert
      type={isSyncInventoryIssue(result) ? 'warning' : 'success'}
      showIcon
      message={isSyncInventoryIssue(result) ? t('providers.syncInventoryIssueTitle') : t('providers.syncInventoryResult', { count: result.synced })}
      description={<SyncInventoryResultTags result={result} />}
      style={{ marginBottom: 14 }}
    />
  );
}

function SyncInventoryResultTags({ result }: { result: ProviderSyncInventoryResult }) {
  const { t } = useTranslation();
  const noWrittenRows = result.attempted === 0 || result.synced === 0;
  return (
    <Space size={6} wrap>
      <Tag color={result.attempted === 0 ? 'orange' : undefined}>{t('resources.syncAttempted', { count: result.attempted })}</Tag>
      <Tag color={noWrittenRows ? 'orange' : 'green'}>{t('providers.syncWritten', { count: result.synced })}</Tag>
      <Tag color={noWrittenRows ? 'orange' : 'green'}>{t('resources.syncCreated', { count: result.created })}</Tag>
      <Tag color={noWrittenRows ? 'orange' : 'blue'}>{t('resources.syncUpdated', { count: result.updated })}</Tag>
      <Tag color="orange">{t('resources.syncSkipped', { count: result.skipped })}</Tag>
      <Tag color={result.failed > 0 ? 'red' : undefined}>{t('resources.syncFailed', { count: result.failed })}</Tag>
      <Tag>{t('providers.lastChecked')}: {formatDateTime(result.syncedAt)}</Tag>
      <Tag>{formatUpstreamRawStatus(result.upstreamRawStatus, t)}</Tag>
      <Tag>{t('resources.syncCountries', { countries: formatSyncCountries(result.countries) })}</Tag>
    </Space>
  );
}

function formatSyncCountries(countries: string[]): string {
  return countries.length > 0 ? countries.map((countryCode) => formatRegionNameZh({ countryCode })).join(', ') : '-';
}

function isSyncInventoryIssue(result: ProviderSyncInventoryResult): boolean {
  return result.attempted === 0 || result.synced === 0 || result.failed > 0;
}

function buildProviderCreateBody(values: ProviderFormValues) {
  const providerCode = values.providerCode;
  if (!providerCode) throw new Error('providerCode is required');
  const credential = buildCredential(values, providerCode);
  if (!credential) throw new Error('credential is required');
  return {
    providerCode,
    status: values.status,
    baseUrl: values.baseUrl?.trim(),
    timeoutMs: Number(values.timeoutMs),
    inventorySyncEnabled: Boolean(values.inventorySyncEnabled),
    enabledCountryCodes: values.enabledCountryCodes ?? [],
    credential,
  };
}

interface ProviderResourceConfigRow {
  code: string;
  countryCode: string;
  name: string;
  detail: string | null;
  enabled: boolean;
  resource: PricingMatrixItem;
  resources: PricingMatrixItem[];
  enabledCount: number;
  rowKey: string;
}

type ResourceSetupFilter = 'ALL' | 'ENABLED' | 'SYNCED' | 'UNPRICED';
type ResourceSaleFilter = 'ALL' | 'SALEABLE' | 'UNSALEABLE';

interface ProviderResourceSummary {
  total: number;
  enabled: number;
  synced: number;
  priced: number;
}

function ProviderResourceSummaryPanel({ summary, onOpen }: { summary: ProviderResourceSummary; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ borderRadius: 8, border: '1px solid #edf1f7', background: '#f8fafc', padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="primary" icon={<SettingOutlined />} onClick={onOpen}>
          {t('providers.configureResources')}
        </Button>
      </div>
      <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
        <Col span={6}><ResourceMiniStat label={t('providers.resourceAll')} value={summary.total} /></Col>
        <Col span={6}><ResourceMiniStat label={t('providers.resourceEnabled')} value={summary.enabled} /></Col>
        <Col span={6}><ResourceMiniStat label={t('providers.resourceSynced')} value={summary.synced} /></Col>
        <Col span={6}><ResourceMiniStat label={t('providers.resourcePriced')} value={summary.priced} /></Col>
      </Row>
    </div>
  );
}

function ResourceMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ borderRadius: 8, background: '#fff', border: '1px solid #edf1f7', padding: '8px 10px' }}>
      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{label}</Typography.Text>
      <Typography.Text strong style={{ fontSize: 18 }}>{value}</Typography.Text>
    </div>
  );
}

function ProviderResourceConfigDrawer({
  provider,
  syncResult,
  syncError,
  actionError,
  savingProvider,
  savingPrice,
  syncing,
  onClose,
  onSyncInventory,
  onSaveSaleableResources,
  onSavePrices,
}: {
  provider: ProviderAccountListItem | null;
  syncResult?: ProviderSyncInventoryResult;
  syncError?: string;
  actionError?: string;
  savingProvider: boolean;
  savingPrice: boolean;
  syncing: boolean;
  onClose: () => void;
  onSyncInventory: (provider: ProviderAccountListItem) => void;
  onSaveSaleableResources: (provider: ProviderAccountListItem, items: Array<{ resourceId: string; saleable: boolean }>, onSaved?: () => void) => void;
  onSavePrices: (items: Array<{ resourceId: string; unitPrice: number }>, onSaved?: () => void) => void;
}) {
  const { t } = useTranslation();
  const [saleableResourceIds, setSaleableResourceIds] = React.useState<string[]>([]);
  const [saleableBaselineByResource, setSaleableBaselineByResource] = React.useState<Record<string, boolean>>({});
  const [priceDrafts, setPriceDrafts] = React.useState<Record<string, number | null>>({});
  const [groupResourcesByKey, setGroupResourcesByKey] = React.useState<Record<string, PricingMatrixItem[]>>({});
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<ResourceSetupFilter>('ALL');
  const [saleFilter, setSaleFilter] = React.useState<ResourceSaleFilter>('ALL');
  const [resourcePage, setResourcePage] = React.useState(1);

  React.useEffect(() => {
    if (!provider) return;
    setSaleableResourceIds([]);
    setSaleableBaselineByResource({});
    setPriceDrafts({});
    setGroupResourcesByKey({});
    setSearch('');
    setFilter('ALL');
    setSaleFilter('ALL');
    setResourcePage(1);
  }, [provider?.id]);

  const resourceConfigMatrixQuery = useProviderMatrixCatalog(provider?.providerCode, search, resourcePage);
  const matrixItems = resourceConfigMatrixQuery.items;

  React.useEffect(() => {
    if (!provider || matrixItems.length === 0) return;
    const rowsMissingBaseline = matrixItems.filter((item) => saleableBaselineByResource[item.resourceId] === undefined);
    if (rowsMissingBaseline.length > 0) {
      setSaleableBaselineByResource((prev) => ({
        ...prev,
        ...Object.fromEntries(rowsMissingBaseline.map((item) => [item.resourceId, isMatrixItemEnabled(item)])),
      }));
      const newlyEnabledIds = rowsMissingBaseline
        .filter((item) => isMatrixItemEnabled(item))
        .map((item) => item.resourceId);
      if (newlyEnabledIds.length > 0) {
        setSaleableResourceIds((prev) => [...new Set([...prev, ...newlyEnabledIds])]);
      }
    }
    setGroupResourcesByKey((prev) => ({
      ...prev,
      ...Object.fromEntries(matrixItems.map((item) => [item.resourceId, [item]])),
    }));
  }, [matrixItems, provider, saleableBaselineByResource]);

  const rows = provider ? buildProviderResourceRows(provider, matrixItems, saleableResourceIds) : [];
  const visibleRows = rows.filter((row) => {
    const keyword = search.trim().toLowerCase();
    const matchesSearch = !keyword
      || row.code.toLowerCase().includes(keyword)
      || row.countryCode.toLowerCase().includes(keyword)
      || row.name.toLowerCase().includes(keyword)
      || (row.detail ? row.detail.toLowerCase().includes(keyword) : false)
      || row.resources.some((resource) => resource.code.toLowerCase().includes(keyword)
        || resource.name.toLowerCase().includes(keyword)
        || Boolean(resource.displayName?.toLowerCase().includes(keyword)));
    if (!matchesSearch) return false;
    if (filter === 'ENABLED' && !row.enabled) return false;
    if (filter === 'SYNCED' && row.resources.length === 0) return false;
    if (filter === 'UNPRICED') {
      if (priceDrafts[row.rowKey] !== null && priceDrafts[row.rowKey] !== undefined) return false;
      if (row.resources.every((resource) => resource.effectivePrice)) return false;
    }
    if (saleFilter === 'SALEABLE' && !row.enabled) return false;
    if (saleFilter === 'UNSALEABLE' && row.enabled) return false;
    return true;
  });
  React.useEffect(() => {
    if (resourceConfigMatrixQuery.isLoading || resourceConfigMatrixQuery.isFetching) return;
    const maxPage = Math.max(1, Math.ceil(resourceConfigMatrixQuery.total / resourceConfigMatrixQuery.pageSize));
    if (resourcePage > maxPage) setResourcePage(maxPage);
  }, [
    resourceConfigMatrixQuery.isFetching,
    resourceConfigMatrixQuery.isLoading,
    resourceConfigMatrixQuery.pageSize,
    resourceConfigMatrixQuery.total,
    resourcePage,
  ]);
  const enabledCount = rows.filter((row) => row.enabled).length;
  const visibleCount = visibleRows.length;
  const saleableSelectionSet = new Set(saleableResourceIds);
  const changedSaleableResources = Object.entries(saleableBaselineByResource)
    .map(([resourceId, current]) => ({ resourceId, saleable: saleableSelectionSet.has(resourceId), current }))
    .filter((item) => item.saleable !== item.current)
    .map(({ resourceId, saleable }) => ({ resourceId, saleable }));
  const changedPriceGroups = Object.entries(groupResourcesByKey)
    .map(([rowKey, resources]) => ({ rowKey, resources, value: priceDrafts[rowKey] }))
    .filter((item): item is { rowKey: string; resources: PricingMatrixItem[]; value: number } =>
      item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)) && item.resources.length > 0);
  const changedPrices = changedPriceGroups.flatMap(({ resources, value }) =>
    resources.map((resource) => ({ resourceId: resource.resourceId, unitPrice: Number(value) })));
  const markSaleabilitySaved = () => {
    setSaleableBaselineByResource((prev) => ({
      ...prev,
      ...Object.fromEntries(changedSaleableResources.map((item) => [item.resourceId, item.saleable])),
    }));
  };

  const columns: ColumnsType<ProviderResourceConfigRow> = [
    {
      title: t('providers.resourceCountry'),
      dataIndex: 'code',
      width: 300,
      render: (_value, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong>{row.name}</Typography.Text>
          {row.detail ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.detail}</Typography.Text>
          ) : null}
          <Space size={6} wrap>
            <Tag bordered={false}>{row.countryCode}</Tag>
            <Tag color="blue">{formatProviderName(row.resource.providerCode as ProviderCode, t)}</Tag>
            <Tag color={row.resources.every((resource) => resource.status === 'ACTIVE') ? 'green' : 'orange'}>
              {formatResourceGroupStatus(row.resources, t)}
            </Tag>
            <Tag color={row.resources.length > 1 ? 'geekblue' : undefined}>
              {t('providers.resourceGroupCount', { count: row.resources.length })}
            </Tag>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('providers.resourceEnabled'),
      dataIndex: 'enabled',
      width: 120,
      render: (_value, row) => (
        <Space direction="vertical" size={4}>
          <Switch
            aria-label={`${t('providers.resourceToggle')}:${row.code}`}
            checked={row.enabled}
            onChange={(checked) => {
              const resourceIds = row.resources.map((resource) => resource.resourceId);
              const next = checked
                ? [...new Set([...saleableResourceIds, ...resourceIds])]
                : saleableResourceIds.filter((id) => !resourceIds.includes(id));
              setSaleableResourceIds(next);
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatGroupSaleableText(row, t)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('providers.resourcePrice'),
      dataIndex: 'price',
      width: 260,
      render: (_value, row) => {
        const draft = priceDrafts[row.rowKey];
        const commonPrice = commonNumber(row.resources.map((resource) => toNumber(resource.overridePrice ?? resource.effectivePrice)));
        const value = draft === undefined || draft === null ? commonPrice : draft;
        const cost = formatResourceGroupCost(row.resources, t);
        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                aria-label={`${t('providers.resourcePrice')}:${row.code}`}
                min={0}
                precision={2}
                value={value}
                placeholder={t('providers.resourcePricePlaceholder')}
                style={{ width: '100%' }}
                onChange={(next) => setPriceDrafts((prev) => ({ ...prev, [row.rowKey]: next === null ? null : Number(next) }))}
              />
              <Button
                loading={savingPrice}
                disabled={value === null}
                onClick={() => {
                  if (value === null) return;
                  onSavePrices(row.resources.map((resource) => ({ resourceId: resource.resourceId, unitPrice: value })), () => {
                    setPriceDrafts((prev) => ({ ...prev, [row.rowKey]: null }));
                  });
                }}
              >
                {t('providers.resourceSavePrice')}
              </Button>
            </Space.Compact>
            <Space size={6} wrap>
              {formatGroupPriceStatusTag(row.resources, draft, t)}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('providers.resourceCost')}: {cost}</Typography.Text>
            </Space>
          </Space>
        );
      },
    },
  ];

  const allResourceIds = rows.flatMap((row) => row.resources.map((resource) => resource.resourceId));

  return (
    <Drawer
      className="ipx-provider-resource-drawer"
      title={provider
        ? t('providers.resourceConfiguratorTitleWithProvider', {
          provider: formatProviderName(provider.providerCode, t),
        })
        : t('providers.resourceConfiguratorTitle')}
      open={Boolean(provider)}
      width={1040}
      destroyOnClose
      onClose={onClose}
      extra={provider ? (
        <Space>
          <Button
            loading={syncing}
            disabled={!provider.capabilities.inventorySync}
            icon={<FolderOpenOutlined />}
            onClick={() => onSyncInventory(provider)}
          >
            {t('providers.syncInventory')}
          </Button>
          <Button onClick={() => {
            setSaleableResourceIds((prev) => [...new Set([...prev, ...allResourceIds])]);
          }}>{t('providers.resourceSelectAll')}</Button>
          <Button onClick={() => {
            setSaleableResourceIds((prev) => prev.filter((id) => !allResourceIds.includes(id)));
          }}>{t('providers.resourceClearAll')}</Button>
          <Button
            loading={savingPrice}
            disabled={changedPrices.length === 0}
            onClick={() => {
              onSavePrices(changedPrices, () => setPriceDrafts({}));
            }}
          >
            {t('providers.resourceSaveChangedPrices', { count: changedPriceGroups.length })}
          </Button>
          <Button
            type="primary"
            loading={savingProvider}
            disabled={changedSaleableResources.length === 0}
            onClick={() => onSaveSaleableResources(provider, changedSaleableResources, markSaleabilitySaved)}
          >
            {t('providers.saveSaleableResources')}
          </Button>
        </Space>
      ) : null}
    >
      {resourceConfigMatrixQuery.isLoading ? (
        <Skeleton active />
      ) : resourceConfigMatrixQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={t('error')}
          description={formatProviderReason(t, getReasonKey(resourceConfigMatrixQuery.error))}
        />
      ) : (
        <Space className="ipx-provider-resource-workbench" direction="vertical" size={12} style={{ width: '100%' }}>
        {actionError ? (
          <Alert
            type="error"
            showIcon
            message={t('providers.resourceSaveFailedTitle')}
            description={actionError}
          />
        ) : null}
        <ProviderSyncResultPanel result={syncResult} error={syncError} />
        <Space className="ipx-provider-resource-toolbar" direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                value={search}
                placeholder={t('providers.resourceSearchPlaceholder')}
                style={{ width: 240 }}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setResourcePage(1);
                }}
              />
              <Select<ResourceSetupFilter>
                value={filter}
                style={{ width: 150 }}
                onChange={(value) => {
                  setFilter(value);
                  setResourcePage(1);
                }}
                options={[
                  { value: 'ALL', label: t('providers.resourceFilterAll') },
                  { value: 'ENABLED', label: t('providers.resourceFilterEnabled') },
                  { value: 'SYNCED', label: t('providers.resourceFilterSynced') },
                  { value: 'UNPRICED', label: t('providers.resourceFilterUnpriced') },
                ]}
              />
              <Select<ResourceSaleFilter>
                value={saleFilter}
                style={{ width: 150 }}
                onChange={(value) => {
                  setSaleFilter(value);
                  setResourcePage(1);
                }}
                options={[
                  { value: 'ALL', label: t('providers.resourceFilterAllSale') },
                  { value: 'SALEABLE', label: t('providers.resourceSaleable') },
                  { value: 'UNSALEABLE', label: t('providers.resourceUnsaleable') },
                ]}
              />
            </Space>
            <Space size={8} wrap>
              <Tag color="blue">{t('providers.resourceVisibleCount', { count: visibleCount })}</Tag>
              <Tag color="green">{t('providers.resourceEnabledCount', { count: enabledCount })}</Tag>
              {changedPriceGroups.length > 0 ? <Tag color="orange">{t('providers.resourceChangedPriceCount', { count: changedPriceGroups.length })}</Tag> : null}
              {changedSaleableResources.length > 0 ? <Tag color="orange">{t('providers.resourceChangedSaleableCount', { count: changedSaleableResources.length })}</Tag> : null}
            </Space>
          </Space>
        </Space>
      <Table<ProviderResourceConfigRow>
        className="ipx-provider-resource-table"
        rowKey="rowKey"
        size="small"
        loading={resourceConfigMatrixQuery.isFetching}
        pagination={{
          current: resourcePage,
          pageSize: resourceConfigMatrixQuery.pageSize,
          total: resourceConfigMatrixQuery.total,
          showSizeChanger: false,
          onChange: (page) => setResourcePage(page),
        }}
        columns={columns}
        dataSource={visibleRows}
        scroll={{ x: 920, y: 'calc(100vh - 260px)' }}
      />
      </Space>
      )}
    </Drawer>
  );
}

function buildProviderResourceRows(
  provider: ProviderAccountListItem,
  matrixItems: PricingMatrixItem[],
  saleableResourceIds: string[],
): ProviderResourceConfigRow[] {
  const saleableSet = new Set(saleableResourceIds);
  const providerResources = matrixItems.filter((item) => item.providerCode === provider.providerCode);

  return providerResources.map((resource) => {
    const location = formatResourceLocationZh(resource);
    const enabled = saleableSet.has(resource.resourceId);
    return {
      code: resource.code,
      countryCode: resourceCountryCode(resource.code),
      name: location.country,
      detail: location.detail,
      enabled,
      enabledCount: enabled ? 1 : 0,
      resource,
      resources: [resource],
      rowKey: resource.resourceId,
    };
  });
}

function dedupeMatrixItemsByResourceId(items: PricingMatrixItem[]): PricingMatrixItem[] {
  const byId = new Map<string, PricingMatrixItem>();
  for (const item of items) {
    byId.set(item.resourceId, item);
  }
  return [...byId.values()];
}

function normalizeMatrixTotal(total: number, fallback: number): number {
  return Number.isFinite(total) && total >= 0 ? total : fallback;
}

function normalizeMatrixPageSize(pageSize: number): number {
  return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : PROVIDER_MATRIX_PAGE_SIZE;
}

function isMatrixItemEnabled(item: PricingMatrixItem): boolean {
  return item.status === 'ACTIVE' && item.isSaleable;
}

function formatGroupSaleableText(row: ProviderResourceConfigRow, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (row.enabledCount === 0) return t('providers.resourceUnsaleable');
  if (row.enabledCount === row.resources.length) return t('providers.resourceSaleable');
  return t('providers.resourcePartialSaleable', { enabled: row.enabledCount, total: row.resources.length });
}

function formatGroupPriceStatusTag(
  resources: PricingMatrixItem[],
  draft: number | null | undefined,
  t: (key: string) => string,
): React.ReactElement {
  if (draft !== null && draft !== undefined) {
    return <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('providers.resourcePriced')}</Tag>;
  }
  const pricedCount = resources.filter((resource) => resource.effectivePrice).length;
  if (pricedCount === 0) return <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('providers.resourceUnpriced')}</Tag>;
  if (pricedCount === resources.length) return <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('providers.resourcePriced')}</Tag>;
  return <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('providers.resourcePartialPriced')}</Tag>;
}

function formatResourceGroupCost(
  resources: PricingMatrixItem[],
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  const knownCosts = resources
    .map((resource) => {
      const amount = toNumber(resource.upstreamCost);
      if (amount === null) return null;
      const currency = resource.upstreamCostCurrency ?? resource.currency ?? 'CNY';
      const label = formatMoneyAmount(amount, currency);
      return label ? { amount, currency, label } : null;
    })
    .filter((value): value is { amount: number; currency: string; label: string } => value !== null);
  if (knownCosts.length === 0) return t('providers.resourceCostMissing');

  const missingCount = resources.length - knownCosts.length;
  const currencies = [...new Set(knownCosts.map((cost) => cost.currency))];
  let label: string;
  if (currencies.length === 1) {
    const amounts = [...new Set(knownCosts.map((cost) => cost.amount))].sort((left, right) => left - right);
    label = amounts.length === 1
      ? knownCosts[0]!.label
      : t('providers.resourceCostRange', {
        min: formatMoneyAmount(amounts[0]!, currencies[0]!) ?? `${amounts[0]} ${currencies[0]}`,
        max: formatMoneyAmount(amounts[amounts.length - 1]!, currencies[0]!) ?? `${amounts[amounts.length - 1]} ${currencies[0]}`,
      });
  } else {
    const uniqueLabels = [...new Set(knownCosts.map((cost) => cost.label))];
    label = uniqueLabels.slice(0, 3).join(' / ');
    if (uniqueLabels.length > 3) {
      label = t('providers.resourceCostListMore', { costs: label, count: uniqueLabels.length });
    }
  }

  return missingCount > 0 ? t('providers.resourceCostPartialKnown', { cost: label }) : label;
}

function formatResourceGroupStatus(resources: PricingMatrixItem[], t: (key: string) => string): string {
  const statuses = [...new Set(resources.map((resource) => resource.status))];
  return statuses.length === 1 ? formatResourceStatus(statuses[0]!, t) : t('providers.resourceStatusMixed');
}

function commonNumber(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length !== values.length || known.length === 0) return null;
  const [first] = known;
  return known.every((value) => value === first) ? first! : null;
}

function formatProviderName(providerCode: ProviderCode, t: (key: string) => string): string {
  const fallback = PROVIDER_NAME[providerCode] ?? providerCode;
  const label = t(`providers.name.${providerCode}`);
  return label === `providers.name.${providerCode}` ? fallback : label;
}

function resourceCountryCode(code: string): string {
  return code.trim().toUpperCase().split(/[:\-_]/)[0] || code;
}

function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatResourceStatus(status: string, t: (key: string) => string): string {
  if (status === 'ACTIVE') return t('providers.resourceStatusActive');
  if (status === 'HIDDEN') return t('providers.resourceStatusHidden');
  if (status === 'DISABLED') return t('providers.resourceStatusDisabled');
  return status;
}

function formatUpstreamRawStatus(status: string, t: (key: string) => string): string {
  const normalized = status.trim().toLowerCase();
  if (['ready', 'success', 'succeeded', 'ok'].includes(normalized)) return t('providers.syncStatusReady');
  if (['failed', 'failure', 'error'].includes(normalized)) return t('providers.syncStatusFailed');
  if (['pending', 'running', 'processing'].includes(normalized)) return t('providers.syncStatusPending');
  return status;
}

function isProviderSyncInventoryResult(value: unknown): value is ProviderSyncInventoryResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProviderSyncInventoryResult>;
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

function buildCredential(values: ProviderFormValues, providerCode: ProviderCode): Record<string, string> | null {
  if (providerCode === 'IPIPD') {
    const appId = values.appId?.trim();
    const appSecret = values.appSecret?.trim();
    return appId || appSecret ? compactCredential({ appId, appSecret }) : null;
  }
  if (providerCode === 'NINE_EIGHT_FIVE') {
    const apikey = values.apikey?.trim();
    const zoneId = values.zoneId?.trim();
    return apikey || zoneId ? compactCredential({ apikey, zoneId }) : null;
  }
  const apikey = values.apikey?.trim();
  return apikey ? { apikey } : null;
}

function compactCredential(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value)) as Record<string, string>;
}

function defaultProviderBaseUrl(providerCode?: ProviderCode): string {
  if (providerCode === 'IPIPD') return 'https://api.ipipd.cn';
  if (providerCode === 'NINE_EIGHT_FIVE') return 'https://open-api.985proxy.com';
  if (providerCode === 'PR') return 'https://proxy-seller.com/personal/api/v1';
  return '';
}

function latestCheckedAt(results: Record<string, ProviderHealthCheckResult>): Date | null {
  const timestamps = Object.values(results).map((item) => new Date(item.checkedAt).getTime()).filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function getReasonKey(error: unknown): string {
  const apiError = error as ApiError | undefined;
  return apiError?.reasonKey || (error instanceof Error ? error.message : String(error));
}

function formatProviderReason(
  t: (key: string, values?: Record<string, unknown>) => string,
  reasonKey?: string | null,
): string {
  if (!reasonKey) return t('providers.reason.generic');
  const translationKeys = [
    `providers.reason.${reasonKey}`,
    `resources.reason.${reasonKey}`,
    `resources.unsaleableReasons.${reasonKey}`,
    `pricing.reason.${reasonKey}`,
  ];
  for (const key of translationKeys) {
    const label = t(key);
    if (label !== key) return label;
  }
  return t('providers.reason.generic');
}

function getProviderResourceActionError(t: (key: string, values?: Record<string, unknown>) => string, ...errors: unknown[]): string | undefined {
  const error = errors.find(Boolean);
  return error ? formatProviderReason(t, getReasonKey(error)) : undefined;
}
