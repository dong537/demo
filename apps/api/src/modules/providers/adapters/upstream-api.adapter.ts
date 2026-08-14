import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertSafeUrl } from '../../../common/utils/ssrf';
import { assertProviderActive, fetchWithTimeout, recordUpstreamRequest, upstreamUrl } from '../provider-http';
import { IPIPD_ALPHA3_TO_ALPHA2, PROVIDER_COUNTRY_COVERAGE } from '../provider-country-coverage';
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
  ProviderProxyLifecycleInput,
  ProviderProxyLifecycleResult,
} from '../provider.types';
import { UpstreamLogRepository } from '../upstream-log.repository';

interface ResStaticEnvelope<T = unknown> {
  code: number | string;
  msg?: string;
  data: T;
}

const COUNTRY_NAME_BY_CODE = new Map<string, string>(
  Object.values(PROVIDER_COUNTRY_COVERAGE).flatMap((countries) => countries.map((country) => [country.code, country.name] as const)),
);

const KNOWN_COUNTRY_CODES = new Set(COUNTRY_NAME_BY_CODE.keys());

const COUNTRY_NAME_TO_ALPHA2 = new Map<string, string>([
  ...Object.values(PROVIDER_COUNTRY_COVERAGE).flatMap((countries) => countries.map((country) => [normalizeCountryLookupKey(country.name), country.code] as const)),
  ['UNITED STATES', 'US'],
  ['USA', 'US'],
  ['AMERICA', 'US'],
  ['UNITED KINGDOM', 'GB'],
  ['UK', 'GB'],
  ['ENGLAND', 'GB'],
  ['HONG KONG', 'HK'],
  ['MACAU', 'MO'],
  ['SOUTH KOREA', 'KR'],
  ['KOREA', 'KR'],
  ['TAIWAN', 'TW'],
  ['SINGAPORE', 'SG'],
  ['JAPAN', 'JP'],
  ['CANADA', 'CA'],
  ['AUSTRALIA', 'AU'],
  ['GERMANY', 'DE'],
  ['FRANCE', 'FR'],
  ['NETHERLANDS', 'NL'],
  ['INDIA', 'IN'],
  ['THAILAND', 'TH'],
  ['POLAND', 'PL'],
  ['BRAZIL', 'BR'],
  ['TURKEY', 'TR'],
  ['ISRAEL', 'IL'],
  ['ROMANIA', 'RO'],
  ['LATVIA', 'LV'],
  ['UKRAINE', 'UA'],
]);

@Injectable()
export class UpstreamApiAdapter implements ProviderAdapter {
  readonly code: ProviderCode = 'UPSTREAM_API';

  constructor(private readonly upstreamLogRepo?: UpstreamLogRepository) {}

  private headers(config: ProviderRuntimeConfig): Record<string, string> {
    return {
      apikey: config.credential['apiKey'] ?? '',
      'Content-Type': 'application/json',
    };
  }

