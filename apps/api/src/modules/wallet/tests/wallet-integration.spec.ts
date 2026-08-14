/**
 * Wallet Integration Tests (real DB, real auth, real error propagation).
 *
 * Requires DATABASE_URL_TEST or DATABASE_URL pointing to a disposable
 * PostgreSQL test database.
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
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;

let siteId: string;
let tenantId: string;
let userId: string;
let walletId: string;

const USER_EMAIL = 'wallet-user@example.com';
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
  await prisma.$connect();
  await cleanDatabase();
  siteId = await seedSite();
  tenantId = await seedTenant(siteId);
  ({ userId, walletId } = await seedUser(siteId, tenantId, {
    email: USER_EMAIL,
    password: USER_PW,
    currency: 'CNY',
  }));
});

describe('wallet integration', () => {
  it('GET /api/wallet/:userId returns the real wallet balance', async () => {
    await prisma.wallets.update({
      where: { userId },
      data: { available: '123.45', frozen: '6.78' },
    });
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request.get(`/api/wallet/${userId}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      userId,
      available: '123.45',
      frozen: '6.78',
      currency: 'CNY',
    });
  });

  it('USER cannot read another user wallet', async () => {
    const otherTenantId = await seedTenant(siteId);
    const { userId: otherUserId } = await seedUser(siteId, otherTenantId, {
      email: 'wallet-other@example.com',
      password: USER_PW,
      currency: 'CNY',
    });
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request.get(`/api/wallet/${otherUserId}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('cannot_read_other_wallet');
  });

  it('ledger list returns real entries and page metadata', async () => {
    await prisma.ledger_entries.create({
      data: {
        siteId,
        tenantId,
        walletId,
        userId,
        type: 'DEPOSIT',
        amount: '25.00',
        balanceAfter: '25.00',
        currency: 'CNY',
        relatedId: 'manual-seed',
        reason: 'seed ledger',
        idempotencyKey: 'wallet-ledger-seed',
      },
    });
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .get(`/api/wallet/${userId}/ledger?page=1&pageSize=10&type=DEPOSIT`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(10);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      type: 'DEPOSIT',
      amount: '25',
      balanceAfter: '25',
      reason: 'seed ledger',
    });
  });

  it('wallet DB outage returns INTERNAL_ERROR instead of a default wallet', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    await renameTable('wallets', 'wallets_fault');
    try {
      const res = await request.get(`/api/wallet/${userId}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(res.body.data.reasonKey).toBe('internal_error');
      expect(res.body.data.available).toBeUndefined();
    } finally {
      await renameTable('wallets_fault', 'wallets');
    }
  });

  it('ledger DB outage returns INTERNAL_ERROR instead of an empty list', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    await renameTable('ledger_entries', 'ledger_entries_fault');
    try {
      const res = await request.get(`/api/wallet/${userId}/ledger`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(res.body.data.reasonKey).toBe('internal_error');
      expect(res.body.data.items).toBeUndefined();
    } finally {
      await renameTable('ledger_entries_fault', 'ledger_entries');
    }
  });
});

async function renameTable(from: string, to: string): Promise<void> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${from}" RENAME TO "${to}"`);
}
