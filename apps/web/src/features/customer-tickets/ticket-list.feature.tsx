import React, { useState } from 'react';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Space, Statistic, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnsType } from 'antd/es/table';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { formatDateTime } from '../../shared/time/time';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';

export interface TicketListItem {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: {
    authorType: string;
    body: string;
    createdAt: string;
  } | null;
  lastReply?: {
    authorType: string;
    body: string;
    createdAt: string;
  } | null;
}

interface CreateTicketFormValues {
  subject?: string;
  body?: string;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'blue',
  PENDING: 'gold',
  CLOSED: 'default',
};

export function buildTicketListPath(page: number, pageSize: number): string {
  return `/api/tickets${buildQuery({ page, pageSize })}`;
}

export function buildCreateTicketBody(input: { subject: string; body: string }) {
  return { subject: input.subject, body: input.body };
}

export function getTicketRecentActivity(ticket: TicketListItem) {
  return ticket.lastMessage ?? ticket.lastReply ?? null;
}

export function ticketStatusColor(status: string): string {
  return STATUS_COLOR[status] ?? 'processing';
}

function formatTicketStatus(t: (key: string, options?: Record<string, unknown>) => string, status: string): string {
  return t(`customer.tickets.statusValue.${status}`, { defaultValue: status });
}

function formatTicketStatusHint(t: (key: string, options?: Record<string, unknown>) => string, status: string): string {
  return t(`customer.tickets.statusHint.${status}`, { defaultValue: t('customer.tickets.statusHint.default') });
}

