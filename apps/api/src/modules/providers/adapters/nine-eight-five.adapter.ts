import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertSafeUrl } from '../../../common/utils/ssrf';
import { assertProviderActive, fetchWithTimeout, recordUpstreamRequest, upstreamUrl } from '../provider-http';
import {
  ProviderAdapter,
  ProviderCode,
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
import { requireFutureDeliveryExpiry } from '../provider-delivery-expiry';

interface Envelope<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

function parseEnvelope<T>(raw: unknown, operation: string): T {
  const envelope = raw as Partial<Envelope<T>> | null;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.code !== 'number') {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_invalid_response', 502);
  }
  if (envelope.code === 0) return envelope.data as T;

  const msg = envelope.msg ?? 'upstream_error';
  const normalized = msg.toLowerCase();
  if (normalized.includes('stock') || normalized.includes('out of stock')) {
    throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, msg, 422);
  }
  throw new AppError(ErrorCode.UPSTREAM_ERROR, `${operation}: ${msg}`, 502);
}

function staticZone(config?: ProviderRuntimeConfig): string | undefined {
  const value = config?.credential['zoneId']?.trim() || process.env['UPSTREAM_985PROXY_STATIC_ZONE']?.trim();
  return value ? value : undefined;
}

function staticInventoryBody(proxyType: string, config: ProviderRuntimeConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { static_proxy_type: proxyType };
  const zone = staticZone(config);
  if (zone) body['zone'] = zone;
  return body;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

@Injectable()
export class NineEightFiveAdapter implements ProviderAdapter {
  readonly code: ProviderCode = 'NINE_EIGHT_FIVE';

  constructor(private readonly upstreamLogRepo?: UpstreamLogRepository) {}

  private headers(config: ProviderRuntimeConfig): Record<string, string> {
    return {
      apikey: config.credential['apikey'] ?? '',
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    config: ProviderRuntimeConfig,
    operation: string,
  ): Promise<T> {
    assertSafeUrl(config.baseUrl);
    return recordUpstreamRequest<T>({
      logRepo: this.upstreamLogRepo,
      config,
      operation,
      requestSummary: { method: 'POST', path, body },
      run: async () => {
        let raw: unknown;
        try {
          const res = await fetchWithTimeout(
            nineEightFiveUrl(config.baseUrl, path),
            { method: 'POST', headers: this.headers(config), body: JSON.stringify(body) },
            config.timeoutMs,
          );
          if (!res.ok) {
            throw new AppError(ErrorCode.UPSTREAM_ERROR, `HTTP ${res.status}`, 502);
          }
          raw = await res.json();
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_request_failed', 502, String(err));
        }

        const value = parseEnvelope<T>(raw, path);
        return { value, responseSummary: responseSummary(raw) };
      },
    });
  }

  async healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);

    const start = Date.now();
    const path = '/res_static/inventory';
    const body = staticInventoryBody('premium', config);

    return recordUpstreamRequest<ProviderHealthResult>({
      logRepo: this.upstreamLogRepo,
      config,
      operation: 'healthCheck',
      requestSummary: { method: 'POST', path, body },
      run: async () => {
        try {
          const res = await fetchWithTimeout(
            nineEightFiveUrl(config.baseUrl, path),
            { method: 'POST', headers: this.headers(config), body: JSON.stringify(body) },
            config.timeoutMs,
          );
          const latencyMs = Date.now() - start;

          if (!res.ok) {
            return {
              value: { healthy: false, latencyMs, error: `HTTP ${res.status}` },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: { httpStatus: res.status },
            };
          }

          const raw = (await res.json()) as Envelope<unknown>;
          if (raw.code === 0) {
            return { value: { healthy: true, latencyMs }, responseSummary: responseSummary(raw) };
          }
          return {
            value: { healthy: false, latencyMs, error: raw.msg ?? 'api_error' },
            status: 'ERROR',
            errorCode: ErrorCode.UPSTREAM_ERROR,
            responseSummary: responseSummary(raw),
          };
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          const latencyMs = Date.now() - start;
          return {
            value: { healthy: false, latencyMs, error: String(err) },
            status: 'ERROR',
            errorCode: ErrorCode.UPSTREAM_ERROR,
          };
        }
      },
    });
  }

  async syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult> {
    assertProviderActive(config);

    type InventoryRecord = {
      type?: string;
      country_code?: string;
      country?: string;
      city?: string;
      city_name?: string;
      stock?: number;
      price?: number;
    };

    const seen = new Map<string, { stock: number; cost: number | null }>();
    for (const proxyType of ['shared', 'premium'] as const) {
      const data = await this.post<InventoryRecord[]>(
        '/res_static/inventory',
        staticInventoryBody(proxyType, config),
        config,
        'syncInventory',
      );
      const records = Array.isArray(data) ? data : [];

      for (const record of records) {
        const countryCode = normalizeCountryCode(record.country_code ?? record.country);
        if (!countryCode) continue;
        const key = `${countryCode}:${proxyType}`;
        const previous = seen.get(key) ?? { stock: 0, cost: null };
        seen.set(key, {
          stock: previous.stock + Number(record.stock ?? 0),
          cost: previous.cost ?? numberOrNull(record.price),
        });
      }
    }

    const items: InventoryItem[] = [];
    for (const [key, value] of seen) {
      const [countryCode] = key.split(':') as [string, string];
      items.push({
        countryCode,
        countryName: countryCode,
        stock: value.stock,
        ipType: 'NATIVE',
        protocol: 'BOTH',
        providerResourceId: key,
        upstreamCost: value.cost,
        upstreamCostCurrency: 'CNY',
      });
    }

    return { providerCode: this.code, items, syncedAt: new Date() };
  }

  async buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult> {
    assertProviderActive(config);

    const req = this.buildBuyRequest(input, config);
    type BuyResponse = {
      order_no?: string;
      order_id?: string;
      status?: string | number;
      proxy_list?: unknown[];
      proxies?: unknown[];
    };
    const data = await this.post<BuyResponse>(req.path, req.body, config, 'buyStaticProxy');

    const upstreamOrderId = String(data.order_no ?? data.order_id ?? '');
    if (!upstreamOrderId) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'no_order_id_in_response', 502);

    const country = (req.body.buy_data as Array<{ country: string }>)[0]?.country ?? input.countryCode;
    const rawProxies = data.proxy_list ?? data.proxies ?? [];
    const proxies = this.mapProxies(rawProxies, country, input.protocol === 'SOCKS5' ? 'SOCKS5' : 'HTTP');

    return {
      upstreamOrderId,
      status: proxies.length > 0 ? 'COMPLETED' : 'PENDING',
      proxies,
    };
  }

  buildBuyRequest(input: StaticProxyBuyInput, config?: ProviderRuntimeConfig): BuyRequestPreview {
    let country = input.countryCode;
    let proxyType = 'premium';
    const encodedResource = input.providerResourceId ?? input.businessType;
    if (encodedResource?.includes(':')) {
      [country, proxyType] = encodedResource.split(':', 2) as [string, string];
    } else if (encodedResource) {
      proxyType = encodedResource;
    }

    if (!country) throw new AppError(ErrorCode.VALIDATION_ERROR, 'nine_eight_five_requires_country', 400);

    const body: Record<string, unknown> = {
      static_proxy_type: proxyType,
      time_period: input.durationDays,
      pay_type: 'balance',
      buy_data: [{ country, city: input.regionCode ?? '', count: input.quantity }],
    };
    const zone = staticZone(config);
    if (zone) body['zone'] = zone;
    return { method: 'POST', path: '/res_static/buy', body };
  }

  async queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult> {
    assertProviderActive(config);

    type OrderResult = {
      order_no?: string;
      status?: string | number;
      proxy_list?: unknown[];
      proxies?: unknown[];
      zone?: string;
    };

    const data = await this.post<OrderResult>(
      '/res_static/order_result',
      { order_no: input.upstreamOrderId },
      config,
      'queryOrder',
    );

    const rawProxies = data.proxy_list ?? data.proxies ?? [];
    const zone = String(data.zone ?? input.countryCode ?? '');
    const proxies = this.mapProxies(rawProxies, zone, input.protocol ?? 'HTTP');

    const rawStatus = data.status;
    let status: 'PENDING' | 'COMPLETED' | 'FAILED' = 'PENDING';
    if (proxies.length > 0) status = 'COMPLETED';
    if (rawStatus === 'failed' || rawStatus === 4 || rawStatus === 5) status = 'FAILED';

    return { upstreamOrderId: input.upstreamOrderId, status, proxies };
  }

  private mapProxies(raw: unknown[], defaultCountry: string, protocol: 'HTTP' | 'SOCKS5' = 'HTTP'): ProxyDelivery[] {
    type ProxyDTO = {
      ip?: string;
      port?: number;
      port_http?: number;
      port_socks?: number;
      username?: string;
      login?: string;
      password?: string;
      expire_time?: string;
      expire?: string;
      country?: string;
      zone?: string;
      id?: string | number;
      proxy_id?: string | number;
      order_item_id?: string | number;
    };

    return (raw as ProxyDTO[]).map((proxy) => {
      const expiry = proxy.expire_time ?? proxy.expire;
      const expiresAt = requireFutureDeliveryExpiry(expiry, { timezoneLessUtc: true });
      return {
        upstreamProxyId: optionalString(proxy.proxy_id ?? proxy.id ?? proxy.order_item_id),
        ip: String(proxy.ip ?? ''),
        username: String(proxy.username ?? proxy.login ?? ''),
        password: String(proxy.password ?? ''),
        protocol,
        // The official static API returns a single `port` in its IP list. Some
        // account variants also expose protocol-specific ports; prefer the
        // SOCKS5 port when the dedicated-line job explicitly requested it.
        port: protocol === 'SOCKS5'
          ? Number(proxy.port_socks ?? proxy.port ?? proxy.port_http ?? 0)
          : Number(proxy.port_http ?? proxy.port ?? proxy.port_socks ?? 0),
        expiresAt,
        countryCode: String(proxy.zone ?? proxy.country ?? defaultCountry),
      };
    });
  }
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function responseSummary(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return { type: typeof raw };
  const envelope = raw as Record<string, unknown>;
  const data = envelope['data'];
  const summary: Record<string, unknown> = {
    code: envelope['code'],
    msg: envelope['msg'],
  };

  if (Array.isArray(data)) summary['itemsCount'] = data.length;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const body = data as Record<string, unknown>;
    if (body['order_no']) summary['orderNo'] = body['order_no'];
    if (body['order_id']) summary['orderId'] = body['order_id'];
    if (Array.isArray(body['proxy_list'])) summary['proxyListCount'] = body['proxy_list'].length;
    if (Array.isArray(body['proxies'])) summary['proxiesCount'] = body['proxies'].length;
  }

  return summary;
}

function nineEightFiveUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!normalizedPath.startsWith('/res_static/')) return upstreamUrl(baseUrl, normalizedPath);
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, '');
  if (basePath.toLowerCase().endsWith('/res_static')) {
    parsed.pathname = `${basePath.slice(0, -'/res_static'.length)}${normalizedPath}`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
  return upstreamUrl(baseUrl, normalizedPath);
}
