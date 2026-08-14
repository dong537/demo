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
let tenantA: string;
let tenantB: string;

const PW = 'pw-12345';
const USER_A = 'admin-tickets-user-a@example.com';
const USER_B = 'admin-tickets-user-b@example.com';

async function openTicket(token: string, subject: string): Promise<string> {
  const res = await request
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ subject, body: 'first message' });
  return res.body.data.id as string;
}

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
  tenantA = await seedTenant(siteId);
  tenantB = await seedTenant(siteId);
  await seedUser(siteId, tenantA, { email: USER_A, password: PW });
  await seedUser(siteId, tenantB, { email: USER_B, password: PW });
});

describe('admin tickets integration', () => {
  it('PLATFORM_ADMIN lists tickets across all tenants in the site', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const tokenB = await loginAs(request, USER_B, PW, siteId);
    await openTicket(tokenA, 'from tenant A');
    await openTicket(tokenB, 'from tenant B');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'plat@example.com', password: PW });
    const adminToken = await loginAs(request, 'plat@example.com', PW, siteId);

    const res = await request
      .get('/api/admin/tickets?page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    const subjects = res.body.data.items.map((i: { subject: string }) => i.subject).sort();
    expect(subjects).toEqual(['from tenant A', 'from tenant B']);
    expect(res.body.data.items[0].userEmail).toBeTruthy();
  });

  it('TENANT_ADMIN only sees tickets in its own tenant', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const tokenB = await loginAs(request, USER_B, PW, siteId);
    await openTicket(tokenA, 'from tenant A');
    await openTicket(tokenB, 'from tenant B');

    await seedAdminUser(siteId, tenantA, 'TENANT_ADMIN', { email: 'ta@example.com', password: PW });
    const adminToken = await loginAs(request, 'ta@example.com', PW, siteId);

    const res = await request
      .get('/api/admin/tickets?page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].subject).toBe('from tenant A');
  });

  it('returns NOT_FOUND when TENANT_ADMIN reads a ticket outside its tenant', async () => {
    const tokenB = await loginAs(request, USER_B, PW, siteId);
    const ticketB = await openTicket(tokenB, 'from tenant B');

    await seedAdminUser(siteId, tenantA, 'TENANT_ADMIN', { email: 'ta2@example.com', password: PW });
    const adminToken = await loginAs(request, 'ta2@example.com', PW, siteId);

    const res = await request
      .get(`/api/admin/tickets/${ticketB}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('ticket_not_found');
  });

  it('admin reply writes an ADMIN_USER message and audits ticket.admin_reply', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'need help');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'plat2@example.com', password: PW });
    const adminToken = await loginAs(request, 'plat2@example.com', PW, siteId);

    const res = await request
      .post(`/api/admin/tickets/${ticketA}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'we are on it' });

    expect([200, 201]).toContain(res.status);
    const messages = res.body.data.messages as { authorType: string; body: string }[];
    expect(messages).toHaveLength(2);
    expect(messages[1].authorType).toBe('ADMIN_USER');
    expect(messages[1].body).toBe('we are on it');

    const audit = await prisma.audit_logs.findFirst({ where: { action: 'ticket.admin_reply' } });
    expect(audit?.actorType).toBe('ADMIN_USER');
    expect(audit?.targetId).toBe(ticketA);
  });

  it('admin reply to a CLOSED ticket re-opens it to PENDING', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'closing soon');
    await request
      .post(`/api/tickets/${ticketA}/close`)
      .set('Authorization', `Bearer ${tokenA}`);

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'plat3@example.com', password: PW });
    const adminToken = await loginAs(request, 'plat3@example.com', PW, siteId);

    const res = await request
      .post(`/api/admin/tickets/${ticketA}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'one more thing' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('PENDING');
  });

  it('admin status change updates status and audits ticket.status_change', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'status flow');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'plat4@example.com', password: PW });
    const adminToken = await loginAs(request, 'plat4@example.com', PW, siteId);

    const res = await request
      .post(`/api/admin/tickets/${ticketA}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLOSED' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('CLOSED');

    const audit = await prisma.audit_logs.findFirst({ where: { action: 'ticket.status_change' } });
    expect(audit?.targetId).toBe(ticketA);
  });

  it('rejects an invalid status value', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'bad status');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'plat5@example.com', password: PW });
    const adminToken = await loginAs(request, 'plat5@example.com', PW, siteId);

    const res = await request
      .post(`/api/admin/tickets/${ticketA}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ARCHIVED' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('invalid_ticket_status');
  });

  it('rejects USER callers on the admin surface with 403', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);

    const res = await request
      .get('/api/admin/tickets?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });
});
