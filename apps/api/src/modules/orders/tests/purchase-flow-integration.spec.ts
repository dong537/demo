/**
 * The historical residential purchase flow is retired in favor of dedicated
 * line SKU ordering. Keep one real integration assertion for the old quote
 * route so it cannot silently become a second customer purchase path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createTestApp,
  cleanDatabase,
  seedSite,
  seedTenant,
  seedUser,
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;

const USER_EMAIL = 'retired-residential-buyer@example.com';
const USER_PW = 'pw-12345';

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
  const tenantId = await seedTenant(siteId);
  await seedUser(siteId, tenantId, {
    email: USER_EMAIL,
    password: USER_PW,
    currency: 'CNY',
  });
});

describe('retired residential purchase flow', () => {
  it('rejects the legacy customer quote route before reading resource or pricing state', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const response = await request
      .get('/api/pricing/quote')
      .query({ resourceId: 'legacy-resource', durationDays: 30, quantity: 1, currency: 'CNY' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      code: 'PRODUCT_DISABLED',
      data: { reasonKey: 'static_proxy_purchase_disabled' },
    });
  });
});
