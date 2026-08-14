// Seed platform_resources for three providers.
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api seed:resources [--site <siteId>]
// Idempotent: upserts by (siteId, providerCode, code, ipType).
import './_cli-bootstrap';
import { parseArgs, getString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import { PROVIDER_COUNTRY_COVERAGE, NativeProviderCode } from '../src/modules/providers/provider-country-coverage';
import { getProviderResourceSaleability } from '../src/modules/resources/provider-saleability-policy';

type Row = { providerCode: string; code: string; name: string; displayName: string };

const PROVIDERS: NativeProviderCode[] = ['PR', 'IPIPD', 'NINE_EIGHT_FIVE'];

const RESOURCES: Row[] = PROVIDERS.flatMap((providerCode) =>
  PROVIDER_COUNTRY_COVERAGE[providerCode].map((country) => ({
    providerCode,
    code: country.code,
    name: country.name,
    displayName: country.name,
  })),
);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let siteId = getString(args, 'site');
  if (!siteId) {
    const sites = await prisma.sites.findMany({ select: { id: true, code: true } });
    if (sites.length !== 1) throw new Error(`Pass --site <siteId>. Found: ${sites.map((s) => s.id).join(', ')}`);
    siteId = sites[0].id;
    console.log(`Using site: ${siteId}`);
  }

  let created = 0, updated = 0;
  for (const r of RESOURCES) {
    const saleability = getProviderResourceSaleability(r);
    const saleabilityData = {
      status: saleability.saleable ? 'ACTIVE' as const : 'HIDDEN' as const,
      isVisible: saleability.saleable,
      isSaleable: saleability.saleable,
      unsaleableReason: saleability.reason,
    };
    const existing = await prisma.platform_resources.findFirst({
      where: { siteId, providerCode: r.providerCode, code: r.code, ipType: 'NATIVE' },
    });
    if (existing) {
      await prisma.platform_resources.update({
        where: { id: existing.id },
        data: { name: r.name, displayName: r.displayName, ...saleabilityData },
      });
      updated++;
    } else {
      await prisma.platform_resources.create({
        data: {
          siteId, providerCode: r.providerCode, code: r.code,
          name: r.name, displayName: r.displayName,
          type: 'COUNTRY', ipType: 'NATIVE', protocol: 'BOTH',
          ...saleabilityData,
        },
      });
      created++;
    }
  }
  console.log(`Done: ${created} created, ${updated} updated (${RESOURCES.length} total).`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error('seed:resources failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
