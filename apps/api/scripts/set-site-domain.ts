import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../src/common/auth/auth-context';
import { UpdateSiteDomainUseCase } from '../src/modules/sites/update-site-domain.use-case';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const siteCode = requireEnv('SITE_CODE');
  const domain = requireEnv('SITE_PUBLIC_DOMAIN');
  const actorId = requireEnv('SITE_DOMAIN_ACTOR_ID');

  const site = await prisma.sites.findUnique({
    where: { code: siteCode },
    select: { id: true, code: true },
  });
  if (!site) throw new Error(`Site not found for SITE_CODE=${siteCode}`);

  const ctx: AuthenticatedContext = {
    ownerId: actorId,
    ownerType: 'SYSTEM',
    siteId: site.id,
    tenantId: null,
    scopes: [],
    requestId: `cli:site-domain:${site.id}`,
  };
  const updated = await new UpdateSiteDomainUseCase().execute(ctx, { domain });

  console.log(`Updated site domain (${site.code}): ${updated.domain}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error('site:set-domain failed:', error instanceof Error ? error.message : String(error));
    await prisma.$disconnect();
    process.exit(1);
  });
