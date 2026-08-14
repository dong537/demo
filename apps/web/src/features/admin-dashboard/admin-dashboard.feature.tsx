import React from 'react';
import { Alert, Card, Col, Empty, Progress, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd';
import {
  BarChartOutlined,
  DatabaseOutlined,
  DollarOutlined,
  NodeIndexOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest, buildQuery } from '../../shared/api/client';
import { useCurrentAdmin } from '../../shared/auth/current-user';
import { formatMoneyAmount } from '../../shared/money/money';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatDateTime } from '../../shared/time/time';
import { PageHeader } from '../../shared/ui/page-header';
import { kpiCardStyle, surfaceCardStyle } from '../../shared/ui/surface';
import type { PageResult } from '../../shared/ui/list-page';

interface TenantListItem {
  id: string;
  name: string;
  code: string;
  status: string;
  customerCount: number;
}

interface UserListItem {
  id: string;
  email: string;
  status: string;
}

interface OrderListItem {
  id: string;
  type?: string;
  status: string;
  totalPrice: string;
  currency: string;
  quantity: number;
  createdAt: string;
}

interface ProxyListItem {
  id: string;
  status: string;
  providerCode: string;
  countryCode: string;
  createdAt: string;
}

interface ResourceListItem {
  id: string;
  status: string;
  isSaleable: boolean;
}

interface ProviderListItem {
  id: string;
  providerCode: string;
  status: 'ACTIVE' | 'DISABLED';
}

const SAMPLE_PAGE_SIZE = 20;

