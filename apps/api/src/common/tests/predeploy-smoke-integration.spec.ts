import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedAdminUser,
  seedSite,
  seedTenant,
  seedUser,
  TestRequest,
} from '../../test-utils/integration-setup';
import { setupSwagger } from '../../modules/openapi/openapi-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;
let userId: string;

const PASSWORD = 'pw-12345';
const ADMIN_EMAIL = 'predeploy-smoke-admin@example.com';
const CUSTOMER_EMAIL = 'predeploy-smoke-customer@example.com';
const CURRENCY = 'CNY';

beforeAll(async () => {
  app = await createTestApp({ beforeInit: setupSwagger });
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
    email: CUSTOMER_EMAIL,
    password: PASSWORD,
    currency: CURRENCY,
  }));
});

describe('predeploy smoke', () => {
  it('covers health, readiness, OpenAPI, login, and the disabled legacy order boundary', async () => {
    const health = await request.get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.releaseGitSha).toMatch(/^[0-9a-f]{40}$/);

    const ready = await request.get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ok');
    expect(ready.body.checks).toEqual({ db: { ok: true }, redis: { ok: true } });

    const openApi = await request.get('/openapi.json');
    expect(openApi.status).toBe(200);
    expect(openApi.body.openapi).toBe('3.0.0');
    expect(openApi.body.paths['/api/orders/users/{userId}/static-proxy']).toBeTruthy();

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: ADMIN_EMAIL,
      password: PASSWORD,
    });

    const token = await loginAs(request, ADMIN_EMAIL, PASSWORD, siteId);

    const order = await request
      .post(`/api/orders/users/${userId}/static-proxy`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        resourceId: 'legacy-resource-not-used',
        quantity: 1,
        durationDays: 30,
        currency: CURRENCY,
        idempotencyKey: 'predeploy-smoke-disabled-static',
        reason: 'predeploy legacy route must remain disabled',
      });

    expect(order.status).toBe(410);
    expect(order.body).toMatchObject({
      code: 'PRODUCT_DISABLED',
      data: { reasonKey: 'static_proxy_purchase_disabled' },
    });

    const wallet = await request
      .get(`/api/wallet/${userId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.available).toBe('0');
    expect(wallet.body.data.currency).toBe(CURRENCY);

    const orders = await request
      .get('/api/orders')
      .query({ userId, page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${token}`);
    expect(orders.status).toBe(200);
    expect(orders.body.data.total).toBe(0);
  });
});
