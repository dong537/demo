import React from 'react';
import { Alert, Button, Card, Col, Drawer, Form, Input, Row, Space, Statistic, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined, ShoppingCartOutlined, TagsOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { buildQuery, userApiRequest } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { WalletAdjustModal, type WalletSummary } from '../wallet/wallet-adjust-modal.feature';
import { formatMoneyAmount } from '../../shared/money/money';
import { formatDateTime } from '../../shared/time/time';
import { accountStatusColor } from '../../shared/user/user-labels';
import { getBackendReason, resellerCompactInputStyle, resellerHeroStyle, resellerIconStyle, resellerMetricBodyStyle, resellerMetricToneStyle, resellerSummaryStripStyle, resellerToolbarStyle, resellerWorkspaceHeaderStyle } from './reseller-ui';

interface ResellerUser {
  id: string;
  email: string;
  status: string;
  available: string;
  frozen: string;
  currency: string;
  orderCount: number;
  createdAt: string;
}

interface CreateUserValues {
  email: string;
  password: string;
}

export function ResellerUsersFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [adjustingUser, setAdjustingUser] = React.useState<ResellerUser | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [form] = Form.useForm<CreateUserValues>();

  const query = useQuery({
    queryKey: ['customer-reseller-users', page, pageSize, search],
    queryFn: () => userApiRequest<{ page: number; pageSize: number; total: number; items: ResellerUser[] }>(
      `/api/customer/reseller/users${buildQuery({ page, pageSize, search })}`,
    ),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateUserValues) =>
      userApiRequest('/api/customer/reseller/users', {
        method: 'POST',
        body: JSON.stringify({ email: values.email.trim(), password: values.password }),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.users.createSuccess'));
      setActionError(null);
      setCreateOpen(false);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['customer-reseller-users'] });
      void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const columns: ColumnsType<ResellerUser> = [
    {
      title: t('customer.reseller.users.email'),
      dataIndex: 'email',
      key: 'email',
      width: 280,
      render: (value: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" copyable style={{ fontSize: 12 }}>{row.id}</Typography.Text>
          <Tag color="blue">{t('customer.reseller.users.realUserSource')}</Tag>
        </Space>
      ),
    },
    { title: t('customer.reseller.users.status'), dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <Tag color={accountStatusColor(v)}>{formatUserStatus(t, v)}</Tag> },
    {
      title: t('customer.reseller.users.balance'),
      key: 'balance',
      width: 190,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{formatMoneyAmount(row.available, row.currency)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('customer.reseller.users.frozenBalance')}: {formatMoneyAmount(row.frozen, row.currency)}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('customer.reseller.users.orders'), dataIndex: 'orderCount', key: 'orderCount' },
    { title: t('customer.reseller.users.createdAt'), dataIndex: 'createdAt', key: 'createdAt', render: formatDateTime },
    {
      title: t('customer.reseller.users.actions'),
      key: 'actions',
      width: 160,
      render: (_: unknown, row) => (
        <Button size="small" onClick={() => setAdjustingUser(row)}>
          {t('customer.reseller.users.adjustWallet')}
        </Button>
      ),
    },
  ];

  const adjustingWallet: WalletSummary | null = adjustingUser
    ? {
      id: `reseller-user-wallet-${adjustingUser.id}`,
      userId: adjustingUser.id,
      available: adjustingUser.available,
      frozen: adjustingUser.frozen,
      currency: adjustingUser.currency,
      updatedAt: adjustingUser.createdAt,
    }
    : null;
  const balanceEntries = (query.data?.items ?? []).reduce<Record<string, number>>((acc, item) => {
    acc[item.currency] = (acc[item.currency] ?? 0) + Number.parseFloat(item.available || '0');
    return acc;
  }, {});
  const balanceCurrencies = Object.keys(balanceEntries);
  const balanceSummary = balanceCurrencies.length === 1
    ? formatMoneyAmount(balanceEntries[balanceCurrencies[0]!] ?? 0, balanceCurrencies[0]!) ?? '-'
    : balanceCurrencies.length > 1
      ? balanceCurrencies.join(' / ')
      : '-';
  const userItems = query.data?.items ?? [];
  const hasActiveSearch = search.length > 0;
  const activeUsers = userItems.filter((item) => item.status === 'ACTIVE' || item.status === 'NORMAL').length;
  const restrictedUsers = userItems.filter((item) => item.status !== 'ACTIVE' && item.status !== 'NORMAL').length;

  return (
    <div className="ipx-reseller-page ipx-reseller-users-page">
      <PageHeader
        kicker={t('customer.reseller.kicker')}
        title={t('customer.reseller.users.title')}
        description={t('customer.reseller.users.description')}
      />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card className="ipx-reseller-hero ipx-reseller-users-hero ipx-reseller-management-hero" variant="borderless" style={resellerHeroStyle()}>
        <Space align="start" size={14} style={resellerWorkspaceHeaderStyle}>
          <Space align="start" size={14}>
            <span className="ipx-reseller-management-icon" style={resellerIconStyle}><TeamOutlined /></span>
            <Space direction="vertical" size={4}>
              <Typography.Text strong>{t('customer.reseller.users.workspaceTitle')}</Typography.Text>
              <Typography.Text type="secondary">{t('customer.reseller.users.workspaceDesc')}</Typography.Text>
              <Space size={6} wrap>
                <Tag color="blue">{t('customer.reseller.users.realUserSource')}</Tag>
                <Tag color="geekblue">{t('customer.reseller.users.walletSource')}</Tag>
              </Space>
            </Space>
          </Space>
          <Space wrap>
            <Button icon={<ShoppingCartOutlined />} onClick={() => navigate({ to: '/reseller/orders' as never })}>
              {t('customer.reseller.cards.orders')}
            </Button>
            <Button icon={<TagsOutlined />} onClick={() => navigate({ to: '/reseller/pricing' as never })}>
              {t('customer.reseller.cards.pricing')}
            </Button>
          </Space>
          </Space>
        </Card>
      <div style={resellerSummaryStripStyle}>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-users-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#315cff')} styles={resellerMetricBodyStyle}>
            <Statistic title={t('customer.reseller.users.metrics.total')} value={query.data?.total ?? '-'} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-users-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#f59e0b')} styles={resellerMetricBodyStyle}>
            <Statistic title={t('customer.reseller.users.metrics.orders')} value={query.data ? (query.data.items ?? []).reduce((sum, item) => sum + item.orderCount, 0) : '-'} prefix={<ShoppingCartOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-users-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#25d8b4')} styles={resellerMetricBodyStyle}>
            <Statistic
              title={t('customer.reseller.users.metrics.balance')}
              value={query.data ? balanceSummary : '-'}
              prefix={<WalletOutlined />}
            />
          </Card>
        </Col>
      </Row>
      </div>
      <Alert
        type="info"
        showIcon
        message={t('customer.reseller.users.sourceTruth')}
      />
      {query.isFetching && !query.isLoading && (
        <Alert type="info" showIcon message={t('customer.reseller.users.refreshing')} />
      )}
      {createMutation.isPending && (
        <Alert type="warning" showIcon message={t('customer.reseller.users.createPending')} />
      )}
      {!createOpen && actionError && (
        <Alert
          type="error"
          message={t('error')}
          description={actionError}
          showIcon
          closable
          onClose={() => setActionError(null)}
        />
      )}
      {query.data && userItems.length === 0 && hasActiveSearch && (
        <Alert
          type="warning"
          showIcon
          message={t('customer.reseller.users.filteredEmpty')}
          description={t('customer.reseller.users.filteredEmptyDesc')}
        />
      )}
      <div className="ipx-reseller-table-card ipx-reseller-users-table-card">
        <ListPage
          query={query}
          columns={columns}
          rowKey="id"
          emptyText={t('customer.reseller.users.empty')}
          errorDescription={(error) => getBackendReason(error, t)}
          toolbar={(
            <div className="ipx-reseller-toolbar ipx-reseller-users-toolbar ipx-reseller-management-toolbar" style={resellerToolbarStyle}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Input.Search
                  placeholder={t('customer.reseller.users.searchPlaceholder')}
                  allowClear
                  size="middle"
                  onSearch={(value) => { setSearch(value.trim()); setPage(1); }}
                  style={resellerCompactInputStyle}
                />
              </div>
              <Space size={8} wrap>
                {search ? <Tag>{t('customer.reseller.users.summary.keywordFilter', { keyword: search })}</Tag> : null}
                <Tag color="blue">{t('customer.reseller.users.summary.total', { total: query.data?.total ?? 0 })}</Tag>
                <Tag color="geekblue">{t('customer.reseller.users.summary.source')}</Tag>
                <Tag>{t('customer.reseller.users.summary.currentPage', { count: userItems.length })}</Tag>
                <Tag color="green">{t('customer.reseller.users.summary.activeOnPage', { count: activeUsers })}</Tag>
                <Tag color={restrictedUsers > 0 ? 'orange' : undefined}>{t('customer.reseller.users.summary.restrictedOnPage', { count: restrictedUsers })}</Tag>
                <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('refresh')}</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} loading={createMutation.isPending}>
                  {t('customer.reseller.users.create')}
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
      <Drawer
        className="ipx-reseller-drawer ipx-reseller-users-drawer"
        title={t('customer.reseller.users.create')}
        open={createOpen}
        onClose={() => {
          setActionError(null);
          setCreateOpen(false);
        }}
        width={460}
        destroyOnClose
      >
        {actionError && <Alert type="error" message={t('error')} description={actionError} showIcon style={{ marginBottom: 16 }} />}
        {createMutation.isPending && (
          <Alert type="info" showIcon message={t('customer.reseller.users.createPending')} style={{ marginBottom: 16 }} />
        )}
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="email" label={t('customer.reseller.users.email')} rules={[{ required: true }, { type: 'email' }]}>
            <Input placeholder="customer@example.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label={t('customer.reseller.users.password')} rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={createMutation.isPending}>{t('submit')}</Button>
          </Space>
        </Form>
      </Drawer>
      {adjustingWallet && (
        <WalletAdjustModal
          wallet={adjustingWallet}
          open={Boolean(adjustingUser)}
          onClose={() => setAdjustingUser(null)}
          adjustPath={`/api/customer/reseller/users/${encodeURIComponent(adjustingWallet.userId)}/wallet-adjust`}
          requestMode="user"
          invalidateQueryKeys={[
            ['customer-reseller-users'],
            ['customer-reseller-overview'],
            ['wallet', adjustingWallet.userId],
            ['ledger', adjustingWallet.userId],
          ]}
          onAdjusted={() => {
            message.success(t('customer.reseller.users.adjustSuccess'));
            void qc.invalidateQueries({ queryKey: ['customer-reseller-users'] });
            void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
          }}
        />
      )}
      </Space>
    </div>
  );
}

function formatUserStatus(t: (key: string) => string, status?: string | null): string {
  if (status === 'ACTIVE' || status === 'NORMAL') return t('customer.reseller.status.active');
  if (status === 'PENDING') return t('customer.reseller.status.pending');
  if (status === 'APPROVED' || status === 'VERIFIED') return t('customer.reseller.status.verified');
  if (status === 'REVIEWING') return t('customer.reseller.status.reviewing');
  if (status === 'SUSPENDED') return t('customer.reseller.status.suspended');
  if (status === 'DISABLED') return t('customer.reseller.status.disabled');
  if (status === 'BANNED') return t('customer.reseller.status.banned');
  if (status === 'REJECTED') return t('customer.reseller.status.rejected');
  if (status === 'BLOCKED') return t('customer.reseller.status.blocked');
  return status || '-';
}
