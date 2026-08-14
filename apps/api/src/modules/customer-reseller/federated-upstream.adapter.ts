import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertSafeUrl } from '../../common/utils/ssrf';
import { fetchWithTimeout } from '../providers/provider-http';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ProviderRuntimeConfig } from '../providers/provider.types';
import { ipipdUrl } from '../providers/adapters/ipipd.adapter';
import { FederatedCredential, FederatedScanResult, FederatedUpstreamKind } from './federated-upstream.domain';

type FederatedScanInput = {
  kind: FederatedUpstreamKind;
  baseUrl: string;
  credentials: FederatedCredential;
  timeoutMs: number;
  siteId: string;
};

@Injectable()
export class FederatedUpstreamAdapter {
  constructor(private readonly registry: ProviderRegistryService) {}

  async scan(input: FederatedScanInput): Promise<FederatedScanResult> {
    if (input.kind === 'PLATFORM_365') return this.scanPlatform(input);
    return this.scanProvider(input);
  }

  private async scanPlatform(input: FederatedScanInput): Promise<FederatedScanResult> {
    const headers = { apikey: input.credentials.apiKey ?? '', 'Content-Type': 'application/json' };
    const [wallet, inventory, skus] = await Promise.all([
      this.request('/api/openapi/dedicated/wallet', input, headers),
      this.request('/api/openapi/dedicated/inventory', input, headers),
      this.request('/api/openapi/dedicated/skus', input, headers),
    ]);
    const balance = asRecord(wallet);
    const skuRows = asArray(skus);
    const currency = text(balance.currency) ?? 'CNY';
    const prices: Array<Record<string, unknown>> = [];
    for (const sku of skuRows) {
      const code = text(sku.code);
      if (!code) continue;
      const quote = await this.request(
        `/api/openapi/dedicated/quote?skuCode=${encodeURIComponent(code)}&durationDays=30&quantity=1&currency=${encodeURIComponent(currency)}`,
        input,
        headers,
      );
      const quoteRecord = asRecord(quote);
      prices.push({ skuCode: code, durationDays: 30, unitPrice: quoteRecord.unitPrice, currency: quoteRecord.currency });
    }
    return this.result(
      numberString(balance.available),
      currency,
      asArray(inventory),
      prices,
    );
  }

  private async scanProvider(input: FederatedScanInput): Promise<FederatedScanResult> {
    const providerCode = input.kind === 'NINE_EIGHT_FIVE' ? 'NINE_EIGHT_FIVE' : 'IPIPD';
    const credentials: Record<string, string> = input.kind === 'NINE_EIGHT_FIVE'
      ? { apikey: input.credentials.apikey ?? input.credentials.apiKey ?? '', ...(input.credentials.zoneId ? { zoneId: input.credentials.zoneId } : {}) }
      : { appId: input.credentials.appId ?? '', appSecret: input.credentials.appSecret ?? '' };
    const config: ProviderRuntimeConfig = {
      code: providerCode,
      status: 'ACTIVE',
      siteId: input.siteId,
      baseUrl: input.baseUrl,
      timeoutMs: input.timeoutMs,
      inventorySyncEnabled: true,
      enabledCountryCodes: [],
      credential: credentials,
    };
    const inventory = await this.registry.getAdapter(providerCode).syncInventory(config);
    const prices = inventory.items
      .filter((item) => item.upstreamCost !== null && item.upstreamCost !== undefined)
      .map((item) => ({ countryCode: item.countryCode, regionCode: item.regionCode, unitPrice: item.upstreamCost, currency: item.upstreamCostCurrency }));
    if (input.kind === 'NINE_EIGHT_FIVE') {
      const traffic = await this.request('/res_rotating/traffic', input, { apikey: credentials['apikey'] ?? '' });
      const data = asRecord(asRecord(traffic).data ?? traffic);
      return this.result(numberString(data.remaining_traffic), 'BYTES', inventory.items.map(toInventoryRow), prices);
    }

    const account = await this.requestIpipdAccount(input);
    const accountData = asRecord(asRecord(account).data ?? account);
    return this.result(numberString(accountData.balance), text(accountData.currency), inventory.items.map(toInventoryRow), prices);
  }

  private async request(path: string, input: FederatedScanInput, headers: Record<string, string>): Promise<unknown> {
    assertSafeUrl(input.baseUrl);
    const url = `${input.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetchWithTimeout(url, { method: 'GET', headers }, input.timeoutMs);
    const raw = await res.json().catch(() => null);
    if (!res.ok) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'federated_upstream_http_error', 502, `HTTP ${res.status}`);
    return unwrapResponse(raw);
  }

  private async requestIpipdAccount(input: FederatedScanInput): Promise<unknown> {
    const uri = '/openapi/v2/account';
    const body = '';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const signature = createHmac('sha256', input.credentials.appSecret ?? '')
      .update(`GET${uri}${timestamp}${nonce}${body}`)
      .digest('hex');
    const res = await fetchWithTimeout(ipipdUrl(input.baseUrl, uri), {
      method: 'GET',
      headers: {
        'X-API-AppId': input.credentials.appId ?? '',
        'X-API-Timestamp': timestamp,
        'X-API-Nonce': nonce,
        'X-API-Signature': signature,
      },
    }, input.timeoutMs);
    const raw = await res.json().catch(() => null);
    if (!res.ok) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'federated_upstream_http_error', 502, `HTTP ${res.status}`);
    return unwrapResponse(raw);
  }

  private result(balanceAmount: string | null, balanceUnit: string | null, inventory: Array<Record<string, unknown>>, prices: Array<Record<string, unknown>>): FederatedScanResult {
    const capturedAt = new Date();
    return { balanceAmount, balanceUnit, inventory, prices, capturedAt, expiresAt: new Date(capturedAt.getTime() + 5 * 60_000) };
  }
}

function unwrapResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'federated_upstream_invalid_response', 502);
  const record = value as Record<string, unknown>;
  if ('success' in record && record.success !== true) throw new AppError(ErrorCode.UPSTREAM_ERROR, text(record.message) ?? 'federated_upstream_error', 502);
  if ('code' in record && record.code !== 0 && record.code !== '0' && record.code !== 'SUCCESS') {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, text(record.msg) ?? text(record.message) ?? 'federated_upstream_error', 502);
  }
  return 'data' in record ? record.data : record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}

function toInventoryRow(item: { countryCode: string; countryName: string; regionCode?: string; stock: number; protocol: string; ipType: string; upstreamCost?: string | number | null; upstreamCostCurrency?: string | null }): Record<string, unknown> {
  return {
    countryCode: item.countryCode,
    countryName: item.countryName,
    regionCode: item.regionCode,
    stock: item.stock,
    protocol: item.protocol,
    ipType: item.ipType,
  };
}

function numberString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return value.trim();
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
