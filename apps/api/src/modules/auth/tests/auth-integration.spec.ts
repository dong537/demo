/**
 * Auth + RBAC integration tests (real DB, real login, real assertions).
 *
 * Requires a real PostgreSQL test DB. Connection comes from DATABASE_URL,
 * injected by vitest.integration.config.ts from DATABASE_URL_TEST.
 */
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
  seedSession,
  loginAs,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;

const TENANTS_PATH = '/api/tenants';

let siteId: string;
let tenantId: string;

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
});

describe('auth + RBAC integration', () => {
  it('wrong password returns 401 AUTH_REQUIRED', async () => {
    await seedUser(siteId, tenantId, { email: 'wrongpw@example.com', password: 'correct-password' });

    const res = await request
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'WRONG-password', siteId });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(res.body.data.reasonKey).toBe('invalid_credentials');
  });

  it('unknown email uses the same invalid_credentials error as wrong password', async () => {
    await seedUser(siteId, tenantId, { email: 'known@example.com', password: 'correct-password' });

    const wrongPasswordRes = await request
      .post('/api/auth/login')
      .send({ email: 'known@example.com', password: 'WRONG-password', siteId });
    const unknownEmailRes = await request
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'WRONG-password', siteId });

    expect(wrongPasswordRes.status).toBe(401);
    expect(unknownEmailRes.status).toBe(401);
    expect(wrongPasswordRes.body.code).toBe('AUTH_REQUIRED');
    expect(unknownEmailRes.body.code).toBe('AUTH_REQUIRED');
    expect(wrongPasswordRes.body.data.reasonKey).toBe('invalid_credentials');
    expect(unknownEmailRes.body.data.reasonKey).toBe('invalid_credentials');
  });

  it('login returns an opaque session token once', async () => {
    await seedUser(siteId, tenantId, { email: 'login-ok@example.com', password: 'pw-12345' });

    const res = await request
      .post('/api/auth/login')
      .send({ email: 'login-ok@example.com', password: 'pw-12345', siteId });

    expect([200, 201]).toContain(res.status);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(0);

    const user = await prisma.users.findUniqueOrThrow({ where: { email: 'login-ok@example.com' } });
    const storedSession = await prisma.sessions.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(storedSession.token).not.toBe(res.body.data.token);
  });

  it('GET /auth/me returns current opaque-session owner context', async () => {
    const { userId } = await seedUser(siteId, tenantId, { email: 'me@example.com', password: 'pw-12345' });
    const token = await loginAs(request, 'me@example.com', 'pw-12345', siteId);

    const res = await request
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ownerId: userId,
      ownerType: 'USER',
      siteId,
      tenantId,
      scopes: [],
    });
  });

  it('register creates the customer under the requested reseller tenant', async () => {
    const resellerTenantId = await seedTenant(siteId);

    const res = await request
      .post('/api/auth/register')
      .send({
        email: 'reseller-signup@example.com',
        password: 'Customer123!',
        siteId,
        tenantId: resellerTenantId,
      });

    expect([200, 201]).toContain(res.status);
    const user = await prisma.users.findUniqueOrThrow({ where: { email: 'reseller-signup@example.com' } });
    expect(user.siteId).toBe(siteId);
    expect(user.tenantId).toBe(resellerTenantId);

    const wallet = await prisma.wallets.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.tenantId).toBe(resellerTenantId);

    const session = await prisma.sessions.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(session.tenantId).toBe(resellerTenantId);
  });

  it('register rejects a tenantId from another site', async () => {
    const otherSiteId = await seedSite();
    const otherTenantId = await seedTenant(otherSiteId);

    const res = await request
      .post('/api/auth/register')
      .send({
        email: 'wrong-tenant-signup@example.com',
        password: 'Customer123!',
        siteId,
        tenantId: otherTenantId,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.data.reasonKey).toBe('signup_tenant_invalid');
    const user = await prisma.users.findUnique({ where: { email: 'wrong-tenant-signup@example.com' } });
    expect(user).toBeNull();
  });

  it('USER cannot access a PLATFORM_ADMIN endpoint', async () => {
    await seedUser(siteId, tenantId, { email: 'plain-user@example.com', password: 'pw-12345' });
    const token = await loginAs(request, 'plain-user@example.com', 'pw-12345', siteId);

    const res = await request
      .post(TENANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'new-tenant', name: 'New Tenant' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('TENANT_ADMIN cannot read another tenant resource', async () => {
    const tenantBId = await seedTenant(siteId);

    await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', {
      email: 'tenant-a-admin@example.com',
      password: 'pw-12345',
    });
    const token = await loginAs(request, 'tenant-a-admin@example.com', 'pw-12345', siteId);

    const res = await request
      .get(`${TENANTS_PATH}/${tenantBId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('PLATFORM_ADMIN operation creates an audit log', async () => {
    const adminId = await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'platform-admin@example.com',
      password: 'pw-12345',
    });

    const token = await loginAs(request, 'platform-admin@example.com', 'pw-12345', siteId);

    const createRes = await request
      .post(TENANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'audited-tenant',
        name: 'Audited Tenant',
        adminEmail: 'audited-tenant-admin@example.com',
        adminPassword: 'AuditedTenant123',
      });
    expect([200, 201]).toContain(createRes.status);

    const logs = await prisma.audit_logs.findMany({ where: { actorId: adminId } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.actorType === 'ADMIN_USER' && l.action === 'auth.login')).toBe(true);
    expect(logs.some((l) => l.actorType === 'ADMIN_USER' && l.action === 'tenant.create')).toBe(true);
  });

  it('missing token cannot access protected endpoint', async () => {
    const res = await request.get(TENANTS_PATH);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('expired session cannot access protected endpoint', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'expired-session@example.com',
      password: 'pw-12345',
    });
    const { token } = await seedSession({
      ownerType: 'USER',
      ownerId: userId,
      siteId,
      tenantId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request.get(TENANTS_PATH).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(res.body.data.reasonKey).toBe('session_expired');
  });

  it('revoked session cannot access protected endpoint', async () => {
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'revoked-session@example.com',
      password: 'pw-12345',
    });
    const { token } = await seedSession({
      ownerType: 'USER',
      ownerId: userId,
      siteId,
      tenantId,
      revokedAt: new Date(),
    });

    const res = await request.get(TENANTS_PATH).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(res.body.data.reasonKey).toBe('session_expired');
  });
});
