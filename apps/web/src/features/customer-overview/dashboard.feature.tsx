import React from 'react';
import { Alert, Button, Card, Col, List, Row, Skeleton, Space, Statistic, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { PageHeader } from '../../shared/ui/page-header';
import type { PageResult } from '../../shared/ui/list-page';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { formatRegionNameZh } from '../../shared/resource/resource-labels';
import { formatDateTime } from '../../shared/time/time';
import { formatMoneyAmount } from '../../shared/money/money';
import type { ApiKeyListItem } from '../customer-api-keys/api-key-list.feature';

interface WalletSummary {
  userId: string;
  available: string;
  frozen: string;
  currency: string;
}

export interface OverviewProxy {
  id: string;
  ip: string;
  port: number;
  countryCode: string;
  status: string;
  expiresAt: string;
}

export interface OverviewOrder {
  id: string;
  status: string;
  quantity: number;
  durationDays: number;
  totalPrice: string;
  currency: string;
  createdAt: string;
}

export const EXPIRY_WINDOW_DAYS = 7;
const PROXY_STATS_PAGE_SIZE = 20;
const RECENT_ORDERS_LIMIT = 5;
const EXPIRING_LIST_LIMIT = 5;

export function isExpiringSoon(expiresAt: string, now: number): boolean {
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return false;
  const windowEnd = now + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return expiry > now && expiry <= windowEnd;
}

export function selectExpiringProxies(items: OverviewProxy[], now: number): OverviewProxy[] {
  return items
    .filter((proxy) => proxy.status !== 'EXPIRED' && isExpiringSoon(proxy.expiresAt, now))
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

export function orderStatusTagColor(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
    case 'REFUNDED':
      return 'error';
    case 'PARTIALLY_COMPLETED':
      return 'warning';
    case 'PENDING':
    case 'FULFILLING':
      return 'processing';
    default:
      return 'default';
  }
}

export function apiKeyStatusTagColor(status: string): string {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REVOKED' || status === 'DISABLED') return 'default';
  return 'processing';
}

function blockErrorAlert(error: unknown, t: (key: string) => string): React.ReactNode {
  const apiErr = error as ApiError;
  const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
  return (
    <Alert
      type={isPermission ? 'warning' : 'error'}
      message={isPermission ? t('permissionDenied') : t('error')}
      description={formatCustomerError(error, t, 'customer.dashboard.reason')}
      showIcon
    />
  );
}

interface ProxyInstancesTableProps {
  items: OverviewProxy[];
  total: number;
  onMore: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ProxyInstancesTable({ items, total, onMore, t }: ProxyInstancesTableProps) {
  if (items.length === 0) {
    return (
      <div className="ipx-overview-instances-empty">
        <DatabaseOutlined />
        <Typography.Text type="secondary">{t('customer.dashboard.instances.empty')}</Typography.Text>
      </div>
    );
  }

  return (
    <>
      <div className="ipx-overview-instances-grid ipx-overview-instances-head">
        <span>{t('customer.dashboard.instances.ip')}</span>
        <span>{t('customer.dashboard.instances.port')}</span>
        <span>{t('customer.dashboard.instances.region')}</span>
        <span>{t('customer.dashboard.instances.expires')}</span>
      </div>
      <div className="ipx-overview-instances-body">
        {items.map((proxy) => (
          <div className="ipx-overview-instances-grid ipx-overview-instances-row" key={proxy.id}>
            <span className="ipx-overview-instance-ip">{proxy.ip}</span>
            <span className="ipx-overview-instance-value">{proxy.port}</span>
            <span className="ipx-overview-instance-region">
              {formatRegionNameZh({ countryCode: proxy.countryCode })}
            </span>
            <span className="ipx-overview-instance-value">
              <Space size={6} wrap>
                <Tag color={proxyStatusOverviewColor(proxy.status)} style={{ marginInlineEnd: 0 }}>
                  {t(`customer.dashboard.proxyStatus.${proxy.status}`)}
                </Tag>
                {formatDateTime(proxy.expiresAt)}
              </Space>
            </span>
          </div>
        ))}
      </div>
      <div className="ipx-overview-instances-more">
        <Typography.Text type="secondary">{t('customer.dashboard.instances.summary', { count: total })}</Typography.Text>
        <Button type="link" size="small" onClick={onMore}>
          {t('customer.dashboard.instances.more')}
        </Button>
      </div>
    </>
  );
}

interface ExpiringProxyListProps {
  items: OverviewProxy[];
  onRenew: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ExpiringProxyList({ items, onRenew, t }: ExpiringProxyListProps) {
  return (
    <List
      dataSource={items}
      locale={{ emptyText: t('customer.dashboard.expiring.empty') }}
      renderItem={(proxy) => (
        <List.Item
          actions={[
            <Button key="renew" size="small" type="link" onClick={onRenew}>
              {t('customer.dashboard.expiring.renew')}
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={`${proxy.ip}:${proxy.port}`}
            description={t('customer.dashboard.expiring.expiresAt', {
              country: formatRegionNameZh({ countryCode: proxy.countryCode }),
              time: formatDateTime(proxy.expiresAt),
            })}
          />
        </List.Item>
      )}
    />
  );
}

interface RecentOrderListProps {
  items: OverviewOrder[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

function RecentOrderList({ items, t }: RecentOrderListProps) {
  return (
    <List
      dataSource={items}
      locale={{ emptyText: t('customer.dashboard.recentOrders.empty') }}
      renderItem={(order) => (
        <List.Item
          actions={[<Tag key="status" color={orderStatusTagColor(order.status)}>{t(`orders.statusValue.${order.status}`)}</Tag>]}
        >
          <List.Item.Meta
            title={t('customer.dashboard.recentOrders.item', {
              quantity: order.quantity,
              days: order.durationDays,
            })}
            description={(
              <Space size={10} wrap>
                <Typography.Text type="secondary">{formatMoneyAmount(order.totalPrice, order.currency) ?? '-'}</Typography.Text>
                <Typography.Text type="secondary">{formatDateTime(order.createdAt)}</Typography.Text>
                <Typography.Text type="secondary">{t('customer.dashboard.recentOrders.orderNo', { id: order.id })}</Typography.Text>
              </Space>
            )}
          />
        </List.Item>
      )}
    />
  );
}

function proxyStatusOverviewColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PROVISIONING':
    case 'PENDING':
      return 'processing';
    case 'EXPIRED':
    case 'FAILED':
    case 'SUSPENDED':
      return 'error';
    default:
      return 'default';
  }
}

interface OverviewStatusStripProps {
  balance: React.ReactNode;
  activeProxyCount: React.ReactNode;
  expiringCount: React.ReactNode;
  orderTotal: React.ReactNode;
  activeApiKeyCount: React.ReactNode;
  onWallet: () => void;
  onProxies: () => void;
  onApiKeys: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function OverviewStatusStrip({
  balance,
  activeProxyCount,
  expiringCount,
  orderTotal,
  activeApiKeyCount,
  onWallet,
  onProxies,
  onApiKeys,
  t,
}: OverviewStatusStripProps) {
  const items = [
    {
      key: 'balance',
      icon: <WalletOutlined />,
      label: t('customer.dashboard.statusStrip.balance'),
      value: balance,
      meta: t('customer.dashboard.statusStrip.balanceMeta'),
      onClick: onWallet,
    },
    {
      key: 'proxies',
      icon: <DatabaseOutlined />,
      label: t('customer.dashboard.statusStrip.activeProxies'),
      value: activeProxyCount,
      meta: t('customer.dashboard.statusStrip.expiringMeta', { count: expiringCount }),
      onClick: onProxies,
    },
    {
      key: 'orders',
      icon: <FileTextOutlined />,
      label: t('customer.dashboard.statusStrip.orders'),
      value: orderTotal,
      meta: t('customer.dashboard.statusStrip.ordersMeta'),
    },
    {
      key: 'api',
      icon: <ApiOutlined />,
      label: t('customer.dashboard.statusStrip.apiKeys'),
      value: activeApiKeyCount,
      meta: t('customer.dashboard.statusStrip.apiKeysMeta'),
      onClick: onApiKeys,
    },
  ];

  return (
    <div className="ipx-overview-status-strip">
      {items.map((item) => (
        <button
          className="ipx-overview-status-item"
          key={item.key}
          type="button"
          onClick={item.onClick}
          disabled={!item.onClick}
          style={{
            border: 0,
            cursor: item.onClick ? 'pointer' : 'default',
            textAlign: 'left',
            width: '100%',
          }}
        >
          <span className="ipx-overview-status-icon">{item.icon}</span>
          <span className="ipx-overview-status-copy">
            <Typography.Text type="secondary">{item.label}</Typography.Text>
            <Typography.Text strong>{item.value}</Typography.Text>
            <Typography.Text type="secondary">{item.meta}</Typography.Text>
          </span>
        </button>
      ))}
    </div>
  );
}

export function CustomerOverviewDashboardFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';
  const now = Date.now();

  const walletQuery = useQuery({
    queryKey: ['customer-overview-wallet', userId],
    queryFn: () => userApiRequest<WalletSummary>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const proxiesQuery = useQuery({
    queryKey: ['customer-overview-proxies'],
    queryFn: () =>
      userApiRequest<PageResult<OverviewProxy>>(
        `/api/proxies${buildQuery({ page: 1, pageSize: PROXY_STATS_PAGE_SIZE })}`,
      ),
  });

  const ordersQuery = useQuery({
    queryKey: ['customer-overview-orders'],
    queryFn: () =>
      userApiRequest<PageResult<OverviewOrder>>(
        `/api/orders${buildQuery({ page: 1, pageSize: RECENT_ORDERS_LIMIT })}`,
      ),
  });

  const apiKeysQuery = useQuery({
    queryKey: ['customer-overview-api-keys'],
    queryFn: () =>
      userApiRequest<PageResult<ApiKeyListItem>>(
        `/api/api-keys${buildQuery({ page: 1, pageSize: PROXY_STATS_PAGE_SIZE })}`,
      ),
  });

  const proxyItems = proxiesQuery.data?.items ?? [];
  const proxyTotal = proxiesQuery.data?.total;
  const activeProxyCount = proxyItems.filter((proxy) => proxy.status === 'ACTIVE').length;
  const expiringProxies = selectExpiringProxies(proxyItems, now);
  const apiKeyItems = apiKeysQuery.data?.items ?? [];
  const activeApiKeyCount = apiKeyItems.filter((key) => key.status === 'ACTIVE').length;
  const recentOrders = (ordersQuery.data?.items ?? []).slice(0, RECENT_ORDERS_LIMIT);
  const proxyPreviewItems = proxyItems.slice(0, 5);
  const orderTotal = ordersQuery.data?.total;
  const expiringCount = expiringProxies.length;
  const walletAvailable = walletQuery.isLoading
    ? '-'
    : walletQuery.isError
      ? '-'
      : formatMoneyAmount(walletQuery.data?.available ?? '', walletQuery.data?.currency ?? '');
  const proxyMetricValue = proxiesQuery.isLoading || proxiesQuery.isError ? '-' : activeProxyCount;
  const expiringMetricValue = proxiesQuery.isLoading || proxiesQuery.isError ? '-' : expiringCount;
  const orderMetricValue = ordersQuery.isLoading || ordersQuery.isError ? '-' : orderTotal ?? '-';
  const apiKeyMetricValue = apiKeysQuery.isLoading || apiKeysQuery.isError ? '-' : activeApiKeyCount;
  const apiKeyTotalValue = apiKeysQuery.isLoading || apiKeysQuery.isError ? '-' : apiKeysQuery.data?.total ?? 0;
  const latestOrderTime = recentOrders[0]?.createdAt ? formatDateTime(recentOrders[0].createdAt) : '-';
  const apiKeyStatusCounts = apiKeyItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  const proxyStatusCounts = proxyItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const go = (to: string) => () => { void navigate({ to } as any); };

  return (
    <Space className="ipx-overview-page ipx-overview-workbench ipx-customer-page ipx-customer-dashboard-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title={t('customer.dashboard.title')}
        kicker={t('customer.dashboard.kicker')}
        extra={(
          <>
            <Button type="primary" icon={<ShoppingCartOutlined />} onClick={go('/customer/buy')}>
              {t('customer.dashboard.quick.buy')}
            </Button>
            <Button icon={<DatabaseOutlined />} onClick={go('/proxies')}>
              {t('customer.dashboard.instances.more')}
            </Button>
            <Button icon={<WalletOutlined />} onClick={go('/wallet/topup')}>
              {t('customer.dashboard.quick.topup')}
            </Button>
          </>
        )}
      />

      <OverviewStatusStrip
        balance={walletQuery.isLoading ? '-' : walletAvailable}
        activeProxyCount={proxyMetricValue}
        expiringCount={expiringMetricValue}
        orderTotal={orderMetricValue}
        activeApiKeyCount={apiKeyMetricValue}
        onWallet={go('/wallet')}
        onProxies={go('/proxies')}
        onApiKeys={go('/api-keys')}
        t={t}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card variant="borderless" className="ipx-overview-kpi-card ipx-customer-metric-card" style={surfaceCardStyle({ minHeight: '100%' })}>
            {proxiesQuery.isError ? (
              blockErrorAlert(proxiesQuery.error, t)
            ) : (
              <Space className="ipx-overview-kpi-cell" direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <DatabaseOutlined style={{ color: '#10b981' }} />
                  <Typography.Text type="secondary">{t('customer.dashboard.kpi.proxyTotal')}</Typography.Text>
                </Space>
                <Statistic
                  loading={proxiesQuery.isLoading}
                  value={proxyTotal ?? '-'}
                  suffix={t('customer.dashboard.kpi.proxyActiveSuffix', { count: activeProxyCount })}
                />
                <Space size={[6, 6]} wrap>
                  {Object.entries(proxyStatusCounts).map(([status, count]) => (
                    <Tag key={status} color={proxyStatusOverviewColor(status)}>
                      {t(`customer.dashboard.proxyStatus.${status}`, { defaultValue: status })} {count}
                    </Tag>
                  ))}
                </Space>
                <Typography.Text type="secondary">
                  {t('customer.dashboard.kpi.expiringSuffix', { days: EXPIRY_WINDOW_DAYS })}: {expiringCount}
                </Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card variant="borderless" className="ipx-overview-kpi-card ipx-customer-metric-card" style={surfaceCardStyle({ minHeight: '100%' })}>
            {ordersQuery.isError ? (
              blockErrorAlert(ordersQuery.error, t)
            ) : (
              <Space className="ipx-overview-kpi-cell" direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <FileTextOutlined style={{ color: '#f59e0b' }} />
                  <Typography.Text type="secondary">{t('customer.dashboard.kpi.orders')}</Typography.Text>
                </Space>
                <Statistic
                  loading={ordersQuery.isLoading}
                  value={orderTotal}
                  suffix={t('customer.dashboard.kpi.ordersRecentSuffix', { count: recentOrders.length })}
                />
                <Typography.Text type="secondary">
                  <ClockCircleOutlined /> {t('customer.dashboard.recentOrders.latest')}: {latestOrderTime}
                </Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card variant="borderless" className="ipx-overview-kpi-card ipx-customer-metric-card" style={surfaceCardStyle({ minHeight: '100%' })}>
            {apiKeysQuery.isError ? (
              blockErrorAlert(apiKeysQuery.error, t)
            ) : (
              <Space className="ipx-overview-kpi-cell" direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <ApiOutlined style={{ color: '#1677ff' }} />
                  <Typography.Text type="secondary">{t('customer.dashboard.kpi.apiKeys')}</Typography.Text>
                </Space>
                <Statistic
                  loading={apiKeysQuery.isLoading}
                  value={apiKeyTotalValue}
                  suffix={t('customer.dashboard.kpi.apiKeysActiveSuffix', { count: activeApiKeyCount })}
                />
                <Space size={[6, 6]} wrap>
                  {Object.entries(apiKeyStatusCounts).map(([status, count]) => (
                    <Tag key={status} color={apiKeyStatusTagColor(status)}>
                      {t(`customer.apiKeys.statusValue.${status}`, { defaultValue: status })} {count}
                    </Tag>
                  ))}
                </Space>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card className="ipx-overview-list-card ipx-overview-instances-card ipx-customer-table-card" title={t('customer.dashboard.instances.title')} variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })}>
            {proxiesQuery.isLoading ? (
              <Skeleton active />
            ) : proxiesQuery.isError ? (
              blockErrorAlert(proxiesQuery.error, t)
            ) : (
              <ProxyInstancesTable items={proxyPreviewItems} total={proxyTotal ?? 0} onMore={go('/proxies')} t={t} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card className="ipx-overview-list-card ipx-overview-attention-card ipx-customer-card" title={t('customer.dashboard.expiring.title')} variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })}>
            <div className="ipx-overview-attention-head">
              <span className="ipx-overview-attention-icon"><FieldTimeOutlined /></span>
              <div>
                <Typography.Text strong>{t('customer.dashboard.expiring.count', { count: expiringCount })}</Typography.Text>
                <Typography.Text type="secondary">{t('customer.dashboard.expiring.summary', { days: EXPIRY_WINDOW_DAYS, count: expiringCount })}</Typography.Text>
              </div>
            </div>
            {proxiesQuery.isLoading ? (
              <Skeleton active />
            ) : proxiesQuery.isError ? (
              blockErrorAlert(proxiesQuery.error, t)
            ) : (
              <ExpiringProxyList items={expiringProxies.slice(0, EXPIRING_LIST_LIMIT)} onRenew={go('/proxies')} t={t} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card className="ipx-overview-list-card ipx-customer-table-card" title={t('customer.dashboard.recentOrders.title')} variant="borderless" style={surfaceCardStyle({ minHeight: '100%' })}>
            {ordersQuery.isLoading ? (
              <Skeleton active />
            ) : ordersQuery.isError ? (
              blockErrorAlert(ordersQuery.error, t)
            ) : (
              <RecentOrderList items={recentOrders} t={t} />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
