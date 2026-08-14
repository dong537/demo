import React from 'react';
import { Form, Input, Button } from 'antd';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { userApiRequest, apiRequest, ApiError, publicSiteHeaders } from '../../shared/api/client';
import { clearCurrentUserCache, type CurrentUser } from '../../shared/auth/current-user';
import { AuthShell } from './auth-shell';

const schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

interface CurrentSiteResponse {
  site: { id: string };
}

function resolveCustomerLoginError(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError) {
    if (error.reasonKey) {
      if (error.reasonKey === 'invalid_credentials') return t('customer.login.invalidCredentials');
      return t('customer.login.networkError');
    }
  }
  return t('customer.login.networkError');
}

export function CustomerLoginFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const current = await userApiRequest<CurrentSiteResponse>('/api/sites/current', { headers: publicSiteHeaders() });
      const data = await userApiRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...values, siteId: current.site.id }),
      });
      const identity = await apiRequest<CurrentUser>('/api/auth/me', {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (identity.ownerType === 'TENANT_ADMIN' || identity.ownerType === 'PLATFORM_ADMIN') {
        sessionStorage.removeItem('user_token');
        clearCurrentUserCache('customer');
        sessionStorage.setItem('admin_token', data.token);
        clearCurrentUserCache('admin');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void navigate({ to: '/admin' } as any);
        return;
      }
      if (identity.ownerType === 'USER') {
        sessionStorage.removeItem('admin_token');
        clearCurrentUserCache('admin');
        sessionStorage.setItem('user_token', data.token);
        clearCurrentUserCache('customer');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void navigate({ to: '/overview' } as any);
        return;
      }
      throw new ApiError('PERMISSION_DENIED', 'insufficient_permissions');
    } catch (e) {
      setServerError(resolveCustomerLoginError(e, t));
    }
  };

  return (
    <AuthShell
      title={t('customer.login.title')}
      subtitle={t('customer.login.subtitle')}
      serverError={serverError}
      footer={
        <>
          {t('customer.login.noAccount')} <a href="/register">{t('customer.login.toRegister')}</a>
        </>
      }
    >
      <Form layout="vertical" onFinish={handleSubmit(onSubmit)}>
        <Form.Item
          label={t('customer.login.account')}
          validateStatus={errors.email ? 'error' : ''}
          help={errors.email ? t('customer.login.accountRequired') : ''}
        >
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <Input {...field} size="large" autoComplete="username" placeholder={t('customer.login.account')} />
            )}
          />
        </Form.Item>
        <Form.Item
          label={t('login.password')}
          validateStatus={errors.password ? 'error' : ''}
          help={errors.password ? t('login.passwordRequired') : ''}
        >
          <Controller
            name="password"
            control={control}
            render={({ field }) => (
              <Input.Password {...field} size="large" autoComplete="current-password" placeholder={t('login.password')} />
            )}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isSubmitting} size="large" block>
            {t('login.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
