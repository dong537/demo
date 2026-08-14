import { Alert, Button, Card, Skeleton, Space, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined, WalletOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { userApiRequest, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { formatMoneyAmount } from '../../shared/money/money';

interface WalletDto {
  userId: string;
  available: string;
  frozen: string;
  currency: string;
}

export function CustomerWalletOverviewFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';

  const walletQuery = useQuery({
    queryKey: ['customer-wallet', userId],
    queryFn: () => userApiRequest<WalletDto>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });
  const { data, isLoading, error } = walletQuery;
  const availableDisplay = formatMoneyAmount(data?.available ?? '', data?.currency ?? '') ?? '-';

  if (currentQuery.isLoading || isLoading) return <Skeleton active />;

  const viewError = currentQuery.error ?? error;
  if (viewError) {
    const apiErr = viewError instanceof ApiError ? viewError : null;
    const isPermission = apiErr?.code === 'PERMISSION_DENIED' || apiErr?.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatWalletReason(t, viewError)}
        showIcon
      />
    );
  }

  return (
    <Card
      className="ipx-wallet-overview-card ipx-wallet-page ipx-customer-page ipx-customer-wallet-page ipx-customer-hero"
      variant="borderless"
      style={surfaceCardStyle({ borderRadius: 8, overflow: 'hidden' })}
      styles={{ body: { padding: 20 } }}
    >
      <Space className="ipx-wallet-overview-main" direction="vertical" size={14} style={{ width: '100%' }}>
        <div className="ipx-wallet-balance-row">
          <Space align="center" size={12}>
            <span className="ipx-wallet-overview-icon"><WalletOutlined /></span>
            <div>
              <Typography.Text className="ipx-overview-card-label">{t('customer.overview.title')}</Typography.Text>
              <Typography.Title level={2} className="ipx-wallet-balance-value">
                {availableDisplay}
              </Typography.Title>
            </div>
          </Space>
        </div>
        <Space wrap>
          <Button className="ipx-wallet-topup-button" type="primary" size="large" icon={<PlusOutlined />} onClick={() => navigate({ to: '/wallet/topup' })}>
            {t('customer.overview.topupBtn')}
          </Button>
          <Button
            size="large"
            icon={<ReloadOutlined />}
            loading={walletQuery.isFetching}
            onClick={() => void walletQuery.refetch().then((result) => {
              if (result.isError) {
                message.error(formatWalletReason(t, result.error));
                return;
              }
              message.success(t('customer.overview.refreshSuccess'));
            })}
          >
            {t('refresh')}
          </Button>
        </Space>
      </Space>
    </Card>
  );
}

function formatWalletReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  if (!(error instanceof ApiError)) return t('error');
  const translationKey = `customer.overview.reason.${error.reasonKey}`;
  const label = t(translationKey);
  return label === translationKey ? t('customer.overview.reason.generic') : label;
}
