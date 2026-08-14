import React from 'react';
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Result, Select, Skeleton, Space, Statistic, Typography } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../shared/api/client';
import { formatMoneyAmount } from '../../shared/money/money';
import {
  createDedicatedLineOrder,
  listDedicatedLineSkus,
  quoteDedicatedLine,
} from './dedicated-line-api';
import './dedicated-line.css';

const DEFAULT_CURRENCY = 'CNY';

export function DedicatedLinePurchaseFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [skuCode, setSkuCode] = React.useState('');
  const [countryCode, setCountryCode] = React.useState('HK');
  const [quantity, setQuantity] = React.useState(1);
  const [durationDays, setDurationDays] = React.useState(30);
  const [completed, setCompleted] = React.useState(false);
  const skuQuery = useQuery({
    queryKey: ['dedicated-line-skus'],
    queryFn: listDedicatedLineSkus,
  });

  React.useEffect(() => {
    if (!skuCode && skuQuery.data?.[0]) setSkuCode(skuQuery.data[0].code);
  }, [skuCode, skuQuery.data]);

  const quoteQuery = useQuery({
    queryKey: ['dedicated-line-quote', skuCode, countryCode, quantity, durationDays],
    queryFn: () => quoteDedicatedLine({ skuCode, durationDays, quantity, currency: DEFAULT_CURRENCY }),
    enabled: Boolean(skuCode && /^[A-Z]{2}$/.test(countryCode) && quantity > 0 && durationDays > 0),
  });
  const orderMutation = useMutation({
    mutationFn: () => createDedicatedLineOrder({
      skuCode,
      countryCode,
      quantity,
      durationDays,
      currency: DEFAULT_CURRENCY,
    }),
    onSuccess: () => {
      setCompleted(true);
      void queryClient.invalidateQueries({ queryKey: ['dedicated-lines'] });
    },
  });

  if (skuQuery.isLoading) return <Skeleton active />;
  if (skuQuery.isError) return <Alert type="error" showIcon message={t('error')} description={reasonText(skuQuery.error, t)} />;
  const skus = (skuQuery.data ?? []).filter((sku) => sku.isActive && sku.isVisible && sku.capabilities.delivery === 'dedicated-line');
  if (skus.length === 0) return <Empty description={t('customer.dedicatedLines.purchase.emptySku')} />;

  if (completed) {
    return (
      <Result
        className="dedicated-line-result"
        status="success"
        icon={<CheckCircleOutlined />}
        title={t('customer.dedicatedLines.purchase.queued')}
        subTitle={t('customer.dedicatedLines.purchase.queuedDetail')}
        extra={<Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate({ to: '/dedicated-lines' } as never)}>{t('customer.dedicatedLines.purchase.viewLines')}</Button>}
      />
    );
  }

  const quote = quoteQuery.data;
  const orderError = orderMutation.error ?? quoteQuery.error;
  return (
    <div className="dedicated-line-workspace">
      <div className="dedicated-line-workspace-header">
        <div>
          <Typography.Text className="dedicated-line-eyebrow">{t('customer.dedicatedLines.purchase.eyebrow')}</Typography.Text>
          <Typography.Title level={2}>{t('customer.dedicatedLines.purchase.title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('customer.dedicatedLines.purchase.description')}</Typography.Paragraph>
        </div>
        <ShoppingCartOutlined className="dedicated-line-header-icon" aria-hidden />
      </div>
      <div className="dedicated-line-purchase-grid">
        <Card className="dedicated-line-form-card" title={t('customer.dedicatedLines.purchase.formTitle')}>
          {orderError && <Alert type="error" showIcon message={t('error')} description={reasonText(orderError, t)} style={{ marginBottom: 16 }} />}
          <Form layout="vertical" onFinish={() => orderMutation.mutate()}>
            <Form.Item label={t('customer.dedicatedLines.purchase.sku')} required>
              <Select
                aria-label={t('customer.dedicatedLines.purchase.sku')}
                value={skuCode || undefined}
                onChange={setSkuCode}
                options={skus.map((sku) => ({ value: sku.code, label: `${sku.code} · ${sku.name}` }))}
              />
            </Form.Item>
            <Form.Item label={t('customer.dedicatedLines.purchase.country')} required help={t('customer.dedicatedLines.purchase.countryHelp')}>
              <Input
                aria-label={t('customer.dedicatedLines.purchase.country')}
                value={countryCode}
                maxLength={2}
                onChange={(event) => setCountryCode(event.target.value.trim().toUpperCase())}
                status={countryCode && !/^[A-Z]{2}$/.test(countryCode) ? 'error' : undefined}
              />
            </Form.Item>
            <div className="dedicated-line-form-row">
              <Form.Item label={t('customer.dedicatedLines.purchase.quantity')} required>
                <InputNumber aria-label={t('customer.dedicatedLines.purchase.quantity')} min={1} max={100} value={quantity} onChange={(value) => setQuantity(value ?? 1)} />
              </Form.Item>
              <Form.Item label={t('customer.dedicatedLines.purchase.duration')} required>
                <InputNumber aria-label={t('customer.dedicatedLines.purchase.duration')} min={1} max={365} value={durationDays} onChange={(value) => setDurationDays(value ?? 30)} />
              </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" block loading={orderMutation.isPending} disabled={!quote || quoteQuery.isFetching || !/^[A-Z]{2}$/.test(countryCode)}>
              {t('customer.dedicatedLines.purchase.submit')}
            </Button>
          </Form>
        </Card>
        <Card className="dedicated-line-quote-card" title={t('customer.dedicatedLines.purchase.quoteTitle')}>
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Statistic title={t('customer.dedicatedLines.purchase.quote')} value={quote ? (formatMoneyAmount(quote.totalPrice, quote.currency) ?? '--') : '--'} loading={quoteQuery.isFetching} />
            <div className="dedicated-line-quote-list">
              <QuoteRow label={t('customer.dedicatedLines.purchase.selectedSku')} value={skuCode || '--'} />
              <QuoteRow label={t('customer.dedicatedLines.purchase.route')} value={countryCode || '--'} />
              <QuoteRow label={t('customer.dedicatedLines.purchase.expiry')} value={quote ? t('customer.dedicatedLines.purchase.expiryValue', { days: quote.durationDays }) : '--'} />
              <QuoteRow label={t('customer.dedicatedLines.purchase.source')} value={quote?.priceSource ?? '--'} />
            </div>
            <Typography.Text type="secondary">{t('customer.dedicatedLines.purchase.chargeNotice')}</Typography.Text>
          </Space>
        </Card>
      </div>
    </div>
  );
}

function QuoteRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="dedicated-line-quote-row"><Typography.Text type="secondary">{label}</Typography.Text><Typography.Text strong>{value}</Typography.Text></div>;
}

function reasonText(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('error');
  const key = `customer.dedicatedLines.reason.${error.reasonKey}`;
  const translated = t(key);
  return translated === key ? t('customer.dedicatedLines.reason.generic') : translated;
}
