import React, { useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { DEFAULT_PRICING_DURATION_DAYS } from './pricing-duration';

interface PriceRule {
  id: string;
  resourceId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
  minQty: number;
  resource?: {
    id: string;
    code: string;
    name: string;
    displayName?: string | null;
    countryCode?: string | null;
    upstreamResourceId?: string | null;
  };
}

interface PriceTemplate {
  id: string;
  name: string;
  price_rules: PriceRule[];
}

interface ResourceDto {
  id: string;
  code: string;
  name: string;
  displayName?: string | null;
  countryCode?: string | null;
  upstreamResourceId?: string | null;
}

interface ResourcePage {
  page: number;
  pageSize: number;
  total: number;
  items: ResourceDto[];
}

interface PriceRuleFormValues {
  resourceId: string;
  unitPrice: string | number;
  currency: string;
  minQty?: number;
}

export function buildPriceRuleBody(values: PriceRuleFormValues) {
  return {
    resourceId: values.resourceId,
    durationDays: DEFAULT_PRICING_DURATION_DAYS,
    unitPrice: String(values.unitPrice),
    currency: values.currency,
    minQty: values.minQty === undefined ? undefined : Number(values.minQty),
  };
}

const RESOURCE_PAGE_SIZE = 20;

function formatTemplateRuleLabel(rule: PriceRule): string {
  if (!rule.resource) return rule.resourceId;
  return formatResourceLocationZh(rule.resource).title;
}

async function fetchTemplateResources(): Promise<{ items: ResourceDto[] }> {
  const items: ResourceDto[] = [];
  let page = 1;
  let total = 0;

  do {
    const data = await apiRequest<ResourcePage>(
      `/api/resources${buildQuery({ page, pageSize: RESOURCE_PAGE_SIZE, status: 'ACTIVE' })}`,
    );
    items.push(...data.items);
    total = data.total;
    if (data.items.length === 0 || items.length >= total) break;
    page += 1;
  } while (page <= 100);

  return { items };
}

export function PriceTemplateFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState<string | null>(null);
  const [createForm] = Form.useForm();
  const [ruleForm] = Form.useForm();

  const query = useQuery({
    queryKey: ['price-templates', page, pageSize],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: PriceTemplate[] }>(
        `/api/pricing/templates${buildQuery({ page, pageSize })}`,
      ),
  });

  const resourcesQuery = useQuery({
    queryKey: ['pricing-resources'],
    queryFn: fetchTemplateResources,
  });

  const createMutation = useMutation({
    mutationFn: (values: { name: string }) =>
      apiRequest('/api/pricing/templates', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      message.success(t('pricing.createSuccess'));
      setCreateOpen(false);
      createForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['price-templates'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: ({ templateId, values }: { templateId: string; values: PriceRuleFormValues }) =>
      apiRequest(`/api/pricing/templates/${templateId}/rules`, {
        method: 'POST',
        body: JSON.stringify(buildPriceRuleBody(values)),
      }),
    onSuccess: () => {
      message.success(t('pricing.addRuleSuccess'));
      setRuleOpen(null);
      ruleForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['price-templates'] });
      void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
      void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
      void qc.invalidateQueries({ queryKey: ['resources'] });
      void qc.invalidateQueries({ queryKey: ['resources-list'] });
      void qc.invalidateQueries({ queryKey: ['resources-countries'] });
      void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
      void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
      void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
    },
  });

  const columns: ColumnsType<PriceTemplate> = [
    { title: t('pricing.templateName'), dataIndex: 'name', key: 'name' },
    {
      title: t('pricing.rules'),
      key: 'rules',
      render: (_: unknown, row: PriceTemplate) => {
        if (row.price_rules.length === 0) {
          return <Typography.Text type="secondary">{t('empty')}</Typography.Text>;
        }
        return (
          <Space wrap>
            {row.price_rules.slice(0, 5).map((rule) => (
              <Tag key={rule.id}>
                {formatTemplateRuleLabel(rule)} / {rule.unitPrice} {rule.currency} / {rule.minQty}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: t('pricing.actions'),
      key: 'actions',
      render: (_: unknown, row: PriceTemplate) => (
        <Button size="small" onClick={() => setRuleOpen(row.id)}>
          {t('pricing.addRule')}
        </Button>
      ),
    },
  ];

  const toolbar = (
    <Space style={{ marginBottom: 16 }}>
      <Button type="primary" onClick={() => setCreateOpen(true)}>
        {t('pricing.createTemplate')}
      </Button>
    </Space>
  );

  const resourceOptions = (resourcesQuery.data?.items ?? []).map((resource) => {
    const location = formatResourceLocationZh(resource);
    return {
      value: resource.id,
      label: location.title,
      searchText: [location.title, resource.code, resource.name, resource.displayName, resource.upstreamResourceId].filter(Boolean).join(' '),
    };
  });

  return (
    <>
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <Modal
        title={t('pricing.createTemplate')}
        open={createOpen}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={createMutation.isPending}
      >
        <Form form={createForm} onFinish={(v) => createMutation.mutate(v)} layout="vertical">
          <Form.Item name="name" label={t('pricing.templateName')} rules={[{ required: true, message: t('pricing.templateNameRequired') }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('pricing.ruleModal.title')}
        open={!!ruleOpen}
        onOk={() => ruleForm.submit()}
        onCancel={() => setRuleOpen(null)}
        confirmLoading={addRuleMutation.isPending}
      >
        <Form
          form={ruleForm}
          onFinish={(values: PriceRuleFormValues) => ruleOpen && addRuleMutation.mutate({ templateId: ruleOpen, values })}
          layout="vertical"
          initialValues={{ minQty: 1, currency: 'CNY' }}
        >
          <Form.Item name="resourceId" label={t('pricing.ruleModal.resource')} rules={[{ required: true }]}>
            <Select
              options={resourceOptions}
              loading={resourcesQuery.isLoading}
              showSearch
              optionFilterProp="searchText"
            />
          </Form.Item>
          <Form.Item name="unitPrice" label={t('pricing.ruleModal.unitPrice')} rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label={t('pricing.ruleModal.currency')} rules={[{ required: true }]}>
            <Select options={[{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]} />
          </Form.Item>
          <Form.Item name="minQty" label={t('pricing.ruleModal.minQty')} rules={[{ type: 'number', min: 1 }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
