import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { apiRequest, ApiError } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';

function surfaceCardStyle(): React.CSSProperties {
  return {
    borderRadius: 8,
    border: '1px solid var(--ipx-border, #ebebeb)',
    boxShadow: 'none',
  };
}

export interface AdminTicketMessage {
  id: string;
  authorType: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface AdminTicketDetail {
  id: string;
  subject: string;
  status: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  updatedAt: string;
  messages: AdminTicketMessage[];
}

interface ReplyFormValues {
  body?: string;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'blue',
  PENDING: 'gold',
  CLOSED: 'default',
};

export function buildAdminTicketDetailPath(id: string): string {
  return `/api/admin/tickets/${encodeURIComponent(id)}`;
}

export function buildAdminTicketReplyPath(id: string): string {
  return `/api/admin/tickets/${encodeURIComponent(id)}/messages`;
}

export function buildAdminTicketStatusPath(id: string): string {
  return `/api/admin/tickets/${encodeURIComponent(id)}/status`;
}

export function AdminTicketDetailFeature({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [form] = Form.useForm<ReplyFormValues>();

  const query = useQuery({
    queryKey: ['admin-ticket', ticketId],
    queryFn: () => apiRequest<AdminTicketDetail>(buildAdminTicketDetailPath(ticketId)),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-ticket', ticketId] });
    void qc.invalidateQueries({ queryKey: ['admin-tickets'] });
  };

  const replyMutation = useMutation({
    mutationFn: (values: ReplyFormValues) => {
      const body = (values.body ?? '').trim();
      if (!body) throw new ApiError('VALIDATION_ERROR', 'body_required');
      return apiRequest<AdminTicketDetail>(buildAdminTicketReplyPath(ticketId), {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },
    onSuccess: () => {
      setActionError(null);
      form.resetFields();
      message.success(t('adminTickets.replySuccess'));
      invalidate();
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.reasonKey : t('error'));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest<AdminTicketDetail>(buildAdminTicketStatusPath(ticketId), {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setActionError(null);
      message.success(t('adminTickets.statusChangeSuccess'));
      invalidate();
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.reasonKey : t('error'));
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
        description={err.reasonKey}
        showIcon
      />
    );
  }

  const d = query.data!;
  const statusPending = statusMutation.isPending;
  const canMarkOpen = d.status !== 'OPEN';
  const canMarkPending = d.status !== 'PENDING';
  const canClose = d.status !== 'CLOSED';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <Space align="start" size={12} wrap>
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => navigate({ to: '/admin/tickets' } as any)}
          >
            {t('adminTickets.back')}
          </Button>
          <Space direction="vertical" size={4}>
            <Typography.Title level={4} style={{ margin: 0, color: 'var(--ipx-fg, #101010)' }}>
              {d.subject}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {d.userEmail} / {formatDateTime(d.updatedAt)}
            </Typography.Text>
          </Space>
          <Tag color={STATUS_COLOR[d.status] ?? 'default'} style={{ marginTop: 4 }}>
            {t(`adminTickets.statusValue.${d.status}`)}
          </Tag>
        </Space>
      </div>

      <Descriptions
        column={{ xs: 1, md: 2 }}
        size="small"
        style={{
          marginBottom: 16,
          padding: 12,
          border: '1px solid var(--ipx-border, #ebebeb)',
          borderRadius: 8,
          background: 'var(--ipx-bg, #f7f7f7)',
        }}
      >
        <Descriptions.Item label={t('adminTickets.customer')}>{d.userEmail}</Descriptions.Item>
        <Descriptions.Item label={t('adminTickets.status')}>
          <Tag color={STATUS_COLOR[d.status] ?? 'default'}>
            {t(`adminTickets.statusValue.${d.status}`)}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('adminTickets.createdAt')}>
          {formatDateTime(d.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label={t('adminTickets.updatedAt')}>
          {formatDateTime(d.updatedAt)}
        </Descriptions.Item>
      </Descriptions>

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

      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          disabled={!canMarkOpen || statusPending}
          loading={statusPending && statusMutation.variables === 'OPEN'}
          onClick={() => statusMutation.mutate('OPEN')}
        >
          {t('adminTickets.markOpen')}
        </Button>
        <Button
          disabled={!canMarkPending || statusPending}
          loading={statusPending && statusMutation.variables === 'PENDING'}
          onClick={() => statusMutation.mutate('PENDING')}
        >
          {t('adminTickets.markPending')}
        </Button>
        <Button
          danger
          disabled={!canClose || statusPending}
          loading={statusPending && statusMutation.variables === 'CLOSED'}
          onClick={() => setCloseConfirmOpen(true)}
        >
          {t('adminTickets.markClosed')}
        </Button>
        <Popconfirm
          title={t('adminTickets.closeConfirm')}
          okButtonProps={{ danger: true }}
          okText={t('adminTickets.markClosed')}
          open={closeConfirmOpen}
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={() => {
            statusMutation.mutate('CLOSED', { onSuccess: () => setCloseConfirmOpen(false) });
          }}
        >
          <span />
        </Popconfirm>
      </Space>

      <Card
        title={t('adminTickets.timeline')}
        variant="borderless"
        style={{ ...surfaceCardStyle(), marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}
      >
        {d.messages.length === 0 ? (
          <Typography.Text type="secondary">{t('adminTickets.noMessages')}</Typography.Text>
        ) : (
          <Timeline
            items={d.messages.map((m) => ({
              color: m.authorType === 'ADMIN_USER' ? 'green' : 'blue',
              children: (
                <Space direction="vertical" size={2}>
                  <Space size={8}>
                    <Typography.Text strong>
                      {m.authorType === 'ADMIN_USER'
                        ? t('adminTickets.authorAdmin')
                        : t('adminTickets.authorUser')}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {formatDateTime(m.createdAt)}
                    </Typography.Text>
                  </Space>
                  <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {m.body}
                  </Typography.Paragraph>
                </Space>
              ),
            }))}
          />
        )}
      </Card>

      <Card title={t('adminTickets.reply')} variant="borderless" style={surfaceCardStyle()} styles={{ body: { padding: 16 } }}>
        <Form form={form} layout="vertical" onFinish={(values) => replyMutation.mutate(values)}>
          <Form.Item
            name="body"
            rules={[{ required: true, message: t('adminTickets.bodyRequired') }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t('adminTickets.replyPlaceholder')}
              maxLength={4000}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={replyMutation.isPending}>
            {t('adminTickets.replySubmit')}
          </Button>
          {d.status === 'CLOSED' && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {t('adminTickets.replyReopenHint')}
            </Typography.Paragraph>
          )}
        </Form>
      </Card>
    </>
  );
}
