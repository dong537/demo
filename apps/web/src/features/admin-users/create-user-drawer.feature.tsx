import React, { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select, Space, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError, buildQuery } from '../../shared/api/client';

interface CreateUserFormValues {
  email: string;
  password: string;
  tenantId?: string;
}

interface CreatedUserDto {
  id: string;
  email: string;
  tenantId: string;
  status: string;
  kycStatus: string;
  createdAt: string;
}

interface TenantOptionDto {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface CreateUserDrawerProps {
  open: boolean;
  tenantId?: string;
  onClose: () => void;
}

export function CreateUserDrawer({ open, tenantId, onClose }: CreateUserDrawerProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm<CreateUserFormValues>();
  const [actionError, setActionError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ['create-user-tenants'],
    queryFn: () => apiRequest<{ items: TenantOptionDto[] }>(`/api/tenants${buildQuery({ page: 1, pageSize: 20 })}`),
    enabled: open && !tenantId,
  });

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ tenantId });
      setActionError(null);
    }
  }, [form, open, tenantId]);

  const mutation = useMutation({
    mutationFn: (values: CreateUserFormValues) =>
      apiRequest<CreatedUserDto>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          tenantId: tenantId ?? values.tenantId,
        }),
      }),
    onSuccess: () => {
      message.success(t('users.create.success'));
      setActionError(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (error) => {
      setActionError(formatCreateUserFailure(error, t));
    },
  });

  const close = () => {
    form.resetFields();
    setActionError(null);
    onClose();
  };

  return (
    <Drawer
      title={t('users.create.title')}
      open={open}
      onClose={close}
      width={460}
      destroyOnClose
      styles={{ body: { paddingTop: 18 } }}
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
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item
          name="email"
          label={t('users.email')}
          rules={[
            { required: true, message: t('users.create.emailRequired') },
            { type: 'email', message: t('users.create.emailInvalid') },
          ]}
        >
          <Input autoComplete="off" placeholder={t('users.create.emailPlaceholder')} />
        </Form.Item>
        {!tenantId && (
          <Form.Item
            name="tenantId"
            label={t('users.tenantId')}
            rules={[{ required: true, message: t('users.create.tenantRequired') }]}
          >
            <Select
              showSearch
              loading={tenantsQuery.isLoading}
              placeholder={t('users.create.tenantPlaceholder')}
              optionFilterProp="label"
              options={(tenantsQuery.data?.items ?? []).map((tenant) => ({
                value: tenant.id,
                label: `${tenant.name} / ${tenant.code}`,
                disabled: tenant.status !== 'ACTIVE',
              }))}
              notFoundContent={tenantsQuery.isLoading ? t('loading') : t('users.create.noTenants')}
            />
          </Form.Item>
        )}
        <Form.Item
          name="password"
          label={t('users.create.password')}
          rules={[
            { required: true, message: t('users.create.passwordRequired') },
            { min: 8, message: t('users.create.passwordWeak') },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder={t('users.create.passwordPlaceholder')} />
        </Form.Item>
        <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            {t('users.create.submit')}
          </Button>
        </Space>
      </Form>
    </Drawer>
  );
}

function getCreateUserReasonKey(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function formatCreateUserFailure(error: unknown, t: (key: string) => string): string {
  const reasonKey = getCreateUserReasonKey(error, t('error'));
  const key = `users.reason.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('users.reason.generic') : translated;
}