export function CustomerTicketListFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form] = Form.useForm<CreateTicketFormValues>();

  const query = useQuery({
    queryKey: ['tickets', page, pageSize],
    queryFn: () =>
      userApiRequest<{ page: number; pageSize: number; total: number; items: TicketListItem[] }>(
        buildTicketListPath(page, pageSize),
      ),
  });

  const tickets = query.data?.items ?? [];
  const metricPlaceholder = query.isLoading || query.isError ? '-' : undefined;
  const currentPageCount = tickets.length;
  const openCount = tickets.filter((item) => item.status === 'OPEN').length;
  const pendingCount = tickets.filter((item) => item.status === 'PENDING').length;
  const closedCount = tickets.filter((item) => item.status === 'CLOSED').length;
  const totalCount = metricPlaceholder ?? query.data?.total ?? tickets.length;
  const currentPageMetric = metricPlaceholder ?? currentPageCount;
  const activeMetric = metricPlaceholder ?? openCount + pendingCount;
  const closedMetric = metricPlaceholder ?? closedCount;
  const statusSegments = [
    { status: 'OPEN', count: openCount, displayCount: metricPlaceholder ?? openCount },
    { status: 'PENDING', count: pendingCount, displayCount: metricPlaceholder ?? pendingCount },
    { status: 'CLOSED', count: closedCount, displayCount: metricPlaceholder ?? closedCount },
  ];
  const tableScopeSummary = query.isLoading || query.isError
    ? t('customer.tickets.tableScopeUnavailable')
    : t('customer.tickets.tableScopeSummary', { count: currentPageCount, total: query.data?.total ?? currentPageCount });

  const createMutation = useMutation({
    mutationFn: (values: CreateTicketFormValues) => {
      const subject = (values.subject ?? '').trim();
      const body = (values.body ?? '').trim();
      if (!subject) throw new ApiError('VALIDATION_ERROR', 'subject_required');
      if (!body) throw new ApiError('VALIDATION_ERROR', 'body_required');
      return userApiRequest<TicketListItem>('/api/tickets', {
        method: 'POST',
        body: JSON.stringify(buildCreateTicketBody({ subject, body })),
      });
    },
    onSuccess: (ticket) => {
      setActionError(null);
      setCreateOpen(false);
      form.resetFields();
      message.success(t('customer.tickets.createSuccess'));
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void navigate({ to: `/tickets/${ticket.id}` } as any);
    },
    onError: (error) => {
      setActionError(formatTicketReason(t, error));
    },
  });

  const closeCreateModal = () => {
    setCreateOpen(false);
    setActionError(null);
    form.resetFields();
  };

  const columns: ColumnsType<TicketListItem> = [
    {
      title: t('customer.tickets.subject'),
      dataIndex: 'subject',
      key: 'subject',
      width: 320,
      render: (subject: string, row) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Typography.Text strong>{subject}</Typography.Text>
            <Tag className="ipx-ticket-id-tag">{t('customer.tickets.ticketId', { id: row.id })}</Tag>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('customer.tickets.createdInline', { time: formatDateTime(row.createdAt) })}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.tickets.status'),
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: string) => (
        <Space direction="vertical" size={2}>
            <Tag color={ticketStatusColor(status)}>
              {formatTicketStatus(t, status)}
            </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatTicketStatusHint(t, status)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.tickets.recentReply'),
      key: 'recentReply',
      width: 280,
      render: (_: unknown, row) => {
        const recentActivity = getTicketRecentActivity(row);
        return (
          <Space direction="vertical" size={2}>
            {recentActivity ? (
              <>
                <Space size={6}>
                  <Tag color={recentActivity.authorType === 'USER' ? 'blue' : 'green'}>
                    {recentActivity.authorType === 'USER'
                      ? t('customer.tickets.authorUser')
                      : t('customer.tickets.authorAdmin')}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(recentActivity.createdAt)}
                  </Typography.Text>
                </Space>
                <Typography.Text ellipsis style={{ maxWidth: 240 }}>
                  {recentActivity.body}
                </Typography.Text>
              </>
            ) : (
              <>
                <Typography.Text type="secondary">{t('customer.tickets.noRecentReply')}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('customer.tickets.lastActivityAt', { time: formatDateTime(row.updatedAt) })}
                </Typography.Text>
              </>
            )}
          </Space>
        );
      },
    },
    {
      title: t('customer.tickets.updatedAt'),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: t('customer.tickets.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, row: TicketListItem) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          aria-label={t('customer.tickets.view')}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => navigate({ to: `/tickets/${row.id}` } as any)}
        >
          {t('customer.tickets.view')}
        </Button>
      ),
    },
  ];

  const toolbar = (
    <div className="ipx-ticket-toolbar ipx-customer-toolbar" style={{ alignItems: 'center' }}>
      <Space direction="vertical" size={2}>
        <Typography.Text strong>{t('customer.tickets.tableTitle')}</Typography.Text>
        <Typography.Text type="secondary">{tableScopeSummary}</Typography.Text>
      </Space>
      <div className="ipx-ticket-status-strip">
        <div className="ipx-ticket-status-track" aria-hidden="true">
          {statusSegments.map((item) => (
            <span
              key={item.status}
              className={`ipx-ticket-status-segment is-${item.status.toLowerCase()}`}
              style={{ width: currentPageCount > 0 ? `${(item.count / currentPageCount) * 100}%` : 0 }}
            />
          ))}
        </div>
        <Space size={6} wrap>
          {statusSegments.map((item) => (
            <Tag key={item.status} color={ticketStatusColor(item.status)}>
              {formatTicketStatus(t, item.status)} {item.displayCount}
            </Tag>
          ))}
        </Space>
      </div>
    </div>
  );

  return (
    <div className="ipx-ticket-page ipx-customer-page ipx-customer-tickets-page">
      <PageHeader
        title={t('customer.tickets.title')}
        description={t('customer.tickets.description')}
        extra={(
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={query.isFetching}
              onClick={() => void query.refetch().then((result) => {
                if (result.isError) {
                  message.error(formatTicketReason(t, result.error));
                  return;
                }
                message.success(t('customer.tickets.refreshSuccess'));
              })}
            >
              {t('refresh')}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              aria-label={t('customer.tickets.create')}
              onClick={() => { setActionError(null); setCreateOpen(true); }}
            >
              {t('customer.tickets.create')}
            </Button>
          </Space>
        )}
      />
      {query.isFetching && !query.isLoading && (
        <Alert
          type="info"
          showIcon
          message={t('customer.tickets.refreshing')}
          style={{ marginBottom: 16 }}
        />
      )}
      {query.isError && (
        <Alert
          type="error"
          showIcon
          message={t('customer.tickets.listFailed')}
          description={formatTicketReason(t, query.error)}
          style={{ marginBottom: 16 }}
        />
      )}
      {!createOpen && actionError && (
        <Alert
          type="error"
          message={t('error')}
          description={actionError}
          showIcon
          closable
          onClose={() => setActionError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {createMutation.isPending && (
        <Alert
          type="warning"
          showIcon
          message={t('customer.tickets.createPending')}
          style={{ marginBottom: 16 }}
        />
      )}
      <Row gutter={[14, 14]} className="ipx-ticket-metrics ipx-customer-metric-grid">
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-ticket-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic
              title={t('customer.tickets.metrics.total')}
              value={totalCount}
              prefix={<FileTextOutlined />}
            />
            <Typography.Text type="secondary" className="ipx-ticket-metric-note">
              {t('customer.tickets.metrics.totalDesc')}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-ticket-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.tickets.metrics.currentPage')} value={currentPageMetric} prefix={<ClockCircleOutlined />} />
            <Typography.Text type="secondary" className="ipx-ticket-metric-note">
              {t('customer.tickets.metrics.currentPageDesc', { page })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-ticket-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.tickets.metrics.activeOnPage')} value={activeMetric} prefix={<FileTextOutlined />} />
            <Typography.Text type="secondary" className="ipx-ticket-metric-note">
              {t('customer.tickets.metrics.activeBreakdown', { open: openCount, pending: pendingCount })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-ticket-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.tickets.metrics.closedOnPage')} value={closedMetric} prefix={<CheckCircleOutlined />} />
            <Typography.Text type="secondary" className="ipx-ticket-metric-note">
              {t('customer.tickets.metrics.closedDesc')}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
      <Card
        className="ipx-ticket-table-card ipx-customer-card"
        title={t('customer.tickets.workflowTitle')}
        variant="borderless"
        styles={{ body: { padding: 16 } }}
        style={{ marginBottom: 16 }}
      >
        <Alert
          type="info"
          showIcon
          message={t('customer.tickets.realStatusSummary')}
          description={t('customer.tickets.realStatusSummaryDesc', {
            open: openCount,
            pending: pendingCount,
            closed: closedCount,
          })}
          style={{ marginBottom: 12 }}
        />
        <Row gutter={[12, 12]}>
          {['submit', 'follow', 'resolve'].map((step, index) => (
            <Col xs={24} md={8} key={step}>
              <Space align="start" size={10}>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>{index + 1}</Tag>
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{t(`customer.tickets.flow.${step}.title`)}</Typography.Text>
                  <Typography.Text type="secondary">{t(`customer.tickets.flow.${step}.desc`)}</Typography.Text>
                </Space>
              </Space>
            </Col>
          ))}
        </Row>
      </Card>
      <div className="ipx-ticket-table-card ipx-customer-table-card">
        {query.isLoading && (
          <Alert
            type="info"
            showIcon
            message={t('customer.tickets.loading')}
            style={{ marginBottom: 16 }}
          />
        )}
        <ListPage
          query={query}
          columns={columns}
          toolbar={toolbar}
          rowKey="id"
          errorDescription={(error) => formatTicketReason(t, error)}
          emptyText={
            <Space direction="vertical" size={8}>
              <Typography.Text strong>{t('customer.tickets.emptyTitle')}</Typography.Text>
              <Typography.Text type="secondary">{t('customer.tickets.emptyDescription')}</Typography.Text>
              <Space size={8} wrap>
                <Button size="small" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
                  {t('refresh')}
                </Button>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setActionError(null); setCreateOpen(true); }}>
                  {t('customer.tickets.create')}
                </Button>
              </Space>
            </Space>
          }
          pagination={{
            page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </div>
      <Modal
        title={t('customer.tickets.form.title')}
        open={createOpen}
        onCancel={closeCreateModal}
        okText={t('customer.tickets.form.submit')}
        cancelText={t('customer.tickets.form.cancel')}
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
      >
        {actionError && (
          <Alert
            type="error"
            message={t('error')}
            description={actionError}
            showIcon
            closable
            onClose={() => setActionError(null)}
            style={{ marginBottom: 16 }}
          />
        )}
        {createMutation.isPending && (
          <Alert
            type="info"
            showIcon
            message={t('customer.tickets.form.creating')}
            style={{ marginBottom: 16 }}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {t('customer.tickets.form.notice')}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            name="subject"
            label={t('customer.tickets.form.subject')}
            rules={[{ required: true, message: t('customer.tickets.form.subjectRequired') }]}
          >
            <Input placeholder={t('customer.tickets.form.subjectPlaceholder')} maxLength={200} size="large" />
          </Form.Item>
          <Form.Item
            name="body"
            label={t('customer.tickets.form.body')}
            rules={[{ required: true, message: t('customer.tickets.form.bodyRequired') }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t('customer.tickets.form.bodyPlaceholder')}
              maxLength={4000}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function formatTicketReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  return formatCustomerError(error, t, 'customer.tickets.reason');
}
