import React, { useEffect, useState } from 'react';
import { Alert, Button, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';

export type ProviderCode = 'IPIPD' | 'NINE_EIGHT_FIVE' | 'PR';

export interface ProviderAccountDto {
  id: string;
  siteId: string;
  tenantId: string;
  providerCode: ProviderCode;
  status: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes?: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProviderSyncInventoryResult {
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

export const PROVIDER_LABELS: Record<ProviderCode, string> = {
  IPIPD: 'ipmigo',
  NINE_EIGHT_FIVE: '985',
  PR: 'PR',
};

export const PROVIDER_CREDENTIAL_FIELDS: Record<ProviderCode, string[]> = {
  IPIPD: ['appId', 'appSecret'],
  NINE_EIGHT_FIVE: ['apikey', 'zoneId'],
  PR: ['apikey'],
};

interface ProviderAccountFormValues {
  providerCode?: ProviderCode;
  baseUrl?: string;
  timeoutMs?: number;
  inventorySyncEnabled?: boolean;
  credential?: Record<string, string>;
}

export function buildProviderAccountListPath(tenantId: string): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}/provider-accounts`;
}

export function buildProviderAccountItemPath(tenantId: string, accountId: string): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}/provider-accounts/${encodeURIComponent(accountId)}`;
}

export function buildProviderAccountSyncPath(tenantId: string, accountId: string): string {
  return `${buildProviderAccountItemPath(tenantId, accountId)}/sync-inventory`;
}

function pickCredential(raw: Record<string, string> | undefined, fields: string[]): Record<string, string> {
  const credential: Record<string, string> = {};
  for (const field of fields) {
    const value = raw?.[field]?.trim();
    if (value) credential[field] = value;
  }
  return credential;
}

export function buildCreateProviderAccountBody(values: ProviderAccountFormValues) {
  const providerCode = values.providerCode!;
  const credential = pickCredential(values.credential, PROVIDER_CREDENTIAL_FIELDS[providerCode]);
  return {
    providerCode,
    baseUrl: values.baseUrl?.trim() ?? '',
    credential,
    ...(values.timeoutMs !== undefined && values.timeoutMs !== null ? { timeoutMs: values.timeoutMs } : {}),
    ...(values.inventorySyncEnabled !== undefined ? { inventorySyncEnabled: values.inventorySyncEnabled } : {}),
  };
}

export function buildUpdateProviderAccountBody(account: ProviderAccountDto, values: ProviderAccountFormValues) {
  const credential = pickCredential(values.credential, PROVIDER_CREDENTIAL_FIELDS[account.providerCode]);
  return {
    baseUrl: values.baseUrl?.trim() ?? account.baseUrl,
    timeoutMs: values.timeoutMs ?? account.timeoutMs,
    inventorySyncEnabled: values.inventorySyncEnabled ?? account.inventorySyncEnabled,
    ...(Object.keys(credential).length > 0 ? { credential } : {}),
  };
}

export function TenantProviderAccountsFeature({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderAccountDto | null>(null);
  const [disabling, setDisabling] = useState<ProviderAccountDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queryKey = ['provider-accounts', tenantId];
  const invalidate = () => qc.invalidateQueries({ queryKey });
  const invalidateProviderResourceState = () => {
    for (const key of PROVIDER_RESOURCE_QUERY_KEYS) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const items = await apiRequest<ProviderAccountDto[]>(buildProviderAccountListPath(tenantId));
      return { page: 1, pageSize: items.length, total: items.length, items };
    },
  });

  const syncInventoryMutation = useMutation({
    mutationFn: async (account: ProviderAccountDto) => {
      const data: unknown = await apiRequest<ProviderSyncInventoryResult>(
        buildProviderAccountSyncPath(tenantId, account.id),
        { method: 'POST' },
      );
      if (!isProviderSyncInventoryResult(data)) {
        throw new Error('invalid_sync_inventory_response');
      }
      return data;
    },
    onSuccess: (data) => {
      invalidateProviderResourceState();
      if (data.synced > 0) {
        message.success(t('providerAccounts.syncAfterSaveSuccess', { count: data.synced }));
      } else {
        message.warning(t('providerAccounts.syncAfterSaveNoRows'));
      }
    },
    onError: (error) => {
      invalidateProviderResourceState();
      const reason = formatProviderAccountReason(t, getReasonKey(error));
      setActionError(t('providerAccounts.syncAfterSaveFailed', { reason }));
      message.warning(t('providerAccounts.syncAfterSaveFailed', { reason }));
    },
  });

  const refreshAfterAccountSave = (account: ProviderAccountDto) => {
    void invalidate();
    invalidateProviderResourceState();
    if (account.status === 'ACTIVE' && account.inventorySyncEnabled) {
      syncInventoryMutation.mutate(account);
    }
  };

  const createMutation = useMutation({
    mutationFn: (values: ProviderAccountFormValues) =>
      apiRequest<ProviderAccountDto>(buildProviderAccountListPath(tenantId), {
        method: 'POST',
        body: JSON.stringify(buildCreateProviderAccountBody(values)),
      }),
    onSuccess: (created) => {
      setActionError(null);
      setCreateOpen(false);
      message.success(t('providerAccounts.createSuccess'));
      refreshAfterAccountSave(created);
    },
    onError: (error) => setActionError(formatProviderAccountReason(t, getReasonKey(error))),
  });

  const updateMutation = useMutation({
    mutationFn: ({ account, values }: { account: ProviderAccountDto; values: ProviderAccountFormValues }) =>
      apiRequest<ProviderAccountDto>(buildProviderAccountItemPath(tenantId, account.id), {
        method: 'PUT',
        body: JSON.stringify(buildUpdateProviderAccountBody(account, values)),
      }),
    onSuccess: (updated) => {
      setActionError(null);
      setEditing(null);
      message.success(t('providerAccounts.updateSuccess'));
      refreshAfterAccountSave(updated);
    },
    onError: (error) => setActionError(formatProviderAccountReason(t, getReasonKey(error))),
  });

  const disableMutation = useMutation({
    mutationFn: (account: ProviderAccountDto) =>
      apiRequest<ProviderAccountDto>(buildProviderAccountItemPath(tenantId, account.id), { method: 'DELETE' }),
    onSuccess: () => {
      setActionError(null);
      message.success(t('providerAccounts.disableSuccess'));
      void invalidate();
      invalidateProviderResourceState();
    },
    onError: (error) => setActionError(formatProviderAccountReason(t, getReasonKey(error))),
  });

  const columns: ColumnsType<ProviderAccountDto> = [
    {
      title: t('providerAccounts.providerCode'),
      dataIndex: 'providerCode',
      key: 'providerCode',
      render: (v: ProviderCode) => PROVIDER_LABELS[v] ?? v,
    },
    { title: t('providerAccounts.baseUrl'), dataIndex: 'baseUrl', key: 'baseUrl' },
    {
      title: t('providerAccounts.status'),
      dataIndex: 'status',
      key: 'status',
      render: (v: ProviderAccountDto['status']) => (
        <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>
          {v === 'ACTIVE' ? t('providerAccounts.enabled') : t('providerAccounts.disabled')}
        </Tag>
      ),
    },
    { title: t('providerAccounts.timeoutMs'), dataIndex: 'timeoutMs', key: 'timeoutMs' },
    {
      title: t('providerAccounts.inventorySyncEnabled'),
      dataIndex: 'inventorySyncEnabled',
      key: 'inventorySyncEnabled',
      render: (v: boolean) => (v ? t('providerAccounts.enabled') : t('providerAccounts.disabled')),
    },
    { title: t('providerAccounts.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', render: (v: string) => formatDateTime(v) },
    {
      title: t('providerAccounts.actions'),
      key: 'actions',
      render: (_: unknown, row: ProviderAccountDto) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'edit', label: t('providerAccounts.edit') },
              {
                key: 'disable',
                label: t('providerAccounts.disable'),
                danger: true,
                disabled: row.status !== 'ACTIVE',
              },
            ],
            onClick: ({ key }) => {
              if (key === 'edit') setEditing(row);
              if (key === 'disable') setDisabling(row);
            },
          }}
        >
          <Button size="small" loading={disableMutation.isPending}>
            <Space size={4}>
              {t('providerAccounts.operations.more')}
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
      ),
    },
  ];

  const toolbar = (
    <Space wrap style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
      <Space direction="vertical" size={0}>
        <Typography.Text strong>{t('providerAccounts.workspaceTitle')}</Typography.Text>
        <Typography.Text type="secondary">{t('providerAccounts.workspaceDescription')}</Typography.Text>
      </Space>
      <Button type="primary" onClick={() => setCreateOpen(true)}>
        {t('providerAccounts.create')}
      </Button>
    </Space>
  );

  return (
    <>
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
        emptyText={t('providerAccounts.empty')}
        pagination={{ page: 1, pageSize: query.data?.total ?? 0, total: query.data?.total ?? 0, onChange: () => {} }}
      />
      <ProviderAccountFormModal
        open={createOpen}
        mode="create"
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values)}
      />
      <ProviderAccountFormModal
        open={editing !== null}
        mode="edit"
        account={editing ?? undefined}
        confirmLoading={updateMutation.isPending}
        onCancel={() => setEditing(null)}
        onSubmit={(values) => editing && updateMutation.mutate({ account: editing, values })}
      />
      <Popconfirm
        title={t('providerAccounts.disableConfirm')}
        okButtonProps={{ danger: true }}
        okText={t('providerAccounts.disable')}
        open={disabling !== null}
        onCancel={() => setDisabling(null)}
        onConfirm={() => {
          if (!disabling) return;
          disableMutation.mutate(disabling, { onSuccess: () => setDisabling(null) });
        }}
      >
        <span />
      </Popconfirm>
    </>
  );
}

