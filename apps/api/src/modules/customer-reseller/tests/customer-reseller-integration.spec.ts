import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedSite,
  seedTenant,
  seedUser,
  type TestRequest,
} from '../../../test-utils/integration-setup';

const PASSWORD = 'Password123';

describe('customer reseller integration', () => {
  it('stores reseller-owned federated credentials encrypted and never echoes them', async () => {
    await seedUser(siteId, tenantId, {
      email: 'reseller-federation-owner@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerToken = await loginAs(request, 'reseller-federation-owner@example.com', PASSWORD, siteId);
    const createTenantRes = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Federated Sub-site', code: 'federated-sub-site' });
    const ownedTenantId = createTenantRes.body.data.tenant.id as string;

    const createRes = await request
      .post('/api/customer/reseller/upstream-connections')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        kind: 'PLATFORM_365',
        name: 'Main 365 platform',
        baseUrl: 'https://upstream.example.com',
        credentials: { apiKey: 'federation-secret-key' },
      });
    expect(createRes.status, JSON.stringify(createRes.body)).toBe(201);
    expect(JSON.stringify(createRes.body.data)).not.toContain('federation-secret-key');
    expect(createRes.body.data).toMatchObject({
      kind: 'PLATFORM_365',
      name: 'Main 365 platform',
      credentialConfigured: true,
      status: 'ACTIVE',
    });

    const stored = await prisma.federated_upstream_connections.findUniqueOrThrow({
      where: { id: createRes.body.data.id as string },
    });
    expect(stored.tenantId).toBe(ownedTenantId);
    expect(stored.credentialEncrypted).not.toContain('federation-secret-key');

    const duplicateRes = await request
      .post('/api/customer/reseller/upstream-connections')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        kind: 'PLATFORM_365',
        name: 'Main 365 platform',
        baseUrl: 'https://other-upstream.example.com',
        credentials: { apiKey: 'another-secret-key' },
      });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      data: { reasonKey: 'federated_upstream_name_taken' },
    });

    await prisma.federated_upstream_scans.create({
      data: {
        siteId,
        tenantId: ownedTenantId,
        connectionId: stored.id,
        status: 'SUCCESS',
        balanceAmount: new Decimal('88.5'),
        balanceUnit: 'CNY',
        inventory: [{ countryCode: 'HK', providerResourceId: 'private-resource-id' }],
        prices: [{ skuCode: 'SV', unitPrice: '28' }],
        capturedAt: new Date('2026-08-11T10:00:00.000Z'),
        expiresAt: new Date('2026-08-11T10:05:00.000Z'),
      },
    });

    const listRes = await request
      .get('/api/customer/reseller/upstream-connections')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items).toHaveLength(1);
    expect(listRes.body.data.items[0].lastScan).toMatchObject({
      status: 'SUCCESS',
      balanceAmount: '88.5',
      balanceUnit: 'CNY',
      inventoryCount: 1,
      priceCount: 1,
    });
    expect(JSON.stringify(listRes.body.data)).not.toContain('federation-secret-key');
    expect(JSON.stringify(listRes.body.data)).not.toContain('credentialEncrypted');
    expect(JSON.stringify(listRes.body.data)).not.toContain('private-resource-id');
  });

  let app: NestFastifyApplication;
  let request: TestRequest;
  let siteId: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    request = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    siteId = await seedSite();
    tenantId = await seedTenant(siteId);
  });

  it('lets a user create an owned sub-site and then create a real sub-site customer', async () => {
    await seedUser(siteId, tenantId, {
      email: 'reseller-owner@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerToken = await loginAs(request, 'reseller-owner@example.com', PASSWORD, siteId);

    const createTenantRes = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner Sub-site', code: 'owner-sub-site' });
    expect(createTenantRes.status).toBe(201);
    const ownedTenantId = createTenantRes.body.data.tenant.id as string;

    const createUserRes = await request
      .post('/api/customer/reseller/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'sub-customer@example.com', password: PASSWORD });
    expect(createUserRes.status).toBe(201);
    expect(createUserRes.body.data).toMatchObject({
      email: 'sub-customer@example.com',
      tenantId: ownedTenantId,
    });

    const storedUser = await prisma.users.findUniqueOrThrow({
      where: { email: 'sub-customer@example.com' },
      include: { wallets: true },
    });
    expect(storedUser.tenantId).toBe(ownedTenantId);
    expect(storedUser.wallets).toHaveLength(1);
    expect(storedUser.wallets[0].currency).toBe('CNY');

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { action: 'reseller.user.create', targetId: storedUser.id },
    });
    expect(audit.actorType).toBe('USER');
    expect(audit.tenantId).toBe(ownedTenantId);
  });

  it('lets a reseller sell only enabled dedicated-line SKUs to sub-site customers', async () => {
    await seedUser(siteId, tenantId, {
      email: 'reseller-owner@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerToken = await loginAs(request, 'reseller-owner@example.com', PASSWORD, siteId);
    const sku = await seedDedicatedLineSku(siteId);

    const createTenantRes = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner Sub-site', code: 'owner-products' });
    expect(createTenantRes.status).toBe(201);
    const ownedTenantId = createTenantRes.body.data.tenant.id as string;

    const productsBefore = await request
      .get('/api/customer/reseller/products')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(productsBefore.status).toBe(200);
    expect(productsBefore.body.data.items[0]).toMatchObject({
      skuId: sku.id,
      code: 'SV',
      enabled: false,
      unitPrice: null,
    });
    expect(productsBefore.body.data.items[0]).not.toHaveProperty('providerAccountId');
    expect(productsBefore.body.data.items[0]).not.toHaveProperty('providerCode');
    expect(productsBefore.body.data.items[0]).not.toHaveProperty('exit');

    const createUserRes = await request
      .post('/api/customer/reseller/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'sub-customer@example.com', password: PASSWORD });
    expect(createUserRes.status).toBe(201);
    const customerToken = await loginAs(request, 'sub-customer@example.com', PASSWORD, siteId);

    const hiddenBefore = await request
      .get('/api/catalog/skus')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(hiddenBefore.status).toBe(200);
    expect(hiddenBefore.body.data).toHaveLength(0);

    const saveProduct = await request
      .post('/api/customer/reseller/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ skuId: sku.id, enabled: true, unitPrice: '28.00', currency: 'CNY' });
    expect(saveProduct.status).toBe(201);

    const productsAfter = await request
      .get('/api/customer/reseller/products')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(productsAfter.body.data.items[0]).toMatchObject({
      skuId: sku.id,
      enabled: true,
      unitPrice: '28',
      currency: 'CNY',
    });
    expect(productsAfter.body.data.items[0]).not.toHaveProperty('providerAccountId');
    expect(productsAfter.body.data.items[0]).not.toHaveProperty('providerCode');
    expect(productsAfter.body.data.items[0]).not.toHaveProperty('exit');

    const visibleAfter = await request
      .get('/api/catalog/skus')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(visibleAfter.status).toBe(200);
    expect(visibleAfter.body.data).toEqual([
      expect.objectContaining({ id: sku.id, code: 'SV' }),
    ]);

    const quote = await request
      .get('/api/catalog/quote')
      .query({ skuCode: 'SV', durationDays: 30, quantity: 1, currency: 'CNY' })
      .set('Authorization', `Bearer ${customerToken}`);
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({
      skuId: sku.id,
      unitPrice: '28',
      totalPrice: '28',
      priceSource: 'TENANT_DEFAULT_TEMPLATE',
    });
    expect(quote.body.data).not.toHaveProperty('providerAccountId');
    expect(quote.body.data).not.toHaveProperty('exit');

    const tenantDefault = await prisma.price_templates.findFirstOrThrow({
      where: { siteId, tenantId: ownedTenantId, isDefault: true },
      include: { sku_price_rules: true },
    });
    expect(tenantDefault.sku_price_rules).toHaveLength(1);
    expect(tenantDefault.sku_price_rules[0].skuId).toBe(sku.id);
    expect(tenantDefault.sku_price_rules[0].durationDays).toBe(30);
    expect(tenantDefault.sku_price_rules[0].unitPrice.toString()).toBe('28');

    const disableProduct = await request
      .post('/api/customer/reseller/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ skuId: sku.id, enabled: false });
    expect(disableProduct.status).toBe(201);

    const hiddenAfter = await request
      .get('/api/catalog/skus')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(hiddenAfter.status).toBe(200);
    expect(hiddenAfter.body.data).toHaveLength(0);

    const disabledQuote = await request
      .get('/api/catalog/quote')
      .query({ skuCode: 'SV', durationDays: 30, quantity: 1, currency: 'CNY' })
      .set('Authorization', `Bearer ${customerToken}`);
    expect(disabledQuote.status).toBe(422);
    expect(disabledQuote.body).toMatchObject({ code: 'PRICE_MISSING', data: { reasonKey: 'no_sku_price_rule' } });
  });

  it('lets a reseller adjust a sub-site customer wallet with ledger and audit records', async () => {
    await seedUser(siteId, tenantId, {
      email: 'reseller-owner@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerToken = await loginAs(request, 'reseller-owner@example.com', PASSWORD, siteId);

    const createTenantRes = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner Sub-site', code: 'owner-wallet' });
    expect(createTenantRes.status).toBe(201);
    const ownedTenantId = createTenantRes.body.data.tenant.id as string;

    const createUserRes = await request
      .post('/api/customer/reseller/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'sub-wallet-customer@example.com', password: PASSWORD });
    expect(createUserRes.status).toBe(201);
    const customerId = createUserRes.body.data.id as string;

    const adjustRes = await request
      .post(`/api/customer/reseller/users/${customerId}/wallet-adjust`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        direction: 'credit',
        amount: '88.50',
        currency: 'CNY',
        reason: 'reseller manual top-up',
        idempotencyKey: 'reseller-adjust-1',
      });
    expect(adjustRes.status).toBe(201);
    expect(adjustRes.body.data).toMatchObject({
      userId: customerId,
      available: '88.5',
      currency: 'CNY',
    });

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: customerId } });
    expect(wallet.tenantId).toBe(ownedTenantId);
    expect(wallet.available.toString()).toBe('88.5');

    const ledger = await prisma.ledger_entries.findUniqueOrThrow({
      where: { idempotencyKey: 'reseller-adjust-1' },
    });
    expect(ledger.walletId).toBe(wallet.id);
    expect(ledger.type).toBe('ADJUSTMENT');
    expect(ledger.amount.toString()).toBe('88.5');
    expect(ledger.reason).toBe('reseller manual top-up');

    const audit = await prisma.audit_logs.findFirstOrThrow({
      where: { action: 'reseller.wallet.adjust', targetId: wallet.id },
    });
    expect(audit.actorType).toBe('USER');
    expect(audit.tenantId).toBe(ownedTenantId);
    expect(audit.reason).toBe('reseller manual top-up');
  });

  it('lists only tenant-scoped dedicated-line orders with immutable prices and no provider credentials', async () => {
    await seedUser(siteId, tenantId, {
      email: 'reseller-orders-owner@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerToken = await loginAs(request, 'reseller-orders-owner@example.com', PASSWORD, siteId);
    const createTenantRes = await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Order Sub-site', code: 'order-sub-site' });
    const ownedTenantId = createTenantRes.body.data.tenant.id as string;
    const createUserRes = await request
      .post('/api/customer/reseller/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'reseller-order-customer@example.com', password: PASSWORD });
    const customerId = createUserRes.body.data.id as string;

    const sku = await seedDedicatedLineSku(siteId);
    await request
      .post('/api/customer/reseller/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ skuId: sku.id, enabled: true, unitPrice: '28', currency: 'CNY' })
      .expect(201);
    await prisma.wallets.update({ where: { userId: customerId }, data: { available: '100' } });
    await seedResellerOrderInfrastructure(siteId, ownedTenantId, sku.id);
    const customerToken = await loginAs(request, 'reseller-order-customer@example.com', PASSWORD, siteId);
    const orderRes = await request
      .post('/api/dedicated-line-orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        skuCode: 'SV',
        countryCode: 'HK',
        quantity: 2,
        durationDays: 30,
        currency: 'CNY',
        idempotencyKey: 'reseller-dedicated-order-1',
      });
    expect(orderRes.status).toBe(201);

    const listRes = await request
      .get('/api/customer/reseller/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toMatchObject({
      total: 1,
      items: [{
        id: orderRes.body.data.orderId,
        userId: customerId,
        user: { email: 'reseller-order-customer@example.com' },
        sku: { code: 'SV', name: 'Short Video Dedicated Line' },
        countryCode: 'HK',
        quantity: 2,
        durationDays: 30,
        unitPrice: '28',
        totalPrice: '56',
        currency: 'CNY',
        priceSource: 'TENANT_DEFAULT_TEMPLATE',
        execution: { status: 'QUEUED' },
        lineStatuses: {},
      }],
    });
    const serialized = JSON.stringify(listRes.body.data);
    expect(serialized).not.toContain('providerAccountId');
    expect(serialized).not.toContain('providerCode');
    expect(serialized).not.toContain('providerResourceId');
    expect(serialized).not.toContain('credential');
    expect(await prisma.orders.count()).toBe(0);
  });

  it('prevents a reseller from adjusting another sub-site customer wallet', async () => {
    await seedUser(siteId, tenantId, {
      email: 'owner-a@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    await seedUser(siteId, tenantId, {
      email: 'owner-b@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const ownerAToken = await loginAs(request, 'owner-a@example.com', PASSWORD, siteId);
    const ownerBToken = await loginAs(request, 'owner-b@example.com', PASSWORD, siteId);

    await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner A Sub-site', code: 'owner-a-wallet' })
      .expect(201);
    await request
      .post('/api/tenants/self-service')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ name: 'Owner B Sub-site', code: 'owner-b-wallet' })
      .expect(201);

    const createUserRes = await request
      .post('/api/customer/reseller/users')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ email: 'owner-a-customer@example.com', password: PASSWORD });
    expect(createUserRes.status).toBe(201);
    const customerId = createUserRes.body.data.id as string;

    const denied = await request
      .post(`/api/customer/reseller/users/${customerId}/wallet-adjust`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        direction: 'credit',
        amount: '10',
        currency: 'CNY',
        reason: 'cross tenant attempt',
        idempotencyKey: 'cross-tenant-adjust',
      });
    expect(denied.status).toBe(404);

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: customerId } });
    expect(wallet.available.toString()).toBe('0');
    const ledger = await prisma.ledger_entries.findUnique({ where: { idempotencyKey: 'cross-tenant-adjust' } });
    expect(ledger).toBeNull();
  });
});

