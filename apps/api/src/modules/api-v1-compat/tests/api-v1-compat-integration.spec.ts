import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { prisma } from '@ipeasy/db';
import type { EnvConfig } from '../../../common/config/env.schema';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import {
  cleanDatabase,
  createTestApp,
  seedSite,
  seedTenant,
  seedUser,
  type TestRequest,
} from '../../../test-utils/integration-setup';

const PASSWORD = 'LegacyCompatTest123!';
const TEST_AES_HEX = '0123456789abcdef'.repeat(4);
const config: Partial<EnvConfig> = {
  LEGACY_API_V1_ENABLED: 'true',
  LEGACY_API_SITE_ID: '',
};

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;

beforeAll(async () => {
  app = await createTestApp({ config });
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
  config.LEGACY_API_SITE_ID = siteId;
});

describe('legacy /api/v1 compatibility API', () => {
  it('returns frozen-frontend capabilities as an unwrapped response', async () => {
    const response = await request.get('/api/v1/settings/capabilities');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      residentialUiEnabled: false,
      residentialPurchaseEnabled: false,
      dedicatedUiEnabled: true,
      dedicatedPurchaseEnabled: true,
      selfServiceRechargeEnabled: false,
    });
    expect(response.body).not.toHaveProperty('data');
    expect(response.body).not.toHaveProperty('requestId');
  });

  it('logs in without siteId, separates refresh tokens, and rotates refresh sessions', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'legacy-login@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    await prisma.wallets.update({ where: { userId }, data: { available: '125.50' } });

    const login = await request.post('/api/v1/auth/login').send({
      email: 'legacy-login@example.com',
      password: PASSWORD,
    });

    expect([200, 201]).toContain(login.status);
    expect(login.body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.stringMatching(/^rt_[0-9a-f]+$/),
      user: { id: userId, email: 'legacy-login@example.com', role: 'user', balance: '125.5', currency: 'CNY' },
    });
    expect(login.body).not.toHaveProperty('data');

    const storedTokens = await prisma.sessions.findMany({ where: { ownerId: userId }, select: { token: true } });
    expect(storedTokens).toHaveLength(2);
    expect(storedTokens.map((item) => item.token)).toContain(hashToken(login.body.access_token));
    expect(storedTokens.map((item) => item.token)).toContain(hashToken(login.body.refresh_token));

    const refreshAsBearer = await request
      .get('/api/v1/users/profile')
      .set('Authorization', `Bearer ${login.body.refresh_token}`);
    expect(refreshAsBearer.status).toBe(401);
    expect(refreshAsBearer.body).toMatchObject({
      statusCode: 401,
      errorCode: 'AUTH_REQUIRED',
      message: 'refresh_token_not_allowed',
      path: '/api/v1/users/profile',
    });

    const refreshed = await request.post('/api/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect([200, 201]).toContain(refreshed.status);
    expect(refreshed.body.access_token).not.toBe(login.body.access_token);
    expect(refreshed.body.refresh_token).not.toBe(login.body.refresh_token);

    const replay = await request.post('/api/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ statusCode: 401, errorCode: 'AUTH_REQUIRED', message: 'refresh_token_expired' });
  });

  it('quotes a dedicated SKU with real catalog and wallet data', async () => {
    await seedUser(siteId, tenantId, { email: 'legacy-quote@example.com', password: PASSWORD, currency: 'CNY' });
    const sku = await seedDedicatedSku(siteId);
    await seedLinePrice(siteId, sku.id, '12.50');
    const token = await loginLegacy('legacy-quote@example.com');

    const skus = await request.get('/api/v1/dedicated-skus').set('Authorization', `Bearer ${token}`);
    expect(skus.status).toBe(200);
    expect(skus.body).toEqual([
      expect.objectContaining({ code: 'SV', name: 'Short Video Dedicated Line', protocols: ['vless', 'vmess'] }),
    ]);

    const preview = await request
      .post('/api/v1/dedicated/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuCode: 'SV', durationDays: 30, country: 'HK', protocol: 'vless' });
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({
      sku: { code: 'SV', name: 'Short Video Dedicated Line' },
      country: 'HK',
      protocol: 'vless',
      durationDays: 30,
      chargeAmount: '12.5',
      finalPrice: '12.5',
      currency: 'CNY',
    });
  });

  it('rejects purchase before provider ordering when fresh dedicated inventory is absent', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'legacy-empty@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    await prisma.wallets.update({ where: { userId }, data: { available: '100' } });
    await seedDedicatedSku(siteId);
    const token = await loginLegacy('legacy-empty@example.com');

    const response = await request
      .post('/api/v1/dedicated/purchase-v2')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'legacy-empty-1')
      .send({ skuCode: 'SV', durationDays: 30, country: 'HK', protocol: 'vless' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      errorCode: 'UPSTREAM_OUT_OF_STOCK',
      message: 'dedicated_line_inventory_unavailable',
      path: '/api/v1/dedicated/purchase-v2',
    });
    expect(await prisma.dedicated_line_orders.count()).toBe(0);
    expect(await prisma.external_jobs.count()).toBe(0);
    expect(await prisma.outbox_events.count({ where: { topic: 'alerts.bark.inventory_low' } })).toBe(1);
  });

  it('projects a scoped UUID line through a stable numeric legacy ID and persists its remark', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'legacy-line@example.com',
      password: PASSWORD,
      currency: 'CNY',
    });
    const sku = await seedDedicatedSku(siteId);
    const group = await prisma.node_groups.create({
      data: { siteId, tenantId, code: 'legacy-hk', name: 'Legacy HK', regionCode: 'HK' },
    });
    const inbound = await prisma.inbound_profiles.create({
      data: {
        siteId,
        nodeGroupId: group.id,
        code: 'legacy-sv',
        protocol: 'VLESS',
        inboundTag: 'legacy-sv-1',
        listenPort: 60701,
      },
    });
    const line = await prisma.dedicated_lines.create({
      data: {
        siteId,
        tenantId,
        userId,
        skuId: sku.id,
        inboundProfileId: inbound.id,
        status: 'ACTIVE',
        countryCode: 'HK',
        protocol: 'VLESS',
        clientEmail: 'legacy-line@365proxy.internal',
        clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: 'legacy-client-id' }), TEST_AES_HEX),
        clientIdentityFingerprint: 'legacy-client-fingerprint',
        expiresAt: new Date('2026-09-15T00:00:00.000Z'),
        idempotencyKey: 'legacy-line-1',
      },
    });
    const token = await loginLegacy('legacy-line@example.com');

    expect(Number.isSafeInteger(line.legacyId)).toBe(true);
    const listed = await request.get('/api/v1/dedicated/my').set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: line.legacyId,
        proxyId: line.legacyId,
        orderNo: line.id,
        skuCode: 'SV',
        country: 'HK',
        protocol: 'vless',
        status: 'active',
        clientUuid: 'legacy-client-id',
      }),
    ]);

    const remark = await request
      .patch(`/api/v1/dedicated/${line.legacyId}/remark`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remark: 'customer migration note' });
    expect(remark.status).toBe(200);
    expect(remark.body).toEqual({ id: line.legacyId, remark: 'customer migration note' });
    expect((await prisma.dedicated_lines.findUniqueOrThrow({ where: { id: line.id } })).legacyRemark)
      .toBe('customer migration note');
  });
});

async function loginLegacy(email: string): Promise<string> {
  const response = await request.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect([200, 201]).toContain(response.status);
  return response.body.access_token as string;
}

async function seedDedicatedSku(currentSiteId: string) {
  return prisma.service_skus.create({
    data: {
      siteId: currentSiteId,
      code: 'SV',
      name: 'Short Video Dedicated Line',
      capabilities: { delivery: 'dedicated-line', supportedProtocols: ['VLESS', 'VMESS'] },
    },
  });
}

async function seedLinePrice(currentSiteId: string, skuId: string, unitPrice: string): Promise<void> {
  const template = await prisma.price_templates.create({
    data: { siteId: currentSiteId, name: 'Legacy API test pricing', isDefault: true },
  });
  await prisma.sku_price_rules.create({
    data: {
      siteId: currentSiteId,
      templateId: template.id,
      skuId,
      durationDays: 30,
      minQty: 1,
      unitPrice,
      currency: 'CNY',
    },
  });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
