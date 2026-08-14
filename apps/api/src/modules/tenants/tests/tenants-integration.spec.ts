/**
 * Tenant admin APIs integration tests.
 *
 * These verify tenant and site boundaries against a real PostgreSQL test DB.
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
  seedUser,
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

describe('tenants integration', () => {
  it('PLATFORM_ADMIN creates a tenant with a real tenant admin account', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-create-platform-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-create-platform-admin@example.com', ADMIN_PW, siteId);

    const res = await request
      .post('/api/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Created Tenant',
        code: 'created-tenant',
        adminEmail: 'created-tenant-admin@example.com',
        adminPassword: 'TenantAdmin123',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      siteId,
      code: 'created-tenant',
      name: 'Created Tenant',
      status: 'ACTIVE',
      customerCount: 0,
    });

    const admin = await prisma.admin_users.findFirstOrThrow({
      where: {
        siteId,
        tenantId: res.body.data.id,
        email: 'created-tenant-admin@example.com',
      },
    });
    expect(admin.role).toBe('TENANT_ADMIN');
    expect(admin.status).toBe('ACTIVE');
    expect(admin.passwordHash).not.toBe('TenantAdmin123');

    const tenantAdminToken = await loginAs(request, 'created-tenant-admin@example.com', 'TenantAdmin123', siteId);
    const listRes = await request.get('/api/tenants').set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items).toHaveLength(1);
    expect(listRes.body.data.items[0].id).toBe(res.body.data.id);

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { targetId: res.body.data.id, action: 'tenant.create' },
    });
    expect(audit.tenantId).toBe(res.body.data.id);
    expect(audit.meta).toMatchObject({ adminEmail: 'created-tenant-admin@example.com' });
  });

  it('USER creates a customer-owned self-service sub-site without a tenant admin session', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'self-service-user@example.com',
      password: ADMIN_PW,
      currency: 'CNY',
    });
    const token = await loginAs(request, 'self-service-user@example.com', ADMIN_PW, siteId);

    const res = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Self Service Site',
        code: 'self-service-site',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.tenant).toMatchObject({
      siteId,
      name: 'Self Service Site',
      code: 'self-service-site',
      status: 'ACTIVE',
      ownerUserId: userId,
    });

    const adminCount = await prisma.admin_users.count({
      where: { tenantId: res.body.data.tenant.id },
    });
    expect(adminCount).toBe(0);

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { targetId: res.body.data.tenant.id, action: 'tenant.self_service_create' },
    });
    expect(audit.actorType).toBe('USER');
    expect(audit.tenantId).toBe(res.body.data.tenant.id);
    expect(audit.meta).toMatchObject({ ownerUserId: userId });
  });

  it('USER self-service creation returns the owned sub-site when it already exists', async () => {
    await seedUser(siteId, tenantId, {
      email: 'self-service-user@example.com',
      password: ADMIN_PW,
      currency: 'CNY',
    });
    const token = await loginAs(request, 'self-service-user@example.com', ADMIN_PW, siteId);

    const res = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'First Self Service Site',
        code: 'first-self-service-site',
      });

    expect(res.status).toBe(201);
    const second = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Second Self Service Site',
        code: 'second-self-service-site',
      });

    expect(second.status).toBe(201);
    expect(second.body.data.tenant.id).toBe(res.body.data.tenant.id);
    expect(second.body.data.tenant.code).toBe('first-self-service-site');
  });

  it('PLATFORM_ADMIN lists tenants as a paged site-scoped result', async () => {
    const tenantBId = await seedTenant(siteId);
    const otherSiteId = await seedSite();
    await seedTenant(otherSiteId);
    await seedUser(siteId, tenantBId, {
      email: 'tenant-b-user@example.com',
      password: ADMIN_PW,
      currency: 'CNY',
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-list-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-list-admin@example.com', ADMIN_PW, siteId);

    const res = await request.get('/api/tenants?page=1&pageSize=20').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.map((item: { siteId: string }) => item.siteId)).toEqual([siteId, siteId]);
    expect(res.body.data.items.find((item: { id: string }) => item.id === tenantBId).customerCount).toBe(1);
  });

  it('TENANT_ADMIN lists only its own tenant in a paged result', async () => {
    await seedTenant(siteId);
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-own-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-own-admin@example.com', ADMIN_PW, siteId);

    const res = await request.get('/api/tenants').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe(tenantId);
  });

  it('tenant detail returns site-scoped stats and platform-currency total balance', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'tenant-detail-user@example.com',
      password: ADMIN_PW,
      currency: 'CNY',
    });
    await prisma.wallets.update({ where: { userId }, data: { available: '42.50' } });
    await prisma.orders.create({
      data: {
        siteId,
        tenantId,
        userId,
        type: 'STATIC_PROXY_BUY',
        status: 'PENDING',
        resourceId: await seedResource(siteId),
        quantity: 1,
        durationDays: 30,
        unitPrice: '1',
        totalPrice: '1',
        currency: 'CNY',
        quoteSnapshot: {},
        idempotencyKey: 'tenant-detail-order',
      },
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-detail-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-detail-admin@example.com', ADMIN_PW, siteId);

    const res = await request.get(`/api/tenants/${tenantId}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.customerCount).toBe(1);
    expect(res.body.data.orderCount).toBe(1);
    expect(res.body.data.monthlyOrders).toBe(1);
    expect(res.body.data.totalBalance).toBe('42.5');
    expect(res.body.data.balanceByCurrency).toEqual({ CNY: '42.5' });
    expect(res.body.data.stats.customerCount).toBe(1);
  });

  it('PLATFORM_ADMIN cannot read or update a tenant from another site', async () => {
    const otherSiteId = await seedSite();
    const otherTenantId = await seedTenant(otherSiteId);
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-site-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-site-admin@example.com', ADMIN_PW, siteId);

    const detailRes = await request.get(`/api/tenants/${otherTenantId}`).set('Authorization', `Bearer ${token}`);
    const updateRes = await request
      .put(`/api/tenants/${otherTenantId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' });

    expect(detailRes.status).toBe(404);
    expect(detailRes.body.code).toBe('NOT_FOUND');
    expect(updateRes.status).toBe(404);
    expect(updateRes.body.code).toBe('NOT_FOUND');

    const otherTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: otherTenantId } });
    expect(otherTenant.status).toBe('ACTIVE');
  });

  it('status update writes an audit log under the target tenant', async () => {
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'tenant-status-admin@example.com',
      password: ADMIN_PW,
    });
    const token = await loginAs(request, 'tenant-status-admin@example.com', ADMIN_PW, siteId);

    const res = await request
      .put(`/api/tenants/${tenantId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { actorId: adminId, targetId: tenantId, action: 'tenant.status.update' },
    });
    expect(audit.siteId).toBe(siteId);
    expect(audit.tenantId).toBe(tenantId);
  });
});

async function seedResource(siteId: string): Promise<string> {
  const resource = await prisma.platform_resources.create({
    data: {
      siteId,
      type: 'COUNTRY',
      code: `TENANT_TEST_${Date.now()}`,
      name: 'Tenant Test Resource',
      providerCode: 'IPIPD',
      ipType: 'NATIVE',
      protocol: 'HTTP',
      status: 'ACTIVE',
    },
  });
  return resource.id;
}
