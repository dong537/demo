import React from 'react';
import { Alert, Drawer, Space, Spin, Table, Tag, Timeline, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest } from '../../shared/api/client';
import type { ApiError } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';

interface ProxyInstance {
  id: string;
  ip: string;
  port: number;
  status: string;
  expiresAt: string;
}

interface FulfillmentDto {
  taskStatus?: string | null;
  upstreamImage?: string | null;
  proxies?: ProxyInstance[] | null;
  operationLogs?: OperationLog[];
}

interface NormalizedFulfillmentDetail {
  taskStatus: string;
  upstreamImage: string;
  proxies: ProxyInstance[];
  operationLogs: OperationLog[];
}

interface OperationLog {
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  reason: string | null;
  reasonKey?: string | null;
  code?: string | null;
  httpStatus?: number | null;
  requestId: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface Props {
  orderId: string;
  onClose: () => void;
}

export function FulfillmentDetail({ orderId, onClose }: Props) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['order-fulfillment', orderId],
    queryFn: async () => normalizeFulfillmentDetail(await apiRequest<FulfillmentDto>(`/api/orders/${encodeURIComponent(orderId)}/fulfillment`)),
  });

  const columns: ColumnsType<ProxyInstance> = [
    { title: t('adminOrders.fulfillment.ip'), dataIndex: 'ip', key: 'ip' },
    { title: t('adminOrders.fulfillment.port'), dataIndex: 'port', key: 'port' },
    { title: t('adminOrders.fulfillment.status'), dataIndex: 'status', key: 'status' },
    {
      title: t('adminOrders.fulfillment.expiresAt'),
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (v: string) => formatDateTime(v),
    },
  ];

  return (
    <Drawer
      title={t('adminOrders.fulfillment.title')}
      open
      onClose={onClose}
      width={680}
      styles={{
        body: { background: 'var(--ipx-bg)', padding: 0 },
        header: { borderBottom: '1px solid var(--ipx-border)' },
      }}
    >
      {query.isLoading && (
        <div style={{ padding: 24 }}>
          <Spin />
        </div>
      )}
      {query.error && (
        <div style={{ padding: 24 }}>
          <Alert
            type="error"
            message={t('error')}
            description={formatFulfillmentError(query.error, t)}
            showIcon
          />
        </div>
      )}
      {query.data && (
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
              {t('adminOrders.orderId')}
            </Typography.Text>
            <Typography.Title level={4} style={{ margin: 0, wordBreak: 'break-all' }}>
              {orderId}
            </Typography.Title>
            <div style={{ marginTop: 12 }}>
              <Tag color={query.data.taskStatus === 'COMPLETED' ? 'green' : query.data.taskStatus === 'FAILED' ? 'red' : 'blue'}>
                {query.data.taskStatus || '-'}
              </Tag>
            </div>
          </div>

          <div
            style={{
              background: 'var(--ipx-surface)',
              border: '1px solid var(--ipx-border)',
              borderRadius: 'var(--ipx-radius-lg)',
              padding: 20,
            }}
          >
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
              {t('adminOrders.fulfillment.summary')}
            </Typography.Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <DetailItem label={t('adminOrders.fulfillment.taskStatus')} value={query.data.taskStatus || '-'} />
              <DetailItem label={t('adminOrders.fulfillment.upstreamImage')} value={query.data.upstreamImage || '-'} />
            </div>
          </div>

          <div
            style={{
              background: 'var(--ipx-surface)',
              border: '1px solid var(--ipx-border)',
              borderRadius: 'var(--ipx-radius-lg)',
              padding: 20,
            }}
          >
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
              {t('adminOrders.fulfillment.proxyInstances')}
            </Typography.Title>
            <Table
              dataSource={query.data.proxies}
              columns={columns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </div>

          <div
            style={{
              background: 'var(--ipx-surface)',
              border: '1px solid var(--ipx-border)',
              borderRadius: 'var(--ipx-radius-lg)',
              padding: 20,
            }}
          >
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
              {t('adminOrders.fulfillment.operationLogs')}
            </Typography.Title>
            {query.data.operationLogs.length === 0 ? (
              <Typography.Text type="secondary">{t('adminOrders.fulfillment.noOperationLogs')}</Typography.Text>
            ) : (
              <Timeline
                items={query.data.operationLogs.map((log) => ({
                  key: log.id,
                  children: (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={log.actorType === 'ADMIN_USER' ? 'blue' : 'default'}>{log.action}</Tag>
                        <Typography.Text strong>{log.actorType}</Typography.Text>
                        <Typography.Text copyable type="secondary">{log.actorId}</Typography.Text>
                      </Space>
                      {log.reason && (
                        <Typography.Text>{log.reason}</Typography.Text>
                      )}
                      <LogDiagnostics log={log} t={t} />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(log.createdAt)} · {log.requestId}
                      </Typography.Text>
                    </Space>
                  ),
                }))}
              />
            )}
          </div>
        </Space>
      )}
    </Drawer>
  );
}

function normalizeFulfillmentDetail(data: FulfillmentDto): NormalizedFulfillmentDetail {
  return {
    taskStatus: data.taskStatus ?? '-',
    upstreamImage: data.upstreamImage ?? '-',
    proxies: Array.isArray(data.proxies) ? data.proxies : [],
    operationLogs: Array.isArray(data.operationLogs) ? data.operationLogs : [],
  };
}

function LogDiagnostics({ log, t }: { log: OperationLog; t: Translate }) {
  const reasonKey = typeof log.reasonKey === 'string'
    ? log.reasonKey
    : typeof log.meta?.reasonKey === 'string'
      ? log.meta.reasonKey
      : null;
  const code = typeof log.code === 'string'
    ? log.code
    : typeof log.meta?.code === 'string'
      ? log.meta.code
      : null;
  const httpStatus = typeof log.httpStatus === 'number'
    ? log.httpStatus
    : typeof log.meta?.httpStatus === 'number'
      ? log.meta.httpStatus
      : null;
  const metaText = log.meta ? JSON.stringify(log.meta) : null;

  if (!reasonKey && !code && !httpStatus && !metaText) return null;

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space size={4} wrap>
        {reasonKey && <Tag color="red">{formatFulfillmentReason(reasonKey, t)}</Tag>}
        {code && <Tag>{t('adminOrders.fulfillment.errorCodeRecorded')}</Tag>}
        {httpStatus && <Tag>{t('adminOrders.fulfillment.httpStatusRecorded')}</Tag>}
      </Space>
      {metaText && (
        <Typography.Text
          type="secondary"
          copyable={{ text: metaText }}
          style={{ fontSize: 12, maxWidth: '100%' }}
        >
          {t('adminOrders.fulfillment.technicalDetailRecorded')}
        </Typography.Text>
      )}
    </Space>
  );
}

type Translate = (key: string) => string;

function formatFulfillmentError(error: unknown, t: Translate): string {
  const reasonKey = (error as ApiError | undefined)?.reasonKey;
  return reasonKey ? formatFulfillmentReason(reasonKey, t) : t('error');
}

function formatFulfillmentReason(reasonKey: string, t: Translate): string {
  const translated = t(`adminOrders.failureReasons.${reasonKey}`);
  if (translated !== `adminOrders.failureReasons.${reasonKey}` && translated !== reasonKey) return translated;
  return t('adminOrders.failureUnknown');
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
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
