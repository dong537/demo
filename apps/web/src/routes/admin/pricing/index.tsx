import React from 'react';
import { PricingCenterFeature } from '../../../features/pricing/pricing-center.feature';
import { DedicatedSkuPricingFeature } from '../../../features/pricing/dedicated-sku-pricing.feature';

export function AdminPricingPage() {
  return (
    <>
      <DedicatedSkuPricingFeature />
      <PricingCenterFeature />
    </>
  );
}
