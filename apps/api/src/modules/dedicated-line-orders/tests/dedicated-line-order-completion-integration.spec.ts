import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ipeasy/db';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { DedicatedLineOrderRepository } from '../dedicated-line-order.repository';
import { DedicatedLineProjectionRepository } from '../../dedicated-line-projections/dedicated-line-projection.repository';
import { DeliveryRouteImportUseCase } from '../../dedicated-lines/delivery-route-import.use-case';
import { DedicatedLineDeliveryUseCase } from '../../dedicated-lines/dedicated-line-delivery.use-case';
import { WalletRepository } from '../../wallet/wallet.repository';
import { cleanDatabase, seedSite, seedTenant, seedUser } from '../../../test-utils/integration-setup';

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dedicated-line provider completion', () => {
  it('atomically creates lines, placement nodes, projections, and projection jobs', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, { email: 'completion@example.com', password: 'unused' });
    const provider = await prisma.provider_accounts.create({
      data: {
        siteId, tenantId, providerCode: 'NINE_EIGHT_FIVE', status: 'ACTIVE', credentialEncrypted: 'test-only',
        baseUrl: 'https://provider.invalid', inventorySyncEnabled: true,
      },
    });
    const sku = await prisma.service_skus.create({ data: { siteId, code: 'SV', name: 'Short video', capabilities: { delivery: 'dedicated-line' } } });
    const group = await prisma.node_groups.create({ data: { siteId, tenantId, code: 'hk', name: 'HK', regionCode: 'HK' } });
    const firstNode = await prisma.control_nodes.create({
      data: {
        siteId, tenantId, nodeGroupId: group.id, code: 'hk-a', name: 'HK A', regionCode: 'HK',
        baseUrl: 'https://panel-a.example.com', apiCredentialCiphertext: 'ciphertext-a', apiCredentialFingerprint: 'fp-a', capacityUnits: 3,
      },
    });
    const secondNode = await prisma.control_nodes.create({
      data: {
        siteId, tenantId, nodeGroupId: group.id, code: 'hk-b', name: 'HK B', regionCode: 'HK',
        baseUrl: 'https://panel-b.example.com', apiCredentialCiphertext: 'ciphertext-b', apiCredentialFingerprint: 'fp-b', capacityUnits: 3,
      },
    });
    const inbound = await prisma.inbound_profiles.create({
      data: { siteId, nodeGroupId: group.id, code: 'sv-hk', protocol: 'VLESS', inboundTag: 'sv-hk-1', listenPort: 60701 },
    });
    const policy = await prisma.line_placement_policies.create({
      data: {
        siteId, tenantId, skuId: sku.id, nodeGroupId: group.id, inboundProfileId: inbound.id,
        targetReplicaCount: 2, minReadyReplicaCount: 1, maxUnitsPerNode: 3,
        allowedNodes: { create: [{ siteId, nodeId: firstNode.id }, { siteId, nodeId: secondNode.id }] },
      },
    });
    const snapshot = await prisma.dedicated_line_inventory_snapshots.create({
      data: {
        siteId, providerAccountId: provider.id, skuId: sku.id, providerCode: provider.providerCode,
        countryCode: 'HK', providerResourceId: 'HK:premium', quantity: 1, sourceVersion: 'completion',
        capturedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order = await prisma.dedicated_line_orders.create({
      data: {
        siteId, tenantId, userId, skuId: sku.id, skuCode: sku.code, skuName: sku.name, countryCode: 'HK',
        durationDays: 30, quantity: 1, unitPrice: '10', totalPrice: '10', currency: 'CNY',
        priceSource: 'SITE_DEFAULT_TEMPLATE', contractVersion: 1, idempotencyKey: 'completion-order',
      },
    });
    const reservation = await prisma.stock_reservations.create({
      data: {
        siteId, tenantId, userId, inventorySnapshotId: snapshot.id, providerAccountId: provider.id,
        skuId: sku.id, dedicatedLineOrderId: order.id, providerCode: provider.providerCode, countryCode: 'HK', quantity: 1,
        snapshotVersion: 'completion', idempotencyKey: 'completion-reservation', expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const job = await prisma.external_jobs.create({
      data: {
        siteId, tenantId, userId, dedicatedLineOrderId: order.id, kind: 'PROVIDER_DEDICATED_LINE_ORDER', aggregateType: 'stock_reservation', aggregateId: reservation.id,
        desiredVersion: 1, status: 'LEASED', attempt: 1, leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: 'completion-job', dedupeKey: 'completion-job', payload: {},
      },
    });
    const repository = new DedicatedLineOrderRepository(new WalletRepository());
    const result = await repository.persistCompletedOrder({
      jobId: job.id, workerId: 'worker-1', desiredVersion: 1, reservationId: reservation.id,
      providerCode: provider.providerCode, providerAccountId: provider.id, skuId: sku.id, countryCode: 'HK', placementPolicyId: policy.id, inboundTag: 'sv-hk-1',
      exits: [{
        lineId: '00000000-0000-4000-8000-000000000001', inboundProfileId: inbound.id, protocol: 'VLESS', clientEmail: 'line-1@365proxy.internal',
        clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: '00000000-0000-4000-8000-000000000002' }), key),
        clientIdentityFingerprint: 'client-fp-1', projectionDesiredHash: 'desired-hash-1', providerProxyId: 'proxy-1',
        endpointCiphertext: encryptAesGcm(JSON.stringify({ host: '203.0.113.9', port: 1080, protocol: 'SOCKS5' }), key),
        credentialCiphertext: encryptAesGcm(JSON.stringify({ username: 'exit-user', password: 'exit-password' }), key),
        identityFingerprint: 'exit-fp-1', maxReplicaFanout: 2, expiresAt: new Date(Date.now() + 60_000),
      }],
    });

    expect(result).toEqual({ status: 'COMPLETED' });
    expect(await prisma.dedicated_lines.count({ where: { dedicatedLineOrderId: order.id } })).toBe(1);
    expect(await prisma.dedicated_line_placements.count()).toBe(1);
    expect(await prisma.dedicated_line_placement_nodes.count()).toBe(2);
    expect(await prisma.dedicated_line_projections.count()).toBe(2);
    expect(await prisma.external_jobs.count({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION' } })).toBe(2);
    expect(await prisma.control_nodes.findUniqueOrThrow({ where: { id: firstNode.id } })).toMatchObject({ allocatedUnits: 1 });
    expect(await prisma.control_nodes.findUniqueOrThrow({ where: { id: secondNode.id } })).toMatchObject({ allocatedUnits: 1 });
    expect(await prisma.stock_reservations.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({ status: 'CONSUMED' });

    const projectionJob = await prisma.external_jobs.findFirstOrThrow({ where: { kind: 'APPLY_DEDICATED_LINE_PROJECTION' } });
    const projectionRepository = new DedicatedLineProjectionRepository();
    const claimed = await projectionRepository.claimRunnableJob(projectionJob.id, 'projection-worker');
    expect(claimed).not.toBeNull();
    const work = await projectionRepository.loadClaimedWork(claimed!, 'projection-worker');
    expect(work).toMatchObject({ inboundTag: 'sv-hk-1', protocol: 'VLESS', nodeStatus: 'ACTIVE', exitStatus: 'ASSIGNED' });
    await projectionRepository.markReady(claimed!, 'projection-worker', {
      projectionId: work.projectionId,
      observedVersion: 1,
      observedHash: work.desiredHash,
      nodeExternalId: work.projectionKey,
    });
    expect(await prisma.dedicated_lines.findFirstOrThrow()).toMatchObject({ status: 'MIGRATING_AWAITING_ROUTE_IMPORT' });

    const line = await prisma.dedicated_lines.findFirstOrThrow({ include: { placement: { include: { nodes: true } } } });
    await prisma.dedicated_line_domains.createMany({
      data: [
        { siteId, dedicatedLineId: line.id, hostname: 'test-sv-1.yisukj.top', port: 60701, role: 'PRIMARY' },
        { siteId, dedicatedLineId: line.id, hostname: 'test-sv-backup.yisukj.top', port: 60701, role: 'BACKUP' },
      ],
    });
    const routeImport = await new DeliveryRouteImportUseCase().execute({
      ownerId: 'operator-1', ownerType: 'PLATFORM_ADMIN', siteId, tenantId: null, scopes: [], requestId: 'route-import-1',
    }, {
      sourceName: 'ny-panel', sourceVersion: 'ny-2026-08-11-1', capturedAt: '2026-08-11T10:00:00.000Z',
      routes: [{
        sourceRouteId: 'ny-route-1', dedicatedLineId: line.id, entranceGroupCode: 'SV', protocol: 'VLESS', listenPort: 60701,
        sourceVersion: 'ny-1', validFrom: '2026-08-11T10:00:00.000Z',
        domains: [
          { hostname: 'test-sv-1.yisukj.top', port: 60701, isPrimary: true },
          { hostname: 'test-sv-backup.yisukj.top', port: 60701, isPrimary: false },
        ],
        targets: line.placement!.nodes.map((node) => ({ nodeId: node.nodeId, targetPort: 60701, targetVersion: 'xray-1' })),
      }],
    });
    expect(routeImport).toMatchObject({ routeCount: 1, replayed: false });
    expect(await prisma.delivery_route_domains.count()).toBe(2);
    expect(await prisma.dedicated_lines.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'DEGRADED' });
    const delivery = await new DedicatedLineDeliveryUseCase({ get: () => key } as never).get({
      ownerId: userId, ownerType: 'USER', siteId, tenantId, scopes: [], requestId: 'delivery-1',
    }, line.id);
    expect(delivery.client).toMatchObject({ email: 'line-1@365proxy.internal', id: '00000000-0000-4000-8000-000000000002' });
    expect(delivery.domains).toHaveLength(2);
    expect(JSON.stringify(delivery)).not.toContain('exit-user');
    expect(JSON.stringify(delivery)).not.toContain('exit-password');
  });

  it('refunds the debit exactly once when the provider job reaches a terminal failure', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId, walletId } = await seedUser(siteId, tenantId, { email: 'completion-refund@example.com', password: 'unused' });
    await prisma.wallets.update({ where: { id: walletId }, data: { available: '10' } });
    const provider = await prisma.provider_accounts.create({
      data: {
        siteId, tenantId, providerCode: 'NINE_EIGHT_FIVE', status: 'ACTIVE', credentialEncrypted: 'test-only',
        baseUrl: 'https://provider.invalid', inventorySyncEnabled: true,
      },
    });
    const sku = await prisma.service_skus.create({ data: { siteId, code: 'SV', name: 'Short video', capabilities: { delivery: 'dedicated-line' } } });
    const snapshot = await prisma.dedicated_line_inventory_snapshots.create({
      data: {
        siteId, providerAccountId: provider.id, skuId: sku.id, providerCode: provider.providerCode,
        countryCode: 'HK', providerResourceId: 'HK:premium', quantity: 1, sourceVersion: 'refund',
        capturedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const reservation = await prisma.stock_reservations.create({
      data: {
        siteId, tenantId, userId, inventorySnapshotId: snapshot.id, providerAccountId: provider.id,
        skuId: sku.id, providerCode: provider.providerCode, countryCode: 'HK', quantity: 1,
        snapshotVersion: 'refund', idempotencyKey: 'refund-reservation', expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.$transaction((tx) => new WalletRepository().debitWalletTx(
      tx, walletId, '10', 'CNY', 'DEBIT', reservation.id, 'dedicated_line_order', 'dedicated-line-debit:refund',
    ));
    const job = await prisma.external_jobs.create({
      data: {
        siteId, tenantId, userId, kind: 'PROVIDER_DEDICATED_LINE_ORDER', aggregateType: 'stock_reservation', aggregateId: reservation.id,
        desiredVersion: 1, status: 'LEASED', attempt: 5, maxAttempts: 5, leaseOwner: 'worker-refund', leaseExpiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: 'refund-job', dedupeKey: 'refund-job', payload: {},
      },
    });

    const repository = new DedicatedLineOrderRepository(new WalletRepository());
    await expect(repository.markFailed(job, 'worker-refund', 'UPSTREAM_ERROR', { reason: 'provider_failed' }, {
      retry: true,
      releaseReservation: true,
    })).resolves.toBe('FAILED');
    await expect(repository.markFailed(job, 'worker-refund', 'UPSTREAM_ERROR', { reason: 'provider_failed' }, {
      retry: true,
      releaseReservation: true,
    })).rejects.toThrow();

    expect((await prisma.wallets.findUniqueOrThrow({ where: { id: walletId } })).available.toString()).toBe('10');
    expect(await prisma.ledger_entries.count({ where: { walletId, type: 'REFUND' } })).toBe(1);
    expect(await prisma.stock_reservations.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({ status: 'RELEASED' });
  });
});
