import React from 'react';
import { Alert, Card, Col, Row, Skeleton, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError } from '../../shared/api/client';
import { useCurrentAdmin } from '../../shared/auth/current-user';
import { PageHeader } from '../../shared/ui/page-header';
import { kpiCardStyle } from '../../shared/ui/surface';

interface TenantDetailDto {
  id: string;
  name: string;
  code: string;
  status: string;
  totalBalance: string;
  customerCount: number;
  orderCount: number;
  monthlyOrders: number;
}

export function TenantDashboardFeature() {
  const { t } = useTranslation();
  const currentAdmin = useCurrentAdmin();
  const tenantId = currentAdmin.data?.tenantId ?? '';

  const query = useQuery({
    queryKey: ['tenant-dashboard', tenantId],
    queryFn: () => apiRequest<TenantDetailDto>(`/api/tenants/${tenantId}`),
    enabled: !!tenantId,
  });

  if (currentAdmin.isLoading || query.isLoading) return <Skeleton active />;
  const viewError = currentAdmin.error ?? query.error;
  if (viewError || !tenantId) {
    const err = viewError as ApiError | undefined;
    return (
      <Alert
        type="error"
        message={t('error')}
        description={err?.reasonKey ?? 'tenant_context_required'}
        showIcon
      />
    );
  }

  const tenant = query.data!;
  return (
    <>
      <PageHeader
        title={t('tenantDashboard.title')}
        kicker={t('tenantDashboard.kicker')}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card hoverable variant="borderless" style={kpiCardStyle()}>
            <Statistic title={t('tenants.customerCount')} value={tenant.customerCount} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable variant="borderless" style={kpiCardStyle('#10b981')}>
            <Statistic title={t('tenants.totalBalance')} value={tenant.totalBalance} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable variant="borderless" style={kpiCardStyle('#f59e0b')}>
            <Statistic title={t('tenants.monthlyOrders')} value={tenant.monthlyOrders} />
          </Card>
        </Col>
      </Row>
    </>
  );
}
