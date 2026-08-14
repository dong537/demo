import React, { useState } from 'react';
import { Alert, Button, Dropdown, Form, Input, Modal, Popconfirm, Select, Skeleton, Space, Tag, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { useCurrentAdmin } from '../../shared/auth/current-user';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';

export interface AdminApiKeyListItem {
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

interface CreateAdminApiKeyResult extends AdminApiKeyListItem {
  plainKey?: string;
}

interface CreateApiKeyFormValues {
  name: string;
  scopes?: string[];
  ipWhitelist?: string[];
}

export function buildApiKeyListPath(page: number, pageSize: number): string {
  return `/api/api-keys${buildQuery({ page, pageSize })}`;
}

export function buildCreateApiKeyBody(input: {
  tenantId: string;
  name: string;
  scopes: string[];
  ipWhitelist?: string[];
}) {
  return {
    tenantId: input.tenantId,
    name: input.name.trim(),
    scopes: input.scopes,
    ...(input.ipWhitelist && input.ipWhitelist.length > 0
      ? { ipWhitelist: input.ipWhitelist }
      : {}),
  };
}

export function buildRevokeApiKeyPath(id: string): string {
  return `/api/api-keys/${encodeURIComponent(id)}`;
}

export function AdminApiKeyListFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminApiKeyListItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form] = Form.useForm<CreateApiKeyFormValues>();

  const currentQuery = useCurrentAdmin();
  const ownerType = currentQuery.data?.ownerType;
  const tenantId = currentQuery.data?.tenantId ?? '';
  const canManageApiKeys = ownerType === 'TENANT_ADMIN' && Boolean(tenantId);

  const query = useQuery({
    queryKey: ['admin-api-keys', page, pageSize],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: AdminApiKeyListItem[] }>(
        buildApiKeyListPath(page, pageSize),
      ),
    enabled: canManageApiKeys,
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateApiKeyFormValues) => {
      if (!tenantId) {
        throw new ApiError('PERMISSION_DENIED', 'insufficient_permissions');
      }
      const scopes = values.scopes ?? [];
      if (!values.name?.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'api_key_name_required');
      }
      if (scopes.length === 0) {
        throw new ApiError('VALIDATION_ERROR', 'api_key_scopes_required');
      }
      return apiRequest<CreateAdminApiKeyResult>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify(
          buildCreateApiKeyBody({ tenantId, name: values.name, scopes, ipWhitelist: values.ipWhitelist }),
        ),
      });
    },
    onSuccess: (result) => {
      setActionError(null);
      setCreateOpen(false);
      form.resetFields();
      message.success(t('adminApiKeys.createSuccess'));
      if (result.plainKey) setPlainKey(result.plainKey);
      void qc.invalidateQueries({ queryKey: ['admin-api-keys'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.reasonKey : t('error'));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(buildRevokeApiKeyPath(id), { method: 'DELETE' }),
    onSuccess: () => {
      setActionError(null);
      message.success(t('adminApiKeys.revokeSuccess'));
      void qc.invalidateQueries({ queryKey: ['admin-api-keys'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.reasonKey : t('error'));
    },
  });

  const columns: ColumnsType<AdminApiKeyListItem> = [
    {
      title: t('adminApiKeys.name'),
      key: 'identity',
      render: (_: unknown, row: AdminApiKeyListItem) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text code copyable={{ text: row.keyPrefix }}>{row.keyPrefix}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('adminApiKeys.scopes'),
      dataIndex: 'scopes',
      key: 'scopes',
      render: (scopes: string[]) => (
        <Space size={[4, 4]} wrap>
          {scopes.map((scope) => <Tag key={scope}>{scope}</Tag>)}
        </Space>
      ),
    },
    {
      title: t('adminApiKeys.form.ipWhitelist'),
      dataIndex: 'ipWhitelist',
      key: 'ipWhitelist',
      render: (items: string[]) => (
        items.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {items.map((item) => <Tag key={item}>{item}</Tag>)}
          </Space>
        ) : '-'
      ),
    },
    {
      title: t('adminApiKeys.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag>,
    },
    {
      title: t('adminApiKeys.createdAt'),
      key: 'times',
      render: (_: unknown, row: AdminApiKeyListItem) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{formatDateTime(row.createdAt)}</Typography.Text>
          <Typography.Text type="secondary">{t('adminApiKeys.lastUsedAt')}: {row.lastUsedAt ? formatDateTime(row.lastUsedAt) : t('adminApiKeys.never')}</Typography.Text>
          {row.revokedAt && <Typography.Text type="secondary">{t('adminApiKeys.revoke')}: {formatDateTime(row.revokedAt)}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: t('adminApiKeys.actions'),
      key: 'actions',
      render: (_: unknown, row: AdminApiKeyListItem) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'revoke',
                label: t('adminApiKeys.revoke'),
                danger: true,
                disabled: row.status !== 'ACTIVE',
              },
            ],
            onClick: ({ key }) => {
              if (key === 'revoke') setRevoking(row);
            },
          }}
        >
          <Button size="small" loading={revokeMutation.isPending}>
            <Space size={4}>
              {t('adminApiKeys.operations.more')}
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
      ),
    },
  ];

  const toolbar = canManageApiKeys ? (
    <Space style={{ marginBottom: 16 }}>
      <Button type="primary" onClick={() => setCreateOpen(true)}>
        {t('adminApiKeys.create')}
      </Button>
    </Space>
  ) : null;

  if (currentQuery.isLoading) {
    return <Skeleton active />;
  }

  if (currentQuery.error) {
    return (
      <>
        <Typography.Title level={4}>{t('adminApiKeys.title')}</Typography.Title>
        <Alert
          type="error"
          message={t('error')}
          description={currentQuery.error instanceof ApiError ? currentQuery.error.reasonKey : t('error')}
          showIcon
        />
      </>
    );
  }

  if (!canManageApiKeys) {
    return (
      <>
        <Typography.Title level={4}>{t('adminApiKeys.title')}</Typography.Title>
        <Alert
          type="warning"
          message={t('permissionDenied')}
          description="insufficient_permissions"
          showIcon
        />
      </>
    );
  }

  return (
    <>
      <Typography.Title level={4}>{t('adminApiKeys.title')}</Typography.Title>
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
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('adminApiKeys.empty')}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      <Popconfirm
        title={t('adminApiKeys.revokeConfirm')}
        okButtonProps={{ danger: true }}
        okText={t('adminApiKeys.revoke')}
        open={revoking !== null}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (!revoking) return;
          revokeMutation.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
        }}
      >
        <span />
      </Popconfirm>
      <Modal
        title={t('adminApiKeys.form.title')}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText={t('adminApiKeys.form.submit')}
        cancelText={t('adminApiKeys.form.cancel')}
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            name="name"
            label={t('adminApiKeys.form.name')}
            rules={[
              { required: true, message: t('adminApiKeys.form.nameRequired') },
              { max: 80, message: t('adminApiKeys.form.nameTooLong') },
            ]}
          >
            <Input placeholder={t('adminApiKeys.form.namePlaceholder')} maxLength={80} />
          </Form.Item>
          <Form.Item
            name="scopes"
            label={t('adminApiKeys.form.scopes')}
            rules={[{ required: true, message: t('adminApiKeys.form.scopesRequired') }]}
          >
            <Select
              mode="tags"
              placeholder={t('adminApiKeys.form.scopesPlaceholder')}
              tokenSeparators={[',', ' ']}
            />
          </Form.Item>
          <Form.Item name="ipWhitelist" label={t('adminApiKeys.form.ipWhitelist')}>
            <Select
              mode="tags"
              placeholder={t('adminApiKeys.form.ipWhitelistPlaceholder')}
              tokenSeparators={[',', ' ']}
            />
          </Form.Item>
        </Form>
      </Modal>
      {plainKey && <PlainKeyModal plainKey={plainKey} onClose={() => setPlainKey(null)} />}
    </>
  );
}

function PlainKeyModal({ plainKey, onClose }: { plainKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(plainKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal
      title={t('adminApiKeys.plainKeyModal.title')}
      open
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          {t('adminApiKeys.plainKeyModal.close')}
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="warning" message={t('adminApiKeys.plainKeyModal.warning')} showIcon />
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text code copyable={false}>{plainKey}</Typography.Text>
          <Button size="small" type={copied ? 'primary' : 'default'} onClick={copy}>
            {copied ? t('adminApiKeys.plainKeyModal.copied') : t('adminApiKeys.plainKeyModal.copy')}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
