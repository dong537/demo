import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Dropdown, Empty, Form, Input, Modal, Popconfirm, Row, Skeleton, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest } from '../../shared/api/client';
import type { ApiError } from '../../shared/api/client';
import { formatDateTime } from '../../shared/time/time';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';

interface BrandConfig {
  brandName: string;
  name?: string;
  siteName?: string;
  logoUrl: string;
  primaryColor: string;
  supportEmail: string;
}

interface SiteBrandSource {
  name?: string;
  siteName?: string;
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  supportEmail?: string;
}

interface MaintenanceConfig {
  enabled: boolean;
  message: string;
}

interface AnnouncementDto {
  id: string;
  content: string;
  status: string;
  createdAt: string;
}

interface SiteEntity {
  name?: string;
  brandConfig?: SiteBrandSource | null;
  maintenanceMode?: boolean | null;
  maintenanceMessage?: string | null;
}

interface SiteTenant {
  name?: string;
  brandConfig?: SiteBrandSource | null;
}

interface SiteMaintenanceSource {
  enabled?: boolean;
  maintenanceMode?: boolean;
  message?: string | null;
  maintenanceMessage?: string | null;
}

interface SiteCurrentResponse {
  site?: SiteEntity | null;
  tenant?: SiteTenant | null;
  brand?: SiteBrandSource | null;
  maintenance?: SiteMaintenanceSource | null;
  announcements?: AnnouncementDto[] | null;
}

interface SiteConfig {
  brand: BrandConfig;
  maintenance: MaintenanceConfig;
  announcements: AnnouncementDto[];
}

export function normalizeSiteConfig(data?: SiteCurrentResponse | null): SiteConfig {
  const siteBrand = data?.site?.brandConfig ?? null;
  const tenantBrand = data?.tenant?.brandConfig ?? null;
  const legacyBrand = data?.brand ?? null;
  const mergedBrand = {
    ...(siteBrand ?? {}),
    ...(tenantBrand ?? {}),
    ...(legacyBrand ?? {}),
  };

  return {
    brand: {
      brandName: pickFirstText(
        mergedBrand.brandName,
        mergedBrand.siteName,
        mergedBrand.name,
        data?.tenant?.brandConfig?.brandName,
        data?.tenant?.brandConfig?.siteName,
        data?.tenant?.brandConfig?.name,
        data?.tenant?.name,
        data?.site?.brandConfig?.brandName,
        data?.site?.brandConfig?.siteName,
        data?.site?.brandConfig?.name,
        data?.site?.name,
      ),
      name: pickFirstText(mergedBrand.name, data?.tenant?.name, data?.site?.name),
      siteName: pickFirstText(mergedBrand.siteName, data?.tenant?.name, data?.site?.name),
      logoUrl: pickFirstText(mergedBrand.logoUrl),
      primaryColor: pickFirstText(mergedBrand.primaryColor),
      supportEmail: pickFirstText(mergedBrand.supportEmail),
    },
    maintenance: {
      enabled: Boolean(data?.maintenance?.enabled ?? data?.maintenance?.maintenanceMode ?? data?.site?.maintenanceMode),
      message: pickFirstText(data?.maintenance?.message, data?.maintenance?.maintenanceMessage, data?.site?.maintenanceMessage),
    },
    announcements: Array.isArray(data?.announcements) ? data.announcements : [],
  };
}

export function buildBrandUpdateBody(values: BrandConfig): Record<string, string> {
  return {
    brandName: values.brandName,
    name: values.brandName,
    siteName: values.brandName,
    logoUrl: values.logoUrl,
    primaryColor: values.primaryColor,
    supportEmail: values.supportEmail,
  };
}

function getReasonKey(error: unknown, fallback: string) {
  return (error as ApiError | undefined)?.reasonKey ?? fallback;
}

function statusColor(status: string) {
  if (status === 'ACTIVE') return 'green';
  if (status === 'INACTIVE' || status === 'DISABLED') return 'default';
  return 'blue';
}

