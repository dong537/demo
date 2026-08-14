import React from 'react';
import { Alert, Button, Card, Col, Descriptions, Dropdown, Row, Skeleton, Space, Statistic, Tabs, Tag, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../shared/api/client';
import type { ApiError } from '../../shared/api/client';
import { useCurrentAdmin } from '../../shared/auth/current-user';
import { UserListFeature } from '../admin-users/user-list.feature';
import { OrderListFeature } from '../admin-orders/order-list.feature';
import { TenantBrandFeature } from './tenant-brand.feature';
import { PageHeader } from '../../shared/ui/page-header';
import { formatDateTime } from '../../shared/time/time';
import { kpiCardStyle, surfaceCardStyle } from '../../shared/ui/surface';

interface TenantDetailDto {
  id: string;
  name: string;
  code: string;
  status: string;
  totalBalance: string;
  customerCount: number;
  orderCount: number;
  monthlyOrders: number;
  createdAt: string;
  updatedAt?: string | null;
}

interface TenantDetailFeatureProps {
  tenantId: string;
  mode?: 'tenant' | 'reseller';
}

function tenantStatusColor(status: string) {
  if (status === 'ACTIVE') return 'green';
  if (status === 'SUSPENDED') return 'orange';
  return 'default';
}

export function TenantDetailFeature({ tenantId, mode = 'tenant' }: TenantDetailFeatureProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentAdmin = useCurrentAdmin();
  const isPlatformAdmin = currentAdmin.data?.ownerType === 'PLATFORM_ADMIN';

  const query = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => apiRequest<TenantDetailDto>(`/api/tenants/${tenantId}`),
  });

  const suspendMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/tenants/${tenantId}/status`, { method: 'PUT', body: JSON.stringify({ status: 'SUSPENDED' }) }),
    onSuccess: () => {
      message.success(t('tenants.suspendSuccess'));
      void qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.error) {
    const err = query.error as ApiError;
    return <Alert type="error" message={t('error')} description={err.reasonKey} showIcon />;
  }

  const d = query.data!;
  return (
    <>
      <PageHeader
        kicker={t(mode === 'reseller' ? 'resellers.kicker' : 'tenants.kicker')}
        title={d.name}
        description={(
          <Space wrap size={8}>
            <Typography.Text type="secondary">{d.code}</Typography.Text>
            <Tag color={tenantStatusColor(d.status)}>
              {formatKnownTranslation(t, `tenants.statusValue.${d.status}`, d.status)}
            </Tag>
          </Space>
        )}
        extra={isPlatformAdmin && d.status !== 'SUSPENDED' ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'suspend', label: t('tenants.suspend'), danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'suspend') suspendMutation.mutate();
              },
            }}
          >
            <Button loading={suspendMutation.isPending}>
              <Space size={4}>
                {t('tenants.operations.more')}
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        ) : undefined}
      />
      {suspendMutation.error && (
        <Alert
          type="error"
          message={t('error')}
          description={(suspendMutation.error as ApiError).reasonKey}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs
        items={[
          {
            key: 'overview',
            label: t('tenants.tabOverview'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <Card variant="borderless" style={kpiCardStyle('#315cff')}>
                      <Statistic title={t('tenants.totalBalance')} value={d.totalBalance} />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card variant="borderless" style={kpiCardStyle('#16a34a')}>
                      <Statistic title={t('tenants.customerCount')} value={d.customerCount} />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card variant="borderless" style={kpiCardStyle('#f59e0b')}>
                      <Statistic title={t('tenants.monthlyOrders')} value={d.monthlyOrders} />
                    </Card>
                  </Col>
                </Row>
                <Card variant="borderless" style={surfaceCardStyle()}>
                  <Descriptions
                    title={t('tenants.summary.title')}
                    size="small"
                    column={{ xs: 1, md: 2 }}
                    items={[
                      { key: 'id', label: t('tenants.id'), children: d.id },
                      { key: 'code', label: t('tenants.code'), children: d.code },
                      {
                        key: 'status',
                        label: t('tenants.status'),
                        children: (
                          <Tag color={tenantStatusColor(d.status)}>
                            {formatKnownTranslation(t, `tenants.statusValue.${d.status}`, d.status)}
                          </Tag>
                        ),
                      },
                      { key: 'orders', label: t('tenants.orderCount'), children: d.orderCount },
                      { key: 'createdAt', label: t('tenants.createdAt'), children: formatDateTime(d.createdAt) },
                      ...(d.updatedAt ? [{ key: 'updatedAt', label: t('tenants.updatedAt'), children: formatDateTime(d.updatedAt) }] : []),
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'users',
            label: t('tenants.tabUsers'),
            children: <UserListFeature tenantId={tenantId} hideTitle />,
          },
          {
            key: 'orders',
            label: t('tenants.tabOrders'),
            children: <OrderListFeature tenantId={tenantId} hideTitle />,
          },
          {
            key: 'brand',
            label: t('tenants.tabBrand'),
            children: <TenantBrandFeature tenantId={tenantId} />,
          },
        ]}
      />
    </>
  );
}

function formatKnownTranslation(t: (key: string) => string, key: string, fallback: string): string {
  const label = t(key);
  return label === key ? fallback : label;
}
