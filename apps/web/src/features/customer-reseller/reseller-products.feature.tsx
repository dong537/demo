import React from 'react';
import { Alert, Button, Card, Col, Input, InputNumber, Row, Select, Space, Statistic, Switch, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, CheckCircleOutlined, FileSyncOutlined, SaveOutlined, ShoppingCartOutlined, ShopOutlined, StopOutlined, TagsOutlined } from '@ant-design/icons';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { buildQuery, userApiRequest } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { formatDateTime } from '../../shared/time/time';
import { getBackendReason, resellerCompactInputStyle, resellerCompactSelectStyle, resellerHeroStyle, resellerIconStyle, resellerMetricBodyStyle, resellerMetricToneStyle, resellerSummaryStripStyle, resellerToolbarFiltersStyle, resellerToolbarStyle, resellerWorkspaceHeaderStyle } from './reseller-ui';

interface ResellerProduct {
  skuId: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  availableInventory: number | null;
  inventoryCapturedAt: string | null;
  inventoryIsStale: boolean | null;
  enabled: boolean;
  unitPrice: string | null;
  currency: string | null;
}

interface ProductDraft {
  enabled: boolean;
  unitPrice: string;
}

export function ResellerProductsFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<string | undefined>();
  const [drafts, setDrafts] = React.useState<Record<string, ProductDraft>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['customer-reseller-products', page, pageSize, search, status],
    queryFn: () => userApiRequest<{ page: number; pageSize: number; total: number; items: ResellerProduct[] }>(
      `/api/customer/reseller/products${buildQuery({ page, pageSize, search, status })}`,
    ),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { skuId: string; enabled: boolean; unitPrice?: string; currency?: string }) =>
      userApiRequest('/api/customer/reseller/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.products.saveSuccess'));
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['customer-reseller-products'] });
      void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const batchSaveMutation = useMutation({
    mutationFn: (products: Array<{ skuId: string; enabled: boolean; unitPrice?: string; currency?: string }>) =>
      userApiRequest('/api/customer/reseller/products', {
        method: 'POST',
        body: JSON.stringify({ products }),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.products.saveSuccess'));
      setActionError(null);
      setDrafts({});
      void qc.invalidateQueries({ queryKey: ['customer-reseller-products'] });
      void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const items = query.data?.items ?? [];
  const hasActiveFilters = Boolean(search || status);
  const enabledCount = items.filter((item) => getDraft(item, drafts[item.skuId]).enabled).length;
  const disabledCount = Math.max(items.length - enabledCount, 0);
  const missingPriceCount = items.filter((item) => {
    const draft = getDraft(item, drafts[item.skuId]);
    return draft.enabled && !draft.unitPrice.trim();
  }).length;
  const staleInventoryCount = items.filter((item) => item.inventoryIsStale === true).length;
  const changedProducts = items
    .map((item) => buildProductPayload(item, getDraft(item, drafts[item.skuId])))
    .filter((payload): payload is NonNullable<typeof payload> => Boolean(payload));

  const columns: ColumnsType<ResellerProduct> = [
    {
      title: t('customer.reseller.products.resource'),
      key: 'resource',
      width: 320,
      render: (_value, row) => {
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{row.name}</Typography.Text>
            {row.description && <Typography.Text type="secondary">{row.description}</Typography.Text>}
            <Space size={6} wrap>
              <Tag color="geekblue">{row.code}</Tag>
              <Tag color={row.status === 'ACTIVE' ? 'green' : 'default'}>{formatProductStatus(t, row.status)}</Tag>
            </Space>
          </Space>
        );
      },
    },
    {
      title: t('customer.reseller.products.source'),
      key: 'source',
      width: 190,
      render: () => (
        <Space direction="vertical" size={2}>
          <Tag color="geekblue">{t('customer.reseller.products.mainSite')}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('customer.reseller.products.sourcePool')}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.reseller.products.stock'),
      key: 'stock',
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{row.availableInventory === null ? t('customer.reseller.products.realtimeStock') : row.availableInventory}</Typography.Text>
          {row.inventoryIsStale ? <Tag color="orange">{t('customer.reseller.products.inventoryStale')}</Tag> : null}
          {row.inventoryCapturedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.inventoryCapturedAt)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('customer.reseller.products.enabled'),
      key: 'enabled',
      width: 110,
      render: (_value, row) => {
        const draft = getDraft(row, drafts[row.skuId]);
        return (
          <Switch
            checked={draft.enabled}
            onChange={(checked) => updateDraft(row.skuId, { enabled: checked })}
          />
        );
      },
    },
    {
      title: t('customer.reseller.products.price'),
      key: 'price',
      width: 220,
      render: (_value, row) => {
        const draft = getDraft(row, drafts[row.skuId]);
        return (
          <InputNumber
            min={0}
            precision={2}
            disabled={!draft.enabled}
            value={draft.unitPrice ? Number(draft.unitPrice) : null}
            style={{ width: 150 }}
            addonAfter={row.currency ?? 'CNY'}
            onChange={(value) => updateDraft(row.skuId, { unitPrice: value === null ? '' : String(value) })}
          />
        );
      },
    },
    {
      title: t('customer.reseller.products.saleStatus'),
      key: 'saleStatus',
      width: 150,
      render: (_value, row) => {
        const draft = getDraft(row, drafts[row.skuId]);
        if (!draft.enabled) return <Tag>{t('customer.reseller.products.disabledOnly')}</Tag>;
        if (!draft.unitPrice.trim()) return <Tag color="orange">{t('customer.reseller.products.missingPrice')}</Tag>;
        return <Tag color="green">{t('customer.reseller.products.saleReady')}</Tag>;
      },
    },
    {
      title: t('customer.reseller.products.actions'),
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_value, row) => {
        const payload = buildProductPayload(row, getDraft(row, drafts[row.skuId]));
        return (
          <Button
            icon={<SaveOutlined />}
            disabled={!payload}
            loading={saveMutation.isPending}
            onClick={() => payload && saveMutation.mutate(payload)}
          >
            {t('save')}
          </Button>
        );
      },
    },
  ];

  function updateDraft(skuId: string, patch: Partial<ProductDraft>) {
    const item = items.find((product) => product.skuId === skuId);
    if (!item) return;
    setDrafts((current) => ({
      ...current,
      [skuId]: { ...getDraft(item, current[skuId]), ...patch },
    }));
  }

  return (
    <div className="ipx-reseller-page ipx-reseller-products-page">
      <PageHeader
        kicker={t('customer.reseller.kicker')}
        title={t('customer.reseller.products.title')}
        description={t('customer.reseller.products.description')}
      />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card className="ipx-reseller-hero ipx-reseller-products-hero ipx-reseller-management-hero" variant="borderless" style={resellerHeroStyle()}>
          <Space align="start" size={14} style={resellerWorkspaceHeaderStyle}>
            <Space align="start" size={14}>
              <span className="ipx-reseller-products-icon" style={resellerIconStyle}><ShopOutlined /></span>
              <Space direction="vertical" size={4}>
                <Typography.Text strong>{t('customer.reseller.products.noticeTitle')}</Typography.Text>
                <Typography.Text type="secondary">{t('customer.reseller.products.notice')}</Typography.Text>
                <Space size={6} wrap>
                  <Tag color="geekblue">{t('customer.reseller.products.sourcePool')}</Tag>
                  <Tag color="blue">{t('customer.reseller.products.salePath')}</Tag>
                </Space>
              </Space>
            </Space>
            <Space wrap>
              <Button icon={<TagsOutlined />} onClick={() => navigate({ to: '/reseller/pricing' as never })}>
                {t('customer.reseller.cards.pricing')}
              </Button>
              <Button icon={<ShoppingCartOutlined />} onClick={() => navigate({ to: '/reseller/orders' as never })}>
                {t('customer.reseller.cards.orders')}
              </Button>
            </Space>
          </Space>
        </Card>
        <div style={resellerSummaryStripStyle}>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} lg={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-products-metric-card" variant="borderless" style={resellerMetricToneStyle('#315cff')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.products.metrics.total')} value={query.data?.total ?? '-'} prefix={<AppstoreOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-products-metric-card" variant="borderless" style={resellerMetricToneStyle('#16a34a')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.products.metrics.enabled')} value={query.data ? enabledCount : '-'} prefix={<CheckCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-products-metric-card" variant="borderless" style={resellerMetricToneStyle('#64748b')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.products.metrics.disabled')} value={query.data ? disabledCount : '-'} prefix={<StopOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-products-metric-card" variant="borderless" style={resellerMetricToneStyle('#f59e0b')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.products.metrics.changed')} value={query.data ? changedProducts.length : '-'} prefix={<SaveOutlined />} />
            </Card>
          </Col>
        </Row>
        </div>
      {query.isFetching && !query.isLoading && (
        <Alert type="info" showIcon message={t('customer.reseller.products.refreshing')} />
      )}
      {(saveMutation.isPending || batchSaveMutation.isPending) && (
        <Alert type="warning" showIcon message={t('customer.reseller.products.savePending')} />
      )}
      {actionError && <Alert type="error" message={t('error')} description={actionError} showIcon closable onClose={() => setActionError(null)} />}
        {query.data && items.length === 0 && hasActiveFilters && (
          <Alert
            type="warning"
            showIcon
            message={t('customer.reseller.products.filteredEmpty')}
            description={t('customer.reseller.products.filteredEmptyDesc')}
          />
        )}
        {query.data && items.length > 0 && missingPriceCount > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t('customer.reseller.products.missingPriceWarning', { count: missingPriceCount })}
          />
        )}
        <Alert
          type="info"
          showIcon
          message={t('customer.reseller.products.sourceTruth')}
        />
        <div className="ipx-reseller-table-card ipx-reseller-products-table-card">
          <ListPage
            query={query}
            columns={columns}
            rowKey="skuId"
            emptyText={t('customer.reseller.products.empty')}
            errorDescription={(error) => getBackendReason(error, t)}
            toolbar={(
              <div className="ipx-reseller-toolbar ipx-reseller-products-toolbar" style={resellerToolbarStyle}>
                <div style={resellerToolbarFiltersStyle}>
                  <Input.Search
                    placeholder={t('customer.reseller.products.searchPlaceholder')}
                    allowClear
                    size="middle"
                    style={resellerCompactInputStyle}
                    onSearch={(value) => { setSearch(value.trim()); setPage(1); }}
                  />
                  <Select
                    placeholder={t('customer.reseller.products.statusFilter')}
                    allowClear
                    size="middle"
                    style={resellerCompactSelectStyle}
                    value={status}
                    onChange={(value) => { setStatus(value); setPage(1); }}
                    options={[
                      { value: 'ENABLED', label: t('customer.reseller.products.enabledOnly') },
                      { value: 'DISABLED', label: t('customer.reseller.products.disabledOnly') },
                    ]}
                  />
                </div>
                <Space wrap>
                  {status ? <Tag color="processing">{t('customer.reseller.products.summary.statusFilter', { status: formatProductSaleFilter(t, status) })}</Tag> : null}
                  {search ? <Tag>{t('customer.reseller.products.summary.keywordFilter', { keyword: search })}</Tag> : null}
                  <Tag color="blue">{t('customer.reseller.products.summary.total', { total: query.data?.total ?? 0 })}</Tag>
                  <Tag color="geekblue">{t('customer.reseller.products.summary.source')}</Tag>
                  <Tag>{t('customer.reseller.products.summary.currentPage', { count: items.length })}</Tag>
                  <Tag color="green">{t('customer.reseller.products.summary.enabled', { count: enabledCount })}</Tag>
                  <Tag color={missingPriceCount > 0 ? 'orange' : undefined}>{t('customer.reseller.products.summary.missingPrice', { count: missingPriceCount })}</Tag>
                  <Tag color={staleInventoryCount > 0 ? 'orange' : undefined}>{t('customer.reseller.products.summary.staleInventory', { count: staleInventoryCount })}</Tag>
                  <Tag color={changedProducts.length > 0 ? 'orange' : undefined}>{t('customer.reseller.products.summary.changed', { count: changedProducts.length })}</Tag>
                  <Button icon={<FileSyncOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('refresh')}</Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    disabled={changedProducts.length === 0}
                    loading={batchSaveMutation.isPending}
                    onClick={() => batchSaveMutation.mutate(changedProducts)}
                  >
                    {t('customer.reseller.products.saveChanged', { count: changedProducts.length })}
                  </Button>
                </Space>
              </div>
            )}
            pagination={{
              page,
              pageSize,
              total: query.data?.total ?? 0,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
          />
        </div>
      </Space>
    </div>
  );
}

function getDraft(row: ResellerProduct, draft?: ProductDraft): ProductDraft {
  return draft ?? {
    enabled: row.enabled,
    unitPrice: row.unitPrice ?? '',
  };
}

function buildProductPayload(row: ResellerProduct, draft: ProductDraft): { skuId: string; enabled: boolean; unitPrice?: string; currency?: string } | null {
  const normalizedPrice = draft.unitPrice.trim();
  if (draft.enabled === row.enabled && normalizedPrice === (row.unitPrice ?? '')) return null;
  if (!draft.enabled) return { skuId: row.skuId, enabled: false };
  if (!normalizedPrice) return null;
  return {
    skuId: row.skuId,
    enabled: true,
    unitPrice: normalizedPrice,
    currency: row.currency ?? 'CNY',
  };
}

function formatProductStatus(t: (key: string) => string, value?: string | null): string {
  if (value === 'ACTIVE') return t('customer.reseller.products.status.active');
  if (value === 'HIDDEN') return t('customer.reseller.products.status.hidden');
  if (value === 'DISABLED') return t('customer.reseller.products.status.disabled');
  return t('customer.reseller.products.unknown');
}

function formatProductSaleFilter(t: (key: string) => string, value?: string | null): string {
  if (value === 'ENABLED') return t('customer.reseller.products.enabledOnly');
  if (value === 'DISABLED') return t('customer.reseller.products.disabledOnly');
  return t('customer.reseller.products.unknown');
}
