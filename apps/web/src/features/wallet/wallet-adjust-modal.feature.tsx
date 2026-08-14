import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Radio, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiError, userApiRequest } from '../../shared/api/client';
import { formatMoneyAmount, parseMoneyAmount } from '../../shared/money/money';

export interface WalletSummary {
  id: string;
  userId: string;
  available: string;
  frozen: string;
  currency: string;
  updatedAt: string;
}

export interface AdjustWalletBody {
  direction: 'credit' | 'debit';
  amount: string;
  currency: string;
  reason: string;
  idempotencyKey: string;
}

interface AdjustFormValues {
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
}

export function buildAdjustWalletPath(userId: string): string {
  return `/api/wallet/${encodeURIComponent(userId)}/adjust`;
}

export function buildAdjustWalletBody(input: {
  direction: 'credit' | 'debit';
  amount: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
}): AdjustWalletBody {
  return {
    direction: input.direction,
    amount: String(input.amount),
    currency: input.currency,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
  };
}

interface WalletAdjustModalProps {
  wallet: WalletSummary;
  open: boolean;
  onClose: () => void;
  onAdjusted?: (wallet: WalletSummary) => void;
  initialValues?: Partial<AdjustFormValues>;
  adjustPath?: string;
  requestMode?: 'admin' | 'user';
  invalidateQueryKeys?: unknown[][];
}

export function WalletAdjustModal({
  wallet,
  open,
  onClose,
  onAdjusted,
  initialValues,
  adjustPath,
  requestMode = 'admin',
  invalidateQueryKeys,
}: WalletAdjustModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form] = Form.useForm<AdjustFormValues>();
  const direction = Form.useWatch('direction', form);
  const amount = Form.useWatch('amount', form);
  const [actionError, setActionError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const amountPreview = buildAdjustmentPreview({
    amount,
    currency: wallet.currency,
    direction: direction ?? 'credit',
  });

  useEffect(() => {
    if (open) {
      setIdempotencyKey(globalThis.crypto.randomUUID());
      setActionError(null);
      form.setFieldsValue({
        direction: initialValues?.direction ?? 'credit',
        amount: initialValues?.amount,
        reason: initialValues?.reason,
      });
    }
  }, [form, initialValues, open]);

  const mutation = useMutation({
    mutationFn: (values: AdjustFormValues) =>
      (requestMode === 'user' ? userApiRequest : apiRequest)<WalletSummary>(adjustPath ?? buildAdjustWalletPath(wallet.userId), {
        method: 'POST',
        body: JSON.stringify(
          buildAdjustWalletBody({
            direction: values.direction,
            amount: values.amount,
            currency: wallet.currency,
            reason: values.reason,
            idempotencyKey,
          }),
        ),
      }),
    onSuccess: (updatedWallet) => {
      setActionError(null);
      form.resetFields();
      onAdjusted?.(updatedWallet);
      const keys = invalidateQueryKeys ?? [
        ['wallet', wallet.userId],
        ['ledger', wallet.userId],
      ];
      for (const queryKey of keys) {
        void qc.invalidateQueries({ queryKey });
      }
      onClose();
    },
    onError: (error) => {
      if (requestMode === 'user') {
        setActionError(t('customer.reseller.genericActionFailed'));
        return;
      }
      setActionError(formatWalletAdjustError(error, t));
    },
  });

  const close = () => {
    form.resetFields();
    setActionError(null);
    onClose();
  };

  return (
    <Modal
      className="ipx-wallet-adjust-modal"
      title={t('ledger.adjust.title')}
      open={open}
      onCancel={close}
      footer={null}
      destroyOnClose
    >
      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: 16 }}
        items={[
          { key: 'user', label: t('payments.userId'), children: wallet.userId },
          { key: 'available', label: t('ledger.adjust.available'), children: formatMoneyAmount(wallet.available, wallet.currency) ?? '-' },
          { key: 'frozen', label: t('ledger.adjust.frozen'), children: formatMoneyAmount(wallet.frozen, wallet.currency) ?? '-' },
        ]}
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
      <Form
        form={form}
        layout="vertical"
        initialValues={{ direction: initialValues?.direction ?? 'credit', ...initialValues }}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item
          name="direction"
          label={t('ledger.adjust.direction')}
          rules={[{ required: true }]}
        >
          <Radio.Group>
            <Radio.Button value="credit">{t('ledger.adjust.credit')}</Radio.Button>
            <Radio.Button value="debit">{t('ledger.adjust.debit')}</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="amount"
          label={t('ledger.adjust.amount')}
          rules={[
            { required: true, message: t('ledger.adjust.amountRequired') },
            {
              validator: (_, value) =>
                value !== undefined && value !== null && Number(value) > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('ledger.adjust.amountInvalid'))),
            },
          ]}
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter={wallet.currency} />
        </Form.Item>
        {amountPreview && (
          <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
            {amountPreview}
          </Typography.Paragraph>
        )}
        <Form.Item
          name="reason"
          label={t('ledger.adjust.reason')}
          rules={[{ required: true, message: t('ledger.adjust.reasonRequired') }]}
        >
          <Input.TextArea
            rows={3}
            placeholder={t('ledger.adjust.reasonPlaceholder')}
            maxLength={500}
          />
        </Form.Item>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={close}>{t('cancel')}</Button>
          <Popconfirm
            title={t('ledger.adjust.confirmTitle')}
            description={t('ledger.adjust.confirmDesc')}
            okText={t('ledger.adjust.submit')}
            okButtonProps={{ danger: true }}
            cancelText={t('cancel')}
            onConfirm={() => form.submit()}
          >
            <Button type="primary" danger loading={mutation.isPending}>
              {t('ledger.adjust.submit')}
            </Button>
          </Popconfirm>
        </Space>
      </Form>
    </Modal>
  );
}

function buildAdjustmentPreview(input: {
  direction: 'credit' | 'debit';
  amount: number | undefined;
  currency: string;
}): string | null {
  const amount = parseMoneyAmount(input.amount);
  if (amount === null || amount <= 0) return null;
  const signedAmount = input.direction === 'debit' ? -amount : amount;
  return formatMoneyAmount(signedAmount, input.currency);
}

function formatWalletAdjustError(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('error');
  const translated = t(`ledger.adjust.reasonValue.${error.reasonKey}`);
  if (translated !== `ledger.adjust.reasonValue.${error.reasonKey}` && translated !== error.reasonKey) return translated;
  return t('ledger.adjust.reasonValue.generic');
}
