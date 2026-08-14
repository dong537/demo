import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertSafeUrl } from '../../../common/utils/ssrf';
import { assertProviderActive, fetchWithTimeout, recordUpstreamRequest } from '../provider-http';
import {
  ProviderAdapter,
  ProviderRuntimeConfig,
  ProviderHealthResult,
  InventorySyncResult,
  InventoryItem,
  StaticProxyBuyInput,
  ProviderBuyResult,
  BuyRequestPreview,
  ProxyDelivery,
  ProviderOrderQuery,
  ProviderOrderResult,
} from '../provider.types';
import { UpstreamLogRepository } from '../upstream-log.repository';
import { IPIPD_ALPHA2_TO_ALPHA3, IPIPD_ALPHA3_TO_ALPHA2, providerCountryName } from '../provider-country-coverage';
import { requireFutureDeliveryExpiry } from '../provider-delivery-expiry';


const API_PREFIX = '/openapi/v2';

interface EnvelopeV2<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  timestamp: string;
  traceId: string;
}

interface AccountV2DTO {
  userId: string;
  username: string;
  email: string;
  status: string;
  currency: string;
  balance: number;
  totalRechargeAmount: number;
}

interface PageResultV2<T> {
  size: number;
  current: number;
  total: number;
  records: T[];
  offset: number;
}

interface StaticLineV2DTO {
  id: string;
  cityCode?: string;
  countryCode: string;
  businessTypeCode?: string;
  ispType?: number;
  protocols?: number;
  tag?: string;
  quantity?: number;
  minDays?: number;
  maxDays?: number;
  price?: number;
  currency?: string;
  active?: boolean;
  status?: number;
  cidrs?: StaticLineCidrDTO[];
}

interface StaticLineCidrDTO {
  cidr?: string;
  availableCount?: number;
}

interface StaticInstanceV2DTO {
  proxyId: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  protocol?: number | string;
  status?: number;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  countryCode?: string;
  cityCode?: string;
  ispType?: number;
  lineId?: string;
}

interface StaticOrderV2DTO {
  orderNo: string;
  externalOrderNo?: string;
  status: number;
  type?: number;
  quantity?: number;
  days?: number;
  totalPrice?: number;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  instances?: StaticInstanceV2DTO[];
}

@Injectable()
export class IpipdAdapter implements ProviderAdapter {
  readonly code = 'IPIPD' as const;

  constructor(private readonly upstreamLogRepo?: UpstreamLogRepository) {}

