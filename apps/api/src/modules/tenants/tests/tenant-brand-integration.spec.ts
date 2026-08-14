/**
 * Tenant brand integration tests.
 *
 * These verify public brand reads and authenticated brand writes against a
 * real PostgreSQL test DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
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

beforeAll(async () => {
  app = await createTestApp();
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

describe('tenant brand integration', () => {
  it('public GET returns tenant name when brand config is not set', async () => {
    const tenant = await prisma.tenants.findUniqueOrThrow({ where: { id: tenantId } });

    const res = await request.get(`/api/tenants/${tenantId}/brand`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      tenantId,
      siteName: tenant.name,
    });
  });

  it('TENANT_ADMIN updates its own brand config and writes an audit log', async () => {
    const adminId = await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-brand-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-brand-admin@example.com', ADMIN_PW, siteId);

    const updateRes = await request
      .put(`/api/tenants/${tenantId}/brand`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        siteName: 'Reseller Portal',
        logoUrl: 'https://cdn.example.com/brand-logo.png',
        primaryColor: '#12abEF',
        customDomain: 'Brand.Example.COM',
        supportEmail: 'support@example.com',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data).toEqual({
      tenantId,
      siteName: 'Reseller Portal',
      logoUrl: 'https://cdn.example.com/brand-logo.png',
      primaryColor: '#12ABEF',
      customDomain: 'brand.example.com',
      supportEmail: 'support@example.com',
    });

    const getRes = await request.get(`/api/tenants/${tenantId}/brand`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toEqual(updateRes.body.data);

    const stored = await prisma.tenants.findUniqueOrThrow({ where: { id: tenantId } });
    expect(stored.brandConfig).toEqual({
      siteName: 'Reseller Portal',
      logoUrl: 'https://cdn.example.com/brand-logo.png',
      primaryColor: '#12ABEF',
      customDomain: 'brand.example.com',
      supportEmail: 'support@example.com',
    });

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { actorId: adminId, targetId: tenantId, action: 'tenant.brand.update' },
    });
    expect(audit.siteId).toBe(siteId);
    expect(audit.tenantId).toBe(tenantId);
  });

  it('GET /api/sites/current resolves a reseller custom domain to its tenant context', async () => {
    await prisma.tenants.update({
      where: { id: tenantId },
      data: {
        brandConfig: {
          siteName: 'Reseller Portal',
          logoUrl: 'https://cdn.example.com/brand-logo.png',
          primaryColor: '#12ABEF',
          customDomain: 'brand.example.com',
          supportEmail: 'support@example.com',
        },
      },
    });

    const res = await request
      .get('/api/sites/current')
      .set('x-public-host', 'brand.example.com:443');

    expect(res.status).toBe(200);
    expect(res.body.data.site.id).toBe(siteId);
    expect(res.body.data.tenant).toEqual({
      id: tenantId,
      name: expect.any(String),
      brandConfig: {
        siteName: 'Reseller Portal',
        logoUrl: 'https://cdn.example.com/brand-logo.png',
        primaryColor: '#12ABEF',
        customDomain: 'brand.example.com',
        supportEmail: 'support@example.com',
      },
    });
  });

  it('TENANT_ADMIN cannot update another tenant brand in the same site', async () => {
    const otherTenantId = await seedTenant(siteId);
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-brand-cross@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-brand-cross@example.com', ADMIN_PW, siteId);

    const res = await request
      .put(`/api/tenants/${otherTenantId}/brand`)
      .set('Authorization', `Bearer ${token}`)
      .send({ siteName: 'Wrong Brand' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SCOPE_VIOLATION');

    const otherTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: otherTenantId } });
    expect(otherTenant.brandConfig).toBeNull();
  });

  it('PLATFORM_ADMIN cannot update a tenant brand in another site', async () => {
    const otherSiteId = await seedSite();
    const otherTenantId = await seedTenant(otherSiteId);
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-brand-platform@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-brand-platform@example.com', ADMIN_PW, siteId);

    const res = await request
      .put(`/api/tenants/${otherTenantId}/brand`)
      .set('Authorization', `Bearer ${token}`)
      .send({ siteName: 'Cross Site Brand' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const otherTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: otherTenantId } });
    expect(otherTenant.brandConfig).toBeNull();
  });

  it('rejects invalid brand fields', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-brand-invalid@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-brand-invalid@example.com', ADMIN_PW, siteId);

    const res = await request
      .put(`/api/tenants/${tenantId}/brand`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        siteName: 'Brand',
        logoUrl: 'http://cdn.example.com/logo.png',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('brand_logo_url_invalid');
  });
});
