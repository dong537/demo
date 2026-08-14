import React from 'react';
import { Alert, Button, Form, InputNumber, Select, Space, Typography, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, type ApiError } from '../../shared/api/client';
import {
  PRICING_CURRENCY_OPTIONS,
  toResourceOptions,
  usePricingResources,
} from './use-pricing-resources';
import { DEFAULT_PRICING_DURATION_DAYS } from './pricing-duration';
import { PricingPriorityChain } from './pricing-priority';
import { formatPricingFailure } from './pricing-errors';

interface ResourceOverrideFormValues {
  resourceId: string;
  unitPrice: number | string;
  currency: string;
}

export function buildResourceOverrideBody(values: ResourceOverrideFormValues) {
  return {
    resourceId: values.resourceId,
    durationDays: DEFAULT_PRICING_DURATION_DAYS,
    unitPrice: String(values.unitPrice),
    currency: values.currency,
  };
}

export function ResourceOverrideFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm<ResourceOverrideFormValues>();
  const resourcesQuery = usePricingResources();
  const summaryValues = Form.useWatch([], form) as Partial<ResourceOverrideFormValues> | undefined;
  const resourceError = resourcesQuery.error as ApiError | null;

  const mutation = useMutation({
    mutationFn: (values: ResourceOverrideFormValues) =>
      apiRequest('/api/pricing/overrides', {
        method: 'POST',
        body: JSON.stringify(buildResourceOverrideBody(values)),
      }),
    onSuccess: () => {
      message.success(t('pricing.override.success'));
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['price-templates'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
    },
  });

  const resourceOptions = toResourceOptions(resourcesQuery.items);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 320px',
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
          {t('pricing.override.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t('pricing.override.description')}
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('pricing.override.priorityNotice')}
          description={<PricingPriorityChain t={t} />}
        />
        {resourceError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('pricing.override.resource')}
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
          initialValues={{ currency: 'CNY' }}
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item
            name="resourceId"
            label={t('pricing.override.resource')}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Form.Item
              name="unitPrice"
              label={t('pricing.override.unitPrice')}
              rules={[{ required: true, type: 'number', min: 0 }]}
            >
              <InputNumber min={0} precision={2} size="large" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="currency"
              label={t('pricing.override.currency')}
              rules={[{ required: true }]}
            >
              <Select size="large" options={PRICING_CURRENCY_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" size="large" htmlType="submit" loading={mutation.isPending}>
              {t('pricing.override.submit')}
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
          {t('pricing.override.summaryTitle')}
        </Typography.Title>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={t('pricing.override.priorityNotice')}
            description={<PricingPriorityChain t={t} activeSource="RESOURCE_OVERRIDE" />}
          />
          <SummaryRow
            label={t('pricing.override.resource')}
            value={formatOptionLabel(resourceOptions, summaryValues?.resourceId) ?? t('pricing.override.unselected')}
          />
          <SummaryRow
            label={t('pricing.override.unitPrice')}
            value={summaryValues?.unitPrice === undefined || summaryValues.unitPrice === '' ? '-' : summaryValues.unitPrice}
          />
          <SummaryRow label={t('pricing.override.currency')} value={summaryValues?.currency ?? 'CNY'} />
          <SummaryRow label={t('pricing.sandbox.priceSource')} value={t('pricing.sandbox.source.RESOURCE_OVERRIDE')} />
        </Space>
      </div>
    </div>
  );
}

function formatOptionLabel(options: Array<{ value: string; label: string }>, value?: string) {
  return options.find((option) => option.value === value)?.label;
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text style={{ textAlign: 'right' }}>{value}</Typography.Text>
    </div>
  );
}
