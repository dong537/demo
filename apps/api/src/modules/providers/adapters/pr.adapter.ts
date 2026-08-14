import { Injectable } from '@nestjs/common';
import * as https from 'node:https';
import { inflateRawSync } from 'node:zlib';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertSafeUrl } from '../../../common/utils/ssrf';
import { assertProviderActive, fetchWithTimeout, recordUpstreamRequest } from '../provider-http';
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
import { IPIPD_ALPHA3_TO_ALPHA2 } from '../provider-country-coverage';

const DEFAULT_PAYMENT_ID = 1;
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const PROXY_SELLER_RESIDENT_HOST = 'res.proxy-seller.com';
const PROXY_SELLER_MIN_RESIDENT_PORT = 10000;
const PROXY_SELLER_ALPHA3_TO_ALPHA2: Record<string, string> = {
  ...IPIPD_ALPHA3_TO_ALPHA2,
  SGP: 'SG',
  THA: 'TH',
  POL: 'PL',
  BRA: 'BR',
  TUR: 'TR',
  ISR: 'IL',
  NLD: 'NL',
  IND: 'IN',
  CAN: 'CA',
  AUT: 'AT',
  ROU: 'RO',
  LVA: 'LV',
  UKR: 'UA',
};
const PROXY_SELLER_NAME_TO_ALPHA2: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  germany: 'DE',
  france: 'FR',
  italy: 'IT',
  spain: 'ES',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  vietnam: 'VN',
  'hong kong': 'HK',
  taiwan: 'TW',
  philippines: 'PH',
  malaysia: 'MY',
  australia: 'AU',
  indonesia: 'ID',
  'united arab emirates': 'AE',
  uae: 'AE',
  'south africa': 'ZA',
  singapore: 'SG',
  thailand: 'TH',
  poland: 'PL',
  brazil: 'BR',
  turkey: 'TR',
  israel: 'IL',
  netherlands: 'NL',
  holland: 'NL',
  india: 'IN',
  canada: 'CA',
  austria: 'AT',
  romania: 'RO',
  latvia: 'LV',
  ukraine: 'UA',
};

interface EnvelopeSuccess<T> {
  status: 'success';
  data: T;
}

interface EnvelopeError {
  errors: { message: string }[];
}

interface OrderMakeData {
  orderId: number | string;
  total?: number;
  balance?: number;
}

interface ResidentProxyDTO {
  id?: number | string;
  order_id?: number | string;
  basket_id?: number | string;
  ip?: string;
  ip_only?: string;
  protocol?: string;
  port_socks?: number;
  port_http?: number;
  login?: string;
  password?: string;
  auth_ip?: string;
  rotation?: string;
  country?: string;
  country_alpha3?: string;
  date_end?: string;
  auto_renew?: string;
  auto_renew_period?: string;
}

interface ResidentListDTO {
  id?: number | string;
  title?: string;
  login?: string;
  password?: string;
  whitelist?: string;
  rotation?: number | string;
  geo?: {
    country?: string;
    region?: string;
    city?: string;
    isp?: string;
  };
  export?: {
    ports?: number | string | Array<number | string>;
    ext?: string;
  };
}

interface ResidentTarifDTO {
  id?: number | string;
  name?: string;
  price?: number | string;
  cost?: number | string;
  amount?: number | string;
  currency?: string;
}

interface ResidentCalcDTO {
  price?: number | string;
  total?: number | string;
  quantity?: number | string;
  currency?: string;
  warning?: string;
  balance?: number | string;
  discount?: number | string;
}

interface UpstreamHttpResponse {
  ok: boolean;
  status: number;
  readBody(): Promise<Buffer>;
}

function proxySellerSocksUrl(): string | undefined {
  const value = process.env['UPSTREAM_PROXY_SELLER_SOCKS5_URL']?.trim();
  return value ? value : undefined;
}

@Injectable()
export class PrAdapter implements ProviderAdapter {
  readonly code: ProviderCode = 'PR';

