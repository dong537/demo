// One-shot production bootstrap: configure the three native providers from env,
// run real inventory sync (IPIPD/985 always; PR only if its IP allowlist permits),
// then seed the default price template. Idempotent.
//
// Reuses existing logic: credential validation/encryption (provider-ops + aes-gcm),
// SyncInventoryUseCase (no inventory-write duplication), seedPricing.
//
// Credentials come from env vars (never committed, never logged):
//   IPIPD_APP_ID, IPIPD_APP_SECRET
//   NINE_EIGHT_FIVE_APIKEY
//   PR_APIKEY
// Optional: BOOTSTRAP_SYNC_PR=true to also sync PR (after allowlisting Railway egress IP).
import './_cli-bootstrap';
import { NestFactory } from '@nestjs/core';
import { prisma } from '@ipeasy/db';
import { encryptAesGcm } from '../src/common/crypto/aes-gcm';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../src/modules/providers/provider-account-order';
import { AppModule } from '../src/app.module';
import { SyncInventoryUseCase } from '../src/modules/resources/use-cases/sync-inventory.use-case';
import { assertProviderBaseUrl, assertProviderCredential, writeCliAudit } from './_provider-ops';
import { seedPricing } from './seed-pricing';

type NativeProvider = 'IPIPD' | 'NINE_EIGHT_FIVE' | 'PR';

interface ProviderPlan {
  code: NativeProvider;
  baseUrl: string;
  credential: Record<string, string>;
  sync: boolean;
}

function buildPlans(): ProviderPlan[] {
  const plans: ProviderPlan[] = [];
  const ipipdId = process.env.IPIPD_APP_ID?.trim();
  const ipipdSecret = process.env.IPIPD_APP_SECRET?.trim();
  if (ipipdId && ipipdSecret) {
    plans.push({
      code: 'IPIPD',
      baseUrl: process.env.IPIPD_BASE_URL?.trim() || 'https://api.ipipd.cn',
      credential: { appId: ipipdId, appSecret: ipipdSecret },
      sync: true,
    });
  }
  const nefKey = process.env.NINE_EIGHT_FIVE_APIKEY?.trim();
  if (nefKey) {
    plans.push({ code: 'NINE_EIGHT_FIVE', baseUrl: 'https://open-api.985proxy.com', credential: { apikey: nefKey }, sync: true });
  }
  const prKey = process.env.PR_APIKEY?.trim();
  if (prKey) {
    // PR has an IP allowlist; only sync when explicitly enabled after allowlisting.
    plans.push({ code: 'PR', baseUrl: 'https://proxy-seller.com/personal/api/v1', credential: { apikey: prKey }, sync: process.env.BOOTSTRAP_SYNC_PR === 'true' });
  }
  return plans;
}

async function upsertAccount(siteId: string, plan: ProviderPlan, encryptionKey: string): Promise<string> {
  const credentialObj = assertProviderCredential(plan.code, plan.credential);
  const baseUrl = assertProviderBaseUrl(plan.code, plan.baseUrl);
  const credentialEncrypted = encryptAesGcm(JSON.stringify(credentialObj), encryptionKey);
  const existing = await prisma.provider_accounts.findFirst({
    where: { siteId, tenantId: null, providerCode: plan.code },
    orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY,
  });
  const data = { status: 'ACTIVE' as const, credentialEncrypted, baseUrl, timeoutMs: 15000, inventorySyncEnabled: true };
  let accountId: string;
  if (existing) {
    await prisma.provider_accounts.update({ where: { id: existing.id }, data });
    accountId = existing.id;
  } else {
    const created = await prisma.provider_accounts.create({ data: { siteId, tenantId: null, providerCode: plan.code, ...data } });
    accountId = created.id;
  }
  await writeCliAudit({
    siteId, tenantId: null,
    action: existing ? 'provider.credential.update' : 'provider.credential.create',
    targetType: 'provider_account', targetId: accountId,
    requestId: `cli:provider:bootstrap:${plan.code}:${accountId}`,
    meta: { providerCode: plan.code, status: 'ACTIVE', baseUrl, timeoutMs: 15000, inventorySyncEnabled: true },
  });
  console.log(`[provider] ${plan.code}: ${existing ? 'updated' : 'created'} account ${accountId} (base ${baseUrl})`);
  return accountId;
}

async function main(): Promise<number> {
  const encryptionKey = process.env.APP_ENCRYPTION_KEY;
  if (!encryptionKey) { console.error('bootstrap: APP_ENCRYPTION_KEY missing'); return 1; }

  const site = await prisma.sites.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!site) { console.error('bootstrap: no site found'); return 1; }
  console.log(`[bootstrap] site=${site.code} (${site.id})`);

  const plans = buildPlans();
  if (plans.length === 0) { console.error('bootstrap: no provider credentials in env, nothing to do'); return 1; }

  const accountIdByProvider = new Map<NativeProvider, string>();
  for (const plan of plans) {
    const accountId = await upsertAccount(site.id, plan, encryptionKey);
    accountIdByProvider.set(plan.code, accountId);
  }

  // Inventory sync via the real use case (never writes fake inventory).
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const syncInventory = app.get(SyncInventoryUseCase, { strict: false });
  for (const plan of plans.filter((p) => p.sync)) {
    try {
      const result = await syncInventory.execute(site.id, plan.code, null, accountIdByProvider.get(plan.code));
      console.log(`[sync] ${plan.code}: synced ${result.synced} resource(s), created=${result.created}, updated=${result.updated}, countries=${result.countries.join(',')}`);
    } catch (err) {
      // Surface upstream failures (allowlist/auth) loudly; do not fake inventory.
      console.error(`[sync] ${plan.code}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await app.close();

  // Seed default price template for all ACTIVE resources.
  const pricing = await seedPricing(site.id);
  console.log(`[pricing] template=${pricing.templateId} rules=${pricing.ruleCount}`);
  return 0;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err: unknown) => {
    console.error('provider:bootstrap failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
