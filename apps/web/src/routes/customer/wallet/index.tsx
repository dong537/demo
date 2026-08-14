import React from 'react';
import { Button, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CustomerLedgerListFeature } from '../../../features/wallet/customer-ledger-list.feature';
import { CustomerWalletOverviewFeature } from '../../../features/wallet/customer-wallet-overview.feature';
import { PageHeader } from '../../../shared/ui/page-header';

export function CustomerWalletPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Space className="ipx-wallet-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title={t('customer.nav.wallet')}
        extra={(
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate({ to: '/wallet/topup' })}
          >
            {t('customer.overview.topupBtn')}
          </Button>
        )}
      />
      <CustomerWalletOverviewFeature />
      <CustomerLedgerListFeature />
    </Space>
  );
}
