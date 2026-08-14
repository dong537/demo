import React from 'react';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Input,
  InputNumber,
  Pagination,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, DollarOutlined, ExclamationCircleOutlined, ReloadOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { kpiCardStyle, surfaceCardStyle } from '../../shared/ui/surface';
import { PROVIDER_OPTIONS, formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatMoneyAmount } from '../../shared/money/money';
import { DEFAULT_PRICING_DURATION_DAYS } from './pricing-duration';
import { formatPricingFailure, getPricingReasonKey } from './pricing-errors';

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

interface MatrixFilters {
  durationDays: number;
  currency: string;
  providerCode?: string;
  ipType?: string;
  search?: string;
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

const DEFAULT_FILTERS: MatrixFilters = {
  durationDays: DEFAULT_PRICING_DURATION_DAYS,
  currency: 'CNY',
};
const DEFAULT_MATRIX_PAGE_SIZE = 20;

export function buildMatrixOverrideBody(resourceId: string, durationDays: number, unitPrice: number, currency: string) {
  return {
    resourceId,
    durationDays,
    unitPrice: String(unitPrice),
    currency,
  };
}

function getReasonKey(error: unknown): string {
  return getPricingReasonKey(error, 'error');
}

function formatPricingMatrixFailure(error: unknown, t: (key: string) => string): string {
  return formatPricingFailure(error, t);
}

function compactTraceValue(value: string, visibleChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= visibleChars) return trimmed;
  return `${trimmed.slice(0, visibleChars)}...`;
}