  /**
   * Builds IPIPD HMAC-SHA256 auth headers.
   * Signature string: METHOD + URI + timestamp + nonce + body.
   */
  private buildAuthHeaders(
    method: string,
    uri: string,
    body: string,
    config: ProviderRuntimeConfig,
  ): Record<string, string> {
    const appId = config.credential['appId'] ?? '';
    const appSecret = config.credential['appSecret'] ?? '';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const signString = `${method.toUpperCase()}${uri}${timestamp}${nonce}${body}`;
    const signature = createHmac('sha256', appSecret).update(signString).digest('hex');
    return {
      'X-API-AppId': appId,
      'X-API-Timestamp': timestamp,
      'X-API-Nonce': nonce,
      'X-API-Signature': signature,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Parses the IPIPD response envelope and throws AppError on upstream failure.
   */
  private parseEnvelope<T>(raw: unknown): T {
    const env = raw as EnvelopeV2<T> | null;
    if (!env || typeof env !== 'object') {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_invalid_response', 502);
    }
    if (env.success !== true || env.code !== 'SUCCESS') {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, env.message || 'upstream_error', 502);
    }
    return env.data;
  }

  /**
   * Sends one signed IPIPD request and parses the response envelope.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    uri: string,
    bodyObj: unknown,
    config: ProviderRuntimeConfig,
  ): Promise<T> {
    const url = ipipdUrl(config.baseUrl, uri);
    // Build the body string once so signing and transport use identical bytes.
    const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    const headers = this.buildAuthHeaders(method, uri, body, config);
    const opts: RequestInit = { method, headers };
    if (method === 'POST') {
      opts.body = body;
    }
    return recordUpstreamRequest<T>({
      logRepo: this.upstreamLogRepo,
      config,
      operation: operationFromUri(uri),
      requestSummary: { method, path: uri, body: bodyObj ?? null },
      run: async () => {
        let raw: unknown;
        try {
          const res = await fetchWithTimeout(url, opts, config.timeoutMs);
          if (!res.ok) {
            throw new AppError(ErrorCode.UPSTREAM_ERROR, upstreamHttpErrorReason(res.status), 502, `HTTP ${res.status}`);
          }
          raw = await res.json();
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, String(err));
        }
        const value = this.parseEnvelope<T>(raw);
        return { value, responseSummary: responseSummary(raw) };
      },
    });
  }

  /**
   * Maps IPIPD order status integers into platform order status.
   */
  private mapOrderStatus(status: number): 'PENDING' | 'COMPLETED' | 'FAILED' {
    if (status === 3) return 'COMPLETED';
    if (status >= 4 && status <= 8) return 'FAILED';
    return 'PENDING';
  }

  /**
   * Maps IPIPD static proxy instances into platform delivery records.
   */
  private mapInstance(inst: StaticInstanceV2DTO, requestedProtocol: 'HTTP' | 'SOCKS5'): ProxyDelivery {
    const alpha2 = inst.countryCode ? IPIPD_ALPHA3_TO_ALPHA2[inst.countryCode] ?? inst.countryCode : '';
    const upstreamProtocol = ipipdInstanceProtocol(inst.protocol);
    if (upstreamProtocol && upstreamProtocol !== requestedProtocol) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'provider_delivery_protocol_mismatch', 502);
    }
    return {
      upstreamProxyId: String(inst.proxyId),
      ip: String(inst.ip),
      port: Number(inst.port),
      username: String(inst.username),
      password: String(inst.password),
      protocol: requestedProtocol,
      expiresAt: requireFutureDeliveryExpiry(inst.expiresAt),
      countryCode: alpha2,
    };
  }

  async healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);
    const start = Date.now();
    const uri = `${API_PREFIX}/account`;
    const url = ipipdUrl(config.baseUrl, uri);
    return recordUpstreamRequest<ProviderHealthResult>({
      logRepo: this.upstreamLogRepo,
      config,
      operation: 'healthCheck',
      requestSummary: { method: 'GET', path: uri },
      run: async () => {
        try {
          const headers = this.buildAuthHeaders('GET', uri, '', config);
          const res = await fetchWithTimeout(url, { method: 'GET', headers }, config.timeoutMs);
          const latencyMs = Date.now() - start;
          if (!res.ok) {
            return {
              value: { healthy: false, latencyMs, error: upstreamHttpErrorReason(res.status) },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: { httpStatus: res.status },
            };
          }
          const raw = (await res.json()) as EnvelopeV2<AccountV2DTO> | null;
          if (!raw || raw.success !== true || raw.code !== 'SUCCESS') {
            return {
              value: { healthy: false, latencyMs, error: raw?.message ?? 'upstream_error' },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: responseSummary(raw),
            };
          }
          return { value: { healthy: true, latencyMs }, responseSummary: responseSummary(raw) };
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, String(err));
        }
      },
    });
  }

  async syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);
    const pageSize = 200;
    const records: StaticLineV2DTO[] = [];
    let current = 0;
    for (;;) {
      const page = await this.request<PageResultV2<StaticLineV2DTO>>(
        'POST',
        `${API_PREFIX}/static/lines`,
        { current, size: pageSize },
        config,
      );
      const pageRecords = Array.isArray(page?.records) ? page.records : [];
      records.push(...pageRecords);
      if (pageRecords.length < pageSize) break;
      current += 1;
    }

    const items: InventoryItem[] = [];
    for (const line of records) {
      const alpha2 = normalizeIpipdCountryCode(line.countryCode);
      if (!alpha2) continue;
      const countryName = providerCountryName(this.code, alpha2) ?? alpha2;
      const available = line.active !== false && (line.status === undefined || line.status === 0);
      const regionCode = [line.cityCode, line.tag, line.businessTypeCode]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .join(' ');
      const baseItem = {
        countryCode: alpha2,
        countryName,
        regionCode: regionCode || undefined,
        ipType: 'NATIVE' as const,
        protocol: 'BOTH' as const,
        upstreamCost: line.price,
        upstreamCostCurrency: line.currency,
      };
      const cidrs = normalizeLineCidrs(line.cidrs);
      if (cidrs.length > 0) {
        for (const cidr of cidrs) {
          items.push({
            ...baseItem,
            networkCidr: cidr.cidr,
            stock: available ? cidr.availableCount : 0,
            providerResourceId: encodeIpipdLineCidr(String(line.id), cidr.cidr),
          });
        }
      } else {
        items.push({
          ...baseItem,
          stock: available ? Number(line.quantity ?? 0) : 0,
          providerResourceId: String(line.id),
        });
      }
    }

    return { providerCode: this.code, items, syncedAt: new Date() };
  }

  async buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);

    const req = this.buildBuyRequest(input);
    const order = await this.request<StaticOrderV2DTO>(req.method, req.path, req.body, config);

    const status = this.mapOrderStatus(order.status);
    const requestedProtocol = input.protocol === 'SOCKS5' ? 'SOCKS5' : 'HTTP';
    const proxies = Array.isArray(order.instances)
      ? order.instances.map((instance) => this.mapInstance(instance, requestedProtocol))
      : [];

    return {
      upstreamOrderId: String(order.orderNo),
      status,
      proxies,
      failReason: status === 'FAILED' ? `order_status_${order.status}` : undefined,
    };
  }

  // Builds the /static/orders/create request body. Pure: no network, no creds.
  // IPIPD supports two order paths:
  //  1) lineId direct purchase from syncInventory resource mapping.
  //  2) countryCode(alpha-3) + cityCode + businessType + ispType
  // lineId avoids country/city/business/isp combination ambiguity.
  buildBuyRequest(input: StaticProxyBuyInput): BuyRequestPreview {
    let body: Record<string, unknown>;
    if (input.providerResourceId) {
      const upstream = decodeIpipdLineCidr(input.providerResourceId);
      body = {
        lineId: upstream.lineId,
        ...(upstream.cidr ? { cidr: upstream.cidr } : {}),
        quantity: input.quantity,
        days: input.durationDays,
        orderNo: input.idempotencyKey,
        isTest: false,
        sync: true,
      };
    } else {
      if (!input.businessType) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'ipipd_business_type_required',
          400,
          'IPIPD country order requires businessType',
        );
      }
      const alpha3 = IPIPD_ALPHA2_TO_ALPHA3[input.countryCode] ?? input.countryCode;
      body = {
        countryCode: alpha3,
        cityCode: input.regionCode,
        businessType: input.businessType,
        ispType: 1,
        quantity: input.quantity,
        days: input.durationDays,
        orderNo: input.idempotencyKey,
        isTest: false,
        sync: true,
      };
    }
    return { method: 'POST', path: `${API_PREFIX}/static/orders/create`, body };
  }

  async queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);

    const page = await this.request<PageResultV2<StaticOrderV2DTO>>(
      'POST',
      `${API_PREFIX}/static/orders`,
      { orderNo: input.upstreamOrderId, current: 0, size: 10 },
      config,
    );

    const order = Array.isArray(page?.records) ? page.records[0] : undefined;
    if (!order) {
      throw new AppError(ErrorCode.NOT_FOUND, 'order_not_found', 404, input.upstreamOrderId);
    }

    const requestedProtocol = input.protocol ?? 'HTTP';
    const proxies = Array.isArray(order.instances)
      ? order.instances.map((instance) => this.mapInstance(instance, requestedProtocol))
      : [];

    return {
      upstreamOrderId: String(order.orderNo),
      status: this.mapOrderStatus(order.status),
      proxies,
    };
  }
}

