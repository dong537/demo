import React, { useState } from 'react';
import { Alert, Button, Form, Input, Space, Typography, message } from 'antd';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError } from '../../shared/api/client';

interface TenantDto {
  id: string;
  name: string;
  code: string;
}

interface TenantCreateFormValues {
  name: string;
  code: string;
  adminEmail: string;
  adminPassword: string;
}

interface TenantCreateFeatureProps {
  mode?: 'tenant' | 'reseller';
}

export function TenantCreateFeature({ mode = 'tenant' }: TenantCreateFeatureProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<TenantCreateFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const basePath: string = mode === 'reseller' ? '/admin/resellers' : '/admin/tenants';
  const createKey = mode === 'reseller' ? 'resellers.create' : 'tenants.create';
  const successKey = mode === 'reseller' ? 'resellers.createSuccess' : 'tenants.createSuccess';
  const navigateTo = (to: string) => { void navigate({ to }); };

  const onFinish = async (values: TenantCreateFormValues) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const tenant = await apiRequest<TenantDto>('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name.trim(),
          code: values.code.trim(),
          adminEmail: values.adminEmail.trim(),
          adminPassword: values.adminPassword,
        }),
      });
      message.success(t(successKey));
      navigateTo(`${basePath}/${tenant.id}`);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.reasonKey : t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Typography.Title level={4}>{t(createKey)}</Typography.Title>
      {serverError && <Alert type="error" message={serverError} showIcon style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 520 }}>
        <Form.Item name="name" label={t('tenants.name')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label={t('tenants.code')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Typography.Title level={5}>{t('tenants.createAdminSection')}</Typography.Title>
        <Form.Item
          name="adminEmail"
          label={t('tenants.adminEmail')}
          normalize={(value: string | undefined) => value?.trim()}
          rules={[
            { required: true, message: t('tenants.adminEmailRequired') },
            { type: 'email', message: t('tenants.adminEmailInvalid') },
          ]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="adminPassword"
          label={t('tenants.adminPassword')}
          rules={[
            { required: true, message: t('tenants.adminPasswordRequired') },
            { min: 8, message: t('tenants.adminPasswordWeak') },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {t('submit')}
            </Button>
            <Button
              onClick={() => {
                navigateTo(basePath);
              }}
            >
              {t('cancel')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </>
  );
}
