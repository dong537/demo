import React from 'react';
import { Alert, Button, Card, Drawer, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography, message } from 'antd';
import { EditOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, buildQuery } from '../../shared/api/client';
import { cancelLineMigration, commitLineMigration, createLineMigration, listLineMigrations, type ControlNodeOption, type MigrationCreateBody, type MigrationSummary, type MigrationType } from './line-migrations.api';

const PAGE_SIZE = 20;
const MUTABLE_STATUSES = new Set(['PROVISIONING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'MIGRATING_AWAITING_ROUTE_IMPORT']);

export interface DedicatedLineLimitSummary {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  countryCode: string;
  protocol: string;
  desiredVersion: number;
  customer: { email: string; name: string | null };
  sku: { code: string; name: string };
  inboundTag: string;
  limits: {
    trafficLimitBytes: string;
    uplinkLimitBps: string;
    downlinkLimitBps: string;
    maxConnections: number;
    ipLimit: number;
  };
  projections: { ready: number; total: number };
}

interface DedicatedLineLimitPage {
  page: number;
  pageSize: number;
  total: number;
  items: DedicatedLineLimitSummary[];
}

type LineLimitsForm = {
  trafficLimitBytes: number;
  uplinkLimitBps: number;
  downlinkLimitBps: number;
  maxConnections: number;
  ipLimit: number;
  reason: string;
};

type MigrationForm = { type: MigrationType; targetNodeIds: string[]; targetExitId?: string; reason: string };

export function buildCreateMigrationBody(values: MigrationForm): MigrationCreateBody {
  return {
    type: values.type,
    targetNodeIds: values.type === 'EXIT_ONLY' ? [] : (values.targetNodeIds ?? []).map((id) => id.trim()).filter(Boolean),
    targetExitId: values.type === 'NODE_ONLY' ? null : (values.targetExitId ?? '').trim(),
    reason: values.reason.trim(),
    idempotencyKey: globalThis.crypto.randomUUID(),
  };
}

export function buildLineLimitsBody(values: LineLimitsForm) {
  return {
    trafficLimitBytes: Number(values.trafficLimitBytes),
    uplinkLimitBps: Number(values.uplinkLimitBps),
    downlinkLimitBps: Number(values.downlinkLimitBps),
    maxConnections: Number(values.maxConnections),
    ipLimit: Number(values.ipLimit),
    reason: values.reason.trim(),
  };
}

export function LineLimitsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<LineLimitsForm>();
  const [selected, setSelected] = React.useState<DedicatedLineLimitSummary | null>(null);
  const [migrationLine, setMigrationLine] = React.useState<DedicatedLineLimitSummary | null>(null);
  const [migrationForm] = Form.useForm<MigrationForm>();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['admin', 'control-plane', 'lines', page],
    queryFn: () => apiRequest<DedicatedLineLimitPage>(`/api/admin/control-plane/lines${buildQuery({ page, pageSize: PAGE_SIZE })}`),
    retry: false,
  });
  const update = useMutation({
    mutationFn: (values: LineLimitsForm) => apiRequest(`/api/admin/control-plane/lines/${encodeURIComponent(selected?.id ?? '')}/limits`, {
      method: 'PUT',
      body: JSON.stringify(buildLineLimitsBody(values)),
    }),
    onSuccess: async () => {
      setSelected(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['admin', 'control-plane', 'lines'] });
      void message.success(t('adminControlPlane.lineLimitsUpdated'));
    },
  });
  const migrationsQuery = useQuery({ queryKey: ['admin', 'control-plane', 'migrations', migrationLine?.id], queryFn: () => listLineMigrations(migrationLine!.id), enabled: Boolean(migrationLine), retry: false });
  const nodesQuery = useQuery({ queryKey: ['admin', 'control-plane', 'nodes', 'migration-options'], queryFn: () => apiRequest<ControlNodeOption[]>('/api/admin/control-plane/nodes'), enabled: Boolean(migrationLine), retry: false });
  const createMigration = useMutation({
    mutationFn: (values: MigrationForm) => createLineMigration(migrationLine!.id, buildCreateMigrationBody(values)),
    onSuccess: async () => { migrationForm.resetFields(); await migrationsQuery.refetch(); void message.success(t('adminControlPlane.migrationCreated')); },
  });
  const actionMigration = useMutation({
    mutationFn: (input: { action: 'commit' | 'cancel'; migration: MigrationSummary }) => input.action === 'commit' ? commitLineMigration(input.migration.lineId, input.migration.id) : cancelLineMigration(input.migration.lineId, input.migration.id),
    onSuccess: async () => { await migrationsQuery.refetch(); await queryClient.invalidateQueries({ queryKey: ['admin', 'control-plane', 'lines'] }); void message.success(t('adminControlPlane.migrationActionSuccess')); },
  });

  const openEditor = (line: DedicatedLineLimitSummary) => {
    const trafficLimitBytes = editableLimit(line.limits.trafficLimitBytes);
    const uplinkLimitBps = editableLimit(line.limits.uplinkLimitBps);
    const downlinkLimitBps = editableLimit(line.limits.downlinkLimitBps);
    if (trafficLimitBytes === null || uplinkLimitBps === null || downlinkLimitBps === null) {
      void message.error(t('adminControlPlane.lineLimitOutOfRange'));
      return;
    }
    form.setFieldsValue({
      trafficLimitBytes,
      uplinkLimitBps,
      downlinkLimitBps,
      maxConnections: line.limits.maxConnections,
      ipLimit: line.limits.ipLimit,
      reason: '',
    });
    setSelected(line);
  };

  const columns: ColumnsType<DedicatedLineLimitSummary> = [
    {
      title: t('adminControlPlane.customer'),
      render: (_, line) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{line.customer.email}</Typography.Text>
          {line.customer.name && <Typography.Text type="secondary">{line.customer.name}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: t('adminControlPlane.line'),
      render: (_, line) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{line.sku.code} / {line.countryCode} / {line.protocol}</Typography.Text>
          <Typography.Text type="secondary">{line.inboundTag}</Typography.Text>
        </Space>
      ),
    },
    { title: t('adminControlPlane.status'), render: (_, line) => <Tag>{line.status}</Tag> },
    { title: t('adminControlPlane.projections'), render: (_, line) => `${line.projections.ready}/${line.projections.total}` },
    {
      title: t('adminControlPlane.trafficQuota'),
      render: (_, line) => formatTrafficLimit(line.limits.trafficLimitBytes, t('adminControlPlane.unlimited')),
    },
    {
      title: t('adminControlPlane.bandwidthLimits'),
      render: (_, line) => `${formatLimit(line.limits.uplinkLimitBps, t('adminControlPlane.unlimited'))} / ${formatLimit(line.limits.downlinkLimitBps, t('adminControlPlane.unlimited'))}`,
    },
    {
      title: t('adminControlPlane.connectionLimits'),
      render: (_, line) => `${formatCount(line.limits.maxConnections, t('adminControlPlane.unlimited'))} / ${formatCount(line.limits.ipLimit, t('adminControlPlane.unlimited'))}`,
    },
    {
      title: t('adminControlPlane.actions'),
      fixed: 'right',
      width: 190,
      render: (_, line) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(line)} disabled={!MUTABLE_STATUSES.has(line.status)}>{t('adminControlPlane.editLimits')}</Button>
          <Button type="link" icon={<SwapOutlined />} onClick={() => { setMigrationLine(line); migrationForm.setFieldsValue({ type: 'NODE_ONLY', targetNodeIds: [], targetExitId: '', reason: '' }); }}>{t('adminControlPlane.migrate')}</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {query.error && <Alert type="error" showIcon message={t('adminControlPlane.lineLimitsLoadFailed')} description={query.error instanceof Error ? query.error.message : undefined} style={{ marginBottom: 16 }} />}
      <Table
        aria-label={t('adminControlPlane.linesTitle')}
        rowKey="id"
        loading={query.isLoading}
        columns={columns}
        dataSource={query.data?.items ?? []}
        scroll={{ x: 1120 }}
        pagination={{
          current: query.data?.page ?? page,
          pageSize: PAGE_SIZE,
          total: query.data?.total ?? 0,
          hideOnSinglePage: true,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
      <Modal
        open={Boolean(selected)}
        title={t('adminControlPlane.editLimitsTitle', { email: selected?.customer.email ?? '' })}
        okText={t('confirm')}
        cancelText={t('cancel')}
        confirmLoading={update.isPending}
        onOk={() => form.submit()}
        onCancel={() => {
          if (!update.isPending) setSelected(null);
        }}
        afterClose={() => form.resetFields()}
        destroyOnClose
      >
        {update.error && <Alert type="error" showIcon message={t('adminControlPlane.lineLimitsUpdateFailed')} description={update.error instanceof Error ? update.error.message : undefined} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={(values) => update.mutate(values)}>
          <LimitField name="trafficLimitBytes" label={t('adminControlPlane.trafficLimitBytes')} />
          <LimitField name="uplinkLimitBps" label={t('adminControlPlane.uplinkLimitBps')} />
          <LimitField name="downlinkLimitBps" label={t('adminControlPlane.downlinkLimitBps')} />
          <LimitField name="maxConnections" label={t('adminControlPlane.maxConnections')} maximum={2_147_483_647} />
          <LimitField name="ipLimit" label={t('adminControlPlane.ipLimit')} maximum={2_147_483_647} />
          <Form.Item
            name="reason"
            label={t('adminControlPlane.reason')}
            rules={[{
              validator: (_, value: string | undefined) => value?.trim()
                ? Promise.resolve()
                : Promise.reject(new Error(t('adminControlPlane.reasonRequired'))),
            }]}
          >
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer open={Boolean(migrationLine)} width={560} title={t('adminControlPlane.migrationTitle', { email: migrationLine?.customer.email ?? '' })} onClose={() => { if (!createMigration.isPending && !actionMigration.isPending) setMigrationLine(null); }} destroyOnClose>
        {migrationsQuery.error && <Alert type="error" showIcon message={t('adminControlPlane.migrationLoadFailed')} description={migrationsQuery.error instanceof Error ? migrationsQuery.error.message : undefined} />}
        <Typography.Title level={5}>{t('adminControlPlane.createMigration')}</Typography.Title>
        <Form form={migrationForm} layout="vertical" onFinish={(values) => createMigration.mutate(values)}>
          <Form.Item name="type" label={t('adminControlPlane.migrationType')} rules={[{ required: true }]}><Radio.Group options={[{ value: 'NODE_ONLY', label: 'NODE_ONLY' }, { value: 'EXIT_ONLY', label: 'EXIT_ONLY' }, { value: 'FULL', label: 'FULL' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.type !== next.type}>
            {({ getFieldValue }) => getFieldValue('type') !== 'EXIT_ONLY' ? <Form.Item name="targetNodeIds" label={t('adminControlPlane.targetNodes')} rules={[{ required: true, type: 'array', min: 1 }]}><Select mode="multiple" loading={nodesQuery.isLoading} options={(nodesQuery.data ?? []).filter((node) => node.status === 'ACTIVE').map((node) => ({ value: node.id, label: `${node.code} / ${node.regionCode}` }))} /></Form.Item> : null}
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.type !== next.type}>
            {({ getFieldValue }) => getFieldValue('type') !== 'NODE_ONLY' ? <Form.Item name="targetExitId" label={t('adminControlPlane.targetExitId')} rules={[{ required: true }]}><Input placeholder="residential-exit-id" /></Form.Item> : null}
          </Form.Item>
          <Form.Item name="reason" label={t('adminControlPlane.reason')} rules={[{ required: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
          {createMigration.error && <Alert type="error" showIcon message={t('adminControlPlane.migrationCreateFailed')} description={createMigration.error instanceof Error ? createMigration.error.message : undefined} style={{ marginBottom: 12 }} />}
          <Button type="primary" htmlType="submit" loading={createMigration.isPending}>{t('adminControlPlane.createMigration')}</Button>
        </Form>
        <Typography.Title level={5} style={{ marginTop: 28 }}>{t('adminControlPlane.migrationHistory')}</Typography.Title>
        <Space direction="vertical" style={{ width: '100%' }}>
          {(migrationsQuery.data ?? []).map((item) => <Card key={item.id} size="small" title={`${item.type} / ${item.phase}`} extra={<Tag>{item.status}</Tag>}>
            <Typography.Paragraph type="secondary">{item.id}</Typography.Paragraph>
            <Typography.Text>{t('adminControlPlane.targetNodes')}: {item.targetNodes.map((node) => node.code).join(', ') || '-'}</Typography.Text>
            <br />
            <Space style={{ marginTop: 8 }}>
              {item.allowedActions.includes('COMMIT') && <Button type="primary" size="small" loading={actionMigration.isPending} onClick={() => actionMigration.mutate({ action: 'commit', migration: item })}>{t('adminControlPlane.commitMigration')}</Button>}
              {item.allowedActions.includes('CANCEL') && <Button danger size="small" loading={actionMigration.isPending} onClick={() => actionMigration.mutate({ action: 'cancel', migration: item })}>{t('adminControlPlane.cancelMigration')}</Button>}
            </Space>
          </Card>)}
          {!migrationsQuery.isLoading && (migrationsQuery.data ?? []).length === 0 && <Typography.Text type="secondary">{t('adminControlPlane.noMigrations')}</Typography.Text>}
        </Space>
      </Drawer>
    </>
  );
}

function LimitField({ name, label, maximum = Number.MAX_SAFE_INTEGER }: { name: Exclude<keyof LineLimitsForm, 'reason'>; label: string; maximum?: number }) {
  const { t } = useTranslation();
  return (
    <Form.Item name={name} label={label} extra={t('adminControlPlane.zeroMeansUnlimited')} rules={[{ required: true }]}>
      <InputNumber min={0} max={maximum} precision={0} style={{ width: '100%' }} />
    </Form.Item>
  );
}

function formatLimit(value: string, unlimited: string): string {
  return value === '0' ? unlimited : `${value} B/s`;
}

function formatTrafficLimit(value: string, unlimited: string): string {
  return value === '0' ? unlimited : `${value} B`;
}

function formatCount(value: number, unlimited: string): string {
  return value === 0 ? unlimited : String(value);
}

function editableLimit(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}
