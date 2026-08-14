import React, { useState } from 'react';
import { Button, DatePicker, Drawer, Input, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';
import { ListPage } from '../../shared/ui/list-page';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatProxyStatusZh, proxyStatusColor } from '../../shared/proxy/proxy-labels';

export interface AdminProxyDto {
  id: string;
  siteId: string;
  tenantId: string;
  userId: string;
  orderId: string;
  resourceId?: string | null;
  providerCode: string;
  providerResourceId?: string | null;
  sourceCode?: string | null;
  ip: string;
  port: number;
  protocol: string;
  countryCode: string;
  regionCode: string | null;
  ipType: string;
  status: string;
  expiresAt: string;
  businessType: string | null;
  userNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProxyFilters {
  page: number;
  pageSize: number;
  search?: string;
  orderId?: string;
  userId?: string;
  countryCode?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function buildAdminProxyListPath(filters: AdminProxyFilters): string {
  return `/api/proxies${buildQuery({
    page: filters.page,
    pageSize: filters.pageSize,
    search: filters.search,
    orderId: filters.orderId,
    userId: filters.userId,
    countryCode: filters.countryCode,
    status: filters.status,
    from: filters.from,
    to: filters.to,
  })}`;
}

const EMPTY_FILTERS: Omit<AdminProxyFilters, 'page' | 'pageSize'> = {
  search: undefined,
  orderId: undefined,
  userId: undefined,
  countryCode: undefined,
  status: undefined,
  from: undefined,
  to: undefined,
};

export function AdminProxyListFeature() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState<AdminProxyDto | null>(null);

  const listPath = buildAdminProxyListPath({ page, pageSize, ...filters });

  const query = useQuery({
    queryKey: ['admin-proxies', page, pageSize, filters],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: AdminProxyDto[] }>(listPath),
  });

