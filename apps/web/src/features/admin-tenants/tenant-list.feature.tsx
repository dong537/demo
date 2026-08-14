import React, { useState } from 'react';
import { Alert, Button, Card, Col, Dropdown, Row, Space, Statistic, Tag, Typography, message } from 'antd';
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from '@tanstack/react-router';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { useCurrentAdmin } from '../../shared/auth/current-user';
import { formatDateTime } from '../../shared/time/time';
import { PageHeader } from '../../shared/ui/page-header';
import { kpiCardStyle } from '../../shared/ui/surface';

interface TenantDto {
  id: string;
  name: string;
  code: string;
  status: string;
  customerCount: number;
  totalBalance?: string;
  createdAt: string;
}

interface TenantListFeatureProps {
  mode?: 'tenant' | 'reseller';
}

function tenantStatusColor(status: string) {
  if (status === 'ACTIVE') return 'green';
  if (status === 'SUSPENDED') return 'orange';
  return 'default';
}

export function TenantListFeature({ mode = 'tenant' }: TenantListFeatureProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const currentAdmin = useCurrentAdmin();

  const isPlatformAdmin = currentAdmin.data?.ownerType === 'PLATFORM_ADMIN';
  const basePath: string = mode === 'reseller' ? '/admin/resellers' : '/admin/tenants';
  const titleKey = mode === 'reseller' ? 'resellers.title' : 'tenants.title';
  const createKey = mode === 'reseller' ? 'resellers.create' : 'tenants.create';
  const navigateTo = (to: string) => { void navigate({ to }); };

  const query = useQuery({
    queryKey: ['tenants', page, pageSize],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: TenantDto[] }>(
        `/api/tenants${buildQuery({ page, pageSize })}`,
      ),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/tenants/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'SUSPENDED' }) }),
    onSuccess: () => {
      message.success(t('tenants.suspendSuccess'));
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  const columns: ColumnsType<TenantDto> = [
    {
      title: t('tenants.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.id}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('tenants.code'),
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag>{code}</Tag>,
    },
    {
      title: t('tenants.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={tenantStatusColor(status)}>
          {formatKnownTranslation(t, `tenants.statusValue.${status}`, status)}
        </Tag>
      ),
    },
    {
      title: t('tenants.customerCount'),
      dataIndex: 'customerCount',
      key: 'customerCount',
      render: (count: number) => <Typography.Text strong>{count}</Typography.Text>,
    },
    {
      title: t('tenants.totalBalance'),
      dataIndex: 'totalBalance',
      key: 'totalBalance',
      render: (value: string | undefined) => value ?? '-',
    },
    {
      title: t('tenants.audit'),
      key: 'audit',
      render: (_: unknown, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('tenants.createdAt')}: {formatDateTime(row.createdAt)}
        </Typography.Text>
      ),
    },
    {
      title: t('tenants.actions'),
      key: 'actions',
      render: (_: unknown, row: TenantDto) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'detail', label: t('tenants.detail') },
              ...(isPlatformAdmin && row.status !== 'SUSPENDED'
                ? [{ key: 'suspend', label: t('tenants.suspend'), danger: true }]
                : []),
            ],
            onClick: ({ key }) => {
              if (key === 'detail') navigateTo(`${basePath}/${row.id}`);
              if (key === 'suspend') suspendMutation.mutate(row.id);
            },
          }}
        >
          <Button size="small" loading={suspendMutation.isPending}>
            <Space size={4}>
              {t('tenants.operations.more')}
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
      ),
    },
  ];

  const toolbar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      <Space wrap size={8}>
        <Tag color="blue">{t('tenants.summary.total', { total: query.data?.total ?? 0 })}</Tag>
        <Tag>{t('tenants.summary.currentPage', { count: query.data?.items.length ?? 0 })}</Tag>
      </Space>
      {isPlatformAdmin && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigateTo(`${basePath}/new`)}
        >
          {t(createKey)}
        </Button>
      )}
    </div>
  );

  const tenants = query.data?.items ?? [];
  const activeCount = tenants.filter((tenant) => tenant.status === 'ACTIVE').length;

  return (
    <>
      <PageHeader
        kicker={t('tenants.kicker')}
        title={t(titleKey)}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
            <Card variant="borderless" style={kpiCardStyle('#315cff')} styles={{ body: { padding: 16 } }}>
              <Statistic title={t('tenants.listMetrics.total')} value={query.data?.total ?? '-'} />
            </Card>
        </Col>
        <Col xs={24} md={8}>
            <Card variant="borderless" style={kpiCardStyle('#16a34a')} styles={{ body: { padding: 16 } }}>
              <Statistic title={t('tenants.listMetrics.activeOnPage')} value={query.data ? activeCount : '-'} />
            </Card>
        </Col>
        <Col xs={24} md={8}>
            <Card variant="borderless" style={kpiCardStyle('#f59e0b')} styles={{ body: { padding: 16 } }}>
              <Statistic title={t('tenants.listMetrics.customersOnPage')} value={query.data ? tenants.reduce((sum, tenant) => sum + tenant.customerCount, 0) : '-'} />
            </Card>
        </Col>
      </Row>
      {suspendMutation.error && (
        <Alert
          type="error"
          message={t('error')}
          description={(suspendMutation.error as { reasonKey?: string }).reasonKey ?? t('error')}
          showIcon
          style={{ marginBottom: 16 }}
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
    </>
  );
}

function formatKnownTranslation(t: (key: string) => string, key: string, fallback: string): string {
  const label = t(key);
  return label === key ? fallback : label;
}
