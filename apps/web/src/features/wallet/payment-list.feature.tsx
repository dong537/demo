import React, { useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';
import { formatMoneyAmount } from '../../shared/money/money';
import { buildPaymentOrdersPath, type PaymentOrderDto, type PaymentOrderPageDto } from './payment-api';

const confirmSchema = z.object({
  reason: z.string().min(1),
});
type ConfirmForm = z.infer<typeof confirmSchema>;

function ConfirmModal({ payment, onClose }: { payment: PaymentOrderDto; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<ConfirmForm>({
    resolver: zodResolver(confirmSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: ConfirmForm) => {
      const reason = data.reason.trim();
      if (!reason) throw new ApiError('VALIDATION_ERROR', 'reason_required');
      return apiRequest(`/api/payments/${encodeURIComponent(payment.id)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      message.success(t('payments.confirmModal.successMsg'));
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['payments', 'pending-count'] });
      onClose();
    },
    onError: (e) => {
      setServerError(formatPaymentActionError(e, t));
    },
  });

  return (
    <Modal
      open
      title={t('payments.confirmModal.title')}
      onCancel={onClose}
      footer={null}
    >
      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: 16 }}
        items={[
          { key: 'id', label: t('payments.id'), children: payment.id },
          { key: 'userId', label: t('payments.userId'), children: <PaymentUserSummary payment={payment} /> },
          { key: 'amount', label: t('payments.amount'), children: formatMoneyAmount(payment.amount, payment.currency) ?? '-' },
          { key: 'channel', label: t('payments.channel'), children: <PaymentChannelTag channel={payment.channel} t={t} /> },
          { key: 'status', label: t('payments.status'), children: <PaymentStatusTag status={payment.status} t={t} /> },
        ]}
      />
      {serverError && (
        <Alert
          type="error"
          message={t('error')}
          description={serverError}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Form layout="vertical" onFinish={handleSubmit((v) => mutation.mutate(v))}>
        <Form.Item
          label={t('payments.confirmModal.reason')}
          validateStatus={errors.reason ? 'error' : ''}
          help={errors.reason ? t('payments.confirmModal.reasonRequired') : ''}
        >
          <Controller
            name="reason"
            control={control}
            render={({ field }) => (
              <Input.TextArea
                {...field}
                placeholder={t('payments.confirmModal.reasonPlaceholder')}
              />
            )}
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>
              {t('confirm')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function PaymentListFeature() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<string | undefined>('PENDING');
  const [channel, setChannel] = useState<string | undefined>();
  const [confirmPayment, setConfirmPayment] = useState<PaymentOrderDto | null>(null);

  const query = useQuery({
    queryKey: ['payments', page, pageSize, status, channel],
    queryFn: () =>
      apiRequest<PaymentOrderPageDto>(buildPaymentOrdersPath({ page, pageSize, status, channel })),
  });

  const columns: ColumnsType<PaymentOrderDto> = [
    {
      title: t('payments.application'),
      key: 'payment',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong copyable={{ text: row.id }}>{shortId(row.id)}</Typography.Text>
          <Typography.Text type="secondary">{formatDateTime(row.createdAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('payments.userId'),
      key: 'user',
      render: (_, row) => <PaymentUserSummary payment={row} compact />,
    },
    {
      title: t('payments.amount'),
      key: 'amount',
      align: 'right',
      render: (_, row) => (
        <Typography.Text strong style={{ color: '#1677ff' }}>
          {formatMoneyAmount(row.amount, row.currency) ?? '-'}
        </Typography.Text>
      ),
    },
    { title: t('payments.channel'), dataIndex: 'channel', key: 'channel', render: (value: string) => <PaymentChannelTag channel={value} t={t} /> },
    {
      title: t('payments.status'),
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => <PaymentStatusTag status={value} t={t} />,
    },
    {
      title: t('payments.actions'),
      key: 'actions',
      render: (_, row) =>
        row.status === 'PENDING' ? (
          <Button size="small" type="primary" onClick={() => setConfirmPayment(row)}>
            {t('payments.confirmBtn')}
          </Button>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
  ];

  const toolbar = (
    <div
      className="ipx-wallet-toolbar"
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
          placeholder={t('payments.statusFilter')}
          allowClear
          value={status}
          style={{ width: 160 }}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: '', label: t('payments.allStatus') },
            { value: 'PENDING', label: t('payments.statusValue.PENDING') },
            { value: 'CONFIRMING', label: t('payments.statusValue.CONFIRMING') },
            { value: 'COMPLETED', label: t('payments.statusValue.COMPLETED') },
            { value: 'FAILED', label: t('payments.statusValue.FAILED') },
            { value: 'REFUNDED', label: t('payments.statusValue.REFUNDED') },
          ]}
        />
        <Select
          placeholder={t('payments.channelFilter')}
          allowClear
          style={{ width: 160 }}
          onChange={(v) => { setChannel(v); setPage(1); }}
          options={[
            { value: '', label: t('payments.allChannels') },
            { value: 'MANUAL', label: t('payments.channelValue.MANUAL') },
          ]}
        />
      </Space>
    </div>
  );

  return (
    <div className="ipx-wallet-payment-page ipx-wallet-page">
      <Typography.Title level={4}>{t('payments.title')}</Typography.Title>
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('payments.empty')}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      {confirmPayment && <ConfirmModal payment={confirmPayment} onClose={() => setConfirmPayment(null)} />}
    </div>
  );
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function PaymentUserSummary({
  payment,
  compact = false,
}: {
  payment: PaymentOrderDto;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const userMeta = formatUserMeta(payment);
  const primary = payment.user?.email ?? shortId(payment.userId);

  return (
    <Space direction="vertical" size={2}>
      <Space size={6} wrap>
        <Typography.Text strong={!compact}>{primary}</Typography.Text>
        {payment.user?.status && <Tag>{formatKnownValue(t, `users.statusValue.${payment.user.status}`, 'users.statusValue.UNKNOWN')}</Tag>}
      </Space>
      {userMeta && <Typography.Text type="secondary">{userMeta}</Typography.Text>}
      <Typography.Text type="secondary" copyable={{ text: payment.userId }}>
        {shortId(payment.userId)}
      </Typography.Text>
    </Space>
  );
}

function formatUserMeta(payment: PaymentOrderDto): string | null {
  const parts = [payment.user?.name, payment.user?.phone].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

function PaymentStatusTag({ status, t }: { status: string; t: Translate }) {
  return (
    <Tag color={paymentStatusColor(status)}>
      {formatKnownValue(t, `payments.statusValue.${status}`, 'payments.statusValue.UNKNOWN')}
    </Tag>
  );
}

function PaymentChannelTag({ channel, t }: { channel: string; t: Translate }) {
  return <Tag>{formatKnownValue(t, `payments.channelValue.${channel}`, 'payments.channelValue.UNKNOWN')}</Tag>;
}

function paymentStatusColor(status: string): string {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'REFUNDED') return 'error';
  if (status === 'PENDING' || status === 'CONFIRMING') return 'processing';
  return 'default';
}

type Translate = (key: string) => string;

function formatPaymentActionError(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t('error');
  const translated = t(`payments.reason.${error.reasonKey}`);
  if (translated !== `payments.reason.${error.reasonKey}` && translated !== error.reasonKey) return translated;
  return t('payments.reason.generic');
}

function formatKnownValue(t: Translate, key: string, fallbackKey: string): string {
  const translated = t(key);
  return translated === key ? t(fallbackKey) : translated;
}
