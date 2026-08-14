import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import {
  createTestApp,
  cleanDatabase,
  seedApiKey,
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

const USER_EMAIL = 'apikey-user@example.com';
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
  tenantId = await seedTenant(siteId);
  ({ userId } = await seedUser(siteId, tenantId, {
    email: USER_EMAIL,
    password: USER_PW,
  }));
});

describe('api key integration', () => {
  it('enforces dedicated read scopes on the dedicated OpenAPI', async () => {
    await prisma.service_skus.create({
      data: {
        siteId,
        code: 'SV',
        name: 'Short Video Dedicated Line',
        capabilities: { delivery: 'dedicated-line' },
      },
    });
    const deniedKey = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['dedicated:wallet:read'],
    });
    const denied = await request
      .get('/api/openapi/dedicated/skus')
      .set('apikey', deniedKey.plainKey);
    expect(denied.status).toBe(403);
    expect(denied.body.data.reasonKey).toBe('insufficient_scope');

    const allowedKey = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['dedicated:catalog:read'],
    });
    const allowed = await request
      .get('/api/openapi/dedicated/skus')
      .set('apikey', allowedKey.plainKey);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual([
      expect.objectContaining({ code: 'SV', name: 'Short Video Dedicated Line' }),
    ]);
  });

  it('creates an API key and stores only its hash', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId, name: 'Order automation', scopes: ['res_static:*'], ipWhitelist: [] });

    expect([200, 201]).toContain(res.status);
    expect(typeof res.body.data.plainKey).toBe('string');
    expect(res.body.data.keyPrefix).toBe(res.body.data.plainKey.slice(0, 8));

    const apiKey = await prisma.api_keys.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(res.body.data.name).toBe('Order automation');
    expect(apiKey.name).toBe('Order automation');
    expect(apiKey.keyHash).not.toBe(res.body.data.plainKey);
    expect(apiKey.keyPrefix).toBe(res.body.data.plainKey.slice(0, 8));
  });

  it('USER cannot create an API key for another tenant', async () => {
    const otherTenantId = await seedTenant(siteId);
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: otherTenantId, name: 'Other tenant', scopes: ['res_static:*'] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('insufficient_permissions');
  });

  it('rejects API key requests when IP whitelist does not match', async () => {
    const { plainKey } = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['tenant:read'],
      ipWhitelist: ['203.0.113.10'],
    });

    const res = await request.get('/api/tenants').set('apikey', plainKey);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('ip_not_whitelisted');
  });

  it('revoked API keys cannot authenticate', async () => {
    const { plainKey, apiKeyId } = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['tenant:read'],
    });
    await prisma.api_keys.update({
      where: { id: apiKeyId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const res = await request.get('/api/tenants').set('apikey', plainKey);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(res.body.data.reasonKey).toBe('invalid_api_key');
  });

  it('lists only the caller own keys without leaking sensitive fields', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      name: 'Visible key',
      scopes: ['res_static:*'],
    });

    // another user's key in the same tenant must not be visible
    const { userId: otherUserId } = await seedUser(siteId, tenantId, {
      email: 'apikey-other@example.com',
      password: USER_PW,
    });
    await seedApiKey({
      siteId,
      tenantId,
      ownerId: otherUserId,
      ownerType: 'USER',
      scopes: ['res_static:*'],
    });

    const res = await request
      .get('/api/api-keys?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(10);
    expect(res.body.data.items).toHaveLength(1);

    const item = res.body.data.items[0];
    expect(item.ownerId).toBe(undefined);
    expect(item.keyHash).toBe(undefined);
    expect(item.plainKey).toBe(undefined);
    expect(item).toHaveProperty('id');
    expect(item.name).toBe('Visible key');
    expect(item).toHaveProperty('keyPrefix');
    expect(item).toHaveProperty('scopes');
    expect(item).toHaveProperty('ipWhitelist');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('lastUsedAt');
    expect(item).toHaveProperty('revokedAt');
  });

  it('paginates the API key list', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    for (let i = 0; i < 3; i += 1) {
      await seedApiKey({
        siteId,
        tenantId,
        ownerId: userId,
        ownerType: 'USER',
        scopes: ['res_static:*'],
      });
    }

    const res = await request
      .get('/api/api-keys?page=1&pageSize=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items).toHaveLength(2);
  });
});
