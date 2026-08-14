import React, { useEffect, useState } from 'react';
import { Alert, Button, Dropdown, Form, Input, Modal, Space, Typography, message } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { components } from '@ipeasy/contracts';
import type { MenuProps } from 'antd';
import { apiRequest, ApiError } from '../../shared/api/client';

export type AdminOrderOperation = 'retry-fulfillment' | 'refund' | 'manual-complete';

export interface OperableOrder {
  id: string;
  status: string;
}

type AdminOrderOperationResult = components['schemas']['AdminOrderOperationResultDto'];
type AdminOrderOperationMenuKey = `extra:${string}` | `operation:${AdminOrderOperation}`;

interface OperationFormValues {
  reason?: string;
}

interface AdminOrderOperationsProps {
  order: OperableOrder;
  extraItems?: Array<{
    key: string;
    label: React.ReactNode;
    onClick: () => void;
  }>;
}

const RETRYABLE_STATUSES = new Set(['FAILED']);
const MUTABLE_STATUSES = new Set(['FAILED', 'PENDING', 'FULFILLING']);

export function buildAdminOrderOperationPath(orderId: string, operation: AdminOrderOperation) {
  return `/api/orders/${encodeURIComponent(orderId)}/${operation}`;
}

export function getAvailableAdminOrderOperations(status: string): AdminOrderOperation[] {
  const operations: AdminOrderOperation[] = [];
  if (RETRYABLE_STATUSES.has(status)) operations.push('retry-fulfillment');
  if (MUTABLE_STATUSES.has(status)) {
    operations.push('refund');
    operations.push('manual-complete');
  }
  return operations;
}

export function AdminOrderOperations({ order, extraItems = [] }: AdminOrderOperationsProps) {
  const { t } = useTranslation();
  const availableOperations = getAvailableAdminOrderOperations(order.status);
  const [activeOperation, setActiveOperation] = useState<AdminOrderOperation | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (availableOperations.length === 0 && extraItems.length === 0) return null;

  const menuItems: MenuProps['items'] = [
    ...extraItems.map((item) => ({
      key: buildExtraMenuKey(item.key),
      label: item.label,
    })),
    ...(extraItems.length > 0 && availableOperations.length > 0 ? [{ type: 'divider' as const }] : []),
    ...availableOperations.map((operation) => ({
      key: buildOperationMenuKey(operation),
      label: t(`adminOrders.operations.${operation}.button`),
      danger: operation === 'refund',
    })),
  ];

  if (menuItems.length === 0) return null;

  return (
    <>
      <Dropdown
        open={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        trigger={['click']}
        menu={{
          items: menuItems,
          selectable: false,
          onClick: ({ key }) => {
            setIsMenuOpen(false);
            const extraKey = getExtraMenuItemKey(key);
            if (extraKey) {
              const extra = extraItems.find((item) => item.key === extraKey);
              if (!extra) return;
              extra.onClick();
              return;
            }
            const operation = getOperationMenuItemKey(key);
            if (operation) {
              setActiveOperation(operation);
              return;
            }
            const extra = extraItems.find((item) => item.key === key);
            if (extra) {
              extra.onClick();
              return;
            }
            if (isAdminOrderOperation(key)) setActiveOperation(key);
          },
        }}
      >
        <Button
          size="small"
          aria-label={t('adminOrders.operations.more')}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
        >
          <Space size={4}>
            {t('adminOrders.operations.more')}
            <DownOutlined />
          </Space>
        </Button>
      </Dropdown>
      {activeOperation && (
        <AdminOrderOperationModal
          order={order}
          operation={activeOperation}
          onClose={() => setActiveOperation(null)}
        />
      )}
    </>
  );
}

function buildExtraMenuKey(key: string): AdminOrderOperationMenuKey {
  return `extra:${key}`;
}

function buildOperationMenuKey(operation: AdminOrderOperation): AdminOrderOperationMenuKey {
  return `operation:${operation}`;
}

function getExtraMenuItemKey(value: string): string | null {
  return value.startsWith('extra:') ? value.slice('extra:'.length) : null;
}

function getOperationMenuItemKey(value: string): AdminOrderOperation | null {
  if (!value.startsWith('operation:')) return null;
  const operation = value.slice('operation:'.length);
  return isAdminOrderOperation(operation) ? operation : null;
}

function isAdminOrderOperation(value: string): value is AdminOrderOperation {
  return value === 'retry-fulfillment' || value === 'refund' || value === 'manual-complete';
}

function AdminOrderOperationModal({
  order,
  operation,
  onClose,
}: {
  order: OperableOrder;
  operation: AdminOrderOperation;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<OperationFormValues>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminOrderOperationResult | null>(null);
  const reasonRequired = operation !== 'retry-fulfillment';

  useEffect(() => {
    form.resetFields();
    setServerError(null);
    setResult(null);
  }, [form, operation, order.id]);

  const mutation = useMutation({
    mutationFn: (values: OperationFormValues) => {
      const reason = values.reason?.trim();
      return apiRequest<AdminOrderOperationResult>(buildAdminOrderOperationPath(order.id, operation), {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      message.success(t('adminOrders.operations.successToast'));
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-fulfillment', order.id] });
    },
    onError: (e) => {
      setServerError(getReasonKey(e, t('error')));
    },
  });

  const close = () => {
    if (mutation.isPending) return;
    onClose();
  };

  return (
    <Modal
      open
      title={t(`adminOrders.operations.${operation}.title`)}
      onCancel={close}
      footer={null}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        {t(`adminOrders.operations.${operation}.description`)}
      </Typography.Paragraph>
      {serverError && (
        <Alert
          type="error"
          message={t('adminOrders.operations.failed')}
          description={serverError}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {result && (
        <Alert
          type="success"
          message={t('adminOrders.operations.succeeded')}
          description={<OperationResultDescription result={result} />}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item
          name="reason"
          label={t('adminOrders.operations.reason')}
          rules={reasonRequired ? [{
            validator: (_, value: string | undefined) =>
              value?.trim()
                ? Promise.resolve()
                : Promise.reject(new Error(t('adminOrders.operations.reasonRequired'))),
          }] : undefined}
        >
          <Input.TextArea
            rows={3}
            placeholder={t('adminOrders.operations.reasonPlaceholder')}
            disabled={Boolean(result)}
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button onClick={close}>{t(result ? 'adminOrders.operations.done' : 'cancel')}</Button>
            {!result && (
              <Button type="primary" htmlType="submit" loading={mutation.isPending}>
                {t('confirm')}
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function getReasonKey(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function OperationResultDescription({ result }: { result: AdminOrderOperationResult }) {
  const { t } = useTranslation();
  const lines = [
    t('adminOrders.operations.resultStatus', { status: result.status }),
  ];
  if (result.fulfillmentJobId) {
    lines.push(t('adminOrders.operations.resultFulfillmentJob', { id: result.fulfillmentJobId }));
  }
  if (result.wallet) {
    lines.push(t('adminOrders.operations.resultWallet', {
      available: result.wallet.available,
      currency: result.wallet.currency,
    }));
  }
  return (
    <Space direction="vertical" size={0}>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </Space>
  );
}