  constructor(private readonly upstreamLogRepo?: UpstreamLogRepository) {}

  private buildUrl(config: ProviderRuntimeConfig, endpoint: string): string {
    const apiKey = config.credential['apikey'] ?? '';
    const base = config.baseUrl.replace(/\/$/, '');
    const path = endpoint.replace(/^\//, '');
    if (baseUrlAlreadyIncludesApiKey(config.baseUrl, apiKey)) {
      return `${base}/${path}`;
    }
    return `${base}/${apiKey}/${path}`;
  }

  private parseEnvelope<T>(raw: unknown): T {
    if (!raw || typeof raw !== 'object') {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_invalid_response', 502);
    }
    const envelope = raw as Partial<EnvelopeSuccess<T>> & Partial<EnvelopeError>;
    if (envelope.status === 'success') {
      return envelope.data as T;
    }
    if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, envelope.errors[0]?.message);
    }
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_invalid_response', 502);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    bodyObj: unknown,
    config: ProviderRuntimeConfig,
    operation: string,
    options: { allowRawArray?: boolean } = {},
  ): Promise<T> {
    assertSafeUrl(config.baseUrl);
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method === 'POST') {
      opts.body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    }

    return recordUpstreamRequest<T>({
      logRepo: this.upstreamLogRepo,
      config,
      operation,
      requestSummary: { method, path: endpoint, body: bodyObj ?? null },
      run: async () => {
        let raw: unknown;
        try {
          const res = await fetchProxySeller(this.buildUrl(config, endpoint), opts, config.timeoutMs);
          if (!res.ok) {
            throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, `HTTP ${res.status}`);
          }
          raw = parseProxySellerBody(await res.readBody());
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_error', 502, String(err));
        }
        const value = options.allowRawArray && Array.isArray(raw) ? raw as T : this.parseEnvelope<T>(raw);
        return { value, responseSummary: responseSummary(raw) };
      },
    });
  }

  private mapProxy(proxy: ResidentProxyDTO): ProxyDelivery {
    return {
      upstreamProxyId: proxy.id === undefined ? undefined : String(proxy.id),
      ip: String(proxy.ip_only ?? proxy.ip ?? ''),
      port: Number(proxy.port_http ?? proxy.port_socks ?? 0),
      username: String(proxy.login ?? ''),
      password: String(proxy.password ?? ''),
      protocol: 'HTTP',
      expiresAt: parseProxySellerExpiry(proxy.date_end),
      countryCode: typeof proxy.country === 'string' ? proxy.country : '',
    };
  }

  async healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    assertProviderActive(config);
    assertSafeUrl(config.baseUrl);

    const start = Date.now();
    const referenceEndpoint = 'reference/list/resident';
    return recordUpstreamRequest<ProviderHealthResult>({
      logRepo: this.upstreamLogRepo,
      config,
      operation: 'healthCheck',
      requestSummary: { method: 'GET', path: referenceEndpoint },
      run: async () => {
        try {
          const referenceRes = await fetchProxySeller(
            this.buildUrl(config, referenceEndpoint),
            { method: 'GET', headers: { 'Content-Type': 'application/json' } },
            config.timeoutMs,
          );
          const latencyMs = Date.now() - start;
          if (!referenceRes.ok) {
            return {
              value: { healthy: false, latencyMs, error: `HTTP ${referenceRes.status}` },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: { httpStatus: referenceRes.status, path: referenceEndpoint },
            };
          }
          const raw = parseProxySellerBody(await referenceRes.readBody());
          if (!raw || typeof raw !== 'object') {
            return {
              value: { healthy: false, latencyMs, error: 'upstream_invalid_response' },
              status: 'ERROR',
              errorCode: ErrorCode.UPSTREAM_ERROR,
              responseSummary: responseSummary(raw),
            };
          }
          try {
            const data = this.parseEnvelope<unknown>(raw);
            selectResidentTarifId(extractResidentTarifs(data));
          } catch (err: unknown) {
            return {
              value: { healthy: false, latencyMs, error: err instanceof AppError ? err.reasonKey : String(err) },
              status: 'ERROR',
              errorCode: err instanceof AppError ? err.code : ErrorCode.UPSTREAM_ERROR,
              responseSummary: responseSummary(raw),
            };
          }
          return { value: { healthy: true, latencyMs }, responseSummary: responseSummary(raw) };
        } catch (err: unknown) {
          if (err instanceof AppError && err.code === ErrorCode.UPSTREAM_TIMEOUT) {
            return {
              value: { healthy: false, latencyMs: Date.now() - start, error: 'upstream_timeout' },
              status: 'TIMEOUT',
              errorCode: ErrorCode.UPSTREAM_TIMEOUT,
            };
          }
          if (err instanceof AppError) {
            return {
              value: { healthy: false, latencyMs: Date.now() - start, error: err.reasonKey },
              status: 'ERROR',
              errorCode: err.code,
            };
          }
          return {
            value: { healthy: false, latencyMs: Date.now() - start, error: String(err) },
            status: 'ERROR',
            errorCode: ErrorCode.UPSTREAM_ERROR,
          };
        }
      },
    });
  }

  async syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult> {
    assertProviderActive(config);
    const [geo, reference] = await Promise.all([
      this.request<unknown>('GET', 'resident/geo', undefined, config, 'syncInventory.geo', { allowRawArray: true }),
      this.request<unknown>('GET', 'reference/list/resident', undefined, config, 'syncInventory.reference'),
    ]);
    const rawList = extractGeoRows(geo);
    const tarif = selectResidentTarif(extractResidentTarifs(reference));
    const tarifCost = await this.fetchResidentTarifCost(config, String(tarif.id));

    const items: InventoryItem[] = flattenProxySellerInventory(rawList).map((leaf) => ({
      countryCode: leaf.countryCode,
      countryName: leaf.countryName,
      regionCode: leaf.regionCode,
      stock: leaf.stock,
      ipType: 'NATIVE',
      protocol: 'BOTH',
      providerResourceId: encodeResidentResourceId(leaf.countryCode, String(tarif.id), leaf.path),
      upstreamCost: tarifCost.upstreamCost,
      upstreamCostCurrency: tarifCost.upstreamCostCurrency,
    }));

    return { providerCode: this.code, items, syncedAt: new Date() };
  }

  private async fetchResidentTarifCost(
    config: ProviderRuntimeConfig,
    tarifId: string,
  ): Promise<{ upstreamCost: number; upstreamCostCurrency: string }> {
    const calc = await this.request<ResidentCalcDTO>(
      'POST',
      'order/calc',
      buildResidentOrderBody(tarifId),
      config,
      'syncInventory.calc',
    );
    const upstreamCost = firstNumeric(calc.price, calc.total);
    if (upstreamCost === null) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_calc_invalid', 502);
    }
    const upstreamCostCurrency = calc.currency?.trim().toUpperCase();
    if (!upstreamCostCurrency) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_calc_invalid', 502);
    }
    return {
      upstreamCost,
      upstreamCostCurrency,
    };
  }

  async buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult> {
    assertProviderActive(config);

    const req = this.buildBuyRequest(input);
    const order = await this.request<OrderMakeData>(req.method, req.path, req.body, config, 'buyStaticProxy');
    const list = await this.request<ResidentListDTO>(
      'POST',
      'resident/list/add',
      buildResidentListAddBody(input, order.orderId),
      config,
      'buyStaticProxy.createResidentList',
    );
    const proxies = mapResidentListDelivery(list, input.quantity, input.countryCode);
    if (proxies.length === 0) {
      return {
        upstreamOrderId: String(order.orderId),
        status: 'PENDING',
        proxies: [],
        failReason: undefined,
      };
    }

    return {
      upstreamOrderId: String(order.orderId),
      status: 'COMPLETED',
      proxies,
      failReason: undefined,
    };
  }

  buildBuyRequest(input: StaticProxyBuyInput): BuyRequestPreview {
    const tarifId = parseResidentTarifId(input.providerResourceId ?? input.businessType);
    if (!tarifId) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'proxy_seller_requires_tarif_id',
        400,
        'Proxy-Seller resident requires tarifId through businessType',
      );
    }

    return { method: 'POST', path: 'order/make', body: buildResidentOrderBody(tarifId) };
  }

  async queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult> {
    assertProviderActive(config);

    const list = await this.request<{ items?: ResidentListDTO[] }>('GET', 'resident/lists', undefined, config, 'queryOrder');
    const all = Array.isArray(list.items) ? list.items : [];
    const matched = all.find((item) => typeof item.title === 'string' && item.title.includes(input.upstreamOrderId));
    const proxies = matched ? mapResidentListDelivery(matched, 1, matched.geo?.country ?? '') : [];

    return {
      upstreamOrderId: input.upstreamOrderId,
      status: proxies.length > 0 ? 'COMPLETED' : 'PENDING',
      proxies,
    };
  }
}

