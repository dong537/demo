import React from 'react';
import { Alert, Button, Card, Col, Descriptions, Form, Input, Row, Skeleton, Space, Statistic, Steps, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, FileTextOutlined, ShopOutlined, TagsOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError, userApiRequest } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { getBackendReason, resellerHeroStyle, resellerIconStyle, resellerMetricBodyStyle, resellerMetricToneStyle } from './reseller-ui';

interface SelfServiceTenantFormValues {
  name: string;
  code: string;
}

interface TenantDto {
  id: string;
  code: string;
  name: string;
  status: string;
  customerCount: number;
}

interface OverviewDto {
  tenant: TenantDto;
  stats: {
    customerCount: number;
    orderCount: number;
    monthlyOrders: number;
    templateCount: number;
    productCount: number;
    saleableProductCount: number;
    balanceByCurrency: Record<string, string>;
  };
}

export function buildSelfServiceTenantBody(values: SelfServiceTenantFormValues) {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
  };
}

export function CustomerSelfServiceResellerFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm<SelfServiceTenantFormValues>();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['customer-reseller-overview'],
    queryFn: () => userApiRequest<OverviewDto>('/api/customer/reseller/overview'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (values: SelfServiceTenantFormValues) =>
      userApiRequest<{ tenant: TenantDto }>('/api/tenants/self-service', {
        method: 'POST',
        body: JSON.stringify(buildSelfServiceTenantBody(values)),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.createSuccess'));
      setServerError(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
      void qc.invalidateQueries({ queryKey: ['customer-reseller-me'] });
    },
    onError: (error) => {
      setServerError(getBackendReason(error, t));
    },
  });

  if (overviewQuery.isLoading) {
    return (
      <Space className="ipx-reseller-page ipx-reseller-dashboard-page ipx-reseller-overview-page" direction="vertical" size="large" style={{ width: '100%' }}>
        <PageHeader
          kicker={t('customer.reseller.kicker')}
          title={t('customer.reseller.title')}
          description={t('customer.reseller.description')}
        />
        <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle()}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      </Space>
    );
  }

  if (overviewQuery.data) {
    const { tenant, stats } = overviewQuery.data;
    const balanceEntries = Object.entries(stats.balanceByCurrency ?? {});
    const managementEntrypoints = [
      {
        title: t('customer.reseller.cards.products'),
        desc: t('customer.reseller.cards.productsDesc'),
        to: '/reseller/products',
        icon: <AppstoreOutlined />,
        step: t('customer.reseller.flow.products'),
      },
      {
        title: t('customer.reseller.cards.pricing'),
        desc: t('customer.reseller.cards.pricingDesc'),
        to: '/reseller/pricing',
        icon: <TagsOutlined />,
        step: t('customer.reseller.flow.pricing'),
      },
      {
        title: t('customer.reseller.cards.users'),
        desc: t('customer.reseller.cards.usersDesc'),
        to: '/reseller/users',
        icon: <TeamOutlined />,
        step: t('customer.reseller.flow.users'),
      },
      {
        title: t('customer.reseller.cards.orders'),
        desc: t('customer.reseller.cards.ordersDesc'),
        to: '/reseller/orders',
        icon: <FileTextOutlined />,
        step: t('customer.reseller.flow.orders'),
      },
    ];

    return (
      <Space className="ipx-reseller-page ipx-reseller-dashboard-page ipx-reseller-overview-page" direction="vertical" size={12} style={{ width: '100%' }}>
        <PageHeader
          kicker={t('customer.reseller.kicker')}
          title={tenant.name}
          description={t('customer.reseller.dashboardDescription')}
        />
        <Alert
          type="info"
          showIcon
          message={t('customer.reseller.dashboardSourceTruth')}
        />
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-dashboard-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#315cff')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.stats.customers')} value={stats.customerCount} prefix={<TeamOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-dashboard-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#f59e0b')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.stats.orders')} value={stats.orderCount} prefix={<FileTextOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-dashboard-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#25d8b4')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.stats.monthlyOrders')} value={stats.monthlyOrders} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-dashboard-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#8b5cf6')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.stats.templates')} value={stats.templateCount} prefix={<TagsOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card className="ipx-reseller-metric-card ipx-reseller-dashboard-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#06b6d4')} styles={resellerMetricBodyStyle}>
              <Statistic title={t('customer.reseller.stats.products')} value={stats.saleableProductCount} suffix={`/ ${stats.productCount}`} prefix={<AppstoreOutlined />} />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle({ minHeight: '100%' })}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space direction="vertical" size={2}>
                    <Typography.Title level={4} style={{ margin: 0 }}>{t('customer.nav.groups.reseller')}</Typography.Title>
                    <Typography.Text type="secondary">{t('customer.reseller.dashboardDescription')}</Typography.Text>
                  </Space>
                  <Tag color={tenant.status === 'ACTIVE' ? 'green' : 'default'}>{formatTenantStatus(tenant.status)}</Tag>
                </Space>
                <Row gutter={[12, 12]}>
                  {managementEntrypoints.map((item) => (
                    <Col xs={24} md={12} key={item.to}>
                      <Card
                        variant="borderless"
                        className="ipx-reseller-overview-entry"
                        style={resellerHeroStyle({ minHeight: '100%' })}
                        styles={{ body: { padding: 16 } }}
                      >
                        <Space align="start" size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Space align="start" size={12}>
                            <span style={resellerIconStyle}>
                              {item.icon}
                            </span>
                            <Space direction="vertical" size={4}>
                              <Typography.Text strong>{item.title}</Typography.Text>
                              <Typography.Text type="secondary">{item.desc}</Typography.Text>
                            </Space>
                          </Space>
                          <Button type="link" icon={<ArrowRightOutlined />} onClick={() => navigate({ to: item.to as never })}>
                            {t('customer.reseller.enter')}
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle()}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>{tenant.name}</Typography.Title>
                  <ShopOutlined style={{ color: 'var(--ipx-primary, #315cff)', fontSize: 20 }} />
                </Space>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label={t('customer.reseller.code')}>{tenant.code}</Descriptions.Item>
                  <Descriptions.Item label={t('customer.reseller.stats.customers')}>{stats.customerCount}</Descriptions.Item>
                  <Descriptions.Item label={t('customer.reseller.stats.products')}>
                    {stats.saleableProductCount} / {stats.productCount}
                  </Descriptions.Item>
                </Descriptions>
                <Card className="ipx-reseller-overview-wallet" variant="borderless" style={surfaceCardStyle({ background: '#fafafc', borderRadius: 7 })} styles={{ body: { padding: 12 } }}>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space align="center">
                      <WalletOutlined />
                      <Typography.Text strong>{t('customer.nav.wallet')}</Typography.Text>
                    </Space>
                    {balanceEntries.length === 0 ? (
                      <Typography.Text type="secondary">{t('empty')}</Typography.Text>
                    ) : balanceEntries.map(([currency, amount]) => (
                      <Typography.Text key={currency}>
                        {amount} {currency}
                      </Typography.Text>
                    ))}
                  </Space>
                </Card>
              </Space>
            </Card>
            <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle()}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Typography.Title level={4} style={{ margin: 0 }}>{t('customer.reseller.flow.title')}</Typography.Title>
                <Typography.Text type="secondary">{t('customer.reseller.flow.description')}</Typography.Text>
                <Steps
                  direction="vertical"
                  size="small"
                  current={-1}
                  items={managementEntrypoints.map((item) => ({
                    title: item.step,
                    description: item.title,
                  }))}
                />
              </Space>
            </Card>
            </Space>
          </Col>
        </Row>
      </Space>
    );
  }

  const notCreated = overviewQuery.error instanceof ApiError && overviewQuery.error.reasonKey === 'reseller_not_created';

  return (
    <Space className="ipx-reseller-page ipx-reseller-dashboard-page ipx-reseller-overview-page" direction="vertical" size={12} style={{ width: '100%' }}>
      <PageHeader
        kicker={t('customer.reseller.kicker')}
        title={t('customer.reseller.title')}
        description={t('customer.reseller.description')}
      />
      {!notCreated && overviewQuery.isError && (
        <Alert type="error" message={getBackendReason(overviewQuery.error, t)} showIcon />
      )}
      <Row className="ipx-reseller-dashboard-setup" gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle({ minHeight: '100%' })}>
            <Space direction="vertical" size={18}>
              <ShopOutlined style={{ fontSize: 34, color: 'var(--ipx-primary, #315cff)' }} />
              <Typography.Title level={4} style={{ margin: 0 }}>{t('customer.reseller.workflowTitle')}</Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {t('customer.reseller.workflowDescription')}
              </Typography.Paragraph>
              <Steps
                direction="vertical"
                size="small"
                current={0}
                items={[
                  { title: t('customer.reseller.flow.open') },
                  { title: t('customer.reseller.flow.products') },
                  { title: t('customer.reseller.flow.pricing') },
                  { title: t('customer.reseller.flow.users') },
                ]}
              />
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card className="ipx-reseller-hero ipx-reseller-dashboard-hero ipx-reseller-overview-hero" variant="borderless" style={resellerHeroStyle()}>
            <Typography.Title level={4}>{t('customer.reseller.formTitle')}</Typography.Title>
            {serverError && <Alert type="error" message={serverError} showIcon style={{ marginBottom: 16 }} />}
            {createMutation.isPending && (
              <Alert
                type="info"
                message={t('customer.reseller.createPending')}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="name" label={t('customer.reseller.name')} rules={[{ required: true, message: t('customer.reseller.nameRequired') }]}>
                    <Input placeholder={t('customer.reseller.namePlaceholder')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="code" label={t('customer.reseller.code')} rules={[{ required: true, message: t('customer.reseller.codeRequired') }]}>
                    <Input placeholder={t('customer.reseller.codePlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
              <Button type="primary" htmlType="submit" size="large" loading={createMutation.isPending}>
                {t('customer.reseller.submit')}
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function formatTenantStatus(status: string): string {
  if (status === 'ACTIVE') return '正常';
  if (status === 'DISABLED') return '已停用';
  if (status === 'PENDING') return '处理中';
  return '状态待确认';
}
