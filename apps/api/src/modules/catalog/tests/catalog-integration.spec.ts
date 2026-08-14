import Decimal from 'decimal.js';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const PASSWORD = 'CatalogTest123!';

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

describe('dedicated-line catalog API', () => {
  it('returns a scoped SKU contract and price without exposing internal site ownership', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    await seedUser(siteId, tenantId, {
      email: 'catalog-user@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const sku = await prisma.service_skus.create({
      data: {
        siteId,
        code: 'SV',
        name: 'Short Video Dedicated Line',
        capabilities: { delivery: 'dedicated-line', supportedProtocols: ['VLESS', 'VMESS'] },
      },
    });
    await prisma.service_skus.create({
      data: {
        siteId,
        code: 'RES',
        name: 'Legacy residential',
        capabilities: { delivery: 'residential' },
      },
    });
    const template = await prisma.price_templates.create({
      data: { siteId, tenantId: null, name: 'Default line pricing', isDefault: true },
    });
    await prisma.sku_price_rules.create({
      data: {
        siteId,
        templateId: template.id,
        skuId: sku.id,
        durationDays: 30,
        minQty: 1,
        unitPrice: new Decimal('12.50'),
        currency: 'CNY',
      },
    });
    const token = await loginAs(request, 'catalog-user@example.com', PASSWORD, siteId);

    const catalog = await request.get('/api/catalog/skus').set('Authorization', `Bearer ${token}`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.data).toEqual([
      expect.objectContaining({ code: 'SV', contractVersion: 1, isActive: true, isVisible: true }),
    ]);
    expect(catalog.body.data[0]).not.toHaveProperty('siteId');

    const quote = await request
      .get('/api/catalog/quote')
      .query({ skuCode: 'SV', durationDays: 30, quantity: 2, currency: 'CNY' })
      .set('Authorization', `Bearer ${token}`);
    expect(quote.status).toBe(200);
    expect(quote.body.data).toMatchObject({
      skuId: sku.id,
      skuCode: 'SV',
      unitPrice: '12.5',
      totalPrice: '25',
      priceSource: 'SITE_DEFAULT_TEMPLATE',
    });
  });

  it('rejects an admin quote when the target user is outside the requested tenant', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const otherTenantId = await seedTenant(siteId);
    const { userId: otherUserId } = await seedUser(siteId, otherTenantId, {
      email: 'catalog-other-user@example.com',
      password: PASSWORD,
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'catalog-admin@example.com',
      password: PASSWORD,
    });
    const token = await loginAs(request, 'catalog-admin@example.com', PASSWORD, siteId);

    const quote = await request
      .get('/api/catalog/admin/quote')
      .query({
        tenantId,
        userId: otherUserId,
        skuCode: 'SV',
        durationDays: 30,
        quantity: 1,
        currency: 'CNY',
      })
      .set('Authorization', `Bearer ${token}`);

    expect(quote.status).toBe(404);
    expect(quote.body).toMatchObject({
      code: 'NOT_FOUND',
      data: { reasonKey: 'user_not_found' },
    });
  });
});
