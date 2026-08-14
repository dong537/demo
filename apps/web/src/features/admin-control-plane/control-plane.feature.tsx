import React from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { LineLimitsPanel } from './line-limits.feature';

export interface ControlNodeSummary {
  id: string;
  code: string;
  name: string;
  regionCode: string;
  nodeGroupId: string;
  baseUrl: string;
  status: 'ACTIVE' | 'DRAINING' | 'DISABLED';
  capacityUnits: number;
  allocatedUnits: number;
  lastHealthyAt: string | null;
}

export interface ControlPlaneReferences {
  nodeGroups: Array<{ id: string; code: string; name: string; regionCode: string }>;
  inboundProfiles: Array<{
    id: string;
    nodeGroupId: string;
    code: string;
    protocol: string;
    inboundTag: string;
    listenPort: number;
  }>;
}

export interface PlacementPolicySummary {
  id: string;
  nodeGroupId: string;
  inboundProfileId: string;
  mode: 'ACTIVE_ACTIVE' | 'HOT_STANDBY';
  targetReplicaCount: number;
  minReadyReplicaCount: number;
  maxUnitsPerNode: number;
  priority: number;
  isActive: boolean;
  allowedNodes?: Array<{ nodeId: string; node: { code: string } }>;
}

export function buildCreateNodeBody(values: Record<string, unknown>): Record<string, unknown> {
  return {
    code: String(values.code ?? '').trim(),
    name: String(values.name ?? '').trim(),
    regionCode: String(values.regionCode ?? '').trim().toUpperCase(),
    baseUrl: String(values.baseUrl ?? '').trim(),
    apiToken: String(values.apiToken ?? '').trim(),
    nodeGroupId: String(values.nodeGroupId ?? '').trim(),
    capacityUnits: Number(values.capacityUnits),
  };
}

export function buildCreatePolicyBody(values: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeGroupId: String(values.nodeGroupId ?? '').trim(),
    inboundProfileId: String(values.inboundProfileId ?? '').trim(),
    mode: values.mode === 'HOT_STANDBY' ? 'HOT_STANDBY' : 'ACTIVE_ACTIVE',
    targetReplicaCount: Number(values.targetReplicaCount),
    minReadyReplicaCount: Number(values.minReadyReplicaCount),
    maxUnitsPerNode: Number(values.maxUnitsPerNode),
    priority: Number(values.priority ?? 100),
    allowedNodeIds: Array.isArray(values.allowedNodeIds) ? values.allowedNodeIds.map((value) => String(value).trim()) : [],
  };
}

export function parseRouteImportPayload(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('route_import_payload_invalid');
  }
  return parsed as Record<string, unknown>;
}

