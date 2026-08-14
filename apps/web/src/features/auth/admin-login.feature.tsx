import React from 'react';
import { Form, Input, Button } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError } from '../../shared/api/client';
import { AuthShell } from './auth-shell';

const schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

interface CurrentSiteResponse {
  site: { id: string };
}

function resolveLoginError(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError) {
    if (error.reasonKey) {
      if (error.reasonKey === 'invalid_credentials') return t('login.invalidCredentials');
      return t('login.networkError');
    }
  }
  return t('login.networkError');
}

export function AdminLoginFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const current = await apiRequest<CurrentSiteResponse>('/api/sites/current');
      const data = await apiRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...values, siteId: current.site.id }),
      });
      sessionStorage.setItem('admin_token', data.token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void navigate({ to: '/admin/users' } as any);
    } catch (e) {
      setServerError(resolveLoginError(e, t));
    }
  };

  return (
    <AuthShell
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      serverError={serverError}
      variant="admin"
    >
      <Form layout="vertical" onFinish={handleSubmit(onSubmit)}>
        <Form.Item
          label={t('login.email')}
          validateStatus={errors.email ? 'error' : ''}
          help={errors.email ? t('login.emailInvalid') : ''}
        >
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <Input {...field} size="large" autoComplete="username" placeholder={t('login.email')} />
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
