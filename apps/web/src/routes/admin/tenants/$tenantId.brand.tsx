import React from 'react';
import { useParams } from '@tanstack/react-router';
import { TenantBrandFeature } from '../../../features/admin-tenants/tenant-brand.feature';

export function AdminTenantBrandPage() {
  const { tenantId } = useParams({ strict: false }) as { tenantId: string };
  return <TenantBrandFeature tenantId={tenantId} backMode="tenant" />;
}
