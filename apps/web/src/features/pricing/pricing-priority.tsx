import React from 'react';
import { Space, Tag, Typography } from 'antd';

type Translate = (key: string) => string;

export type QuotePriceSource = 'USER_OVERRIDE' | 'USER_TEMPLATE' | 'TENANT_DEFAULT_TEMPLATE' | 'RESOURCE_OVERRIDE' | 'DEFAULT_TEMPLATE';

const PRICE_SOURCE_ORDER: QuotePriceSource[] = [
  'USER_OVERRIDE',
  'USER_TEMPLATE',
  'TENANT_DEFAULT_TEMPLATE',
  'RESOURCE_OVERRIDE',
  'DEFAULT_TEMPLATE',
];

const PRICE_SOURCE_COLORS: Record<QuotePriceSource, string | undefined> = {
  USER_OVERRIDE: 'red',
  USER_TEMPLATE: 'orange',
  TENANT_DEFAULT_TEMPLATE: 'gold',
  RESOURCE_OVERRIDE: 'blue',
  DEFAULT_TEMPLATE: undefined,
};

export function getPriceSourceColor(source: QuotePriceSource): string | undefined {
  return PRICE_SOURCE_COLORS[source];
}

export function PricingPriorityChain({ t, activeSource }: { t: Translate; activeSource?: QuotePriceSource }) {
  return (
    <Space size={8} wrap>
      {PRICE_SOURCE_ORDER.map((source, index) => (
        <React.Fragment key={source}>
          {index > 0 && <Typography.Text type="secondary">&gt;</Typography.Text>}
          <Tag
            color={getPriceSourceColor(source)}
            style={activeSource === source ? { fontWeight: 600 } : undefined}
          >
            {t(`pricing.sandbox.source.${source}`)}
          </Tag>
        </React.Fragment>
      ))}
    </Space>
  );
}
