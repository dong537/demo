import React from 'react';
import { Alert, Button, Form, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, type ApiError } from '../../shared/api/client';
import { formatMoneyAmount } from '../../shared/money/money';
import {
  PRICING_CURRENCY_OPTIONS,
  toResourceOptions,
  usePricingResources,
} from './use-pricing-resources';
import { PricingPriorityChain, getPriceSourceColor } from './pricing-priority';
import { formatPricingFailure } from './pricing-errors';

interface QuoteSandboxResult {
  unitPrice: string;
  totalPrice: string;
  currency: string;
  resourceId: string;
  durationDays: number;
  quantity: number;
  priceSource: 'USER_OVERRIDE' | 'USER_TEMPLATE' | 'TENANT_DEFAULT_TEMPLATE' | 'RESOURCE_OVERRIDE' | 'DEFAULT_TEMPLATE';
  isSaleable: boolean;
}

interface QuoteSandboxFormValues {
  tenantId: string;
  userId: string;
  resourceId: string;
  durationDays: number;
  quantity: number;
  currency: string;
}

export function buildQuoteSandboxBody(values: QuoteSandboxFormValues) {
  return {
    tenantId: values.tenantId.trim(),
    userId: values.userId.trim(),
    resourceId: values.resourceId,
    durationDays: Number(values.durationDays),
    quantity: Number(values.quantity),
    currency: values.currency,
  };
}

export function QuoteSandboxFeature() {
  const { t } = useTranslation();
  const [form] = Form.useForm<QuoteSandboxFormValues>();
  const resourcesQuery = usePricingResources();
  const resourceError = resourcesQuery.error as ApiError | null;

  const mutation = useMutation({
    mutationFn: (values: QuoteSandboxFormValues) =>
      apiRequest<QuoteSandboxResult>('/api/pricing/quote-sandbox', {
        method: 'POST',
        body: JSON.stringify(buildQuoteSandboxBody(values)),
      }),
  });

  const resourceOptions = toResourceOptions(resourcesQuery.items);
  const result = mutation.isError || mutation.isPending ? undefined : mutation.data;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 360px',
        gap: 20,
        alignItems: 'start',
      }}
    >
      <div
        style={{
          background: 'var(--ipx-surface)',
          border: '1px solid var(--ipx-border)',
          borderRadius: 'var(--ipx-radius-lg)',
          padding: 24,
        }}
      >
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t('pricing.sandbox.conditionsTitle')}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t('pricing.sandbox.description')}
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('pricing.center.priorityNotice')}
          description={<PricingPriorityChain t={t} />}
        />
      {resourceError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('pricing.sandbox.resource')}
          description={formatPricingFailure(resourceError, t)}
        />
      )}
      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('error')}
          description={formatPricingFailure(mutation.error, t)}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ durationDays: 30, quantity: 1, currency: 'CNY' }}
        onFinish={(values) => {
          mutation.reset();
          mutation.mutate(values);
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            name="tenantId"
            label={t('pricing.sandbox.tenantId')}
            rules={[{ required: true, message: t('pricing.sandbox.tenantIdRequired') }]}
          >
            <Input size="large" />
          </Form.Item>
          <Form.Item
            name="userId"
            label={t('pricing.sandbox.userId')}
            rules={[{ required: true, message: t('pricing.sandbox.userIdRequired') }]}
          >
            <Input size="large" />
          </Form.Item>
        </div>
        <Form.Item
          name="resourceId"
          label={t('pricing.sandbox.resource')}
          rules={[{ required: true, message: t('pricing.override.resourceRequired') }]}
        >
          <Select
            options={resourceOptions}
            loading={resourcesQuery.isLoading}
            showSearch
            size="large"
            optionFilterProp="searchText"
            placeholder={t('pricing.matrix.search')}
            status={resourceError ? 'error' : undefined}
            notFoundContent={resourceError ? formatPricingFailure(resourceError, t) : t('empty')}
          />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <Form.Item
            name="durationDays"
            label={t('pricing.sandbox.duration')}
            rules={[{ required: true, type: 'number', min: 1 }]}
          >
            <InputNumber min={1} size="large" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={t('pricing.sandbox.quantity')}
            rules={[{ required: true, type: 'number', min: 1 }]}
          >
            <InputNumber min={1} size="large" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="currency"
            label={t('pricing.sandbox.currency')}
            rules={[{ required: true }]}
          >
            <Select size="large" options={PRICING_CURRENCY_OPTIONS} />
          </Form.Item>
        </div>
        <Form.Item>
          <Button type="primary" size="large" htmlType="submit" loading={mutation.isPending}>
            {t('pricing.sandbox.submit')}
          </Button>
        </Form.Item>
      </Form>
      </div>

      <div
        style={{
          position: 'sticky',
          top: 24,
          background: 'var(--ipx-surface)',
          border: '1px solid var(--ipx-border)',
          borderRadius: 'var(--ipx-radius-lg)',
          padding: 24,
        }}
      >
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
          {t('pricing.sandbox.resultTitle')}
        </Typography.Title>
        {!result ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {mutation.isPending ? t('pricing.sandbox.resultLoading') : t('pricing.sandbox.resultEmpty')}
            </Typography.Paragraph>
          </Space>
        ) : (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <SummaryRow label={t('pricing.sandbox.totalPrice')} value={formatMoneyAmount(result.totalPrice, result.currency) ?? '-'} strong />
            <SummaryRow label={t('pricing.sandbox.unitPrice')} value={formatMoneyAmount(result.unitPrice, result.currency) ?? '-'} />
            <SummaryRow label={t('pricing.sandbox.quantity')} value={result.quantity} />
            <SummaryRow label={t('pricing.sandbox.duration')} value={result.durationDays} />
            <SummaryRow label={t('pricing.override.resource')} value={result.resourceId} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <Typography.Text type="secondary">{t('pricing.sandbox.priceSource')}</Typography.Text>
              <Tag color={getPriceSourceColor(result.priceSource)} style={{ marginInlineEnd: 0 }}>
                {t(`pricing.sandbox.source.${result.priceSource}`)}
              </Tag>
            </div>
            <PricingPriorityChain t={t} activeSource={result.priceSource} />
          </Space>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong={strong} style={{ textAlign: 'right' }}>
        {value}
      </Typography.Text>
    </div>
  );
}
