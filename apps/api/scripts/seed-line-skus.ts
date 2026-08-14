// Seed the initial dedicated-line SKU catalog for one site.
// Usage: pnpm --filter @ipeasy/api seed:line-skus -- --site <siteId> [--provider-code <providerCode> --provider-resource-ids <id,id>]
import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import {
  parseSeedLineSkuCliArgs,
  SkuInventorySourceValidationError,
} from '../src/modules/catalog/sku-inventory-source';
import { seedLineSkus } from '../src/modules/catalog/sku-inventory-source.service';

export { seedLineSkus } from '../src/modules/catalog/sku-inventory-source.service';

async function main(): Promise<void> {
  const input = parseSeedLineSkuCliArgs(process.argv.slice(2));
  const result = await seedLineSkus(input.siteId, input.inventorySource);
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
      process.exit(err instanceof SkuInventorySourceValidationError ? 2 : 1);
    });
}
