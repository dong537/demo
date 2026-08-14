// Seed a test customer user + wallet (with balance) for end-to-end purchase testing.
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api seed:customer -- --site <siteId> --tenant <tenantId> \
//     --email customer@example.com --password 'Pass123!' --balance 500
//
// Idempotent: upserts user by email, ensures a wallet with the given balance.
import './_cli-bootstrap';
import { parseArgs, requireString, getString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import * as bcrypt from 'bcryptjs';

const CURRENCY = 'CNY';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const siteId = requireString(args, 'site');
  const tenantId = requireString(args, 'tenant');
  const email = getString(args, 'email') ?? 'customer@example.com';
  const password = getString(args, 'password') ?? 'Customer123!';
  const balance = getString(args, 'balance') ?? '500';

  const passwordHash = await bcrypt.hash(password, 10);

  // Upsert user by unique email.
  const existing = await prisma.users.findUnique({ where: { email } });
  const user = existing
    ? await prisma.users.update({ where: { id: existing.id }, data: { passwordHash } })
    : await prisma.users.create({
        data: {
          siteId,
          tenantId,
          email,
          passwordHash,
          status: 'ACTIVE',
          kycStatus: 'NONE',
          riskStatus: 'NORMAL',
        },
      });

  // Ensure wallet exists with the requested balance.
  const wallet = await prisma.wallets.upsert({
    where: { userId: user.id },
    update: { available: new Decimal(balance), currency: CURRENCY },
    create: {
      siteId,
      tenantId,
      userId: user.id,
      available: new Decimal(balance),
      frozen: new Decimal(0),
      currency: CURRENCY,
    },
  });

  console.log('Seed customer complete:');
  console.log(`  userId   = ${user.id} (email=${email})`);
  console.log(`  walletId = ${wallet.id} (available=${wallet.available.toString()} ${CURRENCY})`);
  console.log('Password set (not printed). Use it to log in as the customer.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed customer failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
