import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Select, Skeleton, Space, Spin, Statistic, Steps, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, FieldTimeOutlined, ReloadOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle as sharedSurfaceCardStyle } from '../../shared/ui/surface';
import { formatIpTypeZh, formatProtocolZh, formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { formatCustomerChannelLabel } from '../../shared/provider/provider-labels';
import { formatProxyStatusZh, proxyStatusColor } from '../../shared/proxy/proxy-labels';

interface CustomerProxyDto {
  id: string;
  ip: string;
  port: number;
  countryCode: string;
  protocol: string;
  status: string;
  providerCode?: string | null;
  regionCode?: string | null;
  ipType?: string | null;
  orderId?: string | null;
}

interface ProxyCheckResult {
  reachable: boolean;
  latencyMs?: number;
  exitIp?: string;
  error?: { code?: string; reasonKey: string; httpStatus?: number };
}

interface ProxyCheckFailure {
  reasonKey: string;
  code?: string;
  message?: string;
  httpStatus?: number;
}

export function buildProxyListPath(): string {
  return `/api/proxies${buildQuery({ page: 1, pageSize: 20 })}`;
}

export function buildProxyCheckBody(proxyId: string) {
  return { proxyId };
}

const REASON_KEYS = new Set([
  'proxy_unreachable',
  'proxy_check_timeout',
  'proxy_check_select_required',
  'proxy_not_found',
  'proxy_not_active',
  'proxy_check_failed',
  'upstream_error',
  'PERMISSION_DENIED',
]);

export function reasonText(t: (key: string) => string, reasonKey: string): string {
  if (!REASON_KEYS.has(reasonKey)) return t('customer.proxyCheck.reason.proxy_check_failed');
  const key = `customer.proxyCheck.reason.${reasonKey}`;
  const translated = t(key);
  return translated === key ? t('customer.proxyCheck.reason.proxy_check_failed') : translated;
}

export function formatProxyCheckFailure(t: (key: string) => string, failure: ProxyCheckFailure): string {
  const segments = [reasonText(t, failure.reasonKey)];
  return segments.join(' / ');
}

export function normalizeProxyCheckFailure(error: unknown, fallbackReasonKey = 'error'): ProxyCheckFailure {
  if (error instanceof ApiError) {
    return {
      reasonKey: error.reasonKey,
      code: String(error.code),
      message: error.message,
      httpStatus: typeof error.code === 'number' ? error.code : undefined,
    };
  }

  if (error instanceof Error) {
    return { reasonKey: error.message || fallbackReasonKey, message: error.message };
  }

  return { reasonKey: fallbackReasonKey };
}

export function CustomerProxyCheckFeature() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [result, setResult] = useState<ProxyCheckResult | null>(null);
  const [actionError, setActionError] = useState<ProxyCheckFailure | null>(null);

  const proxiesQuery = useQuery({
    queryKey: ['customer-proxies', 'proxy-check'],
    queryFn: () =>
      userApiRequest<{ page: number; pageSize: number; total: number; items: CustomerProxyDto[] }>(
        buildProxyListPath(),
      ),
  });

  const checkMutation = useMutation({
    mutationFn: (proxyId: string) =>
      userApiRequest<ProxyCheckResult>('/api/proxy-check', {
        method: 'POST',
        body: JSON.stringify(buildProxyCheckBody(proxyId)),
      }),
    onMutate: () => {
      setActionError(null);
      setResult(null);
    },
    onSuccess: (res) => {
      setActionError(null);
      setResult(res);
    },
    onError: (error) => {
      setResult(null);
      setActionError(normalizeProxyCheckFailure(error, t('error')));
    },
  });

  const items = proxiesQuery.data?.items ?? [];
  const checkableItems = items.filter(isCheckableProxy);
  const hasProxies = items.length > 0;
  const hasCheckableProxies = checkableItems.length > 0;
  const selectedProxy = checkableItems.find((proxy) => proxy.id === selectedId);
  const stepStatus = getProxyCheckStepStatus(Boolean(selectedId), checkMutation.isPending, result, actionError);

  const runCheck = () => {
    if (!selectedId) {
      setActionError({ reasonKey: 'proxy_check_select_required' });
      return;
    }
    setActionError(null);
    checkMutation.mutate(selectedId);
  };

  const options = checkableItems.map((proxy) => ({
    value: proxy.id,
    label: t('customer.proxyCheck.proxyLabel', {
      ip: proxy.ip,
      port: proxy.port,
      country: formatRegionNameZh({ countryCode: proxy.countryCode }),
    }),
  }));

  return (
    <div className="ipx-proxy-check-page ipx-customer-page ipx-customer-proxy-check-page">
      <PageHeader
        title={t('customer.proxyCheck.title')}
        extra={(
          <Button
            icon={<ReloadOutlined />}
            loading={proxiesQuery.isFetching}
            onClick={() => void proxiesQuery.refetch().then((result) => {
              if (result.isError) {
                message.error(formatProxyCheckFailure(t, normalizeProxyCheckFailure(result.error)));
                return;
              }
              message.success(t('customer.proxyCheck.refreshSuccess'));
            })}
          >
            {t('refresh')}
          </Button>
        )}
      />

      {actionError && (
        <Alert
          type="error"
          message={t('customer.proxyCheck.checkFailed')}
          description={<ProxyCheckFailureDescription failure={actionError} />}
          showIcon
          closable
          onClose={() => setActionError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {proxiesQuery.isError && (
        <Alert
          type="error"
          message={t('customer.proxyCheck.listFailed')}
          description={formatProxyCheckFailure(t, normalizeProxyCheckFailure(proxiesQuery.error))}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card className="ipx-proxy-check-workspace ipx-customer-table-card" variant="borderless" style={sharedSurfaceCardStyle()} styles={{ body: { padding: 0 } }}>
        {!proxiesQuery.isError && proxiesQuery.isFetching && !proxiesQuery.isLoading && (
          <Alert
            type="info"
            showIcon
            message={t('customer.proxyCheck.refreshing')}
            style={{ margin: 20, marginBottom: 0 }}
          />
        )}
        <ListContent
          query={proxiesQuery}
          hasProxies={hasProxies}
          hasCheckableProxies={hasCheckableProxies}
          options={options}
          selectedId={selectedId}
          onSelect={(value) => { setSelectedId(value); setResult(null); }}
          onRun={runCheck}
          running={checkMutation.isPending}
          result={result}
          actionError={actionError}
          selectedProxy={selectedProxy}
          stepStatus={stepStatus}
        />
      </Card>
    </div>
  );
}

function ProxyCheckFailureDescription({ failure }: { failure: ProxyCheckFailure }) {
  const { t } = useTranslation();
  const formatted = formatProxyCheckFailure(t, failure);
  return (
    <Space direction="vertical" size={2}>
      <Typography.Text>{formatted}</Typography.Text>
    </Space>
  );
}

function ListContent({
  query,
  hasProxies,
  hasCheckableProxies,
  options,
  selectedId,
  onSelect,
  onRun,
  running,
  result,
  actionError,
  selectedProxy,
  stepStatus,
}: {
  query: { isLoading: boolean; error: unknown };
  hasProxies: boolean;
  hasCheckableProxies: boolean;
  options: { value: string; label: string }[];
  selectedId: string | undefined;
  onSelect: (value: string) => void;
  onRun: () => void;
  running: boolean;
  result: ProxyCheckResult | null;
  actionError: ProxyCheckFailure | null;
  selectedProxy: CustomerProxyDto | undefined;
  stepStatus: number;
}) {
  const { t } = useTranslation();

  if (query.isLoading) {
    return (
      <div style={{ padding: 20 }}>
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} xl={14}>
            <Card variant="borderless" style={{ height: '100%', background: 'rgba(255,255,255,0.72)' }} styles={{ body: { minHeight: 280 } }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space align="center">
                  <Spin />
                  <Typography.Text strong>{t('customer.proxyCheck.loadingCheckable')}</Typography.Text>
                </Space>
                <Skeleton active paragraph={{ rows: 6 }} />
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card variant="borderless" style={{ height: '100%', background: 'rgba(255,255,255,0.72)' }} styles={{ body: { minHeight: 280 } }}>
              <Skeleton active paragraph={{ rows: 5 }} />
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  if (query.error) {
    const failure = normalizeProxyCheckFailure(query.error);
    const isPermission = failure.code === 'PERMISSION_DENIED' || failure.code === '403' || failure.httpStatus === 403;
    return (
      <div style={{ padding: 20 }}>
        <Card variant="borderless" style={{ background: 'rgba(255,255,255,0.74)' }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space align="center">
              <WarningOutlined style={{ color: isPermission ? 'var(--ipx-warning)' : 'var(--ipx-danger)', fontSize: 22 }} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {isPermission ? t('permissionDenied') : t('customer.proxyCheck.listErrorTitle')}
                </Typography.Title>
                <Typography.Text type="secondary">{t('customer.proxyCheck.listErrorDescription')}</Typography.Text>
              </div>
            </Space>
            <Alert
              type={isPermission ? 'warning' : 'error'}
              message={isPermission ? t('permissionDenied') : t('error')}
              description={formatProxyCheckFailure(t, failure)}
              showIcon
            />
          </Space>
        </Card>
      </div>
    );
  }

  if (!hasProxies) {
    return (
      <DashboardEmptyState
        title={t('customer.proxyCheck.emptyTitle')}
        description={t('customer.proxyCheck.empty')}
        action={<Link to="/customer/buy">{t('customer.proxyCheck.goBuy')}</Link>}
      />
    );
  }

  if (!hasCheckableProxies) {
    return (
      <DashboardEmptyState
        title={t('customer.proxyCheck.noCheckableTitle')}
        description={t('customer.proxyCheck.noCheckableProxies')}
        action={<Link to="/proxies">{t('customer.nav.proxies')}</Link>}
      />
    );
  }

  return (
    <Row gutter={[0, 0]} align="stretch">
      <Col xs={24} xl={14}>
        <div className="ipx-proxy-check-panel ipx-proxy-check-panel-left">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Steps
              size="small"
              current={stepStatus}
              items={[
                { title: t('customer.proxyCheck.steps.select') },
                { title: t('customer.proxyCheck.steps.request') },
                { title: t('customer.proxyCheck.steps.result') },
              ]}
            />
            <div className="ipx-proxy-check-section-head">
              <Typography.Text className="ipx-proxy-check-kicker">{t('customer.proxyCheck.stepSelect')}</Typography.Text>
              <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 6 }}>
                {t('customer.proxyCheck.selectProxy')}
              </Typography.Title>
              <Typography.Text type="secondary">
                {t('customer.proxyCheck.selectDesc')}
              </Typography.Text>
            </div>
            <Select
              style={{ width: '100%' }}
              size="large"
              placeholder={t('customer.proxyCheck.selectPlaceholder')}
              options={options}
              value={selectedId}
              onChange={onSelect}
              showSearch
              optionFilterProp="label"
            />
            {selectedProxy && <SelectedProxyCard proxy={selectedProxy} />}
            <Alert
              type={selectedProxy ? 'info' : 'warning'}
              showIcon
              message={selectedProxy
                ? t('customer.proxyCheck.selectedSummary', {
                  endpoint: `${selectedProxy.ip}:${selectedProxy.port}`,
                  status: formatProxyStatusZh(selectedProxy.status),
                })
                : t('customer.proxyCheck.noSelectionSummary')}
            />
            <Space wrap>
              <Button
                type="primary"
                aria-label={t('customer.proxyCheck.run')}
                loading={running}
                disabled={!selectedId}
                onClick={onRun}
                size="large"
                icon={<ThunderboltOutlined />}
              >
                {running ? t('customer.proxyCheck.running') : t('customer.proxyCheck.run')}
              </Button>
              <Button size="large" disabled={!selectedId || running} onClick={() => selectedId && onSelect(selectedId)}>
                {t('customer.proxyCheck.clearResult')}
              </Button>
            </Space>
          </Space>
        </div>
      </Col>
      <Col xs={24} xl={10}>
        <div className="ipx-proxy-check-panel">
          <ProxyCheckResultCard result={result} running={running} actionError={actionError} selectedProxy={selectedProxy} />
        </div>
      </Col>
    </Row>
  );
}

export function isCheckableProxy(proxy: CustomerProxyDto): boolean {
  return proxy.status === 'ACTIVE' || proxy.status === 'EXPIRING';
}

function SelectedProxyCard({ proxy }: { proxy: CustomerProxyDto }) {
  const { t } = useTranslation();
  const location = formatResourceLocationZh({
    code: proxy.regionCode ?? proxy.countryCode,
    countryCode: proxy.countryCode,
  });
  const facts = [
    { label: t('customer.proxyCheck.provider'), value: formatCustomerChannelLabel(proxy.providerCode) },
    { label: t('customer.proxyCheck.location'), value: location.title },
    { label: t('customer.proxyCheck.protocol'), value: formatProtocolZh(proxy.protocol) },
    { label: t('customer.proxyCheck.ipType'), value: formatIpTypeZh(proxy.ipType) },
  ];

  return (
    <div className="ipx-proxy-check-selected">
      <div className="ipx-proxy-check-selected-main">
        <div className="ipx-proxy-check-endpoint">
          <Typography.Text type="secondary" className="ipx-proxy-check-fact-label">
            {t('customer.proxyCheck.endpoint')}
          </Typography.Text>
          <Typography.Text strong className="ipx-proxy-check-endpoint-value">
            {proxy.ip}:{proxy.port}
          </Typography.Text>
        </div>
        <Space wrap className="ipx-proxy-check-selected-head">
          <Tag color="blue">{formatRegionNameZh({ countryCode: proxy.countryCode })}</Tag>
          <Tag color="geekblue">{formatProtocolZh(proxy.protocol)}</Tag>
          <Tag color={proxyStatusColor(proxy.status)}>{formatProxyStatusZh(proxy.status)}</Tag>
        </Space>
      </div>
      <div className="ipx-proxy-check-fact-grid">
        {facts.map((fact) => (
          <div className="ipx-proxy-check-fact" key={fact.label}>
            <Typography.Text type="secondary" className="ipx-proxy-check-fact-label">
              {fact.label}
            </Typography.Text>
            <Typography.Text strong className="ipx-proxy-check-fact-value">
              {fact.value}
            </Typography.Text>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div style={{ padding: 20 }}>
      <Card variant="borderless" style={{ background: 'rgba(255,255,255,0.74)' }} styles={{ body: { minHeight: 280, display: 'grid', placeItems: 'center' } }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={8} align="center">
              <Typography.Text strong>{title}</Typography.Text>
              <Typography.Text type="secondary">{description}</Typography.Text>
              {action}
            </Space>
          }
        />
      </Card>
    </div>
  );
}

export function getProxyCheckStepStatus(
  hasSelectedProxy: boolean,
  running: boolean,
  result: ProxyCheckResult | null,
  actionError: ProxyCheckFailure | null,
): number {
  if (result || actionError) return 2;
  if (running) return 1;
  if (hasSelectedProxy) return 1;
  return 0;
}

function ProxyCheckResultCard({
  result,
  running,
  actionError,
  selectedProxy,
}: {
  result: ProxyCheckResult | null;
  running: boolean;
  actionError: ProxyCheckFailure | null;
  selectedProxy: CustomerProxyDto | undefined;
}) {
  const { t } = useTranslation();
  const selectedEndpoint = selectedProxy ? `${selectedProxy.ip}:${selectedProxy.port}` : t('customer.proxyCheck.selectedEndpointNone');

  if (running) {
    return (
      <div className="ipx-proxy-check-running">
        <span className="ipx-fulfillment-orbit"><ThunderboltOutlined /></span>
        <Typography.Title level={5} style={{ margin: 0 }}>{t('customer.proxyCheck.runningTitle')}</Typography.Title>
        <Typography.Text type="secondary">{t('customer.proxyCheck.runningDesc')}</Typography.Text>
        <Typography.Text type="secondary">{t('customer.proxyCheck.runningTarget', { endpoint: selectedEndpoint })}</Typography.Text>
        <div className="ipx-proxy-check-live-pulse" aria-hidden="true" />
      </div>
    );
  }

  if (actionError) {
    return (
      <div className="ipx-proxy-check-result is-failed">
        <div className="ipx-proxy-check-result-head">
          <Space align="center" size={10}>
            <CloseCircleOutlined style={{ color: 'var(--ipx-danger)', fontSize: 20 }} />
            <Typography.Title level={5} style={{ margin: 0 }}>{t('customer.proxyCheck.checkFailed')}</Typography.Title>
          </Space>
          <Tag color="error">{t('customer.proxyCheck.unreachable')}</Tag>
        </div>
        <Alert
          type="error"
          showIcon
          message={t('customer.proxyCheck.checkFailed')}
          description={formatProxyCheckFailure(t, actionError)}
        />
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('customer.proxyCheck.resultEndpoint')}>{selectedEndpoint}</Descriptions.Item>
          <Descriptions.Item label={t('customer.proxyCheck.backendReason')}>
            <Typography.Text type="danger">{reasonText(t, actionError.reasonKey)}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="ipx-proxy-check-empty-result">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text strong>{t('customer.proxyCheck.resultEmptyTitle')}</Typography.Text>
              <Typography.Text type="secondary">{t('customer.proxyCheck.resultEmptyDesc')}</Typography.Text>
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div className={result.reachable ? 'ipx-proxy-check-result is-success' : 'ipx-proxy-check-result is-failed'}>
      <div className="ipx-proxy-check-result-head">
        <Space align="center" size={10}>
          {result.reachable
            ? <CheckCircleOutlined style={{ color: 'var(--ipx-success)', fontSize: 20 }} />
            : <CloseCircleOutlined style={{ color: 'var(--ipx-danger)', fontSize: 20 }} />}
          <Typography.Title level={5} style={{ margin: 0 }}>
            {result.reachable ? t('customer.proxyCheck.resultReachableTitle') : t('customer.proxyCheck.resultUnreachableTitle')}
          </Typography.Title>
        </Space>
        <Tag color={result.reachable ? 'success' : 'error'}>
          {result.reachable ? t('customer.proxyCheck.reachable') : t('customer.proxyCheck.unreachable')}
        </Tag>
      </div>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12}>
          <Statistic title={t('customer.proxyCheck.resultEndpoint')} value={selectedEndpoint} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col xs={24} sm={12}>
          <Statistic
            title={t('customer.proxyCheck.latency')}
            value={result.latencyMs !== undefined ? result.latencyMs : '-'}
            suffix={result.latencyMs !== undefined ? 'ms' : undefined}
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
      </Row>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('customer.proxyCheck.resultTitle')}>
          {result.reachable
            ? <Tag color="success">{t('customer.proxyCheck.reachable')}</Tag>
            : <Tag color="error">{t('customer.proxyCheck.unreachable')}</Tag>}
        </Descriptions.Item>
        {result.reachable && result.latencyMs !== undefined && (
          <Descriptions.Item label={t('customer.proxyCheck.latency')}>
            <Space size={6}><FieldTimeOutlined />{t('customer.proxyCheck.latencyValue', { ms: result.latencyMs })}</Space>
          </Descriptions.Item>
        )}
        {result.reachable && result.exitIp && (
          <Descriptions.Item label={t('customer.proxyCheck.exitIp')}>
            {result.exitIp}
          </Descriptions.Item>
        )}
        {!result.reachable && result.error && (
          <Descriptions.Item label={t('customer.proxyCheck.checkFailed')}>
            <Typography.Text type="danger">{formatProxyCheckFailure(t, result.error)}</Typography.Text>
          </Descriptions.Item>
        )}
      </Descriptions>
    </div>
  );
}
