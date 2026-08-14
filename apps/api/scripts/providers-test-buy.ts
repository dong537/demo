import './_cli-bootstrap';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { prisma } from '@ipeasy/db';
import { AppModule } from '../src/app.module';
import { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../src/modules/providers/provider-account-order';
import { StaticProxyBuyInput, ProxyDelivery } from '../src/modules/providers/provider.types';
import { parseArgs, getString } from './_cli-args';
import {
  formatCliError,
  getNumberArg,
  isCliUsageError,
  optionalTenantId,
  requireNativeProvider,
  requireSiteId,
  NativeProviderCode,
  throwCliUsageError,
} from './_provider-ops';

function maskProxy(p: ProxyDelivery): Record<string, unknown> {
  return {
    ip: p.ip,
    port: p.port,
    username: p.username,
    password: '[REDACTED]',
    protocol: p.protocol,
    countryCode: p.countryCode,
    expiresAt: p.expiresAt instanceof Date ? p.expiresAt.toISOString() : String(p.expiresAt),
  };
}

// Resolve the upstream resource id (IPIPD lineId / 985Proxy "CC:type") from
// resource_mappings, mirroring fulfill-static-proxy.use-case so the request we
// preview/send matches the real fulfillment path exactly.
async function resolveProviderResourceId(
  siteId: string,
  providerCode: NativeProviderCode,
  country: string,
): Promise<string | undefined> {
  const resource = await prisma.platform_resources.findFirst({
    where: { siteId, providerCode, code: country },
  });
  if (!resource) return undefined;
  const mapping = await prisma.resource_mappings.findFirst({
    where: { siteId, resourceId: resource.id, providerCode },
    orderBy: { weight: 'desc' },
  });
  return mapping?.providerResourceId ?? undefined;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const provider = requireNativeProvider(args);
  const siteId = requireSiteId(args);
  const tenantId = optionalTenantId(args);
  const country = requireStringArg(args, 'country');
  const ipType = assertIpType(getString(args, 'ip-type') ?? 'NATIVE');
  const protocol = assertProtocol(getString(args, 'protocol') ?? 'HTTP');
  const durationDays = assertPositiveInteger(getNumberArg(args, 'duration', 30), 'duration');
  const quantity = assertPositiveInteger(getNumberArg(args, 'qty', 1), 'qty');
  const currency = getString(args, 'currency') ?? process.env.APP_PLATFORM_CURRENCY ?? 'CNY';

  // Dry-run is the default. A real purchase requires BOTH --no-dry-run/--execute
  // AND --confirm as a second safety gate.
  const wantsExecute = args.flags.has('no-dry-run') || args.flags.has('execute');
  const confirmed = args.flags.has('confirm');
  const dryRun = !(wantsExecute && confirmed);

  // Boot a minimal Nest context: we need the registry (to reach the adapter and
  // its baseUrl) and prisma (to resolve the upstream resource mapping).
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const registry = app.get(ProviderRegistryService);
  const adapter = registry.getAdapter(provider);

  // Dry-run must work without valid credentials. getConfig decrypts the stored
  // credential and throws on mismatch; tolerate that here and fall back to the
  // raw baseUrl (readable without decryption) purely for display.
  let config: Awaited<ReturnType<typeof registry.getConfig>> | null = null;
  let baseUrlForDisplay = '';
  try {
    config = await registry.getConfig(provider, siteId, tenantId);
    baseUrlForDisplay = config.baseUrl;
  } catch {
    const account = await prisma.provider_accounts.findFirst({ where: { siteId, tenantId, providerCode: provider }, orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY });
    baseUrlForDisplay = account?.baseUrl ?? '';
  }

  // Resolve the same upstream resource id the real fulfillment path would use.
  const providerResourceId =
    getString(args, 'provider-resource-id') ??
    (await resolveProviderResourceId(siteId, provider, country));

  const input: StaticProxyBuyInput = {
    countryCode: country,
    regionCode: getString(args, 'region'),
    quantity,
    durationDays,
    currency,
    ipType,
    protocol,
    providerResourceId,
    // 985Proxy reads "CC:type" from businessType; mirror fulfillment behaviour.
    businessType: getString(args, 'business-type') ?? providerResourceId,
    idempotencyKey: getString(args, 'idempotency-key') ?? `test-buy-${randomUUID()}`,
  };

  if (dryRun) {
    if (wantsExecute && !confirmed) {
      console.log('Refusing real purchase: --confirm flag is required alongside --execute/--no-dry-run.');
    }

    // Build the exact upstream request the adapter would send. It performs no
    // network call, and buyStaticProxy reuses it, so this preview cannot drift
    // from the real call.
    let preview;
    try {
      preview = adapter.buildBuyRequest(input, config ?? undefined);
    } catch (err: unknown) {
      console.error('Cannot build upstream request:', err instanceof Error ? err.message : String(err));
      await app.close();
      return 1;
    }

    const baseUrl = baseUrlForDisplay || '(provider not configured - set credential to see live baseUrl)';
    console.log('[DRY RUN] Upstream order request that WOULD be sent (no call made):');
    console.log(`  provider : ${provider}`);
    console.log(`  site     : ${siteId}`);
    if (tenantId) console.log(`  tenant   : ${tenantId}`);
    console.log(`  ${preview.method} ${baseUrl}${preview.path.startsWith('/') ? preview.path : '/' + preview.path}`);
    if (provider === 'PR') {
      console.log('  note     : Proxy-Seller injects the apikey into the URL path at call time');
    }
    console.log(`  providerResourceId : ${providerResourceId ?? '(none - country/businessType fallback)'}`);
    console.log('  body     :');
    console.log(JSON.stringify(preview.body, null, 2).replace(/^/gm, '    '));
    await app.close();
    return 0;
  }

  if (!config || config.status === 'DISABLED') {
    console.error(`Provider ${provider} is disabled or its credential could not be loaded. Configure credentials first.`);
    await app.close();
    return 1;
  }
  const activeConfig = config;

  try {
    const result = await adapter.buyStaticProxy(input, activeConfig);
    console.log(`Purchase status: ${result.status}`);
    console.log(`upstreamOrderId: ${result.upstreamOrderId}`);
    if (result.failReason) console.log(`failReason: ${result.failReason}`);
    console.log('proxies (password redacted):');
    console.log(JSON.stringify(result.proxies.map(maskProxy), null, 2));

    await prisma.audit_logs.create({
      data: {
        siteId,
        tenantId,
        actorType: 'SYSTEM',
        actorId: 'cli:provider-ops',
        targetType: 'provider_order',
        targetId: result.upstreamOrderId,
        action: 'provider.test_buy',
        requestId: input.idempotencyKey,
        meta: { provider, countryCode: country, quantity, durationDays, status: result.status },
      },
    });

    await app.close();
    return result.status === 'FAILED' ? 1 : 0;
  } catch (err: unknown) {
    await app.close();
    throw err;
  }
}

function requireStringArg(args: ReturnType<typeof parseArgs>, key: string): string {
  const value = getString(args, key);
  if (value === undefined || value === '') {
    throwCliUsageError(`Missing required argument: --${key}.`);
  }
  return value;
}

function assertIpType(value: string): 'NATIVE' | 'BROADCAST' {
  if (value === 'NATIVE' || value === 'BROADCAST') return value;
  throwCliUsageError(`Invalid --ip-type: ${value}. Expected NATIVE or BROADCAST.`);
}

function assertProtocol(value: string): 'HTTP' | 'SOCKS5' | 'BOTH' {
  if (value === 'HTTP' || value === 'SOCKS5' || value === 'BOTH') return value;
  throwCliUsageError(`Invalid --protocol: ${value}. Expected HTTP, SOCKS5, or BOTH.`);
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throwCliUsageError(`Invalid --${field}: ${value}. Expected a positive integer.`);
  }
  return value;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error('providers:test-buy failed:', formatCliError(err));
    await prisma.$disconnect();
    process.exit(isCliUsageError(err) ? 2 : 1);
  });