async function fetchProxySeller(url: string, opts: RequestInit, timeoutMs: number): Promise<UpstreamHttpResponse> {
  const socksUrl = proxySellerSocksUrl();
  if (!socksUrl) {
    const response = await fetchWithTimeout(url, opts, timeoutMs);
    return {
      ok: response.ok,
      status: response.status,
      async readBody() {
        return Buffer.from(await response.arrayBuffer());
      },
    };
  }
  return requestViaSocks(url, opts, timeoutMs, socksUrl);
}

function requestViaSocks(
  url: string,
  opts: RequestInit,
  timeoutMs: number,
  socksUrl: string,
): Promise<UpstreamHttpResponse> {
  return new Promise<UpstreamHttpResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    let agent: SocksProxyAgent;
    try {
      agent = new SocksProxyAgent(socksUrl);
    } catch (err: unknown) {
      finish(() => reject(new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_socks_url_invalid', 502, String(err))));
      return;
    }

    const req = https.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: opts.headers as Record<string, string> | undefined,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          finish(() => resolve({
            ok: status >= 200 && status < 300,
            status,
            async readBody() {
              return body;
            },
          }));
        });
        res.on('error', (err: Error) => finish(() => reject(err)));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      finish(() => reject(new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'upstream_timeout', 504)));
    });
    req.on('error', (err: Error) => finish(() => reject(err)));
    if (typeof opts.body === 'string' || Buffer.isBuffer(opts.body)) req.write(opts.body);
    req.end();
  });
}

