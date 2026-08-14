/**
 * Payment and wallet site-scope regression tests.
 *
 * PLATFORM_ADMIN can cross tenants inside the current site, but must not reach
 * resources in another site by global ids.
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

const ADMIN_PW = 'pw-12345';
const CURRENCY = 'CNY';

beforeAll(async () => {
  app = await createTestApp({ config: { PAYMENT_CONFIRMATION_ENABLED: 'true' } });
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
    email: 'site-scope-user@example.com',
    password: ADMIN_PW,
    currency: CURRENCY,
  }));
});

describe('payment and wallet site scope', () => {
  it('PLATFORM_ADMIN payment list is scoped to the current site', async () => {
    const visibleOrder = await prisma.payment_orders.create({
      data: {
        siteId,
        tenantId,
        userId,
        amount: '10.00',
        currency: CURRENCY,
        channel: 'MANUAL',
        status: 'PENDING',
        idempotencyKey: 'site-visible-payment',
      },
    });
    const { paymentOrderId: hiddenOrderId } = await seedOtherSitePaymentOrder();
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'payment-list-site-admin@example.com',
      password: ADMIN_PW,
    });
    const adminToken = await loginAs(request, 'payment-list-site-admin@example.com', ADMIN_PW, siteId);

    const res = await request.get('/api/payments?page=1&pageSize=20').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toContain(visibleOrder.id);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).not.toContain(hiddenOrderId);
  });

  it('PLATFORM_ADMIN cannot confirm another site payment order', async () => {
    const { paymentOrderId, userId: otherUserId } = await seedOtherSitePaymentOrder();
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'confirm-site-admin@example.com',
      password: ADMIN_PW,
    });
    const adminToken = await loginAs(request, 'confirm-site-admin@example.com', ADMIN_PW, siteId);

    const res = await request
      .post(`/api/payments/${paymentOrderId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'cross site confirm' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: otherUserId } });
    expect(wallet.available.toString()).toBe('0');
    const order = await prisma.payment_orders.findUniqueOrThrow({ where: { id: paymentOrderId } });
    expect(order.status).toBe('PENDING');
  });

  it('PLATFORM_ADMIN cannot adjust another site wallet', async () => {
    const { userId: otherUserId } = await seedOtherSitePaymentOrder();
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'adjust-site-admin@example.com',
      password: ADMIN_PW,
    });
    const adminToken = await loginAs(request, 'adjust-site-admin@example.com', ADMIN_PW, siteId);

    const res = await request
      .post(`/api/wallet/${otherUserId}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ direction: 'credit', amount: '10.00', currency: CURRENCY, reason: 'cross site', idempotencyKey: 'adj-cross-site' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('wallet_not_found');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: otherUserId } });
    expect(wallet.available.toString()).toBe('0');
    const ledger = await prisma.ledger_entries.findMany({ where: { idempotencyKey: 'adj-cross-site' } });
    expect(ledger).toHaveLength(0);
  });
});

async function seedOtherSitePaymentOrder(): Promise<{ paymentOrderId: string; userId: string }> {
  const otherSiteId = await seedSite();
  const otherTenantId = await seedTenant(otherSiteId);
  const { userId: otherUserId } = await seedUser(otherSiteId, otherTenantId, {
    email: `other-site-${Date.now()}@example.com`,
    password: ADMIN_PW,
    currency: CURRENCY,
  });
  const order = await prisma.payment_orders.create({
    data: {
      siteId: otherSiteId,
      tenantId: otherTenantId,
      userId: otherUserId,
      amount: '20.00',
      currency: CURRENCY,
      channel: 'MANUAL',
      status: 'PENDING',
      idempotencyKey: `other-site-payment-${Date.now()}`,
    },
  });
  return { paymentOrderId: order.id, userId: otherUserId };
}
