import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
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
const USER_A = 'notif-user-a@example.com';
const USER_B = 'notif-user-b@example.com';

async function openTicket(token: string, subject: string): Promise<string> {
  const res = await request
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ subject, body: 'first message' });
  return res.body.data.id as string;
}

async function adminReply(adminToken: string, ticketId: string, body: string): Promise<void> {
  await request
    .post(`/api/admin/tickets/${ticketId}/messages`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ body });
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

describe('notifications integration', () => {
  it('admin ticket reply produces a ticket_reply notification for the ticket owner', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'cannot connect');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat@example.com', PW, siteId);
    await adminReply(adminToken, ticketA, 'we are looking into it');

    const list = await request
      .get('/api/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);
    const item = list.body.data.items[0];
    expect(item.type).toBe('ticket_reply');
    expect(item.title).toBe('cannot connect');
    expect(item.relatedType).toBe('ticket');
    expect(item.relatedId).toBe(ticketA);
    expect(item.readAt).toBeNull();
  });

  it('a user only sees their own notifications', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const tokenB = await loginAs(request, USER_B, PW, siteId);
    const ticketA = await openTicket(tokenA, 'A issue');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat2@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat2@example.com', PW, siteId);
    await adminReply(adminToken, ticketA, 'reply to A');

    const listB = await request
      .get('/api/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listB.status).toBe(200);
    expect(listB.body.data.total).toBe(0);
  });

  it('unread-count reflects produced notifications and read-all clears it', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticket1 = await openTicket(tokenA, 'first');
    const ticket2 = await openTicket(tokenA, 'second');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat3@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat3@example.com', PW, siteId);
    await adminReply(adminToken, ticket1, 'reply one');
    await adminReply(adminToken, ticket2, 'reply two');

    const before = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(before.body.data.count).toBe(2);

    const readAll = await request
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`);
    expect([200, 201]).toContain(readAll.status);

    const after = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(after.body.data.count).toBe(0);
  });

  it('marking one notification read is scoped and idempotent', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const ticketA = await openTicket(tokenA, 'mark me');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat4@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat4@example.com', PW, siteId);
    await adminReply(adminToken, ticketA, 'a reply');

    const list = await request
      .get('/api/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenA}`);
    const notifId = list.body.data.items[0].id as string;

    const first = await request
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect([200, 201]).toContain(first.status);

    // idempotent: marking again still succeeds
    const second = await request
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect([200, 201]).toContain(second.status);

    const count = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(count.body.data.count).toBe(0);
  });

  it('returns NOT_FOUND when marking a notification owned by another user', async () => {
    const tokenA = await loginAs(request, USER_A, PW, siteId);
    const tokenB = await loginAs(request, USER_B, PW, siteId);
    const ticketA = await openTicket(tokenA, 'owned by A');

    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat5@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat5@example.com', PW, siteId);
    await adminReply(adminToken, ticketA, 'reply');

    const list = await request
      .get('/api/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenA}`);
    const notifId = list.body.data.items[0].id as string;

    const res = await request
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.data.reasonKey).toBe('notification_not_found');
  });

  it('rejects admin callers on the customer notifications surface with 403', async () => {
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: 'notif-plat6@example.com', password: PW });
    const adminToken = await loginAs(request, 'notif-plat6@example.com', PW, siteId);

    const res = await request
      .get('/api/notifications?page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });
});