  private async postEnvelope<T>(
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
        let data: unknown;
        try {
          const res = await fetchWithTimeout(
            upstreamUrl(config.baseUrl, path),
            { method: 'POST', headers: this.headers(config), body: JSON.stringify(body) },
            config.timeoutMs,
          );
          data = await res.json();
          if (!res.ok && !isResStaticEnvelope(data)) {
            throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, `HTTP ${res.status}`);
          }
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, String(err));
        }
        return { value: parseResStaticEnvelope<T>(data, operation), responseSummary: responseSummary(data) };
      },
    });
  }

  async healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);

    const start = Date.now();
    const path = '/res_static/ip_list';
    const body = { status: 1, page: 1, page_size: 1 };
    return recordUpstreamRequest<ProviderHealthResult>({
      logRepo: this.upstreamLogRepo,
      config,
      operation: 'healthCheck',
      requestSummary: { method: 'POST', path, body },
      run: async () => {
        try {
          const res = await fetchWithTimeout(
            upstreamUrl(config.baseUrl, path),
            { method: 'POST', headers: this.headers(config), body: JSON.stringify(body) },
            config.timeoutMs,
          );
          const latencyMs = Date.now() - start;
          let raw: unknown;
          try {
            raw = await res.json();
          } catch {
            return {
              value: { healthy: false, latencyMs, error: 'unexpected_response' },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: { httpStatus: res.status },
            };
          }

          if (!res.ok) {
            try {
              parseResStaticEnvelope<unknown>(raw, 'healthCheck');
            } catch (err: unknown) {
              if (err instanceof AppError) {
                return {
                  value: { healthy: false, latencyMs, error: healthCheckReasonKey(err) },
                  status: 'ERROR',
                  errorCode: err.code,
                  responseSummary: responseSummary(raw),
                };
              }
            }
            return {
              value: { healthy: false, latencyMs, error: `HTTP ${res.status}` },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: responseSummary(raw),
            };
          }

          try {
            parseResStaticEnvelope<unknown>(raw, 'healthCheck');
            return { value: { healthy: true, latencyMs }, responseSummary: responseSummary(raw) };
          } catch (err: unknown) {
            if (err instanceof AppError) {
              return {
                value: { healthy: false, latencyMs, error: healthCheckReasonKey(err) },
                status: 'ERROR',
                errorCode: err.code,
                responseSummary: responseSummary(raw),
              };
            }
            throw err;
          }
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, String(err));
        }
      },
    });
  }

  async syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult> {
    assertProviderActive(config);
    const rawList = await this.postEnvelope<unknown>('/res_static/inventory', {}, config, 'syncInventory');
    const rows = extractInventoryRows(rawList);

    const items: InventoryItem[] = rows
      .map((row) => normalizeInventoryItem(row))
      .filter((item): item is InventoryItem => Boolean(item));

    return { providerCode: this.code, items, syncedAt: new Date() };
  }

  async buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult> {
    assertProviderActive(config);
    const req = this.buildBuyRequest(input);
    const body = await this.postEnvelope<Record<string, unknown>>(req.path, req.body, config, 'buyStaticProxy');
    if (!body['order_no']) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'unexpected_response', 502);

    const proxies = Array.isArray(body['proxy_list'])
      ? (body['proxy_list'] as Record<string, unknown>[]).map((proxy) => mapProxy(proxy, input.countryCode))
      : [];

    return {
      upstreamOrderId: String(body['order_no']),
      status: (body['status'] as 'PENDING' | 'COMPLETED' | 'FAILED') ?? 'PENDING',
      proxies,
      failReason: body['failReason'] as string | undefined,
    };
  }

  buildBuyRequest(input: StaticProxyBuyInput): BuyRequestPreview {
    const body: Record<string, unknown> = {
      resource_id: input.providerResourceId,
      quantity: input.quantity,
      duration_days: input.durationDays,
      currency: input.currency ?? 'CNY',
      idempotency_key: input.idempotencyKey,
    };
    if (!body.resource_id) {
      throw new AppError(ErrorCode.RESOURCE_MAPPING_MISSING, 'upstream_resource_mapping_missing', 422);
    }
    return { method: 'POST', path: '/res_static/buy', body };
  }

  async queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult> {
    assertProviderActive(config);
    const body = await this.postEnvelope<Record<string, unknown> | null>(
      '/res_static/order_result',
      { order_no: input.upstreamOrderId },
      config,
      'queryOrder',
    );
    if (!body) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'unexpected_response', 502);

    const proxies = Array.isArray(body['proxy_list'])
      ? (body['proxy_list'] as Record<string, unknown>[]).map((proxy) => mapProxy(proxy, String(proxy['country_code'] ?? '')))
      : [];

    return {
      upstreamOrderId: input.upstreamOrderId,
      status: (body['status'] as 'PENDING' | 'COMPLETED' | 'FAILED') ?? 'PENDING',
      proxies,
    };
  }

  async renewStaticProxy(input: ProviderProxyLifecycleInput, config: ProviderRuntimeConfig): Promise<ProviderProxyLifecycleResult> {
    assertProviderActive(config);
    const body = await this.postEnvelope<Record<string, unknown> | null>(
      '/res_static/renew',
      {
        proxy_id: input.upstreamProxyId,
        duration_days: input.durationDays,
        idempotency_key: input.idempotencyKey,
      },
      config,
      'renewStaticProxy',
    );
    return mapLifecycleResult(body);
  }

  async changeProxyPassword(input: ProviderProxyLifecycleInput, config: ProviderRuntimeConfig): Promise<ProviderProxyLifecycleResult> {
    assertProviderActive(config);
    const body = await this.postEnvelope<Record<string, unknown> | null>(
      '/res_static/change_auth',
      { proxy_id: input.upstreamProxyId },
      config,
      'changeProxyPassword',
    );
    return mapLifecycleResult(body);
  }

  async switchProxyIp(input: ProviderProxyLifecycleInput, config: ProviderRuntimeConfig): Promise<ProviderProxyLifecycleResult> {
    assertProviderActive(config);
    const body = await this.postEnvelope<Record<string, unknown>>(
      '/res_static/switch_ip',
      { proxy_id: input.upstreamProxyId },
      config,
      'switchProxyIp',
    );
    return mapLifecycleResult(body);
  }
}

