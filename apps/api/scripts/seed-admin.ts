// Seed / upsert a platform admin user for the production (or any) site.
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api seed:admin -- --email admin --password '123456' [--site <siteId>] [--role PLATFORM_ADMIN]
//
// If --site is omitted, uses the first site found (single-site deployments).
// Idempotent: upserts admin_users by (email, siteId).
import './_cli-bootstrap';
import { parseArgs, requireString, getString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import * as bcrypt from 'bcryptjs';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = requireString(args, 'email');
  const password = requireString(args, 'password');
  const role = (getString(args, 'role') ?? 'PLATFORM_ADMIN') as 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'OPERATOR';
  let siteId = getString(args, 'site');

  if (!siteId) {
    const sites = await prisma.sites.findMany({ select: { id: true, name: true, code: true } });
    if (sites.length === 0) throw new Error('No site exists; create a site first (seed:site).');
    if (sites.length > 1) {
      console.error('Multiple sites found, pass --site <siteId>:');
      for (const s of sites) console.error(`  ${s.id}  code=${s.code}  name=${s.name}`);
      throw new Error('Ambiguous site.');
    }
    siteId = sites[0].id;
    console.log(`Using only site: ${siteId} (code=${sites[0].code})`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.admin_users.findFirst({ where: { email, siteId } });
  const admin = existing
    ? await prisma.admin_users.update({
        where: { id: existing.id },
        data: { passwordHash, role, status: 'ACTIVE' },
      })
    : await prisma.admin_users.create({
        data: { siteId, tenantId: null, email, passwordHash, role, status: 'ACTIVE' },
      });

  console.log('Seed admin complete:');
  console.log(`  adminId = ${admin.id}`);
  console.log(`  email   = ${admin.email}`);
  console.log(`  role    = ${admin.role}`);
  console.log(`  siteId  = ${admin.siteId}`);
  console.log(`  action  = ${existing ? 'updated existing' : 'created new'}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed admin failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
