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
  seedProxy,
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

const ENCRYPTION_KEY = process.env['APP_ENCRYPTION_KEY'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;
let userId: string;

const USER_EMAIL = 'proxycheck-user@example.com';
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
  ({ userId } = await seedUser(siteId, tenantId, { email: USER_EMAIL, password: USER_PW }));
});

describe('proxy-check integration', () => {
  it('rejects a missing proxyId with VALIDATION_ERROR', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/proxy-check')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('proxy_id_required');
  });

  it('returns NOT_FOUND when probing a proxy owned by another user', async () => {
    const { userId: otherUserId } = await seedUser(siteId, tenantId, {
      email: 'proxycheck-other@example.com',
      password: USER_PW,
    });
    const { proxyId } = await seedProxy({
      siteId,
      tenantId,
      userId: otherUserId,
      encryptionKey: ENCRYPTION_KEY,
    });
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/proxy-check')
      .set('Authorization', `Bearer ${token}`)
      .send({ proxyId });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('proxy_not_found');
  });

  it('probes an owned proxy, returns an unreachable result without leaking credentials, and writes an audit row', async () => {
    const { proxyId } = await seedProxy({
      siteId,
      tenantId,
      userId,
      encryptionKey: ENCRYPTION_KEY,
      // A closed loopback port fails immediately and does not depend on the CI
      // runner's external routing or firewall timeout behavior.
      ip: '127.0.0.1',
      port: 1,
      username: 'secret-user',
      password: 'secret-pass',
    });
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/proxy-check')
      .set('Authorization', `Bearer ${token}`)
      .send({ proxyId });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.reachable).toBe(false);
    expect(res.body.data.error).toEqual({
      code: 'PROXY_UNREACHABLE',
      reasonKey: 'proxy_unreachable',
    });
    // never leak the proxy credentials/connection info
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toContain('secret-pass');
    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('127.0.0.1');

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'proxy.check', targetId: proxyId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  }, 20000);
});
