import React, { useState } from 'react';
import { Alert, Button, Dropdown, Form, Input, InputNumber, Modal, Space, Switch, Tag, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery } from '../../shared/api/client';
import type { ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';
import { formatRegionNameZh } from '../../shared/resource/resource-labels';

interface UpstreamDto {
  id: string;
  tenantId: string | null;
  name: string;
  baseUrl: string;
  status: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UpstreamTestResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

interface UpstreamSyncInventoryResult {
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  synced: number;
  syncedAt: string;
  upstreamRawStatus: string;
  countries: string[];
}

type UpstreamActionFeedback =
  | { type: 'test-success'; accountId: string; accountName: string; result: UpstreamTestResult }
  | { type: 'sync-success'; accountId: string; accountName: string; result: UpstreamSyncInventoryResult }
  | { type: 'test-error' | 'sync-error'; accountId: string; accountName: string; reasonKey: string };

type UpstreamFormValues = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
};

export function UpstreamListFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<UpstreamDto | null>(null);
  const [actionFeedback, setActionFeedback] = useState<UpstreamActionFeedback | null>(null);
  const [form] = Form.useForm<UpstreamFormValues>();

  const query = useQuery({
    queryKey: ['upstream-accounts', page, pageSize],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: UpstreamDto[] }>(
        `/api/upstream-accounts${buildQuery({ page, pageSize })}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: (values: UpstreamFormValues) =>
      apiRequest<UpstreamDto>('/api/upstream-accounts', { method: 'POST', body: JSON.stringify(buildCreatePayload(values)) }),
    onSuccess: (account) => {
      message.success(t('upstream.createSuccess'));
      setModalOpen(false);
      setEditingAccount(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['upstream-accounts'] });
      invalidateResourceQueries(qc);
      if (account.status === 'ACTIVE' && account.inventorySyncEnabled) {
        syncMutation.mutate(account.id);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ account, values }: { account: UpstreamDto; values: UpstreamFormValues }) =>
      apiRequest<UpstreamDto>(`/api/upstream-accounts/${encodeURIComponent(account.id)}`, {
        method: 'PUT',
        body: JSON.stringify(buildUpdatePayload(values)),
      }),
    onSuccess: (account) => {
      message.success(t('upstream.updateSuccess'));
      setModalOpen(false);
      setEditingAccount(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['upstream-accounts'] });
      invalidateResourceQueries(qc);
      if (account.status === 'ACTIVE' && account.inventorySyncEnabled) {
        syncMutation.mutate(account.id);
      }
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<UpstreamTestResult>(`/api/upstream-accounts/${id}/test`, { method: 'POST' }),
    onMutate: (id) => {
      setActionFeedback(null);
      return findUpstreamAccount(query.data?.items ?? [], id);
    },
    onSuccess: (data, id, account) => {
      if (!data.healthy) {
        const reasonKey = data.error ?? 'upstream_error';
        setActionFeedback({
          type: 'test-error',
          accountId: id,
          accountName: account?.name ?? id,
          reasonKey,
        });
        message.error(formatUpstreamReason(t, reasonKey));
        return;
      }
      setActionFeedback({
        type: 'test-success',
        accountId: id,
        accountName: account?.name ?? id,
        result: data,
      });
      message.success(t('upstream.testSuccess', { ms: data.latencyMs }));
    },
    onError: (err, id, account) => {
      const reasonKey = getReasonKey(err);
      setActionFeedback({
        type: 'test-error',
        accountId: id,
        accountName: account?.name ?? id,
        reasonKey,
      });
      message.error(formatUpstreamReason(t, reasonKey));
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<UpstreamSyncInventoryResult>(`/api/upstream-accounts/${id}/sync-inventory`, { method: 'POST' }),
    onMutate: (id) => {
      setActionFeedback(null);
      return findUpstreamAccount(query.data?.items ?? [], id);
    },
    onSuccess: (data, id, account) => {
      setActionFeedback({
        type: 'sync-success',
        accountId: id,
        accountName: account?.name ?? id,
        result: data,
      });
      message.success(t('upstream.syncSuccess'));
      void qc.invalidateQueries({ queryKey: ['upstream-accounts'] });
      invalidateResourceQueries(qc);
    },
    onError: (err, id, account) => {
      const reasonKey = getReasonKey(err);
      setActionFeedback({
        type: 'sync-error',
        accountId: id,
        accountName: account?.name ?? id,
        reasonKey,
      });
      message.error(formatUpstreamReason(t, reasonKey));
    },
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/upstream-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      message.success(t('upstream.disableSuccess'));
      void qc.invalidateQueries({ queryKey: ['upstream-accounts'] });
      invalidateResourceQueries(qc);
    },
  });

  const columns: ColumnsType<UpstreamDto> = [
    {
      title: t('upstream.name'),
      dataIndex: 'name',
      key: 'name',
      width: 300,
      render: (_value: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary" copyable style={{ fontSize: 12, maxWidth: 260 }} ellipsis={{ tooltip: row.id }}>
            {row.id}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 260 }} ellipsis={{ tooltip: row.baseUrl }}>
            {row.baseUrl}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('upstream.status'),
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (value: string) => (
        <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>
          {value === 'ACTIVE' ? t('upstream.statusActive') : t('upstream.statusDisabled')}
        </Tag>
      ),
    },
    {
      title: t('upstream.inventorySyncEnabled'),
      dataIndex: 'inventorySyncEnabled',
      key: 'inventorySyncEnabled',
      width: 140,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'default'}>
          {value ? t('upstream.enabled') : t('upstream.disabled')}
        </Tag>
      ),
    },
    { title: t('upstream.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 190, render: formatDateTime },
    {
      title: t('tenants.actions'),
      key: 'actions',
      width: 112,
      fixed: 'right',
      render: (_: unknown, row: UpstreamDto) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'edit', label: t('upstream.edit') },
              { key: 'test', label: t('upstream.test') },
              { key: 'sync', label: t('upstream.sync') },
              ...(row.status !== 'DISABLED'
                ? [{ key: 'disable', label: t('upstream.disable'), danger: true }]
                : []),
            ],
            onClick: ({ key }) => {
              if (key === 'edit') openEditModal(row);
              if (key === 'test') testMutation.mutate(row.id);
              if (key === 'sync') syncMutation.mutate(row.id);
              if (key === 'disable') disableMutation.mutate(row.id);
            },
          }}
        >
          <Button size="small" loading={testMutation.isPending || syncMutation.isPending || disableMutation.isPending}>
            <Space size={4}>
              {t('upstream.operations.more')}
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
      ),
    },
  ];

  const toolbar = (
    <Space style={{ marginBottom: 12 }}>
      <Button type="primary" onClick={openCreateModal}>{t('upstream.create')}</Button>
    </Space>
  );

  const modalError = createMutation.error ?? updateMutation.error;

  return (
    <>
      <Typography.Title level={4}>{t('upstream.title')}</Typography.Title>
      {actionFeedback ? (
        <Alert
          type={actionFeedback.type.endsWith('success') ? 'success' : 'error'}
          showIcon
          closable
          onClose={() => setActionFeedback(null)}
          style={{ marginBottom: 16 }}
          message={(
            <Space size={8} wrap>
              <Typography.Text strong>
                {actionFeedback.type === 'test-success' || actionFeedback.type === 'test-error' ? t('upstream.test') : t('upstream.sync')}
              </Typography.Text>
              <Tag>{actionFeedback.accountName}</Tag>
              <Typography.Text type="secondary">{actionFeedback.accountId}</Typography.Text>
            </Space>
          )}
          description={<UpstreamActionFeedbackDescription feedback={actionFeedback} />}
        />
      ) : null}
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
        title={editingAccount ? t('upstream.editTitle') : t('upstream.create')}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingAccount(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        {modalError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('error')}
            description={formatUpstreamReason(t, getReasonKey(modalError))}
          />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            if (editingAccount) {
              updateMutation.mutate({ account: editingAccount, values });
            } else {
              createMutation.mutate(values);
            }
          }}
        >
          <Form.Item name="name" label={t('upstream.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="baseUrl" label={t('upstream.baseUrl')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={t('upstream.apiKey')}
            extra={editingAccount ? t('upstream.apiKeyKeep') : undefined}
            rules={editingAccount ? [] : [{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="timeoutMs" label={t('upstream.timeoutMs')} rules={[{ required: true }]}>
            <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="inventorySyncEnabled" label={t('upstream.inventorySyncEnabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );

  function openCreateModal() {
    createMutation.reset();
    updateMutation.reset();
    setEditingAccount(null);
    form.resetFields();
    form.setFieldsValue({ timeoutMs: 15000, inventorySyncEnabled: true });
    setModalOpen(true);
  }

  function openEditModal(account: UpstreamDto) {
    createMutation.reset();
    updateMutation.reset();
    setEditingAccount(account);
    form.setFieldsValue({
      name: account.name,
      baseUrl: account.baseUrl,
      apiKey: undefined,
      timeoutMs: account.timeoutMs,
      inventorySyncEnabled: account.inventorySyncEnabled,
    });
    setModalOpen(true);
  }
}

function buildCreatePayload(values: UpstreamFormValues) {
  return {
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey?.trim() ?? '',
    timeoutMs: Number(values.timeoutMs),
    inventorySyncEnabled: Boolean(values.inventorySyncEnabled),
  };
}

function buildUpdatePayload(values: UpstreamFormValues) {
  const apiKey = values.apiKey?.trim();
  return {
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: Number(values.timeoutMs),
    inventorySyncEnabled: Boolean(values.inventorySyncEnabled),
  };
}

function invalidateResourceQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['resources'] });
  void qc.invalidateQueries({ queryKey: ['resources', 'quick-price-catalog'] });
  void qc.invalidateQueries({ queryKey: ['resources-list'] });
  void qc.invalidateQueries({ queryKey: ['resources-countries'] });
  void qc.invalidateQueries({ queryKey: ['pricing-matrix'] });
  void qc.invalidateQueries({ queryKey: ['pricing-resources'] });
  void qc.invalidateQueries({ queryKey: ['admin-user-price-resources'] });
  void qc.invalidateQueries({ queryKey: ['admin-assisted-order-resources'] });
}

function UpstreamActionFeedbackDescription({ feedback }: { feedback: UpstreamActionFeedback }) {
  const { t } = useTranslation();
  if (feedback.type === 'test-success') {
    return <Typography.Text>{t('upstream.testSuccess', { ms: feedback.result.latencyMs })}</Typography.Text>;
  }
  if (feedback.type === 'sync-success') {
    return (
      <Space size={[8, 8]} wrap>
        <Tag>{t('resources.syncAttempted', { count: feedback.result.attempted })}</Tag>
        <Tag color="green">{t('resources.syncCreated', { count: feedback.result.created })}</Tag>
        <Tag color="blue">{t('resources.syncUpdated', { count: feedback.result.updated })}</Tag>
        <Tag color="orange">{t('resources.syncSkipped', { count: feedback.result.skipped })}</Tag>
        <Tag color={feedback.result.failed > 0 ? 'red' : undefined}>{t('resources.syncFailed', { count: feedback.result.failed })}</Tag>
        <Tag color="green">{t('providers.resourceSynced')}: {feedback.result.synced}</Tag>
        <Tag>{formatUpstreamRawStatus(feedback.result.upstreamRawStatus, t)}</Tag>
        <Tag>{formatDateTime(feedback.result.syncedAt)}</Tag>
        <Typography.Text type="secondary">
          {t('resources.syncCountries', {
            countries: formatSyncCountries(feedback.result.countries),
          })}
        </Typography.Text>
      </Space>
    );
  }
  return <Typography.Text type="danger">{formatUpstreamReason(t, feedback.reasonKey)}</Typography.Text>;
}

function findUpstreamAccount(items: UpstreamDto[], id: string): UpstreamDto | undefined {
  return items.find((item) => item.id === id);
}

function formatUpstreamReason(t: (key: string, values?: Record<string, unknown>) => string, reasonKey: string): string {
  const key = `upstream.reason.${reasonKey}`;
  const translated = t(key);
  if (translated !== key) return translated;
  const generic = t('upstream.reason.generic');
  return generic !== 'upstream.reason.generic' ? generic : t('providers.reason.generic');
}

function formatSyncCountries(countries: string[]): string {
  return countries.length > 0 ? countries.map((countryCode) => formatRegionNameZh({ countryCode })).join(', ') : '-';
}

function formatUpstreamRawStatus(status: string, t: (key: string) => string): string {
  const normalized = status.trim().toLowerCase();
  if (['ready', 'success', 'succeeded', 'ok'].includes(normalized)) return t('pricing.matrix.syncStatusReady');
  if (['failed', 'failure', 'error'].includes(normalized)) return t('pricing.matrix.syncStatusFailed');
  if (['pending', 'running', 'processing'].includes(normalized)) return t('pricing.matrix.syncStatusPending');
  return status;
}

function getReasonKey(error: unknown): string {
  const apiError = error as ApiError | undefined;
  return apiError?.reasonKey || (error instanceof Error ? error.message : String(error));
}