function BrandTab({ brand }: { brand: BrandConfig }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  useEffect(() => { form.setFieldsValue(brand); }, [brand, form]);

  const mutation = useMutation({
    mutationFn: (values: BrandConfig) =>
      apiRequest('/api/sites/current/brand', { method: 'PUT', body: JSON.stringify(buildBrandUpdateBody(values)) }),
    onSuccess: () => {
      message.success(t('site.saveSuccess'));
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
  });

  return (
    <Row gutter={[16, 16]} align="top">
      <Col xs={24} lg={8}>
        <Card variant="borderless" style={surfaceCardStyle()}>
          <Descriptions
            title={t('site.brandSummary')}
            size="small"
            column={1}
            items={[
              { key: 'brandName', label: t('site.brandName'), children: brand.brandName || t('site.emptyValue') },
              { key: 'logoUrl', label: t('site.logoUrl'), children: brand.logoUrl || t('site.emptyValue') },
              { key: 'supportEmail', label: t('site.supportEmail'), children: brand.supportEmail || t('site.emptyValue') },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card variant="borderless" style={surfaceCardStyle()}>
          <Alert
            type="info"
            showIcon
            message={t('site.brandSource.title')}
            description={t('site.brandSource.description')}
            style={{ marginBottom: 16 }}
          />
          {mutation.error && (
            <Alert
              type="error"
              message={t('error')}
              description={getReasonKey(mutation.error, t('error'))}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
            <Form.Item name="brandName" label={t('site.brandName')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="logoUrl" label={t('site.logoUrl')}>
              <Input />
            </Form.Item>
            <Form.Item name="primaryColor" label={t('site.primaryColor')}>
              <Input />
            </Form.Item>
            <Form.Item name="supportEmail" label={t('site.supportEmail')}>
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>{t('submit')}</Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}

function MaintenanceTab({ maintenance }: { maintenance: MaintenanceConfig }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  useEffect(() => { form.setFieldsValue(maintenance); }, [maintenance, form]);

  const mutation = useMutation({
    mutationFn: (values: MaintenanceConfig) =>
      apiRequest('/api/sites/current/maintenance', { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => {
      message.success(t('site.saveSuccess'));
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
  });

  return (
    <Row gutter={[16, 16]} align="top">
      <Col xs={24} lg={8}>
        <Card variant="borderless" style={surfaceCardStyle()}>
          <Space direction="vertical" size={12}>
            <Tag color={maintenance.enabled ? 'orange' : 'green'}>
              {maintenance.enabled ? t('site.maintenanceStatus.enabled') : t('site.maintenanceStatus.disabled')}
            </Tag>
            <Typography.Text type="secondary">
              {maintenance.message || t('site.emptyValue')}
            </Typography.Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card variant="borderless" style={surfaceCardStyle()}>
          <Alert
            type="warning"
            showIcon
            message={t('site.maintenanceSource.title')}
            description={t('site.maintenanceSource.description')}
            style={{ marginBottom: 16 }}
          />
          {mutation.error && (
            <Alert
              type="error"
              message={t('error')}
              description={getReasonKey(mutation.error, t('error'))}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
            <Form.Item name="enabled" label={t('site.maintenanceEnabled')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="message" label={t('site.maintenanceMessage')}>
              <Input.TextArea rows={3} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>{t('submit')}</Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}

function AnnouncementsTab({ announcements }: { announcements: AnnouncementDto[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<AnnouncementDto | null>(null);
  const [form] = Form.useForm();

  const createMutation = useMutation({
    mutationFn: (values: { content: string }) =>
      apiRequest('/api/sites/current/announcements', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      message.success(t('site.announcements.createSuccess'));
      setModalOpen(false);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/sites/current/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      message.success(t('site.announcements.deactivateSuccess'));
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
  });

  const columns: ColumnsType<AnnouncementDto> = [
    { title: t('site.announcements.content'), dataIndex: 'content', key: 'content', ellipsis: true },
    {
      title: t('site.announcements.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={statusColor(status)}>
          {t(`site.announcements.statusValue.${status}`, { defaultValue: status })}
        </Tag>
      ),
    },
    { title: t('site.announcements.createdAt'), dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => formatDateTime(v) },
    {
      title: t('tenants.actions'),
      key: 'actions',
      render: (_: unknown, row: AnnouncementDto) =>
        row.status === 'ACTIVE' ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'deactivate', label: t('site.announcements.deactivate'), danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'deactivate') setDeactivating(row);
              },
            }}
          >
            <Button size="small" loading={deactivateMutation.isPending}>
              <Space size={4}>
                {t('site.announcements.operations.more')}
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        ) : null,
    },
  ];

  return (
    <>
      {(createMutation.error || deactivateMutation.error) && (
        <Alert
          type="error"
          message={t('error')}
          description={getReasonKey(createMutation.error ?? deactivateMutation.error, t('error'))}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Alert
        type="info"
        showIcon
        message={t('site.announcements.source.title')}
        description={t('site.announcements.source.description')}
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
        <Space wrap>
          <Tag color="blue">{t('site.announcements.summary.total', { total: announcements.length })}</Tag>
          <Tag color="green">
            {t('site.announcements.summary.active', {
              count: announcements.filter((item) => item.status === 'ACTIVE').length,
            })}
          </Tag>
        </Space>
        <Button type="primary" onClick={() => setModalOpen(true)}>{t('site.announcements.create')}</Button>
      </Space>
      <Card variant="borderless" style={surfaceCardStyle({ overflow: 'hidden' })} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={announcements}
          columns={columns}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: <Empty description={t('site.announcements.empty')} /> }}
          scroll={{ x: 'max-content' }}
        />
      </Card>
      <Popconfirm
        title={t('site.announcements.deactivateConfirm')}
        okButtonProps={{ danger: true }}
        okText={t('site.announcements.deactivate')}
        open={deactivating !== null}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => {
          if (!deactivating) return;
          deactivateMutation.mutate(deactivating.id, { onSuccess: () => setDeactivating(null) });
        }}
      >
        <span />
      </Popconfirm>
      <Modal
        title={t('site.announcements.create')}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
          <Form.Item name="content" label={t('site.announcements.content')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function SiteConfigFeature() {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['site'],
    queryFn: async () => normalizeSiteConfig(await apiRequest<SiteCurrentResponse>('/api/sites/current')),
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.error) {
    const err = query.error as ApiError;
    return <Alert type="error" message={t('error')} description={err.reasonKey} showIcon />;
  }

  const d = query.data ?? normalizeSiteConfig();
  return (
    <>
      <PageHeader
        kicker={t('site.kicker')}
        title={t('site.title')}
        description={t('site.description')}
      />
      <Alert
        type="info"
        showIcon
        message={t('site.source.title')}
        description={t('site.source.description')}
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card variant="borderless" style={surfaceCardStyle()}>
            <Typography.Text type="secondary">{t('site.brandName')}</Typography.Text>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              {d.brand.brandName || t('site.emptyValue')}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card variant="borderless" style={surfaceCardStyle()}>
            <Typography.Text type="secondary">{t('site.maintenanceEnabled')}</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <Tag color={d.maintenance.enabled ? 'orange' : 'green'}>
                {d.maintenance.enabled ? t('site.maintenanceStatus.enabled') : t('site.maintenanceStatus.disabled')}
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card variant="borderless" style={surfaceCardStyle()}>
            <Typography.Text type="secondary">{t('site.tabAnnouncements')}</Typography.Text>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>{d.announcements.length}</Typography.Title>
          </Card>
        </Col>
      </Row>
      <Tabs
        items={[
          { key: 'brand', label: t('site.tabBrand'), children: <BrandTab brand={d.brand} /> },
          { key: 'maintenance', label: t('site.tabMaintenance'), children: <MaintenanceTab maintenance={d.maintenance} /> },
          { key: 'announcements', label: t('site.tabAnnouncements'), children: <AnnouncementsTab announcements={d.announcements} /> },
        ]}
      />
    </>
  );
}

function pickFirstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return '';
}