async function seedDedicatedLineSku(siteId: string) {
  const sku = await prisma.service_skus.create({
    data: {
      siteId,
      code: 'SV',
      name: 'Short Video Dedicated Line',
      capabilities: { delivery: 'dedicated-line' },
    },
  });
  const defaultTemplate = await prisma.price_templates.create({
    data: { siteId, tenantId: null, name: 'Main Default', isDefault: true },
  });
  await prisma.sku_price_rules.create({
    data: {
      siteId,
      templateId: defaultTemplate.id,
      skuId: sku.id,
      durationDays: 30,
      unitPrice: new Decimal('18.00'),
      currency: 'CNY',
      minQty: 1,
    },
  });
  return sku;
}

async function seedResellerOrderInfrastructure(siteId: string, tenantId: string, skuId: string) {
  const provider = await prisma.provider_accounts.create({
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
  await prisma.service_skus.update({
    where: { id: skuId },
    data: {
      capabilities: {
        delivery: 'dedicated-line',
        inventorySource: { providerCode: provider.providerCode, providerResourceIds: ['HK:reseller'] },
      },
    },
  });
  await prisma.dedicated_line_inventory_snapshots.create({
    data: {
      siteId,
      providerAccountId: provider.id,
      skuId,
      providerCode: provider.providerCode,
      countryCode: 'HK',
      providerResourceId: 'HK:reseller',
      quantity: 5,
      sourceVersion: 'reseller-order-inventory-v1',
      capturedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const group = await prisma.node_groups.create({
    data: { siteId, tenantId, code: 'reseller-hk', name: 'Reseller HK', regionCode: 'HK', isActive: true },
  });
  const node = await prisma.control_nodes.create({
    data: {
      siteId,
      tenantId,
      nodeGroupId: group.id,
      code: 'reseller-hk-1',
      name: 'Reseller HK 1',
      regionCode: 'HK',
      baseUrl: 'https://panel.invalid',
      apiCredentialCiphertext: 'test-only',
      apiCredentialFingerprint: 'reseller-order-node',
      capacityUnits: 10,
    },
  });
  const inbound = await prisma.inbound_profiles.create({
    data: {
      siteId,
      nodeGroupId: group.id,
      controlNodeId: node.id,
      code: 'reseller-sv',
      protocol: 'VLESS',
      inboundTag: 'reseller-sv',
      listenPort: 60701,
      isActive: true,
    },
  });
  await prisma.line_placement_policies.create({
    data: {
      siteId,
      tenantId,
      skuId,
      nodeGroupId: group.id,
      inboundProfileId: inbound.id,
      targetReplicaCount: 1,
      minReadyReplicaCount: 1,
      maxUnitsPerNode: 10,
      priority: 1,
      allowedNodes: { create: [{ siteId, nodeId: node.id }] },
    },
  });
}
