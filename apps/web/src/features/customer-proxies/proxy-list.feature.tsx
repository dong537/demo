import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, FileTextOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { formatIpTypeZh, formatProtocolZh, formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatCustomerChannelLabel } from '../../shared/provider/provider-labels';
import { formatDateTime } from '../../shared/time/time';
import { formatProxyStatusZh, proxyStatusColor } from '../../shared/proxy/proxy-labels';
import { ProxyCopyModal } from './proxy-copy-modal';

interface CustomerProxyDto {
  id: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  orderId?: string | null;
  providerCode?: string | null;
  protocol?: string | null;
  countryCode: string;
  regionCode?: string | null;
  ipType?: string | null;
  status: string;
  expiresAt: string;
  businessType?: string | null;
  userNote?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

type ProxyLifecycleAction = 'renew';
type ProxyBatchLifecycleAction = 'batch-renew';
type ProxyLifecyclePathAction = ProxyLifecycleAction | 'change-password' | 'switch-ip';
type ProxyBatchLifecyclePathAction = ProxyBatchLifecycleAction | 'batch-change-password' | 'batch-switch-ip';
type ProxyExportFormat = 'IP_PORT' | 'IP_PORT_AUTH' | 'AUTH_AT_IP_PORT' | 'HTTP_URL' | 'SOCKS5_URL';
type StatusTab = 'ALL' | 'ACTIVE' | 'PROVISIONING' | 'EXPIRING' | 'EXPIRED' | 'NEEDS_ATTENTION';

const EXPORT_FORMAT_LABEL_KEYS: Record<ProxyExportFormat, string> = {
  IP_PORT: 'customer.proxies.exportFormats.ipPort',
  IP_PORT_AUTH: 'customer.proxies.exportFormats.ipPortAuth',
  AUTH_AT_IP_PORT: 'customer.proxies.exportFormats.authAtIpPort',
  HTTP_URL: 'customer.proxies.exportFormats.httpUrl',
  SOCKS5_URL: 'customer.proxies.exportFormats.socks5Url',
};

interface BatchLifecycleError {
  code: string;
  reasonKey: string;
  httpStatus: number;
}

type BatchLifecycleItem =
  | { proxyId: string; success: true; proxy: CustomerProxyDto }
  | { proxyId: string; success: false; error: BatchLifecycleError };

interface BatchLifecycleResult {
  totalCount: number;
  successCount: number;
  failureCount: number;
  items: BatchLifecycleItem[];
}

interface ProxyReasonDisplay {
  label: string;
  reasonKey: string;
  code?: string | null;
  httpStatus?: number | null;
}

export function buildProxyLifecyclePath(proxyId: string, action: ProxyLifecyclePathAction): string {
  return `/api/proxies/${encodeURIComponent(proxyId)}/${action}`;
}

export function buildProxyBatchLifecyclePath(action: ProxyBatchLifecyclePathAction): string {
  return `/api/proxies/${action}`;
}

export function buildProxyExportPath(format: ProxyExportFormat): string {
  return `/api/proxies/export${buildQuery({ format })}`;
}

export function CustomerProxyListFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [country, setCountry] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<StatusTab>('ALL');
  const [exportFormat, setExportFormat] = useState<ProxyExportFormat>('IP_PORT_AUTH');
  const [copyProxy, setCopyProxy] = useState<CustomerProxyDto | null>(null);
  const [detailProxy, setDetailProxy] = useState<CustomerProxyDto | null>(null);
  const [actionError, setActionError] = useState<ProxyReasonDisplay | null>(null);
  const [actionProxyId, setActionProxyId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchResult, setBatchResult] = useState<BatchLifecycleResult | null>(null);
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';

