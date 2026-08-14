import './_cli-bootstrap';
import { NestFactory } from '@nestjs/core';
import { prisma } from '@ipeasy/db';
import { AppModule } from '../src/app.module';
import { SyncInventoryUseCase } from '../src/modules/resources/use-cases/sync-inventory.use-case';
import { getString, parseArgs } from './_cli-args';
import {
  formatCliError,
  optionalTenantId,
  requireNativeProvider,
  requireSiteId,
  throwCliUsageError,
  writeCliAudit,
} from './_provider-ops';

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const provider = requireNativeProvider(args);
  const siteId = requireSiteId(args);
  const tenantId = optionalTenantId(args);
  const accountId = optionalAccountId(args);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const syncInventory = app.get(SyncInventoryUseCase, { strict: false });

  // Upstream failures throw AppError (UPSTREAM_ERROR / UPSTREAM_TIMEOUT); let
  // them propagate so we never write fake inventory.
  const result = await syncInventory.execute(siteId, provider, tenantId, accountId);
  const rows = await latestInventoryRows(siteId, provider, accountId);

  await writeCliAudit({
    siteId,
    tenantId,
    action: 'provider.inventory_sync',
    targetType: 'provider',
    targetId: provider,
    requestId: `cli:providers:sync-inventory:${provider}:${Date.now()}`,
    meta: {
      providerCode: provider,
      upstreamAccountId: accountId,
      attempted: result.attempted,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      synced: result.synced,
      countries: result.countries,
      syncedAt: result.syncedAt.toISOString(),
    },
  });

  console.log(`Synced ${result.synced} resource(s) for ${provider} (site ${siteId}${tenantId ? `, tenant ${tenantId}` : ''}${accountId ? `, account ${accountId}` : ''})`);
  console.log(`Summary attempted=${result.attempted} created=${result.created} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`);
  console.log(`Countries ${result.countries.join(', ')}`);
  console.log('COUNTRY  IP_TYPE     STOCK');
  for (const row of rows) {
    console.log(`${row.code.padEnd(8)} ${row.ipType.padEnd(11)} ${row.stock ?? '-'}`);
  }

  await app.close();
  return 0;
}

function optionalAccountId(args: ReturnType<typeof parseArgs>): string | null {
  const accountId = getString(args, 'account-id');
  if (accountId === undefined || accountId === '') {
    if (args.flags.has('account-id')) throwCliUsageError('Missing value for --account-id.');
    return null;
  }
  return accountId;
}

async function latestInventoryRows(siteId: string, providerCode: string, accountId: string | null): Promise<Array<{ code: string; ipType: string; stock: number | null }>> {
  const resources = await prisma.platform_resources.findMany({
    where: { siteId, providerCode, ...(accountId ? { upstreamAccountId: accountId } : {}) },
    orderBy: [{ code: 'asc' }, { ipType: 'asc' }],
    include: {
      inventory_snapshots: {
        orderBy: { capturedAt: 'desc' },
        take: 1,
      },
    },
  });
  return resources
    .map((resource) => ({
      code: resource.code,
      ipType: resource.ipType,
      stock: resource.inventory_snapshots[0]?.stock ?? null,
    }))
    .filter((row) => row.stock === null || row.stock >= 0);
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error('providers:sync-inventory failed:', formatCliError(err));
    await prisma.$disconnect();
    process.exit(1);
  });
