import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { prisma } from '@ipeasy/db';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
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

const PASSWORD = 'ProductionReadinessTest123!';
const PLATFORM_EMAIL = 'readiness-platform@example.com';
const TENANT_EMAIL = 'readiness-tenant@example.com';
const USER_EMAIL = 'readiness-user@example.com';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;
let userId: string;
let platformToken: string;
let tenantToken: string;
let userToken: string;

beforeAll(async () => {
  app = await createTestApp({
    config: {
      APP_PLATFORM_CURRENCY: 'CNY',
      PAYMENT_CONFIRMATION_ENABLED: 'true',
      PROVIDER_INVENTORY_SYNC_ENABLED: 'true',
      DEDICATED_LINE_ORDER_EXECUTION_ENABLED: 'true',
      DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST: 'NINE_EIGHT_FIVE',
      DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST: '',
      DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED: 'true',
      DEDICATED_LINE_HEALTH_EXECUTION_ENABLED: 'true',
      BARK_ALERTS_ENABLED: 'true',
      BARK_DEVICE_KEYS: 'synthetic-readiness-device',
    },
  });
  request = supertest(app.getHttpServer());
});

beforeEach(async () => {
  await cleanDatabase();
  siteId = await seedSite();
  tenantId = await seedTenant(siteId);
  ({ userId } = await seedUser(siteId, tenantId, { email: USER_EMAIL, password: PASSWORD }));
  await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', { email: PLATFORM_EMAIL, password: PASSWORD });
  await seedAdminUser(siteId, tenantId, 'TENANT_ADMIN', { email: TENANT_EMAIL, password: PASSWORD });
  platformToken = await loginAs(request, PLATFORM_EMAIL, PASSWORD, siteId);
  tenantToken = await loginAs(request, TENANT_EMAIL, PASSWORD, siteId);
  userToken = await loginAs(request, USER_EMAIL, PASSWORD, siteId);
});

afterAll(async () => {
  await cleanDatabase();
  await app?.close();
});