export function AdminDashboardFeature() {
  const { t } = useTranslation();
  const currentAdmin = useCurrentAdmin();
  const ownerType = currentAdmin.data?.ownerType;
  const tenantId = currentAdmin.data?.tenantId ?? undefined;
  const isPlatformAdmin = ownerType === 'PLATFORM_ADMIN';
  const tenantQuery = tenantId ? { tenantId } : {};

  const tenantsQuery = useQuery({
    queryKey: ['admin-dashboard-tenants', ownerType, tenantId],
    queryFn: () => apiRequest<PageResult<TenantListItem>>(`/api/tenants${buildQuery({ page: 1, pageSize: SAMPLE_PAGE_SIZE })}`),
    enabled: isPlatformAdmin,
  });

  const usersQuery = useQuery({
    queryKey: ['admin-dashboard-users', tenantId],
    queryFn: () => apiRequest<PageResult<UserListItem>>(`/api/users${buildQuery({ page: 1, pageSize: SAMPLE_PAGE_SIZE, ...tenantQuery })}`),
    enabled: !!ownerType,
  });

  const ordersQuery = useQuery({
    queryKey: ['admin-dashboard-orders', tenantId],
    queryFn: () => apiRequest<PageResult<OrderListItem>>(`/api/orders${buildQuery({ page: 1, pageSize: SAMPLE_PAGE_SIZE, ...tenantQuery })}`),
    enabled: !!ownerType,
  });

  const proxiesQuery = useQuery({
    queryKey: ['admin-dashboard-proxies', tenantId],
    queryFn: () => apiRequest<PageResult<ProxyListItem>>(`/api/proxies${buildQuery({ page: 1, pageSize: SAMPLE_PAGE_SIZE, ...tenantQuery })}`),
    enabled: !!ownerType,
  });

  const resourcesQuery = useQuery({
    queryKey: ['admin-dashboard-resources'],
    queryFn: () => apiRequest<PageResult<ResourceListItem>>(`/api/resources${buildQuery({ page: 1, pageSize: SAMPLE_PAGE_SIZE })}`),
    enabled: !!ownerType,
  });

  const providersQuery = useQuery({
    queryKey: ['admin-dashboard-providers'],
    queryFn: () => apiRequest<ProviderListItem[]>('/api/providers'),
    enabled: isPlatformAdmin,
  });

  if (currentAdmin.isLoading) return <Skeleton active />;
  if (currentAdmin.error || !ownerType) {
    return <ErrorAlert error={currentAdmin.error} />;
  }

  const orders = ordersQuery.data?.items ?? [];
  const proxies = proxiesQuery.data?.items ?? [];
  const resources = resourcesQuery.data?.items ?? [];
  const providers = providersQuery.data ?? [];
  const dashboardErrors = [
    { key: 'tenants', label: t('adminDashboard.sources.tenants'), error: tenantsQuery.error, enabled: isPlatformAdmin },
    { key: 'users', label: t('adminDashboard.sources.users'), error: usersQuery.error, enabled: true },
    { key: 'orders', label: t('adminDashboard.sources.orders'), error: ordersQuery.error, enabled: true },
    { key: 'proxies', label: t('adminDashboard.sources.proxies'), error: proxiesQuery.error, enabled: true },
    { key: 'resources', label: t('adminDashboard.sources.resources'), error: resourcesQuery.error, enabled: true },
    { key: 'providers', label: t('adminDashboard.sources.providers'), error: providersQuery.error, enabled: isPlatformAdmin },
  ].filter((item) => item.enabled && item.error);

  const activeProxies = proxies.filter((item) => item.status === 'ACTIVE').length;
  const pendingOrders = orders.filter((item) => item.status === 'PENDING' || item.status === 'FULFILLING').length;
  const completedOrders = orders.filter((item) => item.status === 'COMPLETED').length;
  const failedOrders = orders.filter((item) => item.status === 'FAILED').length;
  const saleableResources = resources.filter((item) => item.status === 'ACTIVE' && item.isSaleable).length;
  const activeResources = resources.filter((item) => item.status === 'ACTIVE').length;
  const unsaleableResources = resources.filter((item) => item.status !== 'ACTIVE' || !item.isSaleable).length;
  const revenueCurrency = getSingleCurrency(orders);
  const totalRevenue = revenueCurrency ? sumOrders(orders, revenueCurrency) : null;
  const todayOrders = filterToday(orders);
  const todayRevenue = revenueCurrency ? sumOrders(todayOrders, revenueCurrency) : null;
  const todayProxies = filterToday(proxies);
  const userDistribution = buildDistribution(usersQuery.data?.items.map((item) => item.status) ?? [], (key) => t(`adminDashboard.userStatus.${key}`));
  const orderTypeDistribution = buildDistribution(orders.map((item) => item.type ?? 'STATIC_PROXY_BUY'), (key) => t(`adminDashboard.orderType.${key}`));
  const providerDistribution = buildDistribution(proxies.map((item) => item.providerCode), formatProviderLabel);
  const orderStatusDistribution = buildDistribution(orders.map((item) => item.status), (key) => t(`adminDashboard.status.${key}`));
  const providerReady = isPlatformAdmin ? providers.filter((item) => item.status === 'ACTIVE').length : undefined;
  const providerDisabled = isPlatformAdmin ? providers.filter((item) => item.status !== 'ACTIVE').length : undefined;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        kicker={t('adminDashboard.kicker')}
        title={t('adminDashboard.title')}
      />
      {dashboardErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={t('adminDashboard.errors.partialTitle')}
          description={(
            <Space direction="vertical" size={4}>
              {dashboardErrors.map((item) => (
                <Typography.Text key={item.key} type="danger">
                  {item.label}: {getReasonKey(item.error)}
                </Typography.Text>
              ))}
            </Space>
          )}
        />
      )}

      <Row gutter={[14, 14]}>
        <MetricCard
          title={isPlatformAdmin ? t('adminDashboard.kpi.tenants') : t('adminDashboard.kpi.users')}
          value={isPlatformAdmin ? formatOptionalCount(tenantsQuery.data?.total) : formatOptionalCount(usersQuery.data?.total)}
          footnote={isPlatformAdmin
            ? formatActiveFootnote(tenantsQuery.data?.items.filter((item) => item.status === 'ACTIVE').length, t)
            : formatActiveFootnote(usersQuery.data?.items.filter((item) => item.status === 'ACTIVE').length, t)}
          loading={isPlatformAdmin ? tenantsQuery.isLoading : usersQuery.isLoading}
          icon={<TeamOutlined />}
          tone="#315cff"
        />
        <MetricCard
          title={t('adminDashboard.metrics.todayRevenue')}
          value={formatCurrencyValue(todayRevenue, revenueCurrency, t)}
          footnote={t('adminDashboard.metrics.totalRevenue', { amount: formatCurrencyValue(totalRevenue, revenueCurrency, t) })}
          loading={ordersQuery.isLoading}
          icon={<DollarOutlined />}
          tone="#25d8b4"
        />
        <MetricCard
          title={t('adminDashboard.kpi.orders')}
          value={formatOptionalCount(ordersQuery.data?.total)}
          footnote={t('adminDashboard.metrics.processing', { count: pendingOrders })}
          loading={ordersQuery.isLoading}
          icon={<ShoppingCartOutlined />}
          tone="#f59e0b"
        />
        <MetricCard
          title={t('adminDashboard.metrics.todayOrders')}
          value={todayOrders.length}
          footnote={t('adminDashboard.metrics.completed', { count: completedOrders })}
          loading={ordersQuery.isLoading}
          icon={<BarChartOutlined />}
          tone="#8b5cf6"
        />
        <MetricCard
          title={t('adminDashboard.metrics.totalIp')}
          value={formatOptionalCount(proxiesQuery.data?.total)}
          footnote={t('adminDashboard.metrics.activeIp', { count: activeProxies })}
          loading={proxiesQuery.isLoading}
          icon={<NodeIndexOutlined />}
          tone="#06b6d4"
        />
        <MetricCard
          title={t('adminDashboard.metrics.todayIp')}
          value={todayProxies.length}
          footnote={t('adminDashboard.metrics.saleableResources', { count: saleableResources })}
          loading={proxiesQuery.isLoading || resourcesQuery.isLoading}
          icon={<DatabaseOutlined />}
          tone="#ec4899"
        />
      </Row>

      <Row gutter={[14, 14]}>
        <OpsPanel
          title={t('adminDashboard.summary.title')}
          value={formatCurrencyValue(totalRevenue, revenueCurrency, t)}
          rows={[
            { label: t('adminDashboard.summary.todayRevenue'), value: formatCurrencyValue(todayRevenue, revenueCurrency, t), tone: 'green' },
            { label: t('adminDashboard.summary.todayOrders'), value: todayOrders.length, tone: 'blue' },
          ]}
        />
        <OpsPanel
          title={t('adminDashboard.ops.fulfillmentTitle')}
          value={pendingOrders}
          rows={[
            { label: t('adminDashboard.ops.pendingOrders'), value: pendingOrders, tone: pendingOrders > 0 ? 'orange' : 'green' },
            { label: t('adminDashboard.ops.failedOrders'), value: failedOrders, tone: failedOrders > 0 ? 'red' : 'green' },
          ]}
        />
        <OpsPanel
          title={t('adminDashboard.ops.resourceReadiness')}
          value={`${saleableResources}/${resources.length}`}
          rows={[
            { label: t('adminDashboard.ops.activeResources'), value: activeResources, tone: 'blue' },
            { label: t('adminDashboard.ops.saleableResources'), value: saleableResources, tone: 'green' },
            { label: t('adminDashboard.ops.unsaleableResources'), value: unsaleableResources, tone: unsaleableResources > 0 ? 'orange' : 'green' },
          ]}
        />
        <OpsPanel
          title={isPlatformAdmin ? t('adminDashboard.ops.providerReadiness') : t('adminDashboard.ops.proxyReadiness')}
          value={isPlatformAdmin ? (providerReady ?? '-') : activeProxies}
          rows={isPlatformAdmin ? [
            { label: t('adminDashboard.ops.disabledProviders'), value: providerDisabled ?? '-', tone: (providerDisabled ?? 0) > 0 ? 'orange' : 'green' },
            { label: t('adminDashboard.ops.providerTotal'), value: providersQuery.data ? providers.length : '-', tone: 'blue' },
          ] : [
            { label: t('adminDashboard.ops.activeProxies'), value: activeProxies, tone: 'blue' },
            { label: t('adminDashboard.metrics.todayIp'), value: todayProxies.length, tone: 'green' },
          ]}
        />
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} xl={16}>
          <Card
            title={t('adminDashboard.recentOrders.title')}
            extra={<Typography.Text type="secondary">{t('adminDashboard.recentOrders.source')}</Typography.Text>}
            variant="borderless"
            style={surfaceCardStyle({ minHeight: '100%' })}
          >
            {ordersQuery.isError ? (
              <ErrorAlert error={ordersQuery.error} />
            ) : ordersQuery.isLoading ? (
              <Skeleton active />
            ) : (
              <RecentOrderTable orders={orders.slice(0, 8)} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={t('adminDashboard.charts.userDistribution')} variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })}>
            <DonutChart data={userDistribution} emptyText={t('adminDashboard.charts.empty')} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title={t('adminDashboard.charts.orderTypeDistribution')} variant="borderless" style={surfaceCardStyle({ minHeight: 260 })}>
            <DonutChart data={orderTypeDistribution} emptyText={t('adminDashboard.charts.empty')} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={t('adminDashboard.charts.providerDistribution')} variant="borderless" style={surfaceCardStyle({ minHeight: 260 })}>
            <ProviderTable data={providerDistribution} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={t('adminDashboard.charts.orderStatus')} variant="borderless" style={surfaceCardStyle({ minHeight: 260 })}>
            <StatusList data={orderStatusDistribution} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title={t('adminDashboard.ops.readinessBreakdown')} variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })}>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={8}><OpsRow label={t('adminDashboard.ops.activeResources')} value={activeResources} tone="blue" /></Col>
              <Col xs={24} md={8}><OpsRow label={t('adminDashboard.ops.saleableResources')} value={saleableResources} tone="green" /></Col>
              <Col xs={24} md={8}><OpsRow label={t('adminDashboard.ops.unsaleableResources')} value={unsaleableResources} tone={unsaleableResources > 0 ? 'orange' : 'green'} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function OpsPanel({
  title,
  value,
  rows,
}: {
  title: string;
  value: React.ReactNode;
  rows: Array<{ label: string; value: React.ReactNode; tone: 'red' | 'orange' | 'green' | 'blue' }>;
}) {
  return (
    <Col xs={24} md={12} xl={6}>
      <Card variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })} styles={{ body: { padding: 18 } }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">{title}</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 4px' }}>{value}</Typography.Title>
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {rows.map((row) => <OpsRow key={row.label} {...row} />)}
          </Space>
        </Space>
      </Card>
    </Col>
  );
}

