import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
  seedUser,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantAId: string;
let tenantBId: string;

const PW = 'pw-12345';

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
  tenantAId = await seedTenant(siteId);
  tenantBId = await seedTenant(siteId);
});

describe('admin minimum page APIs', () => {
  it('GET /api/sites/current resolves a real site id for login', async () => {
    const res = await request.get('/api/sites/current');

    expect(res.status).toBe(200);
    expect(res.body.data.site.id).toBe(siteId);
  });

  it('PLATFORM_ADMIN can list users across site with search and pagination', async () => {
    await seedUser(siteId, tenantAId, { email: 'alice@example.com', password: PW });
    await seedUser(siteId, tenantBId, { email: 'bob@example.com', password: PW });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'platform-users@example.com', password: PW });
    const token = await loginAs(request, 'platform-users@example.com', PW, siteId);

    const res = await request
      .get('/api/users')
      .query({ search: 'alice', page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].email).toBe('alice@example.com');
    expect(res.body.data.items[0].tenantId).toBe(tenantAId);
  });

  it('PLATFORM_ADMIN can filter users by tenantId for reseller detail pages', async () => {
    await seedUser(siteId, tenantAId, { email: 'tenant-a-filter@example.com', password: PW });
    await seedUser(siteId, tenantBId, { email: 'tenant-b-filter@example.com', password: PW });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'platform-user-filter@example.com', password: PW });
    const token = await loginAs(request, 'platform-user-filter@example.com', PW, siteId);

    const res = await request
      .get('/api/users')
      .query({ tenantId: tenantBId, page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].email).toBe('tenant-b-filter@example.com');
    expect(res.body.data.items[0].tenantId).toBe(tenantBId);
  });

  it('PLATFORM_ADMIN can create a customer user with wallet and audit trail', async () => {
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-create-user@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'platform-create-user@example.com', PW, siteId);

    const res = await request
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'created-by-admin@example.com',
        password: 'Customer123!',
        tenantId: tenantBId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('created-by-admin@example.com');
    expect(res.body.data.tenantId).toBe(tenantBId);
    expect(res.body.data.status).toBe('ACTIVE');

    const wallet = await prisma.wallets.findUniqueOrThrow({
      where: { userId: res.body.data.id },
    });
    expect(wallet.available.toString()).toBe('0');
    expect(wallet.tenantId).toBe(tenantBId);

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { action: 'users.create', actorId: adminId, targetId: res.body.data.id },
    });
    expect(audit.actorType).toBe('ADMIN_USER');
    expect(audit.tenantId).toBe(tenantBId);
  });

  it('TENANT_ADMIN creates users only inside its tenant', async () => {
    const adminId = await seedAdminUser(siteId, tenantAId, 'TENANT_ADMIN', {
      email: 'tenant-create-user@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'tenant-create-user@example.com', PW, siteId);

    const res = await request
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'created-by-tenant-admin@example.com',
        password: 'Customer123!',
        tenantId: tenantBId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toBe(tenantAId);

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { action: 'users.create', actorId: adminId, targetId: res.body.data.id },
    });
    expect(audit.tenantId).toBe(tenantAId);
  });

  it('create user rejects duplicate emails visibly', async () => {
    await seedUser(siteId, tenantAId, { email: 'duplicate-create@example.com', password: PW });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-duplicate-user@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'platform-duplicate-user@example.com', PW, siteId);

    const res = await request
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'duplicate-create@example.com',
        password: 'Customer123!',
        tenantId: tenantAId,
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('email_taken');
  });

  it('PLATFORM_ADMIN can impersonate an active customer with an auditable user session', async () => {
    const { userId } = await seedUser(siteId, tenantAId, { email: 'impersonated@example.com', password: PW });
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-impersonate@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'platform-impersonate@example.com', PW, siteId);

    const res = await request
      .post(`/api/users/${userId}/impersonate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token).not.toBe('');
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const meRes = await request
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.ownerType).toBe('USER');
    expect(meRes.body.data.ownerId).toBe(userId);
    expect(meRes.body.data.tenantId).toBe(tenantAId);

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { action: 'users.impersonate', actorId: adminId, targetId: userId },
    });
    expect(audit.actorType).toBe('ADMIN_USER');
    expect(audit.tenantId).toBe(tenantAId);
  });

  it('TENANT_ADMIN cannot impersonate a customer from another tenant', async () => {
    const { userId } = await seedUser(siteId, tenantBId, { email: 'tenant-b-impersonate@example.com', password: PW });
    await seedAdminUser(siteId, tenantAId, 'TENANT_ADMIN', {
      email: 'tenant-a-impersonate@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'tenant-a-impersonate@example.com', PW, siteId);

    const res = await request
      .post(`/api/users/${userId}/impersonate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('user_not_found');
  });

  it('TENANT_ADMIN only lists users and audit logs in its tenant', async () => {
    await seedUser(siteId, tenantAId, { email: 'tenant-a-user@example.com', password: PW });
    await seedUser(siteId, tenantBId, { email: 'tenant-b-user@example.com', password: PW });
    const adminId = await seedAdminUser(siteId, tenantAId, 'TENANT_ADMIN', {
      email: 'tenant-admin-pages@example.com',
      password: PW,
    });
    const token = await loginAs(request, 'tenant-admin-pages@example.com', PW, siteId);

    await prisma.audit_logs.createMany({
      data: [
        {
          siteId,
          tenantId: tenantAId,
          actorType: 'ADMIN_USER',
          actorId: adminId,
          targetType: 'users',
          targetId: null,
          action: 'tenant.visible',
          requestId: 'req-visible',
        },
        {
          siteId,
          tenantId: tenantBId,
          actorType: 'ADMIN_USER',
          actorId: adminId,
          targetType: 'users',
          targetId: null,
          action: 'tenant.hidden',
          requestId: 'req-hidden',
        },
      ],
    });

    const usersRes = await request.get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(usersRes.status).toBe(200);
    expect(usersRes.body.data.total).toBe(1);
    expect(usersRes.body.data.items[0].tenantId).toBe(tenantAId);

    const auditRes = await request.get('/api/audit').set('Authorization', `Bearer ${token}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.items.map((entry: { action: string }) => entry.action)).toContain('tenant.visible');
    expect(auditRes.body.data.items.map((entry: { action: string }) => entry.action)).not.toContain('tenant.hidden');
  });

  it('admin order list is scoped by site and effective tenant', async () => {
    const { userId: userAId } = await seedUser(siteId, tenantAId, { email: 'tenant-a-order@example.com', password: PW });
    const { userId: userBId } = await seedUser(siteId, tenantBId, { email: 'tenant-b-order@example.com', password: PW });
    const tenantAdminId = await seedAdminUser(siteId, tenantAId, 'TENANT_ADMIN', {
      email: 'tenant-a-owner@example.com',
      password: PW,
    });
    const resourceId = await seedResource(siteId);
    const orderA = await seedOrder(siteId, tenantAId, userAId, resourceId, 'tenant-a-order');
    const orderB = await seedOrder(siteId, tenantBId, userBId, resourceId, 'tenant-b-order');
    await seedFulfillmentTrace(siteId, orderA.id);
    const { orderId: otherSiteOrderId } = await seedOtherSiteOrder();

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'platform-orders@example.com', password: PW });
    const platformToken = await loginAs(request, 'platform-orders@example.com', PW, siteId);

    const platformRes = await request
      .get('/api/orders')
      .query({ tenantId: tenantAId, page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${platformToken}`);

    expect(platformRes.status).toBe(200);
    expect(platformRes.body.data.total).toBe(1);
    expect(platformRes.body.data.items.map((item: { id: string }) => item.id)).toContain(orderA.id);
    expect(platformRes.body.data.items.map((item: { id: string }) => item.id)).not.toContain(orderB.id);
    expect(platformRes.body.data.items.map((item: { id: string }) => item.id)).not.toContain(otherSiteOrderId);
    expect(platformRes.body.data.items[0]).toMatchObject({
      id: orderA.id,
      tenantId: tenantAId,
      tenantAdminId,
      tenantAdminEmail: 'tenant-a-owner@example.com',
      userId: userAId,
      userEmail: 'tenant-a-order@example.com',
      providerCode: 'IPIPD',
      upstreamOrderId: 'up-admin-order-1',
      failureStage: 'FAILED',
      failureError: 'provider_down',
      resource: {
        id: resourceId,
        code: expect.stringMatching(/^ADMIN_PAGE_/),
        name: 'Admin Page Resource',
        displayName: '管理端测试资源',
        providerCode: 'IPIPD',
      },
    });

    const tenantToken = await loginAs(request, 'tenant-a-owner@example.com', PW, siteId);

    const tenantRes = await request
      .get('/api/orders')
      .query({ tenantId: tenantBId, page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${tenantToken}`);

    expect(tenantRes.status).toBe(200);
    expect(tenantRes.body.data.total).toBe(1);
    expect(tenantRes.body.data.items[0].id).toBe(orderA.id);
  });

  it('admin order list searches real user, tenant, resource, and upstream fields', async () => {
    await prisma.tenants.update({
      where: { id: tenantAId },
      data: { name: 'Searchable Tenant Alpha' },
    });
    const { userId } = await seedUser(siteId, tenantAId, { email: 'search-order-buyer@example.com', password: PW });
    await seedUser(siteId, tenantBId, { email: 'hidden-order-buyer@example.com', password: PW });
    const resourceId = await seedResource(siteId);
    const order = await seedOrder(siteId, tenantAId, userId, resourceId, 'searchable-order');
    await seedFulfillmentTrace(siteId, order.id);
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'platform-order-search@example.com', password: PW });
    const token = await loginAs(request, 'platform-order-search@example.com', PW, siteId);

    const byEmail = await request
      .get('/api/orders')
      .query({ search: 'search-order-buyer', page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${token}`);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.total).toBe(1);
    expect(byEmail.body.data.items[0].id).toBe(order.id);

    const byResource = await request
      .get('/api/orders')
      .query({ search: '管理端测试资源', page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${token}`);
    expect(byResource.status).toBe(200);
    expect(byResource.body.data.items.map((item: { id: string }) => item.id)).toContain(order.id);

    const byUpstream = await request
      .get('/api/orders')
      .query({ search: 'up-admin-order-1', page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${token}`);
    expect(byUpstream.status).toBe(200);
    expect(byUpstream.body.data.items.map((item: { id: string }) => item.id)).toContain(order.id);

    const byTenant = await request
      .get('/api/orders')
      .query({ search: 'Searchable Tenant Alpha', page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${token}`);
    expect(byTenant.status).toBe(200);
    expect(byTenant.body.data.items.map((item: { id: string }) => item.id)).toContain(order.id);
  });

  it('USER cannot list admin users or audit logs', async () => {
    await seedUser(siteId, tenantAId, { email: 'plain-admin-page-user@example.com', password: PW });
    const token = await loginAs(request, 'plain-admin-page-user@example.com', PW, siteId);

    const usersRes = await request.get('/api/users').set('Authorization', `Bearer ${token}`);
    const auditRes = await request.get('/api/audit').set('Authorization', `Bearer ${token}`);

    expect(usersRes.status).toBe(403);
    expect(usersRes.body.code).toBe('PERMISSION_DENIED');
    expect(auditRes.status).toBe(403);
    expect(auditRes.body.code).toBe('PERMISSION_DENIED');
  });
});

async function seedResource(siteId: string): Promise<string> {
  const resource = await prisma.platform_resources.create({
    data: {
      siteId,
      type: 'COUNTRY',
      code: `ADMIN_PAGE_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: 'Admin Page Resource',
      displayName: '管理端测试资源',
      providerCode: 'IPIPD',
      ipType: 'NATIVE',
      protocol: 'HTTP',
      status: 'ACTIVE',
    },
  });
  return resource.id;
}

async function seedOrder(
  siteId: string,
  tenantId: string,
  userId: string,
  resourceId: string,
  idempotencyKey: string,
): Promise<{ id: string }> {
  return prisma.orders.create({
    data: {
      siteId,
      tenantId,
      userId,
      type: 'STATIC_PROXY_BUY',
      status: 'PENDING',
      resourceId,
      quantity: 1,
      durationDays: 30,
      unitPrice: '1',
      totalPrice: '1',
      currency: 'CNY',
      quoteSnapshot: {},
      idempotencyKey,
    },
    select: { id: true },
  });
}

async function seedFulfillmentTrace(siteId: string, orderId: string): Promise<void> {
  const job = await prisma.fulfillment_jobs.create({
    data: {
      siteId,
      orderId,
      providerCode: 'IPIPD',
      status: 'FAILED',
      attempts: 3,
      lastError: 'provider_down',
    },
  });
  await prisma.upstream_order_mirrors.create({
    data: {
      siteId,
      orderId,
      fulfillmentJobId: job.id,
      providerCode: 'IPIPD',
      upstreamOrderId: 'up-admin-order-1',
      status: 'FAILED',
    },
  });
}

async function seedOtherSiteOrder(): Promise<{ orderId: string }> {
  const otherSiteId = await seedSite();
  const otherTenantId = await seedTenant(otherSiteId);
  const { userId } = await seedUser(otherSiteId, otherTenantId, {
    email: `other-order-${Date.now()}@example.com`,
    password: PW,
  });
  const resourceId = await seedResource(otherSiteId);
  const order = await seedOrder(otherSiteId, otherTenantId, userId, resourceId, `other-order-${Date.now()}`);
  return { orderId: order.id };
}
