import React, { useState } from 'react';
import { DatePicker, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';

interface AuditLogDto {
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  requestId: string;
  reasonKey?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export function AuditLogListFeature() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [action, setAction] = useState<string | undefined>();
  const [actorType, setActorType] = useState<string | undefined>();
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();

  const query = useQuery({
    queryKey: ['audit', page, pageSize, action, actorType, from, to],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: AuditLogDto[] }>(
        `/api/audit${buildQuery({ page, pageSize, action, actorType, from, to })}`,
      ),
  });

  const columns: ColumnsType<AuditLogDto> = [
    {
      title: t('audit.action'),
      key: 'action',
      render: (_: unknown, row: AuditLogDto) => (
        <Space direction="vertical" size={2}>
          <Tag color={getAuditReasonKey(row) ? 'red' : 'blue'}>{row.action}</Tag>
          {getAuditReasonKey(row) && <Typography.Text type="danger">reasonKey: {getAuditReasonKey(row)}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: t('audit.actorId'),
      key: 'actor',
      render: (_: unknown, row: AuditLogDto) => (
        <Space direction="vertical" size={2}>
          <Tag>{row.actorType}</Tag>
          <Typography.Text copyable={{ text: row.actorId }}>{shortId(row.actorId)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('audit.targetId'),
      key: 'target',
      render: (_: unknown, row: AuditLogDto) => (
        <Space direction="vertical" size={2}>
          <Tag>{row.targetType}</Tag>
          <Typography.Text copyable={row.targetId ? { text: row.targetId } : false}>
            {row.targetId ? shortId(row.targetId) : '-'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('audit.requestId'),
      dataIndex: 'requestId',
      key: 'requestId',
      render: (v: string) => <Typography.Text code copyable={{ text: v }}>{shortRequestId(v)}</Typography.Text>,
    },
    { title: t('audit.createdAt'), dataIndex: 'createdAt', key: 'createdAt', render: formatDateTime },
  ];

  const toolbar = (
    <Space style={{ marginBottom: 16 }} wrap>
      <Select
        placeholder={t('audit.actionFilter')}
        allowClear
        style={{ width: 200 }}
        onChange={(v) => { setAction(v); setPage(1); }}
        options={[{ value: '', label: t('audit.allActions') }]}
      />
      <Select
        placeholder={t('audit.actorTypeFilter')}
        allowClear
        style={{ width: 160 }}
        onChange={(v) => { setActorType(v); setPage(1); }}
        options={[
          { value: '', label: t('audit.allActorTypes') },
          { value: 'USER', label: 'USER' },
          { value: 'ADMIN_USER', label: 'ADMIN_USER' },
          { value: 'SYSTEM', label: 'SYSTEM' },
          { value: 'APIKEY', label: 'APIKEY' },
        ]}
      />
      <DatePicker.RangePicker
        onChange={(_, s) => {
          setFrom(s[0] || undefined);
          setTo(s[1] || undefined);
          setPage(1);
        }}
      />
    </Space>
  );

  return (
    <>
      <Typography.Title level={4}>{t('audit.title')}</Typography.Title>
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        errorDescription={(error) => error instanceof ApiError ? error.reasonKey : t('error')}
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

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function shortRequestId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-4)}` : value;
}

function getAuditReasonKey(row: AuditLogDto): string | null {
  if (typeof row.reasonKey === 'string' && row.reasonKey.trim()) return row.reasonKey;
  if (!row.meta) return null;
  const reasonKey = row.meta.reasonKey;
  return typeof reasonKey === 'string' && reasonKey.trim() ? reasonKey : null;
}