function MetricCard({
  title,
  value,
  footnote,
  loading,
  icon,
  tone,
}: {
  title: string;
  value: React.ReactNode;
  footnote: React.ReactNode;
  loading?: boolean;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Col xs={24} sm={12} lg={8} xl={4}>
      <Card hoverable variant="borderless" style={kpiCardStyle(tone)} styles={{ body: { padding: 18 } }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Statistic loading={loading} title={title} value={typeof value === 'number' ? value : undefined} formatter={() => value} />
          <div style={{ width: 40, height: 40, borderRadius: 8, display: 'grid', placeItems: 'center', color: tone, background: `${tone}16`, fontSize: 20 }}>
            {icon}
          </div>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{footnote}</Typography.Text>
      </Card>
    </Col>
  );
}

function OpsRow({ label, value, tone }: { label: string; value: React.ReactNode; tone: 'red' | 'orange' | 'green' | 'blue' }) {
  const color = tone === 'red' ? '#dc2626' : tone === 'orange' ? '#d97706' : tone === 'green' ? '#16a34a' : '#2563eb';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong style={{ color }}>{value}</Typography.Text>
    </div>
  );
}

interface DistributionItem {
  key: string;
  label: string;
  value: number;
}

function DonutChart({ data, emptyText }: { data: DistributionItem[]; emptyText: string }) {
  const { t } = useTranslation();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const palette = ['#315cff', '#25d8b4', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 12, minHeight: 230 }}>
      <svg viewBox="0 0 160 160" width={190} height={190} role="img" aria-label="distribution">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#edf0f6" strokeWidth="22" />
        {data.map((item, index) => {
          const dash = (item.value / total) * circumference;
          const segment = (
            <circle
              key={item.label}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={palette[index % palette.length]}
              strokeWidth="22"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += dash;
          return segment;
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="24" fontWeight="800" fill="#172033">{total}</text>
        <text x="80" y="98" textAnchor="middle" fontSize="12" fill="#8a93a6">{t('adminDashboard.charts.total')}</text>
      </svg>
      <Space wrap size={[12, 6]} style={{ justifyContent: 'center' }}>
        {data.map((item, index) => (
          <Legend key={item.label} color={palette[index % palette.length]} label={`${item.label} ${item.value}`} />
        ))}
      </Space>
    </div>
  );
}

function RecentOrderTable({ orders }: { orders: OrderListItem[] }) {
  const { t } = useTranslation();
  if (orders.length === 0) return <Empty description={t('adminDashboard.recentOrders.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="id"
      dataSource={orders}
      columns={[
        {
          title: t('adminDashboard.recentOrders.order'),
          dataIndex: 'id',
          key: 'id',
          render: (value: string, row) => (
            <Space direction="vertical" size={2}>
              <Typography.Text strong copyable ellipsis={{ tooltip: value }} style={{ maxWidth: 220 }}>
                {value}
              </Typography.Text>
              <Space size={4} wrap>
                <Tag color="geekblue">{t(`adminDashboard.orderType.${row.type ?? 'STATIC_PROXY_BUY'}`)}</Tag>
                <Tag>{row.quantity}</Tag>
              </Space>
            </Space>
          ),
        },
        {
          title: t('adminDashboard.recentOrders.amount'),
          key: 'amount',
          align: 'right',
          render: (_: unknown, row) => formatMoneyAmount(row.totalPrice, row.currency) ?? '-',
        },
        {
          title: t('adminDashboard.recentOrders.status'),
          dataIndex: 'status',
          key: 'status',
          render: (value: string) => <Tag color={orderStatusColor(value)}>{t(`adminDashboard.status.${value}`)}</Tag>,
        },
        {
          title: t('adminDashboard.recentOrders.createdAt'),
          dataIndex: 'createdAt',
          key: 'createdAt',
          render: (value: string) => formatDateTime(value),
        },
      ]}
    />
  );
}

function ProviderTable({ data }: { data: DistributionItem[] }) {
  const { t } = useTranslation();
  if (data.length === 0) return <Empty description={t('adminDashboard.charts.emptyProvider')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="label"
      dataSource={data}
      columns={[
        { title: t('adminDashboard.table.provider'), dataIndex: 'label', key: 'label' },
        { title: t('adminDashboard.table.ip'), dataIndex: 'value', key: 'value', align: 'right' },
        {
          title: t('adminDashboard.table.share'),
          key: 'share',
          render: (_: unknown, row: DistributionItem) => {
            const percent = Math.round((row.value / total) * 100);
            return <Progress percent={percent} size="small" showInfo />;
          },
        },
      ]}
    />
  );
}

function StatusList({ data }: { data: DistributionItem[] }) {
  const { t } = useTranslation();
  if (data.length === 0) return <Empty description={t('adminDashboard.charts.emptyStatus')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {data.map((item) => (
        <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 36px', alignItems: 'center', gap: 12 }}>
          <Tag color={orderStatusColor(item.key)} style={{ margin: 0 }}>{item.label}</Tag>
          <Progress percent={Math.round((item.value / total) * 100)} size="small" showInfo={false} />
          <Typography.Text strong style={{ textAlign: 'right' }}>{item.value}</Typography.Text>
        </div>
      ))}
    </Space>
  );
}

function Legend({ color, label }: { color: string; label: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ipx-fg-muted)', fontSize: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: 10, background: color }} />
      {label}
    </span>
  );
}

function buildDistribution(values: Array<string | undefined | null>, formatLabel: (key: string) => string = (key) => key): DistributionItem[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const key = raw?.trim() || 'UNKNOWN';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, value]) => ({ key, label: formatLabel(key), value }))
    .sort((a, b) => b.value - a.value);
}

