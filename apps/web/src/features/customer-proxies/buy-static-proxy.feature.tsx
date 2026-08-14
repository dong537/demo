import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, InputNumber, Pagination, Row, Segmented, Space, Steps, Typography, Skeleton, Tag, message } from 'antd';
import { CheckOutlined, ClockCircleOutlined, CloudServerOutlined, LoadingOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { userApiRequest, buildQuery, ApiError } from '../../shared/api/client';
import { useCurrentCustomer } from '../../shared/auth/current-user';
import { formatProviderLabel } from '../../shared/provider/provider-labels';
import {
  formatResourceLocationEn,
  formatResourceLocationZh,
  type ResourceLocationLabel,
} from '../../shared/resource/resource-labels';
import { formatNetworkSequenceLabel, isEnglishLanguage } from '../../shared/resource/resource-selection-labels';
import { formatMoneyAmount } from '../../shared/money/money';

interface ResourceDto {
  id: string;
  code: string;
  name: string;
  displayName?: string | null;
  providerCode?: string;
  protocol?: string;
  ipType?: string;
  status?: string | null;
  isVisible?: boolean | null;
  isSaleable?: boolean | null;
  countryCode: string;
  upstreamResourceId?: string | null;
  stock: number | null;
  inventoryIsStale?: boolean | null;
  unitPrice?: string | null;
  priceCurrency?: string | null;
  costGroupKey?: string | null;
}

interface WalletDto {
  available: string;
  currency: string;
}

interface QuoteDto {
  unitPrice?: string;
  totalPrice: string;
  currency: string;
}

type CurrentQuoteDto = QuoteDto & QuotePathInput;

type CurrentQuoteError = QuotePathInput & {
  message: string;
};

interface OrderResultDto {
  orderId: string;
  status: string;
}

interface ResourcePageDto {
  page?: number;
  pageSize?: number;
  total?: number;
  items: ResourceDto[];
}

interface ResourceListResult {
  items: ResourceDto[];
  total: number;
  page: number;
  pageSize: number;
}

interface CountrySummaryDto {
  countryCode: string;
  totalResources: number;
  availableStock: number;
}

interface CountrySummaryResult {
  items: CountrySummaryDto[];
}

interface QuotePathInput {
  resourceId: string;
  durationDays: number;
  quantity: number;
  currency: string;
}

const STATIC_PROXY_DURATION_DAYS = 30;
const RESOURCE_LIST_PAGE_SIZE = 20;
const RESOURCE_LIST_STALE_MS = 0;

export function buildStaticProxyQuotePath(input: QuotePathInput): string {
  return `/api/pricing/quote${buildQuery({
    resourceId: input.resourceId,
    durationDays: input.durationDays,
    quantity: input.quantity,
    currency: input.currency,
  })}`;
}

export function buildStaticProxyOrderBody(input: QuotePathInput & { idempotencyKey: string }) {
  return {
    resourceId: input.resourceId,
    durationDays: input.durationDays,
    quantity: input.quantity,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  };
}

export function BuyStaticProxyFeature() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateTo = (to: string) => { void navigate({ to }); };
  const currentQuery = useCurrentCustomer();
  const userId = currentQuery.data?.ownerId ?? '';
  const siteId = currentQuery.data?.siteId ?? '';
  const tenantId = currentQuery.data?.tenantId ?? '';
  const currentLanguage = i18n?.resolvedLanguage ?? i18n?.language;
  const durationDays = STATIC_PROXY_DURATION_DAYS;
  const [resourcePageNumber, setResourcePageNumber] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<CurrentQuoteDto | null>(null);
  const [quoteError, setQuoteError] = useState<CurrentQuoteError | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResultDto | null>(null);
  const [fulfillmentRefreshing, setFulfillmentRefreshing] = useState(false);
  const quoteRequestRef = useRef(0);

  const walletQuery = useQuery({
    queryKey: ['customer-wallet', userId],
    queryFn: () => userApiRequest<WalletDto>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const currency = walletQuery.data?.currency ?? '';
  const normalizedSearch = resourceSearch.trim();
  const countriesQuery = useQuery({
    queryKey: ['resources-countries', siteId, tenantId, userId, currency, STATIC_PROXY_DURATION_DAYS, normalizedSearch],
    queryFn: () => fetchStaticProxyResourceCountries(currency, normalizedSearch),
    enabled: Boolean(currency),
    staleTime: RESOURCE_LIST_STALE_MS,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const countryGroups = useMemo(
    () => groupCountrySummaries(countriesQuery.data?.items ?? [], currentLanguage),
    [countriesQuery.data?.items, currentLanguage],
  );
  const continentOptions = useMemo(() => buildContinentOptions(countryGroups, t), [countryGroups, t]);
  const [selectedContinent, setSelectedContinent] = useState<string>('all');
  const [selectedRegionKey, setSelectedRegionKey] = useState<string | null>(null);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const activeContinent = useMemo(
    () => {
      if (continentOptions.some((option) => option.value === selectedContinent)) return selectedContinent;
      if (selectedContinent !== 'all') return continentOptions[0]?.value ?? 'all';
      if (continentOptions.some((option) => option.value === 'northAmerica')) return 'northAmerica';
      return continentOptions.length === 1 ? continentOptions[0]!.value : 'all';
    },
    [continentOptions, selectedContinent],
  );
  const countryGroupsInContinent = useMemo(
    () => activeContinent === 'all'
      ? countryGroups
      : countryGroups.filter((group) => group.continent === activeContinent),
    [activeContinent, countryGroups],
  );
  const selectedRegion = useMemo(
    () => countryGroupsInContinent.find((group) => group.key === selectedRegionKey) ?? getPreferredCountrySummary(countryGroupsInContinent),
    [countryGroupsInContinent, selectedRegionKey],
  );
  const selectedCountryCode = selectedRegion?.countryCode ?? '';
  const resourcesQuery = useQuery({
    queryKey: ['resources-list', siteId, tenantId, userId, currency, STATIC_PROXY_DURATION_DAYS, normalizedSearch, selectedCountryCode, resourcePageNumber],
    queryFn: () => fetchStaticProxyResources(currency, normalizedSearch, selectedCountryCode, resourcePageNumber),
    enabled: Boolean(currency && selectedCountryCode),
    staleTime: RESOURCE_LIST_STALE_MS,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const resourcePage = resourcesQuery.data;
  const resourcePageToken = `${resourcePageNumber}:${normalizedSearch}:${selectedCountryCode}:${currency}`;
  const resources = useMemo(() => resourcePage?.items ?? [], [resourcePage]);
  const resourceTotal = resourcePage?.total ?? resources.length;
  const currentResourcePage = resourcePageNumber;
  const currentResourcePageSize = RESOURCE_LIST_PAGE_SIZE;
  const resourcePageCount = Math.max(1, Math.ceil(Math.max(resourceTotal, 0) / currentResourcePageSize));
  const hasMoreResources = resourceTotal > resources.length;
  const resourceLoadValue = hasMoreResources ? `${resources.length}/${resourceTotal}` : resources.length;
  const visibleResources = useMemo(
    () => resources.filter(isResourcePurchaseVisible),
    [resources],
  );
  const filteredVisibleResources = useMemo(
    () => visibleResources.filter((resource) => matchesResourceSearch(resource, productSearch, currentLanguage)),
    [currentLanguage, productSearch, visibleResources],
  );
  const selectedRegionResources = useMemo(
    () => selectedRegion ? sortResourcesForPurchase(filteredVisibleResources, 'priceAsc') : [],
    [filteredVisibleResources, selectedRegion],
  );
  const resourceLineGroups = useMemo(
    () => groupResourcesByCostLine(selectedRegionResources, currentLanguage),
    [currentLanguage, selectedRegionResources],
  );
  const selectedLine = useMemo(
    () => resourceLineGroups.find((group) => group.key === selectedLineKey) ?? getPreferredResourceLineGroup(resourceLineGroups),
    [resourceLineGroups, selectedLineKey],
  );
  const selectedLineResources = selectedLine?.resources ?? [];
  const explicitSelectedResource = visibleResources.find((resource) => resource.id === selectedResourceId) ?? null;
  const selectedResource = explicitSelectedResource ?? getPreferredResource(selectedLineResources);
  const selectedResourceIdForPurchase = selectedResource?.id ?? null;
  const selectedQuantity = selectedResourceIdForPurchase
    ? quantities[selectedResourceIdForPurchase] ?? (selectedResource && canAttemptQuote(selectedResource) ? 1 : 0)
    : 0;
  const selectedResourceFingerprint = useMemo(() => {
    if (!selectedResource) return '';
    return [
      selectedResource.id,
      selectedResource.unitPrice ?? '',
      selectedResource.priceCurrency ?? '',
      selectedResource.stock ?? '',
      selectedResource.inventoryIsStale === true ? '1' : '0',
      selectedResource.status ?? '',
      selectedResource.isVisible === false ? '0' : '1',
      selectedResource.isSaleable === false ? '0' : '1',
    ].join('|');
  }, [selectedResource]);
  const available = parseFloat(walletQuery.data?.available ?? '0');
  const quoteMatchesSelection = Boolean(
    quote
      && selectedResourceIdForPurchase
      && quote.resourceId === selectedResourceIdForPurchase
      && quote.durationDays === durationDays
      && quote.quantity === selectedQuantity
      && quote.currency === currency,
  );
  const currentQuote = quoteMatchesSelection ? quote : null;
  const quoteErrorMatchesSelection = Boolean(
    quoteError
      && selectedResourceIdForPurchase
      && quoteError.resourceId === selectedResourceIdForPurchase
      && quoteError.durationDays === durationDays
      && quoteError.quantity === selectedQuantity
      && quoteError.currency === currency,
  );
  const currentQuoteError = quoteErrorMatchesSelection ? quoteError?.message ?? null : null;
  const totalPrice = parseFloat(currentQuote?.totalPrice ?? '0');
  const insufficient = currentQuote !== null && available < totalPrice;
  const selectedResourceQuotable = selectedResource ? canAttemptQuote(selectedResource) : false;
  const canBuy = Boolean(selectedResourceQuotable && selectedQuantity > 0 && currentQuote && !currentQuoteError && !quoteLoading && !insufficient);
  const walletDisplay = formatCustomerBuyMoneyAmount(walletQuery.data?.available ?? '0.00', currency || 'CNY', currentLanguage) ?? '-';
  const orderTotalDisplay = formatOrderTotalDisplay({
    quote: currentQuote,
    quoteLoading,
    selectedResource,
    selectedResourceQuotable,
    currency,
    language: currentLanguage,
    labels: {
      quoteLoading: t('customer.buy.quoteLoading'),
      notPurchasable: t('customer.buy.notPurchasable'),
    },
  });
  const buyDisabledReason = getBuyDisabledReason({
    selectedResource,
    selectedQuantity,
    quote: currentQuote,
    quoteError: currentQuoteError,
    insufficient,
    quoteLoading,
    labels: {
      selectProductFirst: t('customer.buy.selectProductFirst'),
      quantityMin: t('customer.buy.quantityMin'),
      quoteLoading: t('customer.buy.quoteLoading'),
      quoteRequired: t('customer.buy.quoteRequired'),
      quoteError: t('customer.buy.quoteError'),
      insufficientBalance: t('customer.buy.insufficientBalance'),
      stockUnavailable: t('customer.buy.stockUnavailable'),
      stockUnknown: t('customer.buy.stockUnknown'),
      stockRealtime: t('customer.buy.stockRealtime'),
      staleInventory: t('customer.buy.staleInventory'),
    },
  });

  useEffect(() => {
    setSelectedResourceId(null);
    setSelectedLineKey(null);
    setQuote(null);
    setQuoteError(null);
    setQuoteLoading(false);
  }, [resourcePageToken]);

  useEffect(() => {
    if (!selectedRegion) return;
    const selectedInRegion = selectedResourceId
      ? selectedLineResources.find((resource) => resource.id === selectedResourceId)
      : null;
    if (selectedInRegion && canAttemptQuote(selectedInRegion)) return;
    const nextResource = getPreferredResource(selectedLineResources);
    if (!nextResource || nextResource.id === selectedResourceId) return;
    setSelectedResourceId(nextResource.id);
    setQuantities((current) => ({
      ...current,
      [nextResource.id]: canAttemptQuote(nextResource) ? Math.max(1, current[nextResource.id] ?? 1) : 0,
    }));
  }, [selectedLineResources, selectedRegion, selectedResourceId]);

  useEffect(() => {
    if (!selectedLineKey || resourceLineGroups.some((group) => group.key === selectedLineKey)) return;
    setSelectedLineKey(null);
    setSelectedResourceId(null);
  }, [resourceLineGroups, selectedLineKey]);

  useEffect(() => {
    if (
      selectedContinent !== 'all'
      && continentOptions.length > 0
      && !continentOptions.some((option) => option.value === selectedContinent)
    ) {
      setSelectedContinent('all');
      setSelectedRegionKey(null);
      setSelectedLineKey(null);
      setSelectedResourceId(null);
    }
  }, [continentOptions, selectedContinent]);

  useEffect(() => {
    if (!selectedRegionKey || countryGroupsInContinent.some((group) => group.key === selectedRegionKey)) return;
    setSelectedRegionKey(null);
    setSelectedLineKey(null);
    setSelectedResourceId(null);
  }, [countryGroupsInContinent, selectedRegionKey]);

  useEffect(() => {
    if (resourcePageNumber <= resourcePageCount) return;
    setResourcePageNumber(resourcePageCount);
  }, [resourcePageCount, resourcePageNumber]);

  const orderMutation = useMutation({
    mutationFn: () => {
      if (!selectedResourceIdForPurchase || selectedQuantity < 1 || !currency) {
        throw new ApiError('VALIDATION_ERROR', 'quote_required_fields_missing');
      }
      if (!selectedResource || !canAttemptQuote(selectedResource)) {
        throw new ApiError('VALIDATION_ERROR', 'resource_not_buyable');
      }
      if (!quoteMatchesSelection || !quote || quoteLoading || currentQuoteError || insufficient) {
        throw new ApiError('VALIDATION_ERROR', 'quote_required_fields_missing');
      }
      return userApiRequest<OrderResultDto>('/api/orders/static-proxy', {
        method: 'POST',
        body: JSON.stringify(buildStaticProxyOrderBody({
          resourceId: selectedResourceIdForPurchase,
          durationDays,
          quantity: selectedQuantity,
          currency,
          idempotencyKey: globalThis.crypto.randomUUID(),
        })),
      });
    },
    onSuccess: (data) => {
      setOrderResult(data);
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet', userId] });
      void queryClient.invalidateQueries({ queryKey: ['customer-proxies'] });
      void queryClient.invalidateQueries({ queryKey: ['resources-list'] });
    },
  });

  const purchaseButtonText = orderMutation.isPending
    ? t('customer.buy.orderSubmitting')
    : quoteLoading
      ? t('customer.buy.quoteRefreshing')
      : t('customer.buy.confirmBtn');

  useEffect(() => {
    quoteRequestRef.current += 1;
    if (!selectedResourceIdForPurchase || !selectedResourceQuotable || selectedQuantity < 1 || !currency) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    const requestId = quoteRequestRef.current;
    const quoteInput = {
      resourceId: selectedResourceIdForPurchase,
      durationDays,
      quantity: selectedQuantity,
      currency,
    };
    setQuote(null);
    setQuoteError(null);
    setQuoteLoading(true);
    const timer = setTimeout(() => {
      userApiRequest<QuoteDto>(buildStaticProxyQuotePath(quoteInput))
        .then((data) => {
          if (quoteRequestRef.current !== requestId) return;
          setQuote({ ...data, ...quoteInput });
          setQuoteError(null);
        })
        .catch((e) => {
          if (quoteRequestRef.current !== requestId) return;
          setQuote(null);
          setQuoteError({
            ...quoteInput,
            message: formatCustomerBuyError(t, e),
          });
        })
        .finally(() => {
          if (quoteRequestRef.current === requestId) setQuoteLoading(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [currency, durationDays, selectedQuantity, selectedResourceFingerprint, selectedResourceIdForPurchase, selectedResourceQuotable]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setResourceSearch(productSearch);
      setResourcePageNumber(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [productSearch]);

  const resetResourceSelection = useCallback(() => {
    setSelectedRegionKey(null);
    setSelectedLineKey(null);
    setSelectedResourceId(null);
  }, []);

  const setResourceQuantity = (resourceId: string, nextQuantity: number) => {
    const resource = visibleResources.find((item) => item.id === resourceId);
    if (!resource || !canAttemptQuote(resource)) {
      setSelectedResourceId(resourceId);
      setQuantities((current) => ({ ...current, [resourceId]: 0 }));
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    const quantity = Math.max(0, Math.trunc(nextQuantity || 0));
    setSelectedResourceId(quantity > 0 ? resourceId : selectedResourceId === resourceId ? null : selectedResourceId);
    setQuantities((current) => ({ ...current, [resourceId]: quantity }));
  };

  if (currentQuery.isLoading || walletQuery.isLoading) return <Skeleton active />;
  const viewError = currentQuery.error ?? walletQuery.error ?? countriesQuery.error;
  if (viewError) {
    const apiErr = viewError as ApiError;
    const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={formatCustomerBuyError(t, viewError)}
        showIcon
      />
    );
  }

  return (
    <div className="ipx-static-purchase-page ipx-customer-page ipx-customer-buy-page">
      {orderResult && (
        <FulfillmentWaitingPanel
          labels={{
            title: t('customer.buy.fulfillmentWaiting.title'),
            subtitle: t('customer.buy.fulfillmentWaiting.subtitle', { orderId: orderResult.orderId, status: formatOrderStatus(t, orderResult.status) }),
            status: formatOrderStatus(t, orderResult.status),
            statusLabel: t('customer.buy.fulfillmentWaiting.statusLabel'),
            stepPaid: t('customer.buy.fulfillmentWaiting.stepPaid'),
            stepUpstream: t('customer.buy.fulfillmentWaiting.stepUpstream'),
            stepDelivery: t('customer.buy.fulfillmentWaiting.stepDelivery'),
            goProxies: t('customer.nav.proxies'),
            refresh: t('refresh'),
            refreshing: t('customer.buy.fulfillmentWaiting.refreshing'),
          }}
          onGoProxies={() => navigateTo('/proxies')}
          onRefresh={() => {
            setFulfillmentRefreshing(true);
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: ['customer-wallet', userId] }),
              queryClient.invalidateQueries({ queryKey: ['customer-proxies'] }),
              queryClient.invalidateQueries({ queryKey: ['resources-list'] }),
            ])
              .then(() => message.success(t('customer.buy.fulfillmentWaiting.refreshSuccess')))
              .catch(() => message.error(t('customer.buy.fulfillmentWaiting.refreshFailed')))
              .finally(() => setFulfillmentRefreshing(false));
          }}
          refreshing={fulfillmentRefreshing || walletQuery.isFetching || resourcesQuery.isFetching}
        />
      )}
      {orderMutation.error && (
        <Alert
          type="error"
          message={t('error')}
          description={formatCustomerBuyError(t, orderMutation.error)}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {orderMutation.isPending && (
        <Alert
          type="info"
          message={t('customer.buy.orderSubmittingShort')}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Row className="ipx-buy-layout" gutter={[20, 20]} align="top">
        <Col xs={24} xl={16} xxl={17} className="ipx-purchase-main-col">
          <Space className="ipx-buy-selector-stack" direction="vertical" size={16} style={{ width: '100%' }}>
            <section className="ipx-buy-panel ipx-buy-region-panel">
              <div className="ipx-buy-panel-head">
                <div className="ipx-buy-title-row">
                  <Typography.Title level={4}>{t('customer.buy.regionTitle')}</Typography.Title>
                  <Input.Search
                    className="ipx-buy-region-search"
                    allowClear
                    enterButton={t('customer.buy.searchRegion')}
                    value={productSearch}
                    onChange={(event) => {
                      const next = event.target.value;
                      setProductSearch(next);
                      resetResourceSelection();
                    }}
                    placeholder={t('customer.buy.productSearchPlaceholder')}
                  />
                </div>
                <Space size={8} wrap className="ipx-buy-header-meta">
                  <Tag>{t('customer.buy.loadedProductsTitle')}: {resourceLoadValue}</Tag>
                  <Tag color="blue">{durationDays} {t('customer.buy.days')}</Tag>
                </Space>
                {continentOptions.length > 0 && (
                  <Segmented
                    value={activeContinent}
                    onChange={(value) => {
                      setSelectedContinent(String(value));
                      setResourcePageNumber(1);
                      resetResourceSelection();
                    }}
                    options={continentOptions}
                    className="ipx-buy-continent-tabs"
                  />
                )}
              </div>
              {countriesQuery.isError ? (
                <Alert
                  type="error"
                  message={t('error')}
                  description={formatCustomerBuyError(t, countriesQuery.error)}
                  showIcon
                />
              ) : countriesQuery.isLoading ? (
                <Skeleton active />
              ) : countryGroups.length === 0 ? (
                <Empty description={t('customer.buy.noResources')} />
              ) : countryGroupsInContinent.length === 0 ? (
                <Empty description={t('customer.buy.noSearchResults')} />
              ) : (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <div className="ipx-buy-card-grid ipx-buy-region-grid">
                    {countryGroupsInContinent.map((group) => (
                      <PurchaseOptionCard
                        key={group.key}
                        active={selectedRegion?.key === group.key}
                        icon={countryFlagEmoji(group.countryCode)}
                        title={group.label}
                        subtitle={formatCountryAvailabilitySummary(group, {
                          available: t('customer.buy.availableShort'),
                          realtime: t('customer.buy.stockRealtime'),
                        })}
                        muted={group.totalResources <= 0}
                        onSelect={() => {
                          setSelectedRegionKey(group.key);
                          setResourcePageNumber(1);
                          setSelectedLineKey(null);
                          setSelectedResourceId(null);
                          setQuote(null);
                          setQuoteError(null);
                          setQuoteLoading(false);
                        }}
                      />
                    ))}
                  </div>
                </Space>
              )}
            </section>

            <section className="ipx-buy-panel">
              <div className="ipx-buy-section-head">
                <Typography.Title level={4}>{t('customer.buy.lineTitle')}</Typography.Title>
                {selectedRegion && <Typography.Text type="secondary">{selectedRegion.label}</Typography.Text>}
              </div>
              {resourcesQuery.isError ? (
                <Alert
                  type="error"
                  message={t('error')}
                  description={formatCustomerBuyError(t, resourcesQuery.error)}
                  showIcon
                />
              ) : resourcesQuery.isLoading || resourcesQuery.isFetching ? (
                <Skeleton active />
              ) : selectedRegionResources.length === 0 ? (
                <Empty description={t('customer.buy.noSearchResults')} />
              ) : (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <div className="ipx-buy-card-grid ipx-buy-line-grid">
                    {resourceLineGroups.map((group) => (
                      <PurchaseOptionCard
                        key={group.key}
                        active={selectedLine?.key === group.key}
                        title={group.label}
                        subtitle={formatResourceLineSubtitle(group, {
                          template: t('customer.buy.lineOptionSubtitle', {
                            resources: group.resources.length,
                            price: summarizeLineSalePrice(group.resources, currentLanguage) ?? t('customer.buy.linePricePending'),
                          }),
                        })}
                        onSelect={() => {
                          setSelectedLineKey(group.key);
                          setSelectedResourceId(null);
                          setQuote(null);
                          setQuoteError(null);
                          setQuoteLoading(false);
                        }}
                      />
                    ))}
                  </div>
                  <AutoAssignedResourcePanel
                    resource={selectedResource}
                    labels={{
                      title: t('customer.buy.autoAssignTitle'),
                    }}
                  />
                  {resourceTotal > currentResourcePageSize && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Pagination
                        current={currentResourcePage}
                        pageSize={currentResourcePageSize}
                        total={resourceTotal}
                        showSizeChanger={false}
                        onChange={(nextPage) => {
                          setResourcePageNumber(nextPage);
                          setSelectedLineKey(null);
                          setSelectedResourceId(null);
                          setQuote(null);
                          setQuoteError(null);
                          setQuoteLoading(false);
                        }}
                      />
                    </div>
                  )}
                </Space>
              )}
            </section>
          </Space>
        </Col>

        <Col xs={24} xl={8} xxl={7} className="ipx-order-panel-col">
          <Card
            className={selectedResource ? 'ipx-order-panel ipx-order-panel-ready' : 'ipx-order-panel'}
            variant="borderless"
            style={{
              border: '1px solid #d8e3ff',
              borderRadius: 8,
              boxShadow: 'none',
              background: selectedResource ? 'linear-gradient(180deg, #ffffff 0%, #f5f8ff 100%)' : '#ffffff',
            }}
            styles={{ body: { padding: 16 } }}
          >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={10}>
                  <ShoppingCartOutlined style={{ color: 'var(--ipx-primary, #003afe)', fontSize: 20 }} />
                  <Typography.Title level={4} style={{ margin: 0, fontSize: 17 }}>{t('customer.buy.orderTitle')}</Typography.Title>
                {orderMutation.isPending ? (
                  <Tag color="processing" style={{ marginInlineEnd: 0 }}>{t('customer.buy.orderSubmittingShort')}</Tag>
                ) : quoteLoading ? (
                  <Tag color="processing" style={{ marginInlineEnd: 0 }}>{t('customer.buy.quoteRefreshing')}</Tag>
                  ) : canBuy ? (
                    <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('customer.buy.checkoutReady')}</Tag>
                  ) : null}
                </Space>

                <Space size={8} align="center" wrap>
                  <Typography.Text type="secondary">{t('customer.buy.walletAvailable')}</Typography.Text>
                  <Typography.Text strong>{walletDisplay}</Typography.Text>
                  <Button size="small" type="link" onClick={() => navigateTo('/wallet/topup')}>
                    {t('customer.buy.topupLink')}
                  </Button>
                </Space>

                <div className="ipx-order-selected">
                {selectedResource ? (
                  <SelectedResourceSummary
                    resource={selectedResource}
                    lineLabel={selectedLine?.label}
                    language={currentLanguage}
                  />
                ) : <Typography.Text type="secondary">{t('customer.buy.selectProductFirst')}</Typography.Text>}
              </div>

              {selectedResource && (
                <div className="ipx-order-quantity-row">
                  <Typography.Text type="secondary">{t('customer.buy.quantity')}</Typography.Text>
                  <InputNumber
                    min={0}
                    precision={0}
                    value={selectedQuantity}
                    disabled={!selectedResourceQuotable}
                    onChange={(value) => setResourceQuantity(selectedResource.id, Number(value ?? 0))}
                    style={{ width: 112 }}
                  />
                </div>
              )}

              <div className="ipx-order-total">
                {quoteLoading && (
                  <div className="ipx-quote-loading-indicator" aria-hidden="true">
                    <LoadingOutlined spin />
                  </div>
                )}
                <Typography.Text type="secondary">{t('customer.buy.ipCount', { count: selectedQuantity })} / {durationDays} {t('customer.buy.days')}</Typography.Text>
                <Typography.Title level={2} style={{ margin: 0, color: 'var(--ipx-primary, #003afe)', fontSize: 28 }}>
                  {orderTotalDisplay}
                </Typography.Title>
                <Typography.Text type="secondary">{t('customer.buy.totalForDays', { days: durationDays })}</Typography.Text>
              </div>

              {quoteLoading && <Alert type="info" message={t('customer.buy.quoteLoading')} showIcon />}
              {orderMutation.isPending && <Alert type="info" message={t('customer.buy.orderSubmittingShort')} showIcon />}
              {currentQuoteError && <Alert type="error" message={t('customer.buy.quoteStatusBlocked')} description={currentQuoteError} showIcon />}
              {selectedResource && !selectedResourceQuotable && (
                <Alert type="warning" message={getResourceUnavailableReason(selectedResource, {
                  stockUnavailable: t('customer.buy.stockUnavailable'),
                  stockUnknown: t('customer.buy.stockUnknown'),
                  stockRealtime: t('customer.buy.stockRealtime'),
                  staleInventory: t('customer.buy.staleInventory'),
                })} showIcon />
              )}
              {insufficient && (
                <Alert
                  type="warning"
                  message={<span>{t('customer.buy.insufficientBalance')}{' '}<a onClick={() => navigateTo('/wallet/topup')}>{t('customer.buy.topupLink')}</a></span>}
                  showIcon
                />
              )}

              <Button
                type="primary"
                size="large"
                block
                loading={orderMutation.isPending}
                disabled={!canBuy}
                icon={quoteLoading && !orderMutation.isPending ? <LoadingOutlined /> : undefined}
                aria-label={t('customer.buy.confirmBtn')}
                onClick={() => orderMutation.mutate()}
                style={{ borderRadius: 8, fontWeight: 800 }}
              >
                {purchaseButtonText}
              </Button>
              {!canBuy && (
                <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
                  {buyDisabledReason}
                </Typography.Text>
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function PurchaseOptionCard({
  active,
  icon,
  title,
  subtitle,
  muted,
  onSelect,
}: {
  active: boolean;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        'ipx-buy-option-card',
        active ? 'ipx-buy-option-card-active' : '',
        muted ? 'ipx-buy-option-card-muted' : '',
      ].filter(Boolean).join(' ')}
      aria-pressed={active}
      onClick={onSelect}
    >
      {icon && <span className="ipx-buy-option-icon">{icon}</span>}
      <span className="ipx-buy-option-copy">
        <Typography.Text strong ellipsis={{ tooltip: String(title) }}>{title}</Typography.Text>
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      </span>
    </button>
  );
}

function AutoAssignedResourcePanel({
  resource,
  labels,
}: {
  resource: ResourceDto | null;
  labels: {
    title: string;
  };
}) {
  if (!resource) {
    return (
      <div className="ipx-buy-auto-panel">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={labels.title} />
      </div>
    );
  }
  return (
    <div className="ipx-buy-auto-panel">
      <Space align="start" size={10} style={{ width: '100%' }}>
        <span className="ipx-selected-resource-flag">{countryFlagEmoji(resource.countryCode || resource.code)}</span>
        <div className="ipx-truncate">
          <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
            {labels.title}
          </Typography.Title>
        </div>
      </Space>
    </div>
  );
}

function FulfillmentWaitingPanel({
  labels,
  onGoProxies,
  onRefresh,
  refreshing,
}: {
  labels: {
    title: React.ReactNode;
    subtitle: React.ReactNode;
    stepPaid: React.ReactNode;
    stepUpstream: React.ReactNode;
    stepDelivery: React.ReactNode;
    goProxies: React.ReactNode;
    status: React.ReactNode;
    statusLabel: React.ReactNode;
    refresh: React.ReactNode;
    refreshing: React.ReactNode;
  };
  onGoProxies: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card
      className="ipx-fulfillment-card ipx-customer-card"
      variant="borderless"
      style={{
        marginBottom: 16,
        borderRadius: 12,
        boxShadow: 'none',
      }}
      styles={{ body: { padding: 18 } }}
    >
      <Row gutter={[16, 16]} align="middle">
        <Col xs={24} md={7}>
          <Space size={12} align="start">
            <div className="ipx-fulfillment-orbit">
              <LoadingOutlined style={{ fontSize: 22 }} spin />
            </div>
            <div>
              <Typography.Title level={4} style={{ margin: 0, fontSize: 17 }}>{labels.title}</Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{labels.subtitle}</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                  {labels.statusLabel}: {labels.status}
                </Tag>
              </div>
            </div>
          </Space>
        </Col>
        <Col xs={24} md={13}>
          <Steps
            size="small"
            current={1}
            items={[
              {
                status: 'finish',
                icon: <CheckOutlined />,
                title: labels.stepPaid,
              },
              {
                status: 'process',
                icon: <CloudServerOutlined />,
                title: labels.stepUpstream,
              },
              {
                status: 'wait',
                icon: <ClockCircleOutlined />,
                title: labels.stepDelivery,
              },
            ]}
          />
        </Col>
        <Col xs={24} md={4} style={{ textAlign: 'right' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Button type="primary" onClick={onGoProxies} style={{ borderRadius: 8, width: '100%' }}>
              {labels.goProxies}
            </Button>
            <Button loading={refreshing} onClick={onRefresh} style={{ borderRadius: 8, width: '100%' }}>
              {refreshing ? labels.refreshing : labels.refresh}
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );
}

function SelectedResourceSummary({
  resource,
  lineLabel,
  language,
}: {
  resource: ResourceDto;
  lineLabel?: string | null;
  language?: string;
}) {
  const countryCode = resource.countryCode || resource.code;
  const location = formatResourceLocationForLanguage(resource, language);
  return (
    <div className="ipx-selected-resource-summary">
      <div className="ipx-selected-resource-head">
        <span className="ipx-selected-resource-flag">{countryFlagEmoji(countryCode)}</span>
        <div className="ipx-truncate">
          <Typography.Text strong>{location.country}</Typography.Text>
          {lineLabel ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {lineLabel}
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function canAttemptQuote(resource: ResourceDto): boolean {
  return hasResourcePrice(resource);
}

export function matchesResourceSearch(resource: ResourceDto, search: string, language?: string): boolean {
  const keyword = search.trim().toLowerCase();
  if (!keyword) return true;
  const location = formatResourceLocationForLanguage(resource, language);
  const alternateLocation = isEnglishLanguage(language)
    ? formatResourceLocationZh(resource)
    : formatResourceLocationEn(resource);
  return [
    resource.code,
    resource.countryCode,
    resource.name,
    resource.displayName,
    resource.upstreamResourceId,
    location.title,
    location.country,
    location.city,
    location.line,
    location.detail,
    alternateLocation.title,
    alternateLocation.country,
    alternateLocation.city,
    alternateLocation.line,
    alternateLocation.detail,
    formatProviderLabel(resource.providerCode),
  ].some((value) => value?.toLowerCase().includes(keyword));
}

function getResourceUnavailableReason(resource: ResourceDto, labels: { stockUnavailable: string; stockUnknown: string; stockRealtime: string; staleInventory: string }): string {
  if (!hasResourcePrice(resource)) return labels.stockUnavailable;
  if (resource.inventoryIsStale === true) return labels.staleInventory;
  if (resource.stock === null || resource.stock === undefined) return labels.stockUnknown;
  return labels.stockUnavailable;
}

function getResourceSpecificity(resource: ResourceDto): number {
  const location = formatResourceLocationZh(resource);
  if (location.city || location.detail) return 1;
  return 0;
}

function hasResourcePrice(resource: ResourceDto): boolean {
  return resource.unitPrice !== null && resource.unitPrice !== undefined && resource.unitPrice.trim() !== '';
}

function hasAvailableInventory(resource: ResourceDto): boolean {
  return typeof resource.stock === 'number'
    && Number.isFinite(resource.stock)
    && resource.stock > 0
    && resource.inventoryIsStale !== true;
}

function isResourcePurchaseVisible(resource: ResourceDto): boolean {
  if (resource.status && resource.status !== 'ACTIVE') return false;
  if (resource.isVisible === false) return false;
  if (resource.isSaleable === false) return false;
  return hasResourcePrice(resource);
}

function formatOrderStatus(t: (key: string, options?: Record<string, unknown>) => string, status?: string | null): string {
  if (!status) return '-';
  const key = `orders.statusValue.${status}`;
  const label = t(key);
  return label === key ? t('orders.statusUnknown') : label;
}

function formatCustomerBuyReason(
  t: (key: string, options?: Record<string, unknown>) => string,
  reasonKey?: string | null,
): string {
  if (!reasonKey) return t('customer.buy.reason.error');
  const translationKey = `customer.buy.reason.${reasonKey}`;
  const label = t(translationKey);
  return label === translationKey ? t('customer.buy.reason.error') : label;
}

function formatCustomerBuyError(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  if (!(error instanceof ApiError)) return t('customer.buy.reason.error');
  return formatCustomerBuyReason(t, error.reasonKey);
}

function getBuyDisabledReason({
  selectedResource,
  selectedQuantity,
  quote,
  quoteError,
  insufficient,
  quoteLoading,
  labels,
}: {
  selectedResource: ResourceDto | null;
  selectedQuantity: number;
  quote: QuoteDto | null;
  quoteError: string | null;
  insufficient: boolean;
  quoteLoading: boolean;
  labels: {
    selectProductFirst: string;
    quantityMin: string;
    quoteLoading: string;
    quoteRequired: string;
    quoteError: string;
    insufficientBalance: string;
    stockUnavailable: string;
    stockUnknown: string;
    stockRealtime: string;
    staleInventory: string;
  };
}): string {
  if (!selectedResource) return labels.selectProductFirst;
  if (!canAttemptQuote(selectedResource)) return getResourceUnavailableReason(selectedResource, labels);
  if (selectedQuantity < 1) return labels.quantityMin;
  if (quoteLoading) return labels.quoteLoading;
  if (quoteError) return `${labels.quoteError}: ${quoteError}`;
  if (!quote) return labels.quoteRequired;
  if (insufficient) return labels.insufficientBalance;
  return labels.quoteRequired;
}

function formatOrderTotalDisplay({
  quote,
  quoteLoading,
  selectedResource,
  selectedResourceQuotable,
  currency,
  language,
  labels,
}: {
  quote: QuoteDto | null;
  quoteLoading: boolean;
  selectedResource: ResourceDto | null;
  selectedResourceQuotable: boolean;
  currency: string;
  language?: string;
  labels: { quoteLoading: string; notPurchasable: string };
}): string {
  if (quoteLoading) return labels.quoteLoading;
  if (quote) return formatCustomerBuyMoneyAmount(quote.totalPrice, quote.currency, language) ?? '-';
  if (selectedResource && !selectedResourceQuotable) return labels.notPurchasable;
  return formatCustomerBuyMoneyAmount(0, currency, language) ?? '-';
}

function formatCustomerBuyMoneyAmount(value: string | number | null | undefined, currency = 'CNY', language?: string): string | null {
  const formatted = formatMoneyAmount(value, currency);
  if (!formatted) return null;
  if (isEnglishLanguage(language)) return formatted;
  return formatted.replace(/\sCNY$/i, ' \u5143');
}

type CountryResourceGroup = {
  key: string;
  countryCode: string;
  label: string;
  continent: string;
  totalResources: number;
  availableStock: number;
};

type ResourceLineGroup = {
  key: string;
  label: string;
  resources: ResourceDto[];
};

function formatResourceLocationForLanguage(resource: Parameters<typeof formatResourceLocationZh>[0], language?: string): ResourceLocationLabel {
  return isEnglishLanguage(language) ? formatResourceLocationEn(resource) : formatResourceLocationZh(resource);
}

async function fetchStaticProxyResourceCountries(currency: string, search: string): Promise<CountrySummaryResult> {
  return userApiRequest<CountrySummaryResult>(
    `/api/resources/countries${buildQuery({
      durationDays: STATIC_PROXY_DURATION_DAYS,
      currency,
      search,
    })}`,
  );
}

async function fetchStaticProxyResources(currency: string, search: string, countryCode: string, pageNumber: number): Promise<ResourceListResult> {
  const page = await userApiRequest<ResourcePageDto>(
    `/api/resources${buildQuery({
      page: pageNumber,
      pageSize: RESOURCE_LIST_PAGE_SIZE,
      durationDays: STATIC_PROXY_DURATION_DAYS,
      currency,
      countryCode,
      search,
    })}`,
  );
  const items = dedupeResourcesById(page.items);
  const total = typeof page.total === 'number' && Number.isFinite(page.total)
    ? Math.max(page.total, items.length)
    : items.length;
  const pageSize = typeof page.pageSize === 'number' && Number.isFinite(page.pageSize)
    ? page.pageSize
    : RESOURCE_LIST_PAGE_SIZE;
  const currentPage = typeof page.page === 'number' && Number.isFinite(page.page)
    ? page.page
    : pageNumber;
  return { items, total, page: currentPage, pageSize };
}

function dedupeResourcesById(resources: ResourceDto[]): ResourceDto[] {
  const map = new Map<string, ResourceDto>();
  for (const resource of resources) map.set(resource.id, resource);
  return [...map.values()];
}

function groupCountrySummaries(countries: CountrySummaryDto[], language?: string): CountryResourceGroup[] {
  const summaries = new Map<string, { totalResources: number; availableStock: number }>();
  for (const country of countries) {
    const countryCode = country.countryCode?.trim().toUpperCase();
    if (!countryCode) continue;
    const current = summaries.get(countryCode) ?? { totalResources: 0, availableStock: 0 };
    current.totalResources += Number.isFinite(country.totalResources) ? country.totalResources : 1;
    current.availableStock += Number.isFinite(country.availableStock) ? country.availableStock : 0;
    summaries.set(countryCode, current);
  }
  return [...summaries.entries()]
    .map(([countryCode, summary]) => ({
      key: countryCode,
      countryCode,
      label: formatResourceLocationForLanguage({
        id: countryCode,
        code: countryCode,
        countryCode,
        name: countryCode,
        displayName: countryCode,
      }, language).country,
      continent: continentOfCountry(countryCode),
      totalResources: summary.totalResources,
      availableStock: summary.availableStock,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function groupResourcesByCostLine(resources: ResourceDto[], language?: string): ResourceLineGroup[] {
  const grouped = new Map<string, ResourceDto[]>();
  for (const resource of resources) {
    const key = getResourceCostGroupKey(resource);
    const list = grouped.get(key) ?? [];
    list.push(resource);
    grouped.set(key, list);
  }
  return [...grouped.entries()]
    .map(([key, groupResources]) => ({
      key,
      resources: sortResourcesForPurchase(groupResources, 'priceAsc'),
    }))
    .sort(compareResourceLineGroups)
    .map((group, index) => ({
      ...group,
      label: formatNetworkSequenceLabel(index, language),
    }));
}

function getResourceCostGroupKey(resource: ResourceDto): string {
  return resource.costGroupKey?.trim() || 'cost-missing';
}

function compareResourceLineGroups(
  left: Pick<ResourceLineGroup, 'key' | 'resources'>,
  right: Pick<ResourceLineGroup, 'key' | 'resources'>,
): number {
  const preferredInventoryCompare = Number(right.resources.some(hasPreferredInventory)) - Number(left.resources.some(hasPreferredInventory));
  if (preferredInventoryCompare !== 0) return preferredInventoryCompare;
  const quotableCompare = Number(right.resources.some(canAttemptQuote)) - Number(left.resources.some(canAttemptQuote));
  if (quotableCompare !== 0) return quotableCompare;
  const priceCompare = getLineSortableUnitPrice(left.resources) - getLineSortableUnitPrice(right.resources);
  if (priceCompare !== 0) return priceCompare;
  return left.key.localeCompare(right.key);
}

function getLineSortableUnitPrice(resources: ResourceDto[]): number {
  return resources.reduce((lowest, resource) => Math.min(lowest, getSortableUnitPrice(resource)), Number.POSITIVE_INFINITY);
}

function getPreferredResourceLineGroup(groups: ResourceLineGroup[]): ResourceLineGroup | null {
  return groups.find((group) => group.resources.some(hasPreferredInventory))
    ?? groups.find((group) => group.resources.some(canAttemptQuote))
    ?? groups[0]
    ?? null;
}

function formatResourceLineSubtitle(group: ResourceLineGroup, labels: { template: string }): string {
  void group;
  return labels.template;
}

function summarizeLineSalePrice(resources: ResourceDto[], language?: string): string | null {
  const prices = resources
    .map((resource) => {
      const amount = Number(resource.unitPrice);
      if (!Number.isFinite(amount)) return null;
      const currency = resource.priceCurrency ?? 'CNY';
      const label = formatCustomerBuyMoneyAmount(amount, currency, language);
      return label ? { amount, currency, label } : null;
    })
    .filter((value): value is { amount: number; currency: string; label: string } => value !== null);
  if (prices.length === 0) return null;
  const currencies = [...new Set(prices.map((price) => price.currency))];
  if (currencies.length !== 1) return [...new Set(prices.map((price) => price.label))].slice(0, 2).join(' / ');
  const currency = currencies[0]!;
  const amounts = [...new Set(prices.map((price) => price.amount))].sort((left, right) => left - right);
  if (amounts.length === 1) return prices[0]!.label;
  const min = formatCustomerBuyMoneyAmount(amounts[0]!, currency, language) ?? `${amounts[0]} ${currency}`;
  const max = formatCustomerBuyMoneyAmount(amounts[amounts.length - 1]!, currency, language) ?? `${amounts[amounts.length - 1]} ${currency}`;
  return `${min} - ${max}`;
}

function buildContinentOptions(groups: CountryResourceGroup[], t: (key: string, values?: Record<string, unknown>) => string) {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group.continent, (counts.get(group.continent) ?? 0) + 1);
  const options: Array<{ label: string; value: string }> = [];
  for (const key of ['northAmerica', 'asia', 'europe', 'southAmerica', 'africa', 'oceania']) {
    const count = counts.get(key) ?? 0;
    if (count > 0) options.push({ label: stripCountSuffix(t(`customer.buy.continent.${key}`, { count })), value: key });
  }
  return options;
}

function stripCountSuffix(label: string): string {
  return label.replace(/\s*[\u0028\uFF08]?\d+[\u0029\uFF09]?\s*$/, '').trim();
}

function continentOfCountry(countryCode: string): string {
  if (['US', 'CA', 'MX'].includes(countryCode)) return 'northAmerica';
  if (['BR'].includes(countryCode)) return 'southAmerica';
  if (['GB', 'FR', 'DE', 'IT', 'ES', 'PL', 'TR', 'NL', 'AT', 'RO', 'LV', 'UA'].includes(countryCode)) return 'europe';
  if (['AE', 'ZA'].includes(countryCode)) return countryCode === 'ZA' ? 'africa' : 'asia';
  if (['AU'].includes(countryCode)) return 'oceania';
  return 'asia';
}

function getPreferredCountrySummary<T extends { availableStock: number; totalResources: number }>(groups: T[]): T | null {
  return groups.find((group) => group.availableStock > 0)
    ?? groups.find((group) => group.totalResources > 0)
    ?? groups[0]
    ?? null;
}

function formatCountryAvailabilitySummary(country: CountryResourceGroup, labels: { available: string; realtime: string }): string {
  const count = country.availableStock;
  return count > 0 ? `${labels.available}: ${count}` : labels.realtime;
}

function hasPreferredInventory(resource: ResourceDto): boolean {
  return hasResourcePrice(resource) && hasAvailableInventory(resource);
}

function sortResourcesForPurchase(resources: ResourceDto[], sort: 'priceAsc' | 'provider' | 'stockDesc'): ResourceDto[] {
  const indexed = resources.map((resource, index) => ({ resource, index }));
  indexed.sort((left, right) => {
    const preferredInventoryCompare = Number(hasPreferredInventory(right.resource)) - Number(hasPreferredInventory(left.resource));
    if (preferredInventoryCompare !== 0) return preferredInventoryCompare;
    const quotableCompare = Number(canAttemptQuote(right.resource)) - Number(canAttemptQuote(left.resource));
    if (quotableCompare !== 0) return quotableCompare;
    const specificityCompare = getResourceSpecificity(right.resource) - getResourceSpecificity(left.resource);
    if (specificityCompare !== 0) return specificityCompare;
    if (sort === 'provider') {
      const providerCompare = formatProviderLabel(left.resource.providerCode).localeCompare(formatProviderLabel(right.resource.providerCode), 'zh-CN');
      if (providerCompare !== 0) return providerCompare;
    }
    if (sort === 'stockDesc') {
      const stockCompare = getSortableStock(right.resource) - getSortableStock(left.resource);
      if (stockCompare !== 0) return stockCompare;
    }
    const priceCompare = getSortableUnitPrice(left.resource) - getSortableUnitPrice(right.resource);
    if (priceCompare !== 0) return priceCompare;
    return indexedResourceLabel(left.resource).localeCompare(indexedResourceLabel(right.resource), 'zh-CN') || left.index - right.index;
  });
  return indexed.map((item) => item.resource);
}

function getSortableUnitPrice(resource: ResourceDto): number {
  const price = Number(resource.unitPrice);
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
}

function getSortableStock(resource: ResourceDto): number {
  if (resource.stock === null || resource.stock === undefined || resource.inventoryIsStale === true) return -1;
  return resource.stock;
}

function indexedResourceLabel(resource: ResourceDto): string {
  const location = formatResourceLocationZh(resource);
  return `${location.country}-${location.city ?? ''}-${location.detail ?? ''}-${resource.id}`;
}

function getPreferredResource(resources: ResourceDto[]): ResourceDto | null {
  return resources.find((resource) => getResourceSpecificity(resource) > 0 && hasPreferredInventory(resource))
    ?? resources.find(hasPreferredInventory)
    ?? resources.find((resource) => getResourceSpecificity(resource) > 0 && canAttemptQuote(resource))
    ?? resources.find(canAttemptQuote)
    ?? resources[0]
    ?? null;
}


function countryFlagEmoji(countryCode?: string): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}