describe('GET /api/admin/production-readiness', () => {
  it('reports an empty site as not ready without exposing sensitive fields', async () => {
    const response = await request
      .get('/api/admin/production-readiness')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.ready).toBe(false);
    expect(response.body.data.checks).toHaveLength(11);
    expect(JSON.stringify(response.body.data)).not.toMatch(/credential|password|secret|baseUrl|hostname/i);
  });

  it.each([
    ['USER', () => userToken],
    ['TENANT_ADMIN', () => tenantToken],
  ])('rejects %s callers', async (_ownerType, token) => {
    const response = await request
      .get('/api/admin/production-readiness')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('becomes ready only after both dedicated-line SKUs have a complete production path', async () => {
    await seedCompleteProductionPath();

    const response = await request
      .get('/api/admin/production-readiness')
      .set('Authorization', `Bearer ${platformToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.ready).toBe(true);
    expect(response.body.data.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
  });
});

async function seedCompleteProductionPath(): Promise<void> {
  const [sv, zb] = await Promise.all([
    createSku('SV', 10),
    createSku('ZB', 20),
  ]);
  await prisma.sku_price_overrides.createMany({
    data: [sv, zb].map((sku) => ({
      siteId,
      skuId: sku.id,
      durationDays: 30,
      minQty: 1,
      unitPrice: '100',
      currency: 'CNY',
    })),
  });

  const provider = await prisma.provider_accounts.create({
    data: {
      siteId,
      providerCode: 'NINE_EIGHT_FIVE',
      status: 'ACTIVE',
      credentialEncrypted: 'synthetic-readiness-ciphertext',
      baseUrl: 'https://provider.example.com',
      timeoutMs: 15_000,
      inventorySyncEnabled: true,
    },
  });
  await prisma.audit_logs.create({
    data: {
      siteId,
      actorType: 'ADMIN_USER',
      actorId: 'synthetic-readiness-operator',
      targetType: 'provider_account',
      targetId: provider.id,
      action: 'provider.health_check',
      requestId: 'synthetic-readiness-request',
      meta: { providerCode: 'NINE_EIGHT_FIVE', reachable: true },
    },
  });
  const now = new Date();
  await prisma.dedicated_line_inventory_snapshots.createMany({
    data: [sv, zb].map((sku) => ({
      siteId,
      providerAccountId: provider.id,
      skuId: sku.id,
      providerCode: 'NINE_EIGHT_FIVE',
      countryCode: 'US',
      providerResourceId: `sk5-${sku.code.toLowerCase()}`,
      quantity: 5,
      sourceVersion: `synthetic-${sku.code.toLowerCase()}-inventory`,
      capturedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    })),
  });

  const group = await prisma.node_groups.create({
    data: { siteId, code: 'hk', name: 'Hong Kong', regionCode: 'HK', isActive: true },
  });
  const node = await prisma.control_nodes.create({
    data: {
      siteId,
      nodeGroupId: group.id,
      code: 'hk-1',
      name: 'Hong Kong 1',
      regionCode: 'HK',
      baseUrl: 'https://openui.example.com',
      apiCredentialCiphertext: 'synthetic-openui-ciphertext',
      apiCredentialFingerprint: 'synthetic-openui-fingerprint',
      status: 'ACTIVE',
      capacityUnits: 20,
      allocatedUnits: 0,
    },
  });
  const inbound = await prisma.inbound_profiles.create({
    data: {
      siteId,
      nodeGroupId: group.id,
      code: 'dedicated-default',
      protocol: 'VLESS',
      inboundTag: 'dedicated-inbound',
      listenPort: 60_701,
      isActive: true,
    },
  });
  for (const sku of [sv, zb]) {
    await prisma.line_placement_policies.create({
      data: {
        siteId,
        skuId: sku.id,
        nodeGroupId: group.id,
        inboundProfileId: inbound.id,
        targetReplicaCount: 1,
        minReadyReplicaCount: 1,
        maxUnitsPerNode: 10,
        isActive: true,
        allowedNodes: { create: [{ siteId, nodeId: node.id }] },
      },
    });
  }

  const line = await prisma.dedicated_lines.create({
    data: {
      siteId,
      tenantId,
      userId,
      skuId: sv.id,
      inboundProfileId: inbound.id,
      status: 'ACTIVE',
      countryCode: 'US',
      protocol: 'VLESS',
      clientEmail: 'readiness-line@example.com',
      clientIdentityCiphertext: 'synthetic-line-ciphertext',
      clientIdentityFingerprint: 'synthetic-line-fingerprint',
      idempotencyKey: 'synthetic-line-idempotency',
      startsAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    },
  });
  const routeImport = await prisma.delivery_route_imports.create({
    data: {
      siteId,
      sourceName: 'ny-panel',
      sourceVersion: 'synthetic-route-v1',
      sourceFingerprint: 'synthetic-route-fingerprint',
      importedBy: 'synthetic-readiness-operator',
      capturedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    },
  });
  await prisma.delivery_routes.create({
    data: {
      siteId,
      tenantId,
      userId,
      routeImportId: routeImport.id,
      dedicatedLineId: line.id,
      sourceRouteId: 'synthetic-route-1',
      entranceGroupCode: 'test-sv',
      protocol: 'VLESS',
      listenPort: 60_701,
      sourceVersion: 'synthetic-route-v1',
      isCurrent: true,
      isStaged: false,
      validFrom: now,
      domains: {
        create: [
          { hostname: 'primary.example.com', port: 60_701, isPrimary: true },
          { hostname: 'backup.example.com', port: 60_701, isPrimary: false },
        ],
      },
      targets: {
        create: [{ nodeId: node.id, targetPort: 60_701, targetVersion: 'synthetic-target-v1' }],
      },
    },
  });
}

function createSku(code: 'SV' | 'ZB', sortOrder: number) {
  return prisma.service_skus.create({
    data: {
      siteId,
      code,
      name: `${code} Dedicated Line`,
      capabilities: {
        delivery: 'dedicated-line',
        supportedProtocols: ['VLESS', 'VMESS', 'MIXED'],
        supportsMultiNodePlacement: true,
      },
      isActive: true,
      isVisible: true,
      sortOrder,
    },
  });
}