function parseProxySellerBody(body: Buffer): unknown {
  if (body.length === 0) return null;
  if (isZip(body)) {
    return JSON.parse(extractFirstZipEntry(body).toString('utf8'));
  }
  return JSON.parse(body.toString('utf8'));
}

function isZip(body: Buffer): boolean {
  return body.length >= 4 && body.readUInt32LE(0) === 0x04034b50;
}

function extractFirstZipEntry(body: Buffer): Buffer {
  if (!isZip(body) || body.length < 30) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_zip_invalid', 502);
  }

  const method = body.readUInt16LE(8);
  const compressedSize = body.readUInt32LE(18);
  const fileNameLength = body.readUInt16LE(26);
  const extraLength = body.readUInt16LE(28);
  const dataStart = 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataStart > body.length || dataEnd > body.length) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_zip_invalid', 502);
  }

  const compressed = body.subarray(dataStart, dataEnd);
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_zip_unsupported', 502);
}

function parseProxySellerExpiry(value: string | undefined): Date {
  if (!value) return new Date(Date.now() + DEFAULT_EXPIRY_MS);
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (match) {
    return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(Date.now() + DEFAULT_EXPIRY_MS) : parsed;
}

function extractGeoRows(geo: unknown): Record<string, unknown>[] {
  if (Array.isArray(geo)) return geo as Record<string, unknown>[];
  if (!geo || typeof geo !== 'object') return [];

  const object = geo as Record<string, unknown>;
  if (Array.isArray(object['data'])) return object['data'] as Record<string, unknown>[];
  if (Array.isArray(object['items'])) return object['items'] as Record<string, unknown>[];
  if (Array.isArray(object['list'])) return object['list'] as Record<string, unknown>[];
  const data = object['data'];
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    if (Array.isArray(nested['items'])) return nested['items'] as Record<string, unknown>[];
    if (Array.isArray(nested['list'])) return nested['list'] as Record<string, unknown>[];
    if (Array.isArray(nested['countries'])) return nested['countries'] as Record<string, unknown>[];
    const mappedRows = rowsFromObjectMap(nested);
    if (mappedRows.length > 0) return mappedRows;
  }
  return rowsFromObjectMap(object);
}

