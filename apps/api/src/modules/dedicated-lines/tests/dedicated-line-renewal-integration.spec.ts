import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { prisma } from '@ipeasy/db';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { randomBytes } from 'node:crypto';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedSite,
  seedTenant,
  seedUser,
  type TestRequest,
} from '../../../test-utils/integration-setup';

const PASSWORD = 'synthetic-dedicated-line-renewal-password';
const KEY = randomBytes(32).toString('hex');
let app: NestFastifyApplication;
let request: TestRequest;

beforeAll(async () => {
  app = await createTestApp({ config: { APP_ENCRYPTION_KEY: KEY } });
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('dedicated-line renewal API', () => {
  it('charges once, advances projection version, and replays idempotently', async () => {
    const fixture = await seedLineFixture();
    const token = await loginAs(request, 'renewal@example.com', PASSWORD, fixture.siteId);
    const body = { durationDays: 10, idempotencyKey: 'renewal-1' };

    const first = await request.post(`/api/dedicated-lines/${fixture.lineId}/renew`).set('Authorization', `Bearer ${token}`).send(body);
    const second = await request.post(`/api/dedicated-lines/${fixture.lineId}/renew`).set('Authorization', `Bearer ${token}`).send(body);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toMatchObject({ lineId: fixture.lineId, status: 'PROVISIONING', desiredVersion: 2, replayed: false, charged: { amount: '10', currency: 'CNY' } });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ lineId: fixture.lineId, desiredVersion: 2, replayed: true });
    expect((await prisma.wallets.findUniqueOrThrow({ where: { userId: fixture.userId } })).available.toString()).toBe('90');
    expect(await prisma.ledger_entries.count({ where: { userId: fixture.userId, type: 'RENEWAL' } })).toBe(1);
    expect(await prisma.external_jobs.count({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION', dedicatedLineId: fixture.lineId } })).toBe(1);
    expect(await prisma.dedicated_line_projections.findFirstOrThrow({ where: { dedicatedLineId: fixture.lineId } })).toMatchObject({ desiredVersion: 2, status: 'PENDING', observedVersion: null });
  });

  it('suspends a line through the projection queue and makes the command idempotent', async () => {
    const fixture = await seedLineFixture();
    const token = await loginAs(request, 'renewal@example.com', PASSWORD, fixture.siteId);

    const first = await request
      .post(`/api/dedicated-lines/${fixture.lineId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const second = await request
      .post(`/api/dedicated-lines/${fixture.lineId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toMatchObject({ lineId: fixture.lineId, status: 'SUSPENDED', desiredVersion: 2, replayed: false });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ lineId: fixture.lineId, status: 'SUSPENDED', desiredVersion: 2, replayed: true });
    expect(await prisma.dedicated_lines.findUniqueOrThrow({ where: { id: fixture.lineId } })).toMatchObject({ status: 'SUSPENDED', desiredVersion: 2 });
    expect((await prisma.dedicated_lines.findUniqueOrThrow({ where: { id: fixture.lineId } })).suspendedAt).toBeInstanceOf(Date);
    expect(await prisma.external_jobs.count({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION', dedicatedLineId: fixture.lineId } })).toBe(1);
    expect(await prisma.audit_logs.findFirst({ where: { targetType: 'dedicated_lines', targetId: fixture.lineId, action: 'dedicated_line.suspend' } })).toMatchObject({ actorId: fixture.userId, tenantId: expect.any(String) });
  });

  it('resumes a suspended line and creates a new projection version', async () => {
    const fixture = await seedLineFixture({ status: 'SUSPENDED' });
    const token = await loginAs(request, 'renewal@example.com', PASSWORD, fixture.siteId);

    const response = await request
      .post(`/api/dedicated-lines/${fixture.lineId}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data).toMatchObject({ lineId: fixture.lineId, status: 'PROVISIONING', desiredVersion: 2, replayed: false });
    expect(await prisma.dedicated_lines.findUniqueOrThrow({ where: { id: fixture.lineId } })).toMatchObject({ status: 'PROVISIONING', desiredVersion: 2, suspendedAt: null });
    expect(await prisma.external_jobs.count({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION', dedicatedLineId: fixture.lineId } })).toBe(1);
  });

  it('rejects resuming an expired suspended line before creating a projection job', async () => {
    const fixture = await seedLineFixture({ status: 'SUSPENDED', expiresAt: new Date(Date.now() - 60_000) });
    const token = await loginAs(request, 'renewal@example.com', PASSWORD, fixture.siteId);

    const response = await request
      .post(`/api/dedicated-lines/${fixture.lineId}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', data: { reasonKey: 'dedicated_line_expired' } });
    expect(await prisma.external_jobs.count({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION', dedicatedLineId: fixture.lineId } })).toBe(0);
  });
});

async function seedLineFixture(options: { status?: 'ACTIVE' | 'SUSPENDED'; expiresAt?: Date } = {}): Promise<{ siteId: string; userId: string; lineId: string }> {
  const siteId = await seedSite();
  const tenantId = await seedTenant(siteId);
  const { userId, walletId } = await seedUser(siteId, tenantId, { email: 'renewal@example.com', password: PASSWORD });
  await prisma.wallets.update({ where: { id: walletId }, data: { available: '100' } });
  const provider = await prisma.provider_accounts.create({
    data: { siteId, tenantId, providerCode: 'NINE_EIGHT_FIVE', status: 'ACTIVE', credentialEncrypted: 'test-only', baseUrl: 'https://provider.invalid' },
  });
  const sku = await prisma.service_skus.create({ data: { siteId, code: 'SV', name: 'Short video', capabilities: { delivery: 'dedicated-line' } } });
  const template = await prisma.price_templates.create({ data: { siteId, name: 'Renewal price', isDefault: true } });
  await prisma.sku_price_rules.create({ data: { siteId, templateId: template.id, skuId: sku.id, durationDays: 10, minQty: 1, unitPrice: '10', currency: 'CNY' } });
  const group = await prisma.node_groups.create({ data: { siteId, tenantId, code: 'hk-renewal', name: 'HK renewal', regionCode: 'HK' } });
  const node = await prisma.control_nodes.create({
    data: { siteId, tenantId, nodeGroupId: group.id, code: 'hk-renewal-1', name: 'HK renewal 1', regionCode: 'HK', baseUrl: 'https://panel.invalid', apiCredentialCiphertext: encryptAesGcm('token', KEY), apiCredentialFingerprint: 'renewal-fp', capacityUnits: 10 },
  });
  const inbound = await prisma.inbound_profiles.create({ data: { siteId, nodeGroupId: group.id, code: 'sv-renewal', protocol: 'VLESS', inboundTag: 'sv-renewal-1', listenPort: 60701 } });
  const policy = await prisma.line_placement_policies.create({ data: { siteId, tenantId, skuId: sku.id, nodeGroupId: group.id, inboundProfileId: inbound.id, targetReplicaCount: 1, minReadyReplicaCount: 1, maxUnitsPerNode: 10, allowedNodes: { create: [{ siteId, nodeId: node.id }] } } });
  const lineId = '00000000-0000-4000-8000-000000000021';
  const exit = await prisma.residential_exits.create({
    data: {
      siteId, tenantId, providerAccountId: provider.id, providerCode: provider.providerCode, countryCode: 'HK',
      endpointCiphertext: encryptAesGcm(JSON.stringify({ host: '203.0.113.10', port: 1080, protocol: 'SOCKS5' }), KEY),
      credentialCiphertext: encryptAesGcm(JSON.stringify({ username: 'user', password: 'pass' }), KEY), identityFingerprint: 'exit-renewal',
      maxReplicaFanout: 1, status: 'ASSIGNED', expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
  const line = await prisma.dedicated_lines.create({
    data: {
      id: lineId, siteId, tenantId, userId, skuId: sku.id, inboundProfileId: inbound.id, status: options.status ?? 'ACTIVE', countryCode: 'HK', protocol: 'VLESS',
      clientEmail: 'line-renewal@365proxy.internal', clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: 'renewal-client' }), KEY), clientIdentityFingerprint: 'client-renewal',
      desiredVersion: 1, expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), idempotencyKey: 'line-renewal',
    },
  });
  const placement = await prisma.dedicated_line_placements.create({
    data: {
      siteId, tenantId, userId, dedicatedLineId: line.id, policyId: policy.id, nodeGroupId: group.id, mode: 'ACTIVE_ACTIVE', targetReplicaCount: 1, minReadyReplicaCount: 1,
      assignmentFingerprint: 'placement-renewal', changeReason: 'RECONCILE', nodes: { create: [{ siteId, tenantId, userId, nodeId: node.id, ordinal: 0 }] },
    },
  });
  await prisma.dedicated_line_projections.create({ data: { siteId, tenantId, userId, dedicatedLineId: line.id, nodeId: node.id, projectionKey: `${line.id}:${node.id}`, desiredVersion: 1, desiredHash: 'initial' } });
  await prisma.dedicated_line_exit_assignments.create({ data: { siteId, tenantId, userId, dedicatedLineId: line.id, residentialExitId: exit.id, status: 'ACTIVE' } });
  void placement;
  return { siteId, userId, lineId };
}
