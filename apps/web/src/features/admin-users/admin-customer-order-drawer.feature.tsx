import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Pagination, Select, Skeleton, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { components } from '@ipeasy/contracts';
import { apiRequest, ApiError, buildQuery } from '../../shared/api/client';
import { formatMoneyAmount } from '../../shared/money/money';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import {
  formatIpTypeZh,
  formatProtocolZh,
  formatResourceLocationZh,
  formatResourceStatusZh,
} from '../../shared/resource/resource-labels';
import { AUTO_RECOMMENDED_LINE_LABEL } from '../../shared/resource/resource-selection-labels';
import { surfaceCardStyle } from '../../shared/ui/surface';

export interface AssistedOrderUser {
  id: string;
  email: string;
  tenantId: string;
}

interface AdminCustomerOrderDrawerProps {
  user: AssistedOrderUser;
  open: boolean;
  onClose: () => void;
}

interface ResourceDto {
  id: string;
  code: string;
  name: string;
  displayName?: string | null;
  stock?: number | null;
  inventoryIsStale?: boolean | null;
  status?: string;
  isVisible?: boolean;
  isSaleable?: boolean;
  providerCode?: string | null;
  countryCode?: string | null;
  ipType?: string | null;
  protocol?: string | null;
  upstreamResourceId?: string | null;
}

interface ResourcePageDto {
  page: number;
  pageSize: number;
  total: number;
  items: ResourceDto[];
}

interface WalletDto {
  available: string;
  currency: string;
}

interface AdminCustomerOrderFormValues {
  resourceId?: string;
  quantity?: number;
  durationDays?: number;
  currency?: string;
  businessType?: string;
  reason?: string;
}

type AdminCreateStaticProxyOrderDto = components['schemas']['AdminCreateStaticProxyOrderDto'];
type CreateStaticProxyOrderResultDto = Pick<components['schemas']['AdminOrderOperationResultDto'], 'orderId' | 'status'>;

export const ADMIN_CUSTOMER_ORDER_DURATIONS = [30, 60, 90];
const ASSISTED_ORDER_RESOURCE_PAGE_SIZE = 20;

export function buildAdminCustomerOrderPath(userId: string): string {
  return `/api/orders/users/${encodeURIComponent(userId)}/static-proxy`;
}

export function buildAdminCustomerOrderBody(
  values: Required<Pick<AdminCustomerOrderFormValues, 'resourceId' | 'quantity' | 'durationDays' | 'currency' | 'reason'>> &
    Pick<AdminCustomerOrderFormValues, 'businessType'>,
  idempotencyKey: string,
): AdminCreateStaticProxyOrderDto {
  return {
    resourceId: values.resourceId,
    quantity: Number(values.quantity),
    durationDays: Number(values.durationDays),
    currency: values.currency,
    idempotencyKey,
    ...(values.businessType?.trim() ? { businessType: values.businessType.trim() } : {}),
    reason: values.reason.trim(),
  };
}