function ipipdInstanceProtocol(value: unknown): 'HTTP' | 'SOCKS5' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'HTTP' || normalized === 'SOCKS5') return normalized;
  return null;
}

function operationFromUri(uri: string): string {
  if (uri.endsWith('/account')) return 'healthCheck';
  if (uri.endsWith('/static/lines')) return 'syncInventory';
  if (uri.endsWith('/static/orders/create')) return 'buyStaticProxy';
  if (uri.endsWith('/static/orders')) return 'queryOrder';
  return 'upstreamRequest';
}

export function ipipdUrl(baseUrl: string, signedUri: string): string {
  const parsed = new URL(baseUrl);
  const pathPrefix = parsed.pathname.replace(/\/+$/, '');
  const lowerPrefix = pathPrefix.toLowerCase();
  const signedSuffix = signedUri.startsWith(API_PREFIX) ? signedUri.slice(API_PREFIX.length) || '/' : signedUri;
  let requestPath: string;
  let hostname = parsed.hostname.toLowerCase();
  if (hostname === 'sandbox.ipipd.cn') {
    parsed.hostname = 'api.sandbox.ipipd.cn';
    hostname = parsed.hostname.toLowerCase();
  }

  if (isCanonicalIpipdHost(hostname) && lowerPrefix === '/api') {
    requestPath = signedUri;
  } else if (isCanonicalIpipdHost(hostname) && lowerPrefix.endsWith(`/api${API_PREFIX}`)) {
    const basePrefix = pathPrefix.slice(0, -(`/api${API_PREFIX}`).length).replace(/\/+$/, '');
    requestPath = `${basePrefix}${API_PREFIX}${signedSuffix}`;
  } else if (lowerPrefix.endsWith(API_PREFIX)) {
    requestPath = `${pathPrefix}${signedSuffix}`;
  } else {
    requestPath = `${pathPrefix}${signedUri}`;
  }

  parsed.pathname = requestPath;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function isCanonicalIpipdHost(hostname: string): boolean {
  return hostname === 'api.ipipd.cn' || hostname === 'api.sandbox.ipipd.cn';
}

function responseSummary(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return { type: typeof raw };
  const data = raw as Record<string, unknown>;
  const payload = data['data'];
  const summary: Record<string, unknown> = {
    success: data['success'],
    code: data['code'],
    message: data['message'],
    traceId: data['traceId'],
  };
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    if (Array.isArray(body['records'])) summary['recordsCount'] = body['records'].length;
    if (Array.isArray(body['instances'])) summary['instancesCount'] = body['instances'].length;
    if (body['orderNo']) summary['orderNo'] = body['orderNo'];
  }
  return summary;
}

