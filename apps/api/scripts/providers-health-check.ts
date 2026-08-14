import './_cli-bootstrap';
import { NestFactory } from '@nestjs/core';
import { prisma } from '@ipeasy/db';
import { AppModule } from '../src/app.module';
import { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';
import { parseArgs, getString } from './_cli-args';
import {
  configLabel,
  formatCliError,
  listProviderAccounts,
  optionalNativeProvider,
  optionalTenantFilter,
  writeCliAudit,
  NATIVE_PROVIDER_CODES,
  NativeProviderCode,
  ProviderAccountRef,
} from './_provider-ops';
import type { ProviderRuntimeConfig } from '../src/modules/providers/provider.types';

interface Row {
  providerCode: NativeProviderCode;
  accountId: string;
  siteId: string;
  tenantId: string | null;
  state: 'healthy' | 'unhealthy' | 'disabled' | 'error';
  latencyMs: number | '-';
  detail: string;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const filter = optionalNativeProvider(args);
  const siteId = getString(args, 'site');
  const tenantId = optionalTenantFilter(args);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const registry = app.get(ProviderRegistryService);

  const accounts = await resolveAccounts({ providerCode: filter, siteId, tenantId });
  const rows: Row[] = [];
  let anyFailure = false;

  for (const account of accounts) {
    try {
      const config = await resolveHealthCheckConfig(registry, account, tenantId);
      const base = rowBase(account, config);
      if (config.status === 'DISABLED') {
        rows.push({ ...base, state: 'disabled', latencyMs: '-', detail: account.status === 'DISABLED' ? 'account disabled' : 'no active credential' });
        continue;
      }
      const adapter = registry.getAdapter(account.providerCode);
      const result = await adapter.healthCheck(config);
      if (result.healthy) {
        rows.push({ ...base, state: 'healthy', latencyMs: result.latencyMs, detail: configLabel({ ...config, tenantId: base.tenantId }) });
      } else {
        anyFailure = true;
        rows.push({ ...base, state: 'unhealthy', latencyMs: result.latencyMs, detail: result.error ?? '' });
      }
    } catch (err: unknown) {
      anyFailure = true;
      rows.push({ ...rowBase(account), state: 'error', latencyMs: '-', detail: formatCliError(err) });
    }
  }

  if (rows.length === 0) {
    console.log('No provider account matched the filters.');
    await app.close();
    return 0;
  }

  console.log('PROVIDER          SITE                                  TENANT                                ACCOUNT                              STATE       LATENCY   DETAIL');
  for (const r of rows) {
    const latency = r.latencyMs === '-' ? '-' : `${r.latencyMs}ms`;
    console.log(`${r.providerCode.padEnd(17)} ${r.siteId.padEnd(37)} ${(r.tenantId ?? '-').padEnd(37)} ${r.accountId.padEnd(36)} ${r.state.padEnd(11)} ${String(latency).padEnd(9)} ${r.detail}`);
  }

  await writeHealthAudit(rows);
  await app.close();
  return anyFailure ? 1 : 0;
}

async function resolveAccounts(filters: {
  providerCode?: NativeProviderCode;
  siteId?: string;
  tenantId?: string | null;
}): Promise<ProviderAccountRef[]> {
  const accounts = await listProviderAccounts(filters);
  if (accounts.length > 0) return accounts;
  if (filters.providerCode && filters.siteId) {
    return [{
      id: '-',
      siteId: filters.siteId,
      tenantId: filters.tenantId ?? null,
      providerCode: filters.providerCode,
      status: 'DISABLED',
      baseUrl: '',
      timeoutMs: 15000,
      inventorySyncEnabled: false,
    }];
  }
  if (!filters.providerCode && filters.siteId) {
    return NATIVE_PROVIDER_CODES.map((providerCode) => ({
      id: '-',
      siteId: filters.siteId!,
      tenantId: filters.tenantId ?? null,
      providerCode,
      status: 'DISABLED',
      baseUrl: '',
      timeoutMs: 15000,
      inventorySyncEnabled: false,
    }));
  }
  return [];
}

async function resolveHealthCheckConfig(
  registry: ProviderRegistryService,
  account: ProviderAccountRef,
  tenantFilter: string | null | undefined,
): Promise<ProviderRuntimeConfig> {
  if (tenantFilter !== undefined || account.id === '-') {
    return registry.getConfig(account.providerCode, account.siteId, account.tenantId);
  }
  return registry.getConfigForProviderAccount(account.providerCode, account.siteId, account.id);
}

function rowBase(
  account: ProviderAccountRef,
  config?: Pick<ProviderRuntimeConfig, 'siteId' | 'upstreamAccountId'>,
): Pick<Row, 'providerCode' | 'accountId' | 'siteId' | 'tenantId'> {
  const accountId = config?.upstreamAccountId ?? account.id;
  const tenantId = accountId === account.id ? account.tenantId : null;
  return {
    providerCode: account.providerCode,
    accountId,
    siteId: config?.siteId ?? account.siteId,
    tenantId,
  };
}

async function writeHealthAudit(rows: Row[]): Promise<void> {
  const writableRows = rows.filter((row) => row.accountId !== '-');
  await Promise.all(writableRows.map((row) => writeCliAudit({
    siteId: row.siteId,
    tenantId: row.tenantId,
    action: 'provider.health_check',
    targetType: 'provider_account',
    targetId: row.accountId,
    requestId: `cli:providers:health-check:${row.accountId}`,
    meta: {
      providerCode: row.providerCode,
      state: row.state,
      latencyMs: row.latencyMs,
    },
  })));
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error('providers:health-check failed:', formatCliError(err));
    await prisma.$disconnect();
    process.exit(1);
  });
