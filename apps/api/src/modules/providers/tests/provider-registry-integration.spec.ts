import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import { ConfigService } from '../../../common/config/config.service';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { createTestApp, cleanDatabase, seedSite } from '../../../test-utils/integration-setup';
import { ProviderRegistryService } from '../provider-registry.service';

let app: NestFastifyApplication;
let registry: ProviderRegistryService;
let config: ConfigService;

beforeAll(async () => {
  app = await createTestApp();
  registry = app.get(ProviderRegistryService);
  config = app.get(ConfigService);
});

afterAll(async () => {
  await cleanDatabase();
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('ProviderRegistryService integration', () => {
  it('loads and decrypts provider config by site', async () => {
    const siteA = await seedSite();
    const siteB = await seedSite();
    await seedProviderAccount(siteA, { appId: 'site-a-app', appSecret: 'site-a-secret' }, 'https://provider-a.example.com');
    const accountB = await seedProviderAccount(siteB, { appId: 'site-b-app', appSecret: 'site-b-secret' }, 'https://provider-b.example.com');

    const runtimeConfig = await registry.getConfig('IPIPD', siteB);

    expect(runtimeConfig).toMatchObject({
      code: 'IPIPD',
      status: 'ACTIVE',
      siteId: siteB,
      upstreamAccountId: accountB.id,
      baseUrl: 'https://provider-b.example.com',
      credential: { appId: 'site-b-app', appSecret: 'site-b-secret' },
    });
  });

  it('treats the most recently saved provider account as the current runtime config', async () => {
    const siteId = await seedSite();
    const first = await seedProviderAccount(siteId, { appId: 'first-app', appSecret: 'first-secret' }, 'https://first-provider.example.com');
    await seedProviderAccount(siteId, { appId: 'second-app', appSecret: 'second-secret' }, 'https://second-provider.example.com');

    await prisma.provider_accounts.update({
      where: { id: first.id },
      data: {
        baseUrl: 'https://operator-switched-provider.example.com',
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    });

    const runtimeConfig = await registry.getConfig('IPIPD', siteId);

    expect(runtimeConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: first.id,
      baseUrl: 'https://operator-switched-provider.example.com',
      credential: { appId: 'first-app', appSecret: 'first-secret' },
    });
  });

  it('prefers active tenant provider account and falls back to site global account', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenantForRegistry(siteId);
    const globalAccount = await seedProviderAccount(siteId, { appId: 'global-app', appSecret: 'global-secret' }, 'https://global-provider.example.com');
    const tenantAccount = await seedProviderAccount(
      siteId,
      { appId: 'tenant-app', appSecret: 'tenant-secret' },
      'https://tenant-provider.example.com',
      tenantId,
    );

    const tenantConfig = await registry.getConfig('IPIPD', siteId, tenantId);
    expect(tenantConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: tenantAccount.id,
      baseUrl: 'https://tenant-provider.example.com',
      credential: { appId: 'tenant-app', appSecret: 'tenant-secret' },
    });

    await prisma.provider_accounts.update({ where: { id: tenantAccount.id }, data: { status: 'DISABLED' } });

    const fallbackConfig = await registry.getConfig('IPIPD', siteId, tenantId);
    expect(fallbackConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: globalAccount.id,
      baseUrl: 'https://global-provider.example.com',
      credential: { appId: 'global-app', appSecret: 'global-secret' },
    });
  });

  it('resolves upstream API config by tenant scope when no explicit account id is provided', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenantForRegistry(siteId);
    const publicAccount = await seedUpstreamAccount(siteId, null, 'https://public-upstream.example.com', 'public-key');
    const tenantAccount = await seedUpstreamAccount(siteId, tenantId, 'https://tenant-upstream.example.com', 'tenant-key');

    const tenantConfig = await registry.getConfig('UPSTREAM_API', siteId, tenantId);
    expect(tenantConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: tenantAccount.id,
      baseUrl: 'https://tenant-upstream.example.com',
      credential: { apiKey: 'tenant-key' },
    });

    await prisma.upstream_api_accounts.update({ where: { id: tenantAccount.id }, data: { status: 'DISABLED' } });

    const fallbackConfig = await registry.getConfig('UPSTREAM_API', siteId, tenantId);
    expect(fallbackConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: publicAccount.id,
      baseUrl: 'https://public-upstream.example.com',
      credential: { apiKey: 'public-key' },
    });
  });

  it('treats the most recently saved upstream API account as the current runtime config', async () => {
    const siteId = await seedSite();
    const first = await seedUpstreamAccount(siteId, null, 'https://first-upstream.example.com', 'first-key');
    await seedUpstreamAccount(siteId, null, 'https://second-upstream.example.com', 'second-key');

    await prisma.upstream_api_accounts.update({
      where: { id: first.id },
      data: {
        baseUrl: 'https://operator-switched-upstream.example.com',
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    });

    const runtimeConfig = await registry.getConfig('UPSTREAM_API', siteId, null);

    expect(runtimeConfig).toMatchObject({
      status: 'ACTIVE',
      upstreamAccountId: first.id,
      baseUrl: 'https://operator-switched-upstream.example.com',
      credential: { apiKey: 'first-key' },
    });
  });

  it('redacts nested credentials before writing upstream request logs', async () => {
    const siteId = await seedSite();

    await registry.logUpstreamRequest({
      siteId,
      providerCode: 'IPIPD',
      upstreamAccountId: 'provider-account-id',
      operation: 'buyStaticProxy',
      requestId: 'req-provider-log',
      durationMs: 12,
      status: 'SUCCESS',
      requestSummary: {
        method: 'POST',
        credential: { appId: 'plain-app', appSecret: 'plain-secret' },
        nested: { apiKey: 'plain-api-key', AppSecret: 'plain-case-secret', keep: 'safe' },
      },
      responseSummary: {
        proxies: [{ username: 'plain-user', password: 'plain-password', ip: '1.2.3.4' }],
      },
    });

    const log = await prisma.upstream_request_logs.findFirstOrThrow({ where: { requestId: 'req-provider-log' } });
    expect(log.requestSummary).toEqual({
      method: 'POST',
      credential: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', AppSecret: '[REDACTED]', keep: 'safe' },
    });
    expect(log.responseSummary).toEqual({
      proxies: [{ username: '[REDACTED]', password: '[REDACTED]', ip: '1.2.3.4' }],
    });
  });
});

