// Seed the initial dedicated-line SKU catalog for one site.
// Usage: pnpm --filter @ipeasy/api seed:line-skus -- --site <siteId>
import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import { parseArgs, requireString } from './_cli-args';
import { DEFAULT_LINE_SKUS } from '../src/modules/catalog/sku-seed';

export async function seedLineSkus(siteId: string): Promise<{ upserted: number; codes: string[] }> {
  for (const sku of DEFAULT_LINE_SKUS) {
    const capabilities = {
      ...sku.capabilities,
      supportedProtocols: [...sku.capabilities.supportedProtocols],
    };
    await prisma.service_skus.upsert({
      where: { siteId_code: { siteId, code: sku.code } },
      create: { siteId, ...sku, capabilities },
      update: {
        name: sku.name,
        description: sku.description,
        capabilities,
        contractVersion: sku.contractVersion,
        isActive: sku.isActive,
        isVisible: sku.isVisible,
        sortOrder: sku.sortOrder,
      },
    });
  }

  return { upserted: DEFAULT_LINE_SKUS.length, codes: DEFAULT_LINE_SKUS.map((sku) => sku.code) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const siteId = requireString(args, 'site');
  const result = await seedLineSkus(siteId);
  console.log(`Seeded dedicated-line SKUs: ${result.codes.join(', ')}`);
}

if (require.main === module) {
  main()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed dedicated-line SKUs failed:', err instanceof Error ? err.message : String(err));
      await prisma.$disconnect();
      process.exit(1);
    });
}