export function AdminControlPlaneFeature() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [nodeForm] = Form.useForm();
  const [policyForm] = Form.useForm();
  const [routeForm] = Form.useForm();
  const selectedGroupId = Form.useWatch('nodeGroupId', policyForm);

  const nodesQuery = useQuery({
    queryKey: ['admin', 'control-plane', 'nodes'],
    queryFn: () => apiRequest<ControlNodeSummary[]>('/api/admin/control-plane/nodes'),
    retry: false,
  });
  const referencesQuery = useQuery({
    queryKey: ['admin', 'control-plane', 'references'],
    queryFn: () => apiRequest<ControlPlaneReferences>('/api/admin/control-plane/references'),
    retry: false,
  });
  const policiesQuery = useQuery({
    queryKey: ['admin', 'control-plane', 'policies'],
    queryFn: () => apiRequest<PlacementPolicySummary[]>('/api/admin/control-plane/placement-policies'),
    retry: false,
  });

  const createNode = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiRequest<ControlNodeSummary>('/api/admin/control-plane/nodes', {
      method: 'POST',
      body: JSON.stringify(buildCreateNodeBody(values)),
    }),
    onSuccess: async () => {
      nodeForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['admin', 'control-plane'] });
      void message.success(t('adminControlPlane.nodeCreated'));
    },
  });
  const createPolicy = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiRequest<PlacementPolicySummary>('/api/admin/control-plane/placement-policies', {
      method: 'POST',
      body: JSON.stringify(buildCreatePolicyBody(values)),
    }),
    onSuccess: async () => {
      policyForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['admin', 'control-plane', 'policies'] });
      void message.success(t('adminControlPlane.policyCreated'));
    },
  });
  const importRoutes = useMutation({
    mutationFn: (values: { payload: string }) => apiRequest<{ routeCount: number }>('/api/admin/delivery-routes/import', {
      method: 'POST',
      body: JSON.stringify(parseRouteImportPayload(values.payload)),
    }),
    onSuccess: (result) => {
      routeForm.resetFields();
      void message.success(t('adminControlPlane.routesImported', { count: result.routeCount }));
    },
  });

  const nodeColumns: ColumnsType<ControlNodeSummary> = [
    { title: t('adminControlPlane.nodeCode'), dataIndex: 'code' },
    { title: t('adminControlPlane.nodeName'), dataIndex: 'name' },
    { title: t('adminControlPlane.region'), dataIndex: 'regionCode' },
    { title: t('adminControlPlane.baseUrl'), dataIndex: 'baseUrl', ellipsis: true },
    { title: t('adminControlPlane.capacity'), render: (_, row) => `${row.allocatedUnits}/${row.capacityUnits}` },
    { title: t('adminControlPlane.status'), render: (_, row) => <Tag color={row.status === 'ACTIVE' ? 'green' : row.status === 'DRAINING' ? 'gold' : 'red'}>{row.status}</Tag> },
  ];
  const references = referencesQuery.data;
  const inboundOptions = (references?.inboundProfiles ?? [])
    .filter((profile) => !selectedGroupId || profile.nodeGroupId === selectedGroupId)
    .map((profile) => ({ value: profile.id, label: `${profile.code} / ${profile.protocol} :${profile.listenPort}` }));
  const error = nodesQuery.error ?? referencesQuery.error ?? policiesQuery.error;

  return (
    <div>
      <PageHeader
        kicker={t('adminControlPlane.kicker')}
        title={t('adminControlPlane.title')}
        description={t('adminControlPlane.description')}
        extra={<Button icon={<ReloadOutlined />} onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'control-plane'] })}>{t('refresh')}</Button>}
      />
      {error && <Alert type="error" showIcon message={t('adminControlPlane.loadFailed')} description={error instanceof Error ? error.message : undefined} style={{ marginBottom: 16 }} />}
      <Tabs
        items={[
          {
            key: 'lines',
            label: t('adminControlPlane.linesTab'),
            children: (
              <Card style={surfaceCardStyle()} title={t('adminControlPlane.linesTitle')}>
                <LineLimitsPanel />
              </Card>
            ),
          },
          {
            key: 'nodes',
            label: t('adminControlPlane.nodesTab'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card style={surfaceCardStyle()} title={t('adminControlPlane.addNodeTitle')}>
                  <Form form={nodeForm} layout="vertical" onFinish={(values) => createNode.mutate(values)}>
                    <Form.Item name="code" label={t('adminControlPlane.nodeCode')} rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
                    <Form.Item name="name" label={t('adminControlPlane.nodeName')} rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
                    <Form.Item name="regionCode" label={t('adminControlPlane.region')} rules={[{ required: true }]}><Input maxLength={8} placeholder="HK" /></Form.Item>
                    <Form.Item name="baseUrl" label={t('adminControlPlane.baseUrl')} rules={[{ required: true, type: 'url' }]}><Input placeholder="https://node.example.com" /></Form.Item>
                    <Form.Item name="nodeGroupId" label={t('adminControlPlane.nodeGroup')} rules={[{ required: true }]}><Select options={(references?.nodeGroups ?? []).map((group) => ({ value: group.id, label: `${group.code} / ${group.name}` }))} /></Form.Item>
                    <Form.Item name="capacityUnits" label={t('adminControlPlane.capacity')} initialValue={100} rules={[{ required: true }]}><InputNumber min={1} max={100000} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="apiToken" label={t('adminControlPlane.apiToken')} rules={[{ required: true }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={createNode.isPending}>{t('adminControlPlane.createNode')}</Button>
                  </Form>
                </Card>
                <Card style={surfaceCardStyle()} title={t('adminControlPlane.nodesTitle')}>
                  <Table rowKey="id" loading={nodesQuery.isLoading} columns={nodeColumns} dataSource={nodesQuery.data ?? []} scroll={{ x: 760 }} pagination={false} />
                </Card>
              </Space>
            ),
          },
          {
            key: 'policies',
            label: t('adminControlPlane.policiesTab'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card style={surfaceCardStyle()} title={t('adminControlPlane.addPolicyTitle')}>
                  <Form form={policyForm} layout="vertical" onFinish={(values) => createPolicy.mutate(values)}>
                    <Form.Item name="nodeGroupId" label={t('adminControlPlane.nodeGroup')} rules={[{ required: true }]}><Select options={(references?.nodeGroups ?? []).map((group) => ({ value: group.id, label: `${group.code} / ${group.name}` }))} /></Form.Item>
                    <Form.Item name="inboundProfileId" label={t('adminControlPlane.inboundProfile')} rules={[{ required: true }]}><Select options={inboundOptions} /></Form.Item>
                    <Form.Item name="allowedNodeIds" label={t('adminControlPlane.allowedNodes')} rules={[{ required: true, type: 'array', min: 1 }]}><Select mode="multiple" options={(nodesQuery.data ?? []).filter((node) => !selectedGroupId || node.nodeGroupId === selectedGroupId).map((node) => ({ value: node.id, label: `${node.code} / ${node.name}` }))} /></Form.Item>
                    <Form.Item name="mode" label={t('adminControlPlane.mode')} initialValue="ACTIVE_ACTIVE"><Select options={[{ value: 'ACTIVE_ACTIVE', label: 'ACTIVE_ACTIVE' }, { value: 'HOT_STANDBY', label: 'HOT_STANDBY' }]} /></Form.Item>
                    <Form.Item name="targetReplicaCount" label={t('adminControlPlane.targetReplicas')} initialValue={2} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="minReadyReplicaCount" label={t('adminControlPlane.minReadyReplicas')} initialValue={1} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="maxUnitsPerNode" label={t('adminControlPlane.maxUnitsPerNode')} initialValue={100} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="priority" label={t('adminControlPlane.priority')} initialValue={100} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={createPolicy.isPending}>{t('adminControlPlane.createPolicy')}</Button>
                  </Form>
                </Card>
                <Card style={surfaceCardStyle()} title={t('adminControlPlane.policiesTitle')}>
                  <Table rowKey="id" loading={policiesQuery.isLoading} pagination={false} scroll={{ x: 760 }} dataSource={policiesQuery.data ?? []} columns={[
                    { title: t('adminControlPlane.nodeGroup'), dataIndex: 'nodeGroupId', ellipsis: true },
                    { title: t('adminControlPlane.inboundProfile'), dataIndex: 'inboundProfileId', ellipsis: true },
                    { title: t('adminControlPlane.mode'), dataIndex: 'mode' },
                    { title: t('adminControlPlane.targetReplicas'), dataIndex: 'targetReplicaCount' },
                    { title: t('adminControlPlane.minReadyReplicas'), dataIndex: 'minReadyReplicaCount' },
                    { title: t('adminControlPlane.allowedNodes'), render: (_, row) => (row.allowedNodes ?? []).map((node) => node.node.code).join(', ') || '-' },
                    { title: t('adminControlPlane.status'), render: (_, row) => <Tag color={row.isActive ? 'green' : 'default'}>{row.isActive ? 'ACTIVE' : 'DISABLED'}</Tag> },
                  ] as ColumnsType<PlacementPolicySummary>} />
                </Card>
              </Space>
            ),
          },
          {
            key: 'routes',
            label: t('adminControlPlane.routesTab'),
            children: (
              <Card style={surfaceCardStyle()} title={t('adminControlPlane.routesTitle')}>
                <Typography.Paragraph type="secondary">{t('adminControlPlane.routesHint')}</Typography.Paragraph>
                <Form form={routeForm} layout="vertical" onFinish={(values) => importRoutes.mutate(values)}>
                  <Form.Item name="payload" label={t('adminControlPlane.routesPayload')} rules={[{ required: true }]}>
                    <Input.TextArea
                      autoSize={{ minRows: 12, maxRows: 28 }}
                      placeholder={'{\n  "sourceName": "ny-panel",\n  "sourceVersion": "2026-08-11",\n  "capturedAt": "2026-08-11T00:00:00.000Z",\n  "routes": []\n}'}
                    />
                  </Form.Item>
                  {importRoutes.error && <Alert type="error" showIcon message={t('adminControlPlane.routesImportFailed')} description={importRoutes.error instanceof Error ? importRoutes.error.message : undefined} />}
                  <Button type="primary" htmlType="submit" icon={<UploadOutlined />} loading={importRoutes.isPending}>{t('adminControlPlane.importRoutes')}</Button>
                </Form>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
