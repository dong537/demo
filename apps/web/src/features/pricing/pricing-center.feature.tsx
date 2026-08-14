import React from 'react';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { QuoteSandboxFeature } from './quote-sandbox.feature';
import { PricingMatrixFeature } from './pricing-matrix.feature';
import { PageHeader } from '../../shared/ui/page-header';

export function PricingCenterFeature() {
  const { t } = useTranslation();

  return (
    <div className="ipx-pricing-page">
      <PageHeader
        kicker={t('pricing.center.kicker')}
        title={t('pricing.center.title')}
      />
      <Tabs
        defaultActiveKey="matrix"
        destroyInactiveTabPane
        items={[
          {
            key: 'matrix',
            label: t('pricing.center.tabs.matrix'),
            children: <PricingMatrixFeature />,
          },
          {
            key: 'sandbox',
            label: t('pricing.center.tabs.sandbox'),
            children: <QuoteSandboxFeature />,
          },
        ]}
      />
    </div>
  );
}