interface ProviderAccountFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  account?: ProviderAccountDto;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: ProviderAccountFormValues) => void;
}

function ProviderAccountFormModal({ open, mode, account, confirmLoading, onCancel, onSubmit }: ProviderAccountFormModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ProviderAccountFormValues>();
  const [providerCode, setProviderCode] = useState<ProviderCode>(account?.providerCode ?? 'IPIPD');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && account) {
      setProviderCode(account.providerCode);
      form.setFieldsValue({
        providerCode: account.providerCode,
        baseUrl: account.baseUrl,
        timeoutMs: account.timeoutMs,
        inventorySyncEnabled: account.inventorySyncEnabled,
        credential: {},
      });
    } else {
      setProviderCode('IPIPD');
      form.resetFields();
      form.setFieldsValue({ providerCode: 'IPIPD', inventorySyncEnabled: false });
    }
  }, [open, mode, account, form]);

  const credentialFields = PROVIDER_CREDENTIAL_FIELDS[providerCode];

  return (
    <Modal
      title={mode === 'create' ? t('providerAccounts.form.createTitle') : t('providerAccounts.form.editTitle')}
      open={open}
      okText={t('providerAccounts.form.submit')}
      cancelText={t('providerAccounts.form.cancel')}
      confirmLoading={confirmLoading}
      onCancel={() => { form.resetFields(); onCancel(); }}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item
          name="providerCode"
          label={t('providerAccounts.providerCode')}
          rules={[{ required: true, message: t('providerAccounts.form.providerCodeRequired') }]}
        >
          <Select
            disabled={mode === 'edit'}
            onChange={(v: ProviderCode) => setProviderCode(v)}
            options={(Object.keys(PROVIDER_LABELS) as ProviderCode[]).map((code) => ({
              value: code,
              label: PROVIDER_LABELS[code],
            }))}
          />
        </Form.Item>
        <Form.Item
          name="baseUrl"
          label={t('providerAccounts.baseUrl')}
          rules={[{ required: true, message: t('providerAccounts.form.baseUrlRequired') }]}
        >
          <Input placeholder="https://" autoComplete="off" />
        </Form.Item>
        {credentialFields.map((field) => (
          <Form.Item
            key={field}
            name={['credential', field]}
            label={t(`providerAccounts.credential.${field}`)}
            rules={mode === 'create' ? [{ required: true, message: t('providerAccounts.form.credentialRequired') }] : []}
          >
            <Input.Password autoComplete="new-password" placeholder={mode === 'edit' ? t('providerAccounts.form.credentialKeep') : ''} />
          </Form.Item>
        ))}
        <Form.Item name="timeoutMs" label={t('providerAccounts.timeoutMs')}>
          <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="inventorySyncEnabled" label={t('providerAccounts.inventorySyncEnabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const PROVIDER_RESOURCE_QUERY_KEYS = [
  ['providers'],
  ['resources'],
  ['resources-list'],
  ['resources-countries'],
  ['resources', 'quick-price-catalog'],
  ['pricing-matrix'],
  ['pricing-resources'],
  ['admin-assisted-order-resources'],
  ['admin-user-price-resources'],
] as const;

function getReasonKey(error: unknown): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'generic';
}

function formatProviderAccountReason(
  t: (key: string, values?: Record<string, unknown>) => string,
  reasonKey?: string | null,
): string {
  if (!reasonKey) return t('providerAccounts.reason.generic');
  const translationKeys = [
    `providerAccounts.reason.${reasonKey}`,
    `providers.reason.${reasonKey}`,
    `resources.reason.${reasonKey}`,
    `resources.unsaleableReasons.${reasonKey}`,
    `pricing.reason.${reasonKey}`,
  ];
  for (const key of translationKeys) {
    const label = t(key);
    if (label !== key) return label;
  }
  return t('providerAccounts.reason.generic');
}

function isProviderSyncInventoryResult(value: unknown): value is ProviderSyncInventoryResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProviderSyncInventoryResult>;
  return (
    typeof candidate.attempted === 'number' &&
    typeof candidate.created === 'number' &&
    typeof candidate.updated === 'number' &&
    typeof candidate.skipped === 'number' &&
    typeof candidate.failed === 'number' &&
    typeof candidate.synced === 'number' &&
    typeof candidate.syncedAt === 'string' &&
    typeof candidate.upstreamRawStatus === 'string' &&
    Array.isArray(candidate.countries)
  );
}