function parseResStaticEnvelope<T>(value: unknown, operation: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'unexpected_response', 502);
  }
  const envelope = value as Partial<ResStaticEnvelope<T>>;
  if (envelope.code === 0 || envelope.code === '0') {
    return envelope.data as T;
  }
  const msg = envelope.msg ?? `${operation}_failed`;
  if (envelope.code === ErrorCode.UPSTREAM_OUT_OF_STOCK) {
    throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, msg, 422);
  }
  if (envelope.code === ErrorCode.PRICE_MISSING) {
    throw new AppError(ErrorCode.PRICE_MISSING, msg, 422);
  }
  if (envelope.code === ErrorCode.CURRENCY_NOT_SUPPORTED) {
    throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, msg, 422);
  }
  if (envelope.code === ErrorCode.UPSTREAM_DISABLED) {
    throw new AppError(ErrorCode.UPSTREAM_DISABLED, msg, 503);
  }
  if (envelope.code === ErrorCode.UNSUPPORTED_CAPABILITY) {
    throw new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, msg, 501);
  }
  throw new AppError(ErrorCode.UPSTREAM_ERROR, msg, 502);
}

function isResStaticEnvelope(value: unknown): value is ResStaticEnvelope {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'code' in value;
}

function mapProxy(proxy: Record<string, unknown>, defaultCountryCode: string): ProxyDelivery {
  return {
    upstreamProxyId: optionalString(proxy['proxy_id'] ?? proxy['id']),
    ip: String(proxy['ip']),
    port: Number(proxy['port']),
    username: String(proxy['username']),
    password: String(proxy['password']),
    protocol: (proxy['protocol'] as 'HTTP' | 'SOCKS5') ?? 'HTTP',
    expiresAt: new Date(String(proxy['expire_time'])),
    countryCode: String(proxy['country_code'] ?? defaultCountryCode),
  };
}

function mapLifecycleResult(body: Record<string, unknown> | null): ProviderProxyLifecycleResult {
  const proxy = body ? firstProxyPayload(body) : null;
  return proxy ? { proxy: mapProxy(proxy, String(proxy['country_code'] ?? '')) } : {};
}

function firstProxyPayload(body: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(body['proxy'])) return body['proxy'];
  if (isRecord(body['proxy_info'])) return body['proxy_info'];
  if (isRecord(body['ip'])) return body;
  const list = body['proxy_list'];
  if (Array.isArray(list) && isRecord(list[0])) return list[0];
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function normalizeIpType(value: unknown): 'NATIVE' | 'BROADCAST' {
  const normalized = firstText(value)?.toUpperCase();
  return normalized === 'BROADCAST' ? 'BROADCAST' : 'NATIVE';
}

