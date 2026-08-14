import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Form, Input, Row, Skeleton, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';

interface TenantBrandDto {
  tenantId: string;
  siteName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  customDomain?: string | null;
  supportEmail?: string | null;
}

interface TenantBrandFeatureProps {
  tenantId: string;
  backMode?: 'tenant' | 'reseller';
}

function hasValue(value?: string | null) {
  return Boolean(value?.trim());
}

export function TenantBrandFeature({ tenantId, backMode }: TenantBrandFeatureProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm<TenantBrandDto>();
  const [serverError, setServerError] = useState<string | null>(null);
  const navigateTo = (to: string) => { void navigate({ to }); };

  const query = useQuery({
    queryKey: ['tenant-brand', tenantId],
    queryFn: () => apiRequest<TenantBrandDto>(`/api/tenants/${tenantId}/brand`),
  });

  useEffect(() => {
    if (query.data) form.setFieldsValue(query.data);
  }, [form, query.data]);

  const mutation = useMutation({
    mutationFn: (values: TenantBrandDto) =>
      apiRequest<TenantBrandDto>(`/api/tenants/${tenantId}/brand`, {
        method: 'PUT',
        body: JSON.stringify({
          siteName: values.siteName,
          logoUrl: values.logoUrl ?? null,
          primaryColor: values.primaryColor ?? null,
          customDomain: values.customDomain ?? null,
          supportEmail: values.supportEmail ?? null,
        }),
      }),
    onSuccess: (data) => {
      setServerError(null);
      form.setFieldsValue(data);
      message.success(t('tenantBrand.saveSuccess'));
      void qc.invalidateQueries({ queryKey: ['tenant-brand', tenantId] });
      void qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
    onError: (e) => {
      setServerError(e instanceof ApiError ? e.reasonKey : t('error'));
    },
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.error) {
    const err = query.error as ApiError;
    return <Alert type="error" message={t('error')} description={err.reasonKey} showIcon />;
  }

  const brand = query.data!;
  const configuredCount = [
    brand.siteName,
    brand.logoUrl,
    brand.primaryColor,
    brand.customDomain,
    brand.supportEmail,
  ].filter(hasValue).length;

  return (
    <>
      <PageHeader
        kicker={t('tenantBrand.kicker')}
        title={t('tenantBrand.title')}
      />
      {serverError && <Alert type="error" message={serverError} showIcon style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={8}>
          <Card variant="borderless" style={surfaceCardStyle()}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color={brand.siteName ? 'green' : 'orange'}>
                  {brand.siteName ? t('tenantBrand.status.configured') : t('tenantBrand.status.incomplete')}
                </Tag>
                <Tag>{t('tenantBrand.summary.configuredFields', { count: configuredCount })}</Tag>
              </Space>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: 'siteName', label: t('tenantBrand.siteName'), children: brand.siteName },
                  { key: 'customDomain', label: t('tenantBrand.customDomain'), children: brand.customDomain || t('tenantBrand.emptyValue') },
                  { key: 'supportEmail', label: t('tenantBrand.supportEmail'), children: brand.supportEmail || t('tenantBrand.emptyValue') },
                ]}
              />
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card variant="borderless" style={surfaceCardStyle()}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>{t('tenantBrand.formTitle')}</Typography.Title>
            <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
              <Form.Item name="siteName" label={t('tenantBrand.siteName')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="logoUrl" label={t('tenantBrand.logoUrl')}>
                <Input />
              </Form.Item>
              <Form.Item name="primaryColor" label={t('tenantBrand.primaryColor')}>
                <Input placeholder="#1677ff" />
              </Form.Item>
              <Form.Item name="customDomain" label={t('tenantBrand.customDomain')}>
                <Input />
              </Form.Item>
              <Form.Item name="supportEmail" label={t('tenantBrand.supportEmail')}>
                <Input />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Space>
                  <Button type="primary" htmlType="submit" loading={mutation.isPending}>
                    {t('submit')}
                  </Button>
                  {backMode && (
                    <Button
                      onClick={() => {
                        navigateTo(`${backMode === 'reseller' ? '/admin/resellers' : '/admin/tenants'}/${tenantId}`);
                      }}
                    >
                      {t('cancel')}
                    </Button>
                  )}
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
}
