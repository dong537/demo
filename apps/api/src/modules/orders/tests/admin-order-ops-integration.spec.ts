/**
 * Admin order operation integration tests.
 *
 * These tests use a real PostgreSQL test DB. They verify that manual order
 * operations keep orders, fulfillment jobs, wallet ledgers, and audit rows in
 * sync instead of faking a successful admin action.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma, FulfillmentJobStatus, OrderStatus } from '@ipeasy/db';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
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
let userId: string;
let walletId: string;
let resourceId: string;

const USER_EMAIL = 'admin-order-user@example.com';
const ADMIN_EMAIL = 'admin-order-admin@example.com';
const TENANT_ADMIN_EMAIL = 'admin-order-tenant-admin@example.com';
const USER_PW = 'pw-12345';
const CURRENCY = 'CNY';

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
  ({ userId, walletId } = await seedUser(siteId, tenantId, {
    email: USER_EMAIL,
    password: USER_PW,
    currency: CURRENCY,
  }));
  resourceId = await seedResource();
});

describe('admin order operations', () => {
  it('platform admin retries an unrefunded failed order by creating a new queued fulfillment job', async () => {
    const adminToken = await loginAsPlatformAdmin();
    const orderId = await seedOrder({ status: 'FAILED', jobStatus: 'FAILED', failReason: 'provider_down' });

    const res = await request
      .post(`/api/orders/${orderId}/retry-fulfillment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'retry after provider recovery' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('PENDING');

    const order = await prisma.orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PENDING');
    expect(order.failReason).toBeNull();

    const jobs = await prisma.fulfillment_jobs.findMany({ where: { orderId } });
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((job) => job.status === 'QUEUED')).toHaveLength(1);

    const audit = await prisma.audit_logs.findMany({
      where: { targetId: orderId, action: 'order.retry_fulfillment' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.tenantId).toBe(tenantId);
  });

  it('refunds a failed order once and turns repeated refund calls into ledger idempotency', async () => {
    await prisma.wallets.update({ where: { id: walletId }, data: { available: new Decimal('70') } });
    const adminToken = await loginAsPlatformAdmin();
    const orderId = await seedOrder({ status: 'FAILED', jobStatus: 'FAILED', failReason: 'upstream_failed' });
    const body = { reason: 'customer refund' };

    const res1 = await request.post(`/api/orders/${orderId}/refund`).set('Authorization', `Bearer ${adminToken}`).send(body);
    const res2 = await request.post(`/api/orders/${orderId}/refund`).set('Authorization', `Bearer ${adminToken}`).send(body);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
    expect(res2.body.data.status).toBe('REFUNDED');
    expect(res2.body.data.wallet.available).toBe('100');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.available.toString()).toBe('100');

    const refunds = await prisma.ledger_entries.findMany({ where: { relatedId: orderId, type: 'REFUND' } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amount.toString()).toBe('30');

    const order = await prisma.orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('REFUNDED');
    expect(order.failReason).toBe('customer refund');
  });

  it('tenant admin cannot operate another tenant order', async () => {
    const otherTenantId = await seedTenant(siteId);
    const { userId: otherUserId } = await seedUser(siteId, otherTenantId, {
      email: 'admin-order-other@example.com',
      password: USER_PW,
      currency: CURRENCY,
    });
    const orderId = await seedOrder({
      status: 'FAILED',
      jobStatus: 'FAILED',
      tenantId: otherTenantId,
      userId: otherUserId,
      failReason: 'cross tenant',
    });
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', { email: TENANT_ADMIN_EMAIL, password: USER_PW });
    const tenantAdminToken = await loginAs(request, TENANT_ADMIN_EMAIL, USER_PW, siteId);

    const res = await request
      .post(`/api/orders/${orderId}/refund`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ reason: 'not allowed' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const order = await prisma.orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('FAILED');
  });

  it('user cannot call admin retry operation', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const orderId = await seedOrder({ status: 'FAILED', jobStatus: 'FAILED', failReason: 'provider_down' });

    const res = await request
      .post(`/api/orders/${orderId}/retry-fulfillment`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'user retry' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');

    const jobs = await prisma.fulfillment_jobs.findMany({ where: { orderId } });
    expect(jobs).toHaveLength(1);
  });

  it('manual completion requires a reason and completes the latest fulfillment job', async () => {
    const adminToken = await loginAsPlatformAdmin();
    const orderId = await seedOrder({ status: 'PENDING', jobStatus: 'QUEUED' });

    const missingReason = await request
      .post(`/api/orders/${orderId}/manual-complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(missingReason.status).toBe(400);
    expect(missingReason.body.code).toBe('VALIDATION_ERROR');

    const res = await request
      .post(`/api/orders/${orderId}/manual-complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'manual upstream completion' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('COMPLETED');

    const order = await prisma.orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('COMPLETED');

    const job = await prisma.fulfillment_jobs.findFirstOrThrow({ where: { orderId } });
    expect(job.status).toBe('COMPLETED');

    const audit = await prisma.audit_logs.findMany({
      where: { targetId: orderId, action: 'order.manual_complete' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe('manual upstream completion');
  });

  it('returns fulfillment detail with order operation audit logs', async () => {
    const adminToken = await loginAsPlatformAdmin();
    const orderId = await seedOrder({ status: 'FAILED', jobStatus: 'FAILED', failReason: 'provider_down' });
    await prisma.audit_logs.create({
      data: {
        siteId,
        tenantId,
        actorType: 'ADMIN_USER',
        actorId: 'admin-1',
        targetType: 'orders',
        targetId: orderId,
        action: 'order.admin_create',
        reason: 'assisted purchase',
        requestId: 'req-order-detail',
        meta: { targetUserId: userId },
      },
    });

    const res = await request
      .get(`/api/orders/${orderId}/fulfillment`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.taskStatus).toBe('FAILED');
    expect(res.body.data.operationLogs).toEqual([
      expect.objectContaining({
        action: 'order.admin_create',
        actorType: 'ADMIN_USER',
        actorId: 'admin-1',
        reason: 'assisted purchase',
        requestId: 'req-order-detail',
      }),
    ]);
  });
});

async function loginAsPlatformAdmin(): Promise<string> {
  await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: ADMIN_EMAIL, password: USER_PW });
  return loginAs(request, ADMIN_EMAIL, USER_PW, siteId);
}

async function seedResource(): Promise<string> {
  const resource = await prisma.platform_resources.create({
    data: {
      siteId,
      providerCode: 'IPIPD',
      type: 'COUNTRY',
      code: `JP-${randomUUID()}`,
      name: 'Japan',
      ipType: 'NATIVE',
      protocol: 'BOTH',
      status: 'ACTIVE',
      isSaleable: true,
      isVisible: true,
    },
  });
  return resource.id;
}

async function seedOrder(opts: {
  status: OrderStatus;
  jobStatus: FulfillmentJobStatus;
  tenantId?: string;
  userId?: string;
  failReason?: string;
}): Promise<string> {
  const idempotencyKey = `admin-order-${randomUUID()}`;
  const order = await prisma.orders.create({
    data: {
      id: randomUUID(),
      siteId,
      tenantId: opts.tenantId ?? tenantId,
      userId: opts.userId ?? userId,
      resourceId,
      type: 'STATIC_PROXY_BUY',
      status: opts.status,
      quantity: 1,
      durationDays: 30,
      unitPrice: '30',
      totalPrice: '30',
      currency: CURRENCY,
      quoteSnapshot: { source: 'admin-order-ops-test' },
      idempotencyKey,
      failReason: opts.failReason,
    },
  });
  await prisma.fulfillment_jobs.create({
    data: {
      id: randomUUID(),
      siteId,
      orderId: order.id,
      providerCode: 'IPIPD',
      status: opts.jobStatus,
      attempts: opts.jobStatus === 'FAILED' ? 3 : 0,
      maxAttempts: 3,
      lastError: opts.failReason,
      scheduledAt: new Date(),
      completedAt: opts.jobStatus === 'FAILED' ? new Date() : null,
    },
  });
  return order.id;
}
