import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { prisma } from '@ipeasy/db';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedSite,
  seedTenant,
  seedUser,
  type TestRequest,
} from '../../../test-utils/integration-setup';

const PASSWORD = 'DedicatedLineTest123!';
let app: NestFastifyApplication;
let request: TestRequest;

beforeAll(async () => {
  app = await createTestApp();
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('dedicated-line customer order API', () => {
  it('queues a scoped order without exposing provider routing fields', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, { email: 'line-api-user@example.com', password: PASSWORD });
    const account = await seedProviderAccount(siteId, tenantId);
    const sku = await seedSku(siteId, account.providerCode);
    await seedLinePrice(siteId, sku.id, '10');
    await prisma.wallets.update({ where: { userId }, data: { available: '25' } });
    await seedSnapshot(siteId, account.id, sku.id, 'HK:premium', 4);
    await seedPlacement(siteId, tenantId, sku.id, 2);
    const token = await loginAs(request, 'line-api-user@example.com', PASSWORD, siteId);

    const response = await request
      .post('/api/dedicated-line-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        skuCode: 'SV',
        countryCode: 'HK',
        quantity: 2,
        durationDays: 30,
        currency: 'CNY',
        idempotencyKey: 'api-order-1',
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'QUEUED',
      skuCode: 'SV',
      countryCode: 'HK',
      quantity: 2,
      replayed: false,
    });
    expect(response.body.data).not.toHaveProperty('providerAccountId');
    expect(response.body.data).not.toHaveProperty('providerResourceId');
    expect(response.body.data).toMatchObject({
      orderId: expect.any(String),
    });
    const job = await prisma.external_jobs.findFirstOrThrow({ where: { kind: 'PROVIDER_DEDICATED_LINE_ORDER' } });
    expect(job.payload).toMatchObject({
      providerAccountId: account.id,
      request: { providerResourceId: 'HK:premium', protocol: 'SOCKS5' },
    });
    expect((await prisma.wallets.findUniqueOrThrow({ where: { userId } })).available.toString()).toBe('5');
    expect(await prisma.ledger_entries.count({ where: { userId, type: 'DEBIT' } })).toBe(1);

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      unitPrice: string;
      totalPrice: string;
      currency: string;
      priceSource: string;
      contractVersion: number;
      dedicatedLineOrderId: string | null;
      reservationOrderId: string | null;
    }>>`
      SELECT
        order_row."id",
        order_row."unitPrice"::text AS "unitPrice",
        order_row."totalPrice"::text AS "totalPrice",
        order_row."currency",
        order_row."priceSource",
        order_row."contractVersion",
        job."dedicatedLineOrderId",
        reservation."dedicatedLineOrderId" AS "reservationOrderId"
      FROM "dedicated_line_orders" AS order_row
      JOIN "external_jobs" AS job ON job."dedicatedLineOrderId" = order_row."id"
      JOIN "stock_reservations" AS reservation ON reservation."dedicatedLineOrderId" = order_row."id"
      WHERE order_row."id" = ${response.body.data.orderId}
    `;
    expect(rows).toEqual([{
      id: response.body.data.orderId,
      unitPrice: '10.00000000',
      totalPrice: '20.00000000',
      currency: 'CNY',
      priceSource: 'SITE_DEFAULT_TEMPLATE',
      contractVersion: 1,
      dedicatedLineOrderId: response.body.data.orderId,
      reservationOrderId: response.body.data.orderId,
    }]);
  });

  it('does not debit or reserve stock when the wallet cannot cover the server quote', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    await seedUser(siteId, tenantId, { email: 'line-api-insufficient@example.com', password: PASSWORD });
    const account = await seedProviderAccount(siteId, tenantId);
    const sku = await seedSku(siteId, account.providerCode);
    await seedLinePrice(siteId, sku.id, '10');
    await seedSnapshot(siteId, account.id, sku.id, 'HK:premium', 4);
    await seedPlacement(siteId, tenantId, sku.id, 2);
    const token = await loginAs(request, 'line-api-insufficient@example.com', PASSWORD, siteId);

    const response = await request
      .post('/api/dedicated-line-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        skuCode: 'SV', countryCode: 'HK', quantity: 2, durationDays: 30, currency: 'CNY', idempotencyKey: 'api-order-insufficient',
      });

    expect(response.status).toBe(422);
    expect(response.body.data.reasonKey).toBe('wallet_insufficient_balance');
    expect(await prisma.stock_reservations.count()).toBe(0);
    expect(await prisma.external_jobs.count()).toBe(0);
    expect(await prisma.ledger_entries.count()).toBe(0);
  });

  it('replays a dedicated-line order without creating a second debit', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, { email: 'line-api-replay@example.com', password: PASSWORD });
    const account = await seedProviderAccount(siteId, tenantId);
    const sku = await seedSku(siteId, account.providerCode);
    await seedLinePrice(siteId, sku.id, '10');
    await prisma.wallets.update({ where: { userId }, data: { available: '25' } });
    await seedSnapshot(siteId, account.id, sku.id, 'HK:premium', 4);
    await seedPlacement(siteId, tenantId, sku.id, 2);
    const token = await loginAs(request, 'line-api-replay@example.com', PASSWORD, siteId);
    const body = { skuCode: 'SV', countryCode: 'HK', quantity: 2, durationDays: 30, currency: 'CNY', idempotencyKey: 'api-order-replay' };

    const first = await request.post('/api/dedicated-line-orders').set('Authorization', `Bearer ${token}`).send(body);
    const second = await request.post('/api/dedicated-line-orders').set('Authorization', `Bearer ${token}`).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ reservationId: first.body.data.reservationId, jobId: first.body.data.jobId, replayed: true });
    expect(await prisma.ledger_entries.count({ where: { userId, type: 'DEBIT' } })).toBe(1);
    expect((await prisma.wallets.findUniqueOrThrow({ where: { userId } })).available.toString()).toBe('5');
    expect(await prisma.dedicated_line_orders.count({ where: { userId } })).toBe(1);

    await prisma.sku_price_rules.updateMany({ where: { skuId: sku.id }, data: { unitPrice: '11' } });
    const changedQuoteReplay = await request.post('/api/dedicated-line-orders').set('Authorization', `Bearer ${token}`).send(body);
    expect(changedQuoteReplay.status).toBe(409);
    expect(changedQuoteReplay.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      data: { reasonKey: 'dedicated_line_order_idempotency_conflict' },
    });
    expect(await prisma.ledger_entries.count({ where: { userId, type: 'DEBIT' } })).toBe(1);
    expect(await prisma.dedicated_line_orders.count({ where: { userId } })).toBe(1);
  });

  it('returns an inventory error and Bark outbox when no fresh route exists', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    await seedUser(siteId, tenantId, { email: 'line-api-empty@example.com', password: PASSWORD });
    await prisma.service_skus.create({
      data: {
        siteId,
        code: 'SV',
        name: 'Short Video',
        capabilities: { delivery: 'dedicated-line' },
      },
    });
    const token = await loginAs(request, 'line-api-empty@example.com', PASSWORD, siteId);

    const response = await request
      .post('/api/dedicated-line-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        skuCode: 'SV',
        countryCode: 'HK',
        quantity: 1,
        durationDays: 30,
        currency: 'CNY',
        idempotencyKey: 'api-empty-1',
      });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'UPSTREAM_OUT_OF_STOCK',
      data: { reasonKey: 'dedicated_line_inventory_unavailable' },
    });
    expect(await prisma.external_jobs.count()).toBe(0);
    expect(await prisma.outbox_events.count({ where: { topic: 'alerts.bark.inventory_low' } })).toBe(1);
  });
});