async function seedProviderAccount(siteId: string, credential: Record<string, string>, baseUrl: string, tenantId?: string) {
  return prisma.provider_accounts.create({
    data: {
      siteId,
      tenantId,
      providerCode: 'IPIPD',
      status: 'ACTIVE',
      credentialEncrypted: encryptAesGcm(JSON.stringify(credential), config.get('APP_ENCRYPTION_KEY')),
      baseUrl,
      timeoutMs: 5000,
      inventorySyncEnabled: true,
    },
  });
}

async function seedTenantForRegistry(siteId: string) {
  const tenant = await prisma.tenants.create({
    data: {
      siteId,
      code: `registry_tenant_${Date.now()}`,
      name: 'Registry Tenant',
      status: 'ACTIVE',
    },
  });
  return tenant.id;
}

async function seedUpstreamAccount(siteId: string, tenantId: string | null, baseUrl: string, apiKey: string) {
  return prisma.upstream_api_accounts.create({
    data: {
      siteId,
      tenantId,
      name: `Upstream ${Date.now()}`,
      status: 'ACTIVE',
      baseUrl,
      apiKeyEncrypted: encryptAesGcm(apiKey, config.get('APP_ENCRYPTION_KEY')),
      timeoutMs: 5000,
      inventorySyncEnabled: true,
    },
  });
}
