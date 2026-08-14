import React, { useState } from 'react';
import { Alert, Button, Card, Empty, InputNumber, Modal, Skeleton, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../shared/time/time';
import { listDedicatedLines, renewDedicatedLine, resumeDedicatedLine, suspendDedicatedLine } from './dedicated-line-api';
import './dedicated-line.css';

export function DedicatedLineListFeature() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['dedicated-lines'], queryFn: listDedicatedLines });
  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" showIcon message={t('error')} description={t('customer.dedicatedLines.reason.generic')} />;
  const lines = query.data ?? [];
  return (
    <div className="dedicated-line-workspace">
      <div className="dedicated-line-workspace-header">
        <div>
          <Typography.Text className="dedicated-line-eyebrow">{t('customer.dedicatedLines.list.eyebrow')}</Typography.Text>
          <Typography.Title level={2}>{t('customer.dedicatedLines.list.title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('customer.dedicatedLines.list.description')}</Typography.Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate({ to: '/customer/buy' } as never)}>{t('customer.dedicatedLines.list.newOrder')}</Button>
      </div>
      {lines.length === 0 ? <Card><Empty description={t('customer.dedicatedLines.list.empty')} /></Card> : (
        <div className="dedicated-line-list-grid">
          {lines.map((line) => <DedicatedLineCard key={line.id} line={line} t={t} />)}
        </div>
      )}
    </div>
  );
}

function DedicatedLineCard({ line, t }: { line: Awaited<ReturnType<typeof listDedicatedLines>>[number]; t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [renewOpen, setRenewOpen] = useState(false);
  const [durationDays, setDurationDays] = useState(30);
  const renewal = useMutation({
    mutationFn: () => renewDedicatedLine({ lineId: line.id, durationDays }),
    onSuccess: () => {
      setRenewOpen(false);
      message.success(t('customer.dedicatedLines.renew.success'));
      void queryClient.invalidateQueries({ queryKey: ['dedicated-lines'] });
    },
  });
  const lifecycle = useMutation({
    mutationFn: () => line.status === 'SUSPENDED' ? resumeDedicatedLine(line.id) : suspendDedicatedLine(line.id),
    onSuccess: (result) => {
      message.success(result.status === 'SUSPENDED'
        ? t('customer.dedicatedLines.lifecycle.suspended')
        : t('customer.dedicatedLines.lifecycle.resumed'));
      void queryClient.invalidateQueries({ queryKey: ['dedicated-lines'] });
    },
  });
  const statusKey = `customer.dedicatedLines.status.${line.status}`;
  const status = t(statusKey) === statusKey ? line.status : t(statusKey);
  return (
    <Card className="dedicated-line-card" title={<Space><Typography.Text strong>{line.countryCode} · {line.inboundTag}</Typography.Text><Tag color={line.status === 'ACTIVE' ? 'success' : line.status === 'DEGRADED' ? 'warning' : 'processing'}>{status}</Tag></Space>}>
      <div className="dedicated-line-card-meta">
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.protocol')}</Typography.Text>
        <Typography.Text>{line.protocol}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.expires')}</Typography.Text>
        <Typography.Text>{formatDateTime(line.expiresAt)}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.projections')}</Typography.Text>
        <Typography.Text>{line.projections.ready}/{line.projections.total}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.trafficLimit')}</Typography.Text>
        <Typography.Text>{formatTrafficLimit(line.limits.trafficLimitBytes, t)}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.bandwidthLimits')}</Typography.Text>
        <Typography.Text>{formatBandwidthLimit(line.limits.uplinkLimitBps, t)} / {formatBandwidthLimit(line.limits.downlinkLimitBps, t)}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.dedicatedLines.list.connectionLimits')}</Typography.Text>
        <Typography.Text>{formatCountLimit(line.limits.maxConnections, t)} / {formatCountLimit(line.limits.ipLimit, t)}</Typography.Text>
      </div>
      <Typography.Text type="secondary">{t('customer.dedicatedLines.list.domain')}</Typography.Text>
      {line.domains.length === 0 ? <Typography.Paragraph type="secondary">{t('customer.dedicatedLines.list.domainPending')}</Typography.Paragraph> : line.domains.map((domain) => (
        <Typography.Paragraph key={`${domain.hostname}:${domain.port}`} copyable={{ icon: <CopyOutlined /> }} className="dedicated-line-copy-line">
          {`${domain.hostname}:${domain.port}${domain.isPrimary ? ` · ${t('customer.dedicatedLines.list.primary')}` : ''}`}
        </Typography.Paragraph>
      ))}
      {line.client && (
        <div className="dedicated-line-client-box">
          <Typography.Text type="secondary">{t('customer.dedicatedLines.list.client')}</Typography.Text>
          <Typography.Paragraph copyable={{ text: line.client.id ?? line.client.user ?? line.client.email }} className="dedicated-line-copy-line">
            {line.client.id ?? line.client.user ?? line.client.email}
          </Typography.Paragraph>
        </div>
      )}
      <Space wrap>
        <Button
          type="link"
          onClick={() => lifecycle.mutate()}
          loading={lifecycle.isPending}
          disabled={!['ACTIVE', 'DEGRADED', 'SUSPENDED'].includes(line.status)}
        >
          {lifecycle.isPending
            ? t('customer.dedicatedLines.lifecycle.pending')
            : line.status === 'SUSPENDED'
              ? t('customer.dedicatedLines.lifecycle.resume')
              : t('customer.dedicatedLines.lifecycle.suspend')}
        </Button>
        <Button type="link" onClick={() => setRenewOpen(true)} disabled={['EXPIRED', 'CANCELLED', 'FAILED', 'SUSPENDED'].includes(line.status)}>{t('customer.dedicatedLines.renew.open')}</Button>
      </Space>
      {lifecycle.isError && <Alert type="error" showIcon message={t('customer.dedicatedLines.reason.generic')} />}
      <Modal
        title={t('customer.dedicatedLines.renew.title')}
        open={renewOpen}
        okText={t('customer.dedicatedLines.renew.submit')}
        cancelText={t('cancel')}
        confirmLoading={renewal.isPending}
        onCancel={() => setRenewOpen(false)}
        onOk={() => renewal.mutate()}
      >
        <Typography.Paragraph type="secondary">{t('customer.dedicatedLines.renew.description')}</Typography.Paragraph>
        <InputNumber min={1} max={3650} value={durationDays} onChange={(value) => setDurationDays(value ?? 30)} addonAfter={t('customer.dedicatedLines.renew.days')} />
        {renewal.isError && <Alert type="error" showIcon message={t('customer.dedicatedLines.reason.generic')} />}
      </Modal>
    </Card>
  );
}

function formatTrafficLimit(value: string, t: (key: string) => string): string {
  return value === '0' ? t('customer.dedicatedLines.list.unlimited') : `${value} B`;
}

function formatBandwidthLimit(value: string, t: (key: string) => string): string {
  return value === '0' ? t('customer.dedicatedLines.list.unlimited') : `${value} B/s`;
}

function formatCountLimit(value: number, t: (key: string) => string): string {
  return value === 0 ? t('customer.dedicatedLines.list.unlimited') : String(value);
}
