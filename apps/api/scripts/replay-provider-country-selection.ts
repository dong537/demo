// Replay the current site-global native provider country selection onto
// existing platform resources without changing provider accounts or prices.
//
// Usage:
//   pnpm --filter @ipeasy/api resources:replay-provider-country-selection -- --site <siteId> [--provider IPIPD] [--execute]
import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import { getString, parseArgs } from './_cli-args';
import {
  formatCliError,
  isCliUsageError,
  NATIVE_PROVIDER_CODES,
  optionalNativeProvider,
  throwCliUsageError,
  type NativeProviderCode,
} from './_provider-ops';
import { ProvidersRepository } from '../src/modules/providers/providers.repository';

type ProviderAccountSelection = {
  id: string;
  providerCode: NativeProviderCode;
  enabledCountryCodes: string[];
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('tenant') || getString(args, 'tenant') !== undefined) {
    throwCliUsageError('This script replays site-global provider accounts only; --tenant is not supported.');
  }

  const siteId = await resolveSiteId(getString(args, 'site'));
  const provider = optionalNativeProvider(args);
  const execute = args.flags.has('execute');
  const accounts = await latestActiveSiteGlobalAccounts(siteId, provider);
  const repo = new ProvidersRepository();

  console.log(`[provider-country-selection] site=${siteId}`);
  console.log(`[provider-country-selection] mode=${execute ? 'execute' : 'dry-run'}`);
  if (provider) console.log(`[provider-country-selection] provider=${provider}`);

  if (accounts.length === 0) {
    console.log('[provider-country-selection] no active site-global native provider accounts found.');
    return 0;
  }

  let totalResources = 0;
  let totalSaleable = 0;
  let totalHidden = 0;
  let totalChanged = 0;

  for (const account of accounts) {
    const plan = await repo.planEnabledCountrySelectionToResources(
      siteId,
      account.providerCode,
      account.enabledCountryCodes,
    );
    totalResources += plan.total;
    totalSaleable += plan.saleable;
    totalHidden += plan.hidden;
    totalChanged += plan.changed;

    console.log(`[provider-country-selection] ${account.providerCode} account=${account.id}`);
    console.log(`  enabledCountryCodes=${account.enabledCountryCodes.join(',') || '(none)'}`);
    console.log(`  resources=${plan.total} saleable=${plan.saleable} hidden=${plan.hidden} changed=${plan.changed}`);
    console.log(`  hiddenByCountry=${plan.hiddenByCountry} hiddenByPolicy=${plan.hiddenByPolicy}`);

    if (execute) {
      const result = await repo.applyEnabledCountrySelectionToResources(
        siteId,
        account.providerCode,
        account.enabledCountryCodes,
      );
      console.log(`  applied updated=${result.updated} saleable=${result.saleable} hidden=${result.hidden}`);
      await writeAudit(siteId, account, plan);
    }
  }

  console.log(`[provider-country-selection] totalResources=${totalResources}`);
  console.log(`[provider-country-selection] totalSaleable=${totalSaleable}`);
  console.log(`[provider-country-selection] totalHidden=${totalHidden}`);
  console.log(`[provider-country-selection] totalChanged=${totalChanged}`);
  if (!execute) console.log('[provider-country-selection] add --execute to write these resource status changes.');
  return 0;
}

async function latestActiveSiteGlobalAccounts(
  siteId: string,
  providerCode?: NativeProviderCode,
): Promise<ProviderAccountSelection[]> {
  const rows = await prisma.provider_accounts.findMany({
    where: {
      siteId,
      tenantId: null,
      status: 'ACTIVE',
      providerCode: providerCode ?? { in: [...NATIVE_PROVIDER_CODES] },
    },
    select: {
      id: true,
      providerCode: true,
      enabledCountryCodes: true,
    },
    orderBy: [
      { providerCode: 'asc' },
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const latest = new Map<NativeProviderCode, ProviderAccountSelection>();
  for (const row of rows) {
    const code = row.providerCode as NativeProviderCode;
    if (latest.has(code)) continue;
    latest.set(code, {
      id: row.id,
      providerCode: code,
      enabledCountryCodes: row.enabledCountryCodes,
    });
  }
  return [...latest.values()];
}

async function resolveSiteId(siteId: string | undefined): Promise<string> {
  if (siteId) return siteId;
  const sites = await prisma.sites.findMany({ select: { id: true, code: true }, orderBy: { createdAt: 'asc' } });
  if (sites.length !== 1) {
    throwCliUsageError(`Pass --site <siteId>. Found sites: ${sites.map((site) => `${site.code}=${site.id}`).join(', ') || 'none'}`);
  }
  return sites[0].id;
}

async function writeAudit(
  siteId: string,
  account: ProviderAccountSelection,
  plan: { total: number; saleable: number; hidden: number; changed: number; hiddenByCountry: number; hiddenByPolicy: number },
): Promise<void> {
  await prisma.audit_logs.create({
    data: {
      siteId,
      tenantId: null,
      actorType: 'SYSTEM',
      actorId: 'cli:provider-country-selection',
      targetType: 'provider_account',
      targetId: account.id,
      action: 'provider_account.replay_country_selection',
      requestId: `cli:provider-country-selection:${account.providerCode}:${Date.now()}`,
      meta: {
        providerCode: account.providerCode,
        enabledCountryCodes: account.enabledCountryCodes,
        resources: plan.total,
        saleable: plan.saleable,
        hidden: plan.hidden,
        changed: plan.changed,
        hiddenByCountry: plan.hiddenByCountry,
        hiddenByPolicy: plan.hiddenByPolicy,
      },
    },
  });
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error('resources:replay-provider-country-selection failed:', formatCliError(err));
    await prisma.$disconnect();
    process.exit(isCliUsageError(err) ? 2 : 1);
  });
