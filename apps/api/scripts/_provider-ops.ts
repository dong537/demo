import { prisma } from '@ipeasy/db';
import type { Prisma } from '@ipeasy/db';
import { AppError } from '../src/common/errors/app-error';
import { normalizeProviderBaseUrl } from '../src/modules/providers/provider-base-url';
import type { ProviderRuntimeConfig } from '../src/modules/providers/provider.types';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../src/modules/providers/provider-account-order';
import {
  isNativeProviderCode,
  NATIVE_PROVIDER_CODES,
  type NativeProviderCode,
  type ProviderAccountStatus,
  throwCliUsageError,
} from '../src/modules/providers/provider-ops.validation';
import type { ParsedArgs } from './_cli-args';
import { getString } from './_cli-args';

export {
  assertCliUsage,
  assertProviderCredential,
  formatCliError,
  isCliUsageError,
  NATIVE_PROVIDER_CODES,
  parseCredentialJson,
  redactSecrets,
  throwCliUsageError,
  type NativeProviderCode,
  type ProviderAccountStatus,
} from '../src/modules/providers/provider-ops.validation';

export type ProviderAccountRef = {
  id: string;
  siteId: string;
  tenantId: string | null;
  providerCode: NativeProviderCode;
  status: ProviderAccountStatus;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
};

export function requireNativeProvider(args: ParsedArgs, key = 'provider'): NativeProviderCode {
  const value = requireArgString(args, key);
  if (isNativeProviderCode(value)) return value;
  throwCliUsageError(`Invalid --${key}: ${value}. Expected one of ${NATIVE_PROVIDER_CODES.join(', ')}.`);
}

export function optionalNativeProvider(args: ParsedArgs, key = 'provider'): NativeProviderCode | undefined {
  const value = getString(args, key);
  if (value === undefined || value === '') {
    if (args.flags.has(key)) throwCliUsageError(`Missing value for --${key}.`);
    return undefined;
  }
  if (isNativeProviderCode(value)) return value;
  throwCliUsageError(`Invalid --${key}: ${value}. Expected one of ${NATIVE_PROVIDER_CODES.join(', ')}.`);
}

export function requireSiteId(args: ParsedArgs): string {
  return requireArgString(args, 'site');
}

export function optionalTenantId(args: ParsedArgs): string | null {
  const tenantId = getString(args, 'tenant');
  if (tenantId === undefined || tenantId === '') {
    if (args.flags.has('tenant')) throwCliUsageError('Missing value for --tenant.');
    return null;
  }
  return tenantId;
}

export function optionalTenantFilter(args: ParsedArgs): string | null | undefined {
  if (!args.flags.has('tenant') && getString(args, 'tenant') === undefined) return undefined;
  return optionalTenantId(args);
}

export function requireStatus(args: ParsedArgs): ProviderAccountStatus {
  const value = getString(args, 'status') ?? 'ACTIVE';
  if (value === 'ACTIVE' || value === 'DISABLED') return value;
  throwCliUsageError(`Invalid --status: ${value}. Expected ACTIVE or DISABLED.`);
}

export function requireTimeoutMs(args: ParsedArgs): number {
  const timeoutMs = getNumberArg(args, 'timeout-ms', 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throwCliUsageError(`Invalid --timeout-ms: ${timeoutMs}. Expected an integer from 1000 to 120000.`);
  }
  return timeoutMs;
}

export function getNumberArg(args: ParsedArgs, key: string, fallback: number): number {
  const raw = getString(args, key);
  if (raw === undefined || raw === '') {
    if (args.flags.has(key)) throwCliUsageError(`Missing value for --${key}.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throwCliUsageError(`Invalid number for --${key}: ${raw}.`);
  }
  return value;
}

export function assertProviderBaseUrl(providerCode: NativeProviderCode, baseUrl: string): string {
  try {
    return normalizeProviderBaseUrl(providerCode, baseUrl);
  } catch (error) {
    if (error instanceof AppError) {
      throwCliUsageError(`Invalid --base-url: ${error.reasonKey}.`);
    }
    throw error;
  }
}

export function configLabel(config: Pick<ProviderRuntimeConfig, 'code' | 'siteId' | 'upstreamAccountId'> & { tenantId?: string | null }): string {
  const site = config.siteId ? `site=${config.siteId}` : 'site=(unknown)';
  const tenant = config.tenantId ? ` tenant=${config.tenantId}` : '';
  const account = config.upstreamAccountId ? ` account=${config.upstreamAccountId}` : '';
  return `${config.code} ${site}${tenant}${account}`;
}

export async function listProviderAccounts(input: {
  providerCode?: NativeProviderCode;
  siteId?: string;
  tenantId?: string | null;
}): Promise<ProviderAccountRef[]> {
  const rows = await prisma.provider_accounts.findMany({
    where: {
      tenantId: input.tenantId === undefined ? undefined : input.tenantId,
      providerCode: input.providerCode,
      siteId: input.siteId,
    },
    orderBy: [{ providerCode: 'asc' }, { siteId: 'asc' }, { tenantId: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
  });
  const latestByScope = new Map<string, ProviderAccountRef>();
  for (const row of rows) {
    const key = `${row.siteId}:${row.tenantId ?? ''}:${row.providerCode}`;
    if (latestByScope.has(key)) continue;
    latestByScope.set(key, {
      id: row.id,
      siteId: row.siteId,
      tenantId: row.tenantId,
      providerCode: row.providerCode as NativeProviderCode,
      status: row.status,
      baseUrl: row.baseUrl,
      timeoutMs: row.timeoutMs,
      inventorySyncEnabled: row.inventorySyncEnabled,
    });
  }
  return Array.from(latestByScope.values());
}

export async function writeCliAudit(data: {
  siteId: string;
  tenantId?: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await prisma.audit_logs.create({
    data: {
      siteId: data.siteId,
      tenantId: data.tenantId ?? null,
      actorType: 'SYSTEM',
      actorId: 'cli:provider-ops',
      targetType: data.targetType,
      targetId: data.targetId,
      action: data.action,
      requestId: data.requestId,
      meta: data.meta ? (data.meta as Prisma.InputJsonObject) : undefined,
    },
  });
}

function requireArgString(args: ParsedArgs, key: string): string {
  const value = getString(args, key);
  if (value === undefined || value === '') {
    throwCliUsageError(`Missing required argument: --${key}.`);
  }
  return value;
}
