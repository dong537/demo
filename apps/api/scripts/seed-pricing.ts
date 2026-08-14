// Seed a default price template + price_rules for every ACTIVE platform resource
// at 30/60/90-day durations. Pricing is unified by product duration (CNY).
//
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api seed:pricing -- --site <siteId>
//
// Idempotent: upserts template (by isDefault) and rules (by unique key).
import './_cli-bootstrap';
import { parseArgs, requireString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import { getBaseStaticProxyPrice } from '../src/modules/pricing/base-price';

const CURRENCY = 'CNY';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const siteId = requireString(args, 'site');
  await seedPricing(siteId);
}

export async function seedPricing(siteId: string): Promise<{ templateId: string; resources: number; ruleCount: number }> {
  // 1. Upsert default template.
  let template = await prisma.price_templates.findFirst({ where: { siteId, isDefault: true } });
  if (!template) {
    template = await prisma.price_templates.create({
      data: { siteId, name: 'Default', description: 'Auto-seeded default price template', isDefault: true },
    });
  }

  // 2. Load all ACTIVE resources for the site.
  const resources = await prisma.platform_resources.findMany({
    where: { siteId, status: 'ACTIVE' },
  });

  let ruleCount = 0;
  for (const resource of resources) {
    for (const days of [30, 60, 90]) {
      const price = getBaseStaticProxyPrice({
        code: resource.code,
        providerCode: resource.providerCode,
        durationDays: days,
        currency: CURRENCY,
      });

      if (!price) {
        throw new Error(`Unable to resolve canonical price for resource ${resource.id} (${resource.code})`);
      }

      await prisma.price_rules.upsert({
        where: {
          siteId_templateId_resourceId_durationDays: {
            siteId,
            templateId: template.id,
            resourceId: resource.id,
            durationDays: days,
          },
        },
        update: { unitPrice: new Decimal(price.unitPrice), currency: price.currency },
        create: {
          siteId,
          templateId: template.id,
          resourceId: resource.id,
          durationDays: days,
          unitPrice: new Decimal(price.unitPrice),
          currency: price.currency,
          minQty: 1,
        },
      });
      ruleCount++;
    }
  }

  console.log(`Seeded pricing:`);
  console.log(`  templateId = ${template.id} (Default)`);
  console.log(`  resources  = ${resources.length}`);
  console.log(`  price_rules = ${ruleCount} (${resources.length} x 3 durations)`);
  console.log(`  currency   = ${CURRENCY}`);
  return { templateId: template.id, resources: resources.length, ruleCount };
}

if (require.main === module) {
  main()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed pricing failed:', err instanceof Error ? err.message : String(err));
      await prisma.$disconnect();
      process.exit(1);
    });
}
