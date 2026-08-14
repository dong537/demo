import React from 'react';
import { Alert, Button, Form, InputNumber, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DollarOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';

type DedicatedSkuPriceRule = { id: string; durationDays: number; minQty: number; unitPrice: string; currency: string };
export type DedicatedSkuPricingItem = {
  skuId: string;
  code: string;
  name: string;
  description: string | null;
  templateRules: DedicatedSkuPriceRule[];
  globalOverrides: DedicatedSkuPriceRule[];
};

type DedicatedSkuPricingResponse = { templateId: string | null; items: DedicatedSkuPricingItem[] };

export function buildDedicatedSkuPriceBody(values: {
  skuId: string;
  durationDays: number;
  minQty?: number;
  unitPrice: number | string;
  currency: string;
}) {
  return {
    skuId: values.skuId,
    durationDays: Number(values.durationDays),
    minQty: values.minQty === undefined ? 1 : Number(values.minQty),
    unitPrice: String(values.unitPrice),
    currency: values.currency,
  };
}

export function DedicatedSkuPricingFeature() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<DedicatedSkuPricingItem | null>(null);
  const [form] = Form.useForm<{ unitPrice: number | string }>();
  const query = useQuery({
    queryKey: ['dedicated-sku-pricing'],
    queryFn: () => apiRequest<DedicatedSkuPricingResponse>('/api/pricing/dedicated-skus'),
  });
  const save = useMutation({
    mutationFn: (values: { unitPrice: number | string }) => apiRequest('/api/pricing/dedicated-skus/overrides', {
      method: 'POST',
      body: JSON.stringify(buildDedicatedSkuPriceBody({
        skuId: editing!.skuId,
        durationDays: 30,
        minQty: 1,
        unitPrice: values.unitPrice,
        currency: 'CNY',
      })),
    }),
    onSuccess: () => {
      message.success(t('pricing.dedicatedSku.saveSuccess'));
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['dedicated-sku-pricing'] });
    },
  });

  const columns: ColumnsType<DedicatedSkuPricingItem> = [
    { title: t('pricing.dedicatedSku.code'), dataIndex: 'code', key: 'code', width: 100, render: (value) => <Tag color="blue">{value}</Tag> },
    { title: t('pricing.dedicatedSku.product'), key: 'product', render: (_, row) => <Space direction="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.description ?? '-'}</Typography.Text></Space> },
    { title: t('pricing.dedicatedSku.templatePrice'), key: 'template', render: (_, row) => formatRule(row.templateRules[0]) },
    { title: t('pricing.dedicatedSku.globalOverride'), key: 'override', render: (_, row) => formatRule(row.globalOverrides[0]) },
    { title: t('pricing.dedicatedSku.actions'), key: 'actions', width: 150, render: (_, row) => <Button icon={<SaveOutlined />} onClick={() => { setEditing(row); form.setFieldsValue({ unitPrice: row.globalOverrides[0]?.unitPrice ?? row.templateRules[0]?.unitPrice ?? '' }); }}>{t('pricing.dedicatedSku.editGlobal')}</Button> },
  ];

  return (
    <div className="ipx-pricing-page">
      <PageHeader kicker={t('pricing.dedicatedSku.kicker')} title={t('pricing.dedicatedSku.title')} description={t('pricing.dedicatedSku.description')} />
      {query.error && <Alert type="error" showIcon message={t('pricing.dedicatedSku.loadFailed')} description={query.error instanceof Error ? query.error.message : undefined} />}
      <div style={{ marginTop: 16, background: '#fff', ...surfaceCardStyle() }}>
        <Table rowKey="skuId" loading={query.isLoading} columns={columns} dataSource={query.data?.items ?? []} pagination={false} locale={{ emptyText: t('pricing.dedicatedSku.empty') }} />
      </div>
      <Modal title={t('pricing.dedicatedSku.editTitle', { code: editing?.code ?? '' })} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="unitPrice" label={t('pricing.dedicatedSku.unitPrice')} rules={[{ required: true, type: 'number', min: 0 }]}>
            <InputNumber aria-label={t('pricing.dedicatedSku.unitPrice')} prefix={<DollarOutlined />} min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">{t('pricing.dedicatedSku.currencyHint')}</Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}

function formatRule(rule: DedicatedSkuPriceRule | undefined): React.ReactNode {
  return rule ? `${rule.unitPrice} ${rule.currency} / ${rule.durationDays}d` : <Typography.Text type="secondary">-</Typography.Text>;
}
