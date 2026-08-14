import React from 'react';
import { Alert, Button, Card, Col, Form, Input, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloudSyncOutlined, DeleteOutlined, LinkOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { userApiRequest } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { formatDateTime } from '../../shared/time/time';
import { getBackendReason, resellerHeroStyle } from './reseller-ui';

type FederatedUpstreamKind = 'PLATFORM_365' | 'NINE_EIGHT_FIVE' | 'IPIPD';

interface FederatedConnectionFormValues {
  kind: FederatedUpstreamKind;
  name: string;
  baseUrl: string;
  apiKey?: string;
  zoneId?: string;
  appId?: string;
  appSecret?: string;
}

interface FederatedConnection {
  id: string;
  kind: FederatedUpstreamKind;
  name: string;
  baseUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  timeoutMs: number;
  credentialConfigured: boolean;
  credentialFingerprint: string;
  lastScan: {
    status: 'SUCCESS' | 'FAILED';
    capturedAt: string;
    expiresAt: string;
    errorCode: string | null;
    balanceAmount: string | null;
    balanceUnit: string | null;
    inventoryCount: number;
    priceCount: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface FederatedConnectionList {
  page: number;
  pageSize: number;
  total: number;
  items: FederatedConnection[];
}

export function buildFederatedConnectionBody(values: FederatedConnectionFormValues) {
  const kind = values.kind;
  const credentials = kind === 'IPIPD'
    ? { appId: values.appId?.trim() ?? '', appSecret: values.appSecret?.trim() ?? '' }
    : {
      apiKey: values.apiKey?.trim() ?? '',
      ...(kind === 'NINE_EIGHT_FIVE' && values.zoneId?.trim() ? { zoneId: values.zoneId.trim() } : {}),
    };
  return {
    kind,
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    credentials,
  };
}

export function ResellerUpstreamConnectionsFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm<FederatedConnectionFormValues>();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const kind = Form.useWatch('kind', form) ?? 'PLATFORM_365';

  const query = useQuery({
    queryKey: ['customer-reseller-upstream-connections'],
    queryFn: () => userApiRequest<FederatedConnectionList>('/api/customer/reseller/upstream-connections?page=1&pageSize=20'),
  });

  const createMutation = useMutation({
    mutationFn: (values: FederatedConnectionFormValues) => userApiRequest('/api/customer/reseller/upstream-connections', {
      method: 'POST',
      body: JSON.stringify(buildFederatedConnectionBody(values)),
    }),
    onSuccess: () => {
      message.success(t('customer.reseller.upstreams.saveSuccess'));
      setActionError(null);
      form.resetFields();
      form.setFieldValue('kind', 'PLATFORM_365');
      void qc.invalidateQueries({ queryKey: ['customer-reseller-upstream-connections'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const scanMutation = useMutation({
    mutationFn: (id: string) => userApiRequest(`/api/customer/reseller/upstream-connections/${encodeURIComponent(id)}/scan`, { method: 'POST' }),
    onSuccess: () => {
      message.success(t('customer.reseller.upstreams.scanSuccess'));
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['customer-reseller-upstream-connections'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => userApiRequest(`/api/customer/reseller/upstream-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      message.success(t('customer.reseller.upstreams.disableSuccess'));
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['customer-reseller-upstream-connections'] });
    },
    onError: (error) => setActionError(getBackendReason(error, t)),
  });

  const columns: ColumnsType<FederatedConnection> = [
    {
      title: t('customer.reseller.upstreams.connection'),
      key: 'connection',
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.baseUrl }}>{row.baseUrl}</Typography.Text>
          <Space size={6} wrap>
            <Tag color="blue">{formatKind(t, row.kind)}</Tag>
            <Tag color={row.status === 'ACTIVE' ? 'green' : 'default'}>{row.status}</Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: t('customer.reseller.upstreams.credential'),
      key: 'credential',
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Tag icon={<SafetyCertificateOutlined />} color={row.credentialConfigured ? 'green' : 'red'}>
            {row.credentialConfigured ? t('customer.reseller.upstreams.configured') : t('customer.reseller.upstreams.notConfigured')}
          </Tag>
          <Typography.Text type="secondary" code>{row.credentialFingerprint.slice(0, 12)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.reseller.upstreams.lastScan'),
      key: 'lastScan',
      width: 210,
      render: (_value, row) => row.lastScan ? (
        <Space direction="vertical" size={2}>
          <Tag color={row.lastScan.status === 'SUCCESS' ? 'green' : 'red'}>{row.lastScan.status}</Tag>
          <Typography.Text type="secondary">{formatDateTime(row.lastScan.capturedAt)}</Typography.Text>
          {row.lastScan.status === 'SUCCESS' && (
            <>
              <Typography.Text>
                {row.lastScan.balanceAmount === null
                  ? t('customer.reseller.upstreams.balanceUnavailable')
                  : t('customer.reseller.upstreams.balance', {
                    amount: row.lastScan.balanceAmount,
                    unit: row.lastScan.balanceUnit ?? '',
                  })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('customer.reseller.upstreams.scanCounts', {
                  inventory: row.lastScan.inventoryCount,
                  prices: row.lastScan.priceCount,
                })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('customer.reseller.upstreams.scanExpires', { time: formatDateTime(row.lastScan.expiresAt) })}
              </Typography.Text>
            </>
          )}
          {row.lastScan.errorCode && <Typography.Text type="danger">{row.lastScan.errorCode}</Typography.Text>}
        </Space>
      ) : <Typography.Text type="secondary">{t('customer.reseller.upstreams.notScanned')}</Typography.Text>,
    },
    {
      title: t('customer.reseller.upstreams.actions'),
      key: 'actions',
      width: 190,
      render: (_value, row) => (
        <Space wrap>
          <Button
            icon={<CloudSyncOutlined />}
            disabled={row.status !== 'ACTIVE'}
            loading={scanMutation.isPending && scanMutation.variables === row.id}
            onClick={() => scanMutation.mutate(row.id)}
          >
            {t('customer.reseller.upstreams.scan')}
          </Button>
          {row.status === 'ACTIVE' && (
            <Popconfirm
              title={t('customer.reseller.upstreams.disableConfirm')}
              onConfirm={() => disableMutation.mutate(row.id)}
            >
              <Button danger icon={<DeleteOutlined />} aria-label={t('customer.reseller.upstreams.disable')} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space className="ipx-reseller-page" direction="vertical" size={12} style={{ width: '100%' }}>
      <PageHeader
        kicker={t('customer.reseller.kicker')}
        title={t('customer.reseller.upstreams.title')}
        description={t('customer.reseller.upstreams.description')}
      />
      <Alert type="info" showIcon message={t('customer.reseller.upstreams.sourceTruth')} />
      {actionError && <Alert type="error" showIcon message={actionError} closable onClose={() => setActionError(null)} />}
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={8}>
          <Card variant="borderless" style={resellerHeroStyle()}>
            <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
              <Typography.Title level={4} style={{ margin: 0 }}>{t('customer.reseller.upstreams.formTitle')}</Typography.Title>
              <Typography.Text type="secondary">{t('customer.reseller.upstreams.formDescription')}</Typography.Text>
            </Space>
            <Form<FederatedConnectionFormValues>
              form={form}
              layout="vertical"
              initialValues={{ kind: 'PLATFORM_365' }}
              onFinish={(values) => createMutation.mutate(values)}
            >
              <Form.Item name="kind" label={t('customer.reseller.upstreams.kind')} rules={[{ required: true }]}>
                <Select options={[
                  { value: 'PLATFORM_365', label: t('customer.reseller.upstreams.kind365') },
                  { value: 'NINE_EIGHT_FIVE', label: t('customer.reseller.upstreams.kind985') },
                  { value: 'IPIPD', label: t('customer.reseller.upstreams.kindIpipd') },
                ]} />
              </Form.Item>
              <Form.Item name="name" label={t('customer.reseller.upstreams.name')} rules={[{ required: true, message: t('customer.reseller.upstreams.nameRequired') }]}>
                <Input autoComplete="organization" prefix={<LinkOutlined />} />
              </Form.Item>
              <Form.Item name="baseUrl" label={t('customer.reseller.upstreams.baseUrl')} rules={[{ required: true, type: 'url', message: t('customer.reseller.upstreams.baseUrlInvalid') }]}>
                <Input type="url" inputMode="url" autoComplete="url" placeholder="https://" />
              </Form.Item>
              {kind === 'IPIPD' ? (
                <>
                  <Form.Item name="appId" label={t('customer.reseller.upstreams.appId')} rules={[{ required: true }]}>
                    <Input autoComplete="off" />
                  </Form.Item>
                  <Form.Item name="appSecret" label={t('customer.reseller.upstreams.appSecret')} rules={[{ required: true }]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item name="apiKey" label={t('customer.reseller.upstreams.apiKey')} rules={[{ required: true }]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  {kind === 'NINE_EIGHT_FIVE' && (
                    <Form.Item name="zoneId" label={t('customer.reseller.upstreams.zoneId')}>
                      <Input autoComplete="off" />
                    </Form.Item>
                  )}
                </>
              )}
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={createMutation.isPending}>
                {t('customer.reseller.upstreams.save')}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={16}>
          <Card variant="borderless" style={resellerHeroStyle()}>
            <Table<FederatedConnection>
              rowKey="id"
              columns={columns}
              dataSource={query.data?.items ?? []}
              loading={query.isLoading}
              pagination={false}
              scroll={{ x: 880 }}
              locale={{ emptyText: query.isError ? getBackendReason(query.error, t) : t('customer.reseller.upstreams.empty') }}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function formatKind(t: (key: string) => string, kind: FederatedUpstreamKind): string {
  if (kind === 'PLATFORM_365') return t('customer.reseller.upstreams.kind365');
  if (kind === 'NINE_EIGHT_FIVE') return t('customer.reseller.upstreams.kind985');
  return t('customer.reseller.upstreams.kindIpipd');
}