async function seedProviderAccount(siteId: string, tenantId: string) {
  return prisma.provider_accounts.create({
    data: {
      siteId,
      tenantId,
      providerCode: 'NINE_EIGHT_FIVE',
      status: 'ACTIVE',
      credentialEncrypted: 'test-only',
      baseUrl: 'https://provider.invalid',
      inventorySyncEnabled: true,
    },
  });
}

async function seedSku(siteId: string, providerCode: string) {
  return prisma.service_skus.create({
    data: {
      siteId,
      code: 'SV',
      name: 'Short Video',
      capabilities: {
        delivery: 'dedicated-line',
        inventorySource: { providerCode, providerResourceIds: ['HK:premium'] },
      },
    },
  });
}

async function seedLinePrice(siteId: string, skuId: string, unitPrice: string) {
  const template = await prisma.price_templates.create({
    data: { siteId, name: 'Dedicated line test price', isDefault: true },
  });
  await prisma.sku_price_rules.create({
    data: { siteId, templateId: template.id, skuId, durationDays: 30, minQty: 1, unitPrice, currency: 'CNY' },
  });
}

async function seedSnapshot(siteId: string, providerAccountId: string, skuId: string, providerResourceId: string, quantity: number) {
  return prisma.dedicated_line_inventory_snapshots.create({
    data: {
      siteId,
      providerAccountId,
      skuId,
      providerCode: 'NINE_EIGHT_FIVE',
      countryCode: 'HK',
      providerResourceId,
      quantity,
      sourceVersion: `api-${Date.now()}`,
      capturedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

async function seedPlacement(siteId: string, tenantId: string, skuId: string, targetReplicaCount: number) {
  const group = await prisma.node_groups.create({
    data: { siteId, tenantId, code: 'hk-line', name: 'HK line nodes', regionCode: 'HK', isActive: true },
  });
  const nodeIds: string[] = [];
  for (let index = 0; index < targetReplicaCount; index += 1) {
    const node = await prisma.control_nodes.create({
      data: {
        siteId, tenantId, nodeGroupId: group.id, code: `hk-node-${index}`, name: `HK node ${index}`,
        regionCode: 'HK', baseUrl: `https://panel-${index}.example.com`, apiCredentialCiphertext: 'test-only',
        apiCredentialFingerprint: `fingerprint-${index}`, capacityUnits: 10,
      },
    });
    nodeIds.push(node.id);
  }
  const inbound = await prisma.inbound_profiles.create({
    data: {
      siteId, nodeGroupId: group.id, code: 'sv-hk-1', protocol: 'VLESS', inboundTag: 'sv-hk-1', listenPort: 60701,
      isActive: true,
    },
  });
  await prisma.line_placement_policies.create({
    data: {
      siteId, tenantId, skuId, nodeGroupId: group.id, inboundProfileId: inbound.id,
      targetReplicaCount, minReadyReplicaCount: 1, maxUnitsPerNode: 10, priority: 1,
      allowedNodes: { create: nodeIds.map((nodeId) => ({ siteId, nodeId })) },
    },
  });
  return nodeIds;
}