interface ProxySellerInventoryLeaf {
  countryCode: string;
  countryName: string;
  path: string[];
  regionCode?: string;
  stock: number;
}

function flattenProxySellerInventory(rows: Record<string, unknown>[]): ProxySellerInventoryLeaf[] {
  const items: ProxySellerInventoryLeaf[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    collectProxySellerInventory(row, items, seen, { path: [] });
  }
  return items;
}

function collectProxySellerInventory(
  value: unknown,
  items: ProxySellerInventoryLeaf[],
  seen: Set<string>,
  context: { countryCode?: string; countryName?: string; path: string[] },
): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectProxySellerInventory(item, items, seen, context);
    return;
  }
  if (typeof value === 'string') {
    const label = value.trim();
    if (!label || !context.countryCode) return;
    const path = [...context.path, normalizeProxySellerPathSegment(label)];
    const key = `${context.countryCode}:${path.join('>')}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      countryCode: context.countryCode,
      countryName: context.countryName ?? context.countryCode,
      path,
      regionCode: path.length > 0 ? path.join(' - ') : undefined,
      stock: 1,
    });
    return;
  }
  if (typeof value !== 'object') return;

  const row = value as Record<string, unknown>;
  const countryCode = proxySellerCountryCode(row) ?? context.countryCode;
  if (!countryCode) return;
  const countryName = context.countryName
    ?? stringField(row, 'name')
    ?? stringField(row, 'country')
    ?? stringField(row, 'title')
    ?? countryCode;
  const label = proxySellerGeoLabel(row, countryCode, countryName, context.path.length);
  const nextPath = label ? [...context.path, normalizeProxySellerPathSegment(label)] : context.path;
  const hasChildren = hasProxySellerGeoChildren(row);
  if (hasChildren) {
    for (const key of ['regions', 'cities', 'isps'] as const) {
      const child = row[key];
      if (Array.isArray(child)) {
        for (const item of child) collectProxySellerInventory(item, items, seen, { countryCode, countryName, path: nextPath });
      } else if (child && typeof child === 'object') {
        collectProxySellerInventory(child, items, seen, { countryCode, countryName, path: nextPath });
      }
    }
    return;
  }

  const directStock = firstNumeric(row['stock'], row['available'], row['quantity'], row['count']);
  const stock = directStock !== null
    ? Math.max(0, Math.floor(directStock))
    : context.path.length > 0
      ? Math.max(1, stockFromGeoRow(row))
      : stockFromGeoRow(row);
  const key = `${countryCode}:${nextPath.join('>')}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push({
    countryCode,
    countryName,
    path: nextPath,
    regionCode: nextPath.length > 0 ? nextPath.join(' - ') : undefined,
    stock,
  });
}

function hasProxySellerGeoChildren(row: Record<string, unknown>): boolean {
  for (const key of ['regions', 'cities', 'isps'] as const) {
    const child = row[key];
    if (Array.isArray(child)) {
      if (child.length > 0) return true;
      continue;
    }
    if (child && typeof child === 'object' && Object.keys(child as Record<string, unknown>).length > 0) return true;
  }
  return false;
}

