// Set the explicit provider inventory resources used by a dedicated-line SKU.
// Usage: pnpm --filter @ipeasy/api sku:set-inventory-source -- --site <siteId> --code SV --provider-code NINE_EIGHT_FIVE --provider-resource-ids HK:premium
import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import {
  parseSetLineSkuInventorySourceCliArgs,
  SkuInventorySourceValidationError,
} from '../src/modules/catalog/sku-inventory-source';
import { setLineSkuInventorySource } from '../src/modules/catalog/sku-inventory-source.service';

export { setLineSkuInventorySource } from '../src/modules/catalog/sku-inventory-source.service';

async function main(): Promise<void> {
  const input = parseSetLineSkuInventorySourceCliArgs(process.argv.slice(2));
  const result = await setLineSkuInventorySource(input);
  const action = result.updated ? 'Configured' : 'Already configured';
  console.log(`${action} dedicated-line SKU ${input.code} inventory source for ${input.providerCode}.`);
}

if (require.main === module) {
  main()
    .then(async () => { await prisma.$disconnect(); process.exit(0); })
    .catch(async (error: unknown) => {
      console.error('Set line SKU inventory source failed:', error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exit(error instanceof SkuInventorySourceValidationError ? 2 : 1);
    });
}
