import React, { useState } from 'react';
import { ArrowLeftOutlined, CloseCircleOutlined, CustomerServiceOutlined, SendOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Popconfirm,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { userApiRequest, ApiError } from '../../shared/api/client';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { formatDateTime } from '../../shared/time/time';

export interface TicketMessage {
  id: string;
  authorType: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

interface ReplyFormValues {
  body?: string;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'blue',
  PENDING: 'gold',
  CLOSED: 'default',
};

function ticketDetailStatusColor(status: string): string {
  return STATUS_COLOR[status] ?? 'processing';
}

function formatTicketStatus(t: (key: string, options?: Record<string, unknown>) => string, status: string): string {
  return t(`customer.tickets.statusValue.${status}`, { defaultValue: status });
}

function formatTicketStatusHint(t: (key: string, options?: Record<string, unknown>) => string, status: string): string {
  return t(`customer.tickets.statusHint.${status}`, { defaultValue: t('customer.tickets.statusHint.default') });
}

export function buildTicketDetailPath(id: string): string {
  return `/api/tickets/${encodeURIComponent(id)}`;
}

export function buildTicketReplyPath(id: string): string {
  return `/api/tickets/${encodeURIComponent(id)}/messages`;
}

export function buildTicketClosePath(id: string): string {
  return `/api/tickets/${encodeURIComponent(id)}/close`;
}

export function CustomerTicketDetailFeature({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [form] = Form.useForm<ReplyFormValues>();

  const query = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => userApiRequest<TicketDetail>(buildTicketDetailPath(ticketId)),
  });

  const replyMutation = useMutation({
    mutationFn: (values: ReplyFormValues) => {
      const body = (values.body ?? '').trim();
      if (!body) throw new ApiError('VALIDATION_ERROR', 'body_required');
      return userApiRequest<TicketDetail>(buildTicketReplyPath(ticketId), {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },
    onSuccess: () => {
      setActionError(null);
      form.resetFields();
      message.success(t('customer.tickets.replySuccess'));
      void qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (error) => {
      setActionError(formatTicketDetailReason(error, t));
    },
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      userApiRequest<TicketDetail>(buildTicketClosePath(ticketId), { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      message.success(t('customer.tickets.closeSuccess'));
      void qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (error) => {
      setActionError(formatTicketDetailReason(error, t));
    },
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.error) {
    const err = query.error as ApiError;
    const isPermission = err.code === 'PERMISSION_DENIED' || err.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatTicketDetailReason(err, t)}
        showIcon
      />
    );
  }

  const d = query.data!;
  const isClosed = d.status === 'CLOSED';
  const latestMessage = d.messages[d.messages.length - 1] ?? null;
  const supportMessageCount = d.messages.filter((messageItem) => messageItem.authorType !== 'USER').length;

  return (
    <div className="ipx-ticket-detail-page ipx-customer-page ipx-customer-ticket-detail-page">
      <div className="ipx-ticket-detail-head ipx-customer-hero">
        <div className="ipx-ticket-detail-title">
          <Button
            className="ipx-ticket-back-button"
            icon={<ArrowLeftOutlined />}
            aria-label={t('customer.tickets.back')}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => navigate({ to: '/tickets' } as any)}
          >
            {t('customer.tickets.back')}
          </Button>
          <span className="ipx-ticket-icon ipx-ticket-detail-icon"><CustomerServiceOutlined /></span>
          <Space direction="vertical" size={5}>
            <Space size={8} wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {d.subject}
              </Typography.Title>
              <Tag color={ticketDetailStatusColor(d.status)}>
                {formatTicketStatus(t, d.status)}
              </Tag>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {t('customer.tickets.detailUpdatedAt', { time: formatDateTime(d.updatedAt) })}
            </Typography.Text>
          </Space>
        </div>
        <div className="ipx-ticket-detail-actions">
          {!isClosed && (
            <Popconfirm
              title={t('customer.tickets.closeConfirm')}
              okButtonProps={{ danger: true }}
              okText={t('customer.tickets.close')}
              cancelText={t('cancel')}
              onConfirm={() => closeMutation.mutate()}
              disabled={closeMutation.isPending || replyMutation.isPending}
            >
              <Button
                danger
                icon={<CloseCircleOutlined />}
                aria-label={t('customer.tickets.close')}
                loading={closeMutation.isPending}
                disabled={replyMutation.isPending}
              >
                {t('customer.tickets.close')}
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

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
      {query.isFetching && !query.isLoading && (
        <Alert
          type="info"
          message={t('customer.tickets.refreshingDetail')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {(replyMutation.isPending || closeMutation.isPending) && (
        <Alert
          type="warning"
          message={replyMutation.isPending ? t('customer.tickets.replyPending') : t('customer.tickets.closePending')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              title={t('customer.tickets.detailSummary')}
              variant="borderless"
              className="ipx-ticket-summary-card ipx-customer-metric-card"
              styles={{ body: { padding: 20 } }}
            >
              <Descriptions size="small" column={1}>
                <Descriptions.Item label={t('customer.tickets.ticketIdLabel')}>{d.id}</Descriptions.Item>
                <Descriptions.Item label={t('customer.tickets.status')}>
                  <Space size={6} wrap>
                    <Tag color={ticketDetailStatusColor(d.status)}>
                      {formatTicketStatus(t, d.status)}
                    </Tag>
                    <Typography.Text type="secondary">
                      {formatTicketStatusHint(t, d.status)}
                    </Typography.Text>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={t('customer.tickets.createdAt')}>{formatDateTime(d.createdAt)}</Descriptions.Item>
                <Descriptions.Item label={t('customer.tickets.updatedAt')}>{formatDateTime(d.updatedAt)}</Descriptions.Item>
              </Descriptions>
            </Card>
            <Card
              title={t('customer.tickets.communicationState')}
              variant="borderless"
              className="ipx-ticket-summary-card ipx-customer-metric-card"
              styles={{ body: { padding: 20 } }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Statistic title={t('customer.tickets.messageCount')} value={d.messages.length} />
                <Statistic title={t('customer.tickets.supportReplyCount')} value={supportMessageCount} />
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{t('customer.tickets.latestActivity')}</Typography.Text>
                  <Typography.Text type="secondary">
                    {latestMessage ? formatDateTime(latestMessage.createdAt) : t('customer.tickets.noMessages')}
                  </Typography.Text>
                </Space>
              </Space>
            </Card>
          </Space>
        </Col>
        <Col xs={24} lg={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              title={t('customer.tickets.timeline')}
              variant="borderless"
              className="ipx-ticket-timeline-card ipx-customer-table-card"
              styles={{ body: { padding: 24 } }}
            >
              {d.messages.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('customer.tickets.noMessages')}
                />
              ) : (
                <Timeline
                  className="ipx-ticket-timeline"
                  items={d.messages.map((m) => {
                    const isUser = m.authorType === 'USER';
                    const messageClassName = isUser
                      ? 'ipx-ticket-message ipx-ticket-message-user'
                      : 'ipx-ticket-message ipx-ticket-message-admin';
                    return {
                      color: isUser ? 'blue' : 'green',
                      children: (
                        <div className={messageClassName}>
                          <div className="ipx-ticket-message-meta">
                            <Typography.Text strong>
                              {isUser
                                ? t('customer.tickets.authorUser')
                                : t('customer.tickets.authorAdmin')}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                              {formatDateTime(m.createdAt)}
                            </Typography.Text>
                          </div>
                          <Typography.Paragraph className="ipx-ticket-message-body">
                            {m.body}
                          </Typography.Paragraph>
                        </div>
                      ),
                    };
                  })}
                />
              )}
            </Card>

            <Card title={t('customer.tickets.reply')} variant="borderless" className="ipx-ticket-reply-card ipx-customer-card" styles={{ body: { padding: 24 } }}>
              {isClosed ? (
                <Alert type="info" showIcon message={t('customer.tickets.closedHint')} />
              ) : (
                <Form form={form} layout="vertical" onFinish={(values) => replyMutation.mutate(values)}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    {t('customer.tickets.replyHint')}
                  </Typography.Paragraph>
                  <Form.Item
                    name="body"
                    rules={[{ required: true, message: t('customer.tickets.form.bodyRequired') }]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder={t('customer.tickets.form.bodyPlaceholder')}
                      maxLength={4000}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    aria-label={t('customer.tickets.replySubmit')}
                    loading={replyMutation.isPending}
                    disabled={closeMutation.isPending}
                    size="large"
                  >
                    {t('customer.tickets.replySubmit')}
                  </Button>
                </Form>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
}

function formatTicketDetailReason(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return formatCustomerError(error, t, 'customer.tickets.reason');
}
