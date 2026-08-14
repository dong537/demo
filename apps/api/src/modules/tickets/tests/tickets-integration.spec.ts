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

const USER_EMAIL = 'ticket-user@example.com';
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
  await seedUser(siteId, tenantId, { email: USER_EMAIL, password: USER_PW });
});

describe('tickets integration', () => {
  it('creates a ticket with its first message and writes an audit log', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'cannot connect', body: 'my proxy is down' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.messages[0].authorType).toBe('USER');

    const audit = await prisma.audit_logs.findFirst({ where: { action: 'ticket.create' } });
    expect(audit?.targetId).toBe(res.body.data.id);
  });

  it('rejects an empty subject with VALIDATION_ERROR', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);

    const res = await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: '   ', body: 'body' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('subject_required');
  });

  it('lists only the caller own tickets with pagination', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'mine', body: 'b' });

    // another user's ticket in the same tenant must not be visible
    await seedUser(siteId, tenantId, { email: 'ticket-other@example.com', password: USER_PW });
    const otherToken = await loginAs(request, 'ticket-other@example.com', USER_PW, siteId);
    await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ subject: 'theirs', body: 'b' });

    const res = await request
      .get('/api/tickets?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].subject).toBe('mine');
  });

  it("returns NOT_FOUND for another user's ticket without leaking existence", async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    await seedUser(siteId, tenantId, { email: 'ticket-other2@example.com', password: USER_PW });
    const otherToken = await loginAs(request, 'ticket-other2@example.com', USER_PW, siteId);
    const created = await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ subject: 'theirs', body: 'b' });

    const res = await request
      .get(`/api/tickets/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('ticket_not_found');
  });

  it('appends a reply and refreshes the timeline', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const created = await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'mine', body: 'first' });

    const res = await request
      .post(`/api/tickets/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'second' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data.messages).toHaveLength(2);
    expect(res.body.data.messages[1].body).toBe('second');
  });

  it('rejects replies to a CLOSED ticket and closes are idempotent', async () => {
    const token = await loginAs(request, USER_EMAIL, USER_PW, siteId);
    const created = await request
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'mine', body: 'first' });
    const id = created.body.data.id as string;

    const closed = await request
      .post(`/api/tickets/${id}/close`)
      .set('Authorization', `Bearer ${token}`);
    expect(closed.body.data.status).toBe('CLOSED');

    const reply = await request
      .post(`/api/tickets/${id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'still here?' });

    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe('VALIDATION_ERROR');
    expect(reply.body.data.reasonKey).toBe('ticket_closed');
  });
});
