import React, { useState } from 'react';
import { Alert, DatePicker, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { ListPage } from '../../shared/ui/list-page';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { formatDateTime } from '../../shared/time/time';
import { formatMoneyAmount, parseMoneyAmount } from '../../shared/money/money';

type Translate = (key: string, values?: Record<string, unknown>) => string;

interface LedgerEntryDto {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  reason: string | null;
  createdAt: string;
}

export function CustomerLedgerListFeature() {
  const { t } = useTranslation();
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [type, setType] = useState<string | undefined>();
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();

  const query = useQuery({
    queryKey: ['customer-ledger', userId, page, pageSize, type, from, to],
    queryFn: () =>
      userApiRequest<{ page: number; pageSize: number; total: number; items: LedgerEntryDto[] }>(
        `/api/wallet/${encodeURIComponent(userId)}/ledger${buildQuery({ page, pageSize, type, from, to })}`,
      ),
    enabled: !!userId,
  });

  if (currentQuery.isLoading) return <Skeleton active />;
  if (currentQuery.error) {
    const apiErr = currentQuery.error as ApiError;
    const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatLedgerError(currentQuery.error, t)}
        showIcon
      />
    );
  }

  const columns: ColumnsType<LedgerEntryDto> = [
    {
      title: t('customer.ledger.record'),
      dataIndex: 'type',
      key: 'type',
      render: (_: string, row) => {
        const reasonLabel = formatCustomerLedgerReason(row, t);
        return (
          <div className="ipx-ledger-meta-stack">
            <Space size={8} wrap>
              <Tag color={ledgerDirectionColor(row.amount)}>{formatLedgerDirection(row.amount, t)}</Tag>
              <Tag color={ledgerTypeColor(row.type)}>{formatCustomerLedgerType(row.type, t)}</Tag>
              <Typography.Text type="secondary">{formatDateTime(row.createdAt)}</Typography.Text>
            </Space>
            <div className="ipx-ledger-reason">
              <Typography.Text className="ipx-ledger-reason-title">{reasonLabel}</Typography.Text>
              <Typography.Text type="secondary" className="ipx-ledger-row-note">
                {t('customer.ledger.transactionNo', { id: formatLedgerShortId(row.id) })}
              </Typography.Text>
            </div>
          </div>
        );
      },
    },
    {
      title: t('ledger.amount'),
      dataIndex: 'amount',
      key: 'amount',
      render: (_: string, row) => {
        const n = parseMoneyAmount(row.amount) ?? 0;
        const display = formatMoneyAmount(row.amount, row.currency) ?? row.amount;
        return (
          <Space direction="vertical" size={2} align="end">
            <Typography.Text className={n >= 0 ? 'ipx-ledger-amount is-credit' : 'ipx-ledger-amount is-debit'} strong>
              {display}
            </Typography.Text>
            <Typography.Text type="secondary" className="ipx-ledger-row-note">
              {t('ledger.balanceAfter')}: {formatMoneyAmount(row.balanceAfter, row.currency) ?? row.balanceAfter}
            </Typography.Text>
          </Space>
        );
      },
    },
  ];
  const toolbar = (
    <div className="ipx-wallet-ledger-toolbar ipx-customer-toolbar">
      <Space className="ipx-wallet-ledger-toolbar-title" align="center" size={8}>
        <FilterOutlined />
        <Typography.Text strong>{t('customer.ledger.typeFilter')}</Typography.Text>
      </Space>
      <Space className="ipx-wallet-ledger-filter-controls" wrap>
        <Select
          placeholder={t('customer.ledger.typeFilter')}
          allowClear
          size="middle"
          style={{ width: 160 }}
          onChange={(v) => { setType(v); setPage(1); }}
          options={[
            { value: '', label: t('customer.ledger.allTypes') },
            { value: 'DEPOSIT', label: formatCustomerLedgerType('DEPOSIT', t) },
            { value: 'DEBIT', label: formatCustomerLedgerType('DEBIT', t) },
            { value: 'REFUND', label: formatCustomerLedgerType('REFUND', t) },
            { value: 'ADJUSTMENT', label: formatCustomerLedgerType('ADJUSTMENT', t) },
            { value: 'FREEZE', label: formatCustomerLedgerType('FREEZE', t) },
            { value: 'UNFREEZE', label: formatCustomerLedgerType('UNFREEZE', t) },
            { value: 'RENEWAL', label: formatCustomerLedgerType('RENEWAL', t) },
            { value: 'COMMISSION', label: formatCustomerLedgerType('COMMISSION', t) },
          ]}
        />
        <DatePicker.RangePicker
          size="middle"
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
    <div className="ipx-wallet-ledger-page ipx-wallet-page ipx-customer-page ipx-customer-ledger-page">
      <ListPage
        query={query}
        columns={columns}
        toolbar={toolbar}
        rowKey="id"
        emptyText={t('customer.ledger.empty')}
        errorDescription={(error) => formatLedgerError(error, t)}
        pagination={{
          page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </div>
  );
}

function formatCustomerLedgerType(type: string, t: Translate): string {
  if (type === 'DEPOSIT') return '充值';
  if (type === 'DEBIT') return '消费';
  if (type === 'REFUND') return '退款';
  if (type === 'ADJUSTMENT') return '其他变动';
  if (type === 'FREEZE') return '处理中';
  if (type === 'UNFREEZE') return '余额恢复';
  if (type === 'RENEWAL') return '续费';
  if (type === 'COMMISSION') return '奖励';
  return t('customer.ledger.typeUnknown');
}

function formatLedgerError(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t('error');
  if (error.reasonKey === 'PERMISSION_DENIED') return t('permissionDenied');
  return '账单暂时无法读取，请稍后重试或联系客服。';
}

function formatLedgerDirection(amount: string, t: Translate): string {
  const value = parseMoneyAmount(amount);
  if (value === null || value === 0) return t('customer.ledger.direction.neutral');
  return value > 0 ? t('customer.ledger.direction.credit') : t('customer.ledger.direction.debit');
}

function ledgerDirectionColor(amount: string): string {
  const value = parseMoneyAmount(amount);
  if (value === null || value === 0) return 'default';
  return value > 0 ? 'success' : 'error';
}

function ledgerTypeColor(type: string): string {
  if (type === 'DEPOSIT' || type === 'REFUND' || type === 'COMMISSION') return 'success';
  if (type === 'DEBIT' || type === 'RENEWAL') return 'processing';
  if (type === 'FREEZE') return 'warning';
  if (type === 'ADJUSTMENT' || type === 'UNFREEZE') return 'blue';
  return 'default';
}

function formatCustomerLedgerReason(row: LedgerEntryDto, t: Translate): string {
  const reasonKey = normalizeCustomerLedgerReason(row.reason);
  if (reasonKey) {
    const translationKey = `customer.ledger.reasonValue.${reasonKey}`;
    const label = t(translationKey);
    if (label !== translationKey) return label;
  }

  const value = parseMoneyAmount(row.amount);
  if (value === null || value === 0) return t('customer.ledger.reasonFallback.neutral');
  return value > 0 ? t('customer.ledger.reasonFallback.income') : t('customer.ledger.reasonFallback.expense');
}

function normalizeCustomerLedgerReason(reason: string | null): string | null {
  if (!reason) return null;
  const value = reason.trim();
  if (!value) return null;
  if (value === 'manual topup') return 'manual_topup';
  if (value === 'order debit') return 'static_proxy_order';
  if (/^[a-z0-9_]+$/i.test(value)) return value;
  return null;
}

function formatLedgerShortId(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  if (!compact) return id;
  return compact.length <= 8 ? compact : compact.slice(-8);
}