function filterToday<T extends { createdAt?: string }>(items: T[]): T[] {
  const today = toLocalDateKey(new Date());
  return items.filter((item) => {
    if (!item.createdAt) return false;
    const createdAt = new Date(item.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return false;
    return toLocalDateKey(createdAt) === today;
  });
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sumOrders(orders: OrderListItem[], currency: string): number {
  return orders.reduce((sum, item) => sum + (item.currency === currency ? toNumber(item.totalPrice) : 0), 0);
}

function getSingleCurrency(orders: OrderListItem[]): string | null {
  const currencies = new Set(orders.map((item) => item.currency.trim()).filter(Boolean));
  if (currencies.size !== 1) return null;
  return Array.from(currencies)[0] ?? null;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyValue(value: number | null, currency: string | null, t: (key: string) => string): string {
  if (value === null || currency === null) return t('adminDashboard.metrics.mixedCurrency');
  return formatMoneyAmount(value, currency) ?? '-';
}

function formatOptionalCount(value: number | undefined): number | string {
  return value === undefined ? '-' : value;
}

function formatActiveFootnote(value: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  return value === undefined ? '-' : t('adminDashboard.kpi.activeSuffix', { count: value });
}

function getReasonKey(error: unknown): string {
  const apiErr = error as ApiError | undefined;
  return apiErr?.reasonKey ?? (error instanceof Error ? error.message : 'unknown_error');
}

function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return <Alert type="error" showIcon message={t('error')} description={getReasonKey(error)} />;
}

function orderStatusColor(status: string): string {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'REFUNDED') return 'error';
  if (status === 'PENDING' || status === 'FULFILLING') return 'processing';
  return 'default';
}
