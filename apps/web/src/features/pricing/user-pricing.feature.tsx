import React from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Select, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, buildQuery } from '../../shared/api/client';
import {
  PRICING_CURRENCY_OPTIONS,
  toResourceOptions,
  usePricingResources,
} from './use-pricing-resources';
import { DEFAULT_PRICING_DURATION_DAYS } from './pricing-duration';
import { formatPricingFailure } from './pricing-errors';

interface TemplateOption {
  id: string;
  name: string;
}

interface UserOverrideFormValues {
  tenantId: string;
  userId: string;
  resourceId: string;
  unitPrice: number | string;
  currency: string;
}

interface UserBindingFormValues {
  tenantId: string;
  userId: string;
  templateId: string;
}

const USER_OVERRIDE_TENANT_ID = 'pricing-user-override-tenantId';
const USER_OVERRIDE_USER_ID = 'pricing-user-override-userId';
const USER_OVERRIDE_RESOURCE_ID = 'pricing-user-override-resourceId';
const USER_OVERRIDE_UNIT_PRICE = 'pricing-user-override-unitPrice';
const USER_OVERRIDE_CURRENCY = 'pricing-user-override-currency';

const USER_BINDING_TENANT_ID = 'pricing-user-binding-tenantId';
const USER_BINDING_USER_ID = 'pricing-user-binding-userId';
const USER_BINDING_TEMPLATE_ID = 'pricing-user-binding-templateId';

export function buildUserOverrideBody(values: UserOverrideFormValues) {
  return {
    tenantId: values.tenantId.trim(),
    userId: values.userId.trim(),
    resourceId: values.resourceId,
    durationDays: DEFAULT_PRICING_DURATION_DAYS,
    unitPrice: String(values.unitPrice),
    currency: values.currency,
  };
}

export function buildUserBindingBody(values: UserBindingFormValues) {
  return {
    tenantId: values.tenantId.trim(),
    userId: values.userId.trim(),
    templateId: values.templateId,
  };
}

function invalidatePricingSurfaceQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['price-templates'] });
  void qc.invalidateQueries({ queryKey: ['resources'] });
  void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
  void qc.invalidateQueries({ queryKey: ['resources-list'] });
  void qc.invalidateQueries({ queryKey: ['resources-countries'] });
  void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
  void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
  void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
}

export function UserPricingFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [overrideForm] = Form.useForm<UserOverrideFormValues>();
  const [bindingForm] = Form.useForm<UserBindingFormValues>();
  const resourcesQuery = usePricingResources();

  const templatesQuery = useQuery({
    queryKey: ['price-templates', 'options'],
    queryFn: () =>
      apiRequest<{ items: TemplateOption[] }>(
        `/api/pricing/templates${buildQuery({ page: 1, pageSize: 20 })}`,
      ),
  });

  const overrideMutation = useMutation({
    mutationFn: (values: UserOverrideFormValues) =>
      apiRequest('/api/pricing/user-overrides', {
        method: 'POST',
        body: JSON.stringify(buildUserOverrideBody(values)),
      }),
    onSuccess: () => {
      message.success(t('pricing.userOverride.success'));
      overrideForm.resetFields();
      invalidatePricingSurfaceQueries(qc);
    },
  });

  const bindingMutation = useMutation({
    mutationFn: (values: UserBindingFormValues) =>
      apiRequest('/api/pricing/user-template-bindings', {
        method: 'POST',
        body: JSON.stringify(buildUserBindingBody(values)),
      }),
    onSuccess: () => {
      message.success(t('pricing.userBinding.success'));
      bindingForm.resetFields();
      invalidatePricingSurfaceQueries(qc);
    },
  });

  const resourceOptions = toResourceOptions(resourcesQuery.items);
  const templateOptions = (templatesQuery.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.name,
  }));

  return (
    <Card>
      <Typography.Title level={5}>{t('pricing.userOverride.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t('pricing.userOverride.description')}
      </Typography.Paragraph>
      {overrideMutation.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('error')}
          description={formatPricingFailure(overrideMutation.error, t)}
        />
      )}
      <Form
        form={overrideForm}
        layout="vertical"
        style={{ maxWidth: 480 }}
        initialValues={{ currency: 'CNY' }}
        onFinish={(values) => overrideMutation.mutate(values)}
      >
        <Form.Item
          name="tenantId"
          label={t('pricing.userOverride.tenantId')}
          rules={[{ required: true, message: t('pricing.userOverride.tenantIdRequired') }]}
        >
          <Input id={USER_OVERRIDE_TENANT_ID} />
        </Form.Item>
        <Form.Item
          name="userId"
          label={t('pricing.userOverride.userId')}
          rules={[{ required: true, message: t('pricing.userOverride.userIdRequired') }]}
        >
          <Input id={USER_OVERRIDE_USER_ID} />
        </Form.Item>
        <Form.Item
          name="resourceId"
          label={t('pricing.userOverride.resource')}
          rules={[{ required: true, message: t('pricing.override.resourceRequired') }]}
        >
          <Select
            id={USER_OVERRIDE_RESOURCE_ID}
            options={resourceOptions}
            loading={resourcesQuery.isLoading}
            showSearch
            optionFilterProp="searchText"
          />
        </Form.Item>
        <Form.Item
          name="unitPrice"
          label={t('pricing.userOverride.unitPrice')}
          rules={[{ required: true, type: 'number', min: 0 }]}
        >
          <InputNumber id={USER_OVERRIDE_UNIT_PRICE} min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="currency"
          label={t('pricing.userOverride.currency')}
          rules={[{ required: true }]}
        >
          <Select id={USER_OVERRIDE_CURRENCY} options={PRICING_CURRENCY_OPTIONS} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={overrideMutation.isPending}>
            {t('pricing.userOverride.submit')}
          </Button>
        </Form.Item>
      </Form>

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('pricing.userBinding.title')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t('pricing.userBinding.description')}
      </Typography.Paragraph>
      {bindingMutation.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('error')}
          description={formatPricingFailure(bindingMutation.error, t)}
        />
      )}
      <Form
        form={bindingForm}
        layout="vertical"
        style={{ maxWidth: 480 }}
        onFinish={(values) => bindingMutation.mutate(values)}
      >
        <Form.Item
          name="tenantId"
          label={t('pricing.userBinding.tenantId')}
          rules={[{ required: true, message: t('pricing.userOverride.tenantIdRequired') }]}
        >
          <Input id={USER_BINDING_TENANT_ID} />
        </Form.Item>
        <Form.Item
          name="userId"
          label={t('pricing.userBinding.userId')}
          rules={[{ required: true, message: t('pricing.userOverride.userIdRequired') }]}
        >
          <Input id={USER_BINDING_USER_ID} />
        </Form.Item>
        <Form.Item
          name="templateId"
          label={t('pricing.userBinding.template')}
          rules={[{ required: true, message: t('pricing.userBinding.templateRequired') }]}
        >
          <Select
            id={USER_BINDING_TEMPLATE_ID}
            options={templateOptions}
            loading={templatesQuery.isLoading}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={bindingMutation.isPending}>
            {t('pricing.userBinding.submit')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
