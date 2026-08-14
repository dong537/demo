import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const count = vi.fn();
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const findUniqueOrThrow = vi.fn();
  const projectionUpdateMany = vi.fn();
  const projectionFindFirst = vi.fn();
  const projectionReadinessFindMany = vi.fn();
  const migrationFindUnique = vi.fn();
  const migrationUpdate = vi.fn();
  const migrationUpdateMany = vi.fn();
  const lineFindUnique = vi.fn();
  const lineUpdate = vi.fn();
  const routeCount = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    external_jobs: { count, findFirst, findMany, findUnique, updateMany, findUniqueOrThrow },
    dedicated_line_projections: { updateMany: projectionUpdateMany, findMany: projectionReadinessFindMany },
    dedicated_line_migrations: { findUnique: migrationFindUnique, update: migrationUpdate, updateMany: migrationUpdateMany },
    dedicated_lines: { findUnique: lineFindUnique, update: lineUpdate },
    delivery_routes: { count: routeCount },
  }));
  return {
    count, findFirst, findMany, findUnique, updateMany, findUniqueOrThrow,
    projectionUpdateMany, projectionFindFirst, projectionReadinessFindMany,
    migrationFindUnique, migrationUpdate, migrationUpdateMany, lineFindUnique,
    lineUpdate, routeCount, transaction,
  };
});

vi.mock('@ipeasy/db', () => ({
  prisma: {
    dedicated_line_projections: { findFirst: db.projectionFindFirst },
    $transaction: db.transaction,
  },
}));

import { DedicatedLineProjectionRepository } from './dedicated-line-projection.repository';

beforeEach(() => {
  vi.clearAllMocks();
  db.updateMany.mockResolvedValue({ count: 1 });
  db.projectionUpdateMany.mockResolvedValue({ count: 1 });
  db.migrationUpdateMany.mockResolvedValue({ count: 1 });
  db.lineFindUnique.mockResolvedValue(null);
  db.findFirst.mockResolvedValue({ aggregateId: 'projection-1' });
  db.findUniqueOrThrow.mockResolvedValue({ id: 'apply-job', aggregateId: 'projection-1', desiredVersion: 2 });
});

describe('DedicatedLineProjectionRepository claim', () => {
  it('never reclaims an apply job after deletion has been scheduled for its projection', async () => {
    db.count.mockResolvedValueOnce(1);
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.claimRunnableJob('apply-job', 'projection-worker')).resolves.toBeNull();
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(db.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.projectionUpdateMany).not.toHaveBeenCalled();
  });

  it('does not let a stale worker publish projection readiness', async () => {
    const job = {
      id: 'apply-job', aggregateId: 'projection-1', desiredVersion: 2,
      leaseOwner: 'projection-worker', leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    db.findUnique.mockResolvedValue(job);
    db.count.mockResolvedValue(0);
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.markReady(job as never, 'projection-worker', {
      projectionId: 'projection-1', observedVersion: 2, observedHash: 'hash', nodeExternalId: 'remote-1',
    })).rejects.toMatchObject({ reasonKey: 'projection_job_lease_stale' });
    expect(db.projectionUpdateMany).not.toHaveBeenCalled();
  });

  it('stops recovering projection leases after max attempts', async () => {
    db.findMany.mockResolvedValueOnce([{
      id: 'apply-job', aggregateId: 'projection-1', attempt: 5, maxAttempts: 5,
      payload: { migrationId: 'migration-1' },
    }]);
    db.updateMany.mockResolvedValue({ count: 1 });
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.recoverExpiredLeases()).resolves.toBe(1);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'apply-job', status: 'LEASED' }),
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('loads NODE_ONLY migration work with the current active exit assignment', async () => {
    const assignedExit = {
      status: 'ASSIGNED', countryCode: 'US', expiresAt: null,
      endpointCiphertext: 'current-endpoint', credentialCiphertext: 'current-credential',
    };
    db.projectionFindFirst.mockResolvedValueOnce({
      id: 'projection-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1',
      dedicatedLineId: 'line-1', migrationId: 'migration-1', projectionKey: 'line-1:node-new:v2',
      desiredVersion: 2, desiredHash: 'hash-2', nodeId: 'node-new',
      node: { status: 'ACTIVE', baseUrl: 'https://panel.example.com', apiCredentialCiphertext: 'panel-token' },
      dedicatedLine: {
        id: 'line-1', tenantId: 'tenant-1', userId: 'user-1', status: 'ACTIVE', protocol: 'VLESS',
        clientEmail: 'line@example.com', clientIdentityCiphertext: 'client-identity', expiresAt: null,
        quotaBytes: null, uplinkLimitBps: null, downlinkLimitBps: null, maxConnections: null, ipLimit: null,
        inboundProfile: { inboundTag: 'sv', isActive: true, controlNodeId: null },
        exitAssignment: { status: 'ACTIVE', residentialExit: assignedExit },
      },
      migration: { type: 'NODE_ONLY', targetExit: null },
    });
    const job = projectionJob();
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.loadClaimedWork(job as never, 'projection-worker')).resolves.toMatchObject({
      migrationId: 'migration-1', migrationTargetExit: false,
      endpointCiphertext: 'current-endpoint', credentialCiphertext: 'current-credential',
    });
  });

  it('does not revive a migration cancelled while target readiness was being published', async () => {
    const job = projectionJob();
    db.count.mockResolvedValue(0);
    db.migrationFindUnique.mockResolvedValueOnce({ type: 'NODE_ONLY', phase: 'PREPARE', status: 'ACTIVE', nodes: [{ projectionId: 'projection-1' }] });
    db.projectionReadinessFindMany.mockResolvedValueOnce([
      { id: 'projection-1', status: 'READY', desiredVersion: 2, observedVersion: 2 },
    ]);
    db.migrationUpdateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.markReady(job as never, 'projection-worker', {
      projectionId: 'projection-1', observedVersion: 2, observedHash: 'hash-2', nodeExternalId: 'remote-1',
    })).resolves.toBeUndefined();
    expect(db.migrationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'migration-1', phase: 'PREPARE', status: 'ACTIVE' },
      data: { phase: 'CANARY_ROUTE', status: 'ACTIVE' },
    });
    expect(db.migrationUpdate).not.toHaveBeenCalled();
  });

  it('does not advance migration readiness when a target projection link is missing', async () => {
    const job = projectionJob();
    db.count.mockResolvedValue(0);
    db.migrationFindUnique.mockResolvedValueOnce({
      type: 'NODE_ONLY', phase: 'PREPARE', status: 'ACTIVE',
      nodes: [
        { projectionId: 'projection-1' },
        { projectionId: null },
      ],
    });
    db.projectionReadinessFindMany.mockResolvedValueOnce([
      { id: 'projection-1', status: 'READY', desiredVersion: 2, observedVersion: 2 },
    ]);
    const repository = new DedicatedLineProjectionRepository();

    await expect(repository.markReady(job as never, 'projection-worker', {
      projectionId: 'projection-1', observedVersion: 2, observedHash: 'hash-2', nodeExternalId: 'remote-1',
    })).resolves.toBeUndefined();

    expect(db.migrationUpdateMany).not.toHaveBeenCalled();
  });
});

function projectionJob() {
  return {
    id: 'apply-job', kind: 'APPLY_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection',
    aggregateId: 'projection-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1',
    dedicatedLineId: 'line-1', desiredVersion: 2, payload: { migrationId: 'migration-1' },
    leaseOwner: 'projection-worker', leaseExpiresAt: new Date(Date.now() + 60_000),
  };
}
