import React, { useState } from 'react';
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, CopyOutlined, KeyOutlined, LockOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Segmented, Skeleton, Space, Statistic, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { ListPage } from '../../shared/ui/list-page';
import { PageHeader } from '../../shared/ui/page-header';
import { formatDateTime } from '../../shared/time/time';

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ipWhitelist: string[];
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface CreateApiKeyResult extends ApiKeyListItem {
  plainKey?: string;
}

type ApiKeyPurpose = 'RESIDENTIAL' | 'DEDICATED';

interface CreateApiKeyFormValues {
  name: string;
  purpose: ApiKeyPurpose;
}

export function buildApiKeyListPath(page: number, pageSize: number): string {
  return `/api/api-keys${buildQuery({ page, pageSize })}`;
}

export function buildCreateApiKeyBody(input: {
  tenantId: string;
  name: string;
  purpose?: ApiKeyPurpose;
}) {
  return {
    tenantId: input.tenantId,
    name: input.name.trim(),
    scopes: [input.purpose === 'RESIDENTIAL' ? 'res_static:*' : 'dedicated:*'],
    ipWhitelist: [],
  };
}

export function buildRevokeApiKeyPath(id: string): string {
  return `/api/api-keys/${encodeURIComponent(id)}`;
}

export function apiKeyStatusColor(status: string): string {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REVOKED' || status === 'DISABLED' || status === 'INACTIVE') return 'default';
  return 'processing';
}

function formatApiKeyStatus(t: (key: string, options?: Record<string, unknown>) => string, status: string): string {
  const key = `customer.apiKeys.statusValue.${status}`;
  const label = t(key);
  return label === key ? t('customer.apiKeys.statusUnknown') : label;
}

