import './_cli-bootstrap';
import { prisma } from '@ipeasy/db';
import { encryptAesGcm } from '../src/common/crypto/aes-gcm';
import { parseArgs, getString } from './_cli-args';
import {
  assertProviderBaseUrl,
  assertProviderCredential,
  formatCliError,
  isCliUsageError,
  optionalTenantId,
  parseCredentialJson,
  requireNativeProvider,
  requireSiteId,
  requireStatus,
  requireTimeoutMs,
  throwCliUsageError,
  writeCliAudit,
} from './_provider-ops';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../src/modules/providers/provider-account-order';

function readCredentialJson(args: ReturnType<typeof parseArgs>): string {
  // Prefer the env var to avoid leaking secrets into shell history.
  const fromEnv = process.env.PROVIDER_CREDENTIAL_JSON;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  const fromFlag = getString(args, 'credential');
  if (fromFlag && fromFlag.trim() !== '') return fromFlag;
  throwCliUsageError('Missing credential. Provide PROVIDER_CREDENTIAL_JSON env var (preferred) or --credential \'{"...":"..."}\'.');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const provider = requireNativeProvider(args);
  const siteId = requireSiteId(args);
  const tenantId = optionalTenantId(args);
  const baseUrlRaw = getString(args, 'base-url');
  if (!baseUrlRaw) throwCliUsageError('Missing required argument: --base-url.');
  const baseUrl = assertProviderBaseUrl(provider, baseUrlRaw);
  const status = requireStatus(args);
  const timeoutMs = requireTimeoutMs(args);
  const inventorySyncEnabled = args.flags.has('inventory-sync');

  const credentialRaw = readCredentialJson(args);
  const credentialObj = assertProviderCredential(provider, parseCredentialJson(credentialRaw));

  const encryptionKey = process.env.APP_ENCRYPTION_KEY as string;
  const credentialEncrypted = encryptAesGcm(JSON.stringify(credentialObj), encryptionKey);

  const existing = await prisma.provider_accounts.findFirst({
    where: { siteId, tenantId, providerCode: provider },
    orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY,
  });

  let accountId: string;
  if (existing) {
    await prisma.provider_accounts.update({
      where: { id: existing.id },
      data: { status, credentialEncrypted, baseUrl, timeoutMs, inventorySyncEnabled },
    });
    accountId = existing.id;
    console.log(`Updated provider account (${accountId})`);
  } else {
    const created = await prisma.provider_accounts.create({
      data: { siteId, tenantId, providerCode: provider, status, credentialEncrypted, baseUrl, timeoutMs, inventorySyncEnabled },
    });
    accountId = created.id;
    console.log(`Created provider account (${accountId})`);
  }

  await writeCliAudit({
    siteId,
    tenantId,
    action: existing ? 'provider.credential.update' : 'provider.credential.create',
    targetType: 'provider_account',
    targetId: accountId,
    requestId: `cli:provider:set-credential:${accountId}`,
    meta: { providerCode: provider, status, baseUrl, timeoutMs, inventorySyncEnabled },
  });

  // Never print credential plaintext or ciphertext.
  console.log(`  providerCode: ${provider}`);
  console.log(`  siteId:       ${siteId}`);
  if (tenantId) console.log(`  tenantId:     ${tenantId}`);
  console.log(`  status:       ${status}`);
  console.log(`  baseUrl:      ${baseUrl}`);
  console.log(`  timeoutMs:    ${timeoutMs}`);
  console.log(`  inventorySync: ${inventorySyncEnabled}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('provider:set-credential failed:', formatCliError(err));
    await prisma.$disconnect();
    process.exit(isCliUsageError(err) ? 2 : 1);
  });
