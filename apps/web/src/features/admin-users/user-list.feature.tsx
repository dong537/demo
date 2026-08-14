import React, { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Card, Col, Descriptions, Drawer, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { DeleteOutlined, DownOutlined, EyeOutlined, LoadingOutlined, LoginOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { ApiError, apiRequest, buildQuery } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { WalletAdjustModal, type WalletSummary } from '../wallet/wallet-adjust-modal.feature';
import { AdminCustomerOrderDrawer } from './admin-customer-order-drawer.feature';
import { CreateUserDrawer } from './create-user-drawer.feature';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatIpTypeZh, formatProtocolZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatDateTime } from '../../shared/time/time';
import { accountStatusColor } from '../../shared/user/user-labels';
import { DEFAULT_PRICING_DURATION_DAYS } from '../pricing/pricing-duration';
import { formatMoneyAmount } from '../../shared/money/money';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { usePriceableCatalog } from '../../shared/resource/use-priceable-catalog';

interface UserDto {
  id: string;
  email: string;
  tenantId: string;
  status: string;
  kycStatus: string;
  createdAt: string;
  updatedAt?: string | null;
  wallet?: {
    available: string;
    frozen: string;
    currency: string;
  } | null;
  orderCount?: number;
  proxyCount?: number;
}

interface PriceFormValues {
  unitPrice?: number;
}

interface PasswordFormValues {
  password?: string;
}

interface ResourceOption {
  id: string;
  code: string;
  name: string;
  displayName?: string | null;
  providerCode?: string | null;
  countryCode?: string | null;
  upstreamCost?: string | null;
  upstreamCostCurrency?: string | null;
  ipType?: string | null;
  protocol?: string | null;
  stock?: number | null;
  status?: string | null;
  isVisible?: boolean | null;
  isSaleable?: boolean | null;
  upstreamResourceId?: string | null;
  unitPrice?: string | null;
  priceCurrency?: string | null;
}

interface UserListFeatureProps {
  tenantId?: string;
  hideTitle?: boolean;
  onImpersonated?: () => void;
}

type UserWorkflow =
  | 'detail'
  | 'adjust-wallet'
  | 'assisted-order'
  | 'set-price'
  | 'reset-password'
  | 'toggle-status'
  | 'impersonate'
  | 'delete';

interface UserActionFeedback {
  type: 'info' | 'error';
  userId: string;
  email: string;
  action: UserWorkflow;
  reasonKey?: string;
}

interface UserPageDto {
  page: number;
  pageSize: number;
  total: number;
  items: UserDto[];
}

const DEFAULT_PRICE_CURRENCY = 'CNY';
const USER_PRICE_RESOURCE_PAGE_SIZE = 500;

interface UserPriceRegionGroup {
  key: string;
  label: string;
  countryCode: string;
  countryLabel: string;
  resources: ResourceOption[];
}

interface UserPriceCountryGroup {
  key: string;
  label: string;
  countryCode: string;
  resources: ResourceOption[];
  regions: UserPriceRegionGroup[];
}

interface ResourceOptionPage {
  page: number;
  pageSize: number;
  total: number;
  items: ResourceOption[];
}

function fetchUserPriceResourceCatalogPage(pageNumber: number): Promise<ResourceOptionPage> {
  return apiRequest<ResourceOptionPage>(
    `/api/resources/priceable-catalog${buildQuery({
      page: pageNumber,
      pageSize: USER_PRICE_RESOURCE_PAGE_SIZE,
    })}`,
  );
}

export function UserListFeature({ tenantId, hideTitle = false, onImpersonated = navigateToCustomerAfterImpersonation }: UserListFeatureProps = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [assistedOrderUser, setAssistedOrderUser] = useState<UserDto | null>(null);
  const [walletAdjustUser, setWalletAdjustUser] = useState<UserDto | null>(null);
  const [priceUser, setPriceUser] = useState<UserDto | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserDto | null>(null);
  const [detailUser, setDetailUser] = useState<UserDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [priceCountrySearch, setPriceCountrySearch] = useState('');
  const [priceCountryKey, setPriceCountryKey] = useState<string | null>(null);
  const [priceRegionKey, setPriceRegionKey] = useState<string | null>(null);
  const [priceSelectedResourceIds, setPriceSelectedResourceIds] = useState<string[]>([]);
  const [actionFeedback, setActionFeedback] = useState<UserActionFeedback | null>(null);
  const [pendingAction, setPendingAction] = useState<{ userId: string; action: UserWorkflow } | null>(null);
  const [priceForm] = Form.useForm<PriceFormValues>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();

  const query = useQuery({
    queryKey: ['users', tenantId, page, pageSize, search, status],
    queryFn: () =>
      apiRequest<UserPageDto>(
        `/api/users${buildQuery({ page, pageSize, search, status, tenantId })}`,
      ),
  });

  const walletQuery = useQuery({
    queryKey: ['admin-user-wallet', walletAdjustUser?.id],
    queryFn: () => apiRequest<WalletSummary>(`/api/wallet/${encodeURIComponent(walletAdjustUser!.id)}`),
    enabled: !!walletAdjustUser,
  });

  const resourcesQuery = usePriceableCatalog<ResourceOption>({
    queryKey: ['admin-user-price-resources'],
    pageSize: USER_PRICE_RESOURCE_PAGE_SIZE,
    fetchPage: fetchUserPriceResourceCatalogPage,
    enabled: !!priceUser,
  });

  const statusMutation = useMutation({
    mutationFn: ({ user, status: nextStatus }: { user: UserDto; status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' }) =>
      apiRequest(`/api/users/${encodeURIComponent(user.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      }),
    onMutate: ({ user }) => {
      setPendingAction({ userId: user.id, action: 'toggle-status' });
      setActionFeedback({ type: 'info', userId: user.id, email: user.email, action: 'toggle-status' });
    },
    onSuccess: () => {
      setActionFeedback(null);
      message.success(t('users.operations.statusSuccess'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      const reasonKey = getReasonKey(error, t('error'));
      message.error(formatUserFailure(reasonKey, t));
      setActionFeedback((current) => current ? { ...current, type: 'error', reasonKey } : null);
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: (user: UserDto) =>
      apiRequest<{ token: string; expiresAt: string }>(`/api/users/${encodeURIComponent(user.id)}/impersonate`, { method: 'POST' }),
    onMutate: (user) => {
      setPendingAction({ userId: user.id, action: 'impersonate' });
      setActionFeedback({ type: 'info', userId: user.id, email: user.email, action: 'impersonate' });
    },
    onSuccess: (data) => {
      setActionFeedback(null);
      sessionStorage.removeItem('admin_token');
      sessionStorage.setItem('user_token', data.token);
      onImpersonated();
    },
    onError: (error) => {
      const reasonKey = getReasonKey(error, t('error'));
      message.error(formatUserFailure(reasonKey, t));
      setActionFeedback((current) => current ? { ...current, type: 'error', reasonKey } : null);
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ user, password }: { user: UserDto; password: string }) =>
      apiRequest(`/api/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onMutate: ({ user }) => {
      setPendingAction({ userId: user.id, action: 'reset-password' });
      setActionFeedback({ type: 'info', userId: user.id, email: user.email, action: 'reset-password' });
    },
    onSuccess: () => {
      setActionFeedback(null);
      message.success(t('users.operations.resetPasswordSuccess'));
      passwordForm.resetFields();
      setPasswordUser(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      const reasonKey = getReasonKey(error, t('error'));
      message.error(formatUserFailure(reasonKey, t));
      setActionFeedback((current) => current ? { ...current, type: 'error', reasonKey } : null);
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (user: UserDto) => apiRequest(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }),
    onMutate: (user) => {
      setPendingAction({ userId: user.id, action: 'delete' });
      setActionFeedback({ type: 'info', userId: user.id, email: user.email, action: 'delete' });
    },
    onSuccess: () => {
      setActionFeedback(null);
      message.success(t('users.operations.deleteSuccess'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      const reasonKey = getReasonKey(error, t('error'));
      message.error(formatUserFailure(reasonKey, t));
      setActionFeedback((current) => current ? { ...current, type: 'error', reasonKey } : null);
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const priceOverrideMutation = useMutation({
    mutationFn: ({ user, values, resourceIds }: { user: UserDto; values: PriceFormValues; resourceIds: string[] }) =>
      Promise.all(resourceIds.map((resourceId) =>
        apiRequest('/api/pricing/user-overrides', {
          method: 'POST',
          body: JSON.stringify({
            tenantId: user.tenantId,
            userId: user.id,
            resourceId,
            durationDays: DEFAULT_PRICING_DURATION_DAYS,
            unitPrice: String(values.unitPrice),
            currency: DEFAULT_PRICE_CURRENCY,
          }),
        }),
      )),
    onMutate: ({ user }) => {
      setPendingAction({ userId: user.id, action: 'set-price' });
      setActionFeedback({ type: 'info', userId: user.id, email: user.email, action: 'set-price' });
    },
    onSuccess: () => {
      setActionFeedback(null);
      message.success(t('users.price.overrideSuccess'));
      priceForm.resetFields();
      resetPriceResourceSelection();
      setPriceUser(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
    },
    onError: (error) => {
      const reasonKey = getReasonKey(error, t('error'));
      message.error(formatUserFailure(reasonKey, t));
      setActionFeedback((current) => current ? { ...current, type: 'error', reasonKey } : null);
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const closeWalletAdjust = () => {
    const userId = walletAdjustUser?.id;
    setWalletAdjustUser(null);
    if (userId) {
      void qc.invalidateQueries({ queryKey: ['admin-user-wallet', userId] });
    }
  };

  const openPriceModal = (user: UserDto) => {
    setPriceUser(user);
    resetPriceResourceSelection();
    priceForm.resetFields();
  };

  function resetPriceResourceSelection() {
    setPriceCountrySearch('');
    setPriceCountryKey(null);
    setPriceRegionKey(null);
    setPriceSelectedResourceIds([]);
  }

  const openUserWorkflow = (user: UserDto, workflow: UserWorkflow) => {
    if (workflow !== 'detail') setDetailUser(null);
    if (workflow === 'detail') setDetailUser(user);
    if (workflow === 'adjust-wallet') setWalletAdjustUser(user);
    if (workflow === 'assisted-order') setAssistedOrderUser(user);
    if (workflow === 'set-price') openPriceModal(user);
    if (workflow === 'reset-password') setPasswordUser(user);
    if (workflow === 'toggle-status') {
      statusMutation.mutate({
        user,
        status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
      });
    }
    if (workflow === 'impersonate') impersonateMutation.mutate(user);
    if (workflow === 'delete') confirmDeleteUser(user);
  };

  const confirmDeleteUser = (user: UserDto) => {
    Modal.confirm({
      title: t('users.operations.deleteConfirm'),
      okText: t('users.operations.delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: () => deleteMutation.mutate(user),
    });
  };

  const columns: ColumnsType<UserDto> = [
    {
      title: t('users.customer'),
      dataIndex: 'email',
      key: 'email',
      width: 340,
      render: (_: string, row) => (
        <Space align="start">
          <Avatar>{avatarText(row.email)}</Avatar>
          <Space direction="vertical" size={2}>
            <Typography.Text strong style={{ maxWidth: 260 }} ellipsis={{ tooltip: row.email }}>
              {row.email}
            </Typography.Text>
            <Space size={6} wrap>
              <Tag>{t('users.roleCustomer')}</Tag>
              <Tag color={accountStatusColor(row.status)}>{t(`users.statusValue.${row.status}`)}</Tag>
              <Tag bordered={false}>{row.kycStatus || '-'}</Tag>
            </Space>
            <Typography.Text type="secondary" copyable style={{ fontSize: 12, maxWidth: 260 }} ellipsis={{ tooltip: row.id }}>
              {row.id}
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: t('users.balance'),
      key: 'balance',
      width: 140,
      sorter: (a, b) => Number(a.wallet?.available ?? 0) - Number(b.wallet?.available ?? 0),
      render: (_: unknown, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: '#0f5cff' }}>
            {formatUserWalletAmount(row.wallet?.available, row.wallet?.currency)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('users.frozenBalance')}: {formatUserWalletAmount(row.wallet?.frozen, row.wallet?.currency)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('users.orderIp'),
      key: 'orderIp',
      width: 150,
      render: (_: unknown, row) => (
        <Space size={6}>
          <Typography.Text strong>{formatOptionalNumber(row.orderCount)}</Typography.Text>
          <Typography.Text type="secondary">{t('users.orderUnit')}</Typography.Text>
          <Typography.Text strong>{formatOptionalNumber(row.proxyCount)}</Typography.Text>
          <Typography.Text type="secondary">{t('users.ipUnit')}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('users.tenantId'),
      dataIndex: 'tenantId',
      key: 'tenantId',
      width: 190,
      render: (value: string) => (
        <Typography.Text copyable type="secondary" style={{ fontSize: 12, maxWidth: 170 }} ellipsis={{ tooltip: value }}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: t('users.audit'),
      key: 'audit',
      width: 190,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('users.createdAt')}: {formatDateTime(row.createdAt)}
          </Typography.Text>
          {row.updatedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('users.updatedAt')}: {formatDateTime(row.updatedAt)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('users.actions'),
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_: unknown, row: UserDto) => (
        <UserActionMenu
          user={row}
          menuText={t('users.operations.menu')}
          items={buildUserActionItems(row, t, pendingAction)}
          onAction={openUserWorkflow}
        />
      ),
    },
  ];

  const priceResources = useMemo(
    () => resourcesQuery.items.filter(isUserPriceSelectableResource),
    [resourcesQuery.items],
  );
  const priceCountryGroups = useMemo(() => groupUserPriceResources(priceResources), [priceResources]);
  const normalizedPriceCountrySearch = priceCountrySearch.trim().toLocaleLowerCase('zh-CN');
  const visiblePriceCountryGroups = useMemo(
    () => priceCountryGroups.filter((group) => matchesPriceCountrySearch(group, normalizedPriceCountrySearch)),
    [priceCountryGroups, normalizedPriceCountrySearch],
  );
  const filteredPriceResources = useMemo(
    () => uniqueResources(visiblePriceCountryGroups.flatMap((group) => group.resources)),
    [visiblePriceCountryGroups],
  );
  React.useEffect(() => {
    if (visiblePriceCountryGroups.some((group) => group.key === priceCountryKey)) return;
    const firstCountry = visiblePriceCountryGroups[0] ?? null;
    const firstRegion = firstCountry?.regions[0] ?? null;
    setPriceCountryKey(firstCountry?.key ?? null);
    setPriceRegionKey(firstRegion?.key ?? null);
  }, [priceCountryKey, visiblePriceCountryGroups]);
  const selectedPriceCountry = visiblePriceCountryGroups.find((group) => group.key === priceCountryKey)
    ?? visiblePriceCountryGroups[0]
    ?? null;
  const priceRegionGroups = selectedPriceCountry?.regions ?? [];
  const selectedPriceRegion = priceRegionGroups.find((group) => group.key === priceRegionKey)
    ?? priceRegionGroups[0]
    ?? null;
  const explicitSelectedPriceResources = useMemo(() => {
    if (priceSelectedResourceIds.length === 0) return [];
    const resourcesById = new Map(priceResources.map((resource) => [resource.id, resource]));
    return priceSelectedResourceIds
      .map((resourceId) => resourcesById.get(resourceId))
      .filter((resource): resource is ResourceOption => Boolean(resource));
  }, [priceResources, priceSelectedResourceIds]);
  const selectedPriceResources = explicitSelectedPriceResources.length > 0
    ? explicitSelectedPriceResources
    : selectedPriceRegion?.resources ?? [];
  const handlePriceCountrySearch = (value: string) => {
    setPriceCountrySearch(value);
    setPriceSelectedResourceIds([]);
  };
  const clearNetworkSelection = () => {
    setPriceSelectedResourceIds([]);
  };
  const selectFilteredPriceResources = () => {
    setPriceSelectedResourceIds(filteredPriceResources.map((resource) => resource.id));
  };
  const pricePanelStyle = {
    border: '1px solid #e8edf7',
    borderRadius: 8,
    padding: 12,
    minHeight: 320,
    background: '#fff',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
  } as const;
  const pricePanelHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  } as const;
  const priceSelectorButtonStyle = (active: boolean): React.CSSProperties => ({
    textAlign: 'left',
    height: 'auto',
    padding: '10px 12px',
    whiteSpace: 'normal',
    borderColor: active ? '#1558ff' : '#e5eaf3',
    background: active ? '#eef4ff' : '#fff',
    boxShadow: active ? '0 4px 12px rgba(21, 88, 255, 0.10)' : 'none',
  });

  const submitPrice = (values: PriceFormValues) => {
    if (!priceUser) return;
    const resourceIds = selectedPriceResources.map((resource) => resource.id);
    if (resourceIds.length === 0) {
      message.error(t('users.price.resourceRequired'));
      return;
    }
    if (values.unitPrice !== undefined) {
      priceOverrideMutation.mutate({ user: priceUser, values, resourceIds });
    }
  };

  const submitPassword = (values: PasswordFormValues) => {
    if (!passwordUser || !values.password) return;
    resetPasswordMutation.mutate({ user: passwordUser, password: values.password });
  };

  const toolbar = (
    <Card variant="borderless" style={surfaceCardStyle({ marginBottom: 12 })} styles={{ body: { padding: 14 } }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Space wrap size={8}>
          <Input.Search
            prefix={<SearchOutlined />}
            placeholder={t('users.searchPlaceholder')}
            onSearch={(v) => { setSearch(v); setPage(1); }}
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
            placeholder={t('users.statusFilter')}
            allowClear
            style={{ width: 150 }}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[
              { value: '', label: t('users.allStatus') },
              { value: 'ACTIVE', label: t('users.statusValue.ACTIVE') },
              { value: 'SUSPENDED', label: t('users.statusValue.SUSPENDED') },
              { value: 'BANNED', label: t('users.statusValue.BANNED') },
            ]}
          />
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('refresh')}</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label={t('users.create.button')}
            onClick={() => setCreateOpen(true)}
          >
            {t('users.create.button')}
          </Button>
        </Space>
      </div>
    </Card>
  );

  return (
    <div className="ipx-admin-users-page">
      {!hideTitle && (
        <PageHeader
          title={t('users.title')}
          description={t('users.description')}
        />
      )}
      {actionFeedback && (
        <Alert
          type={actionFeedback.type}
          showIcon
          closable
          message={t(`users.operations.feedback.${actionFeedback.type}`, {
            action: t(getUserWorkflowLabelKey(actionFeedback.action)),
            email: actionFeedback.email,
          })}
          description={formatUserFailure(actionFeedback.reasonKey, t)}
          onClose={() => setActionFeedback(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      {walletAdjustUser && walletQuery.isLoading && (
        <Alert
          type="info"
          showIcon
          message={t('users.operations.walletLoading')}
          style={{ marginTop: 16 }}
        />
      )}
      {walletAdjustUser && walletQuery.isError && (
        <Alert
          type="error"
          showIcon
          closable
          message={t('error')}
          description={formatUserFailure(walletQuery.error, t)}
          onClose={() => setWalletAdjustUser(null)}
          style={{ marginTop: 16 }}
        />
      )}
      <CreateUserDrawer
        open={createOpen}
        tenantId={tenantId}
        onClose={() => setCreateOpen(false)}
      />
      {assistedOrderUser && (
        <AdminCustomerOrderDrawer
          user={assistedOrderUser}
          open
          onClose={() => setAssistedOrderUser(null)}
        />
      )}
      {walletAdjustUser && walletQuery.data && (
        <WalletAdjustModal
          wallet={walletQuery.data}
          open
          onClose={closeWalletAdjust}
          onAdjusted={(wallet) => {
            void qc.invalidateQueries({ queryKey: ['users'] });
            void qc.invalidateQueries({ queryKey: ['admin-user-wallet', wallet.userId] });
          }}
        />
      )}
      <Drawer
        title={detailUser ? t('users.detailTitle', { email: detailUser.email }) : t('users.detail')}
        open={!!detailUser}
        onClose={() => setDetailUser(null)}
        width={560}
        extra={detailUser && (
          <UserActionMenu
            user={detailUser}
            menuText={t('users.operations.menu')}
            items={buildUserActionItems(detailUser, t, pendingAction, true)}
            onAction={openUserWorkflow}
          />
        )}
      >
        {detailUser && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={t('users.detailSource.title')}
              description={t('users.detailSource.description')}
            />
            <Space align="center">
              <Avatar size={48}>{avatarText(detailUser.email)}</Avatar>
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>{detailUser.email}</Typography.Title>
                <Typography.Text type="secondary">{detailUser.id}</Typography.Text>
              </div>
            </Space>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t('users.detailSource.identity')}>
                <Typography.Text copyable>{detailUser.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('users.role')}>
                <Tag>{t('users.roleCustomer')}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('users.status')}>
                <Tag color={accountStatusColor(detailUser.status)}>{t(`users.statusValue.${detailUser.status}`)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('users.tenantId')}>{detailUser.tenantId}</Descriptions.Item>
              <Descriptions.Item label={t('users.balance')}>
                {formatUserWalletAmount(detailUser.wallet?.available, detailUser.wallet?.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={t('users.frozenBalance')}>
                {formatUserWalletAmount(detailUser.wallet?.frozen, detailUser.wallet?.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={t('users.orderIp')}>
                {t('users.orderIpValue', { orders: formatOptionalNumber(detailUser.orderCount), ips: formatOptionalNumber(detailUser.proxyCount) })}
              </Descriptions.Item>
              <Descriptions.Item label={t('users.kycStatus')}>{detailUser.kycStatus}</Descriptions.Item>
            <Descriptions.Item label={t('users.detailSource.operations')}>
                <Typography.Text type="secondary">
                  {t('users.detailSource.operationHint')}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('users.createdAt')}>{formatDateTime(detailUser.createdAt)}</Descriptions.Item>
              {detailUser.updatedAt && (
                <Descriptions.Item label={t('users.updatedAt')}>{formatDateTime(detailUser.updatedAt)}</Descriptions.Item>
              )}
            </Descriptions>
          </Space>
        )}
      </Drawer>
      <Drawer
        title={priceUser ? t('users.price.title', { email: priceUser.email }) : t('users.price.titleEmpty')}
        open={!!priceUser}
        onClose={() => {
          setPriceUser(null);
          resetPriceResourceSelection();
        }}
        width={1080}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={() => {
              setPriceUser(null);
              resetPriceResourceSelection();
            }}>{t('cancel')}</Button>
            <Button type="primary" onClick={() => priceForm.submit()} loading={priceOverrideMutation.isPending}>
              {t('users.price.submitBatch', { count: selectedPriceResources.length })}
            </Button>
          </Space>
        )}
      >
        <Card className="ipx-admin-user-price-card" variant="borderless" style={surfaceCardStyle()} styles={{ body: { padding: 16 } }}>
        <Form form={priceForm} layout="vertical" onFinish={submitPrice}>
          <Alert
            type="info"
            showIcon
            message={t('users.price.priorityNotice')}
            description={t('users.price.overrideHint')}
            style={{ marginBottom: 16 }}
          />
          {resourcesQuery.isError && (
            <Alert
              type="error"
              showIcon
              message={t('error')}
              description={formatUserFailure(resourcesQuery.error, t)}
              style={{ marginTop: 16 }}
            />
          )}
          {resourcesQuery.backgroundError !== null && (
            <Alert
              type="warning"
              showIcon
              message={t('resources.quickPricePartialLoadFailed')}
              description={formatUserFailure(resourcesQuery.backgroundError, t)}
              style={{ marginTop: 16 }}
            />
          )}
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Typography.Text type="secondary">{t('users.price.enabledOnlyHint')}</Typography.Text>
              <Space wrap>
                <Tag color="blue">{t('users.price.loadedResources', { count: priceResources.length, total: resourcesQuery.total })}</Tag>
                {resourcesQuery.isFetchingRemaining && (
                  <Tag color="processing">{t('resources.quickPriceLoadingMore')}</Tag>
                )}
                <Tag>{t('resources.quickPriceCountries', { count: visiblePriceCountryGroups.length })}</Tag>
              </Space>
            </div>
            {resourcesQuery.isLoading ? (
              <Card size="small" loading />
            ) : priceResources.length === 0 && resourcesQuery.isFetchingRemaining ? (
              <Alert type="info" showIcon message={t('resources.quickPriceLoadingMore')} />
            ) : priceResources.length === 0 ? (
              <Alert type="info" showIcon message={t('users.price.noProducts')} />
            ) : (
              <Row gutter={12}>
                <Col xs={24} md={7}>
                  <div style={pricePanelStyle}>
                    <div style={pricePanelHeaderStyle}>
                      <Typography.Text strong>{t('resources.bulkCountry')}</Typography.Text>
                      <Tag>{t('resources.quickPriceCountries', { count: visiblePriceCountryGroups.length })}</Tag>
                    </div>
                      <Input.Search
                        allowClear
                        prefix={<SearchOutlined />}
                        value={priceCountrySearch}
                        placeholder={t('users.price.countrySearchPlaceholder')}
                        onChange={(event) => handlePriceCountrySearch(event.target.value)}
                        onSearch={(value) => handlePriceCountrySearch(value)}
                        style={{ marginBottom: 10 }}
                      />
                      <Space size={6} wrap style={{ marginBottom: 10 }}>
                        <Tag>{t('users.price.filteredResources', { count: filteredPriceResources.length })}</Tag>
                        <Button size="small" onClick={selectFilteredPriceResources} disabled={filteredPriceResources.length === 0}>
                          {t('users.price.selectAllFiltered')}
                        </Button>
                        <Button size="small" onClick={() => setPriceSelectedResourceIds([])} disabled={priceSelectedResourceIds.length === 0}>
                          {t('users.price.clearSelected')}
                        </Button>
                      </Space>
                      {visiblePriceCountryGroups.length === 0 ? (
                        <Alert type="info" showIcon message={t('users.price.noCountryMatches')} />
                      ) : (
                      <Space direction="vertical" size={8} style={{ width: '100%', maxHeight: 292, overflowY: 'auto', paddingRight: 2 }}>
                        {visiblePriceCountryGroups.map((group) => {
                          const active = selectedPriceCountry?.key === group.key;
                          return (
                            <Button
                              key={group.key}
                              block
                              type="default"
                              onClick={() => {
                                const firstRegion = group.regions[0] ?? null;
                                clearNetworkSelection();
                                setPriceCountryKey(group.key);
                                setPriceRegionKey(firstRegion?.key ?? null);
                              }}
                              style={priceSelectorButtonStyle(active)}
                            >
                              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
                                  <Typography.Text strong style={{ color: active ? '#123fbf' : '#111827' }}>{group.label}</Typography.Text>
                                  <Tag style={{ marginInlineEnd: 0 }}>{group.countryCode || '-'}</Tag>
                                </Space>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {t('resources.quickPriceRegionCount', { regions: group.regions.length, resources: group.resources.length })}
                                </Typography.Text>
                              </Space>
                            </Button>
                          );
                        })}
                      </Space>
                    )}
                  </div>
                </Col>
                <Col xs={24} md={7}>
                  <div style={pricePanelStyle}>
                    <div style={pricePanelHeaderStyle}>
                      <Typography.Text strong>{t('resources.bulkRegion')}</Typography.Text>
                      <Tag>{t('resources.quickPriceRegionCount', { regions: priceRegionGroups.length, resources: selectedPriceCountry?.resources.length ?? 0 })}</Tag>
                    </div>
                    <Space direction="vertical" size={8} style={{ width: '100%', maxHeight: 334, overflowY: 'auto', paddingRight: 2 }}>
                      {priceRegionGroups.map((group) => {
                        const active = selectedPriceRegion?.key === group.key;
                        return (
                          <Button
                            key={group.key}
                            block
                            type="default"
                            onClick={() => {
                              clearNetworkSelection();
                              setPriceRegionKey(group.key);
                            }}
                            style={priceSelectorButtonStyle(active)}
                          >
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Typography.Text strong={active} ellipsis={{ tooltip: group.label }} style={{ color: active ? '#123fbf' : undefined }}>
                                {group.label}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {t('resources.bulkResourceCount', { count: group.resources.length })}
                              </Typography.Text>
                            </Space>
                          </Button>
                        );
                      })}
                    </Space>
                  </div>
                </Col>
                <Col xs={24} md={10}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Typography.Text strong>{t('resources.bulkSelectedResources')}</Typography.Text>
                      <Space size={6} wrap>
                        <Tag>{t('resources.bulkRegion')}</Tag>
                        <Tag>{t('users.price.selectedResources', { count: selectedPriceResources.length })}</Tag>
                        <Tag color="blue">{t('resources.resourceCost')}: {summarizeUserPriceCosts(selectedPriceRegion?.resources ?? [], t).label}</Tag>
                      </Space>
                      <div style={{ maxHeight: 236, overflowY: 'auto', border: '1px solid #eef2f8', borderRadius: 8, padding: 8, background: '#fbfcff' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                          {selectedPriceResources.map((resource) => {
                            const location = formatResourceLocationZh(resource);
                            const price = formatMoneyAmount(resource.unitPrice ?? null, resource.priceCurrency ?? DEFAULT_PRICE_CURRENCY) ?? '-';
                            const cost = formatResourceCost(resource, t);
                            return (
                              <Card key={resource.id} size="small" styles={{ body: { padding: 10 } }}>
                                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                  <Typography.Text strong ellipsis={{ tooltip: location.title }}>{location.title}</Typography.Text>
                                  <Typography.Text type="secondary" ellipsis={{ tooltip: location.country }} style={{ fontSize: 12 }}>
                                    {location.country}
                                  </Typography.Text>
                                  <Space size={6} wrap>
                                    <Tag>{formatProviderLabel(resource.providerCode)}</Tag>
                                    <Tag>{t('resources.resourcePrice')}: {price}</Tag>
                                    <Tag color={resource.upstreamCost ? 'blue' : 'default'}>{t('resources.resourceCost')}: {cost}</Tag>
                                    <Tag>{formatIpTypeZh(resource.ipType)}</Tag>
                                    <Tag>{formatProtocolZh(resource.protocol)}</Tag>
                                  </Space>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: resource.code }}>
                                    {compactTraceValue(resource.code, 28)}
                                  </Typography.Text>
                                </Space>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    </Space>
                    <Form.Item name="unitPrice" label={t('users.price.unitPrice')} rules={[{ required: true, type: 'number', min: 0 }]}>
                      <InputNumber min={0} precision={2} size="large" style={{ width: '100%' }} />
                    </Form.Item>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #ebebeb' }}>
                      <Button onClick={() => resetPriceResourceSelection()}>{t('users.price.resetSelection')}</Button>
                      <Button
                        type="primary"
                        loading={priceOverrideMutation.isPending}
                        disabled={selectedPriceResources.length === 0}
                        onClick={() => priceForm.submit()}
                      >
                        {t('users.price.submitBatch', { count: selectedPriceResources.length })}
                      </Button>
                    </div>
                    <Typography.Text type={selectedPriceResources.length > 0 ? 'secondary' : 'danger'}>
                      {t('users.price.selectedResources', { count: selectedPriceResources.length })}
                    </Typography.Text>
                  </Space>
                </Col>
              </Row>
            )}
          </Space>
        </Form>
        </Card>
      </Drawer>
      <Modal
        title={passwordUser ? t('users.password.title', { email: passwordUser.email }) : t('users.password.titleEmpty')}
        open={!!passwordUser}
        onCancel={() => setPasswordUser(null)}
        footer={null}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" onFinish={submitPassword}>
          <Form.Item
            name="password"
            label={t('users.password.newPassword')}
            rules={[
              { required: true, message: t('users.password.required') },
              { min: 8, message: t('users.password.weak') },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setPasswordUser(null)}>{t('cancel')}</Button>
            <Popconfirm
              title={t('users.password.confirmTitle')}
              okText={t('users.operations.resetPassword')}
              cancelText={t('cancel')}
              onConfirm={() => passwordForm.submit()}
            >
              <Button type="primary" danger loading={resetPasswordMutation.isPending}>{t('users.operations.resetPassword')}</Button>
            </Popconfirm>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

function avatarText(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function formatOptionalNumber(value: number | undefined): number | string {
  return value === undefined ? '-' : value;
}

function formatUserWalletAmount(amount?: string, currency?: string): string {
  if (!amount || !currency) return '-';
  return formatMoneyAmount(amount, currency) ?? '-';
}

function formatResourceCost(resource: ResourceOption, t: (key: string, values?: Record<string, unknown>) => string): string {
  const cost = formatMoneyAmount(resource.upstreamCost ?? null, resource.upstreamCostCurrency ?? resource.priceCurrency ?? DEFAULT_PRICE_CURRENCY);
  return cost ?? t('resources.resourceCostMissing');
}

function summarizeUserPriceCosts(
  resources: ResourceOption[],
  t: (key: string, values?: Record<string, unknown>) => string,
): { label: string; hasCost: boolean } {
  const knownCosts = resources
    .map((resource) => {
      const amount = Number(resource.upstreamCost);
      if (!Number.isFinite(amount)) return null;
      const currency = resource.upstreamCostCurrency ?? resource.priceCurrency ?? DEFAULT_PRICE_CURRENCY;
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

function isUserPriceSelectableResource(resource: ResourceOption): boolean {
  return resource.status === 'ACTIVE' && resource.isVisible === true && resource.isSaleable === true;
}

function groupUserPriceResources(resources: ResourceOption[]): UserPriceCountryGroup[] {
  const countries = new Map<string, UserPriceCountryGroup>();
  for (const resource of resources) {
    const countryCode = (resource.countryCode || resource.code.split(':')[0] || resource.code).slice(0, 2).toUpperCase();
    const location = formatResourceLocationZh(resource);
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

    const regionLabel = getUserPriceRegionLabel(resource);
    const regionKey = `${countryKey}:${regionLabel}`;
    let region = country.regions.find((item) => item.key === regionKey);
    if (!region) {
      region = {
        key: regionKey,
        label: regionLabel,
        countryCode,
        countryLabel: location.country,
        resources: [],
      };
      country.regions.push(region);
    }
    region.resources.push(resource);
  }
  return [...countries.values()]
    .map((country) => ({
      ...country,
      regions: country.regions.sort((a, b) => `${a.countryLabel}-${a.label}`.localeCompare(`${b.countryLabel}-${b.label}`, 'zh-CN')),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function uniqueResources(resources: ResourceOption[]): ResourceOption[] {
  const resourcesById = new Map<string, ResourceOption>();
  for (const resource of resources) {
    resourcesById.set(resource.id, resource);
  }
  return [...resourcesById.values()];
}

function getUserPriceRegionLabel(resource: ResourceOption): string {
  const proxySeller = getUserPriceProxySellerProjection(resource);
  if (proxySeller) return proxySeller.regionLabel;
  const location = formatResourceLocationZh(resource);
  const cidr = getUserPriceNetworkCidr(resource);
  const detailWithoutCidr = cidr && location.detail?.endsWith(`-${cidr}`)
    ? location.detail.slice(0, -cidr.length - 1)
    : location.detail;
  return location.city || detailWithoutCidr || location.country;
}

function getUserPriceNetworkCidr(resource: ResourceOption): string | null {
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

function getUserPriceProxySellerProjection(resource: ResourceOption): {
  regionLabel: string;
  lineKey: string;
  lineLabel: string;
  networkKey: string;
  networkLabel: string;
  subtitle: string | null;
  traceLabel: string;
} | null {
  if (resource.providerCode !== 'PR') return null;
  const countryCode = (resource.countryCode || resource.code.split(':')[0] || '').slice(0, 2).toUpperCase();
  const rawParts =
    parseProxySellerPathSegments(resource.upstreamResourceId, countryCode)
    ?? parseProxySellerPathSegments(resource.code, countryCode)
    ?? parseProxySellerPathSegments(resource.displayName, countryCode)
    ?? parseProxySellerPathSegments(resource.name, countryCode);
  if (!rawParts || rawParts.length === 0) return null;

  const localizedParts = rawParts.map((part, index) => localizeProxySellerPathPart(part, countryCode, index));
  const regionParts = localizedParts.length >= 3 ? localizedParts.slice(0, -1) : localizedParts.slice(0, 1);
  const regionLabel = regionParts.join('-') || formatResourceLocationZh(resource).country;
  const lastRawPart = rawParts[rawParts.length - 1] ?? resource.id;
  const lastLocalizedPart = localizedParts[localizedParts.length - 1] ?? makeResourceReferenceLabel(lastRawPart);
  const lineLabel = localizedParts.length >= 2 ? lastLocalizedPart : regionLabel;
  const lineKey = localizedParts.length >= 2 ? `pr:${lastRawPart}` : `pr:${rawParts[0] ?? regionLabel}`;
  const traceLabel = formatUserPriceTraceLabel(resource);
  const networkLabel = localizedParts.length >= 2 ? lastLocalizedPart : makeResourceReferenceLabel(resource.id);
  const subtitle = localizedParts.length >= 2
    ? [regionLabel, traceLabel].filter(Boolean).join(' / ')
    : [formatResourceLocationZh(resource).country, regionLabel, traceLabel].filter(Boolean).join(' / ');

  return {
    regionLabel,
    lineKey,
    lineLabel,
    networkKey: resource.id,
    networkLabel,
    subtitle,
    traceLabel,
  };
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

function localizeProxySellerPathPart(part: string, countryCode: string, index: number): string {
  const localized = formatResourceLocationZh({
    id: `${countryCode}-${index}`,
    code: `${countryCode}:${part}`,
    countryCode,
    providerCode: 'PR',
    name: `${countryCode}-${part}`,
    displayName: `${countryCode}-${part}`,
  }).detail?.trim();
  return localized || makeResourceReferenceLabel(part);
}

function makeResourceReferenceLabel(value: string): string {
  return `资源 ${makeStableNumericSuffix(value)}`;
}

function formatUserPriceTraceLabel(resource: ResourceOption): string {
  return `#${makeStableNumericSuffix(resource.id || resource.upstreamResourceId || resource.code)}`;
}

function makeStableNumericSuffix(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return String(hash).slice(-6).padStart(6, '0');
}

function matchesPriceCountrySearch(group: UserPriceCountryGroup, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;
  const searchable = [
    group.label,
    group.countryCode,
    ...group.regions.map((region) => region.label),
    ...group.resources.flatMap((resource) => [
      resource.id,
      resource.code,
      resource.name,
      resource.displayName ?? '',
      resource.upstreamResourceId ?? '',
      resource.countryCode ?? '',
      formatResourceLocationZh(resource).title,
      formatProviderLabel(resource.providerCode),
      formatIpTypeZh(resource.ipType),
      formatProtocolZh(resource.protocol),
    ]),
  ].join(' ').toLocaleLowerCase('zh-CN');
  return searchable.includes(normalizedSearch);
}

function compactTraceValue(value: string, visibleChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= visibleChars) return trimmed;
  return `${trimmed.slice(0, visibleChars)}...`;
}

function buildUserActionItems(
  user: UserDto,
  t: (key: string, values?: Record<string, unknown>) => string,
  pendingAction: { userId: string; action: UserWorkflow } | null,
  inDetailDrawer = false,
): MenuProps['items'] {
  const isPending = (action: UserWorkflow) => pendingAction?.userId === user.id && pendingAction.action === action;
  return [
    ...(!inDetailDrawer
      ? [{
          key: 'detail',
          label: t('users.detail'),
          icon: <EyeOutlined />,
        }]
      : []),
    {
      key: 'adjust-wallet',
      label: t('users.operations.adjustWallet'),
    },
    {
      key: 'assisted-order',
      label: t('users.assistedOrder.button'),
    },
    {
      key: 'set-price',
      label: t('users.operations.setPrice'),
    },
    { type: 'divider' },
    {
      key: 'impersonate',
      label: t('users.operations.impersonate'),
      icon: isPending('impersonate') ? <LoadingOutlined /> : <LoginOutlined />,
      disabled: user.status !== 'ACTIVE' || isPending('impersonate'),
    },
    {
      key: 'reset-password',
      label: t('users.operations.resetPassword'),
      icon: isPending('reset-password') ? <LoadingOutlined /> : undefined,
      disabled: isPending('reset-password'),
    },
    {
      key: 'toggle-status',
      label: user.status === 'ACTIVE' ? t('users.operations.disable') : t('users.operations.enable'),
      icon: isPending('toggle-status') ? <LoadingOutlined /> : undefined,
      disabled: isPending('toggle-status'),
    },
    {
      key: 'delete',
      label: t('users.operations.delete'),
      icon: isPending('delete') ? <LoadingOutlined /> : <DeleteOutlined />,
      disabled: isPending('delete'),
      danger: true,
    },
  ];
}

function getUserWorkflowLabelKey(action: UserWorkflow): string {
  if (action === 'detail') return 'users.detail';
  if (action === 'adjust-wallet') return 'users.operations.adjustWallet';
  if (action === 'assisted-order') return 'users.assistedOrder.button';
  if (action === 'set-price') return 'users.operations.setPrice';
  if (action === 'reset-password') return 'users.operations.resetPassword';
  if (action === 'toggle-status') return 'users.operations.status';
  if (action === 'impersonate') return 'users.operations.impersonate';
  return 'users.operations.delete';
}

function getReasonKey(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function formatUserFailure(error: unknown, t: (key: string, values?: Record<string, unknown>) => string): string {
  const reasonKey = typeof error === 'string' ? error : getReasonKey(error, t('error'));
  const key = `users.reason.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('users.reason.generic') : translated;
}

function UserActionMenu({
  user,
  menuText,
  items,
  onAction,
}: {
  user: UserDto;
  menuText: string;
  items: MenuProps['items'];
  onAction: (user: UserDto, workflow: UserWorkflow) => void;
}) {
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items,
        onClick: ({ key }) => onAction(user, key as UserWorkflow),
      }}
    >
      <Button size="small" aria-label={menuText}>
        <Space size={4}>
          {menuText}
          <DownOutlined />
        </Space>
      </Button>
    </Dropdown>
  );
}

export function navigateToCustomerAfterImpersonation(): void {
  window.location.assign('/customer');
}
