import React, { useState } from 'react';
import { Button, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';

export interface AdminTicketListItem {
  id: string;
  subject: string;
  status: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTicketListFilters {
  page: number;
  pageSize: number;
  status?: string;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'blue',
  PENDING: 'gold',
  CLOSED: 'default',
};

export function buildAdminTicketListPath(filters: AdminTicketListFilters): string {
  return `/api/admin/tickets${buildQuery({
    page: filters.page,
    pageSize: filters.pageSize,
    status: filters.status,
  })}`;
}

export function AdminTicketListFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const listPath = buildAdminTicketListPath({ page, pageSize, status });

  const query = useQuery({
    queryKey: ['admin-tickets', page, pageSize, status],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: AdminTicketListItem[] }>(
        listPath,
      ),
  });

  const columns: ColumnsType<AdminTicketListItem> = [
    {
      title: t('adminTickets.subject'),
      key: 'subject',
      render: (_: unknown, row: AdminTicketListItem) => (
        <Space direction="vertical" size={1}>
          <Typography.Text strong>{row.subject}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('adminTickets.ticketId', { id: row.id })}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminTickets.customer'),
      key: 'customer',
      render: (_: unknown, row: AdminTicketListItem) => (
        <Space direction="vertical" size={1}>
          <Typography.Text>{row.userEmail}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.userId}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminTickets.status'),
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s] ?? 'default'}>{t(`adminTickets.statusValue.${s}`)}</Tag>
      ),
    },
    {
      title: t('adminTickets.updatedAt'),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (v: string) => formatDateTime(v),
    },
    {
      title: t('adminTickets.actions'),
      key: 'actions',
      render: (_: unknown, row: AdminTicketListItem) => (
        <Button
          size="small"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => navigate({ to: `/admin/tickets/${row.id}` } as any)}
        >
          {t('adminTickets.view')}
        </Button>
      ),
    },
  ];

  const toolbar = (
    <Space style={{ marginBottom: 16 }} wrap>
      <Select
        placeholder={t('adminTickets.statusFilter')}
        allowClear
        size="middle"
        style={{ width: 160 }}
        value={status}
        onChange={(v) => { setStatus(v || undefined); setPage(1); }}
        options={[
          { value: 'OPEN', label: t('adminTickets.statusValue.OPEN') },
          { value: 'PENDING', label: t('adminTickets.statusValue.PENDING') },
          { value: 'CLOSED', label: t('adminTickets.statusValue.CLOSED') },
        ]}
      />
    </Space>
  );

  return (
    <>
      <PageHeader title={t('adminTickets.title')} />
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('adminTickets.empty')}
        errorDescription={(error) => error instanceof ApiError ? error.reasonKey : t('error')}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? query.data?.items.length ?? pageSize,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </>
  );
}
