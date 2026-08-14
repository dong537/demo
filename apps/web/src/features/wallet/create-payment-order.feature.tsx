import React, { useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Form, InputNumber, Row, Select, Space, Typography, Skeleton, Result } from 'antd';
import { CheckCircleOutlined, PlusOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { userApiRequest, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { formatMoneyAmount } from '../../shared/money/money';

import { surfaceCardStyle as sharedSurfaceCardStyle } from '../../shared/ui/surface';

function localSurfaceCardStyle(sticky = false): React.CSSProperties {
  return sharedSurfaceCardStyle({
    borderRadius: 8,
    boxShadow: 'none',
    ...(sticky ? { position: 'sticky', top: 80 } : {}),
  });
}

const schema = z.object({
  amount: z.number({ invalid_type_error: 'amountRequired' }).positive('amountInvalid'),
  channel: z.enum(['MANUAL', 'YIPAY', 'ALIPAY']),
});
type FormValues = z.infer<typeof schema>;
const PRESET_AMOUNTS = [100, 300, 500, 1000];

interface PaymentOrderCreated {
  id: string;
  amount: string;
  currency: string;
  status: string;
}

interface WalletDto {
  currency: string;
}

export function CreatePaymentOrderFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<PaymentOrderCreated | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';
  const walletQuery = useQuery({
    queryKey: ['customer-wallet', userId],
    queryFn: () => userApiRequest<WalletDto>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const { control, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { channel: 'MANUAL' },
  });

  const amount = watch('amount');
  const channel = watch('channel');
  const currency = walletQuery.data?.currency ?? '';

  const createPaymentMutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (!currency) throw new ApiError('VALIDATION_ERROR', 'currency_required');
      return userApiRequest<PaymentOrderCreated>('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: values.amount.toFixed(2),
          currency,
          channel: values.channel,
          idempotencyKey: globalThis.crypto.randomUUID(),
        }),
      });
    },
    onMutate: () => {
      setServerError(null);
    },
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet', userId] });
      void queryClient.invalidateQueries({ queryKey: ['customer-ledger', userId] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payments', 'pending-count'] });
    },
    onError: (error) => {
      setServerError(formatCustomerPaymentReason(error, t));
    },
  });
  const isCreating = createPaymentMutation.isPending || isSubmitting;

  if (currentQuery.isLoading || walletQuery.isLoading) return <Skeleton active />;
  const viewError = currentQuery.error ?? walletQuery.error;
  if (viewError) {
    const apiErr = viewError as ApiError;
    const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatCustomerPaymentReason(viewError, t)}
        showIcon
      />
    );
  }

  if (result) {
    return (
      <Card
        className="ipx-topup-result-card ipx-wallet-page ipx-customer-page ipx-customer-topup-page ipx-customer-card"
        title={t('customer.topup.successTitle')}
        variant="borderless"
        style={localSurfaceCardStyle()}
        styles={{ body: { padding: 24 } }}
      >
        <div className="ipx-topup-result-shell">
          <span className="ipx-topup-result-icon"><CheckCircleOutlined /></span>
          <Result
            icon={null}
            title={t('customer.topup.successTitle')}
            style={{ padding: 0 }}
          />
        </div>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('customer.topup.orderNo')}>{result.id}</Descriptions.Item>
          <Descriptions.Item label={t('customer.topup.amount')}>{formatMoneyAmount(result.amount, result.currency) ?? '-'}</Descriptions.Item>
          <Descriptions.Item label={t('customer.topup.status')}>{formatPaymentStatus(result.status)}</Descriptions.Item>
        </Descriptions>
        <Space className="ipx-topup-result-actions" wrap>
          <Button type="primary" icon={<WalletOutlined />} onClick={() => navigate({ to: '/wallet' })}>
            {t('customer.topup.viewWallet')}
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setResult(null)}>
            {t('customer.topup.createAnother')}
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Row className="ipx-topup-page ipx-wallet-page ipx-customer-page ipx-customer-topup-page" gutter={[16, 16]} align="top">
      <Col xs={24} lg={14}>
        <Card
          className="ipx-topup-form-card ipx-customer-card"
          title={t('customer.topup.title')}
          variant="borderless"
          style={localSurfaceCardStyle()}
          styles={{ body: { padding: 24 } }}
        >
          {serverError && (
            <Alert
              type="error"
              message={t('error')}
              description={serverError}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form layout="vertical" onFinish={handleSubmit((values) => createPaymentMutation.mutate(values))}>
            <div className="ipx-topup-section-head">
              <span className="ipx-topup-section-index">1</span>
              <div>
                <Typography.Text strong>{t('customer.topup.amount')}</Typography.Text>
                <Typography.Text type="secondary">{t('customer.topup.amountPlaceholder')}</Typography.Text>
              </div>
            </div>
            <div className="ipx-topup-amount-grid">
              {PRESET_AMOUNTS.map((preset) => {
                const selected = Number(amount) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    className={selected ? 'ipx-topup-amount-card is-selected' : 'ipx-topup-amount-card'}
                    aria-pressed={selected}
                    disabled={isCreating}
                    onClick={() => setValue('amount', preset, { shouldDirty: true, shouldValidate: true })}
                  >
                    <span>{t('customer.topup.quickAmount')}</span>
                    <strong>{preset}</strong>
                  </button>
                );
              })}
            </div>
            <Form.Item
              label={t('customer.topup.customAmount')}
              validateStatus={errors.amount ? 'error' : ''}
              help={errors.amount ? t(`customer.topup.${errors.amount.message ?? 'amountInvalid'}`) : ''}
            >
              <Controller
                name="amount"
                control={control}
                render={({ field }) => (
                  <InputNumber
                    {...field}
                    precision={2}
                    size="large"
                    placeholder={t('customer.topup.amountPlaceholder')}
                    style={{ width: '100%' }}
                    disabled={isCreating}
                  />
                )}
              />
            </Form.Item>
            <div className="ipx-topup-section-head">
              <span className="ipx-topup-section-index">2</span>
              <div>
                <Typography.Text strong>{t('customer.topup.channel')}</Typography.Text>
                <Typography.Text type="secondary">{t('customer.topup.manualArrival')}</Typography.Text>
              </div>
            </div>
            <Form.Item label={t('customer.topup.channel')}>
              <Controller
                name="channel"
                control={control}
                render={({ field }) => (
                  <Select
                    {...field}
                    size="large"
                    disabled={isCreating}
                    options={[
                      { value: 'MANUAL', label: t('customer.topup.channelManual') },
                      { value: 'YIPAY', label: t('customer.topup.channelYipay'), disabled: true },
                      { value: 'ALIPAY', label: t('customer.topup.channelAlipay'), disabled: true },
                    ]}
                  />
                )}
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space className="ipx-topup-submit-row">
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={isCreating}
                  disabled={isCreating || !currency}
                  size="large"
                  aria-label={t('submit')}
                  icon={<PlusOutlined />}
                >
                  {t('submit')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card
          className="ipx-topup-summary-card ipx-customer-metric-card"
          variant="borderless"
          style={localSurfaceCardStyle(true)}
          styles={{ body: { padding: 24 } }}
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space align="center" size={12}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t('customer.topup.confirmSummary', { amount: amount || 0, currency })}
                </Typography.Text>
                <Typography.Title level={3} style={{ margin: '4px 0 0', color: 'var(--ipx-primary, #003afe)' }}>
                  {amount > 0 ? formatMoneyAmount(amount, currency) : `-- ${currency}`}
                </Typography.Title>
              </div>
            </Space>
            <div className="ipx-topup-summary-box">
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {t('customer.topup.summaryTitle')}
              </Typography.Text>
              <SummaryRow label={t('customer.topup.channel')} value={formatTopupChannel(channel ?? 'MANUAL', t)} />
              <SummaryRow label={t('customer.overview.currency')} value={currency || '-'} />
              <SummaryRow label={t('customer.topup.estimatedArrival')} value={t('customer.topup.manualArrival')} />
            </div>
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

function formatCustomerPaymentReason(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('error');
  const key = `customer.topup.reason.${error.reasonKey}`;
  const translated = t(key);
  return translated === key ? t('customer.topup.reason.generic') : translated;
}

function formatPaymentStatus(status: string): string {
  if (status === 'PENDING') return '待确认';
  if (status === 'PAID' || status === 'CONFIRMED' || status === 'SUCCESS') return '已完成';
  if (status === 'FAILED') return '未成功';
  if (status === 'CANCELED' || status === 'CANCELLED') return '已取消';
  return '处理中';
}

function SummaryRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="ipx-topup-summary-row">
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>{label}</Typography.Text>
      <Typography.Text strong style={{ textAlign: 'right' }}>{value}</Typography.Text>
    </div>
  );
}

function formatTopupChannel(channel: string, t: (key: string) => string): string {
  if (channel === 'MANUAL') return t('customer.topup.channelManual');
  if (channel === 'YIPAY') return t('customer.topup.channelYipay');
  if (channel === 'ALIPAY') return t('customer.topup.channelAlipay');
  return channel;
}