function proxySellerGeoLabel(
  row: Record<string, unknown>,
  countryCode: string,
  countryName: string,
  pathDepth: number,
): string | undefined {
  const label =
    stringField(row, 'name') ??
    stringField(row, 'city') ??
    stringField(row, 'isp') ??
    stringField(row, 'title') ??
    stringField(row, 'country') ??
    stringField(row, 'code');
  if (!label) return undefined;
  const normalized = label.trim();
  if (!normalized) return undefined;
  if (pathDepth === 0) {
    const upper = normalized.toUpperCase();
    if (upper === countryCode || normalized.toLowerCase() === countryName.trim().toLowerCase()) return undefined;
  }
  return normalized;
}

function normalizeProxySellerPathSegment(value: string): string {
  return value.replace(/:/g, '-').replace(/\s+/g, ' ').trim();
}

function proxySellerCountryCode(row: Record<string, unknown>): string | undefined {
  const raw =
    stringField(row, 'countryCode') ??
    stringField(row, 'country_code') ??
    stringField(row, 'countryIso') ??
    stringField(row, 'country_iso') ??
    stringField(row, 'iso2') ??
    stringField(row, 'alpha2') ??
    stringField(row, 'code') ??
    stringField(row, 'country_alpha2') ??
    stringField(row, 'countryAlpha2') ??
    stringField(row, 'iso') ??
    stringField(row, 'country_alpha3') ??
    stringField(row, 'countryAlpha3') ??
    stringField(row, 'alpha3') ??
    stringField(row, 'country');
  if (!raw) return undefined;

  const normalized = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  const alpha3 = PROXY_SELLER_ALPHA3_TO_ALPHA2[normalized];
  if (alpha3) return alpha3;
  return PROXY_SELLER_NAME_TO_ALPHA2[raw.trim().toLowerCase()];
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function rowsFromObjectMap(value: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    rows.push({ code: row['code'] ?? row['country'] ?? key, ...row });
  }
  return rows;
}

function stockFromGeoRow(row: Record<string, unknown>): number {
  const direct = firstNumeric(row['stock'], row['available'], row['quantity'], row['count']);
  if (direct !== null) return Math.max(0, Math.floor(direct));
  return countProxySellerAvailability(row);
}

function countProxySellerAvailability(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => {
      if (typeof item === 'string') return total + (item.trim() ? 1 : 0);
      if (typeof item === 'number' && Number.isFinite(item)) return total + (item > 0 ? 1 : 0);
      return total + countProxySellerAvailability(item);
    }, 0);
  }
  if (typeof value !== 'object') return 0;

  const row = value as Record<string, unknown>;
  const direct = firstNumeric(row['stock'], row['available'], row['quantity'], row['count']);
  if (direct !== null) return Math.max(0, Math.floor(direct));

  let total = 0;
  total += countProxySellerAvailability(row['regions']);
  total += countProxySellerAvailability(row['cities']);
  total += countProxySellerAvailability(row['isps']);
  return total;
}

