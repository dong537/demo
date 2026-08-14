import React, { useState } from 'react';
import { Button, Card, Input, Select, Space, Tag, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { formatDateTime } from '../../shared/time/time';
import { FulfillmentDetail } from './fulfillment-detail.feature';
import { AdminOrderOperations } from './admin-order-operations.feature';
import { formatMoneyAmount } from '../../shared/money/money';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import { formatResourceLocationZh } from '../../shared/resource/resource-labels';

interface OrderDto {
  id: string;
  tenantId?: string;
  tenantCode?: string | null;
  tenantName?: string | null;
  tenantAdminId?: string | null;
  tenantAdminEmail?: string | null;
  userId: string;
  userEmail?: string | null;
  type: string;
  status: string;
  totalPrice: string;
  currency?: string;
  cost?: string | null;
  providerCode?: string | null;
  upstreamOrderId?: string | null;
  failureStage?: string | null;
  failureError?: string | null;
  reasonKey?: string | null;
  resourceId?: string | null;
  resourceCode?: string | null;
  resourceName?: string | null;
  resourceDisplayName?: string | null;
  resourceCountryCode?: string | null;
  quantity?: number | null;
  durationDays?: number | null;
  fulfillmentStatus?: string | null;
  fulfillmentJobId?: string | null;
  failReason?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface OrderListFeatureProps {
  tenantId?: string;
  hideTitle?: boolean;
}

export function OrderListFeature({ tenantId, hideTitle = false }: OrderListFeatureProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin-orders', tenantId, page, pageSize, status, search, userId],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: OrderDto[] }>(
        `/api/orders${buildQuery({ page, pageSize, status, tenantId, search, userId })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnsType<OrderDto> = [
    {
      title: t('adminOrders.orderNo'),
      dataIndex: 'id',
      key: 'id',
      width: 230,
      render: (value: string, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong copyable={{ text: value }} style={{ maxWidth: 190 }} ellipsis={{ tooltip: value }}>
            {shortId(value)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('adminOrders.createdAt')}: {formatDateTime(row.createdAt)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminOrders.tenantUser'),
      key: 'tenantUser',
      width: 230,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong style={{ maxWidth: 190 }} ellipsis={{ tooltip: row.tenantName || row.tenantCode || '-' }}>
            {row.tenantName || row.tenantCode || '-'}
          </Typography.Text>
          {row.tenantCode && row.tenantName ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.tenantCode}
            </Typography.Text>
          ) : null}
          <Typography.Text strong style={{ maxWidth: 190 }} ellipsis={{ tooltip: row.userEmail || row.userId }}>
            {row.userEmail || row.userId}
          </Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.userId }} style={{ fontSize: 12, maxWidth: 190 }} ellipsis={{ tooltip: row.userId }}>
            {t('adminOrders.userId')}: {shortId(row.userId)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminOrders.productLocation'),
      key: 'resourceProvider',
      width: 330,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong style={{ maxWidth: 280 }} ellipsis={{ tooltip: getResourceTitle(row) }}>
            {getResourceTitle(row)}
          </Typography.Text>
          {row.providerCode ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatProviderLabel(row.providerCode)}
            </Typography.Text>
          ) : null}
          {row.upstreamOrderId ? (
            <Typography.Text copyable={{ text: row.upstreamOrderId }} type="secondary" style={{ fontSize: 12, maxWidth: 260 }} ellipsis={{ tooltip: row.upstreamOrderId }}>
              {row.upstreamOrderId}
            </Typography.Text>
          ) : null}
          {row.resourceId && (
            <Typography.Text copyable={{ text: row.resourceId }} type="secondary" style={{ fontSize: 12, maxWidth: 260 }} ellipsis={{ tooltip: row.resourceId }}>
              {t('adminOrders.resourceId')}: {shortId(row.resourceId)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('adminOrders.amount'),
      dataIndex: 'totalPrice',
      key: 'totalPrice',
      width: 150,
      sorter: (a, b) => Number(a.totalPrice) - Number(b.totalPrice),
      render: (value: string, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong>{formatMoneyAmount(value, row.currency ?? 'CNY') ?? '-'}</Typography.Text>
          {row.cost ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('adminOrders.cost')}: {formatMoneyAmount(row.cost, row.currency ?? 'CNY')}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('adminOrders.statusFlow'),
      key: 'statusFlow',
      width: 210,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={4}>
          <Space size={4} wrap>
            <Tag color={orderStatusColor(row.status)}>{formatKnownTranslation(t, `adminOrders.statusValue.${row.status}`, row.status)}</Tag>
            {row.status === 'REFUNDED' && <Tag color="red">{t('adminOrders.refunded')}</Tag>}
          </Space>
          {row.fulfillmentStatus ? (
            <Tag color={fulfillmentStatusColor(row.fulfillmentStatus)}>
              {t('adminOrders.fulfillment.summary')}: {row.fulfillmentStatus}
            </Tag>
          ) : <Typography.Text type="secondary">-</Typography.Text>}
          {hasOrderFailure(row) ? (
            <Space direction="vertical" size={2}>
              <Tag color="red">{formatOrderFailureReason(row, t)}</Tag>
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('adminOrders.actions'),
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_: unknown, row: OrderDto) => (
        <AdminOrderOperations
          order={row}
          extraItems={[
            {
              key: 'detail',
              label: t('adminOrders.viewDetail'),
              onClick: () => setSelectedOrderId(row.id),
            },
            {
              key: 'ledger',
              label: t('adminOrders.viewLedger'),
              onClick: () => {
                void navigate({
                  href: `/admin/wallet?userId=${encodeURIComponent(row.userId)}`,
                });
              },
            },
          ]}
        />
      ),
    },
  ];

  const visibleOrders = query.data?.items ?? [];
  const processingOnPage = visibleOrders.filter((item) => item.status === 'PENDING' || item.status === 'FULFILLING' || item.fulfillmentStatus === 'FULFILLING').length;
  const failedOnPage = visibleOrders.filter(hasOrderFailure).length;

  const toolbar = (
    <Card variant="borderless" style={surfaceCardStyle({ marginBottom: 12 })} styles={{ body: { padding: 14 } }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('refresh')}</Button>
        </div>
        <Space wrap size={8}>
          <Input.Search
            prefix={<SearchOutlined />}
            placeholder={t('adminOrders.searchPlaceholder')}
            onSearch={(v) => { setSearch(v.trim()); setPage(1); }}
            allowClear
            style={{ width: 260 }}
          />
          <Input
            placeholder={t('adminOrders.userIdFilter')}
            allowClear
            style={{ width: 200 }}
            onChange={(event) => {
              setUserId(event.target.value.trim());
              setPage(1);
            }}
            onPressEnter={(event) => {
              setUserId(event.currentTarget.value.trim());
              setPage(1);
            }}
          />
          <Select
            placeholder={t('adminOrders.statusFilter')}
            allowClear
            style={{ width: 180 }}
            value={status}
            onChange={(v) => { setStatus(v || undefined); setPage(1); }}
            options={[
              { value: '', label: t('adminOrders.allStatus') },
              { value: 'PENDING', label: t('adminOrders.statusValue.PENDING') },
              { value: 'FULFILLING', label: t('adminOrders.statusValue.FULFILLING') },
              { value: 'COMPLETED', label: t('adminOrders.statusValue.COMPLETED') },
              { value: 'PARTIALLY_COMPLETED', label: t('adminOrders.statusValue.PARTIALLY_COMPLETED') },
              { value: 'FAILED', label: t('adminOrders.statusValue.FAILED') },
              { value: 'REFUNDED', label: t('adminOrders.statusValue.REFUNDED') },
            ]}
          />
        </Space>
        <Space size={8} wrap>
          {status ? <Tag color="processing">{t('adminOrders.summary.statusFilter', { status: formatKnownTranslation(t, `adminOrders.statusValue.${status}`, status) })}</Tag> : null}
          {userId ? <Tag color="purple">{t('adminOrders.summary.userFilter', { userId })}</Tag> : null}
          {search ? <Tag>{t('adminOrders.summary.keywordFilter', { keyword: search })}</Tag> : null}
          <Tag color="blue">{t('adminOrders.summary.total', { total: query.data?.total ?? 0 })}</Tag>
          <Tag color={failedOnPage > 0 ? 'red' : undefined}>
            {t('adminOrders.summary.failedOnPage', { count: failedOnPage })}
          </Tag>
          <Tag color={processingOnPage > 0 ? 'processing' : undefined}>
            {t('adminOrders.summary.fulfillmentOnPage', { count: processingOnPage })}
          </Tag>
        </Space>
      </Space>
    </Card>
  );

  return (
    <div className="ipx-admin-orders-page">
      {!hideTitle && <PageHeader title={t('adminOrders.title')} />}
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
      {selectedOrderId && (
        <FulfillmentDetail
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}

function getResourceTitle(row: OrderDto): string {
  if (row.resourceCode || row.resourceName || row.resourceDisplayName || row.resourceCountryCode) {
    return formatResourceLocationZh({
      code: row.resourceCode,
      countryCode: row.resourceCountryCode ?? row.resourceCode,
      name: row.resourceName,
      displayName: row.resourceDisplayName ?? row.resourceName,
    }).title;
  }
  if (row.resourceId) return shortId(row.resourceId);
  return '-';
}

function formatOrderFailureReason(row: OrderDto, t: (key: string, values?: Record<string, unknown>) => string): string {
  const reasonKey = getOrderReasonKey(row);
  if (!reasonKey) return t('adminOrders.failureUnknown');
  const key = `adminOrders.failureReasons.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('adminOrders.failureUnknown') : translated;
}

function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function hasOrderFailure(row: OrderDto): boolean {
  return Boolean(row.failureStage || row.failureError || row.failReason || row.reasonKey);
}

function getOrderReasonKey(row: OrderDto): string | null {
  if (row.reasonKey?.trim()) return row.reasonKey.trim();
  const raw = row.failReason || row.failureError;
  if (!raw) return null;
  const match = raw.match(/reasonKey[:=]\s*([A-Za-z0-9_.-]+)/);
  return match?.[1] ?? null;
}

function orderStatusColor(status: string): string {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'REFUNDED') return 'error';
  if (status === 'FULFILLING' || status === 'PENDING') return 'processing';
  return 'default';
}

function fulfillmentStatusColor(status: string): string {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'FULFILLING' || status === 'PENDING') return 'processing';
  return 'default';
}

function formatKnownTranslation(t: (key: string) => string, key: string, fallback: string): string {
  const label = t(key);
  return label === key ? fallback : label;
}
