import React from 'react';
import { TenantListFeature } from '../../../features/admin-tenants/tenant-list.feature';

export function AdminResellersPage() {
  return <TenantListFeature mode="reseller" />;
}
