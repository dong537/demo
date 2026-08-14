import { prisma, Prisma } from '@ipeasy/db';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY, CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY } from './provider-account-order';

const NATIVE_PROVIDER_CODES = ['IPIPD', 'NINE_EIGHT_FIVE', 'PR'] as const;
const UPSTREAM_API_PROVIDER_CODE = 'UPSTREAM_API';

type CurrentResourceAccountFilterOptions = {
  tenantId?: string | null;
  providerCode?: string | null;
};

type CurrentAccountEntry = {
  providerCode: string;
  accountId: string;
};

export async function buildCurrentResourceAccountWhere(
  siteId: string,
  options: CurrentResourceAccountFilterOptions = {},
): Promise<Prisma.platform_resourcesWhereInput> {
  const entries = [
    ...(await resolveCurrentNativeProviderAccounts(siteId, options)),
    ...(await resolveCurrentUpstreamApiAccounts(siteId, options)),
  ];

  if (entries.length === 0) return { id: { in: [] } };
  return {
    OR: entries.map((entry) => ({
      providerCode: entry.providerCode,
      upstreamAccountId: entry.accountId,
    })),
  };
}

export async function resolveCurrentResourceAccountIdsForProvider(
  siteId: string,
  providerCode: string,
): Promise<string[]> {
  if ((NATIVE_PROVIDER_CODES as readonly string[]).includes(providerCode)) {
    const rows = await prisma.provider_accounts.findMany({
      where: { siteId, providerCode },
      select: {
        id: true,
        tenantId: true,
        status: true,
      },
      orderBy: [{ tenantId: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
    });
    return activeCurrentIdsByScope(rows);
  }

  if (providerCode === UPSTREAM_API_PROVIDER_CODE) {
    const rows = await prisma.upstream_api_accounts.findMany({
      where: { siteId },
      select: {
        id: true,
        tenantId: true,
        status: true,
      },
      orderBy: [{ tenantId: 'asc' }, ...CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY],
    });
    return activeCurrentIdsByScope(rows);
  }

  return [];
}

async function resolveCurrentNativeProviderAccounts(
  siteId: string,
  options: CurrentResourceAccountFilterOptions,
): Promise<CurrentAccountEntry[]> {
  const providerCodes = NATIVE_PROVIDER_CODES.filter((code) => !options.providerCode || options.providerCode === code);
  if (providerCodes.length === 0) return [];

  const rows = await prisma.provider_accounts.findMany({
    where: {
      siteId,
      providerCode: { in: providerCodes },
      OR: tenantScopeWhere(options.tenantId),
    },
    select: {
      id: true,
      tenantId: true,
      providerCode: true,
      status: true,
    },
    orderBy: [{ providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
  });

  const entries: CurrentAccountEntry[] = [];
  for (const providerCode of providerCodes) {
    const scopedRows = rows.filter((row) => row.providerCode === providerCode);
    const tenantRow = options.tenantId
      ? scopedRows.find((row) => row.tenantId === options.tenantId)
      : null;
    const siteRow = scopedRows.find((row) => row.tenantId === null);
    const current = tenantRow?.status === 'ACTIVE' ? tenantRow : siteRow;
    if (current?.status === 'ACTIVE') {
      entries.push({ providerCode, accountId: current.id });
    }
  }
  return entries;
}

async function resolveCurrentUpstreamApiAccounts(
  siteId: string,
  options: CurrentResourceAccountFilterOptions,
): Promise<CurrentAccountEntry[]> {
  if (options.providerCode && options.providerCode !== UPSTREAM_API_PROVIDER_CODE) return [];

  const rows = await prisma.upstream_api_accounts.findMany({
    where: {
      siteId,
      OR: tenantScopeWhere(options.tenantId),
    },
    select: {
      id: true,
      tenantId: true,
      status: true,
    },
    orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
  });

  const tenantRow = options.tenantId
    ? rows.find((row) => row.tenantId === options.tenantId)
    : null;
  const siteRow = rows.find((row) => row.tenantId === null);
  const current = tenantRow?.status === 'ACTIVE' ? tenantRow : siteRow;
  return current?.status === 'ACTIVE'
    ? [{ providerCode: UPSTREAM_API_PROVIDER_CODE, accountId: current.id }]
    : [];
}

function tenantScopeWhere(tenantId: string | null | undefined): Array<{ tenantId: string | null }> {
  return tenantId ? [{ tenantId }, { tenantId: null }] : [{ tenantId: null }];
}

function activeCurrentIdsByScope(rows: Array<{ id: string; tenantId: string | null; status: string }>): string[] {
  const latestByScope = new Map<string, { id: string; status: string }>();
  for (const row of rows) {
    const key = row.tenantId ?? '';
    if (!latestByScope.has(key)) latestByScope.set(key, row);
  }
  return [...latestByScope.values()]
    .filter((row) => row.status === 'ACTIVE')
    .map((row) => row.id);
}