export function PricingMatrixFeature() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<MatrixFilters>(DEFAULT_FILTERS);
  const [page, setPage] = React.useState(1);
  const [drafts, setDrafts] = React.useState<Record<string, number | null>>({});
  const [syncResult, setSyncResult] = React.useState<SyncInventoryResult | null>(null);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const matrixQuery = useQuery({
    queryKey: ['pricing-matrix', filters, page],
    queryFn: () =>
      apiRequest<PageResult<PricingMatrixItem>>(
        `/api/pricing/matrix${buildQuery({ ...filters, page, pageSize: DEFAULT_MATRIX_PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const saveOverrides = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(drafts).filter(([, value]) => isValidDraftPrice(value));
      for (const [resourceId, value] of entries) {
        try {
          await apiRequest('/api/pricing/overrides', {
            method: 'POST',
            body: JSON.stringify(buildMatrixOverrideBody(resourceId, filters.durationDays, Number(value), filters.currency)),
          });
        } catch (error) {
          throw new Error(getReasonKey(error));
        }
      }
    },
    onSuccess: () => {
      message.success(t('pricing.matrix.saveSuccess'));
      setDrafts({});
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet'] });
    },
  });

  const saveSingleOverride = useMutation({
    mutationFn: async (input: { resourceId: string; unitPrice: number }) => {
      await apiRequest('/api/pricing/overrides', {
        method: 'POST',
        body: JSON.stringify(buildMatrixOverrideBody(input.resourceId, filters.durationDays, input.unitPrice, filters.currency)),
      });
    },
    onSuccess: (_data, input) => {
      message.success(t('pricing.matrix.saveSuccess'));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[input.resourceId];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet'] });
    },
    onError: (error) => {
      message.error(formatPricingMatrixFailure(error, t));
    },
  });

  const syncUpstream = useMutation({
    mutationFn: async (providerCode: string) => {
      const data: unknown = await apiRequest<SyncInventoryResult>('/api/resources/sync-inventory', {
        method: 'POST',
        body: JSON.stringify({ providerCode }),
      });
      if (!isSyncInventoryResult(data)) {
        throw new Error('invalid_sync_inventory_response');
      }
      return data;
    },
    onMutate: () => {
      setSyncResult(null);
      setSyncError(null);
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setSyncError(null);
      if (isSyncInventoryIssue(data)) {
        message.warning(t('pricing.matrix.syncNoRowsTitle'));
      } else {
        message.success(t('pricing.matrix.syncUpstreamSuccess'));
      }
      void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-countries'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error) => {
      setSyncResult(null);
      setSyncError(formatPricingMatrixFailure(error, t));
    },
  });

  const items = matrixQuery.data?.items ?? [];
  const changedCount = Object.values(drafts).filter(isValidDraftPrice).length;
  const isTableLoading = matrixQuery.isLoading && items.length === 0;
  const priced = items.filter((item) => hasPositivePrice(item.effectivePrice)).length;
  const missingPrice = items.filter((item) => !hasPositivePrice(item.effectivePrice)).length;
  const saleable = items.filter((item) => item.status === 'ACTIVE' && item.isSaleable).length;
  const notSaleable = items.filter((item) => item.status !== 'ACTIVE' || !item.isSaleable).length;
  const columns = buildColumns({
    currency: filters.currency,
    drafts,
    onDraftChange: (resourceId, value) => setDrafts((prev) => ({ ...prev, [resourceId]: value })),
    onReset: (resourceId) => setDrafts((prev) => ({ ...prev, [resourceId]: null })),
    onModifyPrice: (resourceId, unitPrice) => saveSingleOverride.mutate({ resourceId, unitPrice }),
    savingResourceId: saveSingleOverride.isPending ? saveSingleOverride.variables?.resourceId ?? null : null,
    t,
  });

  const updateFilter = (patch: Partial<MatrixFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
    setDrafts({});
  };

  if (matrixQuery.isLoading) return <Skeleton active />;

  return (
    <Space className="ipx-pricing-page ipx-pricing-matrix-page" direction="vertical" size={16} style={{ width: '100%' }}>
      {(matrixQuery.error || saveOverrides.error) && (
        <Alert
          type="error"
          showIcon
          message={t('error')}
          description={formatPricingMatrixFailure(matrixQuery.error || saveOverrides.error, t)}
        />
      )}
      {syncError && (
        <Alert
          type="error"
          showIcon
          message={t('pricing.matrix.syncFailedTitle')}
          description={(
            <Space direction="vertical" size={4}>
              <Typography.Text type="danger" strong>{syncError}</Typography.Text>
              <Typography.Text type="secondary">{t('pricing.matrix.syncFailureHint')}</Typography.Text>
            </Space>
          )}
        />
      )}
      {syncUpstream.isPending && (
        <Alert
          type="info"
          showIcon
          message={t('pricing.matrix.syncPendingTitle')}
          description={t('pricing.matrix.syncPendingHint')}
        />
      )}
      {syncResult && !syncUpstream.error && (
        <Alert
          type={isSyncInventoryIssue(syncResult) ? 'warning' : 'success'}
          showIcon
          message={syncResult.synced === 0 || syncResult.attempted === 0 ? t('pricing.matrix.syncNoRowsTitle') : t('pricing.matrix.syncResultTitle')}
          description={(
            <Space direction="vertical" size={8}>
              {syncResult.synced === 0 || syncResult.attempted === 0 ? (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{t('pricing.matrix.syncNoRowsHint')}</Typography.Text>
                  <Typography.Text type="danger" strong>{t('pricing.matrix.syncNoSuccess')}</Typography.Text>
                  <Typography.Text type="secondary">{t('pricing.matrix.syncZeroWriteOperatorHint')}</Typography.Text>
                </Space>
              ) : null}
              <Space size={[8, 8]} wrap>
                <Tag>{t('pricing.matrix.syncAttempted', { count: syncResult.attempted })}</Tag>
                <Tag color={syncResult.synced > 0 ? 'green' : 'orange'}>{t('pricing.matrix.syncWritten', { count: syncResult.synced })}</Tag>
                <Tag color="green">{t('pricing.matrix.syncCreated', { count: syncResult.created })}</Tag>
                <Tag color="blue">{t('pricing.matrix.syncUpdated', { count: syncResult.updated })}</Tag>
                <Tag color="orange">{t('pricing.matrix.syncSkipped', { count: syncResult.skipped })}</Tag>
                <Tag color={syncResult.failed > 0 ? 'red' : undefined}>{t('pricing.matrix.syncFailed', { count: syncResult.failed })}</Tag>
                <Tag>{formatUpstreamRawStatus(syncResult.upstreamRawStatus, t)}</Tag>
                <Typography.Text type="secondary">
                  {t('pricing.matrix.syncCountries', {
                    countries: syncResult.countries.length > 0 ? syncResult.countries.map((countryCode) => formatRegionNameZh({ countryCode })).join(', ') : '-',
                  })}
                </Typography.Text>
              </Space>
            </Space>
          )}
        />
      )}

      <Row className="ipx-pricing-kpi-grid" gutter={[16, 16]}>
        <Kpi title={t('pricing.matrix.lines')} value={matrixQuery.data?.total ?? 0} icon={<DollarOutlined />} />
        <Kpi title={t('pricing.matrix.priced')} value={priced} accent="#16a34a" icon={<CheckCircleOutlined />} />
        <Kpi title={t('pricing.matrix.missingPrice')} value={missingPrice} accent="#dc2626" icon={<ExclamationCircleOutlined />} />
        <Kpi title={t('pricing.matrix.saleableCount')} value={saleable} accent="#2563eb" icon={<CheckCircleOutlined />} />
        <Kpi title={t('pricing.matrix.notSaleableCount')} value={notSaleable} accent="#d97706" icon={<StopOutlined />} />
      </Row>

      <Card className="ipx-pricing-workbench-card" style={surfaceCardStyle()} styles={{ body: { padding: 16 } }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space className="ipx-pricing-toolbar" direction="vertical" size={12} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Space direction="vertical" size={2}>
                <Typography.Text strong>{t('pricing.matrix.toolbarTitle')}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('pricing.matrix.toolbarHint')}</Typography.Text>
              </Space>
              <Space wrap>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: PROVIDER_OPTIONS.filter((option) => option.value !== 'UPSTREAM_API').map((option) => ({
                      key: option.value,
                      label: option.label,
                    })),
                    onClick: ({ key }) => syncUpstream.mutate(key),
                  }}
                >
                  <Button loading={syncUpstream.isPending} icon={<ReloadOutlined />}>
                    {t('pricing.matrix.syncUpstream')}
                  </Button>
                </Dropdown>
                <Button icon={<ReloadOutlined />} onClick={() => void matrixQuery.refetch()} loading={matrixQuery.isFetching}>
                  {t('pricing.matrix.refresh')}
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  disabled={changedCount === 0}
                  loading={saveOverrides.isPending}
                  onClick={() => saveOverrides.mutate()}
                >
                  {t('pricing.matrix.saveAll')} ({changedCount})
                </Button>
              </Space>
            </div>
            <Space wrap>
              <Input.Search
                allowClear
                style={{ width: 260 }}
                placeholder={t('pricing.matrix.search')}
                onSearch={(value) => updateFilter({ search: value || undefined })}
              />
              <Select
                allowClear
                style={{ width: 180 }}
                placeholder={t('pricing.matrix.provider')}
                options={PROVIDER_OPTIONS}
                value={filters.providerCode}
                onChange={(value) => updateFilter({ providerCode: value })}
              />
              <Select
                allowClear
                style={{ width: 150 }}
                placeholder={t('pricing.matrix.ipType')}
                options={buildIpTypeOptions(t)}
                value={filters.ipType}
                onChange={(value) => updateFilter({ ipType: value })}
              />
            </Space>
            <Space size={8} wrap>
              <Tag color="blue">{t('pricing.matrix.visibleCount', { count: items.length, total: matrixQuery.data?.total ?? 0 })}</Tag>
              <Tag color="geekblue">{t('pricing.matrix.source')}</Tag>
              <Tag color="green">{t('pricing.matrix.pricedCount', { count: priced })}</Tag>
              <Tag color={missingPrice > 0 ? 'red' : undefined}>{t('pricing.matrix.missingPriceCount', { count: missingPrice })}</Tag>
              <Tag color={changedCount > 0 ? 'orange' : undefined}>{t('pricing.matrix.changedCount', { count: changedCount })}</Tag>
            </Space>
          </Space>
          <Table
            className="ipx-pricing-table-card"
            rowKey="resourceId"
            columns={columns}
            dataSource={items}
            loading={isTableLoading}
            pagination={false}
            locale={{ emptyText: t('empty') }}
            size="small"
            scroll={{ x: 960 }}
          />
        </Space>
      </Card>

      <div className="ipx-pricing-pagination-bar" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Pagination
          current={page}
          pageSize={DEFAULT_MATRIX_PAGE_SIZE}
          total={matrixQuery.data?.total ?? 0}
          showSizeChanger={false}
          showTotal={(total, range) => t('pricing.matrix.paginationTotal', { start: range[0], end: range[1], total })}
          onChange={(nextPage) => {
            setPage(nextPage);
          }}
        />
      </div>
    </Space>
  );
}

function buildColumns({
  currency,
  drafts,
  onDraftChange,
  onReset,
  onModifyPrice,
  savingResourceId,
  t,
}: {
  currency: string;
  drafts: Record<string, number | null>;
  onDraftChange: (resourceId: string, value: number | null) => void;
  onReset: (resourceId: string) => void;
  onModifyPrice: (resourceId: string, value: number) => void;
  savingResourceId: string | null;
  t: (key: string) => string;
}): ColumnsType<PricingMatrixItem> {
  return [
    {
      title: t('pricing.override.resource'),
      dataIndex: 'displayName',
      width: 260,
      fixed: 'left',
      render: (_value, item) => {
        const location = formatResourceLocationZh(item);
        return (
          <Space direction="vertical" size={4} style={{ minWidth: 0 }}>
            <Typography.Text strong ellipsis={{ tooltip: location.title }}>
              {location.title}
            </Typography.Text>
            <Space size={6} wrap>
              <Typography.Text type="secondary" copyable={{ text: item.code }} style={{ fontSize: 12 }}>
                {compactTraceValue(item.code, 20)}
              </Typography.Text>
              <Tag bordered={false}>{formatProviderLabel(item.providerCode)}</Tag>
              <Tag bordered={false}>{compactTraceValue(item.resourceId, 12)}</Tag>
            </Space>
          </Space>
        );
      },
    },
    {
      title: t('pricing.matrix.residentialProfile'),
      dataIndex: 'ipType',
      width: 190,
      render: (_value, item) => (
        <Space wrap size={[6, 6]}>
          <Tag color="blue">{getResidentialLineProfile(item, t)}</Tag>
          <Tag>{formatIpType(item.ipType, t)}</Tag>
        </Space>
      ),
    },
    {
      title: t('pricing.matrix.currentPrice'),
      dataIndex: 'effectivePrice',
      width: 180,
      render: (_value, item) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong>
            {formatMoneyAmount(toNumber(item.effectivePrice), item.currency ?? currency) ?? '-'}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('pricing.matrix.upstreamCost')}: {formatMoneyAmount(toNumber(item.upstreamCost), item.upstreamCostCurrency ?? item.currency ?? currency) ?? t('pricing.matrix.costMissing')}
          </Typography.Text>
          <Tag color={item.overridePrice ? 'blue' : undefined}>
            {item.overridePrice ? t('pricing.sandbox.source.RESOURCE_OVERRIDE') : t('pricing.sandbox.source.DEFAULT_TEMPLATE')}
          </Tag>
          {!hasPositivePrice(item.effectivePrice) && <Tag color="red">{t('pricing.matrix.reasonNoPrice')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('pricing.matrix.saleStatus'),
      dataIndex: 'status',
      width: 180,
      render: (_value, item) => {
        const draft = drafts[item.resourceId];
        const effectivePrice = draft === undefined || draft === null ? toNumber(item.effectivePrice) : draft;
        const notReadyReason = getNotReadyReason(item, effectivePrice, t);
        return (
          <Space wrap size={[6, 6]}>
            <Tag color={item.status === 'ACTIVE' ? 'green' : 'default'}>
              {formatResourceStatus(item.status, t)}
            </Tag>
            <Tag color={notReadyReason === null ? 'green' : 'orange'}>
              {notReadyReason === null ? t('pricing.matrix.ready') : notReadyReason}
            </Tag>
            <Tag color={item.isSaleable ? 'green' : 'default'}>
              {item.isSaleable ? t('pricing.matrix.saleable') : t('pricing.matrix.notSaleable')}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: t('pricing.matrix.modifyPrice'),
      dataIndex: 'overridePrice',
      width: 280,
      fixed: 'right',
      render: (_value, item) => {
        const draft = drafts[item.resourceId];
        const baseValue = toNumber(item.overridePrice ?? item.effectivePrice);
        const value = draft === undefined || draft === null ? baseValue : draft;
        const hasDraft = draft !== undefined && draft !== null;
        const isSavingThisRow = savingResourceId === item.resourceId;
        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                aria-label={t('pricing.matrix.overridePrice')}
                min={0}
                precision={2}
                value={value}
                addonAfter={currency}
                style={{ width: '100%' }}
                onChange={(next) => onDraftChange(item.resourceId, next === null ? null : Number(next))}
              />
              <Button disabled={!hasDraft} onClick={() => onReset(item.resourceId)}>{t('reset')}</Button>
            </Space.Compact>
            <Button
              type="primary"
              block
              loading={isSavingThisRow}
              disabled={value === null || isSavingThisRow}
              onClick={() => {
                if (value === null) return;
                onModifyPrice(item.resourceId, value);
              }}
            >
              {t('pricing.matrix.modifyPrice')}
            </Button>
          </Space>
        );
      },
    },
  ];
}

function Kpi({ title, value, accent, icon }: { title: string; value: number; accent?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 180px', minWidth: 180 }}>
      <Card className="ipx-pricing-kpi-card" style={kpiCardStyle(accent)} styles={{ body: { padding: 16 } }}>
        <Statistic title={title} value={value} prefix={icon} />
      </Card>
    </div>
  );
}

function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidDraftPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasPositivePrice(value: string | null | undefined): boolean {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0;
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

function isSyncInventoryIssue(result: SyncInventoryResult): boolean {
  return result.attempted === 0 || result.synced === 0 || result.failed > 0;
}

function buildIpTypeOptions(t: (key: string) => string) {
  return [
    { value: 'NATIVE', label: t('pricing.matrix.ipTypeValue.NATIVE') },
    { value: 'BROADCAST', label: t('pricing.matrix.ipTypeValue.BROADCAST') },
    { value: 'BOTH', label: t('pricing.matrix.ipTypeValue.BOTH') },
  ];
}

function formatUpstreamRawStatus(status: string, t: (key: string) => string): string {
  const normalized = status.trim().toLowerCase();
  if (['ready', 'success', 'succeeded', 'ok'].includes(normalized)) return t('pricing.matrix.syncStatusReady');
  if (['failed', 'failure', 'error'].includes(normalized)) return t('pricing.matrix.syncStatusFailed');
  if (['pending', 'running', 'processing'].includes(normalized)) return t('pricing.matrix.syncStatusPending');
  return status;
}

function formatResourceStatus(status: string, t: (key: string) => string): string {
  if (status === 'ACTIVE') return t('pricing.matrix.statusValue.ACTIVE');
  if (status === 'HIDDEN') return t('pricing.matrix.statusValue.HIDDEN');
  if (status === 'DISABLED') return t('pricing.matrix.statusValue.DISABLED');
  return status;
}

function formatIpType(ipType: string, t: (key: string) => string): string {
  if (ipType === 'NATIVE') return t('pricing.matrix.ipTypeValue.NATIVE');
  if (ipType === 'BROADCAST') return t('pricing.matrix.ipTypeValue.BROADCAST');
  if (ipType === 'BOTH') return t('pricing.matrix.ipTypeValue.BOTH');
  return ipType;
}

function getResidentialLineProfile(item: PricingMatrixItem, t: (key: string) => string): string {
  if (item.ipType === 'NATIVE') return t('pricing.matrix.residentialType.native');
  if (item.ipType === 'BROADCAST') return t('pricing.matrix.residentialType.broadcast');
  if (item.ipType === 'BOTH') return t('pricing.matrix.residentialType.dual');
  return t('pricing.matrix.residentialType.generic');
}

function getNotReadyReason(
  item: PricingMatrixItem,
  effectivePrice: number | null,
  t: (key: string) => string,
): string | null {
  if (item.status !== 'ACTIVE') return t('pricing.matrix.reasonInactive');
  if (!item.isSaleable) return t('pricing.matrix.reasonNotSaleable');
  if (!effectivePrice) return t('pricing.matrix.reasonNoPrice');
  return null;
}
