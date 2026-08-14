import React from 'react';
import { Alert, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, PlusOutlined, ReloadOutlined, ShopOutlined, TagsOutlined, TeamOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { buildQuery, userApiRequest } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { getBackendReason, resellerHeroStyle, resellerIconStyle, resellerMetricBodyStyle, resellerMetricToneStyle, resellerSummaryStripStyle, resellerToolbarStyle, resellerWorkspaceHeaderStyle } from './reseller-ui';

interface PriceRule {
  id: string;
  skuId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
  sku?: { id: string; code: string; name: string; description?: string | null };
}

interface PriceTemplate {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  sku_price_rules: PriceRule[];
}

interface SkuDto {
  skuId: string;
  code: string;
  name: string;
  description?: string | null;
  unitPrice: string | null;
  currency: string | null;
  enabled: boolean;
}

interface CreateTemplateValues {
  name: string;
  description?: string;
  isDefault?: boolean;
}

interface RuleValues {
  skuIds: string[];
  unitPrice: string | number;
}

export function ResellerPricingFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [ruleTemplate, setRuleTemplate] = React.useState<PriceTemplate | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [createForm] = Form.useForm<CreateTemplateValues>();
  const [ruleForm] = Form.useForm<RuleValues>();

  const query = useQuery({
    queryKey: ['customer-reseller-templates', page, pageSize],
    queryFn: () => userApiRequest<{ page: number; pageSize: number; total: number; items: PriceTemplate[] }>(
      `/api/customer/reseller/templates${buildQuery({ page, pageSize })}`,
    ),
  });

  const resourcesQuery = useQuery({
    queryKey: ['customer-reseller-price-resources'],
    queryFn: () => userApiRequest<{ items: SkuDto[] }>('/api/customer/reseller/products?page=1&pageSize=20&status=ENABLED'),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateTemplateValues) =>
      userApiRequest('/api/customer/reseller/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description?.trim() || null,
          isDefault: values.isDefault ?? true,
        }),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.pricing.createSuccess'));
      setActionError(null);
      setCreateOpen(false);
      createForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['customer-reseller-templates'] });
      void qc.invalidateQueries({ queryKey: ['customer-reseller-overview'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const rulesMutation = useMutation({
    mutationFn: ({ templateId, values }: { templateId: string; values: RuleValues }) =>
      userApiRequest(`/api/customer/reseller/templates/${encodeURIComponent(templateId)}/rules`, {
        method: 'POST',
        body: JSON.stringify({
          rules: values.skuIds.map((skuId) => {
            const sku = (resourcesQuery.data?.items ?? []).find((item) => item.skuId === skuId);
            if (!sku?.currency) throw new Error(t('customer.reseller.pricing.resourceCurrencyMissing'));
            if (!values.unitPrice || Number(values.unitPrice) <= 0) throw new Error(t('customer.reseller.pricing.unitPriceRequired'));
            return {
              skuId,
              durationDays: 30,
              unitPrice: String(values.unitPrice),
              currency: sku.currency,
              minQty: 1,
            };
          }),
        }),
      }),
    onSuccess: () => {
      message.success(t('customer.reseller.pricing.ruleSuccess'));
      setActionError(null);
      setRuleTemplate(null);
      ruleForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['customer-reseller-templates'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const columns: ColumnsType<PriceTemplate> = [
    {
      title: t('customer.reseller.pricing.templateName'),
      dataIndex: 'name',
      key: 'name',
      render: (value: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          {row.isDefault && <Tag color="green">{t('customer.reseller.pricing.defaultTemplate')}</Tag>}
          {row.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.description}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: t('customer.reseller.pricing.rules'),
      key: 'rules',
      render: (_: unknown, row) => row.sku_price_rules.length === 0
        ? <Typography.Text type="secondary">{t('empty')}</Typography.Text>
        : (
          <Space direction="vertical" size={4}>
            {row.sku_price_rules.slice(0, 8).map((rule) => (
              <Space key={rule.id} size={6} wrap>
                <Tag color="geekblue">{t('customer.reseller.products.mainSite')}</Tag>
                <Typography.Text>
                  {formatResellerRuleSku(rule)}
                </Typography.Text>
                <Typography.Text strong>{formatRulePrice(rule, t)}</Typography.Text>
              </Space>
            ))}
            {row.sku_price_rules.length > 8 && (
              <Typography.Text type="secondary">{t('customer.reseller.pricing.moreRules', { count: row.sku_price_rules.length - 8 })}</Typography.Text>
            )}
          </Space>
        ),
    },
    {
      title: t('customer.reseller.pricing.actions'),
      key: 'actions',
      render: (_: unknown, row) => <Button size="small" onClick={() => setRuleTemplate(row)}>{t('customer.reseller.pricing.configureRules')}</Button>,
    },
  ];

  const templates = query.data?.items ?? [];
  const ruleCount = templates.reduce((sum, item) => sum + item.sku_price_rules.length, 0);
  const enabledSkus = (resourcesQuery.data?.items ?? []).filter((sku) => sku.enabled);
  const defaultTemplateCount = templates.filter((item) => item.isDefault).length;

  const resourceOptions = enabledSkus.map((sku) => {
    return {
      value: sku.skuId,
      label: `${sku.code} / ${sku.name} / ${sku.unitPrice ?? '-'} ${sku.currency ?? ''}`,
      searchText: [sku.code, sku.name, sku.description].filter(Boolean).join(' '),
    };
  });
  const resourcePoolError = resourcesQuery.isError ? getBackendReason(resourcesQuery.error, t) : null;
  const templatesEmpty = query.data && templates.length === 0;

  return (
    <div className="ipx-reseller-page ipx-reseller-pricing-page">
      <PageHeader
        kicker={t('customer.reseller.kicker')}
        title={t('customer.reseller.pricing.title')}
        description={t('customer.reseller.pricing.description')}
      />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card className="ipx-reseller-hero ipx-reseller-pricing-hero ipx-reseller-management-hero" variant="borderless" style={resellerHeroStyle()}>
        <Space align="start" size={14} style={resellerWorkspaceHeaderStyle}>
          <Space align="start" size={14}>
            <span className="ipx-reseller-management-icon" style={resellerIconStyle}><TagsOutlined /></span>
            <Space direction="vertical" size={4}>
              <Typography.Text strong>{t('customer.reseller.pricing.workspaceTitle')}</Typography.Text>
              <Typography.Text type="secondary">{t('customer.reseller.pricing.workspaceDesc')}</Typography.Text>
              <Space size={6} wrap>
                <Tag color="geekblue">{t('customer.reseller.pricing.productPoolSource')}</Tag>
                <Tag color="blue">{t('customer.reseller.pricing.customerScope')}</Tag>
              </Space>
            </Space>
          </Space>
          <Space wrap>
            <Button icon={<ShopOutlined />} onClick={() => navigate({ to: '/reseller/products' as never })}>
              {t('customer.reseller.cards.products')}
            </Button>
            <Button icon={<TeamOutlined />} onClick={() => navigate({ to: '/reseller/users' as never })}>
              {t('customer.reseller.cards.users')}
            </Button>
          </Space>
        </Space>
      </Card>
      <div style={resellerSummaryStripStyle}>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-pricing-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#8b5cf6')} styles={resellerMetricBodyStyle}>
            <Statistic title={t('customer.reseller.pricing.metrics.templates')} value={query.data?.total ?? '-'} prefix={<TagsOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-pricing-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#f59e0b')} styles={resellerMetricBodyStyle}>
            <Statistic title={t('customer.reseller.pricing.metrics.rules')} value={query.data ? ruleCount : '-'} prefix={<UnorderedListOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="ipx-reseller-metric-card ipx-reseller-pricing-metric-card ipx-reseller-management-metric-card" variant="borderless" style={resellerMetricToneStyle('#16a34a')} styles={resellerMetricBodyStyle}>
            <Statistic title={t('customer.reseller.pricing.metrics.resources')} value={resourcesQuery.data ? enabledSkus.length : '-'} prefix={<AppstoreOutlined />} />
          </Card>
        </Col>
      </Row>
      </div>
      {(query.isFetching && !query.isLoading) || (resourcesQuery.isFetching && !resourcesQuery.isLoading) ? (
        <Alert type="info" showIcon message={t('customer.reseller.pricing.refreshing')} />
      ) : null}
      {(createMutation.isPending || rulesMutation.isPending) && (
        <Alert type="warning" showIcon message={t('customer.reseller.pricing.savePending')} />
      )}
      {actionError && <Alert type="error" message={t('error')} description={actionError} showIcon closable onClose={() => setActionError(null)} />}
      {templatesEmpty && (
        <Alert
          type="warning"
          showIcon
          message={t('customer.reseller.pricing.empty')}
          description={t('customer.reseller.pricing.emptyDesc')}
        />
      )}
      {resourcesQuery.isError && (
        <Alert
          type="error"
          message={resourcePoolError}
          description={t('customer.reseller.pricing.productPoolError')}
          showIcon
        />
      )}
      {!resourcesQuery.isError && !resourcesQuery.isLoading && enabledSkus.length === 0 && (
        <Alert
          type="warning"
          message={t('customer.reseller.pricing.noEnabledProducts')}
          description={t('customer.reseller.pricing.noEnabledProductsDesc')}
          showIcon
        />
      )}
      <Alert
        type="info"
        showIcon
        message={t('customer.reseller.pricing.sourceTruth')}
      />
      <div className="ipx-reseller-table-card ipx-reseller-pricing-table-card">
        <ListPage
          query={query}
          columns={columns}
          rowKey="id"
          emptyText={t('customer.reseller.pricing.empty')}
          errorDescription={(error) => getBackendReason(error, t)}
          toolbar={(
            <div className="ipx-reseller-toolbar ipx-reseller-pricing-toolbar ipx-reseller-management-toolbar" style={resellerToolbarStyle}>
              <Typography.Text type="secondary">{t('customer.reseller.pricing.toolbarHint')}</Typography.Text>
              <Space size={8} wrap>
                <Tag color="blue">{t('customer.reseller.pricing.summary.total', { total: query.data?.total ?? 0 })}</Tag>
                <Tag color="geekblue">{t('customer.reseller.pricing.summary.source')}</Tag>
                <Tag>{t('customer.reseller.pricing.summary.currentPage', { count: templates.length })}</Tag>
                <Tag color="geekblue">{t('customer.reseller.pricing.summary.resources', { count: enabledSkus.length })}</Tag>
                <Tag color={ruleCount > 0 ? 'green' : undefined}>{t('customer.reseller.pricing.summary.rules', { count: ruleCount })}</Tag>
                <Tag color={defaultTemplateCount > 0 ? 'blue' : 'orange'}>{t('customer.reseller.pricing.summary.defaultTemplates', { count: defaultTemplateCount })}</Tag>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    void query.refetch();
                    void resourcesQuery.refetch();
                  }}
                  loading={query.isFetching || resourcesQuery.isFetching}
                >
                  {t('refresh')}
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} loading={createMutation.isPending}>
                  {t('customer.reseller.pricing.createTemplate')}
                </Button>
              </Space>
            </div>
          )}
          pagination={{
            page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </div>
      <Drawer
        className="ipx-reseller-drawer ipx-reseller-pricing-drawer"
        title={t('customer.reseller.pricing.createTemplate')}
        open={createOpen}
        onClose={() => {
          setActionError(null);
          setCreateOpen(false);
        }}
        width={460}
        destroyOnClose
      >
        {createMutation.isPending && (
          <Alert type="info" showIcon message={t('customer.reseller.pricing.createPending')} style={{ marginBottom: 16 }} />
        )}
        <Form form={createForm} layout="vertical" initialValues={{ isDefault: true }} onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="name" label={t('customer.reseller.pricing.templateName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('customer.reseller.pricing.descriptionLabel')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={createMutation.isPending}>{t('submit')}</Button>
          </Space>
        </Form>
      </Drawer>
      <Drawer
        className="ipx-reseller-drawer ipx-reseller-pricing-drawer"
        title={ruleTemplate ? t('customer.reseller.pricing.ruleTitle', { name: ruleTemplate.name }) : t('customer.reseller.pricing.configureRules')}
        open={!!ruleTemplate}
        onClose={() => {
          setActionError(null);
          setRuleTemplate(null);
        }}
        width={620}
        destroyOnClose
      >
        {rulesMutation.isPending && (
          <Alert type="info" showIcon message={t('customer.reseller.pricing.rulesPending')} style={{ marginBottom: 16 }} />
        )}
        {resourcesQuery.isError && (
          <Alert
            type="error"
            message={resourcePoolError}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        {!resourcesQuery.isError && !resourcesQuery.isLoading && resourceOptions.length === 0 && (
          <Alert
            type="warning"
            message={t('customer.reseller.pricing.noEnabledProducts')}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={ruleForm}
          layout="vertical"
          onFinish={(values) => ruleTemplate && rulesMutation.mutate({ templateId: ruleTemplate.id, values })}
        >
          <Form.Item name="skuIds" label={t('customer.reseller.pricing.resources')} rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={resourceOptions}
              loading={resourcesQuery.isLoading}
              showSearch
              optionFilterProp="searchText"
              notFoundContent={resourcePoolError ?? t('empty')}
            />
          </Form.Item>
          <Form.Item
            name="unitPrice"
            label={t('customer.reseller.pricing.unitPrice30')}
            rules={[
              { required: true, message: t('customer.reseller.pricing.unitPriceRequired') },
              {
                validator: (_, value) => (Number(value) > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('customer.reseller.pricing.unitPriceRequired')))),
              },
            ]}
          >
            <InputNumber precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setRuleTemplate(null)}>{t('cancel')}</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={rulesMutation.isPending}
              disabled={resourcesQuery.isLoading || resourcesQuery.isError || resourceOptions.length === 0}
            >
              {t('submit')}
            </Button>
          </Space>
        </Form>
      </Drawer>
      </Space>
    </div>
  );
}

function formatResellerRuleSku(rule: PriceRule): string {
  if (!rule.sku) return rule.skuId;
  return `${rule.sku.code} / ${rule.sku.name}`;
}

function formatRulePrice(rule: PriceRule, t: (key: string, values?: Record<string, unknown>) => string): string {
  return `${rule.unitPrice} ${rule.currency} / ${t('customer.reseller.orders.durationValue', { days: rule.durationDays })}`;
}
