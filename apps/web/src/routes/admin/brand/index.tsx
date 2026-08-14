import React from 'react';
import { Alert, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { TenantBrandFeature } from '../../../features/admin-tenants/tenant-brand.feature';
import { useCurrentAdmin } from '../../../shared/auth/current-user';

export function AdminBrandPage() {
  const { t } = useTranslation();
  const currentAdmin = useCurrentAdmin();
  if (currentAdmin.isLoading) return <Skeleton active />;
  const tenantId = currentAdmin.data?.tenantId;
  if (!tenantId) {
    return <Alert type="error" message={t('error')} description="tenant_context_required" showIcon />;
  }
  return <TenantBrandFeature tenantId={tenantId} />;
}