export function createAdminCustomerOrderIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `admin-ui-${uuid ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function AdminCustomerOrderDrawer({ user, open, onClose }: AdminCustomerOrderDrawerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AdminCustomerOrderFormValues>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateStaticProxyOrderResultDto | null>(null);
  const [resourcePage, setResourcePage] = useState(1);
  const [resourceSearch, setResourceSearch] = useState('');

  const resourcesQuery = useQuery({
    queryKey: ['admin-assisted-order-resources', resourcePage, resourceSearch],
    queryFn: () =>
      apiRequest<ResourcePageDto>(
        `/api/resources${buildQuery({
          page: resourcePage,
          pageSize: ASSISTED_ORDER_RESOURCE_PAGE_SIZE,
          status: 'ACTIVE',
          search: resourceSearch.trim(),
        })}`,
      ),
    enabled: open,
  });

  const walletQuery = useQuery({
    queryKey: ['admin-user-wallet', user.id],
    queryFn: () => apiRequest<WalletDto>(`/api/wallet/${encodeURIComponent(user.id)}`),
    enabled: open && Boolean(user.id),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      quantity: 1,
      durationDays: ADMIN_CUSTOMER_ORDER_DURATIONS[0],
    });
    setServerError(null);
    setResult(null);
    setResourcePage(1);
    setResourceSearch('');
  }, [form, open, user.id]);

  useEffect(() => {
    if (walletQuery.data?.currency) {
      form.setFieldsValue({ currency: walletQuery.data.currency });
    }
  }, [form, walletQuery.data?.currency]);

  const resources = (resourcesQuery.data?.items ?? []).filter(isAssistedResourceVisible);

  const mutation = useMutation({
    mutationFn: (values: AdminCustomerOrderFormValues) => {
      if (!values.resourceId || !values.quantity || !values.durationDays || !values.currency || !values.reason?.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'assisted_order_required_fields_missing');
      }
      return apiRequest<CreateStaticProxyOrderResultDto>(buildAdminCustomerOrderPath(user.id), {
        method: 'POST',
        body: JSON.stringify(buildAdminCustomerOrderBody({
          resourceId: values.resourceId,
          quantity: values.quantity,
          durationDays: values.durationDays,
          currency: values.currency,
          businessType: values.businessType,
          reason: values.reason,
        }, createAdminCustomerOrderIdempotencyKey())),
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      message.success(t('users.assistedOrder.successToast'));
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-wallet', user.id] });
    },
    onError: (e) => {
      setServerError(getAssistedOrderReasonKey(e, t('error')));
    },
  });

  const close = () => {
    if (mutation.isPending) return;
    onClose();
  };

  const viewError = resourcesQuery.error ?? walletQuery.error;

  return (
    <Drawer
      open={open}
      width={680}
      title={t('users.assistedOrder.title', { email: user.email })}
      onClose={close}
      destroyOnClose
      styles={{
        body: { background: 'var(--ipx-bg)', padding: 0 },
        header: { borderBottom: '1px solid var(--ipx-border)' },
      }}
    >
      <div style={{ padding: 16 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={surfaceCardStyle({ padding: 16, borderRadius: 8 })}
          >
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
              {t('users.assistedOrder.target')}
            </Typography.Text>
            <Typography.Title level={4} style={{ margin: 0, wordBreak: 'break-all' }}>
              {user.email}
            </Typography.Title>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 12,
                marginTop: 18,
              }}
            >
              <SummaryItem label={t('users.tenantId')} value={user.tenantId} />
              <SummaryItem
                label={t('users.assistedOrder.balance')}
                value={walletQuery.data ? formatMoneyAmount(walletQuery.data.available, walletQuery.data.currency) ?? '-' : t('users.assistedOrder.walletLoading')}
                strong
              />
            </div>
          </div>

          {viewError && (
            <Alert
              type="error"
              message={t('error')}
              description={formatAssistedOrderFailure(viewError, t)}
              showIcon
            />
          )}
          {serverError && (
            <Alert
              type="error"
              message={t('users.assistedOrder.failed')}
              description={formatAssistedOrderFailure(serverError, t)}
              showIcon
            />
          )}
          {mutation.isPending && (
            <Alert
              type="info"
              message={t('users.assistedOrder.submit')}
              description={form.getFieldValue('reason')?.trim() || t('users.assistedOrder.reasonRequired')}
              showIcon
            />
          )}
          {result && (
            <Alert
              type="success"
              message={t('users.assistedOrder.succeeded')}
              description={t('users.assistedOrder.result', {
                orderId: result.orderId,
                status: formatAssistedOrderStatus(result.status, t),
              })}
              showIcon
            />
          )}

          <div
            style={surfaceCardStyle({ padding: 16, borderRadius: 8 })}
          >
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 18 }}>
              {t('users.assistedOrder.orderConfig')}
            </Typography.Title>
            <Form
              form={form}
              layout="vertical"
              onFinish={(values) => mutation.mutate(values)}
            >
              <Form.Item
                name="resourceId"
                label={t('users.assistedOrder.resource')}
                rules={[{ required: true, message: t('users.assistedOrder.resourceRequired') }]}
              >
                <AssistedResourcePickerField
                  resources={resources}
                  total={resources.length}
                  page={resourcesQuery.data?.page ?? resourcePage}
                  pageSize={resourcesQuery.data?.pageSize ?? ASSISTED_ORDER_RESOURCE_PAGE_SIZE}
                  search={resourceSearch}
                  onSearchChange={(value) => {
                    setResourceSearch(value);
                    setResourcePage(1);
                  }}
                  onPageChange={setResourcePage}
                  loading={resourcesQuery.isLoading}
                  disabled={Boolean(result) || Boolean(viewError)}
                  t={t}
                />
              </Form.Item>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Form.Item
                  name="durationDays"
                  label={t('users.assistedOrder.duration')}
                  rules={[{ required: true }]}
                >
                  <Select
                    options={ADMIN_CUSTOMER_ORDER_DURATIONS.map((duration) => ({
                      value: duration,
                      label: `${duration} ${t('users.assistedOrder.days')}`,
                    }))}
                    disabled={Boolean(result)}
                  />
                </Form.Item>

                <Form.Item
                  name="quantity"
                  label={t('users.assistedOrder.quantity')}
                  rules={[
                    { required: true, message: t('users.assistedOrder.quantityRequired') },
                    { type: 'number', min: 1, message: t('users.assistedOrder.quantityMin') },
                  ]}
                >
                  <InputNumber min={1} precision={0} style={{ width: '100%' }} disabled={Boolean(result)} />
                </Form.Item>
              </div>

              <Form.Item
                name="currency"
                label={t('users.assistedOrder.currency')}
                rules={[{ required: true }]}
              >
                <Input disabled />
              </Form.Item>

              <Form.Item
                name="businessType"
                label={t('users.assistedOrder.businessType')}
              >
                <Input
                  placeholder={t('users.assistedOrder.businessTypePlaceholder')}
                  disabled={Boolean(result)}
                />
              </Form.Item>

              <Form.Item
                name="reason"
                label={t('users.assistedOrder.reason')}
                rules={[{
                  validator: (_, value: string | undefined) =>
                    value?.trim()
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('users.assistedOrder.reasonRequired'))),
                }]}
              >
                <Input.TextArea
                  rows={4}
                  placeholder={t('users.assistedOrder.reasonPlaceholder')}
                  disabled={Boolean(result)}
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <Button onClick={close}>
                    {t(result ? 'users.assistedOrder.done' : 'cancel')}
                  </Button>
                  {!result && (
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={mutation.isPending}
                      disabled={Boolean(viewError)}
                    >
                      {t('users.assistedOrder.submit')}
                    </Button>
                  )}
                </Space>
              </Form.Item>
            </Form>
          </div>
        </Space>
      </div>
    </Drawer>
  );
}

function AssistedResourcePickerField({
  value,
  onChange,
  resources,
  total,
  page,
  pageSize,
  search,
  onSearchChange,
  onPageChange,
  loading,
  disabled,
  t,
}: {
  value?: string;
  onChange?: (value: string) => void;
  resources: ResourceDto[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  loading: boolean;
  disabled?: boolean;
  t: (key: string, values?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedResourceSnapshot, setSelectedResourceSnapshot] = useState<ResourceDto | null>(null);
  const selectedResourceOnPage = resources.find((resource) => resource.id === value);
  const selectedResource = selectedResourceOnPage ?? (selectedResourceSnapshot?.id === value ? selectedResourceSnapshot : null);
  const filteredResources = useMemo(
    () => resources.filter((resource) => matchesAssistedResourceSearch(resource, search)),
    [resources, search],
  );
  const groups = useMemo(() => groupAssistedResources(filteredResources), [filteredResources]);

  useEffect(() => {
    if (selectedResourceOnPage) {
      setSelectedResourceSnapshot(selectedResourceOnPage);
      return;
    }
    if (!value) setSelectedResourceSnapshot(null);
  }, [selectedResourceOnPage, value]);

  const selectResource = (resource: ResourceDto) => {
    setSelectedResourceSnapshot(resource);
    onChange?.(resource.id);
    setOpen(false);
    onSearchChange('');
  };

  return (
    <>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {selectedResource ? (
          <AssistedSelectedResourceSummary resource={selectedResource} t={t} />
        ) : (
          <div
            style={{
              border: '1px dashed var(--ipx-border)',
              borderRadius: 8,
              padding: 16,
              background: '#fbfdff',
            }}
          >
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('users.assistedOrder.noResourcesSelected')} />
          </div>
        )}
        <Button
          type={selectedResource ? 'default' : 'primary'}
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          {t(selectedResource ? 'users.assistedOrder.resourceChange' : 'users.assistedOrder.resourceChoose')}
        </Button>
      </Space>
      <Modal
        open={open}
        title={t('users.assistedOrder.resourcePickerTitle')}
        onCancel={() => {
          setOpen(false);
          onSearchChange('');
        }}
        footer={null}
        width={920}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Input.Search
            allowClear
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('users.assistedOrder.resourcePickerSearch')}
          />
          <Typography.Text type="secondary">
            {t('users.assistedOrder.resourcePickerHint', {
              count: filteredResources.length,
              total,
            })}
          </Typography.Text>
          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : groups.length === 0 ? (
            <Empty description={t('users.assistedOrder.resourcePickerEmpty')} />
          ) : (
            <div style={{ maxHeight: 520, overflowY: 'auto', paddingInlineEnd: 4 }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {groups.map((group) => (
                  <div key={group.key}>
                    <Space align="center" size={8} style={{ marginBottom: 8 }}>
                      <Typography.Text strong>{group.title}</Typography.Text>
                      <Tag>{group.resources.length}</Tag>
                    </Space>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                        gap: 10,
                      }}
                    >
                      {group.resources.map((resource) => (
                        <AssistedResourceCard
                          key={resource.id}
                          resource={resource}
                          active={resource.id === value}
                          onSelect={() => selectResource(resource)}
                          t={t}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </Space>
            </div>
          )}
          {total > pageSize && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger={false}
                onChange={onPageChange}
              />
            </div>
          )}
        </Space>
      </Modal>
    </>
  );
}

function AssistedSelectedResourceSummary({
  resource,
  t,
}: {
  resource: ResourceDto;
  t: (key: string, values?: Record<string, unknown>) => string;
}) {
  const location = formatResourceLocationZh(resource);
  const countryCode = resource.countryCode || resource.code;
  const regionTitle = location.city ?? location.detail ?? location.country;
  return (
    <div className="ipx-selected-resource-summary">
      <div className="ipx-selected-resource-head">
        <span className="ipx-selected-resource-flag">{countryFlagEmoji(countryCode)}</span>
        <div className="ipx-truncate">
          <Typography.Text strong>{location.country}</Typography.Text>
          <Typography.Text type="secondary">{regionTitle}</Typography.Text>
        </div>
        <Tag style={{ marginInlineEnd: 0 }}>{(countryCode || '-').toUpperCase()}</Tag>
      </div>
      <div className="ipx-selected-resource-grid">
        <DetailPill label={t('users.assistedOrder.resourceCity')} value={regionTitle} />
        <DetailPill label={t('users.assistedOrder.resourceLine')} value={AUTO_RECOMMENDED_LINE_LABEL} />
        <DetailPill label={t('users.assistedOrder.resourceProvider')} value={formatProviderLabel(resource.providerCode)} />
        <DetailPill label={t('users.assistedOrder.resourceStatus')} value={formatResourceStatusZh(resource.status)} />
      </div>
    </div>
  );
}

function AssistedResourceCard({
  resource,
  active,
  onSelect,
  t,
}: {
  resource: ResourceDto;
  active: boolean;
  onSelect: () => void;
  t: (key: string, values?: Record<string, unknown>) => string;
}) {
  const location = formatResourceLocationZh(resource);
  const countryCode = resource.countryCode || resource.code;
  const regionTitle = location.city ?? location.detail ?? location.country;
  const networkSubtitle = `${AUTO_RECOMMENDED_LINE_LABEL} · ${location.country}`;
  const disabled = !isAssistedResourceVisible(resource);
  const provider = formatProviderLabel(resource.providerCode);
  const selectResource = () => {
    if (!disabled) onSelect();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={active ? 'ipx-choice-card ipx-resource-card ipx-choice-card-active' : 'ipx-choice-card ipx-resource-card'}
      aria-pressed={active}
      aria-disabled={disabled}
      aria-label={t('users.assistedOrder.resourceSelect', { name: `${location.country} ${regionTitle}` })}
      onClick={selectResource}
      onKeyDown={handleKeyDown}
      style={{
        width: '100%',
        minHeight: 138,
        padding: 14,
        textAlign: 'left',
        font: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.58 : 1,
      }}
    >
      <Space align="start" size={10} style={{ width: '100%', marginBottom: 10 }}>
        <span className="ipx-resource-card-flag">{countryFlagEmoji(countryCode)}</span>
        <div className="ipx-truncate">
          <Typography.Title level={5} style={{ margin: 0, fontSize: 15 }} ellipsis={{ tooltip: regionTitle }}>
            {regionTitle}
          </Typography.Title>
          <Typography.Text type="secondary" className="ipx-card-caption">
            {networkSubtitle}
          </Typography.Text>
        </div>
      </Space>
      <Space wrap size={[6, 6]}>
        <Tag color="blue">{provider}</Tag>
        <Tag>{formatIpTypeZh(resource.ipType)}</Tag>
        <Tag>{formatProtocolZh(resource.protocol)}</Tag>
        {disabled && <Tag color="red">{t('users.assistedOrder.resourceUnavailable')}</Tag>}
      </Space>
      <div onClick={(event) => event.stopPropagation()} style={{ marginTop: 10 }}>
        <Typography.Text type="secondary" className="ipx-card-caption" copyable={{ text: resource.code }} ellipsis={{ tooltip: resource.code }}>
          {t('users.assistedOrder.resourceCode')}: {compactTraceValue(resource.code, 20)}
        </Typography.Text>
      </div>
    </div>
  );
}

function compactTraceValue(value: string, visibleChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= visibleChars) return trimmed;
  return `${trimmed.slice(0, visibleChars)}...`;
}

function DetailPill({
  label,
  value,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="ipx-detail-pill">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong={strong} ellipsis={{ tooltip: String(value) }}>{value}</Typography.Text>
    </div>
  );
}

function SummaryItem({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        border: '1px solid var(--ipx-border)',
        borderRadius: 'var(--ipx-radius)',
        padding: 12,
        minWidth: 0,
      }}
    >
      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong={strong} style={{ wordBreak: 'break-all' }}>
        {value}
      </Typography.Text>
    </div>
  );
}

interface AssistedResourceGroup {
  key: string;
  title: string;
  resources: ResourceDto[];
}

function matchesAssistedResourceSearch(resource: ResourceDto, search: string): boolean {
  const keyword = search.trim().toLowerCase();
  if (!keyword) return true;
  const location = formatResourceLocationZh(resource);
  return [
    resource.id,
    resource.code,
    resource.countryCode,
    resource.name,
    resource.displayName,
    resource.upstreamResourceId,
    resource.providerCode,
    resource.ipType,
    resource.protocol,
    location.title,
    location.country,
    location.city,
    location.line,
    location.detail,
    formatProviderLabel(resource.providerCode),
    formatIpTypeZh(resource.ipType),
    formatProtocolZh(resource.protocol),
  ].some((value) => value?.toLowerCase().includes(keyword));
}

function groupAssistedResources(resources: ResourceDto[]): AssistedResourceGroup[] {
  const groups = new Map<string, AssistedResourceGroup>();
  for (const resource of resources) {
    const location = formatResourceLocationZh(resource);
    const key = (resource.countryCode || location.country).toUpperCase();
    const existing = groups.get(key);
    if (existing) {
      existing.resources.push(resource);
    } else {
      groups.set(key, {
        key,
        title: location.country,
        resources: [resource],
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

function isAssistedResourceVisible(resource: ResourceDto): boolean {
  return resource.status === 'ACTIVE' && resource.isVisible === true && resource.isSaleable === true;
}

function getAssistedOrderReasonKey(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.reasonKey;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function formatAssistedOrderFailure(error: unknown, t: (key: string, values?: Record<string, unknown>) => string): string {
  const reasonKey = typeof error === 'string' ? error : getAssistedOrderReasonKey(error, t('error'));
  const key = `users.reason.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('users.reason.generic') : translated;
}

function formatAssistedOrderStatus(status: string, t: (key: string, values?: Record<string, unknown>) => string): string {
  const key = `orders.statusValue.${status}`;
  const translated = t(key);
  return translated === key ? t('users.assistedOrder.statusUnknown') : translated;
}

function countryFlagEmoji(countryCode?: string | null): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}
