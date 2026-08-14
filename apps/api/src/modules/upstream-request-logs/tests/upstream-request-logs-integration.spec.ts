import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma, Prisma } from '@ipeasy/db';
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

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let otherSiteId: string;
let tenantId: string;

const PW = 'pw-12345';

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
  otherSiteId = await seedSite();
  tenantId = await seedTenant(siteId);
});

async function seedLog(opts: {
  siteId: string;
  providerCode: string;
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
  createdAt?: Date;
  responseSummary?: Record<string, unknown>;
}): Promise<void> {
  await prisma.upstream_request_logs.create({
    data: {
      siteId: opts.siteId,
      providerCode: opts.providerCode,
      operation: 'buy',
      requestId: `req_${Math.random().toString(16).slice(2)}`,
      durationMs: 120,
      status: opts.status,
      responseSummary: opts.responseSummary
        ? (opts.responseSummary as Prisma.InputJsonValue)
        : undefined,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

describe('upstream request logs integration', () => {
  it('PLATFORM_ADMIN lists logs scoped to their own site only', async () => {
    await seedLog({ siteId, providerCode: 'IPIPD', status: 'SUCCESS' });
    await seedLog({ siteId, providerCode: 'PR', status: 'ERROR' });
    await seedLog({ siteId: otherSiteId, providerCode: 'IPIPD', status: 'SUCCESS' });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'logs-platform@example.com', password: PW });
    const token = await loginAs(request, 'logs-platform@example.com', PW, siteId);

    const res = await request
      .get('/api/upstream-request-logs')
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    for (const item of res.body.data.items) {
      expect(item.siteId).toBe(siteId);
    }
  });

  it('filters by providerCode and status', async () => {
    await seedLog({ siteId, providerCode: 'IPIPD', status: 'SUCCESS' });
    await seedLog({ siteId, providerCode: 'IPIPD', status: 'ERROR' });
    await seedLog({ siteId, providerCode: 'PR', status: 'ERROR' });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'logs-filter@example.com', password: PW });
    const token = await loginAs(request, 'logs-filter@example.com', PW, siteId);

    const res = await request
      .get('/api/upstream-request-logs')
      .query({ providerCode: 'IPIPD', status: 'ERROR' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].providerCode).toBe('IPIPD');
    expect(res.body.data.items[0].status).toBe('ERROR');
  });

  it('returns already-redacted response summary as stored', async () => {
    await seedLog({
      siteId,
      providerCode: 'IPIPD',
      status: 'SUCCESS',
      responseSummary: { token: '[REDACTED]', stock: 10 },
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'logs-redact@example.com', password: PW });
    const token = await loginAs(request, 'logs-redact@example.com', PW, siteId);

    const res = await request
      .get('/api/upstream-request-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].responseSummary).toEqual({ token: '[REDACTED]', stock: 10 });
  });

  it('rejects TENANT_ADMIN with 403', async () => {
    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', { email: 'logs-tenant@example.com', password: PW });
    const token = await loginAs(request, 'logs-tenant@example.com', PW, siteId);

    const res = await request
      .get('/api/upstream-request-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('rejects USER with 403', async () => {
    await seedUser(siteId, tenantId, { email: 'logs-user@example.com', password: PW });
    const token = await loginAs(request, 'logs-user@example.com', PW, siteId);

    const res = await request
      .get('/api/upstream-request-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request.get('/api/upstream-request-logs');
    expect(res.status).toBe(401);
  });
});