function normalizeProtocol(value: unknown): 'HTTP' | 'SOCKS5' | 'BOTH' {
  const normalized = firstText(value)?.toUpperCase();
  if (normalized === 'SOCKS5' || normalized === 'BOTH') return normalized;
  return 'HTTP';
}

function extractUpstreamCost(row: Record<string, unknown>): Pick<InventoryItem, 'upstreamCost' | 'upstreamCostCurrency'> {
  const cost = firstNumeric(row['price'], row['cost'], row['amount'], row['unit_price'], row['upstream_cost']);
  if (cost === null) {
    return { upstreamCost: null, upstreamCostCurrency: null };
  }
  const currency = firstString(row['currency'], row['cost_currency'], row['price_currency'], row['amount_currency'], row['upstream_cost_currency']);
  return {
    upstreamCost: cost,
    upstreamCostCurrency: currency ?? null,
  };
}

function firstNumeric(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim().toUpperCase();
  }
  return null;
}

function responseSummary(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return { type: typeof raw };
  const body = raw as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (Array.isArray(body['data'])) summary['dataCount'] = body['data'].length;
  if (Array.isArray(body['items'])) summary['itemsCount'] = body['items'].length;
  if (Array.isArray(body['list'])) summary['listCount'] = body['list'].length;
  if (Array.isArray(body['records'])) summary['recordsCount'] = body['records'].length;
  const data = body['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const payload = data as Record<string, unknown>;
    if (Array.isArray(payload['proxy_list'])) summary['proxiesCount'] = payload['proxy_list'].length;
    if (Array.isArray(payload['items'])) summary['itemsCount'] = payload['items'].length;
    if (Array.isArray(payload['list'])) summary['listCount'] = payload['list'].length;
    if (Array.isArray(payload['records'])) summary['recordsCount'] = payload['records'].length;
    if (payload['order_no']) summary['orderNo'] = payload['order_no'];
    if (payload['status']) summary['status'] = payload['status'];
  }
  return summary;
}

const HEALTH_CHECK_REASON_KEYS = new Set([
  'unexpected_response',
  'inventory_empty',
  'price_missing',
  'currency_not_supported',
  'provider_disabled',
  'unsupported_capability',
  'upstream_error',
  'upstream_timeout',
  'network_error',
]);

function healthCheckReasonKey(error: AppError): string {
  if (HEALTH_CHECK_REASON_KEYS.has(error.reasonKey)) return error.reasonKey;
  if (error.code === ErrorCode.UPSTREAM_OUT_OF_STOCK) return 'inventory_empty';
  if (error.code === ErrorCode.PRICE_MISSING) return 'price_missing';
  if (error.code === ErrorCode.CURRENCY_NOT_SUPPORTED) return 'currency_not_supported';
  if (error.code === ErrorCode.UPSTREAM_DISABLED) return 'provider_disabled';
  if (error.code === ErrorCode.UNSUPPORTED_CAPABILITY) return 'unsupported_capability';
  if (error.code === ErrorCode.UPSTREAM_TIMEOUT) return 'upstream_timeout';
  return 'upstream_error';
}

function normalizeInventoryItem(row: Record<string, unknown>): InventoryItem | null {
  const countryCode = resolveCountryCode(row);
  if (!countryCode) return null;

  const providerResourceId = resolveProviderResourceId(row, countryCode);
  if (!providerResourceId) return null;
  const countryName = resolveCountryName(row, countryCode);

  return {
    countryCode,
    countryName,
    regionCode: resolveRegionCode(row, countryName, countryCode),
    stock: resolveStock(row),
    ipType: normalizeIpType(firstText(row['ip_type'], row['ipType'], row['proxy_type'], row['type'])),
    protocol: normalizeProtocol(firstText(row['protocol'], row['protocol_type'], row['protocolType'])),
    providerResourceId,
    ...extractUpstreamCost(row),
  };
}

function extractInventoryRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of ['data', 'items', 'list', 'records'] as const) {
    const nestedRows = extractInventoryRows(value[key]);
    if (nestedRows.length > 0) return nestedRows;
  }

  if (isEnvelopeLike(value)) return [];
  return rowsFromObjectMap(value);
}

