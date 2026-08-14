/**
 * Tenant provider account integration tests.
 *
 * These verify tenant-bound native provider credentials against a real
 * PostgreSQL test DB. Plain credentials must never be returned by the API.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import { decryptAesGcm } from '../../../common/crypto/aes-gcm';
import {
  createTestApp,
  cleanDatabase,
  seedSite,
  seedTenant,
  seedAdminUser,
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;

const ADMIN_PW = 'pw-12345';
const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(async () => {
  app = await createTestApp({ config: { APP_ENCRYPTION_KEY: ENC_KEY } });
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await cleanDatabase();
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
  siteId = await seedSite();
  tenantId = await seedTenant(siteId);
});

describe('tenant provider accounts integration', () => {
  it('TENANT_ADMIN creates and lists its own provider account without exposing credentials', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-provider-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-provider-admin@example.com', ADMIN_PW, siteId);

    const createRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'IPIPD',
        credential: { appId: 'tenant-app', appSecret: 'tenant-secret' },
        baseUrl: 'https://tenant-provider.example.com',
        timeoutMs: 8000,
        inventorySyncEnabled: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data).toMatchObject({
      siteId,
      tenantId,
      providerCode: 'IPIPD',
      status: 'ACTIVE',
      baseUrl: 'https://tenant-provider.example.com',
      timeoutMs: 8000,
      inventorySyncEnabled: true,
    });
    expect(JSON.stringify(createRes.body.data)).not.toContain('tenant-secret');
    expect(JSON.stringify(createRes.body.data)).not.toContain('credentialEncrypted');

    const stored = await prisma.provider_accounts.findUniqueOrThrow({ where: { id: createRes.body.data.id } });
    expect(stored.tenantId).toBe(tenantId);
    expect(stored.credentialEncrypted).not.toContain('tenant-secret');
    expect(JSON.parse(decryptAesGcm(stored.credentialEncrypted, ENC_KEY))).toEqual({
      appId: 'tenant-app',
      appSecret: 'tenant-secret',
    });

    const listRes = await request
      .get(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(JSON.stringify(listRes.body.data)).not.toContain('tenant-secret');
    expect(JSON.stringify(listRes.body.data)).not.toContain('credentialEncrypted');
  });

  it('TENANT_ADMIN cannot access another tenant provider accounts', async () => {
    const otherTenantId = await seedTenant(siteId);
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-cross-provider-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-cross-provider-admin@example.com', ADMIN_PW, siteId);

    const res = await request
      .get(`/api/tenants/${otherTenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('PLATFORM_ADMIN updates and disables a tenant provider account with audit logs', async () => {
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-provider-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'platform-provider-admin@example.com', ADMIN_PW, siteId);

    const createRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'PR',
        credential: { apiKey: 'initial-key' },
        baseUrl: 'https://pr-provider.example.com',
      });

    const accountId = createRes.body.data.id as string;

    const updateRes = await request
      .put(`/api/tenants/${tenantId}/provider-accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        credential: { apiKey: 'rotated-key' },
        baseUrl: 'https://rotated-pr-provider.example.com',
        status: 'ACTIVE',
        inventorySyncEnabled: true,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data).toMatchObject({
      id: accountId,
      status: 'ACTIVE',
      baseUrl: 'https://rotated-pr-provider.example.com',
      inventorySyncEnabled: true,
    });

    const disableRes = await request
      .delete(`/api/tenants/${tenantId}/provider-accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.data.status).toBe('DISABLED');

    const auditActions = await prisma.audit_logs.findMany({
      where: { actorId: adminId, targetId: accountId },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditActions.map((row) => row.action)).toEqual([
      'tenant.provider_account.create',
      'tenant.provider_account.update',
      'tenant.provider_account.disable',
    ]);
    expect(auditActions.map((row) => row.tenantId)).toEqual([tenantId, tenantId, tenantId]);
    expect(JSON.stringify(auditActions.map((row) => row.meta))).not.toContain('rotated-key');
  });

  it('merges partial credential edits instead of replacing the whole tenant credential', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-provider-merge@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-provider-merge@example.com', ADMIN_PW, siteId);

    const createRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'IPIPD',
        credential: { appId: 'tenant-app', appSecret: 'old-secret' },
        baseUrl: 'https://api.ipipd.cn',
      });
    const accountId = createRes.body.data.id as string;

    const updateRes = await request
      .put(`/api/tenants/${tenantId}/provider-accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        credential: { appSecret: 'new-secret' },
      });

    expect(updateRes.status).toBe(200);
    const stored = await prisma.provider_accounts.findUniqueOrThrow({ where: { id: accountId } });
    expect(JSON.parse(decryptAesGcm(stored.credentialEncrypted, ENC_KEY))).toEqual({
      appId: 'tenant-app',
      appSecret: 'new-secret',
    });
  });

  it('projects tenant enabled countries onto the tenant provider account resources', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-provider-countries@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-provider-countries@example.com', ADMIN_PW, siteId);

    const createRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'IPIPD',
        credential: { appId: 'tenant-app', appSecret: 'tenant-secret' },
        baseUrl: 'https://api.ipipd.cn',
      });
    const accountId = createRes.body.data.id as string;
    const [gbResource, jpResource] = await Promise.all([
      prisma.platform_resources.create({
        data: {
          siteId,
          upstreamAccountId: accountId,
          type: 'ZONE',
          code: 'GB:line-one',
          name: 'United Kingdom line one',
          providerCode: 'IPIPD',
          ipType: 'NATIVE',
          protocol: 'BOTH',
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_country_disabled',
        },
      }),
      prisma.platform_resources.create({
        data: {
          siteId,
          upstreamAccountId: accountId,
          type: 'ZONE',
          code: 'JP:line-one',
          name: 'Japan line one',
          providerCode: 'IPIPD',
          ipType: 'NATIVE',
          protocol: 'BOTH',
          status: 'ACTIVE',
          isVisible: true,
          isSaleable: true,
          unsaleableReason: null,
        },
      }),
    ]);

    const updateRes = await request
      .put(`/api/tenants/${tenantId}/provider-accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabledCountryCodes: ['GB'] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.enabledCountryCodes).toEqual(['GB']);
    const resources = await prisma.platform_resources.findMany({
      where: { id: { in: [gbResource.id, jpResource.id] } },
      orderBy: { code: 'asc' },
    });
    expect(resources.map((row) => ({
      code: row.code,
      status: row.status,
      isVisible: row.isVisible,
      isSaleable: row.isSaleable,
      unsaleableReason: row.unsaleableReason,
    }))).toEqual([
      {
        code: 'GB:line-one',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
        unsaleableReason: null,
      },
      {
        code: 'JP:line-one',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    ]);
  });

  it('rejects unsafe baseUrl and UPSTREAM_API provider code', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-provider-invalid@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-provider-invalid@example.com', ADMIN_PW, siteId);

    const unsafeRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'IPIPD',
        credential: { appId: 'tenant-app', appSecret: 'tenant-secret' },
        baseUrl: 'http://127.0.0.1:8080',
      });

    const upstreamRes = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'UPSTREAM_API',
        credential: { apiKey: 'tenant-key' },
        baseUrl: 'https://upstream.example.com',
      });

    expect(unsafeRes.status).toBe(400);
    expect(unsafeRes.body.code).toBe('VALIDATION_ERROR');
    expect(unsafeRes.body.data.reasonKey).toBe('unsafe_upstream_url');
    expect(upstreamRes.status).toBe(400);
    expect(upstreamRes.body.code).toBe('VALIDATION_ERROR');
    expect(upstreamRes.body.data.reasonKey).toBe('provider_code_invalid');
  });

  it('rejects incomplete provider-specific credentials', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-provider-credential-invalid@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-provider-credential-invalid@example.com', ADMIN_PW, siteId);

    const res = await request
      .post(`/api/tenants/${tenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        providerCode: 'IPIPD',
        credential: { appId: 'tenant-app' },
        baseUrl: 'https://api.ipipd.cn',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('provider_credential_invalid');
  });

  it('PLATFORM_ADMIN cannot access provider accounts for a tenant in another site', async () => {
    const otherSiteId = await seedSite();
    const otherTenantId = await seedTenant(otherSiteId);
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-provider-cross-site@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'platform-provider-cross-site@example.com', ADMIN_PW, siteId);

    const res = await request
      .get(`/api/tenants/${otherTenantId}/provider-accounts`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('tenant_not_found');
  });
});