  const queryStatus = activeTab === 'ACTIVE' || activeTab === 'EXPIRED' ? activeTab : undefined;
  const query = useQuery({
    queryKey: ['customer-proxies', page, pageSize, queryStatus, country, search],
    queryFn: () =>
      userApiRequest<{ page: number; pageSize: number; total: number; items: CustomerProxyDto[] }>(
        `/api/proxies${buildQuery({ page, pageSize, status: queryStatus, countryCode: country, search })}`,
      ),
  });
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [page, pageSize, queryStatus, country, search]);

  const lifecycleMutation = useMutation({
    mutationFn: ({ proxy, action }: { proxy: CustomerProxyDto; action: ProxyLifecycleAction }) =>
      userApiRequest<CustomerProxyDto>(buildProxyLifecyclePath(proxy.id, action), {
        method: 'POST',
        body: JSON.stringify(action === 'renew'
          ? { durationDays: 30, idempotencyKey: globalThis.crypto.randomUUID() }
          : {}),
      }),
    onSuccess: (proxy) => {
      setActionError(null);
      setActionProxyId(null);
      message.success(t('customer.proxies.actionSuccess'));
      setCopyProxy(proxy);
      void qc.invalidateQueries({ queryKey: ['customer-proxies'] });
      void qc.invalidateQueries({ queryKey: ['customer-wallet', userId] });
    },
    onError: (error, variables) => {
      setActionProxyId(variables.proxy.id);
      setActionError(formatProxyActionReason(t, error));
    },
  });

  const batchLifecycleMutation = useMutation({
    mutationFn: ({ action, proxyIds }: { action: ProxyBatchLifecycleAction; proxyIds: string[] }) =>
      userApiRequest<BatchLifecycleResult>(buildProxyBatchLifecyclePath(action), {
        method: 'POST',
        body: JSON.stringify(action === 'batch-renew'
          ? { proxyIds, durationDays: 30, idempotencyKey: globalThis.crypto.randomUUID() }
          : { proxyIds }),
      }),
    onSuccess: (result) => {
      setActionError(null);
      setActionProxyId(null);
      setBatchResult(result);
      setSelectedRowKeys([]);
      message.success(t('customer.proxies.batchActionSuccess', {
        success: result.successCount,
        failure: result.failureCount,
      }));
      void qc.invalidateQueries({ queryKey: ['customer-proxies'] });
      void qc.invalidateQueries({ queryKey: ['customer-wallet', userId] });
    },
    onError: (error) => {
      setActionProxyId(null);
      setActionError(formatProxyActionReason(t, error));
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (format: ProxyExportFormat) => ({
      format,
      lines: await userApiRequest<string[]>(buildProxyExportPath(format)),
    }),
    onSuccess: ({ format, lines }) => {
      setActionProxyId(null);
      setActionError(null);
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `static-proxies-${format}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(t('customer.proxies.exportSuccess', {
        count: lines.length,
        format: t(EXPORT_FORMAT_LABEL_KEYS[format]),
      }));
    },
    onError: (error) => {
      setActionProxyId(null);
      setActionError(formatProxyActionReason(t, error));
    },
  });

  const items = query.data?.items ?? [];
  const stats = useMemo(() => buildProxyStats(items), [items]);
  const totalProxies = query.data?.total ?? 0;
  const metricUnavailable = query.isLoading || query.isError;
  const totalProxiesMetric = metricUnavailable ? '-' : totalProxies;
  const pageScopedMetric = metricUnavailable ? '-' : undefined;
  const currentPageSummary = metricUnavailable
    ? t('customer.proxies.currentPageUnavailable')
    : t('customer.proxies.currentPage', { count: items.length, total: totalProxies });
  const countryOptions = Array.from(new Set(items.map((item) => item.countryCode).filter(Boolean)))
    .map((value) => ({ value, label: formatRegionNameZh({ countryCode: value }) }));
  const selectedProxyIds = selectedRowKeys.map(String);
  const hasSelectedProxies = selectedProxyIds.length > 0;
  const tableEmptyDescriptionKey = search || country || activeTab !== 'ALL'
    ? 'customer.proxies.emptyFilteredDesc'
    : 'customer.proxies.emptyDesc';

  const runBatchAction = (action: ProxyBatchLifecycleAction) => {
    if (!hasSelectedProxies) return;
    setActionProxyId(null);
    setActionError(null);
    batchLifecycleMutation.mutate({ action, proxyIds: selectedProxyIds });
  };

  const openCopyModal = (proxy: CustomerProxyDto | null) => {
    if (!proxy) return;
    setCopyProxy(proxy);
  };

  const columns: ColumnsType<CustomerProxyDto> = [
    {
      title: t('customer.proxies.ip'),
      key: 'endpoint',
      width: 220,
      render: (_, row) => (
        <div className="ipx-proxy-endpoint">
          <Typography.Text code copyable className="ipx-proxy-endpoint-value">
            {formatProxyEndpoint(row)}
          </Typography.Text>
          <Typography.Text type="secondary" className="ipx-proxy-endpoint-user">
            {t('customer.proxies.credentialSummary', { username: row.username })}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('customer.proxies.resourceInfo'),
      key: 'resource',
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Space className="ipx-proxy-region" size={8}>
            <span className="ipx-proxy-region-dot">{countryFlagEmoji(row.countryCode)}</span>
            <Typography.Text strong>{getProxyLocationTitle(row)}</Typography.Text>
            <Tag style={{ marginInlineEnd: 0 }}>{formatRegionNameZh({ countryCode: row.countryCode })}</Tag>
          </Space>
          <Space size={6} wrap>
            <Tag>{formatCustomerChannelLabel(row.providerCode)}</Tag>
            <Tag>{formatProtocolZh(row.protocol)}</Tag>
            <Tag>{formatIpTypeZh(row.ipType)}</Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: t('customer.proxies.sourceOrder'),
      key: 'sourceOrder',
      width: 230,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text copyable={Boolean(row.orderId)}>{formatOptionalDetail(row.orderId)}</Typography.Text>
          <Typography.Text type="secondary">{t('customer.proxies.createdAt')}: {formatDateTime(row.createdAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.proxies.status'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => (
        <Tag color={proxyStatusColor(value)} style={{ marginInlineEnd: 0 }}>
          {formatProxyStatusZh(value)}
        </Tag>
      ),
    },
    {
      title: t('customer.proxies.expiresAt'),
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 220,
      render: (v: string, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text>{formatDateTime(v)}</Typography.Text>
          <Typography.Text type="secondary">{t('customer.proxies.updatedAtShort')}: {formatDateTime(row.updatedAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.proxies.actions'),
      key: 'actions',
      width: 250,
      render: (_: unknown, row: CustomerProxyDto) => {
        const rowRenewPending = lifecycleMutation.isPending && lifecycleMutation.variables?.proxy.id === row.id;
        const rowActionFailed = actionProxyId === row.id && Boolean(actionError);
        return (
          <Space className="ipx-proxy-row-actions" size={6} wrap>
            <Button size="small" className="ipx-proxy-row-action" onClick={() => setDetailProxy(row)}>
              {t('customer.proxies.detail')}
            </Button>
            <Button size="small" className="ipx-proxy-row-action ipx-proxy-row-action-copy" onClick={() => openCopyModal(row)}>
              {t('customer.proxies.copyFormats')}
            </Button>
            <Button
              size="small"
              className="ipx-proxy-row-action ipx-proxy-row-action-renew"
              loading={rowRenewPending}
              disabled={lifecycleMutation.isPending && !rowRenewPending}
              onClick={() => {
                setActionProxyId(row.id);
                setActionError(null);
                lifecycleMutation.mutate({ proxy: row, action: 'renew' });
              }}
            >
              {rowRenewPending ? t('customer.proxies.renewSubmitting') : t('customer.proxies.renew')}
            </Button>
            {rowActionFailed && (
              <Typography.Text type="danger">
                {t('customer.proxies.rowActionFailed', { reason: formatProxyReasonInline(actionError) })}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="ipx-proxy-list-page ipx-customer-page ipx-customer-proxies-page">
      {actionError && (
        <Alert
          type="error"
          message={t('customer.proxies.actionFailed')}
          description={<ProxyReasonMeta reason={actionError} tone="danger" />}
          showIcon
          closable
          onClose={() => setActionError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {query.isError && (
        <Alert
          type="error"
          message={t('error')}
          description={<ProxyReasonMeta reason={formatProxyActionReason(t, query.error)} tone="danger" />}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {(lifecycleMutation.isPending || batchLifecycleMutation.isPending || exportMutation.isPending) && (
        <Alert
          type="info"
          showIcon
          message={
            batchLifecycleMutation.isPending
              ? t('customer.proxies.batchPending')
              : exportMutation.isPending
                ? t('customer.proxies.exportPending')
                : t('customer.proxies.renewPending')
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        className="ipx-proxy-table-card ipx-customer-table-card"
        variant="borderless"
        style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none', border: '1px solid var(--ipx-border, #d8d8d8)' })}
        styles={{ body: { padding: 0 } }}
      >
        <div className="ipx-proxy-table-head">
          <Space direction="vertical" size={2}>
            <Typography.Text className="ipx-proxy-table-kicker">{t('customer.proxies.heroKicker')}</Typography.Text>
            <Typography.Title level={5} style={{ margin: 0 }}>{t('customer.proxies.title')}</Typography.Title>
          </Space>
          <Space className="ipx-proxy-table-head-meta" size={8} wrap>
            <Tag>{currentPageSummary}</Tag>
            <Tag color="blue">{t('customer.proxies.selectedWorkbenchCount', { count: selectedProxyIds.length })}</Tag>
          </Space>
        </div>
        <Tabs
          className="ipx-proxy-status-tabs"
          style={{ padding: '0 20px' }}
          activeKey={activeTab}
          onChange={(key) => { setActiveTab(key as StatusTab); setPage(1); }}
          items={[
            { key: 'ALL', label: `${t('customer.proxies.allStatus')} (${totalProxiesMetric})` },
            { key: 'ACTIVE', label: `${t('customer.proxies.normal')} (${pageScopedMetric ?? stats.active})` },
            { key: 'PROVISIONING', label: `${t('customer.proxies.provisioning')} (${pageScopedMetric ?? stats.provisioning})` },
            { key: 'EXPIRING', label: `${t('customer.proxies.expiringSoon')} (${pageScopedMetric ?? stats.expiringSoon})` },
            { key: 'EXPIRED', label: `${t('customer.proxies.expired')} (${pageScopedMetric ?? stats.expired})` },
            { key: 'NEEDS_ATTENTION', label: `${t('customer.proxies.needsAttention')} (${pageScopedMetric ?? stats.needsAttention})` },
          ]}
        />

        <div className="ipx-proxy-toolbar ipx-customer-toolbar">
          <Space direction="vertical" size={4} style={{ flex: '1 1 360px', minWidth: 280 }}>
            <Typography.Text type="secondary">{t('customer.proxies.toolbarFilter')}</Typography.Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<SearchOutlined />}
                placeholder={t('customer.proxies.searchPlaceholder')}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onPressEnter={() => { setSearch(searchInput.trim()); setPage(1); }}
              />
              <Button type="primary" onClick={() => { setSearch(searchInput.trim()); setPage(1); }}>
                {t('search')}
              </Button>
            </Space.Compact>
          </Space>
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">{t('customer.proxies.countryFilter')}</Typography.Text>
            <Select
              placeholder={t('customer.proxies.countryFilter')}
              allowClear
              value={country}
              style={{ width: 160 }}
              onChange={(v) => { setCountry(v || undefined); setPage(1); }}
              options={[{ value: '', label: t('customer.proxies.allCountries') }, ...countryOptions]}
            />
          </Space>
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">{t('customer.proxies.toolbarExport')}</Typography.Text>
            <Space.Compact>
              <Select
                value={exportFormat}
                style={{ width: 180 }}
                onChange={(value) => setExportFormat(value)}
                options={[
                  { value: 'IP_PORT', label: t('customer.proxies.exportFormats.ipPort') },
                  { value: 'IP_PORT_AUTH', label: t('customer.proxies.exportFormats.ipPortAuth') },
                  { value: 'AUTH_AT_IP_PORT', label: t('customer.proxies.exportFormats.authAtIpPort') },
                  { value: 'HTTP_URL', label: t('customer.proxies.exportFormats.httpUrl') },
                  { value: 'SOCKS5_URL', label: t('customer.proxies.exportFormats.socks5Url') },
                ]}
              />
              <Button icon={<FileTextOutlined />} loading={exportMutation.isPending} onClick={() => exportMutation.mutate(exportFormat)}>
                {t('customer.proxies.export')}
              </Button>
            </Space.Compact>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('customer.proxies.exportScopeHint')}
            </Typography.Text>
          </Space>
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">{t('customer.proxies.toolbarSelection')}</Typography.Text>
            <Space.Compact>
              <Button
                icon={<ReloadOutlined />}
                loading={query.isFetching}
                onClick={() => void query.refetch().then((result) => {
                  if (result.isError) {
                    message.error(t('customer.proxies.refreshFailed'));
                    return;
                  }
                  message.success(t('customer.proxies.refreshSuccess'));
                })}
                aria-label={t('refresh')}
              />
              <Button
                icon={<CopyOutlined />}
                disabled={selectedProxyIds.length !== 1}
                onClick={() => {
                  const proxy = items.find((item) => item.id === selectedProxyIds[0]) ?? null;
                  if (!proxy) {
                    message.warning(t('customer.proxies.copySelectOne'));
                    return;
                  }
                  openCopyModal(proxy);
                }}
              >
                {t('customer.proxies.copySelected')}
              </Button>
              <Button
                type="primary"
                aria-label={t('customer.proxies.batchRenew')}
                icon={<SyncOutlined />}
                disabled={!hasSelectedProxies}
                loading={batchLifecycleMutation.isPending}
                onClick={() => runBatchAction('batch-renew')}
              >
                {t('customer.proxies.batchRenew')}
              </Button>
            </Space.Compact>
          </Space>
          <Typography.Text type={hasSelectedProxies ? 'secondary' : undefined}>
            {t('customer.proxies.selectedCount', { count: selectedProxyIds.length })}
          </Typography.Text>
          {query.isFetching && !query.isLoading && (
            <Typography.Text type="secondary">
              {t('customer.proxies.refreshing')}
            </Typography.Text>
          )}
        </div>

        <Table<CustomerProxyDto>
          className="ipx-proxy-table"
          columns={columns}
          dataSource={items}
          rowKey="id"
          size="small"
          loading={query.isLoading}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            preserveSelectedRowKeys: false,
          }}
          onRow={(row) => ({
            style: selectedProxyIds.includes(row.id)
              ? { background: '#f5f9ff' }
              : isProxyProvisioning(row)
                ? { background: '#fffbe6' }
                : undefined,
          })}
          scroll={{ x: 'max-content' }}
          style={{ padding: '0 20px 20px' }}
          locale={{
            emptyText: query.isError ? null : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={8}>
                    <Typography.Title level={5} style={{ margin: 0 }}>{t('customer.proxies.emptyTitle')}</Typography.Title>
                    <Typography.Text type="secondary">{t(tableEmptyDescriptionKey)}</Typography.Text>
                    <Space size={8} wrap>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={query.isFetching}
                        onClick={() => void query.refetch().then((result) => {
                          if (result.isError) {
                            message.error(formatProxyReasonInline(formatProxyActionReason(t, result.error)));
                            return;
                          }
                          message.success(t('customer.proxies.refreshSuccess'));
                        })}
                      >
                        {t('refresh')}
                      </Button>
                      <Button size="small" type="primary" href="/customer/buy">
                        {t('customer.proxies.emptyBuyAction')}
                      </Button>
                    </Space>
                  </Space>
                }
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showTotal: (total) => t('total', { total }),
            showSizeChanger: false,
            size: 'small',
            style: { marginBlock: 10 },
          }}
        />
      </Card>

      {batchResult && (
        <BatchLifecycleResultDrawer
          result={batchResult}
          onClose={() => setBatchResult(null)}
          onCopyProxy={openCopyModal}
        />
      )}
      {detailProxy && (
        <ProxyDetailModal
          proxy={detailProxy}
          onClose={() => setDetailProxy(null)}
          onCopyProxy={openCopyModal}
        />
      )}
      {copyProxy && (
        <ProxyCopyModal
          proxy={copyProxy}
          onClose={() => setCopyProxy(null)}
        />
      )}
    </div>
  );
}

function ProxyDetailModal({
  proxy,
  onClose,
  onCopyProxy,
}: {
  proxy: CustomerProxyDto;
  onClose: () => void;
  onCopyProxy: (proxy: CustomerProxyDto) => void;
}) {
  const { t } = useTranslation();
  const endpoint = formatProxyEndpoint(proxy);
  const httpUrl = formatProxyUrl(proxy, 'http');
  const socks5Url = formatProxyUrl(proxy, 'socks5');
  const location = getProxyLocationTitle(proxy);

  return (
    <Modal
      className="ipx-proxy-detail-modal"
      title={t('customer.proxies.detailTitle')}
      open
      width={860}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space
        className="ipx-proxy-detail-drawer ipx-customer-drawer"
        data-testid="proxy-detail-modal"
        direction="vertical"
        size={16}
        style={{ width: '100%' }}
      >
        <div className="ipx-proxy-detail-summary">
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">{t('customer.proxies.detailEndpoint')}</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>{endpoint}</Typography.Title>
            <Space size={6} wrap>
              <Tag>{location}</Tag>
              <Tag>{formatCustomerChannelLabel(proxy.providerCode)}</Tag>
              <Tag>{formatProtocolZh(proxy.protocol)}</Tag>
              <Tag>{t('customer.proxies.orderId')}: {formatOptionalDetail(proxy.orderId)}</Tag>
            </Space>
          </Space>
          <Space wrap>
            <Tag color={proxyStatusColor(proxy.status)} style={{ marginInlineEnd: 0 }}>
              {formatProxyStatusZh(proxy.status)}
            </Tag>
            <Button
              size="small"
              icon={<CopyOutlined />}
              aria-label={t('customer.proxies.copyFormats')}
              onClick={() => {
                onClose();
                onCopyProxy(proxy);
              }}
            >
              {t('customer.proxies.copyFormats')}
            </Button>
          </Space>
        </div>
        {isProxyProvisioning(proxy) && (
          <Alert
            type="info"
            showIcon
            message={t('customer.proxies.deliveryPendingTitle')}
            description={t('customer.proxies.deliveryPendingDesc')}
          />
        )}
        <section className="ipx-proxy-detail-section">
          <Typography.Title level={5}>{t('customer.proxies.scanSummary')}</Typography.Title>
          <Alert
            type={isProxyProvisioning(proxy) ? 'info' : 'success'}
            showIcon
            message={isProxyProvisioning(proxy) ? t('customer.proxies.deliveryPendingTitle') : t('customer.proxies.detailReadyTitle')}
            description={isProxyProvisioning(proxy) ? t('customer.proxies.deliveryPendingDesc') : t('customer.proxies.detailReadyDesc')}
            style={{ marginBottom: 12 }}
          />
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <DetailRow label={t('customer.proxies.id')} value={proxy.id} />
            <DetailRow label={t('customer.proxies.orderId')} value={formatOptionalDetail(proxy.orderId)} />
            <DetailRow label={t('customer.proxies.location')} value={`${location} / ${formatRegionNameZh({ countryCode: proxy.countryCode })}`} />
            <DetailRow label={t('customer.proxies.updatedAt')} value={formatDateTime(proxy.updatedAt)} />
          </Space>
        </section>
        <section className="ipx-proxy-detail-section">
          <div className="ipx-proxy-detail-section-head">
            <Space direction="vertical" size={2}>
              <Typography.Title level={5}>{t('customer.proxies.connectionInfo')}</Typography.Title>
              <Typography.Text type="secondary">{t('customer.proxies.connectionInfoDesc')}</Typography.Text>
            </Space>
            <Button
              size="small"
              type="primary"
              ghost
              icon={<CopyOutlined />}
              onClick={() => {
                onClose();
                onCopyProxy(proxy);
              }}
            >
              {t('customer.proxies.copyAllFormats')}
            </Button>
          </div>
          <div className="ipx-proxy-connection-grid">
            <ConnectionCard label={t('customer.proxies.copyModal.ipPort')} value={endpoint} />
            <ConnectionCard label={t('customer.proxies.username')} value={proxy.username} />
            <ConnectionCard label={t('customer.proxies.password')} value={proxy.password} />
            <ConnectionCard label={t('customer.proxies.copyModal.httpUrl')} value={httpUrl} wide />
            <ConnectionCard label={t('customer.proxies.copyModal.socks5Url')} value={socks5Url} wide />
          </div>
        </section>
        <section className="ipx-proxy-detail-section">
          <Typography.Title level={5}>{t('customer.proxies.resourceInfo')}</Typography.Title>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <DetailRow label={t('customer.proxies.providerCode')} value={formatCustomerChannelLabel(proxy.providerCode)} />
            <DetailRow label={t('customer.proxies.location')} value={location} />
            <DetailRow label={t('customer.proxies.protocol')} value={formatProtocolZh(proxy.protocol)} />
            <DetailRow label={t('customer.proxies.ipType')} value={formatIpTypeZh(proxy.ipType)} />
            <DetailRow label={t('customer.proxies.businessType')} value={formatOptionalDetail(proxy.businessType)} />
          </Space>
        </section>
        <section className="ipx-proxy-detail-section">
          <Typography.Title level={5}>{t('customer.proxies.lifecycleInfo')}</Typography.Title>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <DetailRow label={t('customer.proxies.countryCode')} value={formatRegionNameZh({ countryCode: proxy.countryCode })} />
            <DetailRow label={t('customer.proxies.status')} value={<Tag color={proxyStatusColor(proxy.status)}>{formatProxyStatusZh(proxy.status)}</Tag>} />
            <DetailRow label={t('customer.proxies.expiresAt')} value={formatDateTime(proxy.expiresAt)} />
            <DetailRow label={t('customer.proxies.createdAt')} value={formatDateTime(proxy.createdAt)} />
            <DetailRow label={t('customer.proxies.updatedAt')} value={formatDateTime(proxy.updatedAt)} />
            <DetailRow label={t('customer.proxies.orderId')} value={formatOptionalDetail(proxy.orderId)} />
            <DetailRow label={t('customer.proxies.userNote')} value={formatOptionalDetail(proxy.userNote)} />
            <DetailRow label={t('customer.proxies.id')} value={proxy.id} />
          </Space>
        </section>
      </Space>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="ipx-proxy-detail-row">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong copyable={typeof value === 'string'}>
        {value}
      </Typography.Text>
    </div>
  );
}

function ConnectionCard({
  label,
  value,
  wide = false,
}: {
  label: React.ReactNode;
  value: string;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const copy = () => {
    void navigator.clipboard.writeText(value)
        .then(() => {
          message.success(t('customer.proxies.copyModal.copySuccess'));
        })
      .catch(() => {
        message.error(t('customer.proxies.copyModal.copyFailed'));
      });
  };

  return (
    <div className={wide ? 'ipx-proxy-connection-card ipx-proxy-connection-card-wide' : 'ipx-proxy-connection-card'}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Space.Compact style={{ width: '100%' }}>
        <Typography.Text code copyable={false} className="ipx-proxy-connection-value" style={{ flex: 1, minWidth: 0 }}>
          {value}
        </Typography.Text>
        <Tooltip title={t('customer.proxies.copyModal.copy')}>
          <Button size="small" icon={<CopyOutlined />} aria-label={t('customer.proxies.copyModal.copy')} onClick={copy} />
        </Tooltip>
      </Space.Compact>
    </div>
  );
}

function buildProxyStats(items: CustomerProxyDto[]) {
  const now = Date.now();
  const expiringSoon = items.filter((item) => {
    const expiry = new Date(item.expiresAt).getTime();
    return !Number.isNaN(expiry) && expiry > now && expiry <= now + 7 * 24 * 60 * 60 * 1000;
  }).length;
  return {
    active: items.filter((item) => item.status === 'ACTIVE').length,
    provisioning: items.filter((item) => item.status === 'PROVISIONING' || item.status === 'PENDING').length,
    expired: items.filter((item) => item.status === 'EXPIRED').length,
    expiringSoon,
    needsAttention: items.filter((item) => item.status === 'FAILED' || item.status === 'SUSPENDED').length,
    switchable: items.filter((item) => item.status === 'ACTIVE').length,
  };
}


function countryFlagEmoji(countryCode?: string): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}

function isProxyProvisioning(proxy: Pick<CustomerProxyDto, 'status'>): boolean {
  return proxy.status === 'PROVISIONING' || proxy.status === 'PENDING';
}

function formatProxyEndpoint(proxy: Pick<CustomerProxyDto, 'ip' | 'port'>): string {
  return `${proxy.ip}:${proxy.port}`;
}

function formatProxyUrl(proxy: Pick<CustomerProxyDto, 'ip' | 'port' | 'username' | 'password'>, protocol: 'http' | 'socks5'): string {
  return `${protocol}://${proxy.username}:${proxy.password}@${proxy.ip}:${proxy.port}`;
}

function getProxyLocationTitle(proxy: Pick<CustomerProxyDto, 'countryCode' | 'regionCode'>): string {
  return formatResourceLocationZh({
    code: proxy.regionCode || proxy.countryCode,
    countryCode: proxy.countryCode,
    name: proxy.regionCode,
    displayName: proxy.regionCode,
    upstreamResourceId: proxy.regionCode,
  }).title;
}

function formatOptionalDetail(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed || '-';
}

function isBatchSuccess(item: BatchLifecycleItem): item is Extract<BatchLifecycleItem, { success: true }> {
  return item.success;
}

function isBatchFailure(item: BatchLifecycleItem): item is Extract<BatchLifecycleItem, { success: false }> {
  return !item.success;
}

function BatchLifecycleResultDrawer({
  result,
  onClose,
  onCopyProxy,
}: {
  result: BatchLifecycleResult;
  onClose: () => void;
  onCopyProxy: (proxy: CustomerProxyDto) => void;
}) {
  const { t } = useTranslation();
  const successes = result.items.filter(isBatchSuccess);
  const failures = result.items.filter(isBatchFailure);

  return (
    <Drawer
      title={t('customer.proxies.batchResult.title')}
      open
      width={640}
      onClose={onClose}
    >
      <Space size="large" wrap style={{ marginBottom: 16 }}>
        <Typography.Text>
          {t('customer.proxies.batchResult.total', { count: result.totalCount })}
        </Typography.Text>
        <Typography.Text type="success">
          {t('customer.proxies.batchResult.success', { count: result.successCount })}
        </Typography.Text>
        <Typography.Text type={result.failureCount > 0 ? 'danger' : 'secondary'}>
          {t('customer.proxies.batchResult.failure', { count: result.failureCount })}
        </Typography.Text>
      </Space>
      {result.failureCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('customer.proxies.batchResult.partialFailureTitle')}
          description={t('customer.proxies.batchResult.partialFailureDesc')}
          style={{ marginBottom: 16 }}
        />
      )}

      {successes.length > 0 && (
        <>
          <Typography.Title level={5}>{t('customer.proxies.batchResult.successItems')}</Typography.Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {successes.map((item) => (
              <div key={item.proxyId} className="ipx-proxy-batch-card ipx-proxy-batch-card-success">
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{item.proxyId}</Typography.Text>
                  <Typography.Text>
                    {item.proxy.ip}:{item.proxy.port} / {item.proxy.username}
                  </Typography.Text>
                  <Button size="small" onClick={() => onCopyProxy(item.proxy)}>
                    {t('customer.proxies.copyFormats')}
                  </Button>
                </Space>
              </div>
            ))}
          </Space>
        </>
      )}

      {failures.length > 0 && (
        <>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            {t('customer.proxies.batchResult.failureItems')}
          </Typography.Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {failures.map((item) => (
              <div key={item.proxyId} className="ipx-proxy-batch-card ipx-proxy-batch-card-failure">
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{item.proxyId}</Typography.Text>
                  <ProxyReasonMeta reason={formatProxyBatchReason(t, item.error)} tone="danger" />
                </Space>
              </div>
            ))}
          </Space>
        </>
      )}
    </Drawer>
  );
}

function formatProxyActionReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): ProxyReasonDisplay {
  if (error instanceof ApiError) return formatProxyReasonKey(t, error.reasonKey, String(error.code), typeof error.code === 'number' ? error.code : null);
  return { label: t('error'), reasonKey: 'error' };
}

function formatProxyBatchReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: BatchLifecycleError,
): ProxyReasonDisplay {
  return formatProxyReasonKey(t, error.reasonKey, error.code, error.httpStatus);
}

function formatProxyReasonKey(
  t: (key: string, options?: Record<string, unknown>) => string,
  reasonKey?: string | null,
  code?: string | null,
  httpStatus?: number | null,
): ProxyReasonDisplay {
  if (!reasonKey) return { label: t('error'), reasonKey: 'error', code, httpStatus };
  const translationKey = `customer.proxies.reason.${reasonKey}`;
  const label = t(translationKey);
  return { label: label === translationKey ? t('customer.proxies.reason.generic') : label, reasonKey, code, httpStatus };
}

function formatProxyReasonInline(reason: ProxyReasonDisplay | null): string {
  if (!reason) return '';
  return reason.label;
}

function ProxyReasonMeta({
  reason,
  tone,
}: {
  reason: ProxyReasonDisplay;
  tone?: 'danger' | 'secondary';
}) {
  return (
    <Space direction="vertical" size={2}>
      <Typography.Text type={tone}>{reason.label}</Typography.Text>
    </Space>
  );
}