function upstreamHttpErrorReason(status: number): string {
  if (status === 401 || status === 403) return 'upstream_auth_failed';
  return 'upstream_error';
}

const IPIPD_LINE_CIDR_SEPARATOR = '|cidr=';

function encodeIpipdLineCidr(lineId: string, cidr: string): string {
  return `${lineId}${IPIPD_LINE_CIDR_SEPARATOR}${encodeURIComponent(cidr)}`;
}

function decodeIpipdLineCidr(value: string): { lineId: string; cidr?: string } {
  const separatorIndex = value.indexOf(IPIPD_LINE_CIDR_SEPARATOR);
  if (separatorIndex < 0) return { lineId: value };
  const lineId = value.slice(0, separatorIndex);
  const encodedCidr = value.slice(separatorIndex + IPIPD_LINE_CIDR_SEPARATOR.length);
  if (!lineId || !encodedCidr) return { lineId: value };
  try {
    return { lineId, cidr: decodeURIComponent(encodedCidr) };
  } catch {
    return { lineId: value };
  }
}

function normalizeLineCidrs(value: StaticLineV2DTO['cidrs']): Array<{ cidr: string; availableCount: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const cidr = typeof item?.cidr === 'string' ? item.cidr.trim() : '';
      if (!cidr) return null;
      const availableCount = Number(item.availableCount ?? 0);
      return {
        cidr,
        availableCount: Number.isFinite(availableCount) && availableCount > 0 ? Math.floor(availableCount) : 0,
      };
    })
    .filter((item): item is { cidr: string; availableCount: number } => Boolean(item));
}

function normalizeIpipdCountryCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return undefined;
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  if (/^[A-Z]{3}$/.test(normalized)) return IPIPD_ALPHA3_TO_ALPHA2[normalized];
  return undefined;
}
