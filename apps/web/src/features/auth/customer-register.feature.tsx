import React from 'react';
import { Form, Input, Button } from 'antd';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { userApiRequest, ApiError, publicSiteHeaders } from '../../shared/api/client';
import { AuthShell } from './auth-shell';

const MIN_PASSWORD_LENGTH = 8;

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(MIN_PASSWORD_LENGTH),
    confirmPassword: z.string().min(1),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'password_mismatch',
  });
type FormValues = z.infer<typeof schema>;

interface CurrentSiteResponse {
  site: { id: string };
  tenant?: { id: string } | null;
}

function resolveRegisterError(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError) {
    if (error.reasonKey === 'email_taken') return t('customer.register.emailTaken');
    if (error.reasonKey === 'invalid_site') return t('customer.register.networkError');
    if (error.reasonKey) return t('customer.register.networkError');
  }
  return t('customer.register.networkError');
}

export function CustomerRegisterFeature() {
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
      const data = await userApiRequest<{ token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          siteId: current.site.id,
          ...(current.tenant?.id ? { tenantId: current.tenant.id } : {}),
        }),
      });
      sessionStorage.setItem('user_token', data.token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void navigate({ to: '/overview' } as any);
    } catch (e) {
      setServerError(resolveRegisterError(e, t));
    }
  };

  return (
    <AuthShell
      title={t('customer.register.title')}
      subtitle={t('customer.register.subtitle')}
      serverError={serverError}
      footer={
        <>
          {t('customer.register.haveAccount')} <a href="/login">{t('customer.register.toLogin')}</a>
        </>
      }
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
              <Input {...field} type="email" size="large" autoComplete="email" placeholder={t('login.email')} />
            )}
          />
        </Form.Item>
        <Form.Item
          label={t('login.password')}
          validateStatus={errors.password ? 'error' : ''}
          help={errors.password ? t('customer.register.passwordTooShort') : ''}
        >
          <Controller
            name="password"
            control={control}
            render={({ field }) => (
              <Input.Password {...field} size="large" autoComplete="new-password" placeholder={t('login.password')} />
            )}
          />
        </Form.Item>
        <Form.Item
          label={t('customer.register.confirmPassword')}
          validateStatus={errors.confirmPassword ? 'error' : ''}
          help={errors.confirmPassword ? t('customer.register.passwordMismatch') : ''}
        >
          <Controller
            name="confirmPassword"
            control={control}
            render={({ field }) => (
              <Input.Password {...field} size="large" autoComplete="new-password" placeholder={t('customer.register.confirmPassword')} />
            )}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isSubmitting} size="large" block>
            {t('customer.register.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
