/**
 * Payments + Wallet Integration Tests (real DB, real login, real assertions).
 *
 * Requires a real PostgreSQL test DB. Connection comes from DATABASE_URL,
 * injected by vitest.integration.config.ts from DATABASE_URL_TEST.
 *
 * Run with:
 *   DATABASE_URL_TEST=... pnpm --filter @ipeasy/api test:integration
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
  seedSession,
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let confirmEnabledApp: NestFastifyApplication;
let confirmEnabledRequest: TestRequest;

let siteId: string;
let tenantId: string;
let userId: string;

const USER_EMAIL = 'payer@example.com';
const USER_PW = 'pw-12345';
// Must match APP_PLATFORM_CURRENCY (CNY) injected by the integration config,
// because create-payment-order asserts dto.currency === platform currency.
const CURRENCY = 'CNY';

beforeAll(async () => {
  app = await createTestApp({ config: { PAYMENT_CONFIRMATION_ENABLED: 'false' } });
  request = supertest(app.getHttpServer());
  confirmEnabledApp = await createTestApp({ config: { PAYMENT_CONFIRMATION_ENABLED: 'true' } });
  confirmEnabledRequest = supertest(confirmEnabledApp.getHttpServer());
});

afterAll(async () => {
  await cleanDatabase();
  await confirmEnabledApp?.close();
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
  siteId = await seedSite();
  tenantId = await seedTenant(siteId);
  ({ userId } = await seedUser(siteId, tenantId, { email: USER_EMAIL, password: USER_PW, currency: CURRENCY }));
});

describe('payments + wallet integration', () => {
  it('USER session missing tenantId returns tenant_required and creates no payment order', async () => {
    const { token } = await seedSession({
      ownerType: 'USER',
      ownerId: userId,
      siteId,
      tenantId: null,
    });

    const res = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '100.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'missing-tenant' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('tenant_required');

    const orders = await prisma.payment_orders.findMany({ where: { userId } });
    expect(orders).toHaveLength(0);
  });

  it('platform admin can impersonate a customer and create a payment order with the customer tenant', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'impersonate-payment-admin@example.com',
      password: USER_PW,
    });
    const adminToken = await loginAs(request, 'impersonate-payment-admin@example.com', USER_PW, siteId);

    const impersonateRes = await request
      .post(`/api/users/${userId}/impersonate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect([200, 201]).toContain(impersonateRes.status);
    const impersonatedToken = impersonateRes.body.data.token as string;
    expect(impersonatedToken).toBeTruthy();

    const meRes = await request.get('/api/auth/me').set('Authorization', `Bearer ${impersonatedToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.ownerType).toBe('USER');
    expect(meRes.body.data.ownerId).toBe(userId);
    expect(meRes.body.data.tenantId).toBe(tenantId);

    const paymentRes = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${impersonatedToken}`)
      .send({ amount: '88.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'impersonated-payment' });

    expect([200, 201]).toContain(paymentRes.status);
    expect(paymentRes.body.data.status).toBe('PENDING');

    const order = await prisma.payment_orders.findUniqueOrThrow({
      where: { id: paymentRes.body.data.id as string },
    });
    expect(order.userId).toBe(userId);
    expect(order.tenantId).toBe(tenantId);
    expect(order.amount.toString()).toBe('88');
  });

  it('创建充值单：wallets.available 不变，payment_orders 新建 PENDING', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '100.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'k1' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('PENDING');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('0');

    const orders = await prisma.payment_orders.findMany({ where: { userId } });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('PENDING');
    expect(orders[0]!.amount.toString()).toBe('100');
  });

  it('同 idempotencyKey 重复创建 → 返回同一单', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const body = { amount: '50.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'dup-key' };

    const res1 = await request.post('/api/payments').set('Authorization', `Bearer ${token}`).send(body);
    const res2 = await request.post('/api/payments').set('Authorization', `Bearer ${token}`).send(body);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
    expect(res1.body.data.id).toBe(res2.body.data.id);

    const orders = await prisma.payment_orders.findMany({ where: { idempotencyKey: 'dup-key' } });
    expect(orders).toHaveLength(1);
  });

  it('不同用户复用 payment idempotencyKey 返回 IDEMPOTENCY_CONFLICT', async () => {
    const otherTenantId = await seedTenant(siteId);
    await seedUser(siteId, otherTenantId, {
      email: 'other-payer@example.com',
      password: USER_PW,
      currency: CURRENCY,
    });
    const token1 = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const token2 = await loginAs(request, 'other-payer@example.com', USER_PW, siteId);

    const body = { amount: '20.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'shared-payment-key' };
    const res1 = await request.post('/api/payments').set('Authorization', `Bearer ${token1}`).send(body);
    const res2 = await request.post('/api/payments').set('Authorization', `Bearer ${token2}`).send(body);

    expect([200, 201]).toContain(res1.status);
    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const orders = await prisma.payment_orders.findMany({ where: { idempotencyKey: 'shared-payment-key' } });
    expect(orders).toHaveLength(1);
  });

  it('PAYMENT_CONFIRMATION_ENABLED=false → confirm 返回 UPSTREAM_DISABLED', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    // USER creates a PENDING order.
    const createRes = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: '100.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'confirm-disabled' });
    expect([200, 201]).toContain(createRes.status);
    const orderId = createRes.body.data.id as string;

    // Platform admin attempts to confirm; gating runs before any work.
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'admin-confirm@example.com', password: USER_PW });
    const adminToken = await loginAs(request, 'admin-confirm@example.com', USER_PW, siteId);

    const res = await request
      .post(`/api/payments/${orderId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'manual confirm' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('UPSTREAM_DISABLED');

    // Wallet untouched, order still PENDING.
    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('0');
    const order = await prisma.payment_orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PENDING');
  });

  // PLATFORM_ADMIN confirms cross-tenant (tenantId null → no tenant scoping on
  // the order lookup); the audit log records the order's own tenantId.
  it('确认充值（PLATFORM_ADMIN 跨租户）→ wallet+ledger+payment_order 一致', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const createRes = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: '100.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'confirm-enabled' });
    const orderId = createRes.body.data.id as string;

    // PLATFORM_ADMIN has no tenant; it must still be able to confirm.
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'admin-ok@example.com', password: USER_PW });
    const adminToken = await loginAs(confirmEnabledRequest, 'admin-ok@example.com', USER_PW, siteId);

    const res = await confirmEnabledRequest
      .post(`/api/payments/${orderId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'manual confirm' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.order.status).toBe('COMPLETED');
    expect(res.body.data.wallet.available).toBe('100');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('100');
    const ledger = await prisma.ledger_entries.findMany({ where: { relatedId: orderId, type: 'DEPOSIT' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.balanceAfter.toString()).toBe('100');
    const order = await prisma.payment_orders.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('COMPLETED');
    // Audit log recorded under the order's tenant, not the (null) admin tenant.
    const audit = await prisma.audit_logs.findMany({ where: { targetId: orderId, action: 'payment_order.confirm' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.tenantId).toBe(tenantId);
    expect(audit[0]!.reason).toBe('manual confirm');
  });

  it('confirm 幂等：同 paymentOrderId 二次 confirm 不重复入账', async () => {
    const userToken = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const createRes = await request
      .post('/api/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: '25.00', currency: CURRENCY, channel: 'MANUAL', idempotencyKey: 'confirm-idempotent' });
    const orderId = createRes.body.data.id as string;

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'admin-idem@example.com', password: USER_PW });
    const adminToken = await loginAs(confirmEnabledRequest, 'admin-idem@example.com', USER_PW, siteId);

    const res1 = await confirmEnabledRequest.post(`/api/payments/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'first confirm' });
    const res2 = await confirmEnabledRequest.post(`/api/payments/${orderId}/confirm`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'second confirm' });

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
    expect(res2.body.data.order.status).toBe('COMPLETED');
    expect(res2.body.data.wallet.available).toBe('25');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('25');
    const ledger = await prisma.ledger_entries.findMany({ where: { relatedId: orderId, type: 'DEPOSIT' } });
    expect(ledger).toHaveLength(1);
  });

  it('USER 不能调用 /wallet/:userId/adjust → 403', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post(`/api/wallet/${userId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ direction: 'credit', amount: '10.00', currency: CURRENCY, reason: 'test', idempotencyKey: 'adj-1' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('0');
  });

  it('adjust 非平台币种返回 CURRENCY_NOT_SUPPORTED', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'adjust-currency@example.com', password: USER_PW });
    const adminToken = await loginAs(request, 'adjust-currency@example.com', USER_PW, siteId);

    const res = await request
      .post(`/api/wallet/${userId}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ direction: 'credit', amount: '10.00', currency: 'USD', reason: 'currency mismatch', idempotencyKey: 'adj-currency' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CURRENCY_NOT_SUPPORTED');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('0');
    const ledger = await prisma.ledger_entries.findMany({ where: { idempotencyKey: 'adj-currency' } });
    expect(ledger).toHaveLength(0);
  });

  it('debit 超出余额返回 WALLET_INSUFFICIENT_BALANCE', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'adjust-debit@example.com', password: USER_PW });
    const adminToken = await loginAs(request, 'adjust-debit@example.com', USER_PW, siteId);

    const res = await request
      .post(`/api/wallet/${userId}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ direction: 'debit', amount: '10.00', currency: CURRENCY, reason: 'too much', idempotencyKey: 'adj-overdraft' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WALLET_INSUFFICIENT_BALANCE');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId } });
    expect(wallet.available.toString()).toBe('0');
    const ledger = await prisma.ledger_entries.findMany({ where: { idempotencyKey: 'adj-overdraft' } });
    expect(ledger).toHaveLength(0);
  });

  it('TENANT_ADMIN 不能 adjust 其他 tenant 用户', async () => {
    const otherTenantId = await seedTenant(siteId);
    const { userId: otherUserId } = await seedUser(siteId, otherTenantId, {
      email: 'other-tenant-user@example.com',
      password: USER_PW,
      currency: CURRENCY,
    });
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', { email: 'tenant-admin-adjust@example.com', password: USER_PW });
    const tenantAdminToken = await loginAs(request, 'tenant-admin-adjust@example.com', USER_PW, siteId);

    const res = await request
      .post(`/api/wallet/${otherUserId}/adjust`)
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ direction: 'credit', amount: '10.00', currency: CURRENCY, reason: 'cross tenant', idempotencyKey: 'adj-cross-tenant' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SCOPE_VIOLATION');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: otherUserId } });
    expect(wallet.available.toString()).toBe('0');
  });

  it('PLATFORM_ADMIN 跨租户 adjust 写入 wallet、ledger 和 audit，重复请求不重复入账', async () => {
    const otherTenantId = await seedTenant(siteId);
    const { userId: otherUserId } = await seedUser(siteId, otherTenantId, {
      email: 'platform-target@example.com',
      password: USER_PW,
      currency: CURRENCY,
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'platform-adjust@example.com', password: USER_PW });
    const adminToken = await loginAs(request, 'platform-adjust@example.com', USER_PW, siteId);

    const body = { direction: 'credit', amount: '15.00', currency: CURRENCY, reason: 'manual topup', idempotencyKey: 'adj-platform-cross' };
    const res1 = await request.post(`/api/wallet/${otherUserId}/adjust`).set('Authorization', `Bearer ${adminToken}`).send(body);
    const res2 = await request.post(`/api/wallet/${otherUserId}/adjust`).set('Authorization', `Bearer ${adminToken}`).send(body);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
    expect(res2.body.data.available).toBe('15');

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: otherUserId } });
    expect(wallet.available.toString()).toBe('15');
    const ledger = await prisma.ledger_entries.findMany({ where: { walletId: wallet.id, type: 'ADJUSTMENT' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount.toString()).toBe('15');
    expect(ledger[0]!.tenantId).toBe(otherTenantId);

    const audit = await prisma.audit_logs.findMany({ where: { targetId: wallet.id, action: 'wallet.adjust' } });
    expect(audit).toHaveLength(2);
    expect(audit.every((entry) => entry.tenantId === otherTenantId)).toBe(true);
  });

  it('不存在的钱包流水请求返回 NOT_FOUND，不返回空列表', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'ledger-missing@example.com', password: USER_PW });
    const adminToken = await loginAs(request, 'ledger-missing@example.com', USER_PW, siteId);

    const res = await request
      .get('/api/wallet/00000000-0000-0000-0000-000000000000/ledger')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('wallet_not_found');
    expect(res.body.data.items).toBeUndefined();
  });
});
