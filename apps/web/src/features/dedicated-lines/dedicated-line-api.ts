import { buildQuery, userApiRequest } from '../../shared/api/client';

export interface DedicatedLineSku {
  id: string;
  code: string;
  name: string;
  description: string | null;
  capabilities: Record<string, unknown>;
  contractVersion: number;
  isActive: boolean;
  isVisible: boolean;
}

export interface DedicatedLineQuote {
  skuId: string;
  skuCode: string;
  durationDays: number;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  currency: string;
  priceSource: string;
  contractVersion: number;
}

export interface DedicatedLineOrderResult {
  status: 'QUEUED';
  reservationId: string;
  jobId: string;
  skuCode: string;
  countryCode: string;
  quantity: number;
  replayed: boolean;
}

export interface DedicatedLineDelivery {
  id: string;
  status: string;
  countryCode: string;
  protocol: string;
  expiresAt: string | null;
  inboundTag: string;
  limits: {
    trafficLimitBytes: string;
    uplinkLimitBps: string;
    downlinkLimitBps: string;
    maxConnections: number;
    ipLimit: number;
  };
  projections: { ready: number; total: number };
  domains: Array<{ hostname: string; port: number; isPrimary: boolean }>;
  client: { email: string; id?: string; user?: string; password?: string } | null;
}

export interface DedicatedLineRenewalResult {
  lineId: string;
  status: string;
  expiresAt: string;
  desiredVersion: number;
  charged: { amount: string; currency: string };
  replayed: boolean;
}

export interface DedicatedLineLifecycleResult {
  lineId: string;
  status: string;
  expiresAt: string | null;
  desiredVersion: number;
  replayed: boolean;
}

export function listDedicatedLineSkus(): Promise<DedicatedLineSku[]> {
  return userApiRequest<DedicatedLineSku[]>('/api/catalog/skus');
}

export function quoteDedicatedLine(input: {
  skuCode: string;
  durationDays: number;
  quantity: number;
  currency: string;
}): Promise<DedicatedLineQuote> {
  return userApiRequest<DedicatedLineQuote>(`/api/catalog/quote${buildQuery(input)}`);
}

export function createDedicatedLineOrder(input: {
  skuCode: string;
  countryCode: string;
  quantity: number;
  durationDays: number;
  currency: string;
}): Promise<DedicatedLineOrderResult> {
  return userApiRequest<DedicatedLineOrderResult>('/api/dedicated-line-orders', {
    method: 'POST',
    body: JSON.stringify({ ...input, idempotencyKey: globalThis.crypto.randomUUID() }),
  });
}

export function listDedicatedLines(): Promise<DedicatedLineDelivery[]> {
  return userApiRequest<DedicatedLineDelivery[]>('/api/dedicated-lines');
}

export function renewDedicatedLine(input: { lineId: string; durationDays: number }): Promise<DedicatedLineRenewalResult> {
  return userApiRequest<DedicatedLineRenewalResult>(`/api/dedicated-lines/${encodeURIComponent(input.lineId)}/renew`, {
    method: 'POST',
    body: JSON.stringify({ durationDays: input.durationDays, idempotencyKey: globalThis.crypto.randomUUID() }),
  });
}

export function suspendDedicatedLine(lineId: string): Promise<DedicatedLineLifecycleResult> {
  return userApiRequest<DedicatedLineLifecycleResult>(`/api/dedicated-lines/${encodeURIComponent(lineId)}/suspend`, { method: 'POST' });
}

export function resumeDedicatedLine(lineId: string): Promise<DedicatedLineLifecycleResult> {
  return userApiRequest<DedicatedLineLifecycleResult>(`/api/dedicated-lines/${encodeURIComponent(lineId)}/resume`, { method: 'POST' });
}
