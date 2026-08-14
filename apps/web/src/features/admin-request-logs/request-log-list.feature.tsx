import React, { useState } from 'react';
import { Button, DatePicker, Descriptions, Drawer, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';
import { ListPage } from '../../shared/ui/list-page';
import { formatProviderLabel } from '../../shared/provider/provider-labels';

export type UpstreamLogStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT';

export interface UpstreamLogDto {
  id: string;
  siteId: string;
  providerCode: string;
  upstreamAccountId: string | null;
  operation: string;
  requestId: string;
  durationMs: number;
  status: UpstreamLogStatus;
  errorCode: string | null;
  reasonKey?: string | null;
  requestSummary: unknown;
  responseSummary: unknown;
  createdAt: string;
}

export interface UpstreamLogFilters {
  page: number;
  pageSize: number;
  providerCode?: string;
  status?: string;
  from?: string;
  to?: string;
}

const PROVIDERS = ['IPIPD', 'NINE_EIGHT_FIVE', 'PR', 'UPSTREAM_API'];

const STATUS_COLOR: Record<UpstreamLogStatus, string> = {
  SUCCESS: 'green',
  ERROR: 'red',
  TIMEOUT: 'orange',
};

export function buildUpstreamLogListPath(filters: UpstreamLogFilters): string {
  return `/api/upstream-request-logs${buildQuery({
    page: filters.page,
    pageSize: filters.pageSize,
    providerCode: filters.providerCode,
    status: filters.status,
    from: filters.from,
    to: filters.to,
  })}`;
}

const EMPTY_FILTERS: Omit<UpstreamLogFilters, 'page' | 'pageSize'> = {
  providerCode: undefined,
  status: undefined,
  from: undefined,
  to: undefined,
};

export function UpstreamRequestLogListFeature() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState<UpstreamLogDto | null>(null);

  const listPath = buildUpstreamLogListPath({ page, pageSize, ...filters });

  const query = useQuery({
    queryKey: ['upstream-request-logs', page, pageSize, filters],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: UpstreamLogDto[] }>(listPath),
  });

  const patchFilter = (patch: Partial<typeof EMPTY_FILTERS>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const statusLabel = (v: UpstreamLogStatus) =>
    v === 'SUCCESS'
      ? t('requestLogs.statusSuccess')
      : v === 'ERROR'
      ? t('requestLogs.statusError')
      : t('requestLogs.statusTimeout');

  const columns: ColumnsType<UpstreamLogDto> = [
    {
      title: t('requestLogs.request'),
      key: 'request',
      render: (_: unknown, row: UpstreamLogDto) => (
        <Space direction="vertical" size={2}>
          <Space size={4} wrap>
            <Tag color="blue">{formatProviderLabel(row.providerCode)}</Tag>
            <Typography.Text strong>{row.operation}</Typography.Text>
          </Space>
          <Typography.Text code copyable={{ text: row.requestId }} style={{ fontSize: 12 }}>
            {shortRequestId(row.requestId)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('requestLogs.status'),
      dataIndex: 'status',
      key: 'status',
      render: (v: UpstreamLogStatus) => <Tag color={STATUS_COLOR[v]}>{statusLabel(v)}</Tag>,
    },
    {
      title: t('requestLogs.durationMs'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      align: 'right',
      render: (v: number) => <Typography.Text type={v >= 3000 ? 'danger' : undefined}>{v}</Typography.Text>,
    },
    {
      title: t('requestLogs.result'),
      dataIndex: 'errorCode',
      key: 'errorCode',
      render: (_: string | null, row: UpstreamLogDto) => {
        const reasonKey = getLogReasonKey(row);
        if (!row.errorCode && !reasonKey) return '-';
        return (
          <Space size={4} wrap>
            {reasonKey && <Tag color="red">{formatRequestLogReason(reasonKey, t)}</Tag>}
            {row.errorCode && <Tag color="red">{t('requestLogs.errorCodeRecorded')}</Tag>}
          </Space>
        );
      },
    },
    {
      title: t('requestLogs.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, row: UpstreamLogDto) => (
        <Button size="small" onClick={() => setDetail(row)}>
          {t('requestLogs.view')}
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
        <Select
          placeholder={t('requestLogs.providerFilter')}
          allowClear
          size="middle"
          style={{ width: 180 }}
          onChange={(v) => patchFilter({ providerCode: v || undefined })}
          options={PROVIDERS.map((p) => ({ value: p, label: formatProviderLabel(p) }))}
        />
        <Select
          placeholder={t('requestLogs.statusFilter')}
          allowClear
          size="middle"
          style={{ width: 140 }}
          onChange={(v) => patchFilter({ status: v || undefined })}
          options={[
            { value: 'SUCCESS', label: t('requestLogs.statusSuccess') },
            { value: 'ERROR', label: t('requestLogs.statusError') },
            { value: 'TIMEOUT', label: t('requestLogs.statusTimeout') },
          ]}
        />
        <DatePicker.RangePicker
          showTime
          placeholder={[t('requestLogs.from'), t('requestLogs.to')]}
          onChange={(_, s) => patchFilter({ from: s[0] || undefined, to: s[1] || undefined })}
        />
      </Space>
    </div>
  );

  return (
    <>
      <Typography.Title level={4}>{t('requestLogs.title')}</Typography.Title>
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('requestLogs.empty')}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? query.data?.items.length ?? pageSize,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      <Drawer
        title={t('requestLogs.detailTitle')}
        width={620}
        open={detail !== null}
        onClose={() => setDetail(null)}
        styles={{
          body: { background: 'var(--ipx-bg)', padding: 0 },
          header: { borderBottom: '1px solid var(--ipx-border)' },
        }}
      >
        {detail && (
          <Space direction="vertical" size={12} style={{ width: '100%', padding: 16 }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('requestLogs.providerCode')}>{formatProviderLabel(detail.providerCode)}</Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.operation')}>{detail.operation}</Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.status')}>
                <Tag color={STATUS_COLOR[detail.status]}>{statusLabel(detail.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.durationMs')}>{detail.durationMs}</Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.errorCode')}>
                {detail.errorCode || getLogReasonKey(detail) ? (
                  <Space size={4} wrap>
                    {getLogReasonKey(detail) && <Tag color="red">{formatRequestLogReason(getLogReasonKey(detail)!, t)}</Tag>}
                    {detail.errorCode && <Tag color="red">{t('requestLogs.errorCodeRecorded')}</Tag>}
                  </Space>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.requestId')}>
                <Typography.Text code copyable={{ text: detail.requestId }}>{detail.requestId}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.upstreamAccountId')}>{detail.upstreamAccountId ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={t('requestLogs.createdAt')}>{formatDateTime(detail.createdAt)}</Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t('requestLogs.redactedHint')}
            </Typography.Paragraph>
            <Typography.Title level={5}>{t('requestLogs.requestSummary')}</Typography.Title>
            <SummaryBlock value={detail.requestSummary} emptyText={t('requestLogs.emptySummary')} t={t} />
            <Typography.Title level={5} style={{ marginTop: 8 }}>{t('requestLogs.responseSummary')}</Typography.Title>
            <SummaryBlock value={detail.responseSummary} emptyText={t('requestLogs.emptySummary')} t={t} />
          </Space>
        )}
      </Drawer>
    </>
  );
}

function shortRequestId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-4)}` : value;
}

function getLogReasonKey(log: UpstreamLogDto): string | null {
  if (typeof log.reasonKey === 'string' && log.reasonKey.trim()) return log.reasonKey;
  const requestReason = readReasonKey(log.requestSummary);
  if (requestReason) return requestReason;
  return readReasonKey(log.responseSummary);
}

function readReasonKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.reasonKey === 'string' && record.reasonKey.trim()) return record.reasonKey;
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    if (typeof error.reasonKey === 'string' && error.reasonKey.trim()) return error.reasonKey;
  }
  return null;
}

type Translate = (key: string) => string;

function SummaryBlock({ value, emptyText, t }: { value: unknown; emptyText: string; t: Translate }) {
  if (value === null || value === undefined) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }
  const displayValue = normalizeSummaryForDisplay(value, t);
  return (
    <pre
      style={{
        background: '#f5f5f5',
        padding: 12,
        borderRadius: 4,
        maxHeight: 240,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        margin: 0,
      }}
    >
      {JSON.stringify(displayValue, null, 2)}
    </pre>
  );
}

function formatRequestLogReason(reasonKey: string, t: Translate): string {
  const translated = t(`requestLogs.reason.${reasonKey}`);
  if (translated !== `requestLogs.reason.${reasonKey}` && translated !== reasonKey) return translated;
  return t('requestLogs.reason.generic');
}

function normalizeSummaryForDisplay(value: unknown, t: Translate): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeSummaryForDisplay(item, t));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'reasonKey' && typeof item === 'string') {
      result[t('requestLogs.summaryReason')] = formatRequestLogReason(item, t);
      continue;
    }
    result[formatSummaryKey(key, t)] = normalizeSummaryForDisplay(item, t);
  }
  return result;
}

function formatSummaryKey(key: string, t: Translate): string {
  const translated = t(`requestLogs.summaryKey.${key}`);
  return translated === `requestLogs.summaryKey.${key}` ? key : translated;
}
