/**
 * Legacy residential/static proxy order routes are intentionally disabled.
 * These tests use real PostgreSQL to prove the 410 boundary is fail-closed.
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
let userId: string;

const USER_EMAIL = 'disabled-static-buyer@example.com';
const USER_PW = 'pw-12345';
const PLATFORM_ADMIN_EMAIL = 'disabled-static-platform@example.com';
const TENANT_ADMIN_EMAIL = 'disabled-static-tenant@example.com';

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
  ({ userId } = await seedUser(siteId, tenantId, {
    email: USER_EMAIL,
    password: USER_PW,
    currency: 'CNY',
  }));
});

describe('disabled legacy static proxy order routes', () => {
  it('rejects customer and authenticated admin callers before any mutation', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: PLATFORM_ADMIN_EMAIL,
      password: USER_PW,
    });
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: TENANT_ADMIN_EMAIL,
      password: USER_PW,
    });
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const platformAdminToken = await loginAs(request, PLATFORM_ADMIN_EMAIL, USER_PW, siteId);
    const tenantAdminToken = await loginAs(request, TENANT_ADMIN_EMAIL, USER_PW, siteId);
    const body = {
      resourceId: 'legacy-resource-not-used',
      quantity: 1,
      durationDays: 30,
      currency: 'CNY',
      idempotencyKey: 'disabled-static-route',
      reason: 'legacy route must remain disabled',
    };

    for (const token of [userToken, platformAdminToken, tenantAdminToken]) {
      const response = await request
        .post(`/api/orders/users/${userId}/static-proxy`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(response.status).toBe(410);
      expect(response.body.code).toBe('PRODUCT_DISABLED');
      expect(response.body.data.reasonKey).toBe('static_proxy_purchase_disabled');
    }

    expect(await prisma.orders.count({ where: { userId } })).toBe(0);
    expect(await prisma.ledger_entries.count({ where: { userId } })).toBe(0);
    expect(await prisma.fulfillment_jobs.count()).toBe(0);
  });

  it('rejects the customer self-service static proxy route with the same reason', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const response = await request
      .post('/api/orders/static-proxy')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      code: 'PRODUCT_DISABLED',
      data: { reasonKey: 'static_proxy_purchase_disabled' },
    });
  });

  it('rejects the legacy customer resource quote route', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const response = await request
      .get('/api/pricing/quote')
      .query({ resourceId: 'legacy-resource-not-used', durationDays: 30, quantity: 1, currency: 'CNY' })
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      code: 'PRODUCT_DISABLED',
      data: { reasonKey: 'static_proxy_purchase_disabled' },
    });
  });
});
