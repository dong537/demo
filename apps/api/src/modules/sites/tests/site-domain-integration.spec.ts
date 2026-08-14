import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedAdminUser,
  seedSite,
  seedTenant,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;

const ADMIN_PASSWORD = 'site-domain-admin-password';

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
});

describe('site public domain integration', () => {
  it('platform admin updates the domain, writes audit, and public resolution matches it', async () => {
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'site-domain-admin@example.com',
      password: ADMIN_PASSWORD,
    });
    const token = await loginAs(request, 'site-domain-admin@example.com', ADMIN_PASSWORD, siteId);

    const update = await request
      .put('/api/sites/current/domain')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: ' Public.Example.COM ' });

    expect(update.status).toBe(200);
    expect(update.body.data).toEqual(expect.objectContaining({
      id: siteId,
      domain: 'public.example.com',
    }));

    const resolved = await request
      .get('/api/sites/current')
      .set('x-public-host', 'public.example.com:443');
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.site).toEqual(expect.objectContaining({
      id: siteId,
      domain: 'public.example.com',
    }));

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { siteId, actorId: adminId, action: 'site.domain.update' },
    });
    expect(audit.meta).toEqual({
      previousDomain: expect.any(String),
      newDomain: 'public.example.com',
    });
  });

  it('rejects tenant administrators', async () => {
    const tenantId = await seedTenant(siteId);
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'site-domain-tenant-admin@example.com',
      password: ADMIN_PASSWORD,
    });
    const token = await loginAs(request, 'site-domain-tenant-admin@example.com', ADMIN_PASSWORD, siteId);

    const response = await request
      .put('/api/sites/current/domain')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'forbidden.example.com' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('returns a stable conflict when another site owns the domain', async () => {
    const otherSiteId = await seedSite();
    const otherSite = await prisma.sites.findUniqueOrThrow({ where: { id: otherSiteId } });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'site-domain-conflict-admin@example.com',
      password: ADMIN_PASSWORD,
    });
    const token = await loginAs(request, 'site-domain-conflict-admin@example.com', ADMIN_PASSWORD, siteId);

    const response = await request
      .put('/api/sites/current/domain')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: otherSite.domain });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.data.reasonKey).toBe('site_domain_taken');
  });
});