export function CustomerApiKeyListFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form] = Form.useForm<CreateApiKeyFormValues>();
  const keyPurpose = Form.useWatch('purpose', form) ?? 'DEDICATED';

  const currentQuery = useCurrentCustomer();
  const tenantId = currentQuery.data?.tenantId ?? '';

  const query = useQuery({
    queryKey: ['api-keys', tenantId, page, pageSize],
    queryFn: () =>
      userApiRequest<{ page: number; pageSize: number; total: number; items: ApiKeyListItem[] }>(
        buildApiKeyListPath(page, pageSize),
      ),
    enabled: !!tenantId,
  });

  const apiKeys = query.data?.items ?? [];
  const isInitialLoading = currentQuery.isLoading || query.isLoading || (Boolean(tenantId) && !query.data && query.isFetching);
  const hasListError = currentQuery.isError || query.isError;
  const missingTenantContext = !currentQuery.isLoading && !currentQuery.isError && !tenantId;
  const createDisabled = currentQuery.isError || missingTenantContext;
  const activeCount = apiKeys.filter((item) => item.status === 'ACTIVE').length;
  const inactiveCount = apiKeys.filter((item) => item.status !== 'ACTIVE').length;
  const metricPlaceholder = isInitialLoading || hasListError ? '-' : undefined;
  const totalCount = metricPlaceholder ?? query.data?.total ?? apiKeys.length;
  const recentlyUsedCount = metricPlaceholder ?? apiKeys.filter((item) => Boolean(item.lastUsedAt)).length;
  const activeMetric = metricPlaceholder ?? activeCount;
  const inactiveMetric = metricPlaceholder ?? inactiveCount;
  const currentPageCount = apiKeys.length;
  const tableScopeSummary = isInitialLoading || hasListError
    ? t('customer.apiKeys.tableScopeUnavailable')
    : t('customer.apiKeys.tableScopeSummary', { count: currentPageCount, total: query.data?.total ?? currentPageCount });
  const statusSegments = [
    { status: 'ACTIVE', count: activeCount, displayCount: metricPlaceholder ?? activeCount },
    { status: 'INACTIVE', count: inactiveCount, displayCount: metricPlaceholder ?? inactiveCount },
  ];
  const emptyState = (
    <Space direction="vertical" size={4}>
      <Typography.Text strong>{t('customer.apiKeys.emptyState.title')}</Typography.Text>
      <Typography.Text type="secondary">{t('customer.apiKeys.emptyState.description')}</Typography.Text>
      <Space size={8} wrap>
        <Button size="small" icon={<ReloadOutlined />} loading={query.isFetching} disabled={!tenantId} onClick={() => void query.refetch()}>
          {t('refresh')}
        </Button>
        <Button size="small" type="primary" disabled={createDisabled} onClick={() => setCreateOpen(true)}>
          {t('customer.apiKeys.emptyState.action')}
        </Button>
      </Space>
    </Space>
  );

  const createMutation = useMutation({
    mutationFn: (values: CreateApiKeyFormValues) => {
      if (!tenantId) {
        throw new ApiError('PERMISSION_DENIED', 'insufficient_permissions');
      }
      if (!values.name?.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'api_key_name_required');
      }
      return userApiRequest<CreateApiKeyResult>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify(buildCreateApiKeyBody({ tenantId, name: values.name, purpose: values.purpose })),
      });
    },
    onSuccess: (result) => {
      setActionError(null);
      setCreateOpen(false);
      form.resetFields();
      message.success(t('customer.apiKeys.createSuccess', { name: result.name }));
      if (result.plainKey) setPlainKey(result.plainKey);
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error) => {
      setActionError(formatApiKeyReason(t, error));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      userApiRequest<void>(buildRevokeApiKeyPath(id), { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      setActionError(null);
      message.success(t('customer.apiKeys.revokeSuccess', { id }));
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error) => {
      setActionError(formatApiKeyReason(t, error));
    },
  });

  const columns: ColumnsType<ApiKeyListItem> = [
    {
      title: t('customer.apiKeys.name'),
      dataIndex: 'name',
      key: 'name',
      width: 280,
      render: (name: string, row) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Typography.Text strong>{name}</Typography.Text>
            <Tag className="ipx-api-key-id-tag">{t('customer.apiKeys.keyId', { id: row.id })}</Tag>
          </Space>
          <Typography.Text type="secondary">
            {row.lastUsedAt
              ? t('customer.apiKeys.lastUsedInline', { time: formatDateTime(row.lastUsedAt) })
              : t('customer.apiKeys.neverUsedInline')}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('customer.apiKeys.keyPrefix'),
      dataIndex: 'keyPrefix',
      key: 'keyPrefix',
      width: 160,
      render: (keyPrefix: string) => (
        <Typography.Text code className="ipx-api-key-prefix">
          {keyPrefix}
        </Typography.Text>
      ),
    },
    {
      title: t('customer.apiKeys.scopes'),
      dataIndex: 'scopes',
      key: 'scopes',
      width: 260,
      render: (scopes: string[]) => (
        <Space direction="vertical" size={4}>
          <Typography.Text type="secondary" className="ipx-api-key-scope-caption">
            {t('customer.apiKeys.scopeSummaryLabel')}
          </Typography.Text>
          <Space size={[4, 4]} wrap>
          {scopes.length > 0
            ? scopes.map((scope) => (
              <Tag key={scope} color="blue">
                {formatApiScope(t, scope)}
              </Tag>
            ))
            : <Typography.Text type="secondary">{t('customer.apiKeys.noScopes')}</Typography.Text>}
          </Space>
        </Space>
      ),
    },
    {
      title: t('customer.apiKeys.lifecycle'),
      key: 'lifecycle',
      width: 230,
      render: (_: unknown, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={apiKeyStatusColor(row.status)}>
            {formatApiKeyStatus(t, row.status)}
          </Tag>
          <Typography.Text type="secondary">
            <ClockCircleOutlined /> {t('customer.apiKeys.createdInline', { time: formatDateTime(row.createdAt) })}
          </Typography.Text>
          {row.lastUsedAt
            ? (
              <Typography.Text type="secondary">
                {t('customer.apiKeys.lastUsedInline', { time: formatDateTime(row.lastUsedAt) })}
              </Typography.Text>
            )
            : <Tag>{t('customer.apiKeys.never')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('customer.apiKeys.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, row: ApiKeyListItem) => (
        <Popconfirm
          title={t('customer.apiKeys.revokeConfirm')}
          okButtonProps={{ danger: true }}
          okText={t('customer.apiKeys.revoke')}
          cancelText={t('cancel')}
          onConfirm={() => revokeMutation.mutate(row.id)}
          disabled={row.status !== 'ACTIVE'}
        >
            <Button size="small" danger disabled={row.status !== 'ACTIVE' || revokeMutation.isPending} loading={revokeMutation.isPending}>
              {t('customer.apiKeys.revoke')}
            </Button>
        </Popconfirm>
      ),
    },
  ];

  const toolbar = (
    <div className="ipx-list-toolbar ipx-api-key-toolbar ipx-customer-toolbar">
      <Space direction="vertical" size={2}>
        <Typography.Text strong>{t('customer.apiKeys.tableTitle')}</Typography.Text>
        <Typography.Text type="secondary">{tableScopeSummary}</Typography.Text>
      </Space>
      <div className="ipx-api-key-status-strip">
        <div className="ipx-api-key-status-track" aria-hidden="true">
          {statusSegments.map((item) => (
            <span
              key={item.status}
              className={`ipx-api-key-status-segment is-${item.status.toLowerCase()}`}
              style={{ width: currentPageCount > 0 ? `${(item.count / currentPageCount) * 100}%` : 0 }}
            />
          ))}
        </div>
        <Space size={6} wrap>
          {statusSegments.map((item) => (
            <Tag key={item.status} color={apiKeyStatusColor(item.status)}>
              {t(`customer.apiKeys.statusSummary.${item.status}`)} {item.displayCount}
            </Tag>
          ))}
        </Space>
      </div>
    </div>
  );
  const currentError = currentQuery.error as ApiError | null;
  const currentErrorIsPermission = currentError?.code === 'PERMISSION_DENIED' || currentError?.code === 403;

  return (
    <div className="ipx-api-key-page ipx-customer-page ipx-customer-api-keys-page">
      <PageHeader
        title={t('customer.apiKeys.title')}
        description={t('customer.apiKeys.description')}
        extra={(
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={query.isFetching}
              disabled={!tenantId}
              onClick={() => void query.refetch().then((result) => {
                if (result.isError) {
                  message.error(formatApiKeyReason(t, result.error));
                  return;
                }
                message.success(t('customer.apiKeys.refreshSuccess'));
              })}
            >
              {t('refresh')}
            </Button>
            <Button
              type="primary"
              icon={<KeyOutlined />}
              aria-label={t('customer.apiKeys.create')}
              disabled={createDisabled}
              onClick={() => setCreateOpen(true)}
            >
              {t('customer.apiKeys.create')}
            </Button>
          </Space>
        )}
      />
      {actionError && (
        <Alert
          type="error"
          message={t('error')}
          description={actionError}
          showIcon
          closable
          onClose={() => setActionError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {currentQuery.isError && (
        <Alert
          type={currentErrorIsPermission ? 'warning' : 'error'}
          message={currentErrorIsPermission ? t('permissionDenied') : t('error')}
          description={currentError ? formatApiKeyReason(t, currentError) : t('error')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {missingTenantContext && (
        <Alert
          type="warning"
          message={t('permissionDenied')}
          description={t('customer.apiKeys.missingTenantContext')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {query.isError && tenantId && (
        <Alert
          type="error"
          message={t('customer.apiKeys.listFailed')}
          description={formatApiKeyReason(t, query.error)}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {currentQuery.isLoading && (
        <Skeleton active style={{ marginBottom: 16 }} />
      )}
      {!currentQuery.isError && query.isFetching && !query.isLoading && (
        <Alert
          type="info"
          showIcon
          message={t('customer.apiKeys.refreshing')}
          style={{ marginBottom: 16 }}
        />
      )}
      {revokeMutation.isPending && (
        <Alert
          type="warning"
          showIcon
          message={t('customer.apiKeys.revokePending')}
          style={{ marginBottom: 16 }}
        />
      )}
      {!currentQuery.isError && tenantId && (
        <>
          <Card className="ipx-api-key-hero ipx-customer-hero" styles={{ body: { padding: 0 } }}>
        <Row gutter={[0, 0]} align="stretch">
          <Col xs={24} lg={11}>
            <div className="ipx-api-key-hero-main">
              <Space align="start" size={14}>
                <span className="ipx-api-key-icon"><KeyOutlined /></span>
                <Space direction="vertical" size={6}>
                  <Typography.Text className="ipx-overview-card-label">
                    {t('customer.apiKeys.heroLabel')}
                  </Typography.Text>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {t('customer.apiKeys.heroTitle')}
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    {t('customer.apiKeys.heroDescription')}
                  </Typography.Text>
                </Space>
              </Space>
            </div>
          </Col>
          <Col xs={24} lg={13}>
            <div className="ipx-api-key-flow">
              {['create', 'save', 'connect'].map((step, index) => (
                <div className="ipx-api-key-flow-step" key={step}>
                  <span className="ipx-api-key-flow-index">{index + 1}</span>
                  <span>
                    <Typography.Text strong>{t(`customer.apiKeys.flow.${step}.title`)}</Typography.Text>
                    <Typography.Text type="secondary">{t(`customer.apiKeys.flow.${step}.desc`)}</Typography.Text>
                  </span>
                </div>
              ))}
            </div>
          </Col>
        </Row>
          </Card>
          <Row gutter={[14, 14]} className="ipx-customer-metric-grid" style={{ marginBottom: 14 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-api-key-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.apiKeys.metrics.total')} value={totalCount} prefix={<ApiOutlined />} />
            <Typography.Text type="secondary">{t('customer.apiKeys.metrics.totalDesc')}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-api-key-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.apiKeys.metrics.active')} value={activeMetric} prefix={<KeyOutlined />} />
            <Typography.Text type="secondary">{t('customer.apiKeys.metrics.currentPageDesc')}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-api-key-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.apiKeys.metrics.recentlyUsed')} value={recentlyUsedCount} prefix={<CheckCircleOutlined />} />
            <Typography.Text type="secondary">{t('customer.apiKeys.metrics.currentPageDesc')}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="ipx-api-key-metric-card ipx-customer-metric-card" styles={{ body: { padding: 16 } }}>
            <Statistic title={t('customer.apiKeys.metrics.inactive')} value={inactiveMetric} prefix={<LockOutlined />} />
            <Typography.Text type="secondary">{t('customer.apiKeys.metrics.currentPageDesc')}</Typography.Text>
          </Card>
        </Col>
          </Row>
          <Alert
        className="ipx-api-key-security"
        type="warning"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={t('customer.apiKeys.security.title')}
        description={t('customer.apiKeys.security.description')}
        style={{ marginBottom: 14 }}
      />
          <Alert
        type="info"
        showIcon
        message={t('customer.apiKeys.dataScope.title')}
        description={t('customer.apiKeys.dataScope.description')}
        style={{ marginBottom: 14 }}
      />
          <Alert
        type="info"
        showIcon
        message={t('customer.apiKeys.statusSummaryTitle')}
        description={t('customer.apiKeys.statusSummaryDescription', {
          active: activeMetric,
          inactive: inactiveMetric,
          used: recentlyUsedCount,
        })}
        style={{ marginBottom: 14 }}
      />
          <Card className="ipx-api-key-table-card ipx-customer-table-card" styles={{ body: { padding: 0 } }}>
        {isInitialLoading && (
          <Alert
            type="info"
            showIcon
            message={t('customer.apiKeys.loading')}
            style={{ margin: 16 }}
          />
        )}
        <ListPage
          query={query}
          columns={columns}
          toolbar={toolbar}
          rowKey="id"
          errorDescription={(error) => formatApiKeyReason(t, error)}
          pagination={{
            page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          emptyText={emptyState}
        />
          </Card>
        </>
      )}
      <Modal
        title={t('customer.apiKeys.form.title')}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText={t('customer.apiKeys.form.submit')}
        cancelText={t('customer.apiKeys.form.cancel')}
        confirmLoading={createMutation.isPending}
        okButtonProps={{ disabled: currentQuery.isLoading || createDisabled }}
        onOk={() => form.submit()}
      >
        <Alert
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message={t('customer.apiKeys.form.notice')}
          style={{ marginBottom: 16 }}
        />
        {createMutation.isPending && (
          <Alert
            type="warning"
            showIcon
            message={t('customer.apiKeys.form.creating')}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          initialValues={{ purpose: 'DEDICATED' }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Alert
            type="success"
            showIcon
            message={t(keyPurpose === 'DEDICATED'
              ? 'customer.apiKeys.form.dedicatedPermissionPreview'
              : 'customer.apiKeys.form.permissionPreview')}
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="purpose" label={t('customer.apiKeys.form.purpose')} rules={[{ required: true }]}>
            <Segmented
              block
              options={[
                { value: 'DEDICATED', label: t('customer.apiKeys.form.purposeDedicated') },
                { value: 'RESIDENTIAL', label: t('customer.apiKeys.form.purposeResidential') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('customer.apiKeys.form.name')}
            rules={[
              { required: true, message: t('customer.apiKeys.form.nameRequired') },
              { max: 80, message: t('customer.apiKeys.form.nameTooLong') },
            ]}
          >
            <Input placeholder={t('customer.apiKeys.form.namePlaceholder')} maxLength={80} />
          </Form.Item>
        </Form>
      </Modal>
      {plainKey && <PlainKeyModal plainKey={plainKey} onClose={() => setPlainKey(null)} />}
    </div>
  );
}

function formatApiKeyReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  return formatCustomerError(error, t, 'customer.apiKeys.reason');
}

function formatApiScope(t: (key: string, options?: Record<string, unknown>) => string, scope: string): string {
  if (scope === 'res_static:*') return t('customer.apiKeys.defaultScopeLabel');
  if (scope === 'dedicated:*') return t('customer.apiKeys.dedicatedScopeLabel');
  return scope;
}

function PlainKeyModal({ plainKey, onClose }: { plainKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(plainKey).then(() => {
      setCopied(true);
      message.success(t('customer.apiKeys.plainKeyModal.copySuccess'));
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      message.error(t('customer.apiKeys.plainKeyModal.copyFailed'));
    });
  };

  return (
    <Modal
      title={t('customer.apiKeys.plainKeyModal.title')}
      open
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          {t('customer.apiKeys.plainKeyModal.close')}
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="warning" message={t('customer.apiKeys.plainKeyModal.warning')} showIcon />
        <Alert type="success" message={t('customer.apiKeys.plainKeyModal.createdNotice')} showIcon />
        <div className="ipx-api-key-secret-box">
          <Space direction="vertical" size={4} style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">{t('customer.apiKeys.plainKeyModal.secretLabel')}</Typography.Text>
            <Typography.Text code copyable={false} className="ipx-api-key-secret-value">{plainKey}</Typography.Text>
          </Space>
          <Button size="small" type={copied ? 'primary' : 'default'} icon={<CopyOutlined />} onClick={copy}>
            {copied ? t('customer.apiKeys.plainKeyModal.copied') : t('customer.apiKeys.plainKeyModal.copy')}
          </Button>
        </div>
      </Space>
    </Modal>
  );
}