function firstNumeric(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function extractResidentTarifs(reference: unknown): ResidentTarifDTO[] {
  if (!reference || typeof reference !== 'object') {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_tarifs_invalid', 502);
  }

  const root = reference as Record<string, unknown>;
  const data = root['data'];
  const items = data && typeof data === 'object' ? (data as Record<string, unknown>)['items'] : root['items'];
  const tarifs = items && typeof items === 'object' ? (items as Record<string, unknown>)['tarifs'] : root['tarifs'];
  if (Array.isArray(tarifs)) return tarifs as ResidentTarifDTO[];
  throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_tarifs_invalid', 502);
}

function selectResidentTarifId(tarifs: ResidentTarifDTO[]): string {
  return String(selectResidentTarif(tarifs).id);
}

function selectResidentTarif(tarifs: ResidentTarifDTO[]): ResidentTarifDTO {
  for (const tarif of tarifs) {
    if (tarif.id === undefined || tarif.id === null) continue;
    const id = String(tarif.id).trim();
    if (id) return { ...tarif, id };
  }
  throw new AppError(ErrorCode.UPSTREAM_ERROR, 'proxy_seller_tarifs_empty', 502);
}

function buildResidentOrderBody(tarifId: string): Record<string, unknown> {
  return {
    paymentId: DEFAULT_PAYMENT_ID,
    tarifId,
    coupon: '',
  };
}

function encodeResidentResourceId(countryCode: string, tarifId: string, path: string[] = []): string {
  const segments = [
    countryCode.trim().toUpperCase(),
    tarifId.trim(),
    ...path.map((segment) => normalizeProxySellerPathSegment(segment)).filter((segment) => Boolean(segment)),
  ].filter((segment) => Boolean(segment));
  return segments.join(':');
}

function parseResidentTarifId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const numeric = parts.slice(1).find((part) => /^\d+$/.test(part));
  if (numeric) return numeric;
  const separator = trimmed.indexOf(':');
  const tarifId = separator >= 0 ? trimmed.slice(separator + 1).trim() : trimmed;
  return tarifId || undefined;
}

function buildResidentListAddBody(input: StaticProxyBuyInput, upstreamOrderId: number | string): Record<string, unknown> {
  const geo: Record<string, string> = { country: input.countryCode };
  if (input.regionCode) geo['region'] = input.regionCode;
  return {
    title: `ipeasy-${upstreamOrderId}-${input.countryCode}`,
    whitelist: '',
    geo,
    export: {
      ports: input.quantity,
      ext: 'txt',
    },
    rotation: -1,
  };
}

function mapResidentListDelivery(list: ResidentListDTO, expectedQuantity: number, defaultCountryCode: string): ProxyDelivery[] {
  const login = typeof list.login === 'string' ? list.login : '';
  const password = typeof list.password === 'string' ? list.password : '';
  const ports = residentExportPorts(list.export?.ports);
  if (!login || !password || ports.length === 0) return [];

  const countryCode = list.geo?.country || defaultCountryCode;
  return ports.slice(0, expectedQuantity).map((port) => ({
    upstreamProxyId: list.id === undefined ? undefined : `${list.id}:${port}`,
    ip: PROXY_SELLER_RESIDENT_HOST,
    port,
    username: login,
    password,
    protocol: 'SOCKS5',
    expiresAt: new Date(Date.now() + DEFAULT_EXPIRY_MS),
    countryCode,
  }));
}

function residentExportPorts(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(numberFromPort).filter((port): port is number => port !== undefined);
  const port = numberFromPort(value);
  return port === undefined ? [] : [port];
}

function numberFromPort(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric < PROXY_SELLER_MIN_RESIDENT_PORT || numeric > 65535) return undefined;
  return numeric;
}

function baseUrlAlreadyIncludesApiKey(baseUrl: string, apiKey: string): boolean {
  if (!apiKey) return false;
  const parsed = new URL(baseUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  return segments.length >= 4
    && segments[0]?.toLowerCase() === 'personal'
    && segments[1]?.toLowerCase() === 'api'
    && segments[2]?.toLowerCase() === 'v1'
    && segments[3] === apiKey;
}

function responseSummary(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return { type: typeof raw };
  const envelope = raw as Record<string, unknown>;
  const data = envelope['data'];
  const errors = envelope['errors'];
  const summary: Record<string, unknown> = {
    status: envelope['status'],
  };

  if (Array.isArray(errors)) summary['errorsCount'] = errors.length;
  if (Array.isArray(data)) summary['itemsCount'] = data.length;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const body = data as Record<string, unknown>;
    if (body['orderId']) summary['orderId'] = body['orderId'];
    if (Array.isArray(body['items'])) summary['itemsCount'] = body['items'].length;
    if (Array.isArray(body['list'])) summary['listCount'] = body['list'].length;
  }

  return summary;
}
