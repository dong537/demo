// Apply the managed native-provider sale policy to existing resources.
//
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api resources:apply-sale-policy -- --site <siteId> --execute
//
// Without --execute this prints a dry-run summary.
import './_cli-bootstrap';
import { parseArgs, getString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import Decimal from 'decimal.js';
import {
  MANAGED_NATIVE_PROVIDER_CODES,
  MANAGED_RESOURCE_PRICE_30D,
  MANAGED_RESOURCE_PRICE_CURRENCY,
  getProviderResourceSaleability,
} from '../src/modules/resources/provider-saleability-policy';
import { providerCountryCodes } from '../src/modules/providers/provider-country-coverage';
import { NativeProviderCode } from '../src/modules/providers/provider-country-coverage';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../src/modules/providers/provider-account-order';

const PRICE_DURATIONS = [30, 60, 90] as const;
const DURATION_MULTIPLIER: Record<number, number> = {
  30: 1,
  60: 1.9,
  90: 2.7,
};

type ManagedResource = Prisma.platform_resourcesGetPayload<{
  include: {
    resource_mappings: {
      select: { providerResourceId: true };
      orderBy: { weight: 'desc' };
      take: 1;
    };
  };
}>;

type ApplySalePolicyResult = {
  siteId: string;
  dryRun: boolean;
  total: number;
  saleable: number;
  unsaleable: number;
  providerAccountUpdates: number;
  resourceUpdates: number;
  priceUpserts: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const siteId = await resolveSiteId(getString(args, 'site'));
  const execute = args.flags.has('execute');
  const result = await applyResourceSalePolicy(siteId, { execute });

  console.log(`[resource-sale-policy] site=${result.siteId}`);
  console.log(`[resource-sale-policy] mode=${result.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`[resource-sale-policy] managed_resources=${result.total}`);
  console.log(`[resource-sale-policy] saleable=${result.saleable}`);
  console.log(`[resource-sale-policy] unsaleable=${result.unsaleable}`);
  console.log(`[resource-sale-policy] provider_account_updates=${result.providerAccountUpdates}`);
  console.log(`[resource-sale-policy] resource_updates=${result.resourceUpdates}`);
  console.log(`[resource-sale-policy] price_upserts=${result.priceUpserts}`);
  if (result.dryRun) {
    console.log('[resource-sale-policy] add --execute to write these changes.');
  }
}

export async function applyResourceSalePolicy(
  siteId: string,
  options: { execute: boolean },
): Promise<ApplySalePolicyResult> {
  const resources = await prisma.platform_resources.findMany({
    where: { siteId, providerCode: { in: [...MANAGED_NATIVE_PROVIDER_CODES] } },
    include: {
      resource_mappings: {
        select: { providerResourceId: true },
        orderBy: { weight: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ providerCode: 'asc' }, { code: 'asc' }, { createdAt: 'asc' }],
  });

  let saleable = 0;
  let unsaleable = 0;
  const providerAccountUpdates = await applyProviderAccountCoverage(siteId, options);
  let resourceUpdates = 0;
  let priceUpserts = 0;

  for (const resource of resources) {
    const policy = getProviderResourceSaleability({
      providerCode: resource.providerCode,
      code: resource.code,
      name: resource.name,
      displayName: resource.displayName,
      providerResourceId: resource.resource_mappings[0]?.providerResourceId,
    });
    const next = {
      status: policy.saleable ? 'ACTIVE' as const : 'HIDDEN' as const,
      isVisible: policy.saleable,
      isSaleable: policy.saleable,
      unsaleableReason: policy.reason,
    };
    if (policy.saleable) saleable++;
    else unsaleable++;

    if (needsResourceUpdate(resource, next)) {
      resourceUpdates++;
      if (options.execute) {
        await prisma.platform_resources.update({
          where: { id: resource.id },
          data: next,
        });
      }
    }

    if (!policy.saleable) continue;
    for (const durationDays of PRICE_DURATIONS) {
      priceUpserts++;
      if (options.execute) {
        await prisma.price_overrides.upsert({
          where: {
            siteId_resourceId_durationDays: {
              siteId,
              resourceId: resource.id,
              durationDays,
            },
          },
          create: {
            siteId,
            resourceId: resource.id,
            durationDays,
            unitPrice: managedPrice(durationDays),
            currency: MANAGED_RESOURCE_PRICE_CURRENCY,
          },
          update: {
            unitPrice: managedPrice(durationDays),
            currency: MANAGED_RESOURCE_PRICE_CURRENCY,
          },
        });
      }
    }
  }

  return {
    siteId,
    dryRun: !options.execute,
    total: resources.length,
    saleable,
    unsaleable,
    providerAccountUpdates,
    resourceUpdates,
    priceUpserts,
  };
}

async function applyProviderAccountCoverage(siteId: string, options: { execute: boolean }): Promise<number> {
  const accounts = await prisma.provider_accounts.findMany({
    where: { siteId, providerCode: { in: [...MANAGED_NATIVE_PROVIDER_CODES] } },
    select: {
      id: true,
      providerCode: true,
      enabledCountryCodes: true,
    },
    orderBy: [{ providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
  });

  let updates = 0;
  for (const account of accounts) {
    const nextCodes = providerCountryCodes(account.providerCode as NativeProviderCode);
    if (sameCodes(account.enabledCountryCodes, nextCodes)) continue;
    updates++;
    if (options.execute) {
      await prisma.provider_accounts.update({
        where: { id: account.id },
        data: { enabledCountryCodes: nextCodes },
      });
    }
  }
  return updates;
}

function sameCodes(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function resolveSiteId(siteId: string | undefined): Promise<string> {
  if (siteId) return siteId;
  const sites = await prisma.sites.findMany({ select: { id: true, code: true }, orderBy: { createdAt: 'asc' } });
  if (sites.length !== 1) {
    throw new Error(`Pass --site <siteId>. Found sites: ${sites.map((site) => `${site.code}=${site.id}`).join(', ') || 'none'}`);
  }
  return sites[0].id;
}

function needsResourceUpdate(
  resource: ManagedResource,
  next: { status: 'ACTIVE' | 'HIDDEN'; isVisible: boolean; isSaleable: boolean; unsaleableReason: string | null },
): boolean {
  return resource.status !== next.status
    || resource.isVisible !== next.isVisible
    || resource.isSaleable !== next.isSaleable
    || resource.unsaleableReason !== next.unsaleableReason;
}

function managedPrice(durationDays: number): Decimal {
  const multiplier = DURATION_MULTIPLIER[durationDays] ?? durationDays / 30;
  return new Decimal(MANAGED_RESOURCE_PRICE_30D).mul(multiplier).toDecimalPlaces(2);
}

if (require.main === module) {
  main()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('resource-sale-policy failed:', err instanceof Error ? err.message : String(err));
      await prisma.$disconnect();
      process.exit(1);
    });
}
