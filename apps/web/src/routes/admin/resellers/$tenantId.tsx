import React from 'react';
import { useParams } from '@tanstack/react-router';
import { TenantDetailFeature } from '../../../features/admin-tenants/tenant-detail.feature';

export function AdminResellerDetailPage() {
  const { tenantId } = useParams({ strict: false }) as { tenantId: string };
  return <TenantDetailFeature tenantId={tenantId} mode="reseller" />;
}
