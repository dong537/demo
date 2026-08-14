import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertSafeUrl } from '../../common/utils/ssrf';

export const FEDERATED_UPSTREAM_KINDS = ['PLATFORM_365', 'NINE_EIGHT_FIVE', 'IPIPD'] as const;
export type FederatedUpstreamKind = (typeof FEDERATED_UPSTREAM_KINDS)[number];

export type FederatedCredential = {
  apiKey?: string;
  apikey?: string;
  zoneId?: string;
  appId?: string;
  appSecret?: string;
};

export type FederatedScanResult = {
  balanceAmount: string | null;
  balanceUnit: string | null;
  inventory: Array<Record<string, unknown>>;
  prices: Array<Record<string, unknown>>;
  capturedAt: Date;
  expiresAt: Date;
};

export function assertFederatedKind(value: unknown): FederatedUpstreamKind {
  if (typeof value !== 'string' || !FEDERATED_UPSTREAM_KINDS.includes(value as FederatedUpstreamKind)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_kind_invalid', 400);
  }
  return value as FederatedUpstreamKind;
}

export function normalizeFederatedBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'base_url_required', 400);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'base_url_invalid', 400);
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/g, '');
  const normalized = url.toString().replace(/\/$/g, '');
  assertSafeUrl(normalized);
  return normalized;
}

export function normalizeFederatedCredentials(kind: FederatedUpstreamKind, value: unknown): FederatedCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_credentials_required', 400);
  }
  const input = value as Record<string, unknown>;
  if (kind === 'IPIPD') {
    const appId = text(input.appId);
    const appSecret = text(input.appSecret);
    if (!appId || !appSecret) throw new AppError(ErrorCode.VALIDATION_ERROR, 'ipipd_credentials_required', 400);
    return { appId, appSecret };
  }

  const apiKey = text(input.apiKey) ?? text(input.apikey);
  if (!apiKey) throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_api_key_required', 400);
  const zoneId = text(input.zoneId);
  return { apiKey, ...(kind === 'NINE_EIGHT_FIVE' ? { apikey: apiKey, ...(zoneId ? { zoneId } : {}) } : {}) };
}

export function credentialFingerprint(credentials: FederatedCredential): string {
  return createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
}

export function normalizeTimeoutMs(value: unknown): number {
  if (value === undefined) return 15000;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_timeout_invalid', 400);
  }
  return timeoutMs;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