  const patchFilter = (patch: Partial<typeof EMPTY_FILTERS>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const columns: ColumnsType<AdminProxyDto> = [
    {
      title: t('adminProxies.instance'),
      key: 'endpoint',
      render: (_: unknown, row: AdminProxyDto) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong copyable={{ text: `${row.ip}:${row.port}` }}>
            {row.ip}:{row.port}
          </Typography.Text>
          <Space size={4} wrap>
            <Tag>{row.protocol}</Tag>
            <Tag>{row.ipType}</Tag>
            <Tag color="blue">{formatProviderLabel(row.providerCode)}</Tag>
          </Space>
          <Typography.Text type="secondary" copyable={{ text: row.id }} style={{ fontSize: 12 }}>
            {t('adminProxies.proxyId')}: {shortId(row.id)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminProxies.countryCode'),
      key: 'location',
      render: (_: unknown, row: AdminProxyDto) => (
        <Space size={4} wrap>
          <Tag>{row.countryCode}</Tag>
          {row.regionCode && <Tag>{row.regionCode}</Tag>}
          {row.businessType && <Tag>{row.businessType}</Tag>}
        </Space>
      ),
    },
    {
      title: t('adminProxies.status'),
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => <Tag color={proxyStatusColor(v)}>{formatProxyStatusZh(v)}</Tag>,
    },
    {
      title: t('adminProxies.ownerSection'),
      key: 'owner',
      render: (_: unknown, row: AdminProxyDto) => (
        <Space direction="vertical" size={2}>
          <Typography.Text copyable={{ text: row.orderId }}>
            {t('adminProxies.orderId')}: {row.orderId}
          </Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.userId }}>
            {t('adminProxies.userId')}: {row.userId}
          </Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.tenantId }}>
            {t('adminProxies.tenantId')}: {shortId(row.tenantId)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminProxies.resourceSection'),
      key: 'resource',
      render: (_: unknown, row: AdminProxyDto) => (
        <Space direction="vertical" size={2}>
          <Typography.Text copyable={row.resourceId ? { text: row.resourceId } : false}>
            {t('adminProxies.resourceId')}: {row.resourceId ? shortId(row.resourceId) : '-'}
          </Typography.Text>
          <Typography.Text type="secondary" copyable={row.providerResourceId ? { text: row.providerResourceId } : false}>
            {t('adminProxies.providerResourceId')}: {row.providerResourceId ?? '-'}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t('adminProxies.sourceCode')}: {row.sourceCode ?? row.countryCode}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminProxies.lifecycleSection'),
      key: 'lifecycle',
      render: (_: unknown, row: AdminProxyDto) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{t('adminProxies.expiresAt')}: {formatDateTime(row.expiresAt)}</Typography.Text>
          <Typography.Text type="secondary">{t('adminProxies.createdAt')}: {formatDateTime(row.createdAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminProxies.actions'),
      key: 'actions',
      render: (_: unknown, row: AdminProxyDto) => (
        <Button size="small" onClick={() => setDetail(row)}>
          {t('adminProxies.viewDetail')}
        </Button>
      ),
    },
  ];

  const toolbar = (
    <div
      style={{
        background: 'var(--ipx-surface)',
        border: '1px solid var(--ipx-border)',
        borderRadius: 'var(--ipx-radius)',
        padding: 12,
        marginBottom: 16,
      }}
    >
      <Space wrap size={8}>
        <Input.Search
          allowClear
          placeholder={t('adminProxies.searchPlaceholder')}
          style={{ width: 260 }}
          onSearch={(v) => patchFilter({ search: v || undefined })}
        />
        <Input
          allowClear
          placeholder={t('adminProxies.orderIdFilter')}
          style={{ width: 180 }}
          onChange={(e) => patchFilter({ orderId: e.target.value || undefined })}
        />
        <Input
          allowClear
          placeholder={t('adminProxies.userIdFilter')}
          style={{ width: 180 }}
          onChange={(e) => patchFilter({ userId: e.target.value || undefined })}
        />
        <Input
          allowClear
          placeholder={t('adminProxies.countryFilter')}
          style={{ width: 132 }}
          onChange={(e) => patchFilter({ countryCode: e.target.value || undefined })}
        />
        <Select
          placeholder={t('adminProxies.statusFilter')}
          allowClear
          style={{ width: 160 }}
          onChange={(v) => patchFilter({ status: v || undefined })}
          options={[
            { value: 'ACTIVE', label: formatProxyStatusZh('ACTIVE') },
            { value: 'EXPIRED', label: formatProxyStatusZh('EXPIRED') },
            { value: 'RELEASED', label: formatProxyStatusZh('RELEASED') },
          ]}
        />
        <DatePicker.RangePicker
          placeholder={[t('adminProxies.expiresFrom'), t('adminProxies.expiresTo')]}
          onChange={(_, s) => patchFilter({ from: s[0] || undefined, to: s[1] || undefined })}
        />
      </Space>
    </div>
  );

  return (
    <>
      <Typography.Title level={4}>{t('adminProxies.title')}</Typography.Title>
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('adminProxies.empty')}
        errorDescription={getReasonKey}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      <Drawer
        title={t('adminProxies.detailTitle')}
        width={640}
        open={detail !== null}
        onClose={() => setDetail(null)}
        styles={{
          body: { background: 'var(--ipx-bg)', padding: 0 },
          header: { borderBottom: '1px solid var(--ipx-border)' },
        }}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%', padding: 24 }}>
            <div
              style={{
                background: 'var(--ipx-surface)',
                border: '1px solid var(--ipx-border)',
                borderRadius: 'var(--ipx-radius-lg)',
                padding: 20,
              }}
            >
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
                {t('adminProxies.instance')}
              </Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {detail.ip}:{detail.port}
              </Typography.Title>
              <div style={{ marginTop: 12 }}>
                <Tag color={proxyStatusColor(detail.status)}>{formatProxyStatusZh(detail.status)}</Tag>
                <Tag>{detail.protocol}</Tag>
                <Tag>{detail.ipType}</Tag>
                <Tag color="blue">{formatProviderLabel(detail.providerCode)}</Tag>
              </div>
            </div>

            <DetailSection title={t('adminProxies.connectionSection')}>
              <DetailItem label={t('adminProxies.proxyId')} value={detail.id} />
              <DetailItem label={t('adminProxies.providerCode')} value={formatProviderLabel(detail.providerCode)} />
              <DetailItem label={t('adminProxies.providerResourceId')} value={detail.providerResourceId ?? '-'} />
              <DetailItem label={t('adminProxies.sourceCode')} value={detail.sourceCode ?? detail.countryCode} />
              <DetailItem label={t('adminProxies.countryCode')} value={detail.countryCode} />
              <DetailItem label={t('adminProxies.regionCode')} value={detail.regionCode ?? '-'} />
              <DetailItem label={t('adminProxies.businessType')} value={detail.businessType ?? '-'} />
            </DetailSection>

            <DetailSection title={t('adminProxies.ownerSection')}>
              <DetailItem label={t('adminProxies.siteId')} value={detail.siteId} />
              <DetailItem label={t('adminProxies.tenantId')} value={detail.tenantId} />
              <DetailItem label={t('adminProxies.orderId')} value={detail.orderId} />
              <DetailItem label={t('adminProxies.userId')} value={detail.userId} />
              <DetailItem label={t('adminProxies.resourceId')} value={detail.resourceId ?? '-'} />
              <DetailItem label={t('adminProxies.userNote')} value={detail.userNote ?? '-'} full />
            </DetailSection>

            <DetailSection title={t('adminProxies.lifecycleSection')}>
              <DetailItem label={t('adminProxies.expiresAt')} value={formatDateTime(detail.expiresAt)} />
              <DetailItem label={t('adminProxies.createdAt')} value={formatDateTime(detail.createdAt)} />
              <DetailItem label={t('adminProxies.updatedAt')} value={formatDateTime(detail.updatedAt)} />
            </DetailSection>
          </Space>
        )}
      </Drawer>
    </>
  );
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function getReasonKey(error: unknown): string {
  const apiError = error as { reasonKey?: string } | undefined;
  return apiError?.reasonKey || (error instanceof Error ? error.message : String(error));
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--ipx-surface)',
        border: '1px solid var(--ipx-border)',
        borderRadius: 'var(--ipx-radius-lg)',
        padding: 20,
      }}
    >
      <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
        {title}
      </Typography.Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function DetailItem({ label, value, full = false }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div
      style={{
        gridColumn: full ? '1 / -1' : undefined,
        border: '1px solid var(--ipx-border)',
        borderRadius: 'var(--ipx-radius)',
        padding: 12,
        minWidth: 0,
      }}
    >
      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ wordBreak: 'break-all' }}>
        {value}
      </Typography.Text>
    </div>
  );
}
