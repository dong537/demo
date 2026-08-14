import React, { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Empty, Input, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { apiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { formatDateTime } from '../../shared/time/time';
import { formatMoneyAmount, parseMoneyAmount } from '../../shared/money/money';
import { WalletAdjustModal, type WalletSummary } from './wallet-adjust-modal.feature';
import { FulfillmentDetail } from '../admin-orders/fulfillment-detail.feature';

interface LedgerEntryDto {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  relatedId: string | null;
  reason: string | null;
  createdAt: string;
}

interface AdjustmentPreset {
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
}

interface LedgerListFeatureProps {
  initialUserId?: string;
}

export function LedgerListFeature({ initialUserId = '' }: LedgerListFeatureProps = {}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState(initialUserId);
  const [userIdInput, setUserIdInput] = useState(initialUserId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [type, setType] = useState<string | undefined>();
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPreset, setAdjustPreset] = useState<AdjustmentPreset | undefined>();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const walletQuery = useQuery({
    queryKey: ['wallet', userId],
    queryFn: () =>
      apiRequest<WalletSummary>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const query = useQuery({
    queryKey: ['ledger', userId, page, pageSize, type, from, to],
    queryFn: () =>
      apiRequest<{ page: number; pageSize: number; total: number; items: LedgerEntryDto[] }>(
        `/api/wallet/${encodeURIComponent(userId)}/ledger${buildQuery({ page, pageSize, type, from, to })}`,
      ),
    enabled: !!userId,
  });

  const columns: ColumnsType<LedgerEntryDto> = [
    {
      title: t('ledger.entry'),
      dataIndex: 'type',
      key: 'type',
      render: (_: string, row) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Tag color={ledgerTypeColor(row.type)}>{formatLedgerType(row.type, t)}</Tag>
            <Typography.Text type="secondary" copyable={{ text: row.id }}>{shortId(row.id)}</Typography.Text>
          </Space>
          <Typography.Text type="secondary">{formatDateTime(row.createdAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('ledger.amount'),
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (_: string, row) => {
        const amount = parseMoneyAmount(row.amount) ?? 0;
        return (
          <Space direction="vertical" size={2} align="end">
            <Typography.Text strong style={{ color: amount >= 0 ? '#389e0d' : '#cf1322' }}>
              {formatMoneyAmount(row.amount, row.currency) ?? row.amount}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('ledger.balanceAfter')}: {formatMoneyAmount(row.balanceAfter, row.currency) ?? row.balanceAfter}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: t('ledger.relatedId'),
      dataIndex: 'relatedId',
      key: 'relatedId',
      render: (value: string | null) =>
        value ? (
          <Button type="link" size="small" onClick={() => setSelectedOrderId(value)}>
            {shortId(value)}
          </Button>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: t('ledger.reason'),
      dataIndex: 'reason',
      key: 'reason',
      render: (value: string | null, row) => {
        const reason = formatLedgerReason(value, row, t);
        return reason ? (
          <Tooltip title={reason}>
            <Typography.Text style={{ maxWidth: 260 }} ellipsis>
              {reason}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        );
      },
    },
    {
      title: t('ledger.actions'),
      key: 'actions',
      render: (_: unknown, row) => (
        <Tooltip title={canReverse(row) ? t('ledger.reverse.reason', { ledgerId: row.id }) : undefined}>
          <Button size="small" danger disabled={!canReverse(row)} onClick={() => openReverseAdjustment(row)}>
            {t('ledger.reverse.button')}
          </Button>
        </Tooltip>
      ),
    },
  ];

  const toolbar = (
    <div
      style={{
        background: 'var(--ipx-surface)',
        border: '1px solid var(--ipx-border)',
        borderRadius: 'var(--ipx-radius)',
        padding: 12,
        marginBottom: 16,
      }}
    >
      <Space wrap size={8}>
        <Input.Search
          placeholder={t('ledger.userIdPlaceholder')}
          value={userIdInput}
          onChange={(event) => setUserIdInput(event.target.value)}
          onSearch={(v) => {
            const nextUserId = v.trim();
            setUserId(nextUserId);
            setUserIdInput(nextUserId);
            setPage(1);
          }}
          allowClear
          style={{ width: 240 }}
        />
        <Select
          placeholder={t('ledger.typeFilter')}
          allowClear
          style={{ width: 160 }}
          onChange={(v) => { setType(v); setPage(1); }}
          options={[
            { value: '', label: t('ledger.allTypes') },
            { value: 'DEPOSIT', label: formatLedgerType('DEPOSIT', t) },
            { value: 'DEBIT', label: formatLedgerType('DEBIT', t) },
            { value: 'REFUND', label: formatLedgerType('REFUND', t) },
            { value: 'ADJUSTMENT', label: formatLedgerType('ADJUSTMENT', t) },
            { value: 'FREEZE', label: formatLedgerType('FREEZE', t) },
            { value: 'UNFREEZE', label: formatLedgerType('UNFREEZE', t) },
            { value: 'RENEWAL', label: formatLedgerType('RENEWAL', t) },
            { value: 'COMMISSION', label: formatLedgerType('COMMISSION', t) },
          ]}
        />
        <DatePicker.RangePicker
          placeholder={[t('ledger.from'), t('ledger.to')]}
          onChange={(_, s) => {
            setFrom(s[0] || undefined);
            setTo(s[1] || undefined);
            setPage(1);
          }}
        />
      </Space>
    </div>
  );

  return (
    <div className="ipx-wallet-admin-ledger-page ipx-wallet-page">
      <Typography.Title level={4}>{t('ledger.title')}</Typography.Title>
      {userId && walletQuery.isError && (
        <Alert
          type={
            walletQuery.error instanceof ApiError &&
            (walletQuery.error.code === 'PERMISSION_DENIED' || walletQuery.error.code === 403)
              ? 'warning'
              : 'error'
          }
          message={t('error')}
          description={
            walletQuery.error instanceof ApiError ? walletQuery.error.reasonKey : t('error')
          }
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {userId && walletQuery.data && (
        <Card className="ipx-wallet-admin-hero ipx-wallet-hero" size="small" style={{ marginBottom: 16 }} loading={walletQuery.isLoading}>
          <Row gutter={16} align="middle">
            <Col flex="auto">
              <Statistic
                title={t('ledger.adjust.available')}
                value={formatMoneyAmount(walletQuery.data.available, walletQuery.data.currency) ?? '-'}
              />
            </Col>
            <Col flex="auto">
              <Statistic
                title={t('ledger.adjust.frozen')}
                value={formatMoneyAmount(walletQuery.data.frozen, walletQuery.data.currency) ?? '-'}
              />
            </Col>
            <Col flex="auto">
              <Statistic
                title={t('payments.userId')}
                value={shortId(walletQuery.data.userId)}
              />
            </Col>
            <Col flex="auto">
              <Statistic
                title={t('ledger.updatedAt')}
                value={formatDateTime(walletQuery.data.updatedAt)}
              />
            </Col>
            <Col>
              <Button type="primary" danger onClick={() => openAdjustment()}>
                {t('ledger.adjust.button')}
              </Button>
            </Col>
          </Row>
        </Card>
      )}
      {userId ? (
        <ListPage
          query={query}
          columns={columns}
          toolbar={toolbar}
          rowKey="id"
          emptyText={t('ledger.empty')}
          pagination={{
            page,
            pageSize,
            total: query.data?.total ?? 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      ) : (
        <>
          <div className="ipx-list-toolbar ipx-wallet-toolbar">{toolbar}</div>
          <Card className="ipx-surface-card ipx-wallet-table-card" variant="borderless">
            <Empty description={t('ledger.userIdPlaceholder')} />
          </Card>
        </>
      )}
      {selectedOrderId && (
        <FulfillmentDetail orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      )}
      {walletQuery.data && (
        <WalletAdjustModal
          wallet={walletQuery.data}
          open={adjustOpen}
          initialValues={adjustPreset}
          onClose={() => {
            setAdjustOpen(false);
            setAdjustPreset(undefined);
          }}
        />
      )}
    </div>
  );

  function openAdjustment() {
    setAdjustPreset(undefined);
    setAdjustOpen(true);
  }

  function openReverseAdjustment(row: LedgerEntryDto) {
    const amount = Math.abs(Number(row.amount));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setAdjustPreset({
      direction: Number(row.amount) >= 0 ? 'debit' : 'credit',
      amount,
      reason: t('ledger.reverse.reason', { ledgerId: row.id }),
    });
    setAdjustOpen(true);
  }
}

function canReverse(row: LedgerEntryDto): boolean {
  const amount = Math.abs(Number(row.amount));
  return Number.isFinite(amount) && amount > 0;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatLedgerType(type: string, t: (key: string) => string): string {
  const label = t(`ledger.typeValue.${type}`);
  return label === `ledger.typeValue.${type}` ? type : label;
}

function formatLedgerReason(reason: string | null, row: LedgerEntryDto, t: (key: string) => string): string | null {
  const normalized = reason?.trim();
  if (!normalized) return null;

  const mapped = t(`ledger.reasonValue.${normalized}`);
  if (mapped !== `ledger.reasonValue.${normalized}`) return mapped;

  if (/^[a-z0-9_]+$/i.test(normalized)) {
    const amount = parseMoneyAmount(row.amount) ?? 0;
    if (amount > 0 || row.type === 'DEPOSIT' || row.type === 'REFUND' || row.type === 'COMMISSION') {
      return t('ledger.reasonFallback.income');
    }
    if (amount < 0 || row.type === 'DEBIT' || row.type === 'RENEWAL') {
      return t('ledger.reasonFallback.expense');
    }
    return t('ledger.reasonFallback.neutral');
  }

  return normalized;
}

function ledgerTypeColor(type: string): string {
  if (type === 'DEPOSIT' || type === 'REFUND' || type === 'COMMISSION') return 'success';
  if (type === 'DEBIT' || type === 'RENEWAL') return 'processing';
  if (type === 'FREEZE') return 'warning';
  if (type === 'ADJUSTMENT' || type === 'UNFREEZE') return 'blue';
  return 'default';
}
