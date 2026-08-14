import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const updateMany = vi.fn();
  const findUnique = vi.fn();
  const findUniqueOrThrow = vi.fn();
  const findMany = vi.fn();
  const update = vi.fn();
  const migrationUpdateMany = vi.fn();
  const projectionFindFirst = vi.fn();
  const count = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    external_jobs: { updateMany, findUnique, findUniqueOrThrow, findMany, update },
    dedicated_line_projections: { findFirst: projectionFindFirst },
    dedicated_line_migrations: { updateMany: migrationUpdateMany },
  }));
  return { updateMany, findUnique, findUniqueOrThrow, findMany, update, projectionFindFirst, count, migrationUpdateMany, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction, external_jobs: { updateMany: db.updateMany, count: db.count }, dedicated_line_projections: { findFirst: db.projectionFindFirst } } }));

import { DedicatedLineMigrationJobRepository } from './dedicated-line-migration-job.repository';

beforeEach(() => {
  vi.clearAllMocks();
  db.findUniqueOrThrow.mockResolvedValue({ id: 'job-1', leaseOwner: 'worker-a' });
  db.findMany.mockResolvedValue([
    { id: 'job-1', attempt: 1, maxAttempts: 5, aggregateType: 'dedicated_line_migration', aggregateId: 'migration-1', payload: {} },
    { id: 'job-2', attempt: 2, maxAttempts: 5, aggregateType: 'dedicated_line_migration', aggregateId: 'migration-2', payload: {} },
  ]);
});

describe('DedicatedLineMigrationJobRepository', () => {
  it('allows only one worker to claim the same runnable job', async () => {
    db.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.claimRunnableJob('job-1', 'worker-a')).resolves.toMatchObject({ id: 'job-1', leaseOwner: 'worker-a' });
    await expect(repository.claimRunnableJob('job-1', 'worker-b')).resolves.toBeNull();

    expect(db.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(db.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', status: { in: ['QUEUED', 'RETRYING'] } }),
      data: expect.objectContaining({ status: 'LEASED', leaseOwner: 'worker-a', attempt: { increment: 1 } }),
    }));
  });

  it('marks a retryable failure FAILED at max attempts and raises migration operator state', async () => {
    const job = {
      id: 'job-1', kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1',
      desiredVersion: 2, attempt: 5, maxAttempts: 5, leaseOwner: 'worker-a', leaseExpiresAt: new Date(Date.now() + 60_000),
      payload: { migrationId: 'migration-1' }, nextRunAt: new Date(),
    };
    db.findUnique.mockResolvedValue(job);
    db.updateMany.mockResolvedValue({ count: 1 });
    db.migrationUpdateMany.mockResolvedValue({ count: 1 });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.markFailed(job as never, 'worker-a', 'UPSTREAM_TIMEOUT', { reasonKey: 'managed_line_timeout' }, { retry: true })).resolves.toBe('FAILED');
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(db.migrationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'migration-1', status: { in: ['ACTIVE', 'CANCELLED'] } },
      data: expect.objectContaining({ status: 'NEEDS_OPERATOR' }),
    }));
  });

  it('returns expired migration leases to the retry queue', async () => {
    db.updateMany.mockResolvedValueOnce({ count: 2 });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.recoverExpiredLeases()).resolves.toBe(2);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'LEASED', leaseExpiresAt: expect.any(Object) }),
      data: expect.objectContaining({ status: 'RETRYING', leaseOwner: null, leaseExpiresAt: null }),
    }));
  });

  it('stops recovering an expired lease after max attempts and raises operator state', async () => {
    db.findMany.mockResolvedValueOnce([
      { id: 'job-1', attempt: 5, maxAttempts: 5, aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1', payload: { migrationId: 'migration-1' } },
    ]);
    db.updateMany.mockResolvedValue({ count: 1 });
    db.migrationUpdateMany.mockResolvedValue({ count: 1 });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.recoverExpiredLeases()).resolves.toBe(1);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', status: 'LEASED' }),
      data: expect.objectContaining({ status: 'FAILED', completedAt: expect.any(Date) }),
    }));
    expect(db.migrationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'migration-1', status: { in: ['ACTIVE', 'CANCELLED'] } },
      data: expect.objectContaining({ status: 'NEEDS_OPERATOR' }),
    }));
  });

  it('uses a strictly newer remote version when loading projection delete work', async () => {
    const job = {
      id: 'job-delete', kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1',
      siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1', desiredVersion: 3,
      leaseOwner: 'worker-a', leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    db.count.mockResolvedValue(0);
    db.projectionFindFirst.mockResolvedValue({
      id: 'projection-1', projectionKey: 'line-1:node-1:v2', desiredVersion: 2,
      tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
      node: { baseUrl: 'https://node.example.com', apiCredentialCiphertext: 'cipher' },
    });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.loadProjectionDeleteWork(job as never, 'worker-a')).resolves.toMatchObject({ desiredVersion: 3 });
    expect(db.projectionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'projection-1', siteId: 'site-1' },
    }));
  });

  it('rejects a delete job that does not advance the remote version', async () => {
    const job = {
      id: 'job-delete', kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1',
      siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1', desiredVersion: 2,
      leaseOwner: 'worker-a', leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    db.count.mockResolvedValue(0);
    db.projectionFindFirst.mockResolvedValue({
      id: 'projection-1', projectionKey: 'line-1:node-1:v2', desiredVersion: 2,
      tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
      node: { baseUrl: 'https://node.example.com', apiCredentialCiphertext: 'cipher' },
    });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.loadProjectionDeleteWork(job as never, 'worker-a')).rejects.toMatchObject({
      reasonKey: 'migration_delete_desired_version_invalid',
    });
  });

  it('does not let a stale worker complete a job after its lease changed', async () => {
    const job = {
      id: 'job-1', desiredVersion: 2, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new DedicatedLineMigrationJobRepository();

    await expect(repository.markCompleted(job as never, 'worker-a')).rejects.toMatchObject({
      reasonKey: 'migration_job_lease_stale',
    });
    expect(db.update).not.toHaveBeenCalled();
  });
});
