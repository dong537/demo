// Seed a minimal main site + default tenant + platform admin for local/ops use.
// Usage:
//   DATABASE_URL=... APP_ENCRYPTION_KEY=... \
//   pnpm --filter @ipeasy/api seed:site -- \
//     --site-code MAIN --site-name "IPEasy 主站" --domain ipipx.365proxy.net \
//     --admin-email admin@example.com --admin-password 'StrongPass123'
//
// Idempotent: re-running upserts by unique keys and prints the resulting IDs.
import './_cli-bootstrap';
import { parseArgs, getString } from './_cli-args';
import { prisma } from '@ipeasy/db';
import * as bcrypt from 'bcryptjs';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const siteCode = getString(args, 'site-code') ?? 'MAIN';
  const siteName = getString(args, 'site-name') ?? 'IPEasy Main';
  const domain = getString(args, 'domain') ?? 'localhost';
  const tenantCode = getString(args, 'tenant-code') ?? 'DEFAULT';
  const adminEmail = getString(args, 'admin-email') ?? 'admin@example.com';
  const adminPassword = getString(args, 'admin-password') ?? 'ChangeMe123!';

  // Upsert site by unique code.
  const existingSite = await prisma.sites.findUnique({ where: { code: siteCode } });
  const site = existingSite
    ? existingSite
    : await prisma.sites.create({
        data: {
          code: siteCode,
          name: siteName,
          domain,
          status: 'ACTIVE',
          brandConfig: { name: 'IPEasy', primaryColor: '#0040ff' },
        },
      });

  // Upsert default tenant by [siteId, code].
  const existingTenant = await prisma.tenants.findFirst({ where: { siteId: site.id, code: tenantCode } });
  const tenant = existingTenant
    ? existingTenant
    : await prisma.tenants.create({
        data: { siteId: site.id, code: tenantCode, name: 'Default Tenant', status: 'ACTIVE' },
      });

  // Upsert platform admin by unique email.
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const existingAdmin = await prisma.admin_users.findUnique({ where: { email: adminEmail } });
  const admin = existingAdmin
    ? await prisma.admin_users.update({ where: { id: existingAdmin.id }, data: { passwordHash } })
    : await prisma.admin_users.create({
        data: {
          siteId: site.id,
          tenantId: null,
          email: adminEmail,
          passwordHash,
          role: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
        },
      });

  console.log('Seed complete:');
  console.log(`  siteId   = ${site.id}  (code=${site.code}, domain=${site.domain})`);
  console.log(`  tenantId = ${tenant.id}  (code=${tenant.code})`);
  console.log(`  adminId  = ${admin.id}  (email=${admin.email}, role=PLATFORM_ADMIN)`);
  console.log('Admin password set (not printed). Use it to log in for ops.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