function resolveCountryCode(row: Record<string, unknown>): string | null {
  for (const raw of [
    row['country_code'],
    row['countryCode'],
    row['country_iso'],
    row['countryIso'],
    row['alpha2'],
    row['country'],
  ]) {
    const countryCode = parseCountryCodeLike(raw, false);
    if (countryCode) return countryCode;
  }

  const countryName = firstText(row['country_name'], row['countryName'], row['name'], row['area_name']);
  if (countryName) {
    const countryCode = COUNTRY_NAME_TO_ALPHA2.get(normalizeCountryLookupKey(countryName));
    if (countryCode) return countryCode;
  }

  for (const raw of [row['area_code'], row['areaCode'], row['code']]) {
    const countryCode = parseCountryCodeLike(raw, true);
    if (countryCode) return countryCode;
  }

  return null;
}

function resolveCountryName(row: Record<string, unknown>, countryCode: string): string {
  const country = COUNTRY_NAME_BY_CODE.get(countryCode);
  if (country) return country;
  return firstText(row['country_name'], row['countryName'], row['name'], row['area_name'], row['country']) ?? countryCode;
}

function resolveProviderResourceId(row: Record<string, unknown>, countryCode: string): string | null {
  return firstIdentifier(
    row['resource_id'],
    row['resourceId'],
    row['line_id'],
    row['lineId'],
    row['proxy_id'],
    row['proxyId'],
    row['id'],
    row['area_code'],
    row['areaCode'],
    row['code'],
  ) ?? countryCode;
}

function resolveRegionCode(row: Record<string, unknown>, countryName: string, countryCode: string): string | undefined {
  const region = firstText(
    row['region_code'],
    row['regionCode'],
    row['region_name'],
    row['regionName'],
    row['city_code'],
    row['cityCode'],
    row['city_name'],
    row['cityName'],
    row['district_code'],
    row['districtCode'],
    row['district_name'],
    row['districtName'],
    row['area_name'],
  );
  if (!region) return undefined;
  if (region.toUpperCase() === countryCode.toUpperCase()) return undefined;
  if (normalizeCountryLookupKey(region) === normalizeCountryLookupKey(countryName)) return undefined;
  return region;
}

function resolveStock(row: Record<string, unknown>): number {
  const stock = firstNumeric(row['stock'], row['available'], row['quantity'], row['count'], row['quantity_available']);
  return stock === null ? 0 : Math.max(0, Math.floor(stock));
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function firstIdentifier(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parseCountryCodeLike(value: unknown, allowCompound: boolean): string | null {
  const raw = firstText(value);
  if (!raw) return null;

  const normalized = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized) && KNOWN_COUNTRY_CODES.has(normalized)) return normalized;
  if (/^[A-Z]{3}$/.test(normalized)) return IPIPD_ALPHA3_TO_ALPHA2[normalized] ?? null;

  const byName = COUNTRY_NAME_TO_ALPHA2.get(normalizeCountryLookupKey(raw));
  if (byName) return byName;
  if (!allowCompound) return null;

  const head = raw.split(/[:/|_\-\s]+/).map((part) => part.trim()).find(Boolean);
  if (!head) return null;

  const headNormalized = head.toUpperCase();
  if (/^[A-Z]{2}$/.test(headNormalized) && KNOWN_COUNTRY_CODES.has(headNormalized)) return headNormalized;
  if (/^[A-Z]{3}$/.test(headNormalized)) return IPIPD_ALPHA3_TO_ALPHA2[headNormalized] ?? null;
  return null;
}

function rowsFromObjectMap(value: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    rows.push({ code: key, ...(item as Record<string, unknown>) });
  }
  return rows;
}

function isEnvelopeLike(value: Record<string, unknown>): boolean {
  return ['code', 'msg', 'message', 'success', 'timestamp', 'traceId'].some((key) => key in value);
}

function normalizeCountryLookupKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s._-]+/g, ' ');
}
